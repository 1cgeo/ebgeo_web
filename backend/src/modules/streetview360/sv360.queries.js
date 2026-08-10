// Path: src/modules/streetview360/sv360.queries.js
// Named SQL constants for the read-only StreetView 360 module (Fase 9, stage 1).
// Metadata lives in Postgres (schema `sv360`); only the WebP BLOBs stay in the
// per-project {slug}.db SQLite. Geometry is `sv360.photos.geom` (POINT/4326);
// lon/lat are exposed via ST_X(geom)/ST_Y(geom) so callers never read the column
// directly. Tombstoned photos (sv360.deleted_photos) are excluded everywhere.

// List projects. `enabled` is always public; disabled projects are visible only
// to a global admin or to a member of the owning organization.
//   $1 = isAdmin (boolean), $2 = userOrgId (uuid, nullable)
export const LIST_PROJECTS = `
  SELECT id, slug, name, center_lat, center_long, entry_photo_id, photo_count, status,
         capture_date
  FROM sv360.projects
  WHERE ($1::boolean OR status = 'enabled' OR organization_id = $2::uuid)
  ORDER BY name
`;

// Single project by slug, with the ACCESS FILTER EMBEDDED (a slug is UNIQUE only
// per organization, so a cross-org collision must be resolved here, not with a
// non-deterministic rows[0]). Anon ($2 false, $3 null) matches only enabled; a
// member/admin also matches their own/any org. ORDER prefers the caller's OWN org,
// then enabled, for a deterministic single row (no cross-org thumbnail/data leak).
//   $1 = slug, $2 = isAdmin (boolean), $3 = userOrgId (uuid, nullable)
export const GET_PROJECT_BY_SLUG = `
  SELECT id, organization_id, slug, name, center_lat, center_long,
         entry_photo_id, photo_count, db_filename, status, capture_date
  FROM sv360.projects
  WHERE slug = $1
    AND ($2::boolean OR status = 'enabled' OR organization_id = $3::uuid)
  ORDER BY (organization_id = $3::uuid) DESC, (status = 'enabled') DESC, organization_id
  LIMIT 1
`;

// One photo by id, joined to its project (slug/db_filename/org/status for the
// readability + ETag + BLOB path). lon/lat are derived from geom; ele is kept as
// the stored column. Excludes tombstoned photos.
//   $1 = photo id (TEXT uuid v5)
export const GET_PHOTO_BY_ID = `
  SELECT p.id, p.project_id, p.original_name, p.display_name, p.sequence_number,
         ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon, p.ele,
         p.heading, p.camera_height,
         p.mesh_rotation_x, p.mesh_rotation_y, p.mesh_rotation_z,
         p.distance_scale, p.marker_scale, p.floor_level,
         p.full_size_bytes, p.preview_size_bytes,
         p.calibration_reviewed, p.capture_date,
         pr.slug AS project_slug, pr.db_filename, pr.organization_id,
         pr.status AS project_status
  FROM sv360.photos p
  JOIN sv360.projects pr ON pr.id = p.project_id
  WHERE p.id = $1
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
`;

// One photo by its original filename. A name may collide across projects, so an
// Tie-break for a name shared by several projects (L10). The CALLER'S OWN ORG
// wins first, then an enabled project. Ordering by status alone made the pick
// arbitrary among disabled projects: a member whose org genuinely holds the photo
// could receive another org's row and then be 404'd by the readability gate — a
// false negative on data they own. Excludes tombstoned photos.
//   $1 = original_name
//   $2 = caller's organization_id (nullable; anonymous simply loses the preference)
export const GET_PHOTO_BY_NAME = `
  SELECT p.id, p.project_id, p.original_name, p.display_name, p.sequence_number,
         ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon, p.ele,
         p.heading, p.camera_height,
         p.mesh_rotation_x, p.mesh_rotation_y, p.mesh_rotation_z,
         p.distance_scale, p.marker_scale, p.floor_level,
         p.full_size_bytes, p.preview_size_bytes,
         p.calibration_reviewed, p.capture_date,
         pr.slug AS project_slug, pr.db_filename, pr.organization_id,
         pr.status AS project_status
  FROM sv360.photos p
  JOIN sv360.projects pr ON pr.id = p.project_id
  WHERE p.original_name = $1
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
  ORDER BY (pr.organization_id = $2) DESC, (pr.status = 'enabled') DESC
  LIMIT 1
`;

// O(1) ETag source: sizes + project context, no BLOB read. Excludes tombstoned
// photos so a soft-deleted photo's blob is never served (same rule as
// GET_PHOTO_BY_ID / GET_PHOTO_BY_NAME).
//   $1 = photo id (TEXT uuid v5)
export const GET_PHOTO_SIZES = `
  SELECT p.full_size_bytes, p.preview_size_bytes,
         pr.db_filename, pr.organization_id, pr.status AS project_status
  FROM sv360.photos p
  JOIN sv360.projects pr ON pr.id = p.project_id
  WHERE p.id = $1
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
`;

// Directed adjacency for a photo (visible links only), joined to the target
// photo for its name/display_name/lon/lat/ele. Internal columns bearing_deg /
// distance_m are mapped to bearing / distance in the JSON contract by the
// service. Excludes links pointing at tombstoned photos. `is_next` first, then
// nearest.
//   $1 = source photo id (TEXT uuid v5)
export const GET_TARGETS_FOR_PHOTO = `
  SELECT t.target_id, t.distance_m, t.bearing_deg, t.is_next, t.is_original,
         t.override_bearing, t.override_distance, t.override_height,
         tp.original_name AS target_name, tp.display_name AS target_display_name,
         ST_X(tp.geom) AS target_lon, ST_Y(tp.geom) AS target_lat, tp.ele AS target_ele
  FROM sv360.targets t
  JOIN sv360.photos tp ON tp.id = t.target_id
  WHERE t.source_id = $1
    AND t.hidden = false
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = t.target_id)
  ORDER BY t.is_next DESC, t.distance_m ASC
`;

// Nearby photos within a radius (true meters via ::geography). Excludes
// tombstoned photos. lon/lat exposed from geom; distance returned in meters.
//   $1 = lon, $2 = lat, $3 = radiusMeters, $4 = limit
export const NEARBY_PHOTOS = `
  SELECT p.id, p.project_id, p.original_name, p.display_name, p.sequence_number,
         ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat, p.ele,
         ST_Distance(
           p.geom::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
         ) AS distance_m,
         pr.slug AS project_slug, pr.organization_id, pr.status AS project_status
  FROM sv360.photos p
  JOIN sv360.projects pr ON pr.id = p.project_id
  WHERE ST_DWithin(
          p.geom::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $3
        )
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
  ORDER BY distance_m ASC
  LIMIT $4
`;

// Tiles feed: readable photos as GeoJSON-ready rows (lon/lat from geom).
// Read access is EMBEDDED IN THE SQL (defense in depth, like the gazetteer BUSCA):
// an `enabled` project is public; a `disabled` project is visible only to a global
// admin ($1) or to a member of the owning organization ($2). Tombstoned photos are
// excluded. The controller wraps each row into a GeoJSON Feature.
//
// BOUNDED (achado 65): an OPTIONAL bbox ($3..$6, all-or-nothing — the schema parses
// and range-checks it) plus a MANDATORY LIMIT ($7, capped by
// TILES_GEOJSON_MAX_FEATURES). Without them one anonymous request scanned and
// materialized the whole table, holding a pool connection for the duration. The `&&`
// operator is index-backed by idx_sv360_photos_geom (GiST).
//   $1 = isAdmin (boolean), $2 = userOrgId (uuid, nullable),
//   $3..$6 = minLon/minLat/maxLon/maxLat (double precision, nullable),
//   $7 = limit (int)
export const TILES_PHOTOS = `
  SELECT p.id, ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat, p.ele,
         p.original_name, p.display_name, p.sequence_number, p.heading,
         pr.slug AS project_slug
  FROM sv360.photos p
  JOIN sv360.projects pr ON pr.id = p.project_id
  WHERE ($1::boolean OR pr.status = 'enabled' OR pr.organization_id = $2::uuid)
    AND p.geom IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
    AND (
      $3::double precision IS NULL
      OR p.geom && ST_MakeEnvelope($3::double precision, $4::double precision,
                                   $5::double precision, $6::double precision, 4326)
    )
  ORDER BY pr.slug, p.sequence_number
  LIMIT $7::int
`;

// All photos of a project (ordered by sequence). lon/lat from geom; excludes
// tombstoned photos.
//   $1 = project id (uuid)
export const LIST_PHOTOS_BY_PROJECT = `
  SELECT p.id, p.original_name, p.display_name, p.sequence_number,
         ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat, p.ele,
         p.heading, p.camera_height, p.floor_level,
         p.full_size_bytes, p.preview_size_bytes, p.calibration_reviewed
  FROM sv360.photos p
  WHERE p.project_id = $1
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
  ORDER BY p.sequence_number ASC
`;
