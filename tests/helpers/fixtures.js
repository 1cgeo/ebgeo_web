// Path: tests/helpers/fixtures.js
// Factory functions that create test data and return both the DB record
// and the HTTP-ready payload. Each factory accepts partial overrides.

import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 4; // Low for test speed

/**
 * Creates a user directly in the DB.
 */
export async function createUser(db, overrides = {}) {
  const defaults = {
    username: `user_${randomUUID().slice(0, 8)}`,
    password: 'Test@1234',
    nome: 'Test User',
    posto_graduacao: 'Cap',
    organizacao_militar: 'OM Teste',
    role: 'user',
  };
  const data = { ...defaults, ...overrides };
  const hash = await bcrypt.hash(data.password, SALT_ROUNDS);

  const { rows } = await db.query(
    `INSERT INTO users (username, password_hash, nome, posto_graduacao, organizacao_militar, role)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [data.username, hash, data.nome, data.posto_graduacao, data.organizacao_militar, data.role]
  );

  return { ...rows[0], password: data.password };
}

/**
 * Creates an admin user directly in the DB.
 */
export async function createAdminUser(db, overrides = {}) {
  return createUser(db, { ...overrides, role: 'admin' });
}

/**
 * Creates an atlas owned by the given user.
 */
export async function createAtlas(db, ownerId, overrides = {}) {
  const defaults = { name: `Atlas ${randomUUID().slice(0, 6)}`, description: null };
  const data = { ...defaults, ...overrides };

  const { rows } = await db.query(
    `INSERT INTO atlas (name, description, owner_id) VALUES ($1, $2, $3) RETURNING *`,
    [data.name, data.description, ownerId]
  );
  return rows[0];
}

/**
 * Creates a map inside an atlas.
 */
export async function createMap(db, atlasId, overrides = {}) {
  const defaults = {
    name: `Map ${randomUUID().slice(0, 6)}`,
    base_layer: 'carta-topografica',
    center_lat: -22.9,
    center_long: -43.2,
    zoom: 10,
    bearing: 0,
    pitch: 0,
  };
  const data = { ...defaults, ...overrides };

  const { rows } = await db.query(
    `INSERT INTO maps (atlas_id, name, base_layer, center_lat, center_long, zoom, bearing, pitch)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [atlasId, data.name, data.base_layer, data.center_lat, data.center_long, data.zoom, data.bearing, data.pitch]
  );

  // Add to atlas map_order
  await db.query(
    `UPDATE atlas SET map_order = array_append(map_order, $1::uuid) WHERE id = $2`,
    [rows[0].id, atlasId]
  );

  return rows[0];
}

/**
 * Creates a feature inside a map.
 */
export async function createFeature(db, mapId, overrides = {}) {
  const defaults = {
    feature_type: 'point',
    geometry: { coordinates: [-43.2, -22.9] },
    properties: { name: 'Test Point', color: '#ff0000' },
  };
  const data = { ...defaults, ...overrides };

  const { rows } = await db.query(
    `INSERT INTO features (map_id, feature_type, geometry, properties)
     VALUES ($1, $2, $3::jsonb, $4::jsonb) RETURNING *`,
    [mapId, data.feature_type, JSON.stringify(data.geometry), JSON.stringify(data.properties)]
  );
  return rows[0];
}

/**
 * Creates a layer inside a map.
 */
export async function createLayer(db, mapId, overrides = {}) {
  const defaults = {
    name: `Layer ${randomUUID().slice(0, 6)}`,
    visible: true,
    locked: false,
    sort_order: 0,
  };
  const data = { ...defaults, ...overrides };

  const { rows } = await db.query(
    `INSERT INTO layers (map_id, name, visible, locked, sort_order)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [mapId, data.name, data.visible, data.locked, data.sort_order]
  );
  return rows[0];
}

/**
 * Creates a group inside a map.
 */
export async function createGroup(db, mapId, overrides = {}) {
  const defaults = {
    name: `Group ${randomUUID().slice(0, 6)}`,
    visible: true,
    locked: false,
  };
  const data = { ...defaults, ...overrides };

  const { rows } = await db.query(
    `INSERT INTO groups (map_id, name, visible, locked)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [mapId, data.name, data.visible, data.locked]
  );
  return rows[0];
}

/**
 * Creates an atlas share.
 */
export async function createShare(db, atlasId, userId, permission, addedBy) {
  const { rows } = await db.query(
    `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [atlasId, userId, permission, addedBy]
  );
  return rows[0];
}

/**
 * Logs in a user via the API and returns the access token.
 */
export async function loginUser(app, username, password) {
  const supertest = (await import('supertest')).default;
  const res = await supertest(app)
    .post('/api/v1/auth/login')
    .send({ username, password });

  if (res.status !== 200) {
    throw new Error(`Login failed: ${res.status} - ${JSON.stringify(res.body)}`);
  }

  return res.body.data.accessToken;
}

/**
 * Creates a briefing inside an atlas.
 */
export async function createBriefing(db, atlasId, overrides = {}) {
  const defaults = {
    name: `Briefing ${randomUUID().slice(0, 6)}`,
    description: null,
    settings: { panelPosition: 'left', panelWidth: 350 },
  };
  const data = { ...defaults, ...overrides };

  const { rows } = await db.query(
    `INSERT INTO briefings (atlas_id, name, description, settings)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
    [atlasId, data.name, data.description, JSON.stringify(data.settings)]
  );
  return rows[0];
}

/**
 * Creates a slide inside a briefing.
 */
export async function createSlide(db, briefingId, overrides = {}) {
  const defaults = {
    title: `Slide ${randomUUID().slice(0, 6)}`,
    content: 'Test slide content',
    mode: '2d',
    map_id: null,
    position: { lat: -22.9, lng: -43.2, zoom: 10 },
    orientation: { bearing: 0, pitch: 0 },
  };
  const data = { ...defaults, ...overrides };

  const { rows } = await db.query(
    `INSERT INTO slides (briefing_id, title, content, mode, map_id, position, orientation)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) RETURNING *`,
    [briefingId, data.title, data.content, data.mode, data.map_id, JSON.stringify(data.position), JSON.stringify(data.orientation)]
  );
  return rows[0];
}

/**
 * Creates a resource directly in the DB (for admin tests).
 */
export async function createResource(db, overrides = {}) {
  const defaults = {
    id: `resource_${randomUUID().slice(0, 8)}`,
    category: 'basemap',
    name: `Resource ${randomUUID().slice(0, 6)}`,
    description: 'Test resource',
    config: { url: 'https://example.com/tiles/{z}/{x}/{y}.png' },
    sort_order: 0,
  };
  const data = { ...defaults, ...overrides };

  const { rows } = await db.query(
    `INSERT INTO resources (id, category, name, description, config, sort_order)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *`,
    [data.id, data.category, data.name, data.description, JSON.stringify(data.config), data.sort_order]
  );
  return rows[0];
}

/**
 * Inserts a CRDT operation into the operations log.
 */
export async function createOperation(db, atlasId, overrides = {}) {
  const defaults = {
    op_type: 'create',
    entity_type: 'feature',
    entity_id: randomUUID(),
    map_id: null,
    changes: null,
    data: { feature_type: 'point', geometry: { coordinates: [0, 0] }, properties: {} },
    client_timestamp: Date.now(),
    client_id: randomUUID().slice(0, 8),
    user_id: null,
  };
  const data = { ...defaults, ...overrides };

  const { rows } = await db.query(
    `INSERT INTO operations (atlas_id, op_type, entity_type, entity_id, map_id, changes, data, client_timestamp, client_id, user_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10) RETURNING *`,
    [atlasId, data.op_type, data.entity_type, data.entity_id, data.map_id,
     data.changes ? JSON.stringify(data.changes) : null,
     data.data ? JSON.stringify(data.data) : null,
     data.client_timestamp, data.client_id, data.user_id]
  );
  return rows[0];
}

/**
 * Makes an atlas public with a generated link.
 */
export async function makeAtlasPublic(db, atlasId) {
  const publicLink = randomUUID().replace(/-/g, '').slice(0, 32);
  await db.query(
    `UPDATE atlas SET is_public = true, public_link = $1 WHERE id = $2`,
    [publicLink, atlasId]
  );
  return publicLink;
}

/**
 * Gets a public token for an atlas (simulates GET /atlas/public/:link).
 */
export async function getPublicToken(app, publicLink) {
  const supertest = (await import('supertest')).default;
  const res = await supertest(app)
    .get(`/api/v1/atlas/public/${publicLink}`);

  if (res.status !== 200) {
    throw new Error(`Failed to get public token: ${res.status} - ${JSON.stringify(res.body)}`);
  }

  return res.body.data.publicToken;
}

/**
 * Creates a Cesium3D data entry inside a map.
 */
export async function createCesium3dData(db, mapId, overrides = {}) {
  const defaults = {
    data_type: 'marker',
    tileset_id: 'PCL',
    data: {
      position: { longitude: -43.2, latitude: -22.9, height: 100 },
      properties: { name: 'Test Marker' },
    },
  };
  const data = { ...defaults, ...overrides };

  const { rows } = await db.query(
    `INSERT INTO cesium3d_data (map_id, data_type, tileset_id, data)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
    [mapId, data.data_type, data.tileset_id, JSON.stringify(data.data)]
  );
  return rows[0];
}

/**
 * Creates a StreetView360 data entry inside a map.
 */
export async function createStreetview360Data(db, mapId, overrides = {}) {
  const defaults = {
    data_type: 'orientation',
    photo_name: 'foto-001',
    data: {
      heading: 45,
      pitch: 0,
      zoom: 1,
    },
  };
  const data = { ...defaults, ...overrides };

  const { rows } = await db.query(
    `INSERT INTO streetview360_data (map_id, data_type, photo_name, data)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
    [mapId, data.data_type, data.photo_name, JSON.stringify(data.data)]
  );
  return rows[0];
}
