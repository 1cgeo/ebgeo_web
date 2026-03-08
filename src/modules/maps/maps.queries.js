// Path: src/modules/maps/maps.queries.js
// Read-only queries. All write operations are managed via sync API.

export const FIND_MAP_BY_ID = `
  SELECT * FROM maps
  WHERE id = $1 AND atlas_id = $2 AND deleted_at IS NULL
`;

export const LIST_MAPS_BY_ATLAS = `
  SELECT * FROM maps
  WHERE atlas_id = $1 AND deleted_at IS NULL
  ORDER BY created_at
`;
