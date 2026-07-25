// Path: tests/integration/atlas-clone-images.repro.test.js
// Regression (achado 32): cloneAtlas copied the image FEATURES but never the `images` table, so
// every image and custom icon in a clone was broken from the first render.
//
// `images` rows are atlas-scoped (images.atlas_id NOT NULL) and the read is scoped by the pair
// (id, atlas_id) — FIND_IMAGE_BY_ID / getImageById → 404. The client always asks for the ACTIVE
// atlas (image-sync.js fetchImageBlob), so a clone carrying the SOURCE atlas's image ids could
// never resolve them: GET /atlas/<clone>/images/<id> → 404 forever, degrading silently to "no
// image" because fetchImageBlob swallows the error.
//
// Every place an image id is referenced (mirrors local-atlas-to-server.js, which already does
// this rewrite when uploading a local atlas):
//   - an IMAGE feature's blob ref IS its feature id (the snapshot forces properties.id = row id)
//   - a custom point icon: properties.markerSymbol = 'custom:<imageId>'
//   - the icon registry: atlas.settings.customIcons[].id
//   - 3D / 360 items: data.images[] (strings or { id })

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

// 1x1 PNG — real magic bytes, required by the upload's content check.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('achado-32 · clone copies the images table (and rewrites every ref)', () => {
  let app, db, owner, token;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `img32_owner_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, owner.username, owner.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const bulkUpload = async (atlasId, items) => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlasId}/images/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        images: items.map(({ localId, filename }) => ({
          localId,
          filename,
          mimeType: 'image/png',
          data: PNG_B64,
        })),
      })
      .expect(201);
    return res.body.data.mapping;
  };

  const listImages = async (atlasId) => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlasId}/images`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data;
  };

  const snapshot = async (atlasId) => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlasId}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data.snapshot;
  };

  /**
   * Builds a source atlas holding every kind of image reference.
   * @returns {Promise<Object>} ids of everything created
   */
  async function buildSourceAtlas() {
    const atlas = await createAtlas(db, owner.id, { name: `Img32 src ${randomUUID().slice(0, 6)}` });
    const map = await createMap(db, atlas.id, { name: 'Mapa com imagens' });

    const photoId = randomUUID();  // image feature blob (== the feature id)
    const iconId = randomUUID();   // custom point icon
    const c3dImgId = randomUUID(); // photo attached to a 3D marker
    await bulkUpload(atlas.id, [
      { localId: photoId, filename: 'photo.png' },
      { localId: iconId, filename: 'icon.png' },
      { localId: c3dImgId, filename: 'marker.png' },
    ]);

    // The image feature: its id IS the blob id.
    await db.query(
      `INSERT INTO features (id, map_id, feature_type, geometry, properties)
       VALUES ($1, $2, 'image', $3::jsonb, $4::jsonb)`,
      [photoId, map.id, JSON.stringify({ type: 'Point', coordinates: [-43.2, -22.9] }),
        JSON.stringify({ id: photoId, nome: 'Foto', width: 100, height: 100 })]
    );

    // A point wearing the custom icon.
    const pointId = randomUUID();
    await db.query(
      `INSERT INTO features (id, map_id, feature_type, geometry, properties)
       VALUES ($1, $2, 'point', $3::jsonb, $4::jsonb)`,
      [pointId, map.id, JSON.stringify({ type: 'Point', coordinates: [-43.3, -22.8] }),
        JSON.stringify({ id: pointId, nome: 'Ponto', markerSymbol: `custom:${iconId}` })]
    );

    // The icon registry lives in atlas.settings (the settings PATCH schema does not accept
    // customIcons — the client writes it through a sync atlas-setting op).
    await db.query(
      `UPDATE atlas SET settings = settings || $2::jsonb WHERE id = $1`,
      [atlas.id, JSON.stringify({ customIcons: [{ id: iconId, name: 'Ícone', type: 'image/png' }] })]
    );

    // A 3D marker carrying an attached photo.
    await db.query(
      `INSERT INTO cesium3d_data (map_id, data_type, data) VALUES ($1, 'marker', $2::jsonb)`,
      [map.id, JSON.stringify({ nome: 'Marcador', images: [c3dImgId] })]
    );

    return { atlas, map, photoId, iconId, c3dImgId, pointId };
  }

  it('every image reference in the clone resolves inside the CLONE atlas', async () => {
    const src = await buildSourceAtlas();

    const res = await supertest(app)
      .post(`/api/v1/atlas/${src.atlas.id}/clone`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const cloneId = res.body.data.id;

    // 1. The rows were COPIED (new ids, new atlas) — not moved, not shared.
    const cloneImages = await listImages(cloneId);
    assert.equal(cloneImages.length, 3, 'the clone owns its own images rows');
    const cloneImageIds = new Set(cloneImages.map((i) => i.id));
    for (const oldId of [src.photoId, src.iconId, src.c3dImgId]) {
      assert.ok(!cloneImageIds.has(oldId), 'a clone image id must be fresh (the PK is global)');
    }
    assert.equal((await listImages(src.atlas.id)).length, 3, 'the source keeps its images');

    const snap = await snapshot(cloneId);
    const cloneMap = snap.maps[0];

    // 2. Image feature: the blob ref (== the feature id) must resolve in the clone.
    const imageFeature = cloneMap.features.images[0];
    assert.ok(imageFeature, 'the image feature was cloned');
    assert.notEqual(imageFeature.properties.id, src.photoId, 'the ref was rewritten');
    assert.ok(cloneImageIds.has(imageFeature.properties.id), 'and points at a CLONE image row');
    const blob = await supertest(app)
      .get(`/api/v1/atlas/${cloneId}/images/${imageFeature.properties.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.deepEqual(blob.body, Buffer.from(PNG_B64, 'base64'), 'the file was copied too');

    // 3. Custom icon on the point feature.
    const point = cloneMap.features.points[0];
    const newIconId = point.properties.markerSymbol.slice('custom:'.length);
    assert.notEqual(newIconId, src.iconId);
    assert.ok(cloneImageIds.has(newIconId), 'markerSymbol points at a CLONE image row');
    await supertest(app)
      .get(`/api/v1/atlas/${cloneId}/images/${newIconId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // 4. The icon REGISTRY in atlas.settings agrees with the feature ref.
    assert.deepEqual(
      snap.atlas.settings.customIcons.map((i) => i.id),
      [newIconId],
      'settings.customIcons must be rewritten to the clone ids'
    );

    // 5. 3D item images[].
    const marker = cloneMap.cesium3d.markers[0];
    const newC3dImg = marker.images[0];
    assert.notEqual(newC3dImg, src.c3dImgId);
    assert.ok(cloneImageIds.has(newC3dImg), 'data.images[] must be rewritten');
    await supertest(app)
      .get(`/api/v1/atlas/${cloneId}/images/${newC3dImg}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // 6. The old ids are gone from the clone (the failure mode being fixed).
    await supertest(app)
      .get(`/api/v1/atlas/${cloneId}/images/${src.photoId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('duplicating a map keeps the image feature resolvable (feature id == image id)', async () => {
    // Same invariant, same code path: duplicateMap gives the copied feature a NEW id, so
    // without a fresh images row the copy's blob ref points at nothing.
    const src = await buildSourceAtlas();

    const res = await supertest(app)
      .post(`/api/v1/atlas/${src.atlas.id}/maps/${src.map.id}/duplicate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const newMapId = res.body.data.id;

    const snap = await snapshot(src.atlas.id);
    const dupMap = snap.maps.find((m) => m.id === newMapId);
    const dupImage = dupMap.features.images[0];
    assert.notEqual(dupImage.properties.id, src.photoId, 'the copy gets its own blob');

    await supertest(app)
      .get(`/api/v1/atlas/${src.atlas.id}/images/${dupImage.properties.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // The original feature still resolves — duplication copies, never steals.
    await supertest(app)
      .get(`/api/v1/atlas/${src.atlas.id}/images/${src.photoId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
