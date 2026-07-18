// Path: tests/integration/features-all-types.test.js
// Integration tests for all 18 feature types via sync create and snapshot verify.
// Focus on types not well-covered elsewhere: image, ellipse, brush
// Also tests complex geometry (MultiPolygon with holes) and many custom properties.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

/**
 * Helper: push a feature via sync and return the response.
 */
async function pushFeature(app, token, atlasId, mapId, featureType, geometry, properties = {}) {
  const targetId = randomUUID();
  const res = await supertest(app)
    .post(`/api/v1/atlas/${atlasId}/sync`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      operations: [{
        id: randomUUID(),
        type: 'create',
        target: 'feature',
        targetId,
        mapId,
        data: {
          feature_type: featureType,
          geometry,
          properties: { name: `${featureType} feature`, ...properties },
        },
        timestamp: Date.now(),
        clientId: 'all-types-client',
      }],
    });

  return { targetId, res };
}

/**
 * Helper: get snapshot and find a feature by id in the given collection.
 */
async function findFeatureInSnapshot(app, token, atlasId, mapId, collectionName, featureId) {
  const res = await supertest(app)
    .get(`/api/v1/atlas/${atlasId}/sync/0`)
    .set('Authorization', `Bearer ${token}`);

  const mapData = res.body.data.snapshot.maps.find(m => m.id === mapId);
  if (!mapData) return null;

  const collection = mapData.features[collectionName];
  if (!collection) return null;

  return collection.find(f => f.properties.id === featureId);
}

describe('All 18 Feature Types via Sync', () => {
  let app, db, user, token, atlasId, mapId;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'all_types_user' });
    token = await loginUser(app, user.username, user.password);
    const atlas = await createAtlas(db, user.id);
    const map = await createMap(db, atlas.id);
    atlasId = atlas.id;
    mapId = map.id;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('Basic Feature Types', () => {
    it('point -> points collection', async () => {
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'point',
        { coordinates: [-43.2, -22.9] }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'points', targetId);
      assert.ok(feature, 'point should be in points collection');
      assert.equal(feature.type, 'Feature');
      assert.equal(feature.properties.source, 'point');
    });

    it('line -> lines collection', async () => {
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'line',
        { coordinates: [[-43.2, -22.9], [-43.1, -22.8], [-43.0, -22.7]] }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'lines', targetId);
      assert.ok(feature, 'line should be in lines collection');
      assert.equal(feature.properties.source, 'line');
    });

    it('polygon -> polygons collection', async () => {
      const coords = [[[-43.3, -22.9], [-43.2, -22.9], [-43.2, -22.8], [-43.3, -22.9]]];
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'polygon',
        { coordinates: coords }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'polygons', targetId);
      assert.ok(feature, 'polygon should be in polygons collection');
      assert.equal(feature.properties.source, 'polygon');
    });

    it('text -> texts collection', async () => {
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'text',
        { coordinates: [-43.15, -22.85] },
        { text: 'Label', fontSize: 16, fontWeight: 'bold' }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'texts', targetId);
      assert.ok(feature, 'text should be in texts collection');
      assert.equal(feature.properties.source, 'text');
      assert.equal(feature.properties.text, 'Label');
    });
  });

  describe('Shape Feature Types (image, circle, rectangle, ellipse, brush)', () => {
    it('image -> images collection', async () => {
      const imageRef = randomUUID();
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'image',
        { coordinates: [-43.2, -22.9] },
        { imageId: imageRef, rotation: 15, scale: 1.5, opacity: 0.8 }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'images', targetId);
      assert.ok(feature, 'image should be in images collection');
      assert.equal(feature.properties.source, 'image');
      assert.equal(feature.properties.imageId, imageRef);
      assert.equal(feature.properties.rotation, 15);
    });

    it('circle -> circles collection', async () => {
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'circle',
        { center: [-43.2, -22.9], radius: 1000 }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'circles', targetId);
      assert.ok(feature, 'circle should be in circles collection');
      assert.equal(feature.properties.source, 'circle');
      assert.equal(feature.geometry.radius, 1000);
    });

    it('rectangle -> rectangles collection', async () => {
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'rectangle',
        { bounds: [[-43.3, -22.95], [-43.1, -22.85]] }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'rectangles', targetId);
      assert.ok(feature, 'rectangle should be in rectangles collection');
      assert.equal(feature.properties.source, 'rectangle');
    });

    it('ellipse -> ellipses collection', async () => {
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'ellipse',
        { center: [-43.2, -22.9], semiMajorAxis: 2000, semiMinorAxis: 800, rotation: 30 },
        { fillColor: '#ff6600', strokeColor: '#cc3300', strokeWidth: 2 }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'ellipses', targetId);
      assert.ok(feature, 'ellipse should be in ellipses collection');
      assert.equal(feature.properties.source, 'ellipse');
      assert.equal(feature.geometry.semiMajorAxis, 2000);
      assert.equal(feature.geometry.semiMinorAxis, 800);
      assert.equal(feature.geometry.rotation, 30);
    });

    it('brush -> brushes collection', async () => {
      const brushCoords = [
        [-43.20, -22.90], [-43.19, -22.89], [-43.18, -22.88],
        [-43.17, -22.87], [-43.16, -22.88], [-43.15, -22.89],
        [-43.14, -22.90], [-43.13, -22.89],
      ];
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'brush',
        { coordinates: brushCoords },
        { strokeColor: '#0000ff', strokeWidth: 3, smoothing: 0.5 }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'brushes', targetId);
      assert.ok(feature, 'brush should be in brushes collection');
      assert.equal(feature.properties.source, 'brush');
      assert.equal(feature.geometry.coordinates.length, brushCoords.length);
    });
  });

  describe('Military Feature Types', () => {
    it('arrow -> arrows collection', async () => {
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'arrow',
        { coordinates: [[-43.2, -22.9], [-43.1, -22.8], [-43.0, -22.7]] },
        { direction: 'forward', arrowType: 'attack' }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'arrows', targetId);
      assert.ok(feature, 'arrow should be in arrows collection');
      assert.equal(feature.properties.source, 'arrow');
    });

    it('boundary -> boundarys collection', async () => {
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'boundary',
        { coordinates: [[-43.5, -22.9], [-43.4, -22.85], [-43.3, -22.9]] },
        { boundaryType: 'FEBA', echelon: 'brigade' }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'boundarys', targetId);
      assert.ok(feature, 'boundary should be in boundarys collection');
      assert.equal(feature.properties.source, 'boundary');
    });

    it('occupied_front -> occupied_fronts collection', async () => {
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'occupied_front',
        { coordinates: [[-43.6, -22.9], [-43.5, -22.85], [-43.4, -22.9]] },
        { hostility: 'enemy', strength: 'reinforced' }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'occupied_fronts', targetId);
      assert.ok(feature, 'occupied_front should be in occupied_fronts collection');
      assert.equal(feature.properties.source, 'occupied_front');
    });

    it('military_symbol -> military_symbols collection', async () => {
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'military_symbol',
        { coordinates: [-43.2, -22.9] },
        { sidc: 'SFGPUCII---E---', echelon: 'company', affiliation: 'friend' }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'military_symbols', targetId);
      assert.ok(feature, 'military_symbol should be in military_symbols collection');
      assert.equal(feature.properties.source, 'military_symbol');
      assert.equal(feature.properties.sidc, 'SFGPUCII---E---');
    });

    it('coordination_measure -> coordination_measures collection', async () => {
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'coordination_measure',
        { coordinates: [[[-43.3, -22.95], [-43.2, -22.95], [-43.2, -22.85], [-43.3, -22.85], [-43.3, -22.95]]] },
        { measureType: 'assembly_area', time: '0800Z' }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'coordination_measures', targetId);
      assert.ok(feature, 'coordination_measure should be in coordination_measures collection');
      assert.equal(feature.properties.source, 'coordination_measure');
    });
  });

  describe('Analysis Feature Types', () => {
    it('los -> los collection', async () => {
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'los',
        { observer: [-43.2, -22.9], target: [-43.1, -22.8] },
        { observerHeight: 1.8, targetHeight: 2.5, status: 'pending' }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'los', targetId);
      assert.ok(feature, 'los should be in los collection');
      assert.equal(feature.properties.source, 'los');
    });

    it('visibility -> visibility collection', async () => {
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'visibility',
        { center: [-43.2, -22.9], radius: 5000 },
        { observerHeight: 10, status: 'pending' }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'visibility', targetId);
      assert.ok(feature, 'visibility should be in visibility collection');
      assert.equal(feature.properties.source, 'visibility');
    });

    it('processed_los -> processed_los collection', async () => {
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'processed_los',
        {
          observer: [-43.2, -22.9],
          target: [-43.1, -22.8],
          profile: [[0, 100], [500, 105], [1000, 98], [1500, 120]],
        },
        { result: 'visible', processedAt: new Date().toISOString() }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'processed_los', targetId);
      assert.ok(feature, 'processed_los should be in processed_los collection');
      assert.equal(feature.properties.source, 'processed_los');
      assert.equal(feature.properties.result, 'visible');
    });

    it('processed_visibility -> processed_visibility collection', async () => {
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'processed_visibility',
        {
          center: [-43.2, -22.9],
          visibleArea: [[[-43.25, -22.95], [-43.15, -22.95], [-43.15, -22.85], [-43.25, -22.85], [-43.25, -22.95]]],
        },
        { coverage: 0.75, processedAt: new Date().toISOString() }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'processed_visibility', targetId);
      assert.ok(feature, 'processed_visibility should be in processed_visibility collection');
      assert.equal(feature.properties.source, 'processed_visibility');
      assert.equal(feature.properties.coverage, 0.75);
    });

    it('sector -> setores collection', async () => {
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'sector',
        { center: [-43.2, -22.9], radius: 3000, startAngle: 30, endAngle: 90 }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'setores', targetId);
      assert.ok(feature, 'sector should be in setores collection');
      assert.equal(feature.properties.source, 'sector');
    });

    it('magnetic_declination -> magnetic_declinations collection', async () => {
      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'magnetic_declination',
        { coordinates: [-43.2, -22.9] },
        { declination: -21.5 }
      );
      assert.equal(res.status, 200);

      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'magnetic_declinations', targetId);
      assert.ok(feature, 'magnetic_declination should be in magnetic_declinations collection');
      assert.equal(feature.properties.source, 'magnetic_declination');
    });
  });

  describe('Complex Geometry and Properties', () => {
    it('creates polygon with complex geometry (MultiPolygon with holes)', async () => {
      // A polygon with a hole (outer ring + inner ring)
      const complexGeometry = {
        coordinates: [
          // Outer ring
          [[-43.5, -23.0], [-43.3, -23.0], [-43.3, -22.8], [-43.5, -22.8], [-43.5, -23.0]],
          // Hole (inner ring)
          [[-43.45, -22.95], [-43.35, -22.95], [-43.35, -22.85], [-43.45, -22.85], [-43.45, -22.95]],
        ],
      };

      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'polygon',
        complexGeometry,
        { name: 'Polygon with Hole', fillColor: '#00ff00' }
      );
      assert.equal(res.status, 200);

      // Verify in DB that geometry was stored correctly
      const { rows } = await db.query('SELECT geometry FROM features WHERE id = $1', [targetId]);
      assert.ok(rows[0].geometry.coordinates);
      assert.equal(rows[0].geometry.coordinates.length, 2, 'should have outer and inner rings');

      // Verify in snapshot
      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'polygons', targetId);
      assert.ok(feature);
      assert.equal(feature.geometry.coordinates.length, 2);
    });

    it('creates feature with many custom properties', async () => {
      const manyProperties = {
        name: 'Rich Feature',
        color: '#ff0000',
        strokeColor: '#000000',
        strokeWidth: 2,
        fillColor: '#ff000055',
        opacity: 0.8,
        visible: true,
        locked: false,
        label: 'Alpha Company HQ',
        description: 'Headquarters for Alpha Company, 1st Battalion',
        category: 'military',
        subcategory: 'headquarters',
        priority: 'high',
        status: 'active',
        createdBy: 'cap.silva',
        tags: ['hq', 'alpha', 'infantry'],
        metadata: {
          utm: { zone: '23K', easting: 677000, northing: 7467000 },
          altitude: 450,
          accuracy: 5,
        },
        customField1: 'value1',
        customField2: 42,
        customField3: true,
        customField4: null,
      };

      const { targetId, res } = await pushFeature(
        app, token, atlasId, mapId,
        'military_symbol',
        { coordinates: [-43.2, -22.9] },
        manyProperties
      );
      assert.equal(res.status, 200);

      // Verify properties are stored correctly
      const { rows } = await db.query('SELECT properties FROM features WHERE id = $1', [targetId]);
      const props = rows[0].properties;
      assert.equal(props.name, 'Rich Feature');
      assert.equal(props.priority, 'high');
      assert.deepEqual(props.tags, ['hq', 'alpha', 'infantry']);
      assert.equal(props.metadata.utm.zone, '23K');
      assert.equal(props.metadata.altitude, 450);
      assert.equal(props.customField2, 42);
      assert.equal(props.customField3, true);

      // Verify in snapshot
      const feature = await findFeatureInSnapshot(app, token, atlasId, mapId, 'military_symbols', targetId);
      assert.ok(feature);
      assert.equal(feature.properties.priority, 'high');
      assert.deepEqual(feature.properties.tags, ['hq', 'alpha', 'infantry']);
    });
  });

  describe('All collections present in snapshot', () => {
    it('snapshot has all 20 feature type collections', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlasId}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const mapData = res.body.data.snapshot.maps.find(m => m.id === mapId);
      assert.ok(mapData);

      const expectedCollections = [
        'points', 'lines', 'polygons', 'texts', 'images',
        'circles', 'rectangles', 'ellipses', 'brushes', 'setores', 'arrows',
        'boundarys', 'occupied_fronts', 'military_symbols', 'coordination_measures',
        'magnetic_declinations',
        'los', 'visibility', 'processed_los', 'processed_visibility',
      ];

      for (const collection of expectedCollections) {
        assert.ok(
          Array.isArray(mapData.features[collection]),
          `features.${collection} should be an array`
        );
      }

      // Since we created one of each type above, each should have at least 1
      for (const collection of expectedCollections) {
        assert.ok(
          mapData.features[collection].length >= 1,
          `features.${collection} should have at least 1 entry (has ${mapData.features[collection].length})`
        );
      }
    });
  });
});
