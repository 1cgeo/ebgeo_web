// Path: tests/ws/collab-reauthz.test.js
// W1 + O1: a collab socket caches its permission at handshake and lives for hours.
// reconcileAuthorization() (run on every heartbeat tick) must re-resolve the live
// authorization so a share downgrade/revoke, an unpublished atlas, or a deactivated
// org takes effect on the OPEN socket. Tested directly against the DB with a fake ws
// (no real socket needed — the heartbeat is 30s, too slow to drive from a test).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createShare, makeAtlasPublic } from '../helpers/fixtures.js';
import { reconcileAuthorization } from '../../src/modules/collab/collab.gateway.js';

// Minimal stand-in for a connected ws: records the last close() call.
function fakeSocket(overrides) {
  return {
    isPublic: false,
    organizationId: null,
    closed: null,
    close(code, reason) { this.closed = { code, reason }; },
    ...overrides,
  };
}

describe('Collab WS live re-authorization (reconcileAuthorization)', () => {
  let db, owner, writer, atlas;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
    owner = await createUser(db, { username: 'reauthz_owner' });
    writer = await createUser(db, { username: 'reauthz_writer' });
    atlas = await createAtlas(db, owner.id);
    await createShare(db, atlas.id, writer.id, 'write', owner.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('keeps a still-valid writer at write and does not close', async () => {
    const ws = fakeSocket({ atlasId: atlas.id, userId: writer.id, permission: 'write' });
    await reconcileAuthorization(ws);
    assert.equal(ws.permission, 'write');
    assert.equal(ws.closed, null);
  });

  it('DOWNGRADES the cached permission when the share is lowered (write→read)', async () => {
    const ws = fakeSocket({ atlasId: atlas.id, userId: writer.id, permission: 'write' });
    await db.query('UPDATE atlas_shares SET permission = $1 WHERE atlas_id = $2 AND user_id = $3', ['read', atlas.id, writer.id]);
    await reconcileAuthorization(ws);
    assert.equal(ws.permission, 'read', 'a downgraded writer must lose write on the open socket');
    assert.equal(ws.closed, null);
  });

  it('CLOSES the socket (4003) when the share is revoked', async () => {
    const ws = fakeSocket({ atlasId: atlas.id, userId: writer.id, permission: 'read' });
    await db.query('DELETE FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2', [atlas.id, writer.id]);
    await reconcileAuthorization(ws);
    assert.equal(ws.closed?.code, 4003, 'a revoked user must be disconnected');
  });

  it('CLOSES the socket (4003) when the member\'s organization is deactivated', async () => {
    const { rows } = await db.query(
      `INSERT INTO organizations (nome, slug, is_active) VALUES ($1, $2, false) RETURNING id`,
      ['Dead OM', `dead-om-${randomUUID().slice(0, 8)}`]
    );
    const deadOrgId = rows[0].id;
    const ws = fakeSocket({ atlasId: atlas.id, userId: owner.id, permission: 'owner', organizationId: deadOrgId });
    await reconcileAuthorization(ws);
    assert.equal(ws.closed?.code, 4003, 'a member of a deactivated org must be disconnected');
  });

  it('owner keeps owner; an unpublished public socket gets closed', async () => {
    // Owner is unaffected by share changes.
    const ownerWs = fakeSocket({ atlasId: atlas.id, userId: owner.id, permission: 'owner' });
    await reconcileAuthorization(ownerWs);
    assert.equal(ownerWs.permission, 'owner');
    assert.equal(ownerWs.closed, null);

    // A public (anonymous) socket survives while the atlas is public, then closes
    // once it is unpublished.
    const pubAtlas = await createAtlas(db, owner.id);
    await makeAtlasPublic(db, pubAtlas.id);
    const pubWs = fakeSocket({ atlasId: pubAtlas.id, userId: `public-${randomUUID()}`, permission: 'read', isPublic: true });
    await reconcileAuthorization(pubWs);
    assert.equal(pubWs.closed, null, 'public socket survives while atlas is public');

    await db.query('UPDATE atlas SET is_public = false, public_link = NULL WHERE id = $1', [pubAtlas.id]);
    await reconcileAuthorization(pubWs);
    assert.equal(pubWs.closed?.code, 4003, 'public socket closes once the atlas is unpublished');
  });
});
