// Path: src/modules/zones/zones.queries.js

export const LIST_ZONES = `
  SELECT id, name, description, created_at FROM ng.geographic_access_zones ORDER BY created_at DESC
`;

export const FIND_ZONE = `
  SELECT id, name, description, created_at, ST_AsGeoJSON(geom)::jsonb AS geom
  FROM ng.geographic_access_zones WHERE id = $1
`;

// geom comes in as a GeoJSON Polygon; stored as SRID 4674 (matches nomes).
export const INSERT_ZONE = `
  INSERT INTO ng.geographic_access_zones (name, description, geom, created_by)
  VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4674), $4)
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
