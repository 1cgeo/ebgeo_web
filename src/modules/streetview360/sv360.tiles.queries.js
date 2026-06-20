// Path: src/modules/streetview360/sv360.tiles.queries.js
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
// SAME predicate as TILES_PHOTOS — ($isAdmin OR pr.status='enabled' OR
// pr.organization_id=$orgId) — gates BOTH layers; tombstoned photos are excluded
// via NOT EXISTS sv360.deleted_photos. An anon caller (isAdmin=false, orgId=null)
// NEVER sees a disabled project.
//
// PERFORMANCE: the bbox is computed ONCE in 4326 (ST_Transform of the tile
// envelope) and used with the `&&` operator against p.geom so the GiST index on
// sv360.photos(geom) is used to prune rows BEFORE ST_AsMVTGeom transforms the
// survivors to 3857. Param order: $1=z, $2=x, $3=y, $4=isAdmin, $5=orgId.
//
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
           pr.slug AS project_slug
    FROM sv360.photos p
    JOIN sv360.projects pr ON pr.id = p.project_id
    WHERE ($4::boolean OR pr.status = 'enabled' OR pr.organization_id = $5::uuid)
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
        v.sequence_number
      FROM visible v, bounds b
      WHERE v.geom && b.env4326
    ) t
  ),
  trajectories AS (
    -- One LineString per project, photos joined in sequence order. A project with
    -- a single photo yields no line (ST_MakeLine of 1 point is a degenerate
    -- geometry — filtered by ST_NumPoints >= 2).
    SELECT v.project_id, v.project_slug,
           ST_MakeLine(v.geom ORDER BY v.sequence_number) AS line
    FROM visible v
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
