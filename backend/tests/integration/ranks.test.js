// Path: tests/integration/ranks.test.js
// P1 nº 55: the ranks module (routes/controller/service/queries/schemas) had NO test
// file at all — 33,3% de cobertura, and every one of its authorization gates was
// unverified. Two invariants here are not obvious from the route table and are the
// reason this file exists:
//
//   1. READ is `auth` only, WRITE is `auth + requireAdmin`. A rank feeds the signup
//      dropdown, so any authenticated user must be able to list it; only an admin
//      may change it. A closed check on the wrong middleware silently opens writes.
//   2. UPDATE distinguishes "field absent from the PATCH" from "clear this field".
//      ranks.queries.js documents the bug: COALESCE alone collapses the two, so the
//      API answered 200 with the un-cleared row and the client confirmed a deletion
//      that never happened. The `provided` flag ($6) is what separates them, and the
//      two tests below ("preserves absent", "clears explicit") are what hold it —
//      remove the flag and exactly one of them goes red.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

const UNKNOWN_ID = '00000000-0000-0000-0000-0000000000ff';

describe('Ranks (/api/v1/ranks)', () => {
  let app, db, adminToken, userToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const suffix = randomUUID().slice(0, 8);
    const admin = await createAdminUser(db, { username: `rank_admin_${suffix}` });
    const user = await createUser(db, { username: `rank_user_${suffix}` });
    adminToken = await loginUser(app, admin.username, admin.password);
    userToken = await loginUser(app, user.username, user.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Creates a rank as admin and returns the created row. */
  async function createRank(payload) {
    const res = await supertest(app)
      .post('/api/v1/ranks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: `Posto ${randomUUID().slice(0, 8)}`, ...payload })
      .expect(201);
    return res.body.data;
  }

  describe('read path (auth, no admin)', () => {
    it('lists the seeded ranks, ordered by sort_order', async () => {
      const res = await supertest(app)
        .get('/api/v1/ranks')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      const rows = res.body.data;
      assert.ok(Array.isArray(rows));
      // 001_core.sql seeds the whole EB rank ladder; these two anchor both ends.
      assert.ok(rows.some((r) => r.nome_abrev === 'Civ'));
      assert.ok(rows.some((r) => r.nome_abrev === 'Cap'));

      // LIST_RANKS orders by sort_order — the signup dropdown renders it verbatim,
      // so an unordered list is a user-visible defect with no other guard.
      const order = rows.map((r) => r.sort_order);
      assert.deepEqual(order, [...order].sort((a, b) => a - b));
    });

    it('gets a single rank by id', async () => {
      const list = await supertest(app)
        .get('/api/v1/ranks')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
      const target = list.body.data[0];

      const res = await supertest(app)
        .get(`/api/v1/ranks/${target.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
      assert.equal(res.body.data.id, target.id);
      assert.equal(res.body.data.nome, target.nome);
    });

    it('404s on an unknown id and 422s on a non-uuid id', async () => {
      const missing = await supertest(app)
        .get(`/api/v1/ranks/${UNKNOWN_ID}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(404);
      assert.equal(missing.body.error.code, 'NOT_FOUND');

      // Without the params schema this reaches Postgres as an invalid uuid literal
      // (22P02) and the error handler maps it to 400 — a different status the client
      // has to special-case. The schema is what keeps it a plain validation error.
      await supertest(app)
        .get('/api/v1/ranks/not-a-uuid')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(422);
    });
  });

  describe('authorization', () => {
    it('denies every route to an anonymous caller (401)', async () => {
      await supertest(app).get('/api/v1/ranks').expect(401);
      await supertest(app).get(`/api/v1/ranks/${UNKNOWN_ID}`).expect(401);
      await supertest(app).post('/api/v1/ranks').send({ nome: 'X' }).expect(401);
      await supertest(app).put(`/api/v1/ranks/${UNKNOWN_ID}`).send({ nome: 'X' }).expect(401);
      await supertest(app).delete(`/api/v1/ranks/${UNKNOWN_ID}`).expect(401);
    });

    it('denies every WRITE route to an authenticated non-admin (403)', async () => {
      const auth = { Authorization: `Bearer ${userToken}` };
      await supertest(app).post('/api/v1/ranks').set(auth).send({ nome: 'X' }).expect(403);
      await supertest(app).put(`/api/v1/ranks/${UNKNOWN_ID}`).set(auth).send({ nome: 'X' }).expect(403);
      await supertest(app).delete(`/api/v1/ranks/${UNKNOWN_ID}`).set(auth).expect(403);
    });

    it('403 on write precedes 404/422 — a non-admin learns nothing about the row', async () => {
      // requireAdmin runs BEFORE validate and before the service touches the DB.
      // If the order were reversed a non-admin could probe which ids exist.
      const rank = await createRank({});
      const res = await supertest(app)
        .delete(`/api/v1/ranks/${rank.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
      assert.equal(res.body.error.code, 'FORBIDDEN');

      // And the row survived the forbidden call.
      const { rows } = await db.query('SELECT is_active FROM ranks WHERE id = $1', [rank.id]);
      assert.equal(rows[0].is_active, true);
    });
  });

  describe('create (admin)', () => {
    it('creates with all fields and defaults sort_order to 0', async () => {
      const nome = `Posto ${randomUUID().slice(0, 8)}`;
      const full = await createRank({ nome, nome_abrev: 'PST', sort_order: 42 });
      assert.equal(full.nome, nome);
      assert.equal(full.nome_abrev, 'PST');
      assert.equal(full.sort_order, 42);
      assert.equal(full.is_active, true);
      assert.ok(full.id);

      const minimal = await createRank({});
      assert.equal(minimal.sort_order, 0, 'Joi default(0) must reach the INSERT');
      assert.equal(minimal.nome_abrev, null, 'omitted nome_abrev stores NULL, not ""');
    });

    it('422s on a missing/oversized nome and strips unknown fields', async () => {
      await supertest(app)
        .post('/api/v1/ranks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nome_abrev: 'X' })
        .expect(422);

      await supertest(app)
        .post('/api/v1/ranks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nome: 'A'.repeat(256) })
        .expect(422);

      await supertest(app)
        .post('/api/v1/ranks')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nome: 'X', nome_abrev: 'A'.repeat(51) })
        .expect(422);

      // stripUnknown: is_active is NOT creatable, so a caller cannot be born inactive.
      const created = await createRank({ is_active: false, id: UNKNOWN_ID });
      assert.equal(created.is_active, true);
      assert.notEqual(created.id, UNKNOWN_ID);
    });
  });

  describe('update (admin) — the absent-vs-explicit-null invariant', () => {
    it('preserves nome_abrev when the field is ABSENT from the PATCH', async () => {
      const rank = await createRank({ nome_abrev: 'KEEP', sort_order: 7 });

      const res = await supertest(app)
        .put(`/api/v1/ranks/${rank.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nome: 'Renomeado' })
        .expect(200);

      assert.equal(res.body.data.nome, 'Renomeado');
      assert.equal(res.body.data.nome_abrev, 'KEEP', 'absent field must not be cleared');
      assert.equal(res.body.data.sort_order, 7, 'absent field must not be reset');
      assert.equal(res.body.data.is_active, true);
    });

    it('CLEARS nome_abrev on an explicit null or empty string', async () => {
      // The exact defect the `provided` flag ($6) closes: with COALESCE alone this
      // answered 200 carrying the OLD nome_abrev and the client confirmed a deletion
      // that never happened.
      for (const cleared of [null, '']) {
        const rank = await createRank({ nome_abrev: 'GONE' });

        const res = await supertest(app)
          .put(`/api/v1/ranks/${rank.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ nome_abrev: cleared })
          .expect(200);

        assert.equal(
          res.body.data.nome_abrev,
          null,
          `nome_abrev: ${JSON.stringify(cleared)} must clear the column`
        );

        // The response must not merely LOOK cleared — the row itself is cleared.
        const { rows } = await db.query('SELECT nome_abrev FROM ranks WHERE id = $1', [rank.id]);
        assert.equal(rows[0].nome_abrev, null);
      }
    });

    it('updates sort_order and is_active, and 422s on an empty body', async () => {
      const rank = await createRank({ sort_order: 1 });

      const res = await supertest(app)
        .put(`/api/v1/ranks/${rank.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sort_order: 99, is_active: false })
        .expect(200);
      assert.equal(res.body.data.sort_order, 99);
      assert.equal(res.body.data.is_active, false);

      // sort_order: 0 is falsy — `?? null` (not `|| null`) is what lets it through.
      const zeroed = await supertest(app)
        .put(`/api/v1/ranks/${rank.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sort_order: 0 })
        .expect(200);
      assert.equal(zeroed.body.data.sort_order, 0);

      // is_active: false is falsy too, and a `||` there would make deactivation a no-op.
      const reactivated = await supertest(app)
        .put(`/api/v1/ranks/${rank.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_active: true })
        .expect(200);
      assert.equal(reactivated.body.data.is_active, true);

      // .min(1): an empty PATCH is a caller bug, not a silent 200.
      await supertest(app)
        .put(`/api/v1/ranks/${rank.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(422);
    });

    it('404s on an unknown id and 422s on a non-uuid id', async () => {
      await supertest(app)
        .put(`/api/v1/ranks/${UNKNOWN_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nome: 'Nada' })
        .expect(404);

      await supertest(app)
        .put('/api/v1/ranks/not-a-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nome: 'Nada' })
        .expect(422);
    });
  });

  describe('delete (admin) — soft delete', () => {
    it('deactivates instead of removing, so users.rank_id keeps resolving', async () => {
      const rank = await createRank({ nome_abrev: 'DEL' });

      // A user actually points at it: a hard DELETE would either fail on the FK or
      // orphan the reference. This is the whole reason DEACTIVATE_RANK exists.
      const member = await createUser(db, {
        username: `rank_member_${randomUUID().slice(0, 8)}`,
        rank_id: rank.id,
      });

      await supertest(app)
        .delete(`/api/v1/ranks/${rank.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      const { rows } = await db.query('SELECT id, is_active FROM ranks WHERE id = $1', [rank.id]);
      assert.equal(rows.length, 1, 'the row must still exist (soft delete)');
      assert.equal(rows[0].is_active, false);

      const { rows: userRows } = await db.query('SELECT rank_id FROM users WHERE id = $1', [member.id]);
      assert.equal(userRows[0].rank_id, rank.id, 'the FK must still resolve');

      // Still readable by id after deactivation (the admin panel needs to show it).
      const res = await supertest(app)
        .get(`/api/v1/ranks/${rank.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      assert.equal(res.body.data.is_active, false);
    });

    it('404s on an unknown id and 422s on a non-uuid id', async () => {
      await supertest(app)
        .delete(`/api/v1/ranks/${UNKNOWN_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      await supertest(app)
        .delete('/api/v1/ranks/not-a-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(422);
    });

    it('is idempotent — deleting twice still answers 204', async () => {
      const rank = await createRank({});
      await supertest(app)
        .delete(`/api/v1/ranks/${rank.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);
      // DEACTIVATE_RANK has no `WHERE is_active` guard, so the row still RETURNs.
      await supertest(app)
        .delete(`/api/v1/ranks/${rank.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);
    });
  });
});
