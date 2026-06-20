// Path: tests/ws/collab-roles.test.js
// Fase 1 Tarefa 10: the `connected` message exposes the frontend role
// vocabulary (owner/editor/viewer/admin) derived from the per-atlas permission
// and the global role, alongside the frozen `permission` field.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

describe('WebSocket — role vocabulary in connected', () => {
  let app, db, server, owner, writer, reader, admin, atlas;
  let ownerToken, writerToken, readerToken, adminToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: 'role_owner' });
    writer = await createUser(db, { username: 'role_writer' });
    reader = await createUser(db, { username: 'role_reader' });
    admin = await createAdminUser(db, { username: 'role_admin' });

    ownerToken = await loginUser(app, owner.username, owner.password);
    writerToken = await loginUser(app, writer.username, writer.password);
    readerToken = await loginUser(app, reader.username, reader.password);
    adminToken = await loginUser(app, admin.username, admin.password);

    atlas = await createAtlas(db, owner.id, { name: 'Roles Atlas' });
    await db.query(`INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1,$2,'write',$3)`, [atlas.id, writer.id, owner.id]);
    await db.query(`INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1,$2,'read',$3)`, [atlas.id, reader.id, owner.id]);
    // Global admin connects as a writer-shared user; role must resolve to 'admin'.
    await db.query(`INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1,$2,'write',$3)`, [atlas.id, admin.id, owner.id]);
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  async function roleFor(token) {
    const client = await createWsClient(server, atlas.id, token);
    const connected = await client.waitForType('connected');
    client.close();
    return connected;
  }

  it('owner -> role owner', async () => {
    const c = await roleFor(ownerToken);
    assert.equal(c.permission, 'owner');
    assert.equal(c.role, 'owner');
  });

  it('write share -> role editor', async () => {
    const c = await roleFor(writerToken);
    assert.equal(c.permission, 'write');
    assert.equal(c.role, 'editor');
  });

  it('read share -> role viewer', async () => {
    const c = await roleFor(readerToken);
    assert.equal(c.permission, 'read');
    assert.equal(c.role, 'viewer');
  });

  it('global admin -> role admin (even with a lower per-atlas permission)', async () => {
    const c = await roleFor(adminToken);
    assert.equal(c.permission, 'write');
    assert.equal(c.role, 'admin');
  });
});
