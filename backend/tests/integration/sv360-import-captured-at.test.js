// Path: tests/integration/sv360-import-captured-at.test.js
// StreetView 360 — the CAPTURE TIME import (scripts/sv360-import-captured-at.js)
// against a real Postgres, with a synthetic survey source tree and a synthetic
// legacy index.db in a tmp dir.
//
// WHAT IS AT STAKE, and why each case is here. The hour is what the solar
// calibration fits against, so a wrong hour does not fail — it produces a
// DIFFERENT wrong rotation per session, with a low residual, which is how the
// origin lost it in silence (commit e2fb591). The three cases that decide it:
//
//   - THE EPOCH IS NOT UTC. The survey `time_img` needs the measured -3 h skew
//     before it is an instant. Asserting the stored value against a hand-computed
//     instant is the only thing that pins it.
//   - PRECEDENCE. Source beats the legacy carry beats the filename. The same
//     photo is planted in all three on purpose, with three different times, so a
//     silent reordering of the fallbacks shows up as a wrong instant.
//   - THE DESTINATION IS `capture_date`, not `captured_at`. The origin's column
//     name does not exist here (migration 013 says why); the translation is this
//     script's job, and a port that recreated the column would pass every other
//     assertion.
//
// Plus the two quiet ones: a soft-deleted photo must not be written, and a second
// pass must write nothing at all.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { importCapturedAt } from '../../scripts/sv360-import-captured-at.js';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SLUG = 'proj-captured-at';
const PID = '5e9a1c40-7b82-4d16-9f03-3a6c8b2e51d4';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

const G1 = 'MULTICAPTURA_3000_000001'; // survey source only
const I1 = 'MULTICAPTURA_3000_000003'; // legacy index.db only
const N1 = 'PIC_20260101_080000_26_01_01_09_00_00_output_5'; // filename only
const D1 = 'MULTICAPTURA_3000_000005'; // all three disagree: the source must win
const Z1 = 'MULTICAPTURA_3000_000007'; // nowhere: stays NULL
const T1 = 'MULTICAPTURA_3000_000009'; // in the source, but soft-deleted

const id = (n) => `dddd000${n}-0000-4000-8000-00000000000${n}`;
const IDS = { [G1]: id(1), [I1]: id(2), [N1]: id(3), [D1]: id(4), [Z1]: id(5), [T1]: id(6) };

// Written as the survey writes it. The instant is three hours EARLIER, and that
// gap is the whole point of the assertion.
const epoch = (iso) => Math.trunc(Date.parse(iso) / 1000);
const AS_WRITTEN_G1 = epoch('2026-01-01T12:00:00Z');
const AS_WRITTEN_D1_A = epoch('2026-01-01T12:00:00Z');
const AS_WRITTEN_D1_B = epoch('2026-01-01T13:00:00Z');
const AS_WRITTEN_T1 = epoch('2026-01-01T14:00:00Z');

describe('StreetView 360 — import capture time', () => {
  let db, tmpRoot, sourceDir, indexDbPath;

  const captureDates = async () => {
    const { rows } = await db.query(
      `SELECT original_name, capture_date FROM sv360.photos
       WHERE project_id = $1 ORDER BY sequence_number`,
      [PID]
    );
    return new Map(rows.map((r) => [r.original_name, r.capture_date]));
  };

  before(async () => {
    ({ db } = await setupTestEnv());

    tmpRoot = path.join(os.tmpdir(), `sv360-captured-at-${process.pid}`);
    // Nested on purpose: the origin lost a whole project to a depth limit of 6,
    // with no error at all.
    sourceDir = path.join(tmpRoot, 'acervo', 'missao', 'streetview', 'Metadados');
    mkdirSync(sourceDir, { recursive: true });
    indexDbPath = path.join(tmpRoot, 'index.db');

    writeFileSync(
      path.join(sourceDir, 'fotos.geojson'),
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { properties: { nome_img: G1, time_img: AS_WRITTEN_G1 } },
          { properties: { nome_img: D1, time_img: AS_WRITTEN_D1_A } },
          { properties: { nome_img: T1, time_img: AS_WRITTEN_T1 } },
          { properties: { nome_img: 'FOTO_QUE_NAO_ESTA_NO_BANCO', time_img: AS_WRITTEN_G1 } },
          { properties: { nome_img: G1, time_img: 0 } }, // outside the window: junk
        ],
      })
    );
    // A second source that disagrees about D1. Each value appears once, so the
    // tie goes to the OLDEST, which is the real shutter release. The quoted
    // field is there to exercise the CSV splitter.
    writeFileSync(
      path.join(sourceDir, 'pontos.csv'),
      `nome_img,time_img,obs\n"${D1}",${AS_WRITTEN_D1_B},"linha, com virgula"\n`
    );

    const idb = new Database(indexDbPath);
    idb.exec('CREATE TABLE photos (original_name TEXT, captured_at TEXT)');
    const ins = idb.prepare('INSERT INTO photos (original_name, captured_at) VALUES (?, ?)');
    // Local wall clock, as the origin stores it: it must NOT be converted again.
    ins.run(I1, '2026-01-01T07:30:00');
    ins.run(D1, '2026-01-01T20:00:00'); // must lose to the survey source
    ins.run('FOTO_QUE_NAO_ESTA_NO_BANCO', '2026-01-01T07:30:00');
    idb.close();

    await db.query(
      `INSERT INTO sv360.projects (id, organization_id, slug, name, db_filename)
       VALUES ($1, $2, $3, $3, $3 || '.db')`,
      [PID, ORG_ID, SLUG]
    );
    const names = [G1, I1, N1, D1, Z1, T1];
    assert.equal(names.length, 6);
    for (let i = 0; i < names.length; i++) {
      await db.query(
        `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
         VALUES ($1, $2, $3, $4, -30.0, -51.2)`,
        [IDS[names[i]], PID, names[i], i + 1]
      );
    }
    await db.query('INSERT INTO sv360.deleted_photos (photo_id) VALUES ($1)', [IDS[T1]]);
  });

  after(async () => {
    await db.query('DELETE FROM sv360.deleted_photos WHERE photo_id = $1', [IDS[T1]]);
    await db.query('DELETE FROM sv360.photos WHERE project_id = $1', [PID]);
    await db.query('DELETE FROM sv360.projects WHERE id = $1', [PID]);
    await teardownTestEnv(db);
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('refuses to run with no source at all', async () => {
    await assert.rejects(() => importCapturedAt({ slug: SLUG, logger: silent }), /No source given/);
  });

  it('a dry run reports the coverage and writes nothing', async () => {
    const { report, totals } = await importCapturedAt({
      sources: [tmpRoot],
      indexDb: indexDbPath,
      fromName: true,
      slug: SLUG,
      dryRun: true,
      logger: silent,
    });
    assert.equal(report.length, 1);
    assert.equal(report[0].fotos, 5); // 6 rows minus the tombstoned one
    assert.equal(report[0].daFonte, 2); // G1 and D1
    assert.equal(report[0].doIndexDb, 1); // I1
    assert.equal(report[0].doNome, 1); // N1
    assert.equal(report[0].cobertura, '80%');
    assert.equal(totals.aGravar, 4);
    assert.equal(totals.gravadas, 0);

    const dates = await captureDates();
    assert.equal(dates.get(G1), null);
  });

  it('writes the instant, correcting the measured skew of the source epoch', async () => {
    const { totals } = await importCapturedAt({
      sources: [tmpRoot],
      indexDb: indexDbPath,
      fromName: true,
      slug: SLUG,
      logger: silent,
    });
    assert.equal(totals.gravadas, 4);
    // Re-read from Postgres, not from the return of the UPDATE.
    assert.equal(totals.relidas, 4);

    const dates = await captureDates();
    // Source epoch written as 12:00Z is really 09:00Z.
    assert.equal(dates.get(G1).toISOString(), '2026-01-01T09:00:00.000Z');
    // Legacy carry: local wall clock 07:30 at UTC-3 is 10:30Z, converted once.
    assert.equal(dates.get(I1).toISOString(), '2026-01-01T10:30:00.000Z');
    // From the name: 08:00:00 local plus frame 5 at the 4 s timelapse cadence.
    assert.equal(dates.get(N1).toISOString(), '2026-01-01T11:00:20.000Z');
  });

  it('lets the survey source beat the legacy carry, and the oldest break a tie', async () => {
    const dates = await captureDates();
    // The index.db says 20:00 local (23:00Z) and the CSV says 13:00Z as written;
    // the geojson's 12:00Z as written is both a source and the older of the two
    // tied sources, so 09:00Z is the only value that can be right here.
    assert.equal(dates.get(D1).toISOString(), '2026-01-01T09:00:00.000Z');
  });

  it('leaves a photo no source knows about, and a soft-deleted one, untouched', async () => {
    const dates = await captureDates();
    assert.equal(dates.get(Z1), null);
    assert.equal(dates.get(T1), null);
  });

  it('writes nothing on a second pass', async () => {
    const { totals } = await importCapturedAt({
      sources: [tmpRoot],
      indexDb: indexDbPath,
      fromName: true,
      slug: SLUG,
      logger: silent,
    });
    assert.equal(totals.aGravar, 0);
    assert.equal(totals.gravadas, 0);
    assert.equal(totals.relidas, 4);
  });
});
