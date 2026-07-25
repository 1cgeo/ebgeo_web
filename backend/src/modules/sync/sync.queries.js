// Path: src/modules/sync/sync.queries.js

export const INSERT_OPERATION = `
  INSERT INTO operations (atlas_id, op_type, entity_type, entity_id, map_id, changes, data, client_timestamp, client_id, user_id, op_id, lamport_timestamp)
  VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12)
  ON CONFLICT (atlas_id, op_id) DO NOTHING
  RETURNING *
`;

// Fetch an already-applied operation by its client op id (for idempotent acks).
export const GET_OPERATION_BY_OP_ID = `
  SELECT server_version, entity_id FROM operations WHERE atlas_id = $1 AND op_id = $2
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
         grid_style, temporal_config, locked, created_at, updated_at, version
  FROM maps
  WHERE atlas_id = $1 AND deleted_at IS NULL
  ORDER BY created_at
`;

// Per-layer catalog layers (dedicated table; soft-deleted excluded).
export const GET_MAP_CATALOG_LAYERS = `
  SELECT id, map_id, data, created_at, updated_at, version
  FROM catalog_layers
  WHERE map_id = $1 AND deleted_at IS NULL
`;

// ---------------------------------------------------------------------------
// Coleções do snapshot buscadas UMA VEZ por atlas, agrupadas em memória por
// map_id (ou briefing_id).
//
// O snapshot fazia SETE round-trips POR MAPA mais um POR BRIEFING, tudo dentro
// do mesmo `task()`, que retém uma conexão do pool (poolMax default 10) durante
// a série inteira. E ele está no caminho quente: `pullOperations` chama o
// snapshot sempre que `sinceVersion === 0` ou o cliente está atrás de
// `min_version`, ou seja, em TODO connect de todo usuário.
//
// O padrão já existia neste mesmo arquivo — GET_ATLAS_COMMENTS busca uma vez e
// o service agrupa por map_id, com o comentário explicando que é "to avoid an
// extra per-map query for every (often empty) map". As outras coleções ficaram
// de fora. Estas fecham a assimetria.
//
// O filtro é por JOIN em `maps.atlas_id` (e não `map_id IN (subselect)`) para
// que o planner use o índice de `atlas_id` e não materialize a lista de ids.
// ---------------------------------------------------------------------------

export const GET_ATLAS_FEATURES = `
  SELECT f.id, f.map_id, f.feature_type, f.geometry, f.properties, f.layer_id,
         f.created_at, f.updated_at, f.version
  FROM features f
  JOIN maps m ON m.id = f.map_id
  WHERE m.atlas_id = $1 AND m.deleted_at IS NULL AND f.deleted_at IS NULL
`;

export const GET_ATLAS_CESIUM3D = `
  SELECT c.id, c.map_id, c.data_type, c.tileset_id, c.data,
         c.created_at, c.updated_at, c.version
  FROM cesium3d_data c
  JOIN maps m ON m.id = c.map_id
  WHERE m.atlas_id = $1 AND m.deleted_at IS NULL AND c.deleted_at IS NULL
`;

export const GET_ATLAS_STREETVIEW360 = `
  SELECT s.id, s.map_id, s.data_type, s.photo_name, s.data,
         s.created_at, s.updated_at, s.version
  FROM streetview360_data s
  JOIN maps m ON m.id = s.map_id
  WHERE m.atlas_id = $1 AND m.deleted_at IS NULL AND s.deleted_at IS NULL
`;

export const GET_ATLAS_CATALOG_LAYERS = `
  SELECT c.id, c.map_id, c.data, c.created_at, c.updated_at, c.version
  FROM catalog_layers c
  JOIN maps m ON m.id = c.map_id
  WHERE m.atlas_id = $1 AND m.deleted_at IS NULL AND c.deleted_at IS NULL
`;

export const GET_ATLAS_LAYERS = `
  SELECT l.id, l.map_id, l.name, l.visible, l.locked, l.opacity, l.sort_order,
         l.style, l.created_at, l.updated_at, l.version
  FROM layers l
  JOIN maps m ON m.id = l.map_id
  WHERE m.atlas_id = $1 AND m.deleted_at IS NULL AND l.deleted_at IS NULL
  ORDER BY l.sort_order
`;

export const GET_ATLAS_GROUPS = `
  SELECT g.id, g.map_id, g.name, g.visible, g.locked, g.style, g.parent_id,
         g.created_at, g.updated_at, g.version
  FROM groups g
  JOIN maps m ON m.id = g.map_id
  WHERE m.atlas_id = $1 AND m.deleted_at IS NULL AND g.deleted_at IS NULL
`;

export const GET_ATLAS_GROUP_FEATURES = `
  SELECT g.map_id, gf.group_id, gf.feature_id
  FROM group_features gf
  JOIN groups g ON g.id = gf.group_id
  JOIN maps m ON m.id = g.map_id
  WHERE m.atlas_id = $1 AND m.deleted_at IS NULL AND g.deleted_at IS NULL
`;

export const GET_ATLAS_SLIDES = `
  SELECT s.id, s.briefing_id, s.title, s.content, s.mode, s.map_id, s.model_id,
         s.photo_id, s.position, s.orientation, s.temporal_cursor, s.is_broken,
         s.broken_reason, s.created_at, s.updated_at, s.version
  FROM slides s
  JOIN briefings b ON b.id = s.briefing_id
  WHERE b.atlas_id = $1 AND b.deleted_at IS NULL AND s.deleted_at IS NULL
`;

export const GET_ATLAS_COMMENTS = `
  SELECT id, map_id, parent_id, author_id, lng, lat, status, data,
         created_at, updated_at, version
  FROM comments
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
         position, orientation, temporal_cursor, is_broken, broken_reason,
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
