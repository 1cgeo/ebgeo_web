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
    // A org vem do BANCO, nao do claim do socket: reconcileAuthorization le
    // getLiveAuthState(userId). Por isso o usuario precisa REALMENTE pertencer a
    // org desativada — um socket que apenas alega pertencer a ela e ignorado, e
    // isso e a intencao: o token pode estar velho, o banco e a fonte de verdade.
    const { rows } = await db.query(
      `INSERT INTO organizations (nome, slug, is_active) VALUES ($1, $2, false) RETURNING id`,
      ['Dead OM', `dead-om-${randomUUID().slice(0, 8)}`]
    );
    const deadOrgId = rows[0].id;
    const doomed = await createUser(db, { username: `reauthz_org_${randomUUID().slice(0, 6)}` });
    await db.query('UPDATE users SET organization_id = $1 WHERE id = $2', [deadOrgId, doomed.id]);
    await createShare(db, atlas.id, doomed.id, 'read', owner.id);

    const ws = fakeSocket({ atlasId: atlas.id, userId: doomed.id, permission: 'read', organizationId: deadOrgId });
    await reconcileAuthorization(ws);
    assert.equal(ws.closed?.code, 4003, 'a member of a deactivated org must be disconnected');
  });

  it('CLOSES the socket (4003) when the USER is deactivated (P1 alcanca o WS)', async () => {
    // O gate P1 vivia so no `auth` estrito do HTTP: um socket JA ABERTO sobrevivia
    // a desativacao da conta indefinidamente, porque deleteUser revoga apenas o
    // refresh token e o sweep nunca reexaminava users.is_active.
    const doomed = await createUser(db, { username: `reauthz_off_${randomUUID().slice(0, 6)}` });
    await createShare(db, atlas.id, doomed.id, 'write', owner.id);
    const ws = fakeSocket({ atlasId: atlas.id, userId: doomed.id, permission: 'write' });

    await reconcileAuthorization(ws);
    assert.equal(ws.closed, null, 'conta ativa permanece conectada');

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [doomed.id]);
    await reconcileAuthorization(ws);
    assert.equal(ws.closed?.code, 4003, 'uma conta desativada deve ser desconectada');
  });

  it('adota o papel global VIVO — admin rebaixado perde o acesso owner', async () => {
    // resolvePermission devolve 'owner' em QUALQUER atlas quando role === 'admin'.
    // Antes o papel vinha do payload do token (ws.userRole), entao um admin
    // rebaixado mantinha acesso total ate o token expirar.
    const demoted = await createUser(db, { username: `reauthz_adm_${randomUUID().slice(0, 6)}` });
    await db.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [demoted.id]);
    const ws = fakeSocket({ atlasId: atlas.id, userId: demoted.id, permission: 'read', userRole: 'admin' });

    await reconcileAuthorization(ws);
    assert.equal(ws.permission, 'owner', 'admin global resolve como owner');

    await db.query(`UPDATE users SET role = 'user' WHERE id = $1`, [demoted.id]);
    await reconcileAuthorization(ws);
    assert.equal(ws.closed?.code, 4003, 'sem share e sem admin, o socket cai');
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
