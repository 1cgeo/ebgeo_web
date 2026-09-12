import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import { pushOperations } from '../../src/modules/sync/sync.service.js';
import { handleOperation, handleOperations } from '../../src/modules/collab/collab.handlers.js';

describe('Sync write protocol compatibility at every ingress', () => {
  let app, db, atlas, user, token;
  before(async () => {
    ({ app, db } = await setupTestEnv());
    user = await createUser(db, { username: 'protocol_guard_owner' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
  });
  after(async () => teardownTestEnv(db));
  const operation = () => ({ id: randomUUID(), entityType: 'map', operationType: 'create',
    entityId: randomUUID(), data: { name: 'Incompatível' }, timestamp: 1, clientId: 'protocol-client' });
  const counts = async () => (await db.query(`SELECT current_version,
    (SELECT count(*) FROM operations WHERE atlas_id=$1) AS operations,
    (SELECT count(*) FROM sync_receipts WHERE atlas_id=$1) AS receipts,
    (SELECT count(*) FROM maps WHERE atlas_id=$1) AS maps FROM atlas WHERE id=$1`, [atlas.id])).rows[0];

  it('advertises the current contract to an authorized reader without caching', async () => {
    const response = await supertest(app).get(`/api/v1/atlas/${atlas.id}/sync/protocol`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    assert.deepEqual(response.body.data, { writeVersions: [2], receiptLookup: true });
    assert.equal(response.headers['cache-control'], 'no-store');
  });

  it('refuses missing and unknown versions with 426, without mutating any sibling in a mixed batch', async () => {
    const before = await counts();
    for (const protocolVersion of [undefined, 1, 3, '2', null]) {
      const bad = { ...operation(), protocolVersion };
      const good = { ...operation(), protocolVersion: 2 };
      const response = await supertest(app).post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`).send({ operations: [good, bad] }).expect(426);
      assert.equal(response.body.error.code, 'SYNC_PROTOCOL_INCOMPATIBLE');
      assert.deepEqual(await counts(), before);
    }
  });

  it('cannot bypass the border through direct service calls or either WebSocket frame', async () => {
    const op = operation();
    const before = await counts();
    await assert.rejects(pushOperations(atlas.id, [op], user.id, 'owner'), { statusCode: 426 });
    const messages = [];
    const ws = { atlasId: atlas.id, userId: user.id, permission: 'owner', send: value => messages.push(JSON.parse(value)) };
    await handleOperation(ws, { op });
    await handleOperations(ws, { ops: [{ ...operation(), protocolVersion: 2 }, op] });
    assert.equal(messages.length, 2);
    for (const message of messages) {
      assert.equal(message.type, 'error');
      assert.equal(message.code, 'SYNC_PROTOCOL_INCOMPATIBLE');
      assert.equal(message.retryable, false);
      assert.ok(message.opIds.includes(op.id));
    }
    assert.deepEqual(await counts(), before);
  });

  it('still accepts the current producer contract', async () => {
    const op = { ...operation(), protocolVersion: 2 };
    const response = await supertest(app).post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`).send({ operations: [op] }).expect(200);
    assert.equal(response.body.data.results[0].status, 'applied');
    assert.equal((await db.query('SELECT name FROM maps WHERE id=$1', [op.entityId])).rows[0].name, 'Incompatível');
  });
});
