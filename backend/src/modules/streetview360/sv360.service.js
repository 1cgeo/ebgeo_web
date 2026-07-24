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
 * @returns {Promise<Array>} project rows
 */
export async function listProjects(user) {
  const isAdmin = user?.role === 'admin';
  const { rows } = await query(Q.LIST_PROJECTS, [isAdmin, user?.organization_id ?? null]);
  return rows;
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
 * Strips server-internal fields from a project row before it leaves the API.
 *
 * The controller used to serialize the raw row, and the route is `flexibleAuth`, so an
 * anonymous caller reading any `enabled` project also received `db_filename` and
 * `organization_id`. Since `deriveDbFilename` builds `${orgId}__${slug}.db`, that pair
 * hands out the owning organization's internal UUID and the exact filename on disk
 * under SV360_DB_DIR — neither of which any client needs, and both of which describe
 * the server's storage layout.
 *
 * No contract test pinned this response shape, which is how the fields got out
 * unreviewed; `sv360-contract.test.js` mentions `db_filename` only in fixture INSERTs.
 * Admins keep the full row: the admin surface manages those files by name.
 */
const PROJECT_INTERNAL_FIELDS = ['db_filename', 'organization_id'];

function publicProjectView(project, user) {
  if (user?.role === 'admin') return project;
  const out = { ...project };
  for (const f of PROJECT_INTERNAL_FIELDS) delete out[f];
  return out;
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
 * Builds a GeoJSON FeatureCollection of every photo in a project READABLE by the
 * caller. The read-access rule (enabled = public; disabled = admin/owning-org) is
 * EMBEDDED IN THE SQL (defense in depth), so a hidden project's photos never leak
 * even with an app-layer bug. Tombstoned photos are excluded. Each Feature is a
 * Point [lon, lat] with the photo's identifying properties.
 * @param {Object} [user]
 * @returns {Promise<Object>} GeoJSON FeatureCollection
 */
export async function tilesFeatureCollection(user) {
  const isAdmin = user?.role === 'admin';
  const { rows } = await query(Q.TILES_PHOTOS, [isAdmin, user?.organization_id ?? null]);
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
 * @returns {Promise<string|null>} absolute path to the ORG-KEYED
 *   {orgId}__{slug}.webp on disk (the URL is slug-only; the file is not), or null
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
    previewThumbnail: `/thumbnails/${photo.project_slug}.webp`,
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
      distance: t.distance_m,
      bearing: t.bearing_deg,
      override_bearing: t.override_bearing,
      override_distance: t.override_distance,
      override_height: t.override_height,
    })),
  };
}
