// Path: tests/integration/cross-tenant-negativos.test.js
//
// Negative cross-tenant / cross-actor coverage (structural blind spot #4).
//
// `backend/CLAUDE.md` states the rule twice — "toda query com filtro de acesso exige um
// teste negativo (usuário sem permissão não vê)" and "nunca uma lista fechada tipo
// `permission === 'write' || permission === 'owner'`" — and until this file NOTHING
// checked either one on these four surfaces:
//
//   17 — GET/DELETE /api/v1/debug/trace: ZERO requests reached this route in the whole
//        backend suite. Removing `liftAtlasIdToParams`/`requireAtlasPermission`, or
//        restoring the "clear ALL rings" fallback, broke no test.
//   25 — GET /atlas/:atlasId/images: the only two listing assertions in the repo were
//        `data.length > 0`. Dropping `WHERE atlas_id = $1` only makes the array LONGER,
//        so both stayed green while leaking every atlas's image metadata.
//   26 — the three image WRITE routes were only ever exercised at owner/write/read.
//        `manage` (co-Gestor) and `comment` (Comentarista) — the two middle tiers, the
//        exact ones a closed list silently drops — appeared in no image test at all.
//   28 — POST /images/bulk lets the CLIENT pick the row id (`INSERT_IMAGE_WITH_ID`,
//        $1 = localId) on a table whose PK is GLOBAL, not per-atlas. Only the
//        unique_violation stops a write over another tenant's row, and that was never
//        asserted: turning the INSERT into `ON CONFLICT (id) DO UPDATE` (which reads as
//        an idempotency improvement) would have silently made it a cross-tenant
//        overwrite primitive.
//   43 — the public-link visitor principal (`public-<uuid>`) had no test outside /atlas
//        routes, so nothing delimited where it could go.
//
// Every assertion here is written against an EFFECT (rows, ring contents, id sets), not
// only a status code, so a gate that returns the right status while doing the wrong
// thing still fails.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createAtlas, createShare, loginUser,
  makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';
import { contarBlobs } from '../helpers/blobs-em-disco.js';
import { recordSpan, getTrace, isTraceEnabled } from '../../src/utils/sync-trace.js';
import config from '../../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal valid 1x1 PNG. The service validates MAGIC BYTES against the declared type,
// so a placeholder string would fail for the wrong reason.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const PNG_BUFFER = Buffer.from(PNG_B64, 'base64');

describe('cross-tenant / cross-actor negatives', () => {
  let app, db;
  const sfx = randomUUID().slice(0, 8);

  // Actors
  let ownerA, ownerB, manager, commenter, writer, reader, stranger, admin;
  let tokA, tokB, tokManage, tokComment, tokWrite, tokRead, tokStranger, tokAdmin;
  let publicToken;

  // Tenants
  let atlasA, atlasB, atlasPub;

  // Seed images
  let imgA1, imgA2, imgB1;

  let pngPath;

  /** Uploads a PNG through the multipart route and returns the created row id. */
  async function uploadPng(atlasId, token, expected = 201) {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlasId}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', pngPath)
      .expect(expected);
    return res.body.data?.id;
  }

  /** Row count of the images table for one atlas. */
  async function imageCount(atlasId) {
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM images WHERE atlas_id = $1', [atlasId]);
    return rows[0].n;
  }

  /** Full image row (used for the byte-for-byte intactness assertion). */
  async function imageRow(id) {
    const { rows } = await db.query('SELECT * FROM images WHERE id = $1', [id]);
    return rows[0];
  }

  /** Blobs de verdade no diretorio de upload de um atlas (0 quando ele nao existe). */
  // Conta blobs de VERDADE, e nao entradas de diretorio. `readdirSync` sozinho
  // devolvia tambem a entrada `<UUID>.PNG.tmp` de zero byte que o Windows deixa
  // por alguns milissegundos depois do unlink, e esse fantasma ja produziu
  // vermelho intermitente. A medicao esta em helpers/blobs-em-disco.js.
  function countFiles(atlasId) {
    return contarBlobs(join(config.images.dir, atlasId));
  }

  const as = (tok) => ({
    get: (p) => supertest(app).get(p).set('Authorization', `Bearer ${tok}`),
    post: (p) => supertest(app).post(p).set('Authorization', `Bearer ${tok}`),
    delete: (p) => supertest(app).delete(p).set('Authorization', `Bearer ${tok}`),
  });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    ownerA = await createUser(db, { username: `xt_ownerA_${sfx}` });
    ownerB = await createUser(db, { username: `xt_ownerB_${sfx}` });
    manager = await createUser(db, { username: `xt_manage_${sfx}` });
    commenter = await createUser(db, { username: `xt_comment_${sfx}` });
    writer = await createUser(db, { username: `xt_write_${sfx}` });
    reader = await createUser(db, { username: `xt_read_${sfx}` });
    stranger = await createUser(db, { username: `xt_stranger_${sfx}` });
    admin = await createAdminUser(db, { username: `xt_admin_${sfx}` });

    tokA = await loginUser(app, ownerA.username, ownerA.password);
    tokB = await loginUser(app, ownerB.username, ownerB.password);
    tokManage = await loginUser(app, manager.username, manager.password);
    tokComment = await loginUser(app, commenter.username, commenter.password);
    tokWrite = await loginUser(app, writer.username, writer.password);
    tokRead = await loginUser(app, reader.username, reader.password);
    tokStranger = await loginUser(app, stranger.username, stranger.password);
    tokAdmin = await loginUser(app, admin.username, admin.password);

    atlasA = await createAtlas(db, ownerA.id, { name: `XT A ${sfx}` });
    atlasB = await createAtlas(db, ownerB.id, { name: `XT B ${sfx}` });
    atlasPub = await createAtlas(db, ownerA.id, { name: `XT Pub ${sfx}` });

    // The four middle/lower tiers live on atlas A only. Nobody here holds ANY share on
    // atlas B — that asymmetry is what makes the IDOR cases meaningful.
    await createShare(db, atlasA.id, manager.id, 'manage', ownerA.id);
    await createShare(db, atlasA.id, commenter.id, 'comment', ownerA.id);
    await createShare(db, atlasA.id, writer.id, 'write', ownerA.id);
    await createShare(db, atlasA.id, reader.id, 'read', ownerA.id);

    const link = await makeAtlasPublic(db, atlasPub.id);
    publicToken = await getPublicToken(app, link);

    const fixDir = join(__dirname, '..', 'fixtures');
    if (!existsSync(fixDir)) mkdirSync(fixDir, { recursive: true });
    pngPath = join(fixDir, `xt-${sfx}.png`);
    writeFileSync(pngPath, PNG_BUFFER);

    imgA1 = await uploadPng(atlasA.id, tokA);
    imgA2 = await uploadPng(atlasA.id, tokA);
    imgB1 = await uploadPng(atlasB.id, tokB);
    await uploadPng(atlasPub.id, tokA);
  });

  after(async () => {
    if (pngPath && existsSync(pngPath)) rmSync(pngPath);
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // 28 — bulk import: client-chosen PK on a GLOBAL-key table
  // ==========================================================================
  describe('28 — POST /images/bulk cannot claim another atlas\'s image id', () => {
    it('a bulk localId equal to another tenant\'s image id fails the item and leaves the victim row untouched', async () => {
      // Non-vacuity guard: the victim row must exist, otherwise "unchanged" is trivial.
      const before = await imageRow(imgA1);
      assert.ok(before, 'fixture must have created the victim image in atlas A');
      assert.equal(before.atlas_id, atlasA.id);

      // ownerB has full ownership of atlas B and simply names atlas A's image id.
      const res = await as(tokB)
        .post(`/api/v1/atlas/${atlasB.id}/images/bulk`)
        .send({
          images: [{
            localId: imgA1,
            filename: 'stolen.png',
            mimeType: 'image/png',
            data: PNG_B64,
          }],
        })
        .expect(201);

      const { uploaded, failed, mapping } = res.body.data;
      assert.equal(uploaded.length, 0, 'the colliding item must NOT be reported as uploaded');
      assert.equal(failed.length, 1);
      assert.equal(failed[0].localId, imgA1);
      // Was: `assert.match(failed[0].error, /images_pkey/)`. That assertion was
      // CHARACTERIZATION freezing achado 108 — it required the response to keep
      // leaking the driver's constraint name, so the leak could not be fixed without
      // this test going red. The property this test actually cares about is that the
      // colliding item is REFUSED; the refusal reason is now the same fixed text the
      // errorHandler gives for 23505 over REST, with the raw driver message going to
      // the log instead (pinned in tests/integration/images-bulk-error-leak.repro.test.js).
      assert.equal(failed[0].error, 'Já existe um registro com esses dados. Altere e tente de novo.');
      assert.doesNotMatch(
        failed[0].error,
        /pkey|constraint|violates/i,
        'the driver text must not cross the API boundary'
      );
      assert.equal(Object.keys(mapping).length, 0, 'no localId -> serverId mapping for a rejected item');

      // The assertion that actually pins the DO-NOTHING semantics: every column of the
      // victim row is byte-for-byte what it was. `ON CONFLICT (id) DO UPDATE` would
      // rewrite filename/mime_type/size_bytes/storage_path/uploaded_by here — and,
      // worse, would NOT rewrite atlas_id, so the row would keep pointing at atlas A
      // while its bytes and metadata came from atlas B.
      const after = await imageRow(imgA1);
      assert.deepEqual(after, before, 'the victim image row must be unchanged in every column');
    });

    it('creates nothing in the attacking atlas and writes no blob for the rejected item', async () => {
      // The blob is written AFTER the INSERT precisely so a rejected item leaves no
      // orphan file. Both counts are read fresh so this test stands alone.
      const countB = await imageCount(atlasB.id);
      const filesB = countFiles(atlasB.id);

      await as(tokB)
        .post(`/api/v1/atlas/${atlasB.id}/images/bulk`)
        .send({
          images: [{ localId: imgA2, filename: 'stolen2.png', mimeType: 'image/png', data: PNG_B64 }],
        })
        .expect(201);

      assert.equal(await imageCount(atlasB.id), countB, 'no row created in the attacking atlas');
      assert.equal(countFiles(atlasB.id), filesB, 'no orphan blob written for the rejected item');
    });

    it('re-importing the SAME atlas keeps the original image downloadable with its old content', async () => {
      const before = await imageRow(imgA1);

      const res = await as(tokA)
        .post(`/api/v1/atlas/${atlasA.id}/images/bulk`)
        .send({
          images: [{ localId: imgA1, filename: 'reimport.png', mimeType: 'image/png', data: PNG_B64 }],
        })
        .expect(201);

      assert.equal(res.body.data.uploaded.length, 0);
      assert.equal(res.body.data.failed.length, 1);

      const after = await imageRow(imgA1);
      assert.deepEqual(after, before, 're-import must not rewrite the existing row');

      const dl = await as(tokA).get(`/api/v1/atlas/${atlasA.id}/images/${imgA1}`).expect(200);
      assert.ok(Buffer.isBuffer(dl.body), 'download returns bytes');
      assert.deepEqual(dl.body, PNG_BUFFER, 'the original blob is still served');
    });

    it('a well-formed bulk item still uploads (control: the failures above come from the collision)', async () => {
      const localId = randomUUID();
      const res = await as(tokB)
        .post(`/api/v1/atlas/${atlasB.id}/images/bulk`)
        .send({
          images: [{ localId, filename: 'ok.png', mimeType: 'image/png', data: PNG_B64 }],
        })
        .expect(201);

      assert.equal(res.body.data.failed.length, 0);
      assert.equal(res.body.data.uploaded.length, 1);
      assert.equal(res.body.data.mapping[localId], localId, 'a free localId is preserved as the server id');
      const row = await imageRow(localId);
      assert.equal(row.atlas_id, atlasB.id);
    });
  });

  // ==========================================================================
  // 25 — LIST_IMAGES_BY_ATLAS tenant filter
  // ==========================================================================
  describe('25 — GET /atlas/:atlasId/images never returns another atlas\'s images', () => {
    /** Asserts a listing response only contains rows whose atlas_id is `atlasId`. */
    async function assertScopedTo(body, atlasId) {
      const ids = body.data.map((i) => i.id);
      assert.ok(ids.length > 0, 'the listing must be non-empty, otherwise exclusion is vacuous');
      const { rows } = await db.query(
        'SELECT id, atlas_id FROM images WHERE id = ANY($1::uuid[])', [ids]
      );
      assert.equal(rows.length, ids.length, 'every listed id must exist');
      for (const r of rows) {
        assert.equal(r.atlas_id, atlasId, `image ${r.id} does not belong to atlas ${atlasId}`);
      }
      return ids;
    }

    it('the owner sees exactly their own atlas\'s images, never the other tenant\'s', async () => {
      // Non-vacuity guard: atlas B must own at least one image before we assert absence.
      assert.ok(await imageCount(atlasB.id) > 0, 'fixture must have created an image in atlas B');

      const res = await as(tokA).get(`/api/v1/atlas/${atlasA.id}/images`).expect(200);
      const ids = await assertScopedTo(res.body, atlasA.id);
      assert.ok(ids.includes(imgA1) && ids.includes(imgA2), 'both seeded images of A are listed');
      assert.ok(!ids.includes(imgB1), 'atlas B\'s image must not appear');
    });

    it('a read-level share sees the same scoped set (and no storage_path)', async () => {
      const res = await as(tokRead).get(`/api/v1/atlas/${atlasA.id}/images`).expect(200);
      const ids = await assertScopedTo(res.body, atlasA.id);
      assert.ok(!ids.includes(imgB1));
      // Explicit non-emptiness before the loop: an empty array would make the
      // storage_path check pass without checking anything.
      assert.ok(res.body.data.length > 0, 'the listing must be non-empty');
      for (const img of res.body.data) {
        assert.equal(img.storage_path, undefined, 'storage_path must never cross the API boundary');
      }
    });

    it('a public-link visitor sees only the public atlas\'s images', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlasPub.id}/images`)
        .set('Authorization', `Bearer ${publicToken}`)
        .expect(200);
      const ids = await assertScopedTo(res.body, atlasPub.id);
      assert.ok(!ids.includes(imgA1), 'the owner\'s PRIVATE atlas image must not leak to a visitor');
      assert.ok(!ids.includes(imgB1));
    });

    it('a stranger gets 404 and no listing at all, indistinguishable from an atlas that does not exist', async () => {
      // The stranger holds no share on atlas A: the escada of requireAtlasPermission
      // answers 404 for "no relation whatsoever", so the listing route cannot be used
      // to enumerate which atlas ids are real.
      const res = await as(tokStranger).get(`/api/v1/atlas/${atlasA.id}/images`).expect(404);
      assert.equal(res.body.data, undefined);

      const inexistente = await as(tokStranger)
        .get(`/api/v1/atlas/${randomUUID()}/images`)
        .expect(404);
      // Anti-vacuity anchor: without it, a body carrying no `error` at all would
      // compare undefined to undefined and the pair would prove nothing.
      assert.equal(res.body.error.code, 'NOT_FOUND');
      assert.equal(res.body.error.code, inexistente.body.error.code);
      assert.equal(res.body.error.message, inexistente.body.error.message);
    });
  });

  // ==========================================================================
  // 26 — image write routes evaluated on the FIVE-level hierarchy
  // ==========================================================================
  describe('26 — image write gates use the hierarchy, not a closed list', () => {
    it('manage (co-Gestor) can upload through the multipart route', async () => {
      const before = await imageCount(atlasA.id);
      const id = await uploadPng(atlasA.id, tokManage);
      assert.ok(id, '201 must return the created image');
      const row = await imageRow(id);
      assert.equal(row.atlas_id, atlasA.id);
      assert.equal(row.uploaded_by, manager.id);
      assert.equal(await imageCount(atlasA.id), before + 1);
    });

    it('manage can bulk-upload', async () => {
      const localId = randomUUID();
      const res = await as(tokManage)
        .post(`/api/v1/atlas/${atlasA.id}/images/bulk`)
        .send({ images: [{ localId, filename: 'mgr.png', mimeType: 'image/png', data: PNG_B64 }] })
        .expect(201);
      assert.equal(res.body.data.uploaded.length, 1);
      assert.equal(res.body.data.failed.length, 0);
      assert.ok(await imageRow(localId), 'the bulk row exists');
    });

    it('manage can delete an image uploaded by the owner', async () => {
      const victim = await uploadPng(atlasA.id, tokA);
      await as(tokManage).delete(`/api/v1/atlas/${atlasA.id}/images/${victim}`).expect(204);
      assert.equal(await imageRow(victim), undefined, 'the row is gone');
    });

    it('comment (Comentarista) cannot upload — 403 and the atlas image count is unchanged', async () => {
      const before = await imageCount(atlasA.id);
      await supertest(app)
        .post(`/api/v1/atlas/${atlasA.id}/images`)
        .set('Authorization', `Bearer ${tokComment}`)
        .attach('image', pngPath)
        .expect(403);
      assert.equal(await imageCount(atlasA.id), before, 'a refused upload must create nothing');
    });

    it('comment cannot bulk-upload', async () => {
      const before = await imageCount(atlasA.id);
      const localId = randomUUID();
      await as(tokComment)
        .post(`/api/v1/atlas/${atlasA.id}/images/bulk`)
        .send({ images: [{ localId, filename: 'no.png', mimeType: 'image/png', data: PNG_B64 }] })
        .expect(403);
      assert.equal(await imageRow(localId), undefined);
      assert.equal(await imageCount(atlasA.id), before);
    });

    it('comment cannot delete — 403 and the image survives', async () => {
      await as(tokComment).delete(`/api/v1/atlas/${atlasA.id}/images/${imgA2}`).expect(403);
      assert.ok(await imageRow(imgA2), 'the image survives a refused delete');
    });

    it('comment CAN list and download (comment >= read: the read gate is not an equality)', async () => {
      await as(tokComment).get(`/api/v1/atlas/${atlasA.id}/images`).expect(200);
      await as(tokComment).get(`/api/v1/atlas/${atlasA.id}/images/${imgA2}`).expect(200);
    });

    it('read cannot upload or delete, but can list (the floor of the hierarchy)', async () => {
      const before = await imageCount(atlasA.id);
      await supertest(app)
        .post(`/api/v1/atlas/${atlasA.id}/images`)
        .set('Authorization', `Bearer ${tokRead}`)
        .attach('image', pngPath)
        .expect(403);
      await as(tokRead).delete(`/api/v1/atlas/${atlasA.id}/images/${imgA2}`).expect(403);
      await as(tokRead).get(`/api/v1/atlas/${atlasA.id}/images`).expect(200);
      assert.equal(await imageCount(atlasA.id), before);
      assert.ok(await imageRow(imgA2));
    });

    it('write is still allowed (control: the 403s above are about the TIER, not a broken gate)', async () => {
      const id = await uploadPng(atlasA.id, tokWrite);
      assert.ok(id);
      await as(tokWrite).delete(`/api/v1/atlas/${atlasA.id}/images/${id}`).expect(204);
    });

    it('a public-link visitor cannot write to the atlas it can read', async () => {
      const before = await imageCount(atlasPub.id);
      await supertest(app)
        .post(`/api/v1/atlas/${atlasPub.id}/images`)
        .set('Authorization', `Bearer ${publicToken}`)
        .attach('image', pngPath)
        .expect(403);
      assert.equal(await imageCount(atlasPub.id), before);
    });
  });

  // ==========================================================================
  // 17 — /debug/trace: per-atlas gate + cross-atlas IDOR
  // ==========================================================================
  describe('17 — GET/DELETE /api/v1/debug/trace is gated per atlas', () => {
    /** Seeds one span into an atlas ring and returns its opId. */
    function seed(atlasId) {
      const opId = randomUUID();
      recordSpan(atlasId, 'server.inserted', { opId });
      return opId;
    }

    it('the tracer is on in the test env (guard: otherwise every case below is vacuous)', () => {
      assert.equal(isTraceEnabled(), true);
    });

    it('no Authorization -> 401 (auth runs before the atlasId lift)', async () => {
      const res = await supertest(app)
        .get(`/api/v1/debug/trace?atlasId=${atlasA.id}`)
        .expect(401);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    it('valid token but no atlasId -> 400 (nothing to authorize)', async () => {
      const res = await as(tokA).get('/api/v1/debug/trace').expect(400);
      assert.match(res.body.error.message, /atlasId/i);
    });

    it('DELETE with no atlasId -> 400, and no ring is wiped', async () => {
      const opA = seed(atlasA.id);
      const opB = seed(atlasB.id);
      await as(tokA).delete('/api/v1/debug/trace').expect(400);
      assert.ok(getTrace(atlasA.id, { opId: opA }).length === 1, 'ring A intact');
      assert.ok(getTrace(atlasB.id, { opId: opB }).length === 1, 'ring B intact');
    });

    it('a user with no share on the atlas -> 404 on GET (no relation, so not even existence)', async () => {
      seed(atlasA.id);
      await as(tokStranger).get(`/api/v1/debug/trace?atlasId=${atlasA.id}`).expect(404);
    });

    it('read share -> 200 with that atlas\'s spans', async () => {
      const opId = seed(atlasA.id);
      const res = await as(tokRead)
        .get(`/api/v1/debug/trace?atlasId=${atlasA.id}&opId=${opId}`)
        .expect(200);
      assert.equal(res.body.data.enabled, true);
      assert.equal(res.body.data.spans.length, 1);
      assert.equal(res.body.data.spans[0].opId, opId);
      assert.equal(res.body.data.spans[0].atlasId, atlasA.id);
    });

    it('comment share -> 200 (comment >= read; an equality on \'read\' would 403 here)', async () => {
      const opId = seed(atlasA.id);
      const res = await as(tokComment)
        .get(`/api/v1/debug/trace?atlasId=${atlasA.id}&opId=${opId}`)
        .expect(200);
      assert.equal(res.body.data.spans.length, 1);
    });

    it('write share -> 403 on DELETE (write < manage: this is the case a closed list gets wrong)', async () => {
      const opId = seed(atlasA.id);
      await as(tokWrite).delete(`/api/v1/debug/trace?atlasId=${atlasA.id}`).expect(403);
      assert.equal(getTrace(atlasA.id, { opId }).length, 1, 'the ring survives a refused wipe');
    });

    it('manage share -> DELETE clears ONE ring and leaves the other tenant\'s ring intact', async () => {
      const opA = seed(atlasA.id);
      const opB = seed(atlasB.id);
      assert.ok(getTrace(atlasA.id).length > 0 && getTrace(atlasB.id).length > 0, 'both rings seeded');

      const res = await as(tokManage)
        .delete(`/api/v1/debug/trace?atlasId=${atlasA.id}`)
        .expect(200);
      assert.equal(res.body.data.cleared, true);

      assert.equal(getTrace(atlasA.id, { opId: opA }).length, 0, 'atlas A ring wiped');
      assert.equal(getTrace(atlasB.id, { opId: opB }).length, 1,
        'atlas B ring must survive: the wipe is per-atlas, never global');

      const after = await as(tokRead).get(`/api/v1/debug/trace?atlasId=${atlasA.id}`).expect(200);
      assert.equal(after.body.data.spans.length, 0);
    });

    it('the atlas owner and a global admin also satisfy the manage gate', async () => {
      seed(atlasA.id);
      await as(tokA).delete(`/api/v1/debug/trace?atlasId=${atlasA.id}`).expect(200);
      seed(atlasA.id);
      await as(tokAdmin).delete(`/api/v1/debug/trace?atlasId=${atlasA.id}`).expect(200);
      assert.equal(getTrace(atlasA.id).length, 0);
    });

    it('IDOR: manage on A gives nothing on B — DELETE ?atlasId=B is 404 and B\'s ring is intact', async () => {
      // 404 and not 403: `manage` on A is no relation at all to B, and the escada
      // reserves 403 for a caller who DOES hold a share on the atlas it is probing.
      const opB = seed(atlasB.id);
      await as(tokManage).delete(`/api/v1/debug/trace?atlasId=${atlasB.id}`).expect(404);
      assert.equal(getTrace(atlasB.id, { opId: opB }).length, 1,
        'the foreign ring must still hold its span');

      // The owner of B still reads it — proves the span was there to be stolen.
      const res = await as(tokB)
        .get(`/api/v1/debug/trace?atlasId=${atlasB.id}&opId=${opB}`)
        .expect(200);
      assert.equal(res.body.data.spans.length, 1);
    });

    it('IDOR: reading a foreign atlas\'s ring is 404 too', async () => {
      seed(atlasB.id);
      await as(tokManage).get(`/api/v1/debug/trace?atlasId=${atlasB.id}`).expect(404);
      await as(tokStranger).get(`/api/v1/debug/trace?atlasId=${atlasB.id}`).expect(404);
    });

    it('a public-link visitor cannot reach the trace ring of any atlas, including its own', async () => {
      // The debug router is NOT mounted under /:atlasId, so req.params carries no atlas
      // when `auth` runs: the visitor confinement denies by default, which is the point.
      await supertest(app)
        .get(`/api/v1/debug/trace?atlasId=${atlasPub.id}`)
        .set('Authorization', `Bearer ${publicToken}`)
        .expect(403);
      await supertest(app)
        .delete(`/api/v1/debug/trace?atlasId=${atlasPub.id}`)
        .set('Authorization', `Bearer ${publicToken}`)
        .expect(403);
    });

    it('an unknown atlasId is 404 (not a silent 200 with an empty ring)', async () => {
      await as(tokA).get(`/api/v1/debug/trace?atlasId=${randomUUID()}`).expect(404);
    });
  });

  // ==========================================================================
  // 43 — reach of the public-link visitor principal OUTSIDE /atlas routes
  // ==========================================================================
  describe('43 — the public-link visitor is confined to the atlas that minted it', () => {
    it('cannot enumerate the personnel directory through GET /users/search', async () => {
      const res = await supertest(app)
        .get(`/api/v1/users/search?q=${sfx}`)
        .set('Authorization', `Bearer ${publicToken}`)
        .expect(403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
      assert.equal(res.body.data, undefined, 'no user rows may cross the boundary');
    });

    it('a wildcard-shaped query is refused as well (the pattern is not the gate)', async () => {
      await supertest(app)
        .get('/api/v1/users/search?q=%25%25')
        .set('Authorization', `Bearer ${publicToken}`)
        .expect(403);
    });

    it('cannot read a profile through GET /users/me', async () => {
      await supertest(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${publicToken}`)
        .expect(403);
    });

    it('cannot list atlases through GET /atlas', async () => {
      await supertest(app)
        .get('/api/v1/atlas')
        .set('Authorization', `Bearer ${publicToken}`)
        .expect(403);
    });

    it('cannot reach a DIFFERENT atlas, public or private', async () => {
      await supertest(app)
        .get(`/api/v1/atlas/${atlasA.id}`)
        .set('Authorization', `Bearer ${publicToken}`)
        .expect(403);
    });

    it('control: the same token still opens the atlas it was minted for', async () => {
      // Without this the four 403s above would also pass for a simply broken token.
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlasPub.id}`)
        .set('Authorization', `Bearer ${publicToken}`)
        .expect(200);
      assert.equal(res.body.data.id, atlasPub.id);
    });

    it('control: a real account still uses the search (the share autocomplete must keep working)', async () => {
      const res = await as(tokRead).get(`/api/v1/users/search?q=${sfx}`).expect(200);
      const usernames = res.body.data.map((u) => u.username);
      assert.ok(usernames.includes(ownerA.username), 'a normal user finds real accounts');
    });
  });
});
