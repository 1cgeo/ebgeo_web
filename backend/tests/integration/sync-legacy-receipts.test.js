import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';
import { cleanupOldOperations } from '../../src/modules/sync/sync.service.js';
import { operationDigest } from '../../src/modules/sync/sync-receipts.js';

describe('Read-only reconciliation of old sync intentions', () => {
  let app, db, atlas, token, otherToken, owner, other;
  before(async () => {
    ({ app, db } = await setupTestEnv());
    owner = await createUser(db, { username: 'legacy_receipt_owner' });
    token = await loginUser(app, owner.username, owner.password);
    other = await createUser(db, { username: 'legacy_receipt_other' });
    otherToken = await loginUser(app, other.username, other.password);
    atlas = await createAtlas(db, owner.id);
  });
  after(async () => teardownTestEnv(db));
  const operation = () => ({ id: randomUUID(), entityType: 'map', operationType: 'create',
    entityId: randomUUID(), data: { name: 'Mapa legado' }, timestamp: 1, clientId: 'legacy-receipt-client' });
  const lookup = (operations, auth = token) => supertest(app).post(`/api/v1/atlas/${atlas.id}/sync/receipts`)
    .set('Authorization', `Bearer ${auth}`).send({ operations });
  // Simulate the existing receipt of a pre-upgrade server. The current write
  // border refuses old envelopes, so historical data is seeded explicitly.
  const push = async op => {
    const result = (await supertest(app).post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`).send({ operations: [{ ...op, protocolVersion: 2 }] }).expect(200)).body.data;
    if (op.protocolVersion !== 2) {
      await db.query('UPDATE sync_receipts SET payload_hash=$3 WHERE atlas_id=$1 AND op_id=$2',
        [atlas.id, op.id, operationDigest(op)]);
    }
    return result;
  };
  const counts = async () => (await db.query(`SELECT current_version,
    (SELECT count(*) FROM operations WHERE atlas_id=$1) AS operations,
    (SELECT count(*) FROM sync_receipts WHERE atlas_id=$1) AS receipts,
    (SELECT count(*) FROM maps WHERE atlas_id=$1) AS maps FROM atlas WHERE id=$1`, [atlas.id])).rows[0];

  it('unknown delivery never executes the old intention or creates a receipt', async () => {
    const op = operation();
    const before = await counts();
    const response = await lookup([op]).expect(200);
    assert.deepEqual(response.body.data.results, [{ opId: op.id, status: 'unknown' }]);
    assert.deepEqual(await counts(), before);
    assert.equal(response.headers['cache-control'], 'no-store');
  });

  it('confirms only identical author/content, even after replay cleanup, without rewriting advanced data', async () => {
    const op = operation();
    const applied = await push(op);
    assert.equal(applied.results[0].status, 'applied');
    await db.query('UPDATE maps SET name=$2 WHERE id=$1', [op.entityId, 'Mais avançado']);
    await cleanupOldOperations(atlas.id, { keepFromVersion: applied.serverVersion + 1 });
    const before = await counts();
    assert.deepEqual((await lookup([op]).expect(200)).body.data.results, [{ opId: op.id, status: 'confirmed' }]);
    assert.deepEqual((await lookup([{ ...op, data: { name: 'Outro conteúdo' } }]).expect(200)).body.data.results,
      [{ opId: op.id, status: 'unknown' }]);
    assert.deepEqual(await counts(), before);
    assert.equal((await db.query('SELECT name FROM maps WHERE id=$1', [op.entityId])).rows[0].name, 'Mais avançado');
  });

  it('does not disclose receipts to a principal without atlas access', async () => {
    const op = operation();
    await push(op);
    const response = await lookup([op], otherToken);
    assert.equal(response.status, 404);
    assert.equal(response.body.data, undefined);
  });

  it('does not treat refused legacy work as confirmed delivery', async () => {
    const op = { ...operation(), entityType: 'feature', protocolVersion: 2, operationType: 'update' };
    const result = await push(op);
    assert.equal(result.results[0].rejected, true);
    assert.deepEqual((await lookup([op]).expect(200)).body.data.results, [{ opId: op.id, status: 'review' }]);
  });

  it('validates bounded batches before reading receipts', async () => {
    await lookup([]).expect(422);
    await lookup(Array.from({ length: 101 }, operation)).expect(422);
  });

  it('does not confirm another writer receipt and stops lookup after access revocation', async () => {
    const op = operation();
    await push(op);
    await createShare(db, atlas.id, other.id, 'write', owner.id);
    assert.deepEqual((await lookup([op], otherToken).expect(200)).body.data.results,
      [{ opId: op.id, status: 'unknown' }]);
    await db.query('DELETE FROM atlas_shares WHERE atlas_id=$1 AND user_id=$2', [atlas.id, other.id]);
    const response = await lookup([op], otherToken);
    assert.equal(response.status, 404);
  });

  it('a downgraded reader can confirm their own delivery without regaining write access', async () => {
    await createShare(db, atlas.id, other.id, 'write', owner.id);
    const op = { ...operation(), protocolVersion: 2 };
    await supertest(app).post(`/api/v1/atlas/${atlas.id}/sync`).set('Authorization', `Bearer ${otherToken}`)
      .send({ operations: [op] }).expect(200);
    await db.query("UPDATE atlas_shares SET permission='read' WHERE atlas_id=$1 AND user_id=$2", [atlas.id, other.id]);
    assert.deepEqual((await lookup([op], otherToken).expect(200)).body.data.results,
      [{ opId: op.id, status: 'confirmed' }]);
    await supertest(app).post(`/api/v1/atlas/${atlas.id}/sync`).set('Authorization', `Bearer ${otherToken}`)
      .send({ operations: [{ ...op, id: randomUUID() }] }).expect(403);
  });
});
