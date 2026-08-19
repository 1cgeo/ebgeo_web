// Path: src/modules/maps/maps.queries.js
// Read-only queries. All write operations are managed via sync API.

// EXPLICIT COLUMN LIST, NOT `SELECT *`, and it is a security property rather than style.
//
// Both queries below feed a route gated only at `read` (`maps.routes.js`), a level an anonymous
// public-link visitor holds, and the controller answers `res.json({ data })` with the row as it
// comes. While `maps.catalog_layers` existed, that handed out a stale copy of the catalog row —
// `config.source.url` of a private resource included — on a path that never reaches the
// rehydration in `getAtlasSnapshot`. Migration 022 dropped the column, so there is nothing left
// to leak; the list stays explicit so the NEXT column added to `maps` has to be published on
// purpose instead of by inheritance. `SELECT *` over a table nobody promised not to grow is the
// defect underneath, and it is shared with `atlas.service.js` (duplicateMap), which reads the
// same set.
export const MAP_COLUMNS = `
  id, atlas_id, name, base_layer, center_lat, center_long, zoom, bearing, pitch,
  notes_title, notes_description, analysis_layers, grid_style, temporal_config,
  locked, version, created_at, updated_at, deleted_at
`;

export const FIND_MAP_BY_ID = `
  SELECT ${MAP_COLUMNS} FROM maps
  WHERE id = $1 AND atlas_id = $2 AND deleted_at IS NULL
`;

export const LIST_MAPS_BY_ATLAS = `
  SELECT ${MAP_COLUMNS} FROM maps
  WHERE atlas_id = $1 AND deleted_at IS NULL
  ORDER BY created_at
`;
