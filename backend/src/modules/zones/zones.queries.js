// Path: src/modules/zones/zones.queries.js

export const LIST_ZONES = `
  SELECT id, name, description, created_at FROM ng.geographic_access_zones ORDER BY created_at DESC
`;

export const FIND_ZONE = `
  SELECT id, name, description, created_at, ST_AsGeoJSON(geom)::jsonb AS geom
  FROM ng.geographic_access_zones WHERE id = $1
`;

// Validates a GeoJSON geometry before write: ST_GeomFromGeoJSON parses it (throws
// on malformed JSON shape) and ST_IsValid rejects self-intersections / unclosed
// rings. Returns a single row { valid: boolean }.
export const VALIDATE_GEOM = `
  SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4674)) AS valid
`;

// geom comes in as a GeoJSON Polygon; stored as SRID 4674 (matches nomes).
export const INSERT_ZONE = `
  INSERT INTO ng.geographic_access_zones (name, description, geom, created_by)
  VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4674), $4)
  RETURNING id, name, description, created_at
`;

// Full replace of a zone's name/description/geom (PUT semantics).
export const UPDATE_ZONE = `
  UPDATE ng.geographic_access_zones
  SET name = $2, description = $3, geom = ST_SetSRID(ST_GeomFromGeoJSON($4), 4674)
  WHERE id = $1
  RETURNING id, name, description, created_at
`;

export const DELETE_ZONE = `DELETE FROM ng.geographic_access_zones WHERE id = $1 RETURNING id`;

export const GET_ZONE_USER_PERMS = `SELECT user_id FROM ng.zone_permissions WHERE zone_id = $1`;
export const GET_ZONE_GROUP_PERMS = `SELECT group_id FROM ng.zone_group_permissions WHERE zone_id = $1`;
export const DELETE_ZONE_USER_PERMS = `DELETE FROM ng.zone_permissions WHERE zone_id = $1`;
export const DELETE_ZONE_GROUP_PERMS = `DELETE FROM ng.zone_group_permissions WHERE zone_id = $1`;
export const INSERT_ZONE_USER_PERMS = `
  INSERT INTO ng.zone_permissions (zone_id, user_id)
  SELECT $1, u FROM unnest($2::uuid[]) AS u ON CONFLICT DO NOTHING
`;
export const INSERT_ZONE_GROUP_PERMS = `
  INSERT INTO ng.zone_group_permissions (zone_id, group_id)
  SELECT $1, g FROM unnest($2::uuid[]) AS g ON CONFLICT DO NOTHING
`;
