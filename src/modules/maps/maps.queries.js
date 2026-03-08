// Path: src/modules/maps/maps.queries.js

export const INSERT_MAP = `
  INSERT INTO maps (atlas_id, name, base_layer, center_lat, center_long, zoom, bearing, pitch, notes_title, notes_description, analysis_layers, catalog_layers)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  RETURNING *
`;

export const FIND_MAP_BY_ID = `
  SELECT * FROM maps
  WHERE id = $1 AND atlas_id = $2 AND deleted_at IS NULL
`;

export const LIST_MAPS_BY_ATLAS = `
  SELECT * FROM maps
  WHERE atlas_id = $1 AND deleted_at IS NULL
  ORDER BY created_at
`;

export const UPDATE_MAP = `
  UPDATE maps
  SET name = COALESCE($3, name),
      base_layer = COALESCE($4, base_layer),
      center_lat = COALESCE($5, center_lat),
      center_long = COALESCE($6, center_long),
      zoom = COALESCE($7, zoom),
      bearing = COALESCE($8, bearing),
      pitch = COALESCE($9, pitch),
      notes_title = COALESCE($10, notes_title),
      notes_description = COALESCE($11, notes_description),
      analysis_layers = COALESCE($12, analysis_layers),
      catalog_layers = COALESCE($13, catalog_layers),
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND atlas_id = $2 AND deleted_at IS NULL
  RETURNING *
`;

export const SOFT_DELETE_MAP = `
  UPDATE maps
  SET deleted_at = NOW(),
      updated_at = NOW(),
      version = version + 1
  WHERE id = $1 AND atlas_id = $2 AND deleted_at IS NULL
  RETURNING id
`;

export const ADD_MAP_TO_ATLAS_ORDER = `
  UPDATE atlas
  SET map_order = array_append(map_order, $2::uuid),
      updated_at = NOW()
  WHERE id = $1
`;

export const REMOVE_MAP_FROM_ATLAS_ORDER = `
  UPDATE atlas
  SET map_order = array_remove(map_order, $2::uuid),
      updated_at = NOW()
  WHERE id = $1
`;
