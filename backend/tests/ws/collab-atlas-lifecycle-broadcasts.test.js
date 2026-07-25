// Path: tests/ws/collab-atlas-lifecycle-broadcasts.test.js
// Item 72. collab-broadcasts.test.js pins three of the atlas module's five broadcasts
// (atlas_deleted, atlas_updated, atlas_settings_updated) and leaves out the two most
// consequential ones:
//
//   atlas_owner_changed — the signal that makes every peer re-resolve its role and
//     re-gate the UI after a transfer. Without it the ex-owner keeps an owner UI until
//     the ~30s heartbeat sweep reconciles, and nothing anywhere goes red.
//   map_duplicated — the ONLY notice that a new map exists, since ordinary map
//     creation travels as a sync operation and this route does not.
//
// The ordering case asserts against Postgres, the authority, rather than against two
// clients agreeing with each other.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

const settle = () => new Promise((r) => setTimeout(r, 600));

describe('atlas lifecycle broadcasts: map_duplicated and atlas_owner_changed', () => {
  let app, db, server, owner, ownerToken, member, memberToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));

    const tag = randomUUID().slice(0, 8);
    owner = await createUser(db, { username: `wsatlas_owner_${tag}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    member = await createUser(db, { username: `wsatlas_member_${tag}` });
    memberToken = await loginUser(app, member.username, member.password);
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  it('map_duplicated carries the id of the map the 201 body returned', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `dup ${randomUUID().slice(0, 6)}` });
    const map = await createMap(db, atlas.id);
    await createShare(db, atlas.id, member.id, 'write', owner.id);

    const peer = await createWsClient(server, atlas.id, memberToken);
    await peer.waitForType('connected');
    peer.clearMessages();

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${map.id}/duplicate`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);

    const msg = await peer.waitForType('map_duplicated', 3000);
    assert.equal(msg.mapId, res.body.data.id);
    assert.notEqual(msg.mapId, map.id, 'the duplicate is a NEW map, not the source');

    peer.close();
  });

  it('atlas_owner_changed reaches the peer, and Postgres already shows the new owner', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `xfer ${randomUUID().slice(0, 6)}` });
    await createShare(db, atlas.id, member.id, 'write', owner.id);

    const peer = await createWsClient(server, atlas.id, memberToken);
    await peer.waitForType('connected');
    peer.clearMessages();

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/transfer`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ newOwnerId: member.id })
      .expect(200);

    const msg = await peer.waitForType('atlas_owner_changed', 3000);
    assert.equal(msg.atlasId, atlas.id);
    assert.equal(msg.newOwnerId, member.id);

    const { rows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(
      rows[0].owner_id, member.id,
      'by the time the signal is observable the write has already committed'
    );

    peer.close();
  });

  it('neither message escapes the room: a client on another atlas hears nothing', async () => {
    const target = await createAtlas(db, owner.id, { name: `scoped ${randomUUID().slice(0, 6)}` });
    const map = await createMap(db, target.id);
    await createShare(db, target.id, member.id, 'write', owner.id);

    const other = await createAtlas(db, owner.id, { name: `bystander ${randomUUID().slice(0, 6)}` });
    await createShare(db, other.id, member.id, 'write', owner.id);

    const bystander = await createWsClient(server, other.id, memberToken);
    await bystander.waitForType('connected');
    bystander.clearMessages();

    await supertest(app)
      .post(`/api/v1/atlas/${target.id}/maps/${map.id}/duplicate`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    await supertest(app)
      .post(`/api/v1/atlas/${target.id}/transfer`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ newOwnerId: member.id })
      .expect(200);

    await settle();
    assert.equal(bystander.getMessagesOfType('map_duplicated').length, 0);
    assert.equal(bystander.getMessagesOfType('atlas_owner_changed').length, 0);

    bystander.close();
  });
});
