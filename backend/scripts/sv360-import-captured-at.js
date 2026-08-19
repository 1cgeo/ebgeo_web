#!/usr/bin/env node
// Path: scripts/sv360-import-captured-at.js
// Imports the real CAPTURE TIME of each 360 photo. Ported from ebgeo_360
// `scripts/import-captured-at.js` (branch master), including the timezone and
// clock-skew fix of commit e2fb591, and adapted to Postgres.
//
// WHERE IT LANDS, and why the column is not called what the origin calls it:
// the origin writes `photos.captured_at`. That column does NOT exist here, by
// decision recorded at the end of migration 007_sv360.sql —
// sv360.photos.capture_date has existed since migration 005 and is the SAME
// measurement, the instant this photo was taken. One measurement, one column,
// and the name translation lives in the ETL. This file is that ETL.
//
// WHAT THE TIME IS FOR. It does NOT find the run boundary — that comes from the
// session id in `original_name`, and for good reason (see sv360.capture-runs.js).
// It serves two other ends:
//   1. It gives `started_at` to the runs whose NAME carries no time. The
//      MULTICAPTURA id is opaque (9468, 4809, 0913), so without this the affected
//      projects list their runs by photo count instead of chronologically. ONE
//      dated photo per run is enough.
//   2. It records the real capture date, which lived nowhere in this schema.
// What it does NOT improve, measured at the origin: the order INSIDE a run. Over
// four fully covered projects (46.266 photos) reordering by time moves 0,00% to
// 0,01% of the photos, because the frame number is already a clock.
//
// SOURCES, in this order of precedence:
//   1. `--sources <dir>[,<dir>]`  the survey metadata itself: fotos.geojson
//      (properties.nome_img + properties.time_img) and *.csv (nome_img|nome +
//      time_img|time). Both carry an epoch that needs the measured correction of
//      scripts/sv360-survey-clock.js. This is the PRIMARY source.
//   2. `--index-db <path>`        the legacy SQLite index.db, column
//      photos.captured_at. It is a CARRY, not a primary source: the origin
//      already converted it from the same geojson/csv, so it arrives as local
//      wall clock and must NOT be converted again. It is what migration 013
//      names as the mapping this port has to perform, and it is the only source
//      that travels with the corpus.
//   3. `--from-name`             deduced from the PIC_ filename plus the fixed
//      4 s timelapse cadence. Measured against the EXIF of 5.672 faxinal photos:
//      100% within 5 s, median 2 s. The MULTICAPTURA names carry no time.
// A source earlier in the list wins: the instrument's own stamp has precedence
// over a carried copy, and a carried copy over a deduction.
//
// The source directories arrive as arguments on purpose: the survey network
// paths do not belong in the repository.
//
// Usage (CLI):
//   node --env-file=.env scripts/sv360-import-captured-at.js \
//     [--sources "<dir>[,<dir>]"] [--index-db <path>] [--from-name] \
//     [--slug <slug>] [--dry-run]
//
// Testable entry point: importCapturedAt({ sources, indexDb, fromName, slug, dryRun, logger }).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { one, task, tx, pgp } from '../src/database/index.js';
import { captureTimeFromName } from '../src/modules/streetview360/sv360.capture-runs.js';
import { epochToInstant, localToInstant, readEpoch } from './sv360-survey-clock.js';

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

// The slug is unique per ORGANIZATION, not globally (007_sv360.sql), so --slug
// covers every organization that owns a project by that name.
// $1 = slug filter (text, NULL for every project)
const SELECT_PROJECTS = `
  SELECT id, slug
  FROM sv360.projects
  WHERE $1::text IS NULL OR slug = $1::text
  ORDER BY slug
`;

// Soft-deleted photos stay out: they appear nowhere in the interface and belong
// to no run.
// $1 = project_id (uuid)
const SELECT_PHOTOS = `
  SELECT ph.id, ph.original_name, ph.capture_date
  FROM sv360.photos ph
  WHERE ph.project_id = $1::uuid
    AND NOT EXISTS (
      SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = ph.id
    )
`;

// One statement per batch instead of one per photo: the corpus has ~88k dated
// photos, and a round trip each would dominate the runtime. The
// `IS DISTINCT FROM` guard keeps a rerun from rewriting rows that already hold
// the value, so `updated_at`-style side effects stay off unchanged rows.
// $1 = photo ids (text[]), $2 = instants as ISO-8601 UTC (text[])
const UPDATE_CAPTURE_DATE = `
  UPDATE sv360.photos AS p
  SET capture_date = v.ts::timestamptz
  FROM (SELECT unnest($1::text[]) AS id, unnest($2::text[]) AS ts) AS v
  WHERE p.id = v.id
    AND p.capture_date IS DISTINCT FROM v.ts::timestamptz
`;

// $1 = project ids (uuid[])
const COUNT_WITH_CAPTURE_DATE = `
  SELECT COUNT(*)::int AS n
  FROM sv360.photos ph
  WHERE ph.project_id = ANY($1::uuid[])
    AND ph.capture_date IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = ph.id
    )
`;

// ---------------------------------------------------------------------------
// Resilient reading (the survey lives on a network drive that drops)
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits for a network drive to come back. Same treatment as the origin's
 * migrate.js and import-geojson-photos.js: the survey drive drops in the middle
 * of the operation, and a short backoff only burns the retries against a dead
 * path.
 *
 * @param {string} dir - Directory that vanished
 * @param {Object} logger - Injected logger
 * @param {number} [limitMs] - Maximum wait
 * @returns {Promise<boolean>} true if it came back
 */
async function waitForDrive(dir, logger, limitMs = 30 * 60 * 1000) {
  if (existsSync(dir)) return true;
  const start = Date.now();
  let warned = false;
  while (Date.now() - start < limitMs) {
    if (existsSync(dir)) {
      logger.info?.(`  drive back after ${((Date.now() - start) / 1000).toFixed(0)}s, resuming`);
      return true;
    }
    if (!warned) {
      logger.warn?.(
        `  WAITING: source directory vanished — reconnect it (giving up in ${limitMs / 60000} min)`
      );
      warned = true;
    }
    await sleep(5000);
  }
  return false;
}

const ATTEMPTS = 8;

/**
 * Reads a file with retry and backoff, tolerating a drive drop.
 *
 * @param {string} path - File to read
 * @param {string} root - Source directory, probed when it vanishes
 * @param {Object} logger - Injected logger
 * @returns {Promise<string|null>} Contents, or null if it gave up
 */
async function readResilient(path, root, logger) {
  for (let t = 1; t <= ATTEMPTS; t++) {
    try {
      return readFileSync(path, 'utf-8');
    } catch (e) {
      if (t === ATTEMPTS) {
        logger.warn?.(`  failed to read ${basename(path)}: ${e.message}`);
        return null;
      }
      if (!existsSync(root) && !(await waitForDrive(root, logger))) return null;
      await sleep(Math.min(30000, 300 * 2 ** t));
    }
  }
  return null;
}

/**
 * Lists the files of interest under a directory, recursively.
 *
 * The depth goes to 10 because the corpus nests deep: the parque_osorio metadata
 * sits eight levels down. With the limit at 6 the project vanished from the
 * report entirely, with no error at all.
 *
 * @param {string} root - Starting directory
 * @param {number} [maxDepth] - Maximum depth
 * @returns {string[]} Paths of fotos.geojson and *.csv
 */
export function findSourceFiles(root, maxDepth = 10) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === 'fotos.geojson' || extname(e.name).toLowerCase() === '.csv') found.push(p);
    }
  };
  walk(root, 0);
  return found;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Splits a CSV line honouring double quotes.
 *
 * Written here instead of pulling a dependency: the source format is simple (no
 * newline inside a field) and the project has no CSV library.
 *
 * @param {string} line - Raw line
 * @returns {string[]} Fields
 */
export function splitCsvLine(line) {
  const fields = [];
  let current = '';
  let inside = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inside && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inside = !inside;
      }
    } else if (c === ',' && !inside) {
      fields.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
}

const COL_NAME = ['nome_img', 'nome'];
const COL_TIME = ['time_img', 'time'];

/**
 * Extracts (name, epoch) pairs from a survey CSV.
 *
 * @param {string} text - File contents
 * @returns {Array<[string, number]>} Valid pairs
 */
export function pairsFromCsv(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((s) => s.trim().replace(/^"|"$/g, ''));
  const iName = header.findIndex((c) => COL_NAME.includes(c));
  const iTime = header.findIndex((c) => COL_TIME.includes(c));
  if (iName === -1 || iTime === -1) return [];
  const pairs = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const fields = splitCsvLine(lines[i]);
    const name = (fields[iName] ?? '').trim().replace(/^"|"$/g, '');
    const epoch = readEpoch(fields[iTime]);
    if (name && epoch !== null) pairs.push([name, epoch]);
  }
  return pairs;
}

/**
 * Extracts (name, epoch) pairs from a survey fotos.geojson.
 *
 * @param {string} text - File contents
 * @returns {Array<[string, number]>} Valid pairs
 */
export function pairsFromGeojson(text) {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    return [];
  }
  const pairs = [];
  for (const f of d.features ?? []) {
    const pr = f?.properties ?? {};
    const epoch = readEpoch(pr.time_img);
    if (pr.nome_img && epoch !== null) pairs.push([String(pr.nome_img), epoch]);
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const BATCH = 5000;

/**
 * Imports the capture time into sv360.photos.capture_date.
 *
 * @param {Object} [options] - Options
 * @param {string[]} [options.sources=[]] - Survey metadata directories
 * @param {string|null} [options.indexDb] - Legacy SQLite index.db path
 * @param {boolean} [options.fromName=false] - Also deduce from the PIC_ filename
 * @param {string|null} [options.slug] - Restrict to one project
 * @param {boolean} [options.dryRun=false] - Compute and report, write nothing
 * @param {Object} [options.logger=console] - Injected logger
 * @returns {Promise<{report: Array<Object>, totals: Object}>}
 */
export async function importCapturedAt({
  sources = [],
  indexDb = null,
  fromName = false,
  slug = null,
  dryRun = false,
  logger = console,
} = {}) {
  if (sources.length === 0 && !indexDb && !fromName) {
    throw new Error('No source given: use --sources, --index-db or --from-name.');
  }

  const projects = await task((t) => t.any(SELECT_PROJECTS, [slug]));
  if (projects.length === 0) {
    throw new Error(slug ? `Project '${slug}' not found.` : 'No project in the database.');
  }

  // original_name -> {id, slug, current}. The key is the ORIGINAL NAME because
  // that is the only identifier the survey metadata and the database share; the
  // photo id is minted on ingestion and appears in no source file.
  const inDb = new Map();
  const byProject = new Map();
  for (const p of projects) {
    const rows = await task((t) => t.any(SELECT_PHOTOS, [p.id]));
    byProject.set(p.slug, rows);
    for (const r of rows) {
      inDb.set(r.original_name, { id: r.id, slug: p.slug, current: r.capture_date });
    }
  }
  logger.info?.(`database: ${inDb.size} live photo(s) in ${projects.length} project(s)`);

  // -------------------------------------------------------------------------
  // 1) External sources: the survey metadata itself
  // -------------------------------------------------------------------------

  const seen = new Map(); // original_name -> Map<epoch, how many files said it>
  let filesUsed = 0;
  let droppedUnknown = 0;

  for (const rootArg of sources) {
    const dir = resolve(rootArg);
    if (!existsSync(dir)) {
      logger.warn?.('source directory missing, skipping it');
      continue;
    }
    const files = findSourceFiles(dir);
    logger.info?.(`source: ${files.length} candidate file(s)`);
    for (const path of files) {
      const text = await readResilient(path, dir, logger);
      if (text === null) continue;
      const pairs =
        basename(path) === 'fotos.geojson' ? pairsFromGeojson(text) : pairsFromCsv(text);
      if (pairs.length === 0) continue;
      let useful = 0;
      for (const [name, epoch] of pairs) {
        if (!inDb.has(name)) {
          droppedUnknown++;
          continue;
        }
        useful++;
        let votes = seen.get(name);
        if (!votes) {
          votes = new Map();
          seen.set(name, votes);
        }
        votes.set(epoch, (votes.get(epoch) ?? 0) + 1);
      }
      if (useful > 0) {
        filesUsed++;
        logger.info?.(`  ${String(useful).padStart(6)} of ${String(pairs.length).padStart(6)}  ${basename(path)}`);
      }
    }
  }

  // Sources that disagree about the same photo: folder duplication in the corpus
  // makes one photo appear in several files, and diverging copies exist. The
  // most frequent epoch wins; a tie goes to the oldest, which is the real
  // shutter release.
  let conflicts = 0;
  const fromSource = new Map(); // original_name -> Date
  for (const [name, votes] of seen) {
    if (votes.size > 1) conflicts++;
    let best = null;
    for (const [epoch, n] of votes) {
      if (!best || n > best[1] || (n === best[1] && epoch < best[0])) best = [epoch, n];
    }
    fromSource.set(name, epochToInstant(best[0]));
  }
  if (sources.length > 0) {
    logger.info?.(`files that contributed: ${filesUsed}`);
    logger.info?.(`pairs dropped for not existing in the database: ${droppedUnknown}`);
    logger.info?.(`photos with a time found in the sources: ${fromSource.size}`);
    logger.info?.(`photos the sources disagree about: ${conflicts}`);
  }

  // -------------------------------------------------------------------------
  // 2) Legacy index.db: the carry
  // -------------------------------------------------------------------------

  const fromIndex = new Map(); // original_name -> Date
  if (indexDb) {
    const idb = new Database(indexDb, { readonly: true, fileMustExist: true });
    try {
      const rows = idb
        .prepare('SELECT original_name, captured_at FROM photos WHERE captured_at IS NOT NULL')
        .all();
      for (const r of rows) {
        const target = inDb.get(r.original_name);
        if (!target || fromSource.has(r.original_name)) continue;
        // Already local wall clock: the origin converted the epoch before
        // storing it, so converting again would shift it a second time.
        const instant = localToInstant(r.captured_at, target.slug);
        if (instant) fromIndex.set(r.original_name, instant);
      }
    } finally {
      idb.close();
    }
    logger.info?.(`photos with a time carried from the legacy index.db: ${fromIndex.size}`);
  }

  // -------------------------------------------------------------------------
  // 3) The filename
  // -------------------------------------------------------------------------

  const fromFilename = new Map(); // original_name -> Date
  if (fromName) {
    for (const [name, target] of inDb) {
      if (fromSource.has(name) || fromIndex.has(name)) continue;
      const local = captureTimeFromName(name);
      const instant = local ? localToInstant(local, target.slug) : null;
      if (instant) fromFilename.set(name, instant);
    }
    logger.info?.(`photos with a time deduced from the filename: ${fromFilename.size}`);
  }

  /**
   * Final instant of one photo: source wins, the carry fills in, the name closes.
   *
   * @param {string} name - original_name
   * @returns {Date|null}
   */
  const timeOf = (name) =>
    fromSource.get(name) ?? fromIndex.get(name) ?? fromFilename.get(name) ?? null;

  // -------------------------------------------------------------------------
  // Report, then write
  // -------------------------------------------------------------------------

  const report = [];
  const toWrite = [];
  for (const p of projects) {
    const rows = byProject.get(p.slug);
    let source = 0;
    let carried = 0;
    let deduced = 0;
    let changing = 0;
    for (const r of rows) {
      const instant = timeOf(r.original_name);
      if (instant === null) continue;
      if (fromSource.has(r.original_name)) source++;
      else if (fromIndex.has(r.original_name)) carried++;
      else deduced++;
      const current = r.capture_date ? new Date(r.capture_date).getTime() : null;
      if (current !== instant.getTime()) {
        changing++;
        toWrite.push([r.id, instant.toISOString()]);
      }
    }
    const covered = source + carried + deduced;
    report.push({
      projeto: p.slug,
      fotos: rows.length,
      daFonte: source,
      doIndexDb: carried,
      doNome: deduced,
      cobertura: `${((100 * covered) / Math.max(rows.length, 1)).toFixed(0)}%`,
      aGravar: changing,
    });
  }

  if (dryRun) {
    return { report, totals: { aGravar: toWrite.length, gravadas: 0, relidas: null } };
  }

  let written = 0;
  for (let i = 0; i < toWrite.length; i += BATCH) {
    const chunk = toWrite.slice(i, i + BATCH);
    written += await tx((t) =>
      t.result(
        UPDATE_CAPTURE_DATE,
        [chunk.map((c) => c[0]), chunk.map((c) => c[1])],
        (r) => r.rowCount
      )
    );
  }

  // Verified by RE-READING the table, never by the return of the UPDATE.
  const { n } = await one(COUNT_WITH_CAPTURE_DATE, [projects.map((p) => p.id)]);
  logger.info?.(`written: ${written}`);
  logger.info?.(`re-read from Postgres: ${n} live photo(s) with capture_date`);

  return { report, totals: { aGravar: toWrite.length, gravadas: written, relidas: n } };
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
  const sources = (getArg('sources', '') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const indexDb = getArg('index-db', null);
  const fromName = argv.includes('--from-name');
  const slug = getArg('slug', null);
  const dryRun = argv.includes('--dry-run');

  if (sources.length === 0 && !indexDb && !fromName) {
    console.error(
      'Usage: node --env-file=.env scripts/sv360-import-captured-at.js \\\n' +
        '         [--sources "<dir>[,<dir>]"] [--index-db <path>] [--from-name] \\\n' +
        '         [--slug <slug>] [--dry-run]\n' +
        '\n' +
        '  --sources    survey metadata dirs: fotos.geojson (nome_img/time_img), *.csv\n' +
        '  --index-db   legacy SQLite index.db, column photos.captured_at (opened readonly)\n' +
        '  --from-name  deduce the time from the PIC_ filename (4 s timelapse cadence)\n'
    );
    process.exit(1);
  }

  importCapturedAt({ sources, indexDb, fromName, slug, dryRun })
    .then(async ({ report, totals }) => {
      console.table(report);
      console.log(`\nto write: ${totals.aGravar} photo(s)`);
      if (dryRun) console.log('Nothing was written (--dry-run).');
      else console.log(`written: ${totals.gravadas}; re-read: ${totals.relidas} with capture_date`);
      console.log('\nNow run scripts/sv360-derive-runs.js so the runs inherit started_at.');
      await pgp.end();
    })
    .catch(async (err) => {
      console.error('sv360-import-captured-at failed:', err?.message || err);
      await pgp.end();
      process.exit(1);
    });
}
