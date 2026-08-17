// Path: src/modules/streetview360/sv360.tiles.queries.js
import { sv360AccessPredicate } from './sv360.queries.js';
// Vector-tile (MVT) SQL for the StreetView 360 module (Fase 9, Tarefa 7).
// PostGIS generates the protobuf tile server-side (ST_AsMVT + ST_AsMVTGeom +
// ST_TileEnvelope). The frontend consumes this as a MapLibre VECTOR source — it
// replaces the legacy GeoJSON-as-source / PMTiles idea (descontinuados).
//
// A single tile carries TWO layers, concatenated (`layer_fotos || layer_linha`):
//   - 'fotos'       : POINTS — one per readable photo.
//   - 'fotos_linha' : LINES  — the per-project TRAJECTORY (the route a viewer
//     walks). DEFINITION CHOICE (documented): fotos_linha is the trajectory that
//     connects a project's photos in `sequence_number` order via ST_MakeLine,
//     grouped by project_id. Rationale: the "lines source" overlay on the map
//     draws the PATH/route through a project's panoramas (the original
//     `fotos_linha.geojson`), one clean LineString per project — not the directed
//     navigation graph (sv360.targets), which would emit overlapping bidirectional
//     segments and is already exposed per-photo via the `targets` adjacency in the
//     photo metadata shape. So the map line == the capture trajectory.
//
// ACCESS CONTROL (CRITICAL — embedded in the SQL, defense in depth; the 360 data
// has leaked twice in other routes when access lived only in the app layer): the
// SAME predicate as TILES_PHOTOS, e agora LITERALMENTE o mesmo — `sv360AccessPredicate`
// (sv360.queries.js) é uma definição só, importada aqui. Ele gateia AS DUAS
// camadas, porque a CTE `visible` alimenta pontos e linhas: um filtro aplicado só
// nos pontos deixaria a trajetória do projeto invisível desenhada no mapa, que é o
// negativo que `sv360-mvt.test.js` já cobrava.
//
// O primeiro termo deixou de ser um booleano do JS: `$isAdmin` valia TRUE e
// curto-circuitava a disjunção inteira, então um erro no cálculo não errava, ABRIA.
// Agora o SQL resolve o papel a partir do UUID. Tombstoned photos continuam
// excluídas via NOT EXISTS sv360.deleted_photos, e um chamador anônimo
// (userId=null, orgId=null) NUNCA vê projeto disabled nem privado.
//
// PERFORMANCE: the bbox is computed ONCE in 4326 (ST_Transform of the tile
// envelope) and used with the `&&` operator against p.geom so the GiST index on
// sv360.photos(geom) is used to prune rows BEFORE ST_AsMVTGeom transforms the
// survivors to 3857. Param order: $1=z, $2=x, $3=y, $4=userId, $5=orgId, $6=atlasId.
//
// ZOOM FLOOR for the 'fotos' layer only. Below this zoom the tile still carries
// 'fotos_linha' and simply omits the points.
//
// MEASURED on the live acervo (29 projects, 99.040 photos), tile over Alegrete,
// bytes on the wire from GET /sv360/tiles/:z/:x/:y.pbf:
//
//   z0  10.352.008 B (~420 ms)   z6  6.372.081 B     z10 1.144.264 B
//   z11    697.171 B (~195 ms)   z12   253.568 B     z14    23.770 B
//
// Of the 10,3 MB at z0, 10.350.579 B are the 'fotos' layer (99.035 points) and
// 1.429 B are 'fotos_linha' (68 lines). The whole low-zoom cost IS the points
// layer, so gating the points is the entire fix: the same z0 tile drops to 1.429
// bytes and ~122 ms, and every tile at z >= 11 is byte-identical to before.
//
// WHY 11, and why NOT a 400 like the origin (ebgeo_360 refuses z outside 11..12):
// a 400 rejects the WHOLE tile, and this frontend asks for the same tile at low
// zoom for the LINES. The main map (map_sig.js, map2d.minZoom = 1) mounts
// 'street-view-lines' and 'street-view-lines-hit' over the trajectory layer with
// NO layer minzoom, so it legitimately requests z1..z10 tiles; rejecting them
// would erase the trajectory from the main map. The points layer has exactly ONE
// consumer, the minimap (add_street_view_control.js), and that map is built with
// minZoom: 11, so 11 is the lowest zoom at which anything ever draws a point.
// A floor of 12 would blank the minimap at its own minimum zoom.
export const FOTOS_MIN_ZOOM = 11;

// Returns a single row with one `tile` column (bytea = the concatenated MVT). An
// empty tile (no features) is still a valid, returnable buffer.
export const MVT_TILE = `
  WITH bounds AS (
    SELECT
      ST_TileEnvelope($1, $2, $3) AS env3857,
      ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS env4326
  ),
  visible AS (
    SELECT p.id, p.project_id, p.geom, p.original_name, p.sequence_number,
           p.floor_level, p.floor_label,
           pr.slug AS project_slug
    FROM sv360.photos p
    JOIN sv360.projects pr ON pr.id = p.project_id
    WHERE ${sv360AccessPredicate(4, 5, 6, 'pr.')}
      AND p.geom IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id
      )
  ),
  fotos AS (
    SELECT ST_AsMVT(t, 'fotos', 4096, 'geom') AS mvt
    FROM (
      SELECT
        ST_AsMVTGeom(ST_Transform(v.geom, 3857), b.env3857, 4096, 64, true) AS geom,
        v.id,
        v.project_slug AS "projectSlug",
        v.original_name AS img,
        v.sequence_number,
        -- The photo's FLOOR. Both are ADDITIVE: id, projectSlug, img and
        -- sequence_number above are what the current client reads, and renaming
        -- or dropping any of them breaks the 2D layer. (No backticks in here:
        -- this SQL is a JS template literal.)
        --
        -- floor_level is NOT NULL in sv360.photos, so every point carries it and a
        -- MapLibre filter on the floor selector is always decidable. floor_label
        -- IS nullable (a flat project has no floor to name), and ST_AsMVT simply
        -- OMITS a null attribute from that feature: the client must treat an
        -- absent floor_label as null, never as an error.
        v.floor_level,
        v.floor_label
      FROM visible v, bounds b
      -- The floor comes FIRST so the predicate is decided before any row is
      -- transformed: at z < FOTOS_MIN_ZOOM the inner select yields nothing,
      -- ST_AsMVT returns NULL and the COALESCE below leaves only the line layer.
      WHERE $1 >= ${FOTOS_MIN_ZOOM} AND v.geom && b.env4326
    ) t
  ),
  -- The project's REAL capture segments (sv360.tracks), one row per run. Only for
  -- projects the "visible" CTE already admitted, so the access filter still lives
  -- in one place. (No backticks in here: this SQL is a JS template literal.)
  tracked AS (
    SELECT tk.project_id, tk.geom AS line
    FROM sv360.tracks tk
    WHERE tk.project_id IN (SELECT DISTINCT v.project_id FROM visible v)
  ),
  trajectories AS (
    -- Prefer the imported tracks; synthesize only for a project that has none.
    --
    -- The synthesized form is ONE LineString per project joining its photos in
    -- sequence order, and it is a poor stand-in whenever a project was captured in
    -- more than one run: the line teleports between runs and the map draws a
    -- criss-cross that matches no path anyone walked (1pef: 34 real segments
    -- collapsed into 1). It stays as the fallback because it is what every project
    -- ingested before sv360.tracks existed still has, and a project with a single
    -- run renders identically either way. A project with one photo yields no line
    -- (ST_MakeLine of 1 point is degenerate — filtered by ST_NumPoints >= 2).
    SELECT t.project_id, v.project_slug, t.line
    FROM tracked t
    JOIN (SELECT DISTINCT project_id, project_slug FROM visible) v
      ON v.project_id = t.project_id
    UNION ALL
    SELECT v.project_id, v.project_slug,
           ST_MakeLine(v.geom ORDER BY v.sequence_number) AS line
    FROM visible v
    WHERE NOT EXISTS (SELECT 1 FROM tracked t WHERE t.project_id = v.project_id)
    GROUP BY v.project_id, v.project_slug
  ),
  linha AS (
    SELECT ST_AsMVT(t, 'fotos_linha', 4096, 'geom') AS mvt
    FROM (
      SELECT
        ST_AsMVTGeom(ST_Transform(tr.line, 3857), b.env3857, 4096, 64, true) AS geom,
        tr.project_slug AS "projectSlug"
      FROM trajectories tr, bounds b
      WHERE ST_NumPoints(tr.line) >= 2
        AND tr.line && b.env4326
    ) t
    WHERE t.geom IS NOT NULL
  )
  SELECT COALESCE(fotos.mvt, ''::bytea) || COALESCE(linha.mvt, ''::bytea) AS tile
  FROM fotos, linha
`;
