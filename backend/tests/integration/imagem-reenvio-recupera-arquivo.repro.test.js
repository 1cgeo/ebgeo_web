// Path: tests/integration/imagem-reenvio-recupera-arquivo.repro.test.js
// A process can die after the bulk INSERT commits and before its file finishes.
// Replaying that upload must confirm readable bytes, not merely a cached SQL hash.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { unlink, writeFile, readFile, mkdir, rmdir } from 'node:fs/promises';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

describe('Bulk replay verifies and recovers the physical image', () => {
  let app, db, atlas, token;

  before(async () => {
    ({ app, db } = await setupTestEnv());
    const owner = await createUser(db);
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id);
  });

  after(async () => { await teardownTestEnv(db); });

  function upload(localId, bytes = PNG) {
    return supertest(app).post(`/api/v1/atlas/${atlas.id}/images/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({ images: [{ localId, filename: 'original.png', mimeType: 'image/png', data: bytes.toString('base64') }] });
  }

  async function seeded() {
    const id = randomUUID();
    const response = await upload(id).expect(201);
    assert.deepEqual(response.body.data.failed, []);
    assert.equal(response.body.data.mapping[id], id);
    const { rows } = await db.query('SELECT * FROM images WHERE id = $1', [id]);
    assert.equal(rows.length, 1);
    return rows[0];
  }

  for (const state of ['missing', 'partial', 'same-size-corruption']) {
    it(`replays the same id after a ${state} write and downloads the exact original bytes`, async () => {
      const row = await seeded();
      if (state === 'missing') await unlink(row.storage_path);
      else await writeFile(row.storage_path, state === 'partial' ? PNG.subarray(0, 17) : Buffer.alloc(PNG.length));

      const replay = await upload(row.id).expect(201);
      assert.deepEqual(replay.body.data.failed, []);
      assert.equal(replay.body.data.uploaded.length, 1);
      assert.equal(replay.body.data.mapping[row.id], row.id);
      const download = await supertest(app).get(`/api/v1/atlas/${atlas.id}/images/${row.id}`)
        .set('Authorization', `Bearer ${token}`).expect(200);
      assert.deepEqual(download.body, PNG);
      const { rows } = await db.query('SELECT id, content_hash FROM images WHERE id = $1', [row.id]);
      assert.deepEqual(rows, [{ id: row.id, content_hash: row.content_hash }]);
    });
  }

  it('does not repair an absent original using different bytes', async () => {
    const row = await seeded();
    await unlink(row.storage_path);
    const response = await upload(row.id, Buffer.concat([PNG, Buffer.from('different')])).expect(201);
    assert.equal(response.body.data.uploaded.length, 0);
    assert.equal(response.body.data.failed.length, 1);
    assert.match(response.body.data.failed[0].error, /outro conteúdo/);
    await assert.rejects(readFile(row.storage_path), { code: 'ENOENT' });
  });

  it('concurrent exact replays repair one file without changing its identity', async () => {
    const row = await seeded();
    await unlink(row.storage_path);
    const replies = await Promise.all(Array.from({ length: 4 }, () => upload(row.id).expect(201)));
    assert.equal(replies.length, 4);
    for (const reply of replies) {
      assert.deepEqual(reply.body.data.failed, []);
      assert.equal(reply.body.data.mapping[row.id], row.id);
    }
    assert.deepEqual(await readFile(row.storage_path), PNG);
    const { rows } = await db.query('SELECT id FROM images WHERE id = $1', [row.id]);
    assert.deepEqual(rows, [{ id: row.id }]);
  });

  it('a failed first disk write cannot delete the image already confirmed to a concurrent retry', async () => {
    const id = randomUUID();
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const original = fs.promises.writeFile;
    let first = true;
    fs.promises.writeFile = async (...args) => {
      if (first && String(args[0]).includes(atlas.id) && String(args[0]).endsWith('.png')) {
        first = false;
        await original(args[0], PNG.subarray(0, 17));
        entered.resolve();
        await release.promise;
        throw Object.assign(new Error('Injected interrupted disk write'), { code: 'ENOSPC' });
      }
      return original(...args);
    };
    syncBuiltinESMExports();
    let firstUpload;
    try {
      firstUpload = upload(id).then(response => response);
      await entered.promise;
      const retry = await upload(id).expect(201);
      assert.deepEqual(retry.body.data.failed, []);
      assert.equal(retry.body.data.mapping[id], id);
      release.resolve();
      const failed = await firstUpload;
      assert.equal(failed.body.data.failed.length, 1);
      const downloaded = await supertest(app).get(`/api/v1/atlas/${atlas.id}/images/${id}`)
        .set('Authorization', `Bearer ${token}`).expect(200);
      assert.deepEqual(downloaded.body, PNG);
    } finally {
      release.resolve();
      await firstUpload;
      fs.promises.writeFile = original;
      syncBuiltinESMExports();
    }
  });

  it('cannot infer the original content from a missing file with no stored hash', async () => {
    const row = await seeded();
    await unlink(row.storage_path);
    await db.query('UPDATE images SET content_hash = NULL WHERE id = $1', [row.id]);
    const reply = await upload(row.id).expect(201);
    assert.equal(reply.body.data.uploaded.length, 0);
    assert.equal(reply.body.data.failed.length, 1);
    await assert.rejects(readFile(row.storage_path), { code: 'ENOENT' });
  });

  it('reports a failed replay if the physical destination cannot be repaired', async () => {
    const row = await seeded();
    await unlink(row.storage_path);
    await mkdir(row.storage_path); // A directory cannot become an image file by overwrite.
    try {
      const response = await upload(row.id).expect(201);
      assert.equal(response.body.data.uploaded.length, 0);
      assert.equal(response.body.data.failed.length, 1);
      assert.equal(response.body.data.mapping[row.id], undefined);
      assert.equal(response.body.data.failed[0].error.includes(row.storage_path), false);
    } finally {
      await rmdir(row.storage_path);
    }
  });
});
