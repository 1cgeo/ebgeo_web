// Path: tests/integration/catalogo3d-access.test.js
// Fase 4 Tarefa 3: 3D catalog access filter embedded in SQL (public vs.
// admin/direct-permission) with count aligned. Negative case is mandatory.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('Catálogo 3D — access filter', () => {
  let app, db, user, admin, userToken, adminToken, privateId;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'cat3d_user' });
    admin = await createAdminUser(db, { username: 'cat3d_admin' });
    userToken = await loginUser(app, user.username, user.password);
    adminToken = await loginUser(app, admin.username, admin.password);

    await db.query(`INSERT INTO ng.catalogo_3d (name, type, access_level) VALUES ('Public Model', 'Tiles 3D', 'public')`);
    const priv = await db.query(`INSERT INTO ng.catalogo_3d (name, type, access_level) VALUES ('Secret Model', 'Tiles 3D', 'private') RETURNING id`);
    privateId = priv.rows[0].id;
  });

  after(async () => {
    // Clean up catalog rows so the shared DB does not contaminate other files'
    // catalog-count assertions (the test DB is shared across test files).
    await db.query(`DELETE FROM ng.catalogo_3d WHERE name IN ('Public Model','Secret Model','Point Cloud')`);
    await teardownTestEnv(db);
  });

  it('shows a private model via GROUP permission, with count aligned (model_group_permissions branch)', async () => {
    // A private model becomes visible if the user belongs to a group holding a
    // model_group_permissions row. The group branch is duplicated in CATALOGO_SELECT
    // AND CATALOGO_COUNT; this pins both (a JOIN regression or SELECT/COUNT drift on
    // the group branch would leak a model or make the count lie about pagination).
    const groupUser = await createUser(db, { username: 'cat3d_group_user' });
    const groupTok = await loginUser(app, groupUser.username, groupUser.password);

    // Negative baseline: a brand-new user (no direct, no group) must not see it.
    let res = await list(groupTok);
    assert.ok(!res.body.data.some((m) => m.name === 'Secret Model'), 'no access before the group is granted');

    const { rows: grp } = await db.query(`INSERT INTO ng.groups (name) VALUES ('Cat3D Group') RETURNING id`);
    const groupId = grp[0].id;
    await db.query(`INSERT INTO ng.user_groups (user_id, group_id) VALUES ($1, $2)`, [groupUser.id, groupId]);
    await db.query(`INSERT INTO ng.model_group_permissions (group_id, model_id) VALUES ($1, $2)`, [groupId, privateId]);

    res = await list(groupTok);
    assert.ok(res.body.data.some((m) => m.name === 'Secret Model'), 'group member must see the private model');
    assert.equal(res.body.total, res.body.data.length, 'count must align with data on the group branch');
  });

  const list = (token) =>
    supertest(app).get('/api/v1/nomes/catalogo3d').set('Authorization', `Bearer ${token}`).expect(200);

  it('hides a private model from a user without permission (count aligned)', async () => {
    const res = await list(userToken);
    const names = res.body.data.map((m) => m.name);
    assert.ok(names.includes('Public Model'));
    assert.ok(!names.includes('Secret Model'));
    assert.equal(res.body.total, res.body.data.length); // count not lying
  });

  it('shows a private model to a global admin', async () => {
    const res = await list(adminToken);
    assert.ok(res.body.data.some((m) => m.name === 'Secret Model'));
  });

  it('shows a private model after a direct permission is granted', async () => {
    await db.query(`INSERT INTO ng.model_permissions (user_id, model_id) VALUES ($1, $2)`, [user.id, privateId]);
    const res = await list(userToken);
    assert.ok(res.body.data.some((m) => m.name === 'Secret Model'));
  });

  it('preserves JSONB style as an object (Cesium3DTileStyle)', async () => {
    await db.query(
      `INSERT INTO ng.catalogo_3d (name, type, access_level, style)
       VALUES ('Point Cloud', 'Nuvem de Pontos', 'public', $1::jsonb)`,
      [JSON.stringify({ pointSize: 3, color: "color('white')" })]
    );
    const res = await list(adminToken);
    const pc = res.body.data.find((m) => m.name === 'Point Cloud');
    assert.equal(typeof pc.style, 'object');
    assert.equal(pc.style.pointSize, 3);
  });
});
