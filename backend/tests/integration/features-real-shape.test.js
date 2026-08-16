// Path: tests/integration/features-real-shape.test.js
// Integration tests asserting that a feature-create op carrying the REAL frontend
// GeoJSON feature shape persists correctly for EVERY feature type.
//
// The real shape (from tests/helpers/real-fixtures.js, shared verbatim with the
// frontend producer tests) carries gotchas that minimal constructed fixtures lacked
// and that let a real bug through:
//   - a NUMERIC top-level GeoJSON `id` (MapLibre/tool assigned) that must NOT become
//     the row id, since the row id is the op's targetId;
//   - `properties.id` = the canonical UUID;
//   - `properties.source` = the type (backend derives feature_type from it);
//   - `properties.layerId` = 'default' (implicit-layer sentinel, a NON-UUID that must
//     coerce to null on features.layer_id, a UUID column, while staying verbatim in
//     the properties JSONB).
//
// All feature writes go through POST /atlas/:id/sync (no REST write routes exist).
//
// WHAT "EVERY" MEANS HERE, AND WHY IT IS NOT A NUMBER ANY MORE.
// This file used to open with `assert.equal(ALL_FEATURE_SOURCES.length, 18)` over a
// hand-written fixture, and both were wrong in the same direction: the CHECK, the Joi
// allowlist and the client all carried 20. A literal count does not detect that, it
// FREEZES it, and the case name announced the wrong number to anyone reading the green.
// The sweep is now pinned from two ends, each with its own diagnosis:
//
//   - the fixture DERIVES its list from the Joi allowlist (see that file's header);
//   - this file asks the LIVE database what its CHECK accepts and requires the sweep to
//     cover all of it. A type the database accepts and the sweep skips is a type nobody
//     ever pushed through the real shape.
//
// The other direction is not read, it is EXERCISED: every swept type is pushed through
// POST /sync, so a type in Joi that the database refuses fails on its own missing ack.
// Together the two make the parity exact, and neither can be satisfied by a count.
//
// (`tests/integration/tipos-feicao-constraint-viva.test.js` also queries the live CHECK,
// for a different question: it inserts rows DIRECTLY and asks whether the snapshot and
// the import Joi carry every accepted type. This file is the sync WRITE path, with the
// real tool-emitted envelope. Neither subsumes the other.)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import { realFeature, ALL_FEATURE_SOURCES, extractJoiFeatureTypes } from '../helpers/real-fixtures.js';

/** Pulls the quoted literals out of a rendered CHECK expression. */
function literalsIn(expr) {
  return [...expr.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** Types this repository has already lost once from a list that claimed to be complete. */
const TIPOS_QUE_JA_FALTARAM = ['sector', 'magnetic_declination', 'processed_los', 'processed_visibility'];

describe('Features — real frontend shape via Sync API', () => {
  let app, db, user, token, atlasId, mapId, aceitosPeloBanco;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db);
    token = await loginUser(app, user.username, user.password);
    const atlas = await createAtlas(db, user.id);
    const map = await createMap(db, atlas.id);
    atlasId = atlas.id;
    mapId = map.id;

    // The live CHECK, not the committed .sql: what the database RUNNING these tests accepts.
    const { rows } = await db.query(`
      SELECT pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE t.relname = 'features'
         AND n.nspname = 'public'
         AND c.contype = 'c'
         AND pg_get_constraintdef(c.oid) ILIKE '%feature_type%'
    `);
    assert.equal(rows.length, 1, 'exactly one CHECK must govern features.feature_type');
    aceitosPeloBanco = literalsIn(rows[0].def);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /**
   * Pushes a single create op carrying the real feature shape for `source` and
   * asserts the persisted row. Returns the row for any extra per-type assertions.
   */
  async function createRealFeature(source) {
    const targetId = randomUUID();
    // realFeature sets properties.id === targetId and leaves the numeric top-level id.
    const data = realFeature(source, { id: targetId });

    // Sanity-check the fixture is actually the "real" shape (these are the gotchas).
    assert.equal(data.id, 1782053337250, `${source}: fixture keeps the numeric top-level GeoJSON id`);
    assert.equal(data.properties.id, targetId, `${source}: properties.id is the canonical UUID`);
    assert.equal(data.properties.source, source, `${source}: properties.source carries the type`);
    assert.equal(data.properties.layerId, 'default', `${source}: properties.layerId is the 'default' sentinel`);

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlasId}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        operations: [{
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId,
          mapId,
          data,
          timestamp: Date.now(),
          clientId: 'test-client',
        }],
      })
      .expect(200);

    assert.equal(res.body.data.acks.length, 1, `${source}: op was acked`);

    const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
    assert.equal(rows.length, 1, `${source}: feature row persisted`);

    const row = rows[0];
    assert.equal(row.id, targetId, `${source}: row id is the targetId (NOT the numeric top-level GeoJSON id)`);
    assert.notEqual(row.id, String(data.id), `${source}: row id is NOT the numeric top-level id`);
    assert.equal(row.feature_type, source, `${source}: feature_type derived from properties.source`);
    assert.equal(row.layer_id, null, `${source}: non-UUID 'default' layerId coerced to null on the row`);
    assert.equal(row.properties.layerId, 'default', `${source}: layerId preserved verbatim in the properties JSONB`);
    assert.equal(row.properties.id, targetId, `${source}: properties.id preserved as the canonical UUID`);

    return row;
  }

  it('the sweep covers every type the LIVE database accepts', () => {
    // FLOOR FIRST, with its own message: without it, the day either reader breaks the
    // report would read "the lists diverged" when the truth is "the extraction stopped
    // working", which is the opposite diagnosis.
    assert.ok(
      ALL_FEATURE_SOURCES.length > 0,
      'the fixture derived NO feature type: read real-fixtures.js, the anchor broke',
    );
    assert.ok(
      aceitosPeloBanco.length > 0,
      'no type literal parsed from the live CHECK: the READER broke, the lists did not diverge',
    );

    // ABSOLUTE, beside the comparative check below: two copies wrong in the same way agree
    // with each other, and these four are precisely the ones this repository has lost before.
    assert.equal(TIPOS_QUE_JA_FALTARAM.length, 4, 'the absolute spot-check list is not empty');
    for (const tipo of TIPOS_QUE_JA_FALTARAM) {
      assert.ok(
        ALL_FEATURE_SOURCES.includes(tipo),
        `the sweep lost '${tipo}': it announces "every type" over a subset again`,
      );
    }

    const naoVarridos = aceitosPeloBanco.filter((t) => !ALL_FEATURE_SOURCES.includes(t)).sort();
    assert.deepEqual(
      naoVarridos, [],
      'types the live database ACCEPTS and this sweep never pushes through the real shape. '
      + 'Nobody has ever proved they persist. Widen VALID_FEATURE_TYPES in '
      + 'src/modules/atlas/atlas.schemas.js (which is what the fixture derives from), or explain '
      + 'in this file why the database accepts a type the API does not',
    );
  });

  it('persists the real shape for every feature type', async () => {
    // The other half of the parity, exercised rather than read: a type in the fixture that
    // the database refuses fails on its own missing ack inside createRealFeature.
    assert.ok(ALL_FEATURE_SOURCES.length > 0, 'floor: the sweep would iterate zero times');
    for (const source of ALL_FEATURE_SOURCES) {
      await createRealFeature(source);
    }
  });

  // A couple of explicit cases for readability / quick triage if the loop ever breaks.
  it('persists a real line feature', async () => {
    const row = await createRealFeature('line');
    assert.equal(row.geometry.type, 'LineString', 'line geometry round-trips');
    assert.ok(Array.isArray(row.geometry.coordinates), 'line keeps its coordinates array');
    assert.equal(row.properties.source, 'line', 'source preserved in properties');
  });

  it('persists a real military_symbol feature (SIDC preserved)', async () => {
    const row = await createRealFeature('military_symbol');
    assert.equal(row.feature_type, 'military_symbol', 'military_symbol survives the CHECK constraint');
    assert.equal(row.properties.sidc, 'SFGPUCI-----', 'SIDC preserved verbatim in properties');
    assert.equal(row.geometry.type, 'Point', 'military_symbol geometry round-trips');
  });
});

describe('ALL_FEATURE_SOURCES — positive control for the derivation (synthetic source)', () => {
  // The sweep above is green over correct code, which makes it indistinguishable from a
  // blind sweep until someone proves the reader can SEE. These cases run the REAL extractor
  // over synthetic source text on every run, so the proof never expires.

  const JOI_FALSO = `
    const VALID_FEATURE_TYPES = [
      // Basic
      'point', 'line',
      // Shapes
      'sector',
    ];
    const OUTRA_LISTA = ['fora_da_fatia'];
  `;

  it('reads the shape it is pointed at, and stops at the end of that list', () => {
    assert.deepEqual(extractJoiFeatureTypes(JOI_FALSO), ['point', 'line', 'sector']);
  });

  it('sees a type removed from the list', () => {
    // Exactly the defect this file was fixed for, in miniature: one type quietly missing.
    assert.deepEqual(extractJoiFeatureTypes(JOI_FALSO.replace("'sector',", '')), ['point', 'line']);
  });

  it('yields NOTHING when the anchor is gone, which is what the module-load floor is for', () => {
    assert.deepEqual(extractJoiFeatureTypes("const OUTRO_NOME = ['point'];"), []);
    assert.deepEqual(extractJoiFeatureTypes('const VALID_FEATURE_TYPES = new Map();'), []);
  });
});
