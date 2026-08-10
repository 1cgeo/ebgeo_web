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
 * Resolves a project by slug for a READ, applying the module's single access
 * rule, and returns the row.
 *
 * Extracted because every stage-2b calibration read starts the same way and the
 * pattern is load-bearing: the SQL already filters, and enforceProjectReadable
 * re-checks, so a hidden project answers 404 exactly like `getProject` does. A
 * second, looser way in is how a hidden project leaks.
 * @param {string} slug
 * @param {Object} [user]
 * @returns {Promise<Object>} the sv360.projects row (NOT the public view)
 * @throws {NotFoundError} if missing or hidden from the caller
 */
async function resolveReadableProject(slug, user) {
  const isAdmin = user?.role === 'admin';
  const { rows } = await query(Q.GET_PROJECT_BY_SLUG, [slug, isAdmin, user?.organization_id ?? null]);
  const project = rows[0];
  if (!project) throw new NotFoundError('Project');
  enforceProjectReadable(project, user); // belt-and-suspenders (SQL already filtered)
  return project;
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
  const project = await resolveReadableProject(slug, user);

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
 *
 * `includeHidden` adds the links an operator has hidden, each carrying `hidden:
 * true|false`. It is OPT-IN and defaults to off, so the viewer keeps receiving
 * exactly the array it always did. The calibration workspace needs it because
 * hiding a link is REVERSIBLE and an operator cannot un-hide what the API refuses
 * to show: without this flag a mistaken hide is permanent through the API.
 * @param {string} uuid - photo id (TEXT uuid v5)
 * @param {Object} [user]
 * @param {Object} [opts]
 * @param {boolean} [opts.includeHidden=false] - also return hidden links
 * @returns {Promise<Object>} frozen photo metadata
 * @throws {NotFoundError} if missing/tombstoned or its project is hidden
 */
export async function getPhoto(uuid, user, { includeHidden = false } = {}) {
  const { rows } = await query(Q.GET_PHOTO_BY_ID, [uuid]);
  const photo = rows[0];
  if (!photo) throw new NotFoundError('Photo');
  enforceProjectReadable(photoProject(photo), user, 'Photo');

  const { rows: targets } = await query(
    includeHidden ? Q.GET_ALL_TARGETS_FOR_PHOTO : Q.GET_TARGETS_FOR_PHOTO,
    [photo.id]
  );
  return buildPhotoMetadata(photo, targets, { includeHidden });
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
      // ADDITIVE (stage 2b): the floor this photo stands on. `distance` is the
      // distance IN PLAN and it MISLEADS indoors — the photo directly overhead
      // shows up at 0.7 m. The level is what tells the caller which of the stacked
      // photos it just got. Null-safe: a flat project has no label to give.
      floor_level: r.floor_level,
      floor_label: r.floor_label ?? null,
    }));
}

// --- calibration reads (stage 2b) ------------------------------------------

/**
 * Search radii of GET /photos/nearest, in METERS, tried smallest first.
 *
 * Ported from the origin's RAIOS_BUSCA (degrees of latitude: 0.003, 0.02, 0.15, 1)
 * and converted at 111.320 m per degree. 330 m covers a click straight on the
 * line; 111 km covers a click on a 1-pixel trace seen from above the state.
 * Without the last step, clicking a line with the map zoomed out opens nothing.
 * @constant {number[]}
 */
const NEAREST_SEARCH_RADII_M = [330, 2200, 16700, 111000];

/**
 * The photo closest to an arbitrary point, or null.
 *
 * WHY THIS EXISTS: the map used to find the photo nearest to a click with
 * querySourceFeatures over the tiles ALREADY DRAWN, which tied the answer to what
 * was painted — below the source's minimum zoom there is no tile, so the click did
 * nothing. Here the answer comes from the database, so it holds at any zoom and
 * returns the photo REALLY nearest, not the nearest among those that survived the
 * tile's thinning.
 *
 * It REUSES `nearby()`, which already carries the per-project access filter, so
 * there is no second path to a hidden project's photos. That reuse has one bound
 * worth naming: `nearby()` caps at the 100 nearest rows BEFORE the readability
 * filter, so a caller surrounded by 100 unreadable photos would be told there is
 * nothing near. Every project in the corpus is `enabled`, so the cap has no effect
 * today; the alternative is a second query with the filter inlined in SQL.
 * @param {number} lon
 * @param {number} lat
 * @param {Object} [user]
 * @returns {Promise<Object|null>} the nearest readable photo, or null
 */
export async function nearestPhoto(lon, lat, user) {
  for (const radius of NEAREST_SEARCH_RADII_M) {
    const rows = await nearby(lon, lat, radius, user);
    // `nearby` orders by distance ascending, so the head IS the nearest one.
    if (rows.length > 0) return rows[0];
  }
  return null;
}

/**
 * Photos of the same project near a source photo and not yet linked to it.
 *
 * FLOOR: absent `floor` keeps the SOURCE photo's own level, which is the safe
 * default (the index is 2D and indoor photos stack). `'all'` drops the filter,
 * which is what the stairwells and the tunnels need: of the Beira-Rio's 894 links,
 * 84 do cross a level. An explicit integer pins one level.
 *
 * RADIUS: CLAMPED into [1, 1000] m, never rejected — the origin clamps, and a
 * negative radius would otherwise return an empty list that reads as "no
 * neighbours" instead of "bad input", while a huge one would scan the project.
 * @param {string} uuid - source photo id
 * @param {Object} [opts]
 * @param {number} [opts.radius=100] - meters, clamped to [1, 1000]
 * @param {string|number} [opts.floor] - 'all', a level, or undefined
 * @param {Object} [user]
 * @returns {Promise<Array>} candidate photos, nearest first
 * @throws {NotFoundError} if the source photo is missing/tombstoned or hidden
 */
export async function nearbyUnlinkedPhotos(uuid, { radius, floor } = {}, user) {
  const { rows } = await query(Q.GET_PHOTO_BY_ID, [uuid]);
  const source = rows[0];
  if (!source) throw new NotFoundError('Photo');
  enforceProjectReadable(photoProject(source), user, 'Photo');

  const parsed = Number(radius);
  const radiusMeters = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 1000) : 100;

  let floorFilter;
  if (floor === 'all') floorFilter = null;
  else if (floor === undefined) floorFilter = source.floor_level;
  else floorFilter = Number(floor);

  const { rows: candidates } = await query(Q.NEARBY_UNLINKED_PHOTOS, [
    uuid,
    radiusMeters,
    floorFilter,
  ]);

  return candidates.map((c) => ({
    id: c.id,
    img: c.original_name,
    display_name: c.display_name,
    sequence_number: c.sequence_number,
    lon: c.lon,
    lat: c.lat,
    ele: c.ele,
    // The floor goes out so the filter is AUDITABLE from outside: a floor leak
    // would otherwise be invisible without opening the database, and under
    // `floor=all` this is the only thing stopping an operator from linking across
    // the building without noticing.
    floor_level: c.floor_level,
    floor_label: c.floor_label ?? null,
    // Distance IN PLAN, the same measure as the radius, rounded to the centimeter.
    distance: Math.round(c.distance_m * 100) / 100,
    // Adds the height difference. It only means something where `ele` is
    // populated: measured on the Beira-Rio, 207 of 350 photos carry ele = 0 and
    // what exists does not follow the floor. Where the data is poor the two
    // distances simply coincide, and the LABEL is what separates the floors.
    distance3d:
      Math.round(Math.hypot(c.distance_m, (c.ele ?? 0) - (source.ele ?? 0)) * 100) / 100,
    bearing: Math.round(c.bearing_deg * 100) / 100,
  }));
}

/**
 * Every photo of a project as the calibration LIST needs it, plus the review
 * counters.
 *
 * A project with NO photos answers an EMPTY list, never 404 — same rule as
 * `listProjectFloors`. 404 here is reserved for a slug that does not exist or that
 * the caller may not see. The origin 404s an empty project because it had no
 * concept of a hidden one, so there the two cases were indistinguishable anyway.
 * @param {string} slug
 * @param {Object} [user]
 * @returns {Promise<{photos: Array, reviewStats: {total: number, reviewed: number}}>}
 * @throws {NotFoundError} if the project is missing or hidden from the caller
 */
export async function projectCalibrationPhotos(slug, user) {
  const project = await resolveReadableProject(slug, user);

  const { rows } = await query(Q.PROJECT_CALIBRATION_PHOTOS, [project.id]);
  const { rows: stats } = await query(Q.REVIEW_STATS_BY_PROJECT, [project.id]);

  return {
    photos: rows.map((p) => ({
      id: p.id,
      img: p.original_name,
      display_name: p.display_name,
      sequence_number: p.sequence_number,
      reviewed: Boolean(p.calibration_reviewed),
      // NULL across the whole archive until the run derivation exists. The client
      // reads a null runId as "this project has no runs" and falls back to the
      // flat list, which is the pre-run behaviour.
      runId: p.run_id,
      runPosition: p.run_position,
      // 'sol', 'imu', 'manual' or null (no measurement over this photo).
      calibrationSource: p.calibration_source ?? null,
      // The origin calls this column `captured_at`; this house stores the SAME
      // parameter in sv360.photos.capture_date (migration 013 says so explicitly).
      capturedAt: p.capture_date ?? null,
      floor_level: p.floor_level,
      floor_label: p.floor_label ?? null,
    })),
    reviewStats: { total: stats[0].total, reviewed: stats[0].reviewed },
  };
}

/**
 * Review counters of every project the caller can see, keyed by slug.
 * @param {Object} [user]
 * @returns {Promise<Object>} { <slug>: { total, reviewed } }
 */
export async function reviewStatsAllProjects(user) {
  const isAdmin = user?.role === 'admin';
  const { rows } = await query(Q.REVIEW_STATS_ALL_PROJECTS, [
    isAdmin,
    user?.organization_id ?? null,
  ]);
  const stats = {};
  for (const row of rows) {
    stats[row.slug] = { total: row.total, reviewed: row.reviewed };
  }
  return stats;
}

/**
 * Everything the calibration MAP draws for ONE project: the photos with their
 * three angles, the driven track, the bounding box and the review counters.
 *
 * ONE project, always: the map exists to review ONE survey, and merging projects
 * would only inflate the payload without serving anyone.
 * @param {string} slug
 * @param {Object} [user]
 * @returns {Promise<Object>} { slug, photos, track, bounds, reviewStats }
 * @throws {NotFoundError} if the project is missing or hidden from the caller
 */
export async function projectMap(slug, user) {
  const project = await resolveReadableProject(slug, user);

  const { rows } = await query(Q.MAP_PHOTOS_BY_PROJECT, [project.id]);
  const { rows: trackRows } = await query(Q.TRACKS_BY_PROJECT, [project.id]);
  const { rows: stats } = await query(Q.REVIEW_STATS_BY_PROJECT, [project.id]);

  const photos = rows.map((p) => ({
    id: p.id,
    display_name: p.display_name,
    sequence_number: p.sequence_number,
    lon: p.lon,
    lat: p.lat,
    heading: p.heading,
    mesh_rotation_y: p.mesh_rotation_y,
    mesh_rotation_x: p.mesh_rotation_x,
    mesh_rotation_z: p.mesh_rotation_z,
    reviewed: Boolean(p.calibration_reviewed),
    floor_level: p.floor_level,
    floor_label: p.floor_label ?? null,
  }));

  // Accumulated in ONE pass instead of Math.min(...lons): the biggest project has
  // 17.590 photos, and spreading an array that long into a call is what blows the
  // argument limit — a crash that only appears on the largest survey.
  let bounds = null;
  for (const p of rows) {
    if (p.lon === null || p.lat === null) continue;
    if (!bounds) bounds = [p.lon, p.lat, p.lon, p.lat];
    else {
      if (p.lon < bounds[0]) bounds[0] = p.lon;
      if (p.lat < bounds[1]) bounds[1] = p.lat;
      if (p.lon > bounds[2]) bounds[2] = p.lon;
      if (p.lat > bounds[3]) bounds[3] = p.lat;
    }
  }

  return {
    slug: project.slug,
    photos,
    // One array of [lon, lat] per stretch. Empty for a project whose track was
    // never imported, which is most of them: 3.236 stretches cover 17 of the 29
    // projects. An empty array draws no line; it does not break the map.
    track: trackRows.map((t) => t.coords),
    bounds,
    reviewStats: { total: stats[0].total, reviewed: stats[0].reviewed },
  };
}

/**
 * The capture runs of a project, with per-run review progress.
 *
 * Answers an EMPTY list (never 404) for a project that exists but has no runs: the
 * interface treats "no runs" as the pre-run mode, and a 404 here would make the
 * panel look broken. That is the answer for EVERY project today — sv360.capture_runs
 * exists (migration 013) but nothing derives runs yet.
 * @param {string} slug
 * @param {Object} [user]
 * @returns {Promise<Array>} runs in ordinal order
 * @throws {NotFoundError} if the project is missing or hidden from the caller
 */
export async function projectRuns(slug, user) {
  const project = await resolveReadableProject(slug, user);

  const { rows } = await query(Q.RUNS_BY_PROJECT, [project.id]);
  return rows.map((r) => ({
    id: r.id,
    sessionKey: r.session_key,
    label: r.label,
    ordinal: r.ordinal,
    startedAt: r.started_at,
    total: r.total,
    reviewed: r.reviewed,
    // RECORD of the last default applied, so the interface can say "run calibrated
    // at 337 degrees". Never inheritance: sv360.photos stays the only truth.
    applied: {
      mesh_rotation_y: r.applied_rotation_y,
      mesh_rotation_x: r.applied_rotation_x,
      mesh_rotation_z: r.applied_rotation_z,
    },
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
export function buildPhotoMetadata(photo, targets, { includeHidden = false } = {}) {
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
      // Present ONLY under include_hidden. The default read never carries the key,
      // because there the array is hidden-free by construction and a constant
      // `hidden: false` on every target would be noise the viewer has to ignore.
      ...(includeHidden ? { hidden: Boolean(t.hidden) } : {}),
    })),
  };
}
