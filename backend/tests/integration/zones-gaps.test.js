// Path: tests/integration/zones-gaps.test.js
// Gap coverage for the geographic-access "zones" (ng) subsystem. Asserts the
// CURRENT behavior: pg SQLSTATE mapping (FK violation -> 409), replace-set
// permission semantics, hard-DELETE + cascade end-to-end, 401-vs-403 split,
// list/GET shape contracts, param validation, and audit before/after diff.
//
// Mirrors tests/integration/zones-admin.test.js (supertest against the exported
// app, setupTestEnv/teardownTestEnv, fixtures). Usernames are UUID-suffixed to
// avoid collisions in the shared run.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

const uname = (p) => `${p}_${randomUUID().slice(0, 8)}`;
const MISSING = '00000000-0000-0000-0000-000000000000';

// A valid square around (-43.2, -22.9) — same spot used by nomes-access fixtures.
const VALID = {
  type: 'Polygon',
  coordinates: [[[-43.3, -22.95], [-43.1, -22.95], [-43.1, -22.85], [-43.3, -22.85], [-43.3, -22.95]]],
};

describe('Zones gaps (error-mapping, replace-set, cascade, authz, contract, audit)', () => {
  let app, db, admin, adminTok, user, userTok;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    admin = await createAdminUser(db, { username: uname('gap_admin') });
    adminTok = await loginUser(app, admin.username, admin.password);
    user = await createUser(db, { username: uname('gap_user') });
    userTok = await loginUser(app, user.username, user.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // Helper: create a fresh zone, return its id.
  const createZone = async (name) => {
    const res = await supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name, geom: VALID })
      .expect(201);
    return res.body.data.id;
  };

  const getPerms = (id, tok = adminTok) =>
    supertest(app)
      .get(`/api/v1/zones/${id}/permissions`)
      .set('Authorization', `Bearer ${tok}`);

  const putPerms = (id, body, tok = adminTok) =>
    supertest(app)
      .put(`/api/v1/zones/${id}/permissions`)
      .set('Authorization', `Bearer ${tok}`)
      .send(body);

  // ---------------------------------------------------------------------------
  // zones-01 — phantom group_id triggers a Postgres FK violation (23503) that the
  // global errorHandler now maps to 409 (NOT a raw 500), and the replace-set
  // transaction rolls back leaving prior permissions intact.
  // ---------------------------------------------------------------------------
  it('zones-01: phantom group_id -> 409 (FK mapped) and prior perms are preserved (atomicity)', async () => {
    const id = await createZone('z01');
    // Seed a known-good state first.
    await putPerms(id, { users: [user.id] }).expect(200);

    const res = await putPerms(id, { groups: [randomUUID()] });
    // Current contract: FK violation (23503) mapped by errorHandler to 409, NOT 500.
    assert.notEqual(res.status, 500, 'must not leak a raw 500 on FK violation');
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CONFLICT');

    // The failed replace-set rolled back: the prior user grant must still be there.
    const after = await getPerms(id).expect(200);
    assert.deepEqual(after.body.data.users, [user.id], 'prior user grant preserved after rollback');
    assert.deepEqual(after.body.data.groups, []);
  });

  // ---------------------------------------------------------------------------
  // zones-02 — zone_permissions.user_id has NO foreign key: a phantom user UUID
  // inserts silently (200) and dangles. Pin the actual (no-FK) contract.
  // ---------------------------------------------------------------------------
  it('zones-02: phantom user_id (no FK) inserts silently with 200 and dangles', async () => {
    const id = await createZone('z02');
    const phantom = randomUUID();

    const res = await putPerms(id, { users: [phantom] }).expect(200);
    assert.deepEqual(res.body.data.users, [phantom]);

    // Read-back confirms the dangling grant persisted (no FK / no existence check).
    const back = await getPerms(id).expect(200);
    assert.ok(back.body.data.users.includes(phantom), 'phantom user grant dangles in the table');

    // And it really hit the row store.
    const row = await db.query(
      'SELECT COUNT(*)::int AS n FROM ng.zone_permissions WHERE zone_id = $1 AND user_id = $2',
      [id, phantom]
    );
    assert.equal(row.rows[0].n, 1);
  });

  // ---------------------------------------------------------------------------
  // zones-05 — PUT permissions is a full replace-set: a smaller set revokes the
  // dropped users; {users:[]} clears everyone. (Frozen contract.)
  // ---------------------------------------------------------------------------
  it('zones-05: replace-set semantics — shrinking revokes, [] clears all', async () => {
    const id = await createZone('z05');
    const a = await createUser(db, { username: uname('gap_a') });
    const b = await createUser(db, { username: uname('gap_b') });

    await putPerms(id, { users: [a.id, b.id] }).expect(200);
    const both = await getPerms(id).expect(200);
    assert.deepEqual([...both.body.data.users].sort(), [a.id, b.id].sort());

    // Shrink to [a] -> b is revoked.
    await putPerms(id, { users: [a.id] }).expect(200);
    const one = await getPerms(id).expect(200);
    assert.deepEqual(one.body.data.users, [a.id]);

    // Empty array clears everyone.
    await putPerms(id, { users: [] }).expect(200);
    const none = await getPerms(id).expect(200);
    assert.deepEqual(none.body.data.users, []);
    assert.deepEqual(none.body.data.groups, []);
  });

  // ---------------------------------------------------------------------------
  // zones-06 — DELETE happy path: 204, zone disappears from GET list / GET :id,
  // and zone_permissions cascade away (FK ON DELETE CASCADE), proven end-to-end.
  // ---------------------------------------------------------------------------
  it('zones-06: DELETE -> 204, zone gone from list/GET, permissions cascade away', async () => {
    const id = await createZone('z06');
    const grantee = await createUser(db, { username: uname('gap_grantee') });
    await putPerms(id, { users: [grantee.id] }).expect(200);

    // Sanity: permission row exists before delete.
    const before = await db.query(
      'SELECT COUNT(*)::int AS n FROM ng.zone_permissions WHERE zone_id = $1',
      [id]
    );
    assert.equal(before.rows[0].n, 1);

    await supertest(app)
      .delete(`/api/v1/zones/${id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(204);

    // 404 on GET :id, absent from list.
    await supertest(app)
      .get(`/api/v1/zones/${id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(404);

    const list = await supertest(app)
      .get('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    assert.ok(!list.body.data.some((z) => z.id === id), 'deleted zone absent from list');

    // Cascade: permission rows are gone.
    const after = await db.query(
      'SELECT COUNT(*)::int AS n FROM ng.zone_permissions WHERE zone_id = $1',
      [id]
    );
    assert.equal(after.rows[0].n, 0, 'zone_permissions cascaded on delete');
  });

  // ---------------------------------------------------------------------------
  // zones-07 — missing-zone branches: GET :id -> 404, DELETE :id -> 404, while
  // GET/PUT permissions do NOT check existence (silent 200 — pin the bug).
  // ---------------------------------------------------------------------------
  it('zones-07: GET/:id and DELETE on missing zone -> 404; permissions endpoints do NOT check existence', async () => {
    await supertest(app)
      .get(`/api/v1/zones/${MISSING}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(404);

    await supertest(app)
      .delete(`/api/v1/zones/${MISSING}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(404);

    // GET permissions on a phantom zone: current behavior is a silent 200 with empty sets
    // (getZonePermissions has NO existence check — it just returns the empty join result).
    const got = await getPerms(MISSING).expect(200);
    assert.deepEqual(got.body.data, { users: [], groups: [] });

    // PUT permissions on a phantom zone with a REAL user: setZonePermissions does NOT check
    // zone existence, but zone_permissions.zone_id has a real FK to geographic_access_zones,
    // so the INSERT raises a 23503 FK violation mapped by the errorHandler to 409 (NOT 500).
    const put = await putPerms(MISSING, { users: [user.id] });
    assert.notEqual(put.status, 500, 'no raw 500 on phantom-zone FK violation');
    assert.equal(put.status, 409);
    assert.equal(put.body.error.code, 'CONFLICT');
  });

  // ---------------------------------------------------------------------------
  // zones-08 — 401 (no token) vs 403 (non-admin) on every verb, not just POST/PUT.
  // ---------------------------------------------------------------------------
  it('zones-08: 401 (no token) and 403 (non-admin) across read/delete/permissions verbs', async () => {
    const id = await createZone('z08');

    const routes = [
      ['get', `/api/v1/zones`],
      ['get', `/api/v1/zones/${id}`],
      ['delete', `/api/v1/zones/${id}`],
      ['get', `/api/v1/zones/${id}/permissions`],
      ['put', `/api/v1/zones/${id}/permissions`],
    ];

    for (const [method, path] of routes) {
      // No Authorization header -> 401.
      const noTok = await supertest(app)[method](path).expect(401);
      assert.equal(noTok.body.error.code, 'UNAUTHORIZED', `${method} ${path} no-token code`);

      // Authenticated non-admin -> 403.
      const nonAdmin = await supertest(app)[method](path)
        .set('Authorization', `Bearer ${userTok}`)
        .expect(403);
      assert.equal(nonAdmin.body.error.code, 'FORBIDDEN', `${method} ${path} non-admin code`);
    }
  });

  // ---------------------------------------------------------------------------
  // zones-09 — list shape (metadata only, NO geom) vs GET :id (geom as parsed
  // GeoJSON object with a non-empty ring).
  // ---------------------------------------------------------------------------
  it('zones-09: list omits geom; GET/:id returns geom as a parsed Polygon object', async () => {
    const id = await createZone('z09');

    const list = await supertest(app)
      .get('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    const item = list.body.data.find((z) => z.id === id);
    assert.ok(item, 'created zone present in list');
    assert.ok('id' in item && 'name' in item && 'description' in item && 'created_at' in item);
    assert.equal(item.geom, undefined, 'list must NOT include the heavy geom field');

    const one = await supertest(app)
      .get(`/api/v1/zones/${id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    const geom = one.body.data.geom;
    assert.equal(typeof geom, 'object', 'geom is a parsed object, not a string');
    assert.equal(geom.type, 'Polygon');
    assert.ok(Array.isArray(geom.coordinates) && geom.coordinates[0].length > 0, 'non-empty ring');
  });

  // ---------------------------------------------------------------------------
  // zones-10 — non-UUID :id -> 422 VALIDATION_ERROR (param validator fires before
  // the controller); GET permissions shape is {users:[<uuid>], groups:[]}.
  // ---------------------------------------------------------------------------
  it('zones-10: non-UUID id -> 422; GET permissions shape is arrays of UUIDs', async () => {
    const res = await supertest(app)
      .get('/api/v1/zones/not-a-uuid')
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(res.body.error.details.some((d) => d.field === 'id'), 'details point at id');

    const id = await createZone('z10');
    const a = await createUser(db, { username: uname('gap_perm') });
    await putPerms(id, { users: [a.id] }).expect(200);
    const got = await getPerms(id).expect(200);
    assert.deepEqual(got.body.data.users, [a.id]);
    assert.deepEqual(got.body.data.groups, []);
  });

  // ---------------------------------------------------------------------------
  // zones-11 — audit diff: a second PUT records before=prior set, after=new set,
  // and the diff commits with the replace-set in one transaction.
  // ---------------------------------------------------------------------------
  it('zones-11: PUT permissions audit records before/after diff in the same tx', async () => {
    const id = await createZone('z11');
    const a = await createUser(db, { username: uname('gap_x') });
    const b = await createUser(db, { username: uname('gap_y') });

    await putPerms(id, { users: [a.id] }).expect(200);
    await putPerms(id, { users: [b.id] }).expect(200);

    const audit = await db.query(
      `SELECT details FROM audit_trail
       WHERE action='PERMISSION_GRANT' AND target_type='ZONE' AND target_id=$1
       ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    assert.equal(audit.rows.length, 1);
    const details = audit.rows[0].details;
    assert.deepEqual(details.before.users, [a.id], 'before reflects the prior set');
    assert.deepEqual(details.after.users, [b.id], 'after reflects the new set');

    // And the live permission set matches the after diff (committed together).
    const live = await getPerms(id).expect(200);
    assert.deepEqual(live.body.data.users, [b.id]);
  });
});
