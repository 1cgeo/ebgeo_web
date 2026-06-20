// Path: tests/integration/org-identity-gaps.test.js
// Integration tests for confirmed gaps in Organizations + Identity + Audit + Users.
// Each test asserts CURRENT behavior verified against the module source.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import { createAudit } from '../../src/utils/audit.js';

// Unique-username helper — mandatory to avoid cross-file collisions in shared runs.
const uname = (p) => `gap_${p}_${randomUUID().slice(0, 8)}`;

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

describe('Org + Identity + Audit + Users gaps', () => {
  let app, db, admin, adminToken, regularUser, userToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    admin = await createAdminUser(db, { username: uname('admin') });
    regularUser = await createUser(db, { username: uname('reg') });
    adminToken = await loginUser(app, admin.username, admin.password);
    userToken = await loginUser(app, regularUser.username, regularUser.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ── users-01 · transferTo to an INACTIVE target → 403, source untouched ──────
  describe('deleteUser transferTo to inactive target', () => {
    it('returns 403 and rolls back (source stays active, atlas unchanged)', async () => {
      const source = await createUser(db, { username: uname('src01') });
      const atlas = await createAtlas(db, source.id, { name: 'Atlas g01' });
      const target = await createUser(db, { username: uname('tgt01') });
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [target.id]);

      await supertest(app)
        .delete(`/api/v1/users/${source.id}?transferTo=${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);

      // Rollback: source still active.
      const { rows: srcRows } = await db.query('SELECT is_active FROM users WHERE id = $1', [source.id]);
      assert.equal(srcRows[0].is_active, true);
      // Atlas still owned by source.
      const { rows: atlasRows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
      assert.equal(atlasRows[0].owner_id, source.id);
    });
  });

  // ── users-02 · transferTo to a NON-EXISTENT user → 404, source untouched ─────
  describe('deleteUser transferTo to non-existent user', () => {
    it('returns 404 and leaves source active + atlas owner unchanged', async () => {
      const source = await createUser(db, { username: uname('src02') });
      const atlas = await createAtlas(db, source.id, { name: 'Atlas g02' });

      await supertest(app)
        .delete(`/api/v1/users/${source.id}?transferTo=${NIL_UUID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      const { rows: srcRows } = await db.query('SELECT is_active FROM users WHERE id = $1', [source.id]);
      assert.equal(srcRows[0].is_active, true);
      const { rows: atlasRows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
      assert.equal(atlasRows[0].owner_id, source.id);
    });
  });

  // ── audit-01 · USER_DELETE audit row + details.atlasTransferred ──────────────
  describe('USER_DELETE audit row on successful transfer-delete', () => {
    it('writes exactly one audit row with target_name and details.atlasTransferred', async () => {
      const source = await createUser(db, { username: uname('src03'), nome: 'Delete Me Audit' });
      await createAtlas(db, source.id, { name: 'Atlas g03a' });
      await createAtlas(db, source.id, { name: 'Atlas g03b' });
      const target = await createUser(db, { username: uname('tgt03') });

      await supertest(app)
        .delete(`/api/v1/users/${source.id}?transferTo=${target.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const { rows } = await db.query(
        `SELECT target_name, details FROM audit_trail
         WHERE action = 'USER_DELETE' AND target_id = $1`,
        [source.id]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].target_name, 'Delete Me Audit');
      // details is JSONB → pg returns it as a parsed object.
      assert.equal(Number(rows[0].details.atlasTransferred), 2);
    });
  });

  // ── audit-03 · audit query filters + pagination + limit boundary + ordering ──
  describe('GET /audit filters and pagination', () => {
    let actorA, actorB;

    before(async () => {
      actorA = await createUser(db, { username: uname('actorA') });
      actorB = await createUser(db, { username: uname('actorB') });
      // Seed deterministic audit rows. Both actors have valid (FK-satisfying) ids.
      // actorA: 3 ORG rows; actorB: 2 USER rows.
      for (let i = 0; i < 3; i++) {
        await db.query(
          `INSERT INTO audit_trail (action, actor_id, target_type, target_id, ip)
           VALUES ('ORG_UPDATE', $1, 'ORG', $2, '127.0.0.1')`,
          [actorA.id, randomUUID()]
        );
      }
      for (let i = 0; i < 2; i++) {
        await db.query(
          `INSERT INTO audit_trail (action, actor_id, target_type, target_id, ip)
           VALUES ('USER_UPDATE', $1, 'USER', $2, '127.0.0.1')`,
          [actorB.id, randomUUID()]
        );
      }
    });

    it('filters by actorId — total matches and all rows belong to actor', async () => {
      const res = await supertest(app)
        .get(`/api/v1/audit?actorId=${actorA.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      assert.equal(res.body.data.total, 3);
      assert.equal(res.body.data.data.length, 3);
      assert.ok(res.body.data.data.every((r) => r.actor_id === actorA.id));
    });

    it('filters by targetType combined with actorId', async () => {
      const res = await supertest(app)
        .get(`/api/v1/audit?targetType=USER&actorId=${actorB.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      assert.equal(res.body.data.total, 2);
      assert.ok(res.body.data.data.every((r) => r.target_type === 'USER'));
      assert.ok(res.body.data.data.every((r) => r.actor_id === actorB.id));
    });

    it('paginates: limit=2&page=2 returns slice 3 of total, total unchanged', async () => {
      const res = await supertest(app)
        .get(`/api/v1/audit?actorId=${actorA.id}&limit=2&page=2`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      assert.equal(res.body.data.total, 3);
      assert.equal(res.body.data.page, 2);
      assert.equal(res.body.data.limit, 2);
      // 3 total, offset=(2-1)*2=2 → only 1 remaining row.
      assert.equal(res.body.data.data.length, 1);
    });

    it('orders results created_at DESC', async () => {
      const res = await supertest(app)
        .get(`/api/v1/audit?actorId=${actorA.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const times = res.body.data.data.map((r) => new Date(r.created_at).getTime());
      for (let i = 1; i < times.length; i++) {
        assert.ok(times[i - 1] >= times[i], 'expected created_at DESC');
      }
    });

    it('rejects limit above 200 with 422', async () => {
      await supertest(app)
        .get('/api/v1/audit?limit=201')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(422);
    });
  });

  // ── org-01 · anon → 401 on strict org GET routes; non-admin user CAN read ────
  describe('Organizations GET access control', () => {
    it('anonymous GET /organizations → 401', async () => {
      await supertest(app).get('/api/v1/organizations').expect(401);
    });

    it('anonymous GET /organizations/:id → 401', async () => {
      await supertest(app).get(`/api/v1/organizations/${NIL_UUID}`).expect(401);
    });

    it('regular (non-admin) user CAN list organizations → 200', async () => {
      const res = await supertest(app)
        .get('/api/v1/organizations')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
      assert.ok(Array.isArray(res.body.data));
    });
  });

  // ── org-02 · update/delete non-existent → 404; bad UUID → 422 ────────────────
  describe('Organizations error mapping', () => {
    it('PUT /organizations/<random-uuid> → 404', async () => {
      await supertest(app)
        .put(`/api/v1/organizations/${randomUUID()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nome: 'No Such Org' })
        .expect(404);
    });

    it('DELETE /organizations/<random-uuid> → 404', async () => {
      await supertest(app)
        .delete(`/api/v1/organizations/${randomUUID()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });

    it('GET /organizations/not-a-uuid → 422', async () => {
      await supertest(app)
        .get('/api/v1/organizations/not-a-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(422);
    });
  });

  // ── users-04 · admin updateUser username conflict (409) + case-insensitive ───
  describe('Admin updateUser username conflict', () => {
    it('renaming B to A (case-insensitive collision) → 409; same name different case → 200', async () => {
      const nameA = uname('alpha');
      const nameB = uname('beta');
      await createUser(db, { username: nameA });
      const userB = await createUser(db, { username: nameB });

      // Collide with A (upper-cased) → 409.
      await supertest(app)
        .put(`/api/v1/users/${userB.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: nameA.toUpperCase() })
        .expect(409);

      // Own username in a different case → allowed (own id excluded) → 200.
      await supertest(app)
        .put(`/api/v1/users/${userB.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: nameB.toUpperCase() })
        .expect(200);
    });
  });

  // ── users-06 · field-clearing semantics of CASE-WHEN updates ─────────────────
  describe('Field-clearing semantics (admin + self)', () => {
    it('admin PUT: explicit "" clears posto; omitting posto preserves it', async () => {
      const u = await createUser(db, { username: uname('clear'), posto_graduacao: 'Maj' });

      // Explicit '' clears.
      await supertest(app)
        .put(`/api/v1/users/${u.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ posto_graduacao: '' })
        .expect(200);
      let { rows } = await db.query('SELECT posto_graduacao FROM users WHERE id = $1', [u.id]);
      assert.equal(rows[0].posto_graduacao, null);

      // Set it again then omit on a name-only update → preserved.
      await db.query('UPDATE users SET posto_graduacao = $2 WHERE id = $1', [u.id, 'Cel']);
      await supertest(app)
        .put(`/api/v1/users/${u.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nome: 'Renamed Only' })
        .expect(200);
      ({ rows } = await db.query('SELECT posto_graduacao, nome FROM users WHERE id = $1', [u.id]));
      assert.equal(rows[0].posto_graduacao, 'Cel');
      assert.equal(rows[0].nome, 'Renamed Only');
    });

    it('self PUT /users/me: explicit "" clears posto; omitting preserves it', async () => {
      const u = await createUser(db, { username: uname('clearme'), posto_graduacao: 'Sgt', password: 'Self@1234' });
      const token = await loginUser(app, u.username, 'Self@1234');

      await supertest(app)
        .put('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ posto_graduacao: '' })
        .expect(200);
      let { rows } = await db.query('SELECT posto_graduacao FROM users WHERE id = $1', [u.id]);
      assert.equal(rows[0].posto_graduacao, null);

      await db.query('UPDATE users SET posto_graduacao = $2 WHERE id = $1', [u.id, 'Ten']);
      await supertest(app)
        .put('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ nome: 'Self Renamed' })
        .expect(200);
      ({ rows } = await db.query('SELECT posto_graduacao FROM users WHERE id = $1', [u.id]));
      assert.equal(rows[0].posto_graduacao, 'Ten');
    });
  });

  // ── users-08 · searchUsers excludes inactive + LIKE wildcards literal ────────
  describe('searchUsers visibility and wildcard handling', () => {
    it('does not return a deactivated user', async () => {
      const tag = randomUUID().slice(0, 10);
      const gone = await createUser(db, { username: uname('gone'), nome: `gone_${tag}` });
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [gone.id]);

      const res = await supertest(app)
        .get(`/api/v1/users/search?q=${tag}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      const ids = res.body.data.map((r) => r.id);
      assert.ok(!ids.includes(gone.id), 'inactive user must not be searchable');
    });

    it('a literal "%" query does not enumerate the whole user table', async () => {
      // q='%%' (min length 2) is interpolated into `%${q}%` → `%%%%`, which
      // matches every active user; the documented mitigation is the LIMIT 20
      // cap, so the result set must never exceed 20 rows even though far more
      // active users exist. Seed enough active users to exceed the cap.
      for (let i = 0; i < 25; i++) {
        await createUser(db, { username: uname(`bulk${i}`) });
      }
      const res = await supertest(app)
        .get('/api/v1/users/search?q=%25%25') // URL-encoded '%%'
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length <= 20, `expected <=20 rows, got ${res.body.data.length}`);
    });
  });

  // ── audit-04 · createAudit(null/partial req) defaults ip/user_agent ──────────
  describe('createAudit system-actor defaults', () => {
    it('null req → ip="system", user_agent IS NULL', async () => {
      const actor = await createUser(db, { username: uname('sysactor') });
      const targetId = randomUUID();
      await createAudit(null, {
        action: 'ORG_DELETE', actorId: actor.id, targetType: 'ORG', targetId,
      });

      const { rows } = await db.query(
        `SELECT ip, user_agent FROM audit_trail WHERE target_id = $1 AND action = 'ORG_DELETE'`,
        [targetId]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].ip, 'system');
      assert.equal(rows[0].user_agent, null);
    });

    it('partial req {ip} without .get → uses given ip, user_agent NULL', async () => {
      const actor = await createUser(db, { username: uname('sysactor2') });
      const targetId = randomUUID();
      await createAudit({ ip: '1.2.3.4' }, {
        action: 'ORG_UPDATE', actorId: actor.id, targetType: 'ORG', targetId,
      });

      const { rows } = await db.query(
        `SELECT ip, user_agent FROM audit_trail WHERE target_id = $1 AND action = 'ORG_UPDATE'`,
        [targetId]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].ip, '1.2.3.4');
      assert.equal(rows[0].user_agent, null);
    });
  });
});
