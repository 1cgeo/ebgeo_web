import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';
import { attachWebSocket, closeAllSockets } from '../../src/modules/collab/collab.gateway.js';
import { broadcastToRoom, getRoomClients } from '../../src/modules/collab/collab.rooms.js';
import { createWsClient } from '../helpers/ws-client.js';

describe('sharing privacy at credential, cache and revocation boundaries', () => {
  let app, db, server, owner, outsider, ownerToken, outsiderToken, atlas, adminToken, admin;
  const suffix = randomUUID().slice(0, 8);
  const resource = `privacy-${suffix}`;
  const request = (method, path, token = ownerToken) => supertest(app)[method](path)
    .set('Authorization', `Bearer ${token}`);
  before(async () => {
    ({ app, db } = await setupTestEnv());
    owner = await createUser(db, { username: `privacy_owner_${suffix}` });
    outsider = await createUser(db, { username: `privacy_other_${suffix}` });
    admin = await createAdminUser(db, { username: `privacy_admin_${suffix}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    outsiderToken = await loginUser(app, outsider.username, outsider.password);
    adminToken = await loginUser(app, admin.username, admin.password);
    atlas = await createAtlas(db, owner.id);
    await db.query("INSERT INTO tilesets (id, name, config, access_level) VALUES ($1, $1, '{}', 'private')", [resource]);
    server = createServer(app);
    attachWebSocket(server);
    await new Promise(resolve => server.listen(0, resolve));
  });
  after(async () => {
    await closeAllSockets();
    if (server) await new Promise(resolve => server.close(resolve));
    await teardownTestEnv(db);
  });

  it('an explicit bearer cannot inherit a different account from an ambient cookie', async () => {
    await request('get', `/api/v1/atlas/${atlas.id}/sharing`, outsiderToken)
      .set('Cookie', `token=${ownerToken}`).expect(404);
  });

  it('an invalid bearer cannot authorize a write using the cookie account', async () => {
    await request('post', `/api/v1/atlas/${atlas.id}/sharing/public`, 'invalid')
      .set('Cookie', `token=${ownerToken}`).expect(401);
  });

  it('sharing membership and resource grants prohibit shared caching', async () => {
    const shares = await request('get', `/api/v1/atlas/${atlas.id}/sharing`).expect(200);
    const grants = await request('get', `/api/v1/resource-access/tileset/${resource}/grants`, adminToken).expect(200);
    const group = (await request('post', '/api/v1/access-groups').send({ name: `Cache ${suffix}` }).expect(201)).body.data;
    const groups = await request('get', '/api/v1/access-groups').expect(200);
    const participating = await request('get', '/api/v1/access-groups/participating').expect(200);
    const members = await request('get', `/api/v1/access-groups/${group.id}/members`).expect(200);
    for (const response of [shares, grants, groups, participating, members]) {
      assert.match(response.headers['cache-control'] || '', /private|no-store/);
      assert.match(response.headers.vary || '', /Cookie/i);
    }
  });

  it('a demoted administrator immediately loses atlas access on flexible-only resource routes', async () => {
    await request('get', `/api/v1/sv360/projects?atlasId=${atlas.id}`, adminToken).expect(200);
    await db.query("UPDATE users SET role = 'user' WHERE id = $1", [admin.id]);
    try {
      await request('get', `/api/v1/sv360/projects?atlasId=${atlas.id}`, adminToken).expect(404);
    } finally {
      await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.id]);
    }
  });

  it('a cut session cannot continue borrowing resources through a still-live share', async () => {
    const member = await createUser(db, { username: `privacy_cut_${suffix}` });
    const token = await loginUser(app, member.username, member.password);
    await createShare(db, atlas.id, member.id, 'read', owner.id);
    await request('get', `/api/v1/sv360/projects?atlasId=${atlas.id}`, token).expect(200);
    await db.query('UPDATE users SET sessions_valid_from = NOW() WHERE id = $1', [member.id]);
    await request('get', `/api/v1/sv360/projects?atlasId=${atlas.id}`, token).expect(404);
  });

  it('a revoked socket cannot receive subsequent broadcasts before the next heartbeat', async () => {
    const privateAtlas = await createAtlas(db, owner.id);
    await createShare(db, privateAtlas.id, outsider.id, 'manage', owner.id);
    const client = await createWsClient(server, privateAtlas.id, outsiderToken);
    try {
      await client.waitForType('connected');
      await request('delete', `/api/v1/atlas/${privateAtlas.id}/sharing/users/${outsider.id}`).expect(204);
      const sent = broadcastToRoom(privateAtlas.id, { type: 'private_after_revocation', secret: suffix });
      assert.equal(sent.sent, 0, 'HTTP revocation must stop server delivery, independently of cooperative UI');
    } finally { client.close(); }
  });

  it('a downgraded manager immediately loses the management broadcast audience', async () => {
    const privateAtlas = await createAtlas(db, owner.id);
    await createShare(db, privateAtlas.id, outsider.id, 'manage', owner.id);
    const client = await createWsClient(server, privateAtlas.id, outsiderToken);
    try {
      await client.waitForType('connected');
      await request('put', `/api/v1/atlas/${privateAtlas.id}/sharing/users/${outsider.id}`)
        .send({ permission: 'read' }).expect(200);
      assert.equal([...getRoomClients(privateAtlas.id)][0]?.permission, 'read');
      assert.equal(broadcastToRoom(privateAtlas.id, { type: 'management_secret' }, null, { minPermission: 'manage' }).sent, 0);
    } finally { client.close(); }
  });

  it('removing group membership preserves a direct lower role and updates the live socket', async () => {
    const privateAtlas = await createAtlas(db, owner.id);
    await createShare(db, privateAtlas.id, outsider.id, 'read', owner.id);
    const group = (await request('post', '/api/v1/access-groups').send({ name: `Privacy ${suffix}` }).expect(201)).body.data;
    await request('post', `/api/v1/access-groups/${group.id}/members`).send({ userId: outsider.id }).expect(200);
    await request('post', `/api/v1/atlas/${privateAtlas.id}/sharing/groups`)
      .send({ groupId: group.id, permission: 'manage' }).expect(201);
    const client = await createWsClient(server, privateAtlas.id, outsiderToken);
    try {
      await client.waitForType('connected');
      await request('delete', `/api/v1/access-groups/${group.id}/members/${outsider.id}`).expect(200);
      assert.equal([...getRoomClients(privateAtlas.id)][0]?.permission, 'read');
      assert.equal((await client.waitForType('sharing_updated')).permission, 'read');
      await request('post', `/api/v1/access-groups/${group.id}/members`).send({ userId: outsider.id }).expect(200);
      assert.equal([...getRoomClients(privateAtlas.id)][0]?.permission, 'manage');
      await request('delete', `/api/v1/access-groups/${group.id}`).expect(200);
      assert.equal([...getRoomClients(privateAtlas.id)][0]?.permission, 'read');
    } finally { client.close(); }
  });

  it('unpublishing closes public visitors while preserving the owner connection', async () => {
    const privateAtlas = await createAtlas(db, owner.id);
    const published = await request('post', `/api/v1/atlas/${privateAtlas.id}/sharing/public`).expect(200);
    const { getPublicToken } = await import('../helpers/fixtures.js');
    const token = await getPublicToken(app, published.body.data.publicLink);
    const visitor = await createWsClient(server, privateAtlas.id, token);
    const host = await createWsClient(server, privateAtlas.id, ownerToken);
    try {
      await Promise.all([visitor.waitForType('connected'), host.waitForType('connected')]);
      await request('delete', `/api/v1/atlas/${privateAtlas.id}/sharing/public`).expect(204);
      const sent = broadcastToRoom(privateAtlas.id, { type: 'private_after_unpublish' });
      assert.equal(sent.sent, 1);
      await request('get', `/api/v1/atlas/${privateAtlas.id}`, token).expect(404);
    } finally { visitor.close(); host.close(); }
  });
});
