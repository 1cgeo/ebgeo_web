// Path: src/modules/sync/sync.queries.js

export const INSERT_OPERATION = `
  INSERT INTO operations (atlas_id, op_type, entity_type, entity_id, map_id, changes, data, client_timestamp, client_id, user_id)
  VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
  RETURNING *
`;

export const GET_OPERATIONS_SINCE_VERSION = `
  SELECT * FROM operations
  WHERE atlas_id = $1 AND server_version > $2
  ORDER BY server_version
`;

export const GET_CURRENT_VERSION = `
  SELECT COALESCE(MAX(server_version), 0) as current_version
  FROM operations
  WHERE atlas_id = $1
`;

// Hybrid sync queries
export const GET_ATLAS_SYNC_INFO = `
  SELECT id, min_version, current_version
  FROM atlas
  WHERE id = $1 AND deleted_at IS NULL
`;

export const GET_ATLAS_METADATA = `
  SELECT id, name, description, owner_id, settings, map_order, is_public,
         created_at, updated_at, version, current_version
  FROM atlas
  WHERE id = $1 AND deleted_at IS NULL
`;

export const GET_ATLAS_MAPS = `
  SELECT id, name, base_layer, center_lat, center_long, zoom, bearing, pitch,
         notes_title, notes_description, analysis_layers, catalog_layers,
         locked, created_at, updated_at, version
  FROM maps
  WHERE atlas_id = $1 AND deleted_at IS NULL
  ORDER BY created_at
`;

export const GET_MAP_FEATURES = `
  SELECT id, map_id, feature_type, geometry, properties, layer_id,
         created_at, updated_at, version
  FROM features
  WHERE map_id = $1 AND deleted_at IS NULL
`;

export const GET_MAP_LAYERS = `
  SELECT id, map_id, name, visible, locked, opacity, sort_order, style,
         created_at, updated_at, version
  FROM layers
  WHERE map_id = $1 AND deleted_at IS NULL
  ORDER BY sort_order
`;

export const GET_MAP_GROUPS = `
  SELECT id, map_id, name, visible, locked, style, parent_id,
         created_at, updated_at, version
  FROM groups
  WHERE map_id = $1 AND deleted_at IS NULL
`;

export const GET_GROUP_FEATURES = `
  SELECT gf.group_id, gf.feature_id
  FROM group_features gf
  JOIN groups g ON g.id = gf.group_id
  WHERE g.map_id = $1 AND g.deleted_at IS NULL
`;

export const GET_ATLAS_BRIEFINGS = `
  SELECT id, name, description, settings, slide_order,
         created_at, updated_at, version
  FROM briefings
  WHERE atlas_id = $1 AND deleted_at IS NULL
  ORDER BY created_at
`;

export const GET_BRIEFING_SLIDES = `
  SELECT id, briefing_id, title, content, mode, map_id, model_id, photo_id,
         position, orientation, is_broken, broken_reason,
         created_at, updated_at, version
  FROM slides
  WHERE briefing_id = $1 AND deleted_at IS NULL
`;

// Cleanup queries
export const DELETE_OLD_OPERATIONS = `
  DELETE FROM operations
  WHERE atlas_id = $1 AND server_version < $2
  RETURNING id
`;

export const UPDATE_ATLAS_MIN_VERSION = `
  UPDATE atlas
  SET min_version = $2, updated_at = NOW()
  WHERE id = $1
`;

export const GET_OLDEST_OPERATION_VERSION = `
  SELECT MIN(server_version) as oldest_version
  FROM operations
  WHERE atlas_id = $1
`;

// Cesium 3D data queries
export const GET_MAP_CESIUM3D = `
  SELECT id, map_id, data_type, tileset_id, data,
         created_at, updated_at, version
  FROM cesium3d_data
  WHERE map_id = $1 AND deleted_at IS NULL
`;

// StreetView 360 data queries
export const GET_MAP_STREETVIEW360 = `
  SELECT id, map_id, data_type, photo_name, data,
         created_at, updated_at, version
  FROM streetview360_data
  WHERE map_id = $1 AND deleted_at IS NULL
`;
