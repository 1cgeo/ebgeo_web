// Path: tests/integration/tipos-feicao-constraint-viva.test.js
//
// THE LIVE CONSTRAINT, NOT THE COMMITTED SQL.
//
// The feature-type list exists in four copies (client allowlist, Joi, the CHECK, and the
// snapshot's `typeToCollection`). Their parity is asserted from TEXT by
// `frontend/tests/unit/tipos-feicao-paridade-pacotes.test.js`, and two of the four are tied by
// `tests/unit/snapshot-tipos-vs-check.test.js`. Both read files. Neither can answer the one
// question that decides whether a deploy is safe: **what does the database that is actually
// running accept?**
//
// That question has its own failure mode, and it is a deploy-order failure, not a code failure.
// Migrations are forward-only and are a SEPARATE step from starting the server
// (`docs/wiki/deploy-backend.md`): a client published before its migration ran meets a CHECK that
// is one type behind, and the divergence exists in production while every file in the repository
// agrees with every other. Only `pg_get_constraintdef` on the live catalog sees it.
//
// So this file asks the database and then checks the two things the database cannot check itself:
//
//   1. every type the LIVE database accepts round-trips into `getAtlasSnapshot`. This is the
//      silent one: a type the CHECK allows and `typeToCollection` forgets is WRITTEN and never
//      appears in any snapshot. Nobody sees it, nothing errors, the server acks the op;
//   2. every type the LIVE database accepts is accepted by the import Joi, so a `.ebgeo` carrying
//      it is not rejected wholesale with a 400.
//
// Both are exercised, not read: real rows, real snapshot, real Joi validation. And both carry a
// positive control (a type the DB does not know must be REFUSED by each layer), because a gate
// that accepts everything would make an "everything passes" assertion green while measuring
// nothing.
//
// FLOOR FIRST, ALWAYS. The literal-extraction runs before any comparison and asserts it found
// something. Without it, the day the CHECK is renamed the report would read "the lists diverged"
// when the truth is "the reader stopped working".
//
// Modelled on `tests/integration/permission-levels-invariant.test.js`, which does the same thing
// for the permission ladder.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createFeature } from '../helpers/fixtures.js';
import { getAtlasSnapshot } from '../../src/modules/sync/sync.service.js';
import { importSchema } from '../../src/modules/atlas/atlas.schemas.js';

/** Pulls the quoted literals out of a rendered CHECK expression. */
function literalsIn(expr) {
  return [...expr.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** A type name the list must never contain, used as the positive control at every layer. */
const TIPO_INEXISTENTE = 'tipo_que_o_banco_nao_conhece';

/** Types this repository has already lost once, spot-checked absolutely rather than by comparison. */
const TIPOS_QUE_JA_FALTARAM = ['sector', 'magnetic_declination', 'processed_los', 'processed_visibility'];

describe('feature types: the LIVE CHECK against the code that is deployed with it', () => {
  let db, atlasId, mapId, checkExpr, aceitos, feicaoDeOutroAtlas;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;

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
    checkExpr = rows[0].def;
    aceitos = literalsIn(checkExpr);

    const user = await createUser(db);
    const atlas = await createAtlas(db, user.id);
    const map = await createMap(db, atlas.id);
    atlasId = atlas.id;
    mapId = map.id;

    // A feature of a perfectly valid type living in ANOTHER atlas, used as the in-case positive
    // control below: it must NOT show up in this atlas's snapshot.
    const outroAtlas = await createAtlas(db, user.id);
    const outroMapa = await createMap(db, outroAtlas.id);
    feicaoDeOutroAtlas = await createFeature(db, outroMapa.id, { feature_type: 'point' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('FLOOR: the live constraint was read, and it is the whole list', () => {
    // Two separate statements, because they have OPPOSITE diagnoses and merging them makes the
    // report lie: "nothing parsed" is a broken reader, "parsed fewer than the list" is a real
    // database that is behind. The first version of this case said "the reader broke" for both.
    assert.ok(
      aceitos.length > 0,
      `no type literal parsed from the live CHECK (${checkExpr}) — the READER broke, the lists `
      + 'did not diverge',
    );

    // Absolute, not merely comparative: the four types this repository has already lost once must
    // be in the LIVE database, whatever the committed SQL says.
    assert.equal(TIPOS_QUE_JA_FALTARAM.length, 4, 'the absolute spot-check list is not empty');
    for (const tipo of TIPOS_QUE_JA_FALTARAM) {
      assert.ok(
        aceitos.includes(tipo),
        `the LIVE database does not accept '${tipo}' — a client that draws it writes nothing`,
      );
    }

    assert.ok(
      aceitos.length >= 20,
      `the live CHECK accepts only ${aceitos.length} types: either the migration that widens it `
      + 'has not run on THIS database (deploy skew — the whole reason this file queries the '
      + `catalog instead of reading the .sql), or a type was dropped from 003_atlas.sql. ${checkExpr}`,
    );
    assert.equal(new Set(aceitos).size, aceitos.length, 'the live CHECK repeats a type');
  });

  it('the live CHECK really bites (positive control)', async () => {
    // Without this, everything below could be describing a constraint that no longer refuses
    // anything, and "every accepted type works" would be a statement about nothing.
    await assert.rejects(
      () => db.query(
        `INSERT INTO features (map_id, feature_type, geometry, properties)
         VALUES ($1, $2, '{}'::jsonb, '{}'::jsonb)`,
        [mapId, TIPO_INEXISTENTE],
      ),
      (err) => err.code === '23514',
      'a type outside the CHECK must be refused by the database itself',
    );
  });

  it('every type the live database accepts comes back out in the snapshot', async () => {
    // The silent failure this whole item exists for: written, acked, and invisible forever.
    const esperado = new Map();
    for (const tipo of aceitos) {
      const linha = await createFeature(db, mapId, {
        feature_type: tipo,
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { source: tipo },
      });
      esperado.set(linha.id, tipo);
    }
    assert.equal(esperado.size, aceitos.length, 'one row per accepted type was inserted');
    assert.ok(esperado.size > 0, 'floor: the insert loop did not run over an empty list');

    const snapshot = await getAtlasSnapshot(atlasId);
    const mapa = snapshot.maps.find((m) => m.id === mapId);
    assert.ok(mapa, 'the seeded map is in the snapshot');

    const vistos = new Set();
    for (const balde of Object.values(mapa.features)) {
      for (const f of balde) vistos.add(f.properties.id);
    }
    // Floor, and deliberately NOT `vistos.size >= esperado.size`: a count comparison fires before
    // the named list below and reports "19 of 20" where the useful answer is WHICH type vanished.
    assert.ok(
      vistos.size > 0,
      'the snapshot delivered no features at all — the bucket walk broke, the lists did not diverge',
    );

    // Positive control, in the same case: `vistos` must be what THIS snapshot delivered, not
    // "every feature in the database". Without it, a `vistos` that contained everything would
    // make the parity assertion below green whatever `typeToCollection` did.
    assert.ok(
      !vistos.has(feicaoDeOutroAtlas.id),
      'the snapshot leaked a feature from another atlas — this case is not measuring placement',
    );

    const invisiveis = [...esperado.entries()]
      .filter(([id]) => !vistos.has(id))
      .map(([, tipo]) => tipo)
      .sort();
    assert.deepEqual(
      invisiveis, [],
      'types the live database ACCEPTS and the snapshot does NOT deliver: the row is written and '
      + 'stays invisible to every client, with no error anywhere. Add the missing entry to '
      + 'typeToCollection AND its bucket to transformFeaturesToFrontend (sync.service.js).',
    );
  });

  it('every type the live database accepts passes the import Joi schema', () => {
    assert.ok(aceitos.length > 0, 'floor: the validation loop did not run over an empty list');
    const recusados = [];
    for (const tipo of aceitos) {
      const { error } = importSchema.validate(payloadDeImport(tipo));
      if (error) recusados.push(`${tipo}: ${error.message}`);
    }
    assert.deepEqual(
      recusados, [],
      'types the live database accepts and the import Joi refuses: a .ebgeo carrying one of them '
      + 'takes a 400 and no atlas is created (VALID_FEATURE_TYPES in atlas.schemas.js)',
    );
  });

  it('the import Joi refuses a type the database does not know (positive control)', () => {
    const { error } = importSchema.validate(payloadDeImport(TIPO_INEXISTENTE));
    assert.ok(error, 'the Joi allowlist must refuse an unknown feature type');
  });
});

/**
 * Minimal import payload carrying exactly one feature of `tipo`.
 * @param {string} tipo
 * @returns {Object}
 */
function payloadDeImport(tipo) {
  return {
    atlas: { name: 'Paridade', description: '' },
    maps: [{
      id: randomUUID(),
      name: 'Mapa',
      features: [{
        id: randomUUID(),
        feature_type: tipo,
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: {},
        layer_id: null,
      }],
    }],
    briefings: [],
  };
}
