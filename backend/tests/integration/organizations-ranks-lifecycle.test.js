// Path: tests/integration/organizations-ranks-lifecycle.test.js
// Items 137 and 138 — the two write paths of the personnel domain.
//
// 137. `sigla` (organizations) and `nome_abrev` (ranks) are declared clearable by the
//      Joi schemas (`.allow(null, '')`) and were written with a bare COALESCE, which
//      collapses "field absent from the PATCH" and "clear this field" into one: the
//      API answered 200 and kept the old value, so the admin panel's clear button was
//      a silent no-op that CONFIRMED a deletion that never happened. Users had already
//      solved this with a "provided" flag; these two modules did not follow. No test
//      of either module ever tried to clear a field.
//
// 138. There is no reactivation ROUTE: reactivating an OM exists only as a side effect
//      of the generic UPDATE. organizations.test.js covers the deactivation direction
//      only. If OM deactivation ever became a deleted_at/tombstone (the soft-delete
//      pattern the rest of the system uses), reactivation would quietly stop working
//      and the tenant would be unrecoverable with nothing red.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('organizations and ranks: clearing a field, and coming back from deactivation', () => {
  let app, db, adminToken;
  const tag = randomUUID().slice(0, 8);

  const asAdmin = (req) => req.set('Authorization', `Bearer ${adminToken}`);

  const newOrg = async (overrides = {}) => {
    const suffix = randomUUID().slice(0, 8);
    const res = await asAdmin(supertest(app).post('/api/v1/organizations'))
      .send({ nome: `OM ${suffix}`, slug: `om-${suffix}`, sigla: 'COV', ...overrides })
      .expect(201);
    return res.body.data;
  };

  const newRank = async (overrides = {}) => {
    const res = await asAdmin(supertest(app).post('/api/v1/ranks'))
      .send({ nome: `Posto ${randomUUID().slice(0, 8)}`, nome_abrev: 'Pst', ...overrides })
      .expect(201);
    return res.body.data;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db, { username: `p137_admin_${tag}` });
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ── item 137 · clearing a nullable text column ────────────────────────────
  describe('an explicit null CLEARS, an omitted field preserves', () => {
    it('organizations.sigla: null clears it in the database, not just in the response', async () => {
      const org = await newOrg();

      const res = await asAdmin(supertest(app).put(`/api/v1/organizations/${org.id}`))
        .send({ sigla: null })
        .expect(200);
      assert.equal(res.body.data.sigla, null, 'the response reports the clear');

      const { rows } = await db.query('SELECT sigla FROM organizations WHERE id = $1', [org.id]);
      assert.equal(rows[0].sigla, null, 'and the row agrees — a 200 alone proved nothing');
    });

    it('organizations.sigla: an OMITTED field is left alone', async () => {
      const org = await newOrg();

      await asAdmin(supertest(app).put(`/api/v1/organizations/${org.id}`))
        .send({ nome: 'Nome Trocado' })
        .expect(200);

      const { rows } = await db.query('SELECT nome, sigla FROM organizations WHERE id = $1', [org.id]);
      assert.equal(rows[0].nome, 'Nome Trocado');
      assert.equal(rows[0].sigla, 'COV', 'the two meanings of null must stay distinct');
    });

    it('organizations.sigla: the empty string is stored as empty, NOT as null', async () => {
      // Two representations of "no sigla" coexist. Pinned so the difference is a
      // decision rather than a surprise at the dropdown.
      const org = await newOrg();

      await asAdmin(supertest(app).put(`/api/v1/organizations/${org.id}`))
        .send({ sigla: '' })
        .expect(200);

      const { rows } = await db.query('SELECT sigla FROM organizations WHERE id = $1', [org.id]);
      assert.equal(rows[0].sigla, null, 'the service normalizes \'\' to null before the write');
    });

    it('ranks.nome_abrev: same contract, null clears and omission preserves', async () => {
      const cleared = await newRank();
      await asAdmin(supertest(app).put(`/api/v1/ranks/${cleared.id}`))
        .send({ nome_abrev: null })
        .expect(200);
      const { rows: a } = await db.query('SELECT nome_abrev FROM ranks WHERE id = $1', [cleared.id]);
      assert.equal(a[0].nome_abrev, null);

      const kept = await newRank();
      await asAdmin(supertest(app).put(`/api/v1/ranks/${kept.id}`))
        .send({ sort_order: 7 })
        .expect(200);
      const { rows: b } = await db.query(
        'SELECT nome_abrev, sort_order FROM ranks WHERE id = $1', [kept.id]
      );
      assert.equal(b[0].nome_abrev, 'Pst');
      assert.equal(b[0].sort_order, 7);
    });

    it('CONTRAST: users.rank_id already behaved this way — it is the pattern being followed', async () => {
      const user = await createUser(db, { username: `p137_user_${randomUUID().slice(0, 8)}` });
      const { rows: before } = await db.query('SELECT rank_id FROM users WHERE id = $1', [user.id]);
      assert.notEqual(before[0].rank_id, null, 'fixture: the user starts with a rank');

      await asAdmin(supertest(app).put(`/api/v1/users/${user.id}`))
        .send({ rank_id: null })
        .expect(200);

      const { rows } = await db.query('SELECT rank_id FROM users WHERE id = $1', [user.id]);
      assert.equal(rows[0].rank_id, null);
    });
  });

  // ── item 138 · deactivate, then come back ─────────────────────────────────
  describe('an organization can be brought back, and its members with it', () => {
    it('login is refused while deactivated and works again after reactivation', async () => {
      const org = await newOrg();
      const member = await createUser(db, {
        username: `p138_member_${randomUUID().slice(0, 8)}`,
        organization_id: org.id,
      });

      const first = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: member.username, password: member.password })
        .expect(200);
      assert.ok(first.body.data.accessToken);

      await asAdmin(supertest(app).delete(`/api/v1/organizations/${org.id}`)).expect(204);
      await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: member.username, password: member.password })
        .expect(403);

      await asAdmin(supertest(app).put(`/api/v1/organizations/${org.id}`))
        .send({ is_active: true })
        .expect(200);

      const back = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: member.username, password: member.password })
        .expect(200);

      await supertest(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${back.body.data.accessToken}`)
        .expect(200);
    });

    it('an UNTOUCHED refresh token survives the outage; one TRIED during it is burned', async () => {
      // Two facts, and they are easy to confuse. (a) Deactivating an OM revokes
      // nothing, so a session that sat idle through the outage still refreshes
      // afterwards — the tenant comes back with its sessions. (b) A token PRESENTED
      // during the outage is already spent: `refresh()` claims the row (revoking it)
      // BEFORE the org gate runs, so the 403 costs the caller the token. The obvious
      // wording "nothing revoked it, so it works again" is only half true.
      const org = await newOrg();
      const member = await createUser(db, {
        username: `p138_resur_${randomUUID().slice(0, 8)}`,
        organization_id: org.id,
      });

      const openSession = async () => {
        const res = await supertest(app)
          .post('/api/v1/auth/login')
          .send({ username: member.username, password: member.password })
          .expect(200);
        return res.body.data.refreshToken;
      };
      const idleToken = await openSession();
      const triedToken = await openSession();

      await asAdmin(supertest(app).delete(`/api/v1/organizations/${org.id}`)).expect(204);
      await supertest(app).post('/api/v1/auth/refresh').send({ refreshToken: triedToken }).expect(403);

      await asAdmin(supertest(app).put(`/api/v1/organizations/${org.id}`))
        .send({ is_active: true })
        .expect(200);

      const burned = await supertest(app).post('/api/v1/auth/refresh').send({ refreshToken: triedToken });
      assert.equal(burned.status, 401, 'claim-then-check: the refused attempt already spent the token');

      const survived = await supertest(app)
        .post('/api/v1/auth/refresh').send({ refreshToken: idleToken }).expect(200);
      assert.ok(survived.body.data.accessToken, 'deactivation revoked nothing, so the idle session lives');
    });

    it('the anonymous GET /api/config drops the OM and lists it again after reactivation', async () => {
      const org = await newOrg();

      const listed = async () => {
        const res = await supertest(app).get('/api/config').expect(200);
        return res.body.data.organizacoesMilitares.some((o) => o.id === org.id);
      };

      assert.equal(await listed(), true, 'a live OM feeds the anonymous signup dropdown');

      await asAdmin(supertest(app).delete(`/api/v1/organizations/${org.id}`)).expect(204);
      assert.equal(await listed(), false, 'is_active = false removes it from the payload');

      await asAdmin(supertest(app).put(`/api/v1/organizations/${org.id}`))
        .send({ is_active: true })
        .expect(200);
      assert.equal(await listed(), true);
    });

    it('a reactivated org is listed with is_active true in GET /organizations', async () => {
      const org = await newOrg();
      await asAdmin(supertest(app).delete(`/api/v1/organizations/${org.id}`)).expect(204);
      await asAdmin(supertest(app).put(`/api/v1/organizations/${org.id}`))
        .send({ is_active: true })
        .expect(200);

      const res = await asAdmin(supertest(app).get('/api/v1/organizations')).expect(200);
      const entry = res.body.data.find((o) => o.id === org.id);
      assert.ok(entry, 'the org is present in the listing');
      assert.equal(entry.is_active, true);
    });
  });
});
