// Path: tests/integration/cross-cutting-gaps.test.js
// Cross-cutting / whole-system invariants from the audit:
//  - x-no-rest-write-route-invariant: collaborative entities have NO REST write route.
//  - x-public-token-...-revoked: a public token is rejected once public sharing is off.
//  - x-clone-import-image-references: clone does NOT copy images (KNOWN GAP, characterized).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createBriefing,
  loginUser, makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';

// Minimal valid 1x1 PNG (passes the upload magic-byte allowlist).
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
  0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54,
  0x08, 0xd7, 0x63, 0xf8, 0xff, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01,
  0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe('Cross-cutting invariants — gaps', () => {
  let app, db, owner, ownerToken, atlas, map, briefing;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `gap_xc_${randomUUID().slice(0, 8)}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id);
    map = await createMap(db, atlas.id);
    briefing = await createBriefing(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const A = (method, path) => supertest(app)[method](path).set('Authorization', `Bearer ${ownerToken}`);

  describe('collaborative entities have NO REST write route (x-no-rest-write-route-invariant)', () => {
    it('maps: REST create/update/delete are unmounted → 404', async () => {
      await A('post', `/api/v1/atlas/${atlas.id}/maps`).send({ name: 'Nope' }).expect(404);
      await A('put', `/api/v1/atlas/${atlas.id}/maps/${map.id}`).send({ name: 'Nope' }).expect(404);
      await A('delete', `/api/v1/atlas/${atlas.id}/maps/${map.id}`).expect(404);
    });

    it('briefings: REST create/update/delete are unmounted → 404', async () => {
      await A('post', `/api/v1/atlas/${atlas.id}/briefings`).send({ name: 'Nope' }).expect(404);
      await A('put', `/api/v1/atlas/${atlas.id}/briefings/${briefing.id}`).send({ name: 'Nope' }).expect(404);
      await A('delete', `/api/v1/atlas/${atlas.id}/briefings/${briefing.id}`).expect(404);
    });

    it('positive control: the server-side merge route DOES exist (not 404)', async () => {
      const res = await A('post', `/api/v1/atlas/${atlas.id}/maps/${map.id}/merge`).send({});
      assert.notEqual(res.status, 404, 'merge is a real write route (422 for an empty body, not 404)');
    });
  });

  describe('public token revocation over HTTP (x-public-token-...-revoked)', () => {
    it('disabling public sharing rejects a previously-minted public token; re-enabling restores it', async () => {
      const pubAtlas = await createAtlas(db, owner.id);
      const link = await makeAtlasPublic(db, pubAtlas.id);
      const publicToken = await getPublicToken(app, link);
      const pull = () => supertest(app)
        .get(`/api/v1/atlas/${pubAtlas.id}/sync/0`)
        .set('Authorization', `Bearer ${publicToken}`);

      await pull().expect(200); // works while public

      await A('delete', `/api/v1/atlas/${pubAtlas.id}/sharing/public`).expect(204);
      await pull().expect(403); // requireAtlasPermission re-reads is_public live → revoked

      // KNOWN nuance: the token is bound to atlasId + isPublic, NOT to public_link, so
      // re-enabling makes the SAME old token valid again — it is not individually revocable.
      await A('post', `/api/v1/atlas/${pubAtlas.id}/sharing/public`).expect(200);
      await pull().expect(200);
    });
  });

  // The gap this block used to CHARACTERIZE ("clone copies no images, pending product
  // decision") was closed by L32: a clone with unreachable images is a silently corrupted
  // copy, not a decision. cloneAtlas now copies the `images` rows into the new atlas (fresh
  // ids + per-atlas blob copies) and rewrites every reference. Full coverage — image features,
  // custom icons, settings.customIcons, 3D/360 data.images[] — lives in
  // atlas-clone-images.repro.test.js; what stays here is the cross-cutting half: the SOURCE
  // atlas's id is still meaningless inside the clone (no cross-atlas reuse of a global PK).
  describe('clone copies images into the new atlas (x-clone-import-image-references)', () => {
    it('the clone gets its OWN image rows, and the source id does not resolve there', async () => {
      const up = await A('post', `/api/v1/atlas/${atlas.id}/images`).attach('image', PNG, 'gap.png').expect(201);
      const imageId = up.body.data.id;

      const cl = await A('post', `/api/v1/atlas/${atlas.id}/clone`).send({ name: 'Clone XC' }).expect(201);
      const cloneId = cl.body.data.id;

      const { rows } = await db.query('SELECT id FROM images WHERE atlas_id = $1', [cloneId]);
      assert.equal(rows.length, 1, 'the clone owns a copy of every source image');
      assert.notEqual(rows[0].id, imageId, 'images.id is a GLOBAL pk — the copy must be a new id');

      // The copy is readable through the clone…
      await supertest(app)
        .get(`/api/v1/atlas/${cloneId}/images/${rows[0].id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      // …and the source id is still scoped to the source atlas (no cross-atlas read).
      await supertest(app)
        .get(`/api/v1/atlas/${cloneId}/images/${imageId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images/${imageId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });
  });
});
