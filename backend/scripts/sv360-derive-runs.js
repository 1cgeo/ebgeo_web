#!/usr/bin/env node
// Path: scripts/sv360-derive-runs.js
// Fills sv360.capture_runs and the sv360.photos.run_id / run_position columns
// from the session id the equipment wrote into `original_name`. Ported from
// ebgeo_360 `scripts/derive-runs.js` (branch master), adapted to Postgres.
//
// A CAPTURE RUN IS A RECORDING SESSION — one continuous drive of the vehicle,
// from the moment the operator started the capture until it stopped. It is the
// granularity at which the calibration is constant: measured on `faxinal`, the
// spread of mesh_rotation_y INSIDE a run is 0,60 degree against 8,40 between the
// run means. The boundary comes from the session id in the filename and NOT from
// a time gap; see sv360.capture-runs.js for why, and migration
// 007_sv360.sql for the schema rationale.
//
// ALL THE COMPUTATION LIVES IN src/modules/streetview360/sv360.capture-runs.js,
// which is the origin's `scripts/lib/capture-runs.js` ported verbatim and covered
// by unit tests. This file is orchestration only: read photos -> group -> write.
// Nothing here re-implements a naming rule, on purpose.
//
// RERUNNABLE, AND IDEMPOTENT. It rebuilds every run of a project from scratch on
// each pass, which matters for two reasons: `run_position` improves on its own
// once capture_date is imported from the source (scripts/sv360-import-captured-at.js),
// and soft-deleted photos must drop out of the count. What it does NOT touch is
// the calibration: `applied_rotation_*` of a run that already existed survives,
// because the run is re-identified by (project_id, session_key).
//
// TWO DIVERGENCES FROM THE ORIGIN, both deliberate:
//
//   1. UPSERT INSTEAD OF DELETE-AND-REINSERT. The origin mints a fresh
//      randomUUID() for every run on every pass, so the run ids churn even when
//      nothing about the corpus changed, and it needs a side map to carry
//      `applied_rotation_*` across the rebuild. Here the write is an
//      `ON CONFLICT (project_id, session_key) DO UPDATE` that leaves the id and
//      the three rotation columns alone, and a second statement deletes only the
//      runs whose session_key vanished. A second pass therefore reproduces the
//      SAME ids, not merely the same shape — which is what makes idempotency
//      provable by reading the table instead of by counting it.
//
//   2. TIME IS AN INSTANT, NOT A STRING. `capture_runs.started_at` is TIMESTAMPTZ
//      here and TEXT in the origin. The grouping library speaks local wall clock
//      (that is the scale the PIC_ filename carries), so this script converts on
//      both edges through scripts/sv360-survey-clock.js: capture_date (instant)
//      comes IN as local wall clock, run.startedAt (local wall clock) goes OUT as
//      an instant. Skipping the conversion would let the session TimeZone of
//      whoever ran the ETL decide what the stored instant means.
//
// THE ORDERING TRAP THE ORIGIN RECORDS, kept here: photos.run_id references
// capture_runs(id), so the references must be RELEASED BEFORE any run row is
// deleted. Doing it the other way round passes on the first pass only because
// run_id is still all NULL, and blows up on the second with a foreign key error.
//
// Usage (CLI):
//   node --env-file=.env scripts/sv360-derive-runs.js [--slug <slug>] [--dry-run]
//     --slug <slug>  derive one project only (use it for the pilot run)
//     --dry-run      compute and report, write nothing
//
// Testable entry point: deriveRuns({ slug, dryRun, logger }).

import { pathToFileURL } from 'node:url';
import { tx, task, pgp } from '../src/database/index.js';
import { groupPhotosIntoRuns } from '../src/modules/streetview360/sv360.capture-runs.js';
import { instantToLocal, localToInstant } from './sv360-survey-clock.js';

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

// The slug is unique per ORGANIZATION, not globally (007_sv360.sql), so --slug
// covers every organization that owns a project by that name. That is the wanted
// reading: the filter names a corpus, and the derivation is per project either
// way. It is stated here because the flag reads like it selects one row.
// $1 = slug filter (text, NULL for every project)
const SELECT_PROJECTS = `
  SELECT id, slug
  FROM sv360.projects
  WHERE $1::text IS NULL OR slug = $1::text
  ORDER BY slug
`;

// A project WITH declared floors groups by floor, not by filename. The question
// is asked of the database and not of a command-line flag, so the criterion does
// not depend on someone remembering the flag: rows in sv360.project_floors ARE
// the declaration that the project has floors (migration 012).
// $1 = project_id (uuid)
const SELECT_FLOORS = `
  SELECT level, label
  FROM sv360.project_floors
  WHERE project_id = $1::uuid
`;

// Soft-deleted photos stay out: they appear nowhere in the interface, and
// counting them would inflate the run's photo_count and the review progress bar.
// $1 = project_id (uuid)
const SELECT_PHOTOS = `
  SELECT ph.id, ph.original_name, ph.capture_date, ph.floor_level, ph.floor_label
  FROM sv360.photos ph
  WHERE ph.project_id = $1::uuid
    AND NOT EXISTS (
      SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = ph.id
    )
`;

// PASSO 1 — release the references before anything is deleted (see the header).
// $1 = project_id (uuid)
const CLEAR_PHOTO_RUNS = `
  UPDATE sv360.photos
  SET run_id = NULL, run_position = NULL
  WHERE project_id = $1::uuid
    AND (run_id IS NOT NULL OR run_position IS NOT NULL)
`;

// PASSO 2 — drop only the runs whose session vanished from the corpus. With an
// empty key array `<> ALL` is true for every row, which is the wanted behaviour:
// a project with no recognisable session keeps no runs.
// $1 = project_id (uuid), $2 = surviving session keys (text[])
const DELETE_STALE_RUNS = `
  DELETE FROM sv360.capture_runs
  WHERE project_id = $1::uuid
    AND session_key <> ALL($2::text[])
`;

// PASSO 3 — the run itself. `applied_rotation_*` is absent from the UPDATE list
// on purpose: it is the record of the last default a reviewer applied, and
// re-deriving the runs must not erase it.
// $1 = project_id (uuid), $2 = session_key, $3 = label,
// $4 = started_at (timestamptz|null), $5 = ordinal, $6 = photo_count
const UPSERT_RUN = `
  INSERT INTO sv360.capture_runs
    (project_id, session_key, label, started_at, ordinal, photo_count)
  VALUES ($1::uuid, $2, $3, $4::timestamptz, $5, $6)
  ON CONFLICT (project_id, session_key) DO UPDATE
    SET label       = EXCLUDED.label,
        started_at  = EXCLUDED.started_at,
        ordinal     = EXCLUDED.ordinal,
        photo_count = EXCLUDED.photo_count
  RETURNING id
`;

// PASSO 4 — one statement per run instead of one per photo: a single run can
// hold thousands of photos, and a round trip each would dominate the runtime.
// $1 = run_id (uuid), $2 = photo ids (text[]), $3 = positions (int[])
const LINK_PHOTOS = `
  UPDATE sv360.photos AS p
  SET run_id = $1::uuid, run_position = v.pos
  FROM (SELECT unnest($2::text[]) AS id, unnest($3::int[]) AS pos) AS v
  WHERE p.id = v.id
`;

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Derives the capture runs of one project inside an open context.
 *
 * @param {Object} t - pg-promise task/transaction context
 * @param {{id: string, slug: string}} project - Project row
 * @param {boolean} dryRun - Compute only, write nothing
 * @returns {Promise<Object>} One report line
 */
async function deriveProject(t, project, dryRun) {
  // The run label comes from project_floors and not from the photo's own
  // floor_label: one level may gather photos with different names (level 0 of
  // Beira-Rio holds "Campo" and "Externo"), and the run belongs to the FLOOR,
  // not to one of its parts.
  const floors = await t.any(SELECT_FLOORS, [project.id]);
  const labelOfLevel = new Map(floors.map((f) => [f.level, f.label]));
  const byFloor = labelOfLevel.size > 0;

  const rows = await t.any(SELECT_PHOTOS, [project.id]);
  const photos = rows.map((r) => ({
    id: r.id,
    originalName: r.original_name,
    // Back to local wall clock: the grouping library compares this against the
    // `startedAt` it reads off the PIC_ filename, which is local by nature.
    capturedAt: instantToLocal(r.capture_date, project.slug),
    floorLevel: r.floor_level,
    floorLabel: labelOfLevel.get(r.floor_level) ?? r.floor_label,
  }));

  const { runs, unmatched } = groupPhotosIntoRuns(photos, { byFloor });

  if (!dryRun) {
    await t.none(CLEAR_PHOTO_RUNS, [project.id]);
    await t.none(DELETE_STALE_RUNS, [project.id, runs.map((r) => r.sessionKey)]);

    for (const run of runs) {
      const { id } = await t.one(UPSERT_RUN, [
        project.id,
        run.sessionKey,
        run.label,
        localToInstant(run.startedAt, project.slug),
        run.ordinal,
        run.photoCount,
      ]);
      if (run.photos.length > 0) {
        await t.none(LINK_PHOTOS, [
          id,
          run.photos,
          run.photos.map((_, i) => i + 1),
        ]);
      }
    }
  }

  const sizes = runs.map((r) => r.photoCount).sort((a, b) => a - b);
  return {
    projeto: project.slug,
    fotos: photos.length,
    faixas: runs.length,
    ordem: byFloor
      ? 'andar'
      : runs.length && runs.every((r) => r.startedAt)
        ? 'cronologica'
        : 'tamanho',
    menor: sizes[0] ?? 0,
    mediana: sizes[Math.floor(sizes.length / 2)] ?? 0,
    maior: sizes[sizes.length - 1] ?? 0,
    semFaixa: unmatched.length,
  };
}

/**
 * Derives the capture runs of every project (or of one, with `slug`).
 *
 * One transaction PER PROJECT, and not one for the whole corpus: the corpus is
 * ~99k photos, and a single transaction would hold row locks over every project
 * while an operator may be calibrating one of them.
 *
 * @param {Object} [options] - Options
 * @param {string|null} [options.slug] - Restrict to one project
 * @param {boolean} [options.dryRun=false] - Compute and report, write nothing
 * @param {Object} [options.logger=console] - Injected logger
 * @returns {Promise<{report: Array<Object>, totals: Object}>}
 */
export async function deriveRuns({ slug = null, dryRun = false, logger = console } = {}) {
  const projects = await task((t) => t.any(SELECT_PROJECTS, [slug]));
  if (projects.length === 0) {
    throw new Error(slug ? `Project '${slug}' not found.` : 'No project in the database.');
  }

  const report = [];
  for (const project of projects) {
    // A dry run must not open a write transaction; a task gives the same
    // context object without one.
    const run = (cb) => (dryRun ? task(cb) : tx(cb));
    const line = await run((t) => deriveProject(t, project, dryRun));
    report.push(line);
    logger.info?.(
      `[sv360-derive-runs] ${line.projeto}: ${line.faixas} run(s), ` +
        `${line.fotos} photo(s), ${line.semFaixa} unmatched`
    );
  }

  const totals = {
    fotos: report.reduce((a, r) => a + r.fotos, 0),
    faixas: report.reduce((a, r) => a + r.faixas, 0),
    semFaixa: report.reduce((a, r) => a + r.semFaixa, 0),
  };
  return { report, totals };
}

// ---------------------------------------------------------------------------
// CLI wrapper (only when run directly, not when imported by tests)
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const argv = process.argv.slice(2);
  const getArg = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
  };
  const slug = getArg('slug', null);
  const dryRun = argv.includes('--dry-run');
  const silent = { info: () => {}, warn: () => {}, error: () => {} };

  console.log(`Deriving capture runs${slug ? ` for '${slug}'` : ''}${dryRun ? ' (dry-run)' : ''}\n`);

  deriveRuns({ slug, dryRun, logger: silent })
    .then(async ({ report, totals }) => {
      console.table(report);
      console.log(`\n${totals.faixas} run(s) for ${totals.fotos} photo(s).`);
      if (totals.semFaixa > 0) {
        // Not fatal: the interface treats a photo without a run as the old mode.
        // But it is the signal that a NEW filename pattern showed up, and it
        // deserves a rule in sv360.capture-runs.js instead of sitting outside
        // the run navigation.
        console.log(
          `ATENCAO: ${totals.semFaixa} photo(s) without a run — unrecognised filename pattern.`
        );
      } else {
        console.log('Every photo was assigned to a run.');
      }
      if (dryRun) console.log('\nNothing was written (--dry-run).');
      await pgp.end();
    })
    .catch(async (err) => {
      console.error('sv360-derive-runs failed:', err?.message || err);
      await pgp.end();
      process.exit(1);
    });
}
