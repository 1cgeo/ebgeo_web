// Path: tests/integration/sync-cross-atlas-access.test.js
// Negative access tests: a user with write permission on atlas A must NOT be able
// to mutate slide / group_feature entities that belong to atlas B by pushing sync
// operations to atlas A's endpoint (cross-atlas IDOR via the shared UUID space).
// Slides are scoped through their parent briefing; group_features through the
// group's map — both must resolve to the route's atlas or the write is dropped.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createGroup, createFeature, createLayer,
  createBriefing, createSlide, createCesium3dData, createStreetview360Data, loginUser,
} from '../helpers/fixtures.js';

describe('Sync cross-atlas access (negative)', () => {
  let app, db;
  let userA, tokenA, atlasA, mapA;
  let atlasB, mapB, briefingB, slideB, groupB, featureB, layerB, cesiumB, sv360B;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    userA = await createUser(db, { username: 'cross_atlas_attacker' });
    tokenA = await loginUser(app, userA.username, userA.password);
    atlasA = await createAtlas(db, userA.id);
    mapA = await createMap(db, atlasA.id);

    // Victim atlas owned by a different user.
    const userB = await createUser(db, { username: 'cross_atlas_victim' });
    atlasB = await createAtlas(db, userB.id);
    mapB = await createMap(db, atlasB.id);
    briefingB = await createBriefing(db, atlasB.id, { name: 'Victim Briefing' });
    slideB = await createSlide(db, briefingB.id, { title: 'Victim Slide' });
    groupB = await createGroup(db, mapB.id);
    featureB = await createFeature(db, mapB.id, { properties: { name: 'Victim Feature' } });
    layerB = await createLayer(db, mapB.id, { name: 'Victim Layer' });
    cesiumB = await createCesium3dData(db, mapB.id);
    sv360B = await createStreetview360Data(db, mapB.id);
    await db.query(
      'INSERT INTO group_features (group_id, feature_id) VALUES ($1, $2)',
      [groupB.id, featureB.id]
    );
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  function pushToAtlasA(operations) {
    return supertest(app)
      .post(`/api/v1/atlas/${atlasA.id}/sync`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ operations });
  }

  it('cannot UPDATE a slide of another atlas', async () => {
    await pushToAtlasA([{
      id: randomUUID(), type: 'update', target: 'slide', targetId: slideB.id,
      changes: { title: 'HACKED' }, timestamp: Date.now(), clientId: 'attacker',
    }]).expect(200);

    const { rows } = await db.query('SELECT title FROM slides WHERE id = $1', [slideB.id]);
    assert.equal(rows[0].title, 'Victim Slide', 'slide of atlas B must be untouched');
  });

  it('cannot soft-DELETE a slide of another atlas', async () => {
    await pushToAtlasA([{
      id: randomUUID(), type: 'delete', target: 'slide', targetId: slideB.id,
      timestamp: Date.now(), clientId: 'attacker',
    }]).expect(200);

    const { rows } = await db.query('SELECT deleted_at FROM slides WHERE id = $1', [slideB.id]);
    assert.equal(rows[0].deleted_at, null, 'slide of atlas B must not be deleted');
  });

  it('cannot CREATE a slide attached to another atlas briefing', async () => {
    const slideId = randomUUID();
    await pushToAtlasA([{
      id: randomUUID(), type: 'create', target: 'slide', targetId: slideId,
      data: { briefing_id: briefingB.id, title: 'Injected', mode: '2d' },
      timestamp: Date.now(), clientId: 'attacker',
    }]).expect(200);

    const { rows } = await db.query('SELECT id FROM slides WHERE id = $1', [slideId]);
    assert.equal(rows.length, 0, 'slide must not be created against a cross-atlas briefing');
  });

  it('cannot DELETE a group_feature link of another atlas', async () => {
    await pushToAtlasA([{
      id: randomUUID(), type: 'delete', target: 'group_feature', targetId: randomUUID(),
      mapId: mapB.id, data: { group_id: groupB.id, feature_id: featureB.id },
      timestamp: Date.now(), clientId: 'attacker',
    }]).expect(200);

    const { rows } = await db.query(
      'SELECT 1 FROM group_features WHERE group_id = $1 AND feature_id = $2',
      [groupB.id, featureB.id]
    );
    assert.equal(rows.length, 1, 'group_feature link of atlas B must survive');
  });

  it('cannot CREATE a group_feature link across atlases', async () => {
    const group2 = await createGroup(db, mapB.id);
    const feature2 = await createFeature(db, mapB.id);

    await pushToAtlasA([{
      id: randomUUID(), type: 'create', target: 'group_feature', targetId: randomUUID(),
      mapId: mapB.id, data: { group_id: group2.id, feature_id: feature2.id },
      timestamp: Date.now(), clientId: 'attacker',
    }]).expect(200);

    const { rows } = await db.query(
      'SELECT 1 FROM group_features WHERE group_id = $1 AND feature_id = $2',
      [group2.id, feature2.id]
    );
    assert.equal(rows.length, 0, 'cross-atlas group_feature link must not be created');
  });

  // --- Map-scoped entities (feature/group/layer/cesium3d/streetview360) -------
  // These are filtered by map_id; the apply SQL must additionally pin the map to
  // the ROUTE atlas, else a writer on A could mutate B's data via B's mapId.

  it('cannot CREATE a feature in another atlas map', async () => {
    const id = randomUUID();
    await pushToAtlasA([{
      id: randomUUID(), type: 'create', target: 'feature', targetId: id, mapId: mapB.id,
      data: { feature_type: 'point', geometry: { coordinates: [0, 0] }, properties: {} },
      timestamp: Date.now(), clientId: 'attacker',
    }]).expect(200);
    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [id]);
    assert.equal(rows.length, 0, 'feature must not be created in atlas B');
  });

  it('cannot UPDATE a feature of another atlas map', async () => {
    await pushToAtlasA([{
      id: randomUUID(), type: 'update', target: 'feature', targetId: featureB.id, mapId: mapB.id,
      changes: { properties: { name: 'HACKED' } }, timestamp: Date.now(), clientId: 'attacker',
    }]).expect(200);
    const { rows } = await db.query('SELECT properties FROM features WHERE id = $1', [featureB.id]);
    assert.equal(rows[0].properties.name, 'Victim Feature', 'feature of atlas B must be untouched');
  });

  it('cannot soft-DELETE a feature of another atlas map', async () => {
    await pushToAtlasA([{
      id: randomUUID(), type: 'delete', target: 'feature', targetId: featureB.id, mapId: mapB.id,
      timestamp: Date.now(), clientId: 'attacker',
    }]).expect(200);
    const { rows } = await db.query('SELECT deleted_at FROM features WHERE id = $1', [featureB.id]);
    assert.equal(rows[0].deleted_at, null, 'feature of atlas B must not be deleted');
  });

  it('cannot UPDATE a layer of another atlas map', async () => {
    await pushToAtlasA([{
      id: randomUUID(), type: 'update', target: 'layer', targetId: layerB.id, mapId: mapB.id,
      changes: { name: 'HACKED' }, timestamp: Date.now(), clientId: 'attacker',
    }]).expect(200);
    const { rows } = await db.query('SELECT name FROM layers WHERE id = $1', [layerB.id]);
    assert.equal(rows[0].name, 'Victim Layer', 'layer of atlas B must be untouched');
  });

  it('cannot soft-DELETE a group of another atlas map', async () => {
    await pushToAtlasA([{
      id: randomUUID(), type: 'delete', target: 'group', targetId: groupB.id, mapId: mapB.id,
      timestamp: Date.now(), clientId: 'attacker',
    }]).expect(200);
    const { rows } = await db.query('SELECT deleted_at FROM groups WHERE id = $1', [groupB.id]);
    assert.equal(rows[0].deleted_at, null, 'group of atlas B must not be deleted');
  });

  it('cannot UPDATE a cesium3d entity of another atlas map', async () => {
    await pushToAtlasA([{
      id: randomUUID(), type: 'update', target: 'cesium3d', targetId: cesiumB.id, mapId: mapB.id,
      changes: { tileset_id: 'HACKED' }, timestamp: Date.now(), clientId: 'attacker',
    }]).expect(200);
    const { rows } = await db.query('SELECT tileset_id FROM cesium3d_data WHERE id = $1', [cesiumB.id]);
    assert.notEqual(rows[0].tileset_id, 'HACKED', 'cesium3d of atlas B must be untouched');
  });

  it('cannot soft-DELETE a streetview360 entity of another atlas map', async () => {
    await pushToAtlasA([{
      id: randomUUID(), type: 'delete', target: 'streetview360', targetId: sv360B.id, mapId: mapB.id,
      timestamp: Date.now(), clientId: 'attacker',
    }]).expect(200);
    const { rows } = await db.query('SELECT deleted_at FROM streetview360_data WHERE id = $1', [sv360B.id]);
    assert.equal(rows[0].deleted_at, null, 'streetview360 of atlas B must not be deleted');
  });

  it('cannot MOVE an own feature into another atlas map via changes.map_id (403)', async () => {
    const own = await createFeature(db, mapA.id, { properties: { name: 'Mine' } });
    await pushToAtlasA([{
      id: randomUUID(), type: 'update', target: 'feature', targetId: own.id, mapId: mapA.id,
      changes: { map_id: mapB.id }, timestamp: Date.now(), clientId: 'attacker',
    }]).expect(403);
    const { rows } = await db.query('SELECT map_id FROM features WHERE id = $1', [own.id]);
    assert.equal(rows[0].map_id, mapA.id, 'feature must remain in its own atlas map');
  });

  it('POSITIVE control: owner can CREATE/UPDATE a feature in their OWN atlas map', async () => {
    const id = randomUUID();
    await pushToAtlasA([{
      id: randomUUID(), type: 'create', target: 'feature', targetId: id, mapId: mapA.id,
      data: { feature_type: 'point', geometry: { coordinates: [1, 1] }, properties: { name: 'ok' } },
      timestamp: Date.now(), clientId: 'owner',
    }]).expect(200);
    let { rows } = await db.query('SELECT properties FROM features WHERE id = $1', [id]);
    assert.equal(rows.length, 1, 'own-atlas feature must be created');

    await pushToAtlasA([{
      id: randomUUID(), type: 'update', target: 'feature', targetId: id, mapId: mapA.id,
      changes: { properties: { name: 'renamed' } }, timestamp: Date.now(), clientId: 'owner',
    }]).expect(200);
    ({ rows } = await db.query('SELECT properties FROM features WHERE id = $1', [id]));
    assert.equal(rows[0].properties.name, 'renamed', 'own-atlas update must still work');
  });

  it('POSITIVE control: owner can still update a slide in their OWN atlas', async () => {
    const briefingA = await createBriefing(db, atlasA.id, { name: 'Own Briefing' });
    const slideA = await createSlide(db, briefingA.id, { title: 'Own Slide' });

    await pushToAtlasA([{
      id: randomUUID(), type: 'update', target: 'slide', targetId: slideA.id,
      changes: { title: 'Own Slide Renamed' }, timestamp: Date.now(), clientId: 'owner',
    }]).expect(200);

    const { rows } = await db.query('SELECT title FROM slides WHERE id = $1', [slideA.id]);
    assert.equal(rows[0].title, 'Own Slide Renamed', 'same-atlas update must still work');
  });
});
