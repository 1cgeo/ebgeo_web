// Path: src/modules/maps/maps.queries.js
// Read-only queries. All write operations are managed via sync API.

// EXPLICIT COLUMN LIST, NOT `SELECT *`. It is a useful property, and the version of this comment
// that called it "a security property" was claiming more than it delivered — publishing a column
// ON PURPOSE only helps if somebody audits WHAT the column carries, and nobody had.
//
// Both queries below feed a route gated only at `read` (`maps.routes.js`), a level an anonymous
// public-link visitor holds, and the controller answers `res.json({ data })` with the row as it
// comes. `POST /atlas/:atlasId/maps/:mapId/duplicate` reads the same set (`atlas.service.js`) and
// answers 201 with the new row, which is why enumerating only `router.get(` missed it.
//
// `maps.catalog_layers` used to hand out a stale copy of the catalog row — `config.source.url` of
// a private resource included — and migration 022 dropped it. THE SIBLING DECLARED IN THE SAME
// JSONB BLOCK DID NOT GO, and it is `analysis_layers`, right below. Audited in F13, and the audit
// is the part worth writing down:
//
//   - it is a FREE-FORM JSONB bag. Nothing validates its inside: `sync.schemas.js` declares
//     `data`/`changes` as `Joi.object().unknown(true)`, and `atlas.schemas.js` declares
//     `analysis_layers: Joi.object()` with no keys, which `stripUnknown: true` does not prune
//     (measured). Any client with `write` — or `comment`, which is the gate on the push route —
//     can put a full catalog-layer definition in it through `MAP_UPDATE_FIELDS` or through the
//     `gridStyle` sub-type, and a public visitor reads it back from four surfaces.
//   - its one live producer writes TOGGLE STATE, not definitions. `frontend/src/js/import_export/
//     local-atlas-to-server.js` uploads `mapData.analysisLayers` verbatim on the whole-atlas import
//     path, and the local field is declared as "Analysis layer toggle states" in `store.types.js`,
//     born `{}`. The sync path has no alias that fills it either (`normalizeMapChanges`).
//   - and the neighbour on the very next line of that uploader is the tell: `catalog_layers` is run
//     through `pruneCatalogLayerDefinitions` before being sent, precisely because a whole-entity
//     upload bypasses the sync write gate. `analysis_layers` got no equivalent. The carrier beside
//     the one that was defended was left open.
//
// So it is NOT structurally incapable of carrying a definition — it was an open carrier with no
// argument written anywhere, exactly like its dropped sibling. It stays published because the
// client contract reads it, and what makes that safe is no longer this list: every JSON body
// leaves through the prune in `middleware/prune-resource-payload.js`, which walks the response by
// CONTENT and takes the definition out of wherever it sits, this column included. `SELECT *` over
// a table nobody promised not to grow is still the defect underneath, and it is shared with
// `atlas.service.js` (duplicateMap), which reads the same set.
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
