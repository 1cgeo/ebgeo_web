// Path: src/modules/sync/sync.queries.js
import { assertTable } from '../catalog/catalog.tables.js';
import { catalogAuthorizationPredicate, resourceTypeLiteral } from '../catalog/catalog.queries.js';

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
         notes_title, notes_description, analysis_layers,
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

// These two are the only snapshot collections the frontend transform keys by a VALUE
// rather than by row id (`cameraPositions[tileset_id]`, `orientations[photo_name]` in
// sync.service.js), so a `key = entry` assignment resolves duplicates by ARRIVAL ORDER —
// and without ORDER BY the arrival order is whatever the planner produces, which changes
// after any UPDATE that moves rows physically. Ordering by created_at makes the newest
// row the last writer, i.e. the winner, always the same way. The merge no longer creates
// such duplicates (maps.service.js KEYED_SINGLETONS), but rows predating that fix are
// still in the wild, and "the snapshot is deterministic" should not depend on one writer
// being careful. `id` closes the total order for equal timestamps.
export const GET_ATLAS_CESIUM3D = `
  SELECT c.id, c.map_id, c.data_type, c.tileset_id, c.data,
         c.created_at, c.updated_at, c.version
  FROM cesium3d_data c
  JOIN maps m ON m.id = c.map_id
  WHERE m.atlas_id = $1 AND m.deleted_at IS NULL AND c.deleted_at IS NULL
  ORDER BY c.map_id, c.created_at, c.id
`;

export const GET_ATLAS_STREETVIEW360 = `
  SELECT s.id, s.map_id, s.data_type, s.photo_name, s.data,
         s.created_at, s.updated_at, s.version
  FROM streetview360_data s
  JOIN maps m ON m.id = s.map_id
  WHERE m.atlas_id = $1 AND m.deleted_at IS NULL AND s.deleted_at IS NULL
  ORDER BY s.map_id, s.created_at, s.id
`;

export const GET_ATLAS_CATALOG_LAYERS = `
  SELECT c.id, c.map_id, c.data, c.created_at, c.updated_at, c.version
  FROM catalog_layers c
  JOIN maps m ON m.id = c.map_id
  WHERE m.atlas_id = $1 AND m.deleted_at IS NULL AND c.deleted_at IS NULL
`;

// ---------------------------------------------------------------------------
// F11 — a catalog layer is a REFERENCE, so the snapshot REHYDRATES its definition.
//
// `catalog_layers.data` holds a copy of the catalog row the client had at the moment it added
// the layer, `config.source.url` included. That desnormalization has two symptoms and only one
// of them was ever reported: it LEAKS (a private layer put on a map that is later published
// hands its URL to an anonymous caller, since a `read`-gated snapshot is what a public-link
// visitor gets) and it goes STALE (an admin fixing a URL leaves the old one alive in every
// atlas that had already added the layer, forever). The reference plus the per-atlas state stay
// in the row; the definition comes from the catalog AT READ TIME, through the access predicate
// of the CALLER.
//
// ONE query for the whole snapshot, never one per layer: the ids are collected in JS from the
// `catalog_layers` rows (the legacy `maps.catalog_layers` column was the other surface until
// migration 022 dropped it) and arrive here as two arrays, one per type. The Cesium/LOD lesson does not apply — this runs once per snapshot — but the
// N+1 lesson of `snapshot-n-mais-1.repro.test.js` does, and it is why this is not a lookup
// inside the per-map loop.
//
// Only the TWO types that are catalog resources appear here. `hillshade` is not one and must
// never join (see `catalog-layer.ref.js` for both defences).
// ---------------------------------------------------------------------------

/**
 * One branch of GET_VISIBLE_CATALOG_DEFINITIONS: the rows of one catalog table, among the ids
 * asked for, that this caller may SEE.
 *
 * `$1` = principal (uuid|null), `$2` = atlas in focus (uuid|null) — the atlas being synced, which
 * is what makes the LOAN branch (D4/R4) reach a public-link visitor exactly as
 * `/resource-access/visible` does for the same pair.
 *
 * @param {string} table - One of CATALOG_TABLES (whitelisted before interpolation).
 * @param {string} type - The resource type of that table.
 * @param {string} idsParam - SQL expression for the requested ids (a text[]).
 * @returns {string}
 */
const catalogDefinitionsOf = (table, type, idsParam) => `
  SELECT ${resourceTypeLiteral(type)} AS resource_type, t.id, t.name, t.config
    FROM ${assertTable(table)} t
   WHERE t.active = true
     AND t.id = ANY(${idsParam})
     AND ( t.access_level = 'public'
                OR ${catalogAuthorizationPredicate({
    alias: 't',
    userParam: '$1::uuid',
    produceTypeExpr: resourceTypeLiteral(type),
    atlasParam: '$2::uuid',
    grantTypeExpr: resourceTypeLiteral(type),
  })} )
`;

/**
 * The definitions of the catalog resources a snapshot's catalog layers refer to, filtered by
 * what the CALLER may see.
 *
 * A row the caller cannot see simply does not come back, and the rehydration then delivers the
 * reference with no definition — which is the state the client already renders as "camada
 * indisponível", with a Remove button, instead of a layer that silently disappears.
 *   $1 = userId (uuid|null), $2 = atlasId (uuid|null),
 *   $3 = analysis-layer ids (text[]), $4 = data-layer ids (text[])
 */
export const GET_VISIBLE_CATALOG_DEFINITIONS = `
${catalogDefinitionsOf('analysis_layers', 'analysis_layer', '$3::text[]')}
   UNION ALL
${catalogDefinitionsOf('data_layers', 'data_layer', '$4::text[]')}
`;

/**
 * The WRITE gate of a catalog layer: may this actor SEE the resource the layer refers to?
 *
 * `fn_can_see_resource` — the same composed predicate the rest of the house uses, never a second
 * copy of the rule — evaluated against the row's own `access_level`, read in the same statement
 * so there is no window between reading the level and judging it.
 *
 * NO ROW MEANS REFUSE, and that is deliberate: `canSeeResource` (resource-access.service.js)
 * already defines a resource that does not exist as one the caller cannot see, so that "absent"
 * and "forbidden" are never distinguishable. The alternative (allow, since a missing row has no
 * definition to leak) would make the gate answer a different question from every other gate in
 * the system, and a client whose layer was refused still has `delete`, which is not gated.
 *   $1 = userId (uuid|null), $2 = atlasId (uuid|null), $3 = resource type, $4 = resource id
 * @param {string} table - One of CATALOG_TABLES (whitelisted before interpolation).
 * @returns {string}
 */
export const canSeeCatalogResource = (table) => `
  SELECT fn_can_see_resource($1::uuid, $2::uuid, $3::text, $4::text, t.access_level) AS ok
    FROM ${assertTable(table)} t
   WHERE t.id = $4 AND t.active = true
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
