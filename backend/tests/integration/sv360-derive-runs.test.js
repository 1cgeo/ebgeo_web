// Path: tests/integration/sv360-derive-runs.test.js
// StreetView 360 — the CAPTURE RUN derivation (scripts/sv360-derive-runs.js)
// against a real Postgres, on a synthetic project built row by row.
//
// The grouping arithmetic itself is covered by tests/unit/sv360-capture-runs.test.js.
// What only an integration test can prove is everything the arithmetic touches on
// the way to the table, and each case below exists because getting it wrong is
// silent rather than loud:
//
//   - THE ORDERING TRAP the origin recorded: photos.run_id references
//     capture_runs(id), so a second pass that deletes runs before releasing the
//     references dies on the foreign key. The first pass passes either way,
//     because run_id is still all NULL — so only a RERUN can catch it.
//   - IDEMPOTENCY DOWN TO THE IDS, not just to the counts. The origin mints a
//     fresh randomUUID per run per pass; here the upsert keeps the row, and the
//     whole point is that a rerun leaves the same ids for anything holding a
//     reference to a run.
//   - `applied_rotation_*` SURVIVING a re-derivation: it is the record of the
//     last default a reviewer applied, and re-deriving must not erase the work.
//   - A SOFT-DELETED photo staying out of the count, or the run's photo_count and
//     the review progress bar inflate.
//   - A VANISHED SESSION losing its run, without taking the neighbours with it.
//   - `byFloor`, which is chosen by the EXISTENCE of sv360.project_floors rows
//     and never by a flag.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { deriveRuns } from '../../scripts/sv360-derive-runs.js';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SLUG = 'proj-derive-runs';
const SLUG_FLOORS = 'proj-derive-runs-floors';
const PID = '7d1f0c22-9a63-4f5e-8b41-0c2e7a95d310';
const PID_FLOORS = '2b8c4e77-15da-4a90-9c36-8fe1d0b47a52';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

// Photo ids are the deterministic UUID the corpus already carries; here they are
// fixed literals so an assertion can name a photo instead of looking it up.
const A1 = 'aaaa0001-0000-4000-8000-000000000001';
const A2 = 'aaaa0002-0000-4000-8000-000000000002';
const A3 = 'aaaa0003-0000-4000-8000-000000000003';
const A4 = 'aaaa0004-0000-4000-8000-000000000004';
const B1 = 'bbbb0001-0000-4000-8000-000000000001';
const B2 = 'bbbb0002-0000-4000-8000-000000000002';
const C1 = 'cccc0001-0000-4000-8000-000000000001';
const X1 = 'xxxx0001-0000-4000-8000-000000000001';
const F0 = 'ffff0000-0000-4000-8000-000000000000';
const F1 = 'ffff0001-0000-4000-8000-000000000001';
const F2 = 'ffff0002-0000-4000-8000-000000000002';

// Two MULTICAPTURA sessions of different sizes plus one PIC_ session, so the
// size-ordered branch has no tie to resolve and the assertion on `ordinal` means
// something.
const PHOTOS = [
  [A1, PID, 'MULTICAPTURA_1000_000001', 1],
  [A2, PID, 'MULTICAPTURA_1000_000003', 2],
  [A3, PID, 'MULTICAPTURA_1000_000005', 3],
  [A4, PID, 'MULTICAPTURA_1000_000007', 4], // soft-deleted below
  [B1, PID, 'MULTICAPTURA_2000_000001', 5],
  [B2, PID, 'MULTICAPTURA_2000_000003', 6],
  [C1, PID, 'PIC_20260101_080000_26_01_01_09_00_00_output_1', 7],
  [X1, PID, 'ARQUIVO_SEM_PADRAO_001', 8], // no rule matches: stays without a run
];

// The indoor project: one photo on the ground floor, two on the first, all of
// them single-shot names — the pattern that would otherwise give one run PER
// PHOTO, which is exactly why byFloor exists.
const PHOTOS_FLOORS = [
  [F0, PID_FLOORS, 'PIC_20260520_104137_20260521163900', 1, 0],
  [F1, PID_FLOORS, 'PIC_20260520_110000_20260521163901', 2, 1],
  [F2, PID_FLOORS, 'PIC_20260520_110400_20260521163902', 3, 1],
];

describe('StreetView 360 — derive capture runs', () => {
  let db;

  const runsOf = async (projectId) =>
    (
      await db.query(
        `SELECT id, session_key, label, started_at, ordinal, photo_count,
                applied_rotation_y
         FROM sv360.capture_runs WHERE project_id = $1 ORDER BY ordinal`,
        [projectId]
      )
    ).rows;

  const photosOf = async (projectId) =>
    (
      await db.query(
        `SELECT id, original_name, run_id, run_position
         FROM sv360.photos WHERE project_id = $1 ORDER BY sequence_number`,
        [projectId]
      )
    ).rows;

  before(async () => {
    ({ db } = await setupTestEnv());

    for (const [id, slug] of [
      [PID, SLUG],
      [PID_FLOORS, SLUG_FLOORS],
    ]) {
      await db.query(
        `INSERT INTO sv360.projects (id, organization_id, slug, name, db_filename)
         VALUES ($1, $2, $3, $3, $3 || '.db')`,
        [id, ORG_ID, slug]
      );
    }

    for (const [id, pid, name, seq] of PHOTOS) {
      await db.query(
        `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
         VALUES ($1, $2, $3, $4, -30.0, -51.2)`,
        [id, pid, name, seq]
      );
    }
    for (const [id, pid, name, seq, level] of PHOTOS_FLOORS) {
      await db.query(
        `INSERT INTO sv360.photos
           (id, project_id, original_name, sequence_number, lat, lon, floor_level)
         VALUES ($1, $2, $3, $4, -30.0, -51.2, $5)`,
        [id, pid, name, seq, level]
      );
    }
    // The tombstone, not a hard delete: the photo row stays and must be ignored.
    await db.query('INSERT INTO sv360.deleted_photos (photo_id) VALUES ($1)', [A4]);

    // Declaring floors is what turns the second project into an indoor one.
    await db.query(
      `INSERT INTO sv360.project_floors (project_id, level, label)
       VALUES ($1, 0, 'Externo'), ($1, 1, '1º andar')`,
      [PID_FLOORS]
    );
  });

  after(async () => {
    // run_id first: photos reference capture_runs, and the cascade from projects
    // has no defined order to rely on.
    await db.query('UPDATE sv360.photos SET run_id = NULL WHERE project_id = ANY($1)', [
      [PID, PID_FLOORS],
    ]);
    await db.query('DELETE FROM sv360.deleted_photos WHERE photo_id = ANY($1)', [[A4]]);
    await db.query('DELETE FROM sv360.photos WHERE project_id = ANY($1)', [[PID, PID_FLOORS]]);
    await db.query('DELETE FROM sv360.capture_runs WHERE project_id = ANY($1)', [
      [PID, PID_FLOORS],
    ]);
    await db.query('DELETE FROM sv360.project_floors WHERE project_id = ANY($1)', [
      [PID, PID_FLOORS],
    ]);
    await db.query('DELETE FROM sv360.projects WHERE id = ANY($1)', [[PID, PID_FLOORS]]);
    await teardownTestEnv(db);
  });

  it('a dry run reports the runs and writes nothing', async () => {
    const { report } = await deriveRuns({ slug: SLUG, dryRun: true, logger: silent });
    assert.equal(report.length, 1);
    assert.equal(report[0].fotos, 7); // 8 rows minus the tombstoned one
    assert.equal(report[0].faixas, 3);
    assert.equal(report[0].semFaixa, 1);

    const runs = await runsOf(PID);
    assert.equal(runs.length, 0);
  });

  it('groups by session id, orders by size when no run has a time, and numbers the photos', async () => {
    const { report } = await deriveRuns({ slug: SLUG, logger: silent });
    assert.equal(report[0].ordem, 'tamanho');

    const runs = await runsOf(PID);
    assert.equal(runs.length, 3);
    assert.deepEqual(
      runs.map((r) => [r.session_key, r.ordinal, r.photo_count]),
      [
        ['mc:1000', 1, 3],
        ['mc:2000', 2, 2],
        ['ts:2026-01-01T08:00:00', 3, 1],
      ]
    );
    // The label is the short one the sidebar shows, not the namespaced key.
    assert.deepEqual(
      runs.map((r) => r.label),
      ['1000', '2000', '08:00:00']
    );
    // Only the PIC_ name carries a time; the MULTICAPTURA id is opaque and has
    // no capture_date to inherit from yet.
    assert.equal(runs[0].started_at, null);
    assert.equal(runs[1].started_at, null);
    assert.equal(runs[2].started_at.toISOString(), '2026-01-01T11:00:00.000Z');

    const photos = await photosOf(PID);
    const byId = new Map(photos.map((p) => [p.id, p]));
    assert.equal(byId.size, 8);
    // Frame order inside the run, 1..N with no gap.
    assert.deepEqual(
      [A1, A2, A3].map((id) => byId.get(id).run_position),
      [1, 2, 3]
    );
    assert.equal(byId.get(A1).run_id, runs[0].id);
    assert.equal(byId.get(A3).run_id, runs[0].id);
    // The tombstoned photo and the unrecognised name stay out.
    assert.equal(byId.get(A4).run_id, null);
    assert.equal(byId.get(A4).run_position, null);
    assert.equal(byId.get(X1).run_id, null);
  });

  it('is idempotent down to the run ids, and the rerun does not hit the foreign key', async () => {
    const before = { runs: await runsOf(PID), photos: await photosOf(PID) };
    assert.equal(before.runs.length, 3);

    await deriveRuns({ slug: SLUG, logger: silent });

    assert.deepEqual(await runsOf(PID), before.runs);
    assert.deepEqual(await photosOf(PID), before.photos);
  });

  it('preserves applied_rotation_* across a re-derivation', async () => {
    await db.query(
      `UPDATE sv360.capture_runs SET applied_rotation_y = 337.5
       WHERE project_id = $1 AND session_key = 'mc:1000'`,
      [PID]
    );

    await deriveRuns({ slug: SLUG, logger: silent });

    const runs = await runsOf(PID);
    assert.equal(runs.length, 3);
    assert.equal(Number(runs[0].applied_rotation_y), 337.5);
  });

  it('orders the runs chronologically once every one of them has a time', async () => {
    // mc:2000 at 07h, the PIC_ session at 08h (from its own name), mc:1000 at 09h.
    const stamps = [
      [B1, '2026-01-01T10:00:00Z'],
      [B2, '2026-01-01T10:00:04Z'],
      [C1, '2026-01-01T11:00:00Z'],
      [A1, '2026-01-01T12:00:00Z'],
      [A2, '2026-01-01T12:00:04Z'],
      [A3, '2026-01-01T12:00:08Z'],
    ];
    assert.ok(stamps.length > 0);
    for (const [id, ts] of stamps) {
      await db.query('UPDATE sv360.photos SET capture_date = $2 WHERE id = $1', [id, ts]);
    }

    const { report } = await deriveRuns({ slug: SLUG, logger: silent });
    assert.equal(report[0].ordem, 'cronologica');

    const runs = await runsOf(PID);
    assert.deepEqual(
      runs.map((r) => r.session_key),
      ['mc:2000', 'ts:2026-01-01T08:00:00', 'mc:1000']
    );
    // The run without a time in its NAME inherits the OLDEST capture_date of its
    // own photos — one dated photo per run is enough.
    assert.equal(runs[0].started_at.toISOString(), '2026-01-01T10:00:00.000Z');
    assert.equal(runs[2].started_at.toISOString(), '2026-01-01T12:00:00.000Z');
  });

  it('drops the run of a session that vanished, and leaves the others alone', async () => {
    const before = await runsOf(PID);
    const kept = before.filter((r) => r.session_key !== 'mc:2000').map((r) => r.id);
    assert.equal(kept.length, 2);

    await db.query('UPDATE sv360.photos SET run_id = NULL WHERE id = ANY($1)', [[B1, B2]]);
    await db.query('DELETE FROM sv360.photos WHERE id = ANY($1)', [[B1, B2]]);

    await deriveRuns({ slug: SLUG, logger: silent });

    const runs = await runsOf(PID);
    assert.equal(runs.length, 2);
    assert.equal(
      runs.some((r) => r.session_key === 'mc:2000'),
      false
    );
    assert.deepEqual(runs.map((r) => r.id).sort(), kept.sort());
  });

  it('groups by floor when the project declares floors, from the ground up', async () => {
    const { report } = await deriveRuns({ slug: SLUG_FLOORS, logger: silent });
    assert.equal(report[0].ordem, 'andar');
    assert.equal(report[0].semFaixa, 0);

    const runs = await runsOf(PID_FLOORS);
    assert.deepEqual(
      runs.map((r) => [r.session_key, r.label, r.ordinal, r.photo_count]),
      [
        ['fl:0', 'Externo', 1, 1],
        ['fl:1', '1º andar', 2, 2],
      ]
    );

    // The label comes from sv360.project_floors, so every photo of a level shows
    // the level's name even when the photos carry different floor_labels.
    const photos = await photosOf(PID_FLOORS);
    assert.equal(photos.length, 3);
    assert.deepEqual(
      photos.map((p) => p.run_position),
      [1, 1, 2]
    );
  });

  it('refuses a slug that does not exist instead of touching every project', async () => {
    await assert.rejects(
      () => deriveRuns({ slug: 'projeto-que-nao-existe', logger: silent }),
      /not found/
    );
  });
});
