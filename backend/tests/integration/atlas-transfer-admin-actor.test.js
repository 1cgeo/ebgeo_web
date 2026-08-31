// Path: tests/integration/atlas-transfer-admin-actor.test.js
// Item 1. `requireAtlasPermission` synthesizes 'owner' for any GLOBAL admin
// (permissions.js), so an admin passes the owner-only gate of POST /:atlasId/transfer
// without being the owner. The controller then deliberately demotes
// `req.atlasOwnerId` — the REAL owner — and not `req.user.id`, and says so in a
// comment (atlas.controller.js:76-78).
//
// Every existing transfer test is fired by the owner themselves, where
// req.user.id === req.atlasOwnerId and the two branches are indistinguishable: the
// suite passes with and without the fix. If someone "simplified" it to req.user.id,
// the admin would collect the 'manage' share and the real owner would lose their
// project silently — nothing would go red.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createAtlas, createShare, loginUser,
} from '../helpers/fixtures.js';

describe('ownership transfer fired by a GLOBAL admin acting on someone else\'s atlas', () => {
  let app, db, owner, ownerToken, member, memberToken, admin, adminToken, outsider;

  const sharesOf = async (atlasId) => {
    const { rows } = await db.query(
      'SELECT user_id, permission FROM atlas_shares WHERE atlas_id = $1 ORDER BY permission',
      [atlasId]
    );
    return rows;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const tag = randomUUID().slice(0, 8);
    owner = await createUser(db, { username: `p1_owner_${tag}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    member = await createUser(db, { username: `p1_member_${tag}` });
    memberToken = await loginUser(app, member.username, member.password);
    outsider = await createUser(db, { username: `p1_outsider_${tag}` });
    admin = await createAdminUser(db, { username: `p1_admin_${tag}` });
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('demotes the REAL owner, never the admin who fired the request', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `P1 ${randomUUID().slice(0, 6)}` });
    await createShare(db, atlas.id, member.id, 'write', owner.id);

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/transfer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newOwnerId: member.id })
      .expect(200);

    const { rows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(rows[0].owner_id, member.id, 'the member is the new owner');

    const shares = await sharesOf(atlas.id);
    assert.equal(shares.length, 1, 'exactly one share row survives the transfer');
    assert.equal(shares[0].user_id, owner.id, 'it belongs to the EX-OWNER, not the admin');
    assert.equal(shares[0].permission, 'manage');
  });

  it('the admin collects no share of their own from the transfer', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `P1 ${randomUUID().slice(0, 6)}` });
    await createShare(db, atlas.id, member.id, 'write', owner.id);

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/transfer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newOwnerId: member.id })
      .expect(200);

    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
      [atlas.id, admin.id]
    );
    assert.equal(rows[0].n, 0, 'an admin transferring a project must not acquire it');
  });

  it('the ex-owner keeps manage but loses owner: PATCH settings 200, DELETE atlas 403', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `P1 ${randomUUID().slice(0, 6)}` });
    await createShare(db, atlas.id, member.id, 'write', owner.id);

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/transfer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newOwnerId: member.id })
      .expect(200);

    await supertest(app)
      .patch(`/api/v1/atlas/${atlas.id}/settings`)
      .set('Authorization', `Bearer ${ownerToken}`)
      // A chave era `min_zoom` até 2026-08-31, quando o zoom de atlas foi removido. O caso
      // mede que o DONO ANTIGO ainda administra o atlas transferido, e um PATCH cuja única
      // chave é descartada pelo `stripUnknown` devolve 200 sem escrever nada: passaria mesmo
      // se a permissão estivesse quebrada. Uma chave viva faz a rota gravar de fato.
      .send({ bounds_2d: [[-45, -23], [-42, -21]] })
      .expect(200);

    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(403);

    // And the new owner really does hold the top level.
    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(204);
  });

  it('the admin does not bypass the business rule: a NON-member target is refused', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `P1 ${randomUUID().slice(0, 6)}` });
    await createShare(db, atlas.id, member.id, 'write', owner.id);

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/transfer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newOwnerId: outsider.id })
      .expect(400);

    const { rows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(rows[0].owner_id, owner.id, 'ownership untouched');
  });

  it('the self-transfer guard compares against the REAL owner, not the acting admin', async () => {
    // The admin is not the owner, so `newOwnerId === req.user.id` would be false here.
    // The BadRequest can only come from comparing against req.atlasOwnerId.
    const atlas = await createAtlas(db, owner.id, { name: `P1 ${randomUUID().slice(0, 6)}` });
    await createShare(db, atlas.id, member.id, 'write', owner.id);

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/transfer`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newOwnerId: owner.id })
      .expect(400);

    assert.match(res.body.error.message, /dono atual/i);
    const { rows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(rows[0].owner_id, owner.id);
  });
});
