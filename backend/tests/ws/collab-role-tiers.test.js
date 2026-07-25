// Path: tests/ws/collab-role-tiers.test.js
// Item 58 (+ the WS half of item 66, testes-backend.md).
//
// The frontend gates its ENTIRE UI on the six roles of session-context.js, and the
// only channels that carry that role are the `connected` frame (collab.gateway.js:413)
// and the `sharing_updated` broadcast (sharing.controller.js:39,57). Before this file
// no test asserted `role` for the middle tiers: collab-roles.test.js covers
// owner/write/read/admin and collab-broadcasts.test.js asserts `permission` but never
// `role`. Deleting toFrontendRole from both call sites left everything green while a
// connected co-Gestor silently re-gated its UI as a viewer.
//
// A unit test on roles.js cannot replace this: if the gateway resolved the WRONG
// permission before calling the mapper, the unit test would still be green and the
// co-Gestor would still show up as 'viewer'. This asserts the value that crosses the
// wire, from a real share.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

/** Stored permission -> the role the frontend must receive over the wire. */
const TIERS = [
  { permission: 'manage', role: 'manager' },
  { permission: 'comment', role: 'commenter' },
  { permission: 'write', role: 'editor' },
  { permission: 'read', role: 'viewer' },
];

describe('WebSocket collab — the frontend role that crosses the wire', () => {
  let app, db, server, atlas, map, owner, ownerToken;
  /** @type {Record<string, {user: Object, token: string}>} permission -> principal */
  const peers = {};
  let openClients;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: `rt_owner_${randomUUID().slice(0, 6)}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Role Tiers Atlas' });
    map = await createMap(db, atlas.id);

    for (const { permission } of TIERS) {
      const u = await createUser(db, { username: `rt_${permission}_${randomUUID().slice(0, 6)}` });
      await createShare(db, atlas.id, u.id, permission, owner.id);
      peers[permission] = { user: u, token: await loginUser(app, u.username, u.password) };
    }
  });

  beforeEach(() => {
    openClients = [];
  });

  afterEach(() => {
    for (const c of openClients) {
      try {
        if (c.ws && c.ws.readyState <= 1) c.ws.terminate();
      } catch {
        /* already gone */
      }
    }
    openClients = [];
  });

  after(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    await teardownTestEnv(db);
  });

  async function connect(token, clientId) {
    const client = await createWsClient(server, atlas.id, token, clientId);
    openClients.push(client);
    return client;
  }

  it('the `connected` frame carries permission AND role for every tier, manage/comment included', async () => {
    assert.equal(TIERS.length, 4, 'the table must cover every shareable tier');
    for (const { permission, role } of TIERS) {
      const client = await connect(peers[permission].token, `rt-${permission}`);
      const connected = await client.waitForType('connected');
      assert.equal(connected.permission, permission, `${permission}: frozen permission field`);
      assert.equal(connected.role, role, `${permission}: frontend role field`);
      client.close();
    }
  });

  it('a co-Gestor is NOT announced as a viewer — the exact value the closed-list bug produces', async () => {
    const client = await connect(peers.manage.token, 'rt-manage-neg');
    const connected = await client.waitForType('connected');
    assert.notEqual(connected.role, 'viewer', 'the co-Gestor must never be downgraded to viewer');
    assert.notEqual(connected.role, undefined, 'the role field must exist at all');
    assert.equal(connected.role, 'manager');
  });

  it('the atlas owner and a global admin get their own roles, not a share tier', async () => {
    const ownerClient = await connect(ownerToken, 'rt-owner');
    const ownerConnected = await ownerClient.waitForType('connected');
    assert.equal(ownerConnected.permission, 'owner');
    assert.equal(ownerConnected.role, 'owner');
    ownerClient.close();

    const admin = await createUser(db, { username: `rt_admin_${randomUUID().slice(0, 6)}`, role: 'admin' });
    const adminToken = await loginUser(app, admin.username, admin.password);
    const adminClient = await connect(adminToken, 'rt-admin');
    const adminConnected = await adminClient.waitForType('connected');
    assert.equal(adminConnected.role, 'admin', 'the global-admin short-circuit wins over the share tier');
    adminClient.close();
  });

  it('promoting read -> manage broadcasts sharing_updated with role "manager" to a connected peer', async () => {
    const target = await createUser(db, { username: `rt_promo_${randomUUID().slice(0, 6)}` });
    await createShare(db, atlas.id, target.id, 'read', owner.id);

    const observer = await connect(ownerToken, 'rt-observer-promo');
    await observer.waitForType('connected');
    observer.clearMessages();

    await supertest(app)
      .put(`/api/v1/atlas/${atlas.id}/sharing/users/${target.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ permission: 'manage' })
      .expect(200);

    const msg = await observer.waitForType('sharing_updated');
    assert.equal(msg.action, 'user_updated');
    assert.equal(msg.userId, target.id);
    assert.equal(msg.permission, 'manage');
    assert.equal(msg.role, 'manager', 'the peer must re-gate the UI as co-Gestor, not as viewer');
    observer.close();
  });

  it('granting a "comment" share broadcasts role "commenter"', async () => {
    const target = await createUser(db, { username: `rt_newcmt_${randomUUID().slice(0, 6)}` });

    const observer = await connect(ownerToken, 'rt-observer-add');
    await observer.waitForType('connected');
    observer.clearMessages();

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: target.id, permission: 'comment' })
      .expect(201);

    const msg = await observer.waitForType('sharing_updated');
    assert.equal(msg.action, 'user_added');
    assert.equal(msg.userId, target.id);
    assert.equal(msg.permission, 'comment');
    assert.equal(msg.role, 'commenter');
    observer.close();
  });

  // ---------------------------------------------------------------------------
  // Item 66, WS half: the co-Gestor writes entities through the socket, not only
  // through POST /sync. manage-tier-cogestor.test.js pins the REST path; the WS
  // path had no manage-tier coverage at all.
  // ---------------------------------------------------------------------------

  it('a co-Gestor pushing an `operation` over the socket is acked AND the row lands in Postgres', async () => {
    const client = await connect(peers.manage.token, 'rt-manage-op');
    await client.waitForType('connected');
    client.clearMessages();

    const targetId = randomUUID();
    client.send({
      type: 'operation',
      op: {
        id: randomUUID(),
        type: 'create',
        target: 'feature',
        targetId,
        mapId: map.id,
        data: {
          feature_type: 'point',
          geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
          properties: { id: targetId, nome: 'ponto do co-Gestor via WS' },
        },
        timestamp: Date.now(),
        clientId: 'rt-manage-op',
      },
    });

    const ack = await client.waitForType('ack');
    assert.equal(ack.result?.success, true, `ack must report success, got ${JSON.stringify(ack)}`);
    assert.equal(typeof ack.serverVersion, 'number', 'the ack must carry the server ordering');

    // The ack alone would not prove the write: assert the effect in the database.
    const { rows } = await db.query('SELECT id, map_id FROM features WHERE id = $1', [targetId]);
    assert.equal(rows.length, 1, 'the co-Gestor feature must exist');
    assert.equal(rows[0].map_id, map.id);
    client.close();
  });

  it('a Comentarista pushing a FEATURE operation over the socket writes nothing — negative control', async () => {
    // Without this the test above could be green on a gate that lets everyone write.
    const client = await connect(peers.comment.token, 'rt-comment-op');
    await client.waitForType('connected');
    client.clearMessages();

    const targetId = randomUUID();
    client.send({
      type: 'operation',
      op: {
        id: randomUUID(),
        type: 'create',
        target: 'feature',
        targetId,
        mapId: map.id,
        data: {
          feature_type: 'point',
          geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
          properties: { id: targetId },
        },
        timestamp: Date.now(),
        clientId: 'rt-comment-op',
      },
    });

    // Whatever the frame is (error or a failed ack), the row must not exist.
    await new Promise((r) => setTimeout(r, 400));
    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [targetId]);
    assert.equal(rows.length, 0, 'a comment-tier principal must not create features');
    client.close();
  });
});
