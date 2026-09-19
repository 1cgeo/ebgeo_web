// Path: tests/integration/atomic-atlas-import.test.js
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, unlink, open } from 'node:fs/promises';
import supertest from 'supertest';
import { commitImport } from '../../src/modules/atlas/import-attempt.service.js';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser, createAtlas, makeAtlasPublic, getPublicToken } from '../helpers/fixtures.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
describe('atomic atlas import preparation and publication', () => {
  let app, db, user, token, otherToken;
  const req = (method, path, auth = token) => supertest(app)[method](`/api/v1/atlas${path}`).set('Authorization', `Bearer ${auth}`);
  const fixture = () => {
    const image = randomUUID();
    return { id: randomUUID(), sourceKey: 'a'.repeat(64), imageIds: [image], payload: {
      atlas: { name: 'Atomic import' }, maps: [{ id: randomUUID(), name: 'Map', features: [{ id: image,
        feature_type: 'image', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: image } }] }],
    } };
  };
  const upload = (draft, data = PNG) => req('post', `/imports/${draft.id}/images`).send({ images: [{
    localId: draft.imageIds[0], filename: 'photo.png', mimeType: 'image/png', data,
  }] });
  const count = async () => Number((await db.query('SELECT COUNT(*) FROM atlas WHERE owner_id=$1', [user.id])).rows[0].count);
  before(async () => {
    ({ app, db } = await setupTestEnv());
    user = await createUser(db, { username: `atomic_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, user.username, user.password);
    const other = await createUser(db, { username: `atomic_other_${randomUUID().slice(0, 8)}` });
    otherToken = await loginUser(app, other.username, other.password);
  });
  afterEach(async () => {
    const { rows } = await db.query('SELECT storage_path FROM images WHERE uploaded_by=$1', [user.id]);
    await db.query('DELETE FROM atlas_import_attempts WHERE user_id=$1', [user.id]);
    await db.query('DELETE FROM atlas WHERE owner_id=$1', [user.id]);
    await Promise.all(rows.map(row => unlink(row.storage_path).catch(() => {})));
  });
  after(async () => teardownTestEnv(db));

  it('is invisible until every image is present; commit and concurrent retries publish exactly once', async () => {
    const draft = fixture();
    await req('post', '/imports').send(draft).expect(201);
    assert.equal(await count(), 0);
    await req('post', `/imports/${draft.id}/commit`).send({}).expect(409);
    assert.equal(await count(), 0);
    await upload(draft).expect(200);
    await upload(draft).expect(200);
    const results = await Promise.all([0, 1].map(() => req('post', `/imports/${draft.id}/commit`).send({}).expect(201)));
    assert.equal(results[0].body.data.id, results[1].body.data.id);
    assert.equal(await count(), 1);
    const { rows } = await db.query('SELECT * FROM images WHERE id=$1', [draft.imageIds[0]]);
    assert.deepEqual(await readFile(rows[0].storage_path), Buffer.from(PNG, 'base64'));
    const receipt = await req('get', `/imports/${draft.id}`).expect(200);
    assert.equal(receipt.body.data.result.id, results[0].body.data.id);
    assert.match(receipt.headers['cache-control'], /no-store/);
    assert.equal((await db.query('SELECT 1 FROM atlas_import_images WHERE attempt_id=$1', [draft.id])).rowCount, 0);
    assert.equal((await db.query("SELECT 1 FROM audit_trail WHERE target_id=$1 AND action='ATLAS_CREATE'", [results[0].body.data.id])).rowCount, 1);
    await db.query("UPDATE atlas_import_attempts SET expires_at=NOW()-INTERVAL '8 days' WHERE id=$1", [draft.id]);
    assert.equal((await req('get', `/imports/${draft.id}`).expect(200)).body.data.result.id, results[0].body.data.id);
    await req('post', '/imports').send(fixture()).expect(201);
    assert.equal((await req('post', `/imports/${draft.id}/commit`).send({}).expect(201)).body.data.id, results[0].body.data.id);
    assert.equal(await count(), 1);
  });
  it('refuses undeclared originals before creating a preparation', async () => {
    const draft = fixture(); draft.imageIds = [];
    await req('post', '/imports').send(draft).expect(400);
    assert.equal(await count(), 0);
  });
  it('the legacy metadata-only endpoint cannot create a partial atlas with original images', async () => {
    await req('post', '/import').send(fixture().payload).expect(400);
    assert.equal(await count(), 0);
  });
  it('another account cannot read, upload, commit or discard the preparation', async () => {
    const draft = fixture();
    await req('post', '/imports').send(draft).expect(201);
    await req('get', `/imports/${draft.id}`, otherToken).expect(404);
    await req('post', `/imports/${draft.id}/commit`, otherToken).send({}).expect(404);
    await req('delete', `/imports/${draft.id}`, otherToken).expect(404);
    await req('post', '/imports', otherToken).send(draft).expect(404);
    await req('post', `/imports/${draft.id}/images`, otherToken).send({ images: [{ localId: draft.imageIds[0], filename: 'photo.png', mimeType: 'image/png', data: PNG }] }).expect(404);
    assert.equal(await count(), 0);
  });
  it('anonymous and public-link principals cannot prepare or publish imports', async () => {
    const draft = fixture();
    await supertest(app).post('/api/v1/atlas/imports').send(draft).expect(401);
    const atlas = await createAtlas(db, user.id);
    const publicToken = await getPublicToken(app, await makeAtlasPublic(db, atlas.id));
    await req('post', '/imports', publicToken).send(draft).expect(403);
    await req('get', `/imports/${draft.id}`, publicToken).expect(403);
    await req('post', `/imports/${draft.id}/commit`, publicToken).send({}).expect(403);
    assert.equal(await count(), 1);
  });
  it('rejects corrupted or conflicting image content and keeps the original prepared bytes', async () => {
    const draft = fixture(); await req('post', '/imports').send(draft).expect(201);
    await upload(draft, 'bad%%%').expect(400);
    await upload(draft).expect(200);
    await upload(draft, Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.from('different')]).toString('base64')).expect(409);
    await req('post', `/imports/${draft.id}/commit`).send({}).expect(201);
  });
  it('a disk failure rolls back every entity and a retry uses the same preparation', async () => {
    const draft = fixture(); await req('post', '/imports').send(draft).expect(201); await upload(draft).expect(200);
    let failedPath;
    await assert.rejects(commitImport(user.id, draft.id, { openFile: async (path, flags) => {
      failedPath = path;
      const handle = await open(path, flags);
      return { writeFile: async bytes => { await handle.writeFile(bytes.subarray(0, 8)); throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); },
        sync: () => handle.sync(), close: () => handle.close() };
    } }), /disk full/);
    await assert.rejects(readFile(failedPath), { code: 'ENOENT' });
    assert.equal(await count(), 0);
    assert.equal((await db.query('SELECT 1 FROM atlas_import_images WHERE attempt_id=$1', [draft.id])).rowCount, 1);
    await req('post', `/imports/${draft.id}/commit`).send({}).expect(201);
    assert.equal(await count(), 1);
  });
  it('detects a damaged stored image before publication', async () => {
    const draft = fixture(); await req('post', '/imports').send(draft).expect(201); await upload(draft).expect(200);
    await db.query("UPDATE atlas_import_images SET bytes=decode('00','hex') WHERE attempt_id=$1", [draft.id]);
    await req('post', `/imports/${draft.id}/commit`).send({}).expect(409);
    assert.equal(await count(), 0);
  });
  it('accepts an authenticated image request above the ordinary JSON ceiling and preserves every byte', async () => {
    const draft = fixture(); await req('post', '/imports').send(draft).expect(201);
    const bytes = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(8 * 1024 * 1024)]);
    const encoded = bytes.toString('base64');
    assert.ok(encoded.length > 10 * 1024 * 1024);
    await upload(draft, encoded).expect(200);
    assert.equal(await count(), 0);
    await req('post', `/imports/${draft.id}/commit`).send({}).expect(201);
    const { rows } = await db.query('SELECT storage_path FROM images WHERE id=$1', [draft.imageIds[0]]);
    assert.deepEqual(await readFile(rows[0].storage_path), bytes);
  });
  it('expires abandoned preparations and refuses different content under the same key', async () => {
    const draft = fixture(); await req('post', '/imports').send(draft).expect(201);
    await req('post', '/imports').send({ ...draft, sourceKey: 'b'.repeat(64) }).expect(409);
    await db.query("UPDATE atlas_import_attempts SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [draft.id]);
    await req('post', `/imports/${draft.id}/commit`).send({}).expect(409);
    await req('post', '/imports').send(fixture()).expect(201);
    assert.equal((await db.query('SELECT 1 FROM atlas_import_attempts WHERE id=$1', [draft.id])).rowCount, 0);
  });
  it('limits preparations and permits explicit discard without publishing', async () => {
    const drafts = [fixture(), fixture(), fixture()];
    for (const draft of drafts) await req('post', '/imports').send(draft).expect(201);
    await req('post', '/imports').send(fixture()).expect(409);
    await req('delete', `/imports/${drafts[0].id}`).expect(204);
    await req('post', '/imports').send(fixture()).expect(201);
    assert.equal(await count(), 0);
  });
});
