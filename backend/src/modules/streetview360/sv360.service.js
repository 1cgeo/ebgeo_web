// Path: src/modules/streetview360/sv360.service.js
// Read-only business logic for the StreetView 360 module (Fase 9, stage 1).
// Metadata lives in Postgres (schema `sv360`); only the WebP BLOBs live in the
// per-project {slug}.db SQLite. This layer:
//   - enforces the read-access policy (enabled = public; disabled = owner/admin
//     only, returning 404 to avoid leaking existence on a hidden project);
//   - maps the DB columns to the FROZEN photoMetadataShape (flat camera fields;
//     targets expose `bearing`/`distance`, mapped from internal bearing_deg/
//     distance_m, with a constant `icon: 'next'`);
//   - builds the O(1) image descriptor (ETag from Postgres *_size_bytes, no BLOB
//     read) consumed by the controller for 304/Range serving.
// All writes/calibration/admin/ingestion are stage 2.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { query } from '../../database/index.js';
import * as Q from './sv360.queries.js';
import * as TQ from './sv360.tiles.queries.js';
import * as blobstore from './sv360.blobstore.js';
import { TILES_GEOJSON_MAX_FEATURES } from './sv360.schemas.js';
import config from '../../config.js';
import { NotFoundError } from '../../utils/errors.js';

const DEFAULT_NEARBY_RADIUS_M = 500;
const NEARBY_LIMIT = 100;

/**
 * Read-access predicate for a project. `enabled` projects are PUBLIC (anon-
 * visible). A `disabled` project is visible only to a global admin or to a
 * member of the owning organization.
 * @param {Object} project - row with { status, organization_id }
 * @param {Object} [user]  - req.user ({ role, organization_id }) or undefined
 * @returns {boolean}
 */
export function isProjectReadable(project, user) {
  if (project.status === 'enabled') return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Boolean(user.organization_id) && user.organization_id === project.organization_id;
}

/**
 * Throws NotFoundError (NOT Forbidden) when a project is not readable, so a
 * hidden project is indistinguishable from a nonexistent one.
 * @param {Object} project
 * @param {Object} [user]
 * @param {string} [resource='Project']
 */
function enforceProjectReadable(project, user, resource = 'Project') {
  if (!isProjectReadable(project, user)) throw new NotFoundError(resource);
}

/**
 * Lists visible projects for the caller. `enabled` is always public; the SQL
 * already filters disabled projects to admin / owning-org.
 * @param {Object} [user]
 * @returns {Promise<Array>} projects in the frozen public shape
 */
export async function listProjects(user) {
  const isAdmin = user?.role === 'admin';
  const { rows } = await query(Q.LIST_PROJECTS, [isAdmin, user?.organization_id ?? null]);
  return rows.map((r) => publicProjectView(r, user));
}

/**
 * Gets a single project by slug, enforcing the read policy.
 * @param {string} slug
 * @param {Object} [user]
 * @returns {Promise<Object>} project row
 * @throws {NotFoundError} if missing or hidden from the caller
 */
export async function getProject(slug, user) {
  const isAdmin = user?.role === 'admin';
  const { rows } = await query(Q.GET_PROJECT_BY_SLUG, [slug, isAdmin, user?.organization_id ?? null]);
  const project = rows[0];
  if (!project) throw new NotFoundError('Project');
  enforceProjectReadable(project, user); // belt-and-suspenders (SQL already filtered)
  return publicProjectView(project, user);
}

/**
 * Converts a stored `project_floors.plan_coords` (JSONB: an array of LineStrings,
 * `[[[lon,lat],...],...]`) into the GeoJSON FeatureCollection the client draws,
 * or null when the level has no plan.
 *
 * WHY A FEATURECOLLECTION AND NOT THE RAW ARRAY: the plan is drawn as a MapLibre
 * GeoJSON source, and every feature carries `properties.level` so a single source
 * holding several floors can be filtered by the selector without re-fetching. The
 * storage shape stays the compact array (migration 012) because that is what the
 * origin exports; the API shape is the one the map consumes.
 *
 * A level that EXISTS but has no plan drawn (the Beira-Rio's level 0, outdoors)
 * yields null, never an empty FeatureCollection: null says "there is nothing to
 * draw here", while an empty collection reads as "the plan failed to load".
 * @param {*} planCoords - the JSONB value (array of LineStrings) or null
 * @param {number} level - the floor level, stamped on every feature
 * @returns {Object|null} GeoJSON FeatureCollection of LineString, or null
 */
function floorPlanToGeoJson(planCoords, level) {
  if (!Array.isArray(planCoords)) return null;
  const features = planCoords
    .filter((line) => Array.isArray(line) && line.length >= 2)
    .map((line) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: line },
      properties: { level },
    }));
  if (features.length === 0) return null;
  return { type: 'FeatureCollection', features };
}

/**
 * Lists the floors of a project, in ascending `level` order.
 *
 * Access is the SAME rule as every other project read: the project is resolved by
 * GET_PROJECT_BY_SLUG (filter embedded in the SQL) and then re-checked by
 * enforceProjectReadable, so a hidden project answers 404 exactly like
 * `getProject` does, with no separate, looser path to the same data.
 *
 * A project with NO floors answers `[]`, never 404: "this project has no floor
 * selector" is a legitimate, successful answer for the 27 flat projects of the
 * corpus, and 404 would make the client unable to tell an unknown slug from a
 * street-level survey.
 * @param {string} slug
 * @param {Object} [user]
 * @returns {Promise<Array<{level:number, label:string, photoCount:number, plan:Object|null}>>}
 * @throws {NotFoundError} if the project is missing or hidden from the caller
 */
export async function listProjectFloors(slug, user) {
  const isAdmin = user?.role === 'admin';
  const { rows: projectRows } = await query(Q.GET_PROJECT_BY_SLUG, [
    slug,
    isAdmin,
    user?.organization_id ?? null,
  ]);
  const project = projectRows[0];
  if (!project) throw new NotFoundError('Project');
  enforceProjectReadable(project, user); // belt-and-suspenders (SQL already filtered)

  const { rows } = await query(Q.LIST_PROJECT_FLOORS, [project.id]);
  return rows.map((r) => ({
    level: r.level,
    label: r.label,
    photoCount: r.photo_count,
    plan: floorPlanToGeoJson(r.plan_coords, r.level),
  }));
}

/**
 * Path segment of the static thumbnails, RELATIVE to the API base — the client
 * concatenates it with `streetView360.serviceUrl` (which already ends in the
 * module mount), so it must NOT carry the `/api/v1` prefix. Same rule as the
 * photo metadata's `previewThumbnail`.
 */
const THUMBNAILS_SEGMENT = '/thumbnails';

/**
 * Maps a `sv360.projects` row to the FROZEN public project shape.
 *
 * This shape is NOT this module's invention: it is the contract of the legacy
 * service the frontend was written against (`ebgeo_360/src/routes/projects.js`
 * `formatProject`) — camelCase, with the coordinates NESTED under `center`. The
 * row's own column names are snake_case and flat, and returning the row verbatim
 * broke all three consumers at once, silently and only once real data existed:
 * `streetview_markers.js` (TypeError on `p.center.lon`, so the 2D 360 layer never
 * renders), `search-bar.search-providers.js` (360 results lose coordinates) and
 * `atlas-settings.modal.js` (no 360 thumbnails in the catalog). The seed/test
 * fixtures never caught it because no test pinned anything beyond `slug`/`name`.
 *
 * Reshaping (rather than deleting fields from the row) also subsumes the older
 * leak fix: the route is `flexibleAuth`, and the raw row handed anonymous callers
 * `db_filename` + `organization_id` — which together spell out `${orgId}__{slug}.db`,
 * i.e. the owning org's internal UUID and the exact path under SV360_DB_DIR. An
 * allowlist cannot leak a column it does not name.
 *
 * Admin extras are ADDITIVE on top of the same shape, never a different shape: an
 * admin is also an ordinary user of the 2D map, and returning the raw row to them
 * meant the 360 layer broke for admins ONLY — the worst kind of role-dependent bug.
 *
 * `captureDate` IS a real column now: `sv360.projects.capture_date` (TEXT,
 * migration 014), carrying the legacy campaign date the ETL used to drop. It
 * reaches this view only when the query SELECTS it, and it is read here by its
 * real name, never synthesized. A row from a query that did not select the
 * column yields undefined, which `?? null` normalizes to the same null the
 * frozen shape has always promised, so no consumer sees a missing key.
 *
 * `description` / `location` still have no column in `sv360.projects` (the
 * legacy SQLite carried them, this schema never adopted them); they remain
 * emitted as null. That is a KNOWN GAP, not a shape decision: only the date was
 * authorized for this pass.
 * @param {Object} project - a sv360.projects row
 * @param {Object} [user]
 * @returns {Object} the public project view
 */
function publicProjectView(project, user) {
  const view = {
    id: project.id,
    slug: project.slug,
    name: project.name,
    description: project.description ?? null, // no column: always null
    // Real column since migration 014, SELECTed by both LIST_PROJECTS and
    // GET_PROJECT_BY_SLUG. A query that omits it yields undefined, which `?? null`
    // normalizes to the null the frozen shape has always promised.
    captureDate: project.capture_date ?? null,
    location: project.location ?? null, // no column: always null
    center: { lat: project.center_lat, lon: project.center_long },
    entryPhotoId: project.entry_photo_id ?? null,
    previewThumbnail: `${THUMBNAILS_SEGMENT}/${project.slug}.webp`,
    photoCount: project.photo_count,
    status: project.status,
  };
  if (user?.role === 'admin') {
    // The admin surface manages the on-disk stores by name. Undefined when the
    // query did not select them (LIST_PROJECTS does not), and JSON drops those.
    view.db_filename = project.db_filename;
    view.organization_id = project.organization_id;
  }
  return view;
}

/**
 * Gets a photo by id and returns the FROZEN photoMetadataShape (camera + targets).
 * @param {string} uuid - photo id (TEXT uuid v5)
 * @param {Object} [user]
 * @returns {Promise<Object>} frozen photo metadata
 * @throws {NotFoundError} if missing/tombstoned or its project is hidden
 */
export async function getPhoto(uuid, user) {
  const { rows } = await query(Q.GET_PHOTO_BY_ID, [uuid]);
  const photo = rows[0];
  if (!photo) throw new NotFoundError('Photo');
  enforceProjectReadable(photoProject(photo), user, 'Photo');

  const { rows: targets } = await query(Q.GET_TARGETS_FOR_PHOTO, [photo.id]);
  return buildPhotoMetadata(photo, targets);
}

/**
 * Gets a photo by its original filename and returns the FROZEN photoMetadataShape.
 * A name may collide across projects; an enabled project wins the tie (in SQL).
 * @param {string} nome - original_name
 * @param {Object} [user]
 * @returns {Promise<Object>} frozen photo metadata
 * @throws {NotFoundError} if missing/tombstoned or its project is hidden
 */
export async function photoByName(nome, user) {
  const { rows } = await query(Q.GET_PHOTO_BY_NAME, [nome, user?.organization_id ?? null]);
  const photo = rows[0];
  if (!photo) throw new NotFoundError('Photo');
  enforceProjectReadable(photoProject(photo), user, 'Photo');

  const { rows: targets } = await query(Q.GET_TARGETS_FOR_PHOTO, [photo.id]);
  return buildPhotoMetadata(photo, targets);
}

/**
 * Builds the O(1) image descriptor for the controller: ETag from Postgres
 * *_size_bytes (NO BLOB read), plus the resolved {slug}.db path. The 304/Range/
 * semaphore handling and the actual BLOB fetch live in the controller.
 * @param {string} uuid - photo id (TEXT uuid v5)
 * @param {'full'|'preview'} quality
 * @param {Object} [user]
 * @returns {Promise<{dbFile:string, sizeBytes:number, etag:string, photoId:string, contentType:string}>}
 * @throws {NotFoundError} if missing/tombstoned or its project is hidden
 */
export async function getPhotoImageMeta(uuid, quality, user) {
  const { rows } = await query(Q.GET_PHOTO_SIZES, [uuid]);
  const row = rows[0];
  if (!row) throw new NotFoundError('Photo');
  enforceProjectReadable(
    { status: row.project_status, organization_id: row.organization_id },
    user,
    'Photo'
  );

  const sizeBytes = Number(
    quality === 'preview' ? row.preview_size_bytes : row.full_size_bytes
  );
  return {
    dbFile: blobstore.resolveDbPath(row.db_filename),
    sizeBytes,
    etag: `"${uuid}-${quality}-${sizeBytes}"`,
    photoId: uuid,
    contentType: 'image/webp',
    // Drives the cache scope in the controller: a `disabled` project's image is
    // access-controlled and must never land in a shared cache (P6).
    projectStatus: row.project_status,
  };
}

/**
 * Photos within `radius` meters of a point (true meters via ::geography),
 * filtered to projects readable by the caller. Defaults: radius 500 m, top 100.
 * @param {number} lon
 * @param {number} lat
 * @param {number} [radius] - meters (default 500)
 * @param {Object} [user]
 * @returns {Promise<Array>} nearby photo rows (with distance in meters)
 */
export async function nearby(lon, lat, radius, user) {
  const radiusMeters = Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_NEARBY_RADIUS_M;
  const { rows } = await query(Q.NEARBY_PHOTOS, [lon, lat, radiusMeters, NEARBY_LIMIT]);
  return rows
    .filter((r) =>
      isProjectReadable({ status: r.project_status, organization_id: r.organization_id }, user)
    )
    .map((r) => ({
      id: r.id,
      img: r.original_name,
      display_name: r.display_name,
      lon: r.lon,
      lat: r.lat,
      ele: r.ele,
      projectSlug: r.project_slug,
      sequence_number: r.sequence_number,
      distance: r.distance_m,
    }));
}

/**
 * Builds a GeoJSON FeatureCollection of the photos READABLE by the caller. The
 * read-access rule (enabled = public; disabled = admin/owning-org) is EMBEDDED IN
 * THE SQL (defense in depth), so a hidden project's photos never leak even with an
 * app-layer bug. Tombstoned photos are excluded. Each Feature is a Point [lon, lat]
 * with the photo's identifying properties.
 *
 * ALWAYS BOUNDED (achado 65): `limit` is capped by the route schema
 * (TILES_GEOJSON_MAX_FEATURES) and an optional `bbox` scopes the scan spatially.
 * This endpoint is legacy — the live contract is the bbox-native MVT route — so a
 * caller wanting everything must page by moving the bbox.
 * @param {Object} [user]
 * @param {Object} [opts]
 * @param {number[]} [opts.bbox] - [minLon, minLat, maxLon, maxLat] (already validated)
 * @param {number} [opts.limit] - row ceiling (already capped by the schema)
 * @returns {Promise<Object>} GeoJSON FeatureCollection
 */
export async function tilesFeatureCollection(user, { bbox, limit } = {}) {
  const isAdmin = user?.role === 'admin';
  const box = Array.isArray(bbox) && bbox.length === 4 ? bbox : [null, null, null, null];
  const cap = Number.isInteger(limit) && limit > 0 ? limit : TILES_GEOJSON_MAX_FEATURES;
  const { rows } = await query(Q.TILES_PHOTOS, [
    isAdmin,
    user?.organization_id ?? null,
    ...box,
    cap,
  ]);
  return {
    type: 'FeatureCollection',
    features: rows.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
      properties: {
        id: r.id,
        projectSlug: r.project_slug,
        img: r.original_name,
        display_name: r.display_name,
        sequence_number: r.sequence_number,
        heading: r.heading,
        ele: r.ele,
      },
    })),
  };
}

/**
 * Renders a single Mapbox Vector Tile (MVT) for the StreetView 360 layers at
 * z/x/y, READABLE by the caller. The tile carries two layers ('fotos' points +
 * 'fotos_linha' per-project trajectory lines). The read-access rule (enabled =
 * public; disabled = admin/owning-org) is EMBEDDED IN THE SQL (defense in depth),
 * so a hidden project never leaks even with an app-layer bug; tombstoned photos
 * are excluded. An empty tile (no features in the bbox) returns an empty Buffer —
 * a valid MVT response (the controller answers 200).
 * @param {number} z - tile zoom
 * @param {number} x - tile column
 * @param {number} y - tile row
 * @param {Object} [user] - req.user ({ role, organization_id }) or undefined
 * @returns {Promise<Buffer>} the MVT protobuf (possibly empty)
 */
export async function mvtTile(z, x, y, user) {
  const isAdmin = user?.role === 'admin';
  const { rows } = await query(TQ.MVT_TILE, [z, x, y, isAdmin, user?.organization_id ?? null]);
  const tile = rows[0]?.tile;
  // pg returns bytea as a Node Buffer; normalize null/undefined to an empty tile.
  return Buffer.isBuffer(tile) ? tile : Buffer.alloc(0);
}

/**
 * Resolves the absolute FS path of a project's thumbnail, enforcing
 * the project read policy. The slug is sanitized with path.basename (traversal
 * guard) AND the readability check runs against the matching project row; a hidden
 * (disabled) project is 404 for anon. Returns null when the project does not exist
 * OR the thumbnail file is absent (the controller maps null → 404).
 * @param {string} slug - project slug (from the :slug.webp route param)
 * @param {Object} [user]
 * @returns {Promise<{filePath: string, projectStatus: string}|null>} `filePath` is the
 *   absolute path to the ORG-KEYED {orgId}__{slug}.webp on disk (the URL is slug-only; the
 *   file is not), and `projectStatus` is what the caller uses to decide the CACHE SCOPE
 *   (`enabled` may be publicly cached; anything else must not be). Null when the project
 *   does not exist or the thumbnail file is absent.
 *
 *   Este `@returns` declarou `Promise<string|null>` até 2026-07-25, omitindo justamente o
 *   campo que decide escopo de cache: quem programasse contra o JSDoc trataria o retorno
 *   como caminho e publicaria um thumbnail de projeto desabilitado.
 */
export async function resolveThumbnailPath(slug, user) {
  // basename strips any directory component (../, absolute) before it ever hits
  // the DB lookup or the filesystem — defense in depth on top of the route param.
  const safeSlug = path.basename(String(slug));
  const isAdmin = user?.role === 'admin';
  const { rows } = await query(Q.GET_PROJECT_BY_SLUG, [
    safeSlug,
    isAdmin,
    user?.organization_id ?? null,
  ]);
  const project = rows[0];
  // Project missing OR hidden from the caller → indistinguishable 404 (no leak).
  if (!project || !isProjectReadable(project, user)) return null;

  // The thumbnail is ORG-KEYED (parallel to {orgId}__{slug}.db), so two orgs that
  // share a slug never collide on disk nor leak across tenants. Derive it from the
  // resolved project's stored db_filename (already server-derived at ingestion).
  const thumbFile = String(project.db_filename).replace(/\.db$/i, '.webp');
  const filePath = path.resolve(config.sv360.dbDir, path.basename(thumbFile));
  if (!existsSync(filePath)) return null;

  // `status` travels with the path so the controller can decide the cache scope:
  // only an `enabled` (public) project may be cached by a SHARED cache. See P6.
  return { filePath, projectStatus: project.status };
}

// --- internal -------------------------------------------------------------

// Extracts the project-readability shape from a joined photo row.
function photoProject(photo) {
  return { status: photo.project_status, organization_id: photo.organization_id };
}

/**
 * Maps a joined photo row + its target rows to the FROZEN photoMetadataShape.
 * Camera fields are FLAT (never nested). Targets expose `bearing`/`distance`
 * (from internal bearing_deg/distance_m), `icon` is the constant string 'next',
 * and `next` mirrors the is_next column. Internal column names (bearing_deg /
 * distance_m) are NEVER emitted.
 * @param {Object} photo - row from GET_PHOTO_BY_ID / GET_PHOTO_BY_NAME
 * @param {Array}  targets - rows from GET_TARGETS_FOR_PHOTO
 * @returns {Object} frozen photoMetadataShape (bare object, not wrapped in {data})
 */
export function buildPhotoMetadata(photo, targets) {
  return {
    camera: {
      id: photo.id,
      img: photo.original_name,
      display_name: photo.display_name,
      lon: photo.lon,
      lat: photo.lat,
      ele: photo.ele,
      heading: photo.heading,
      height: photo.camera_height,
      mesh_rotation_y: photo.mesh_rotation_y,
      mesh_rotation_x: photo.mesh_rotation_x,
      mesh_rotation_z: photo.mesh_rotation_z,
      distance_scale: photo.distance_scale,
      marker_scale: photo.marker_scale,
      floor_level: photo.floor_level,
      // The NAME this photo's floor carries on screen. Nullable by construction:
      // a flat project has no floor to name (`?? null` normalizes the undefined a
      // query that did not SELECT the column yields, so the key is never missing).
      floor_label: photo.floor_label ?? null,
      calibration_reviewed: photo.calibration_reviewed,
    },
    projectSlug: photo.project_slug,
    captureDate: photo.capture_date,
    // FROZEN contract (99-referencia §6.1/§6.2 ponto 2): RELATIVE path WITHOUT the
    // /api/v1 prefix. The client concatenates it with streetView360.serviceUrl
    // (= <backend>/api/v1/sv360), yielding /api/v1/sv360/thumbnails/{slug}.webp.
    // The URL is slug-only, but the FILE on disk is org-keyed
    // ({orgId}__{slug}.webp, derived from db_filename at ingestion); the route
    // GET /sv360/thumbnails/:slug.webp resolves one to the other.
    previewThumbnail: `${THUMBNAILS_SEGMENT}/${photo.project_slug}.webp`,
    targets: targets.map((t) => ({
      id: t.target_id,
      img: t.target_name,
      lon: t.target_lon,
      lat: t.target_lat,
      ele: t.target_ele,
      display_name: t.target_display_name,
      icon: 'next',
      next: t.is_next,
      is_original: t.is_original,
      // The TARGET's floor, and the reason the floor-change marker exists at all:
      // the client compares this level with the current photo's and draws the
      // staircase instead of the arrow when they differ. Without the field it
      // falls back to `return 0` and the marker never draws, with nothing on
      // screen saying so. `?? null` keeps the key present when the query did not
      // bring the column.
      floor_level: t.target_floor_level ?? null,
      floor_label: t.target_floor_label ?? null,
      distance: t.distance_m,
      bearing: t.bearing_deg,
      override_bearing: t.override_bearing,
      override_distance: t.override_distance,
      override_height: t.override_height,
    })),
  };
}
