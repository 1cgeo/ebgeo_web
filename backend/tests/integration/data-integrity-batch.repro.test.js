// Path: tests/integration/data-integrity-batch.repro.test.js
// Four data-integrity defects that share one root: a write path that cannot express
// "clear this field", or that forgot a column when the table grew.
//
//  #72 / #94 — COALESCE conflates "field absent from the PATCH" with "set this to
//    null". The Joi schemas explicitly say `.allow(null, '')`, so null IS a legal,
//    meaningful input — and the SQL discarded it, answering 200 with the OLD value.
//    The client confirms a deletion that never happened. The users module solved this
//    first and wrote down why: "COALESCE alone could never clear to NULL"
//    (users.queries.js:23-24). organizations, ranks and atlas were the siblings left
//    behind. Passing an empty string worked as an accidental workaround, which is
//    worse than a clean failure: it puts two different representations of "no value"
//    in the same column.
//
//  #31 — cloneAtlas and duplicateMap listed columns by hand and were never updated
//    when `grid_style` and `temporal_config` were added. A cloned atlas silently lost
//    its UTM grid and its entire temporal configuration (window, mode, unit, origin).
//    The import path carries both, with a comment saying it must; clone/duplicate
//    simply drifted. No test touched it: the existing "clone preserves settings, maps
//    and features" checks settings, map ids and features only.
//
// Negative controls: revert any single fix and its tests here fail.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createAtlas, createMap, loginUser,
} from '../helpers/fixtures.js';

describe('data integrity: clearing fields and copying columns', () => {
  let app, db, owner, ownerTok, adminTok;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `di_own_${randomUUID().slice(0, 8)}` });
    ownerTok = await loginUser(app, owner.username, owner.password);
    const admin = await createAdminUser(db);
    adminTok = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // =========================================================================
  // #72 — atlas.description must be clearable
  // =========================================================================
  describe('PUT /atlas/:id can clear the description', () => {
    it('an explicit null empties the field', async () => {
      const atlas = await createAtlas(db, owner.id, { name: 'Atlas Desc' });
      await db.query('UPDATE atlas SET description = $2 WHERE id = $1', [atlas.id, 'texto antigo']);

      await supertest(app)
        .put(`/api/v1/atlas/${atlas.id}`)
        .set('Authorization', `Bearer ${ownerTok}`)
        .send({ description: null })
        .expect(200);

      const { rows } = await db.query('SELECT description FROM atlas WHERE id = $1', [atlas.id]);
      assert.equal(rows[0].description, null, 'null means CLEAR, which is what the schema allows');
    });

    it('an omitted description leaves the value alone', async () => {
      // The other half of the invariant: a partial PATCH must not wipe what it did
      // not mention. A fix that always wrote null would pass the test above.
      const atlas = await createAtlas(db, owner.id, { name: 'Atlas Desc 2' });
      await db.query('UPDATE atlas SET description = $2 WHERE id = $1', [atlas.id, 'preservar']);

      await supertest(app)
        .put(`/api/v1/atlas/${atlas.id}`)
        .set('Authorization', `Bearer ${ownerTok}`)
        .send({ name: 'Novo Nome' })
        .expect(200);

      const { rows } = await db.query('SELECT description, name FROM atlas WHERE id = $1', [atlas.id]);
      assert.equal(rows[0].description, 'preservar', 'untouched field survives');
      assert.equal(rows[0].name, 'Novo Nome', 'and the touched one changed');
    });
  });

  // =========================================================================
  // #94 — organizations.sigla and ranks.nome_abrev, same defect
  // =========================================================================
  describe('organization sigla and rank abbreviation can be cleared', () => {
    it('clears an organization sigla with null', async () => {
      const rid = randomUUID().slice(0, 8);
      const { rows: created } = await db.query(
        `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, 'ABC') RETURNING id`,
        [`OM ${rid}`, `om-${rid}`]
      );
      const id = created[0].id;

      await supertest(app)
        .put(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${adminTok}`)
        .send({ sigla: null })
        .expect(200);

      const { rows } = await db.query('SELECT sigla FROM organizations WHERE id = $1', [id]);
      assert.equal(rows[0].sigla, null);
    });

    it('leaves the sigla alone when the field is omitted', async () => {
      const rid = randomUUID().slice(0, 8);
      const { rows: created } = await db.query(
        `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, 'XYZ') RETURNING id`,
        [`OM ${rid}`, `om2-${rid}`]
      );
      const id = created[0].id;

      await supertest(app)
        .put(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${adminTok}`)
        .send({ nome: `OM Renomeada ${rid}` })
        .expect(200);

      const { rows } = await db.query('SELECT sigla FROM organizations WHERE id = $1', [id]);
      assert.equal(rows[0].sigla, 'XYZ', 'a partial update must not wipe the rest');
    });

    it('clears a rank abbreviation with null and preserves it when omitted', async () => {
      const rid = randomUUID().slice(0, 6);
      // `code` is SMALLINT, not text — the first version of this fixture passed a
      // string and died on a 22P02 that had nothing to do with the behaviour here.
      const { rows: created } = await db.query(
        `INSERT INTO ranks (nome, nome_abrev, sort_order) VALUES ($1, 'Cel', 99) RETURNING id`,
        [`Posto ${rid}`]
      );
      const id = created[0].id;

      await supertest(app)
        .put(`/api/v1/ranks/${id}`)
        .set('Authorization', `Bearer ${adminTok}`)
        .send({ nome_abrev: null })
        .expect(200);
      assert.equal(
        (await db.query('SELECT nome_abrev FROM ranks WHERE id = $1', [id])).rows[0].nome_abrev,
        null
      );

      await db.query('UPDATE ranks SET nome_abrev = $2 WHERE id = $1', [id, 'Maj']);
      await supertest(app)
        .put(`/api/v1/ranks/${id}`)
        .set('Authorization', `Bearer ${adminTok}`)
        .send({ sort_order: 42 })
        .expect(200);
      assert.equal(
        (await db.query('SELECT nome_abrev FROM ranks WHERE id = $1', [id])).rows[0].nome_abrev,
        'Maj',
        'omitted field untouched'
      );
    });
  });

  // =========================================================================
  // #31 — clone and duplicate must carry grid_style and temporal_config
  // =========================================================================
  describe('clone and duplicate preserve the grid and the temporal config', () => {
    const GRID = { visivel: true, espacamento: 1000, cor: '#ff0000' };
    const TEMPORAL = { ativo: true, modo: 'relativo', unidade: 'h', inicio: 1, fim: 2, origem: 3 };

    it('cloneAtlas copies both columns', async () => {
      const atlas = await createAtlas(db, owner.id, { name: 'Atlas Origem' });
      const map = await createMap(db, atlas.id, { name: 'Mapa com grade' });
      await db.query(
        'UPDATE maps SET grid_style = $2::jsonb, temporal_config = $3::jsonb WHERE id = $1',
        [map.id, JSON.stringify(GRID), JSON.stringify(TEMPORAL)]
      );

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/clone`)
        .set('Authorization', `Bearer ${ownerTok}`)
        .send({ name: 'Atlas Clonado' })
        .expect(201);

      const { rows } = await db.query(
        'SELECT grid_style, temporal_config FROM maps WHERE atlas_id = $1',
        [res.body.data.id]
      );
      assert.equal(rows.length, 1, 'the clone has the map');
      assert.deepEqual(rows[0].grid_style, GRID, 'the UTM grid survives the clone');
      assert.deepEqual(rows[0].temporal_config, TEMPORAL, 'and so does the whole temporal module');
    });

    it('duplicateMap copies both columns', async () => {
      const atlas = await createAtlas(db, owner.id, { name: 'Atlas Dup' });
      const map = await createMap(db, atlas.id, { name: 'Mapa Original' });
      await db.query(
        'UPDATE maps SET grid_style = $2::jsonb, temporal_config = $3::jsonb WHERE id = $1',
        [map.id, JSON.stringify(GRID), JSON.stringify(TEMPORAL)]
      );

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/maps/${map.id}/duplicate`)
        .set('Authorization', `Bearer ${ownerTok}`)
        .send({})
        .expect(201);

      const { rows } = await db.query(
        'SELECT grid_style, temporal_config FROM maps WHERE id = $1',
        [res.body.data.id]
      );
      assert.deepEqual(rows[0].grid_style, GRID);
      assert.deepEqual(rows[0].temporal_config, TEMPORAL);
    });
  });
});
