// Path: src/modules/streetview360/sv360.merge.js
// SHARED CORE of the StreetView 360 ingestion (Fase 9, stage 3a): the ONLY place
// that upserts a project + purges + reinserts its child rows. Reused by BOTH the
// admin multipart upload (sv360.admin.service.js) and the ETL CLI
// (scripts/sv360-import.js), so "last upload wins" semantics and the cross-OM
// collision guard are defined exactly once.
//
// Contract (per the stage-3a SPEC):
//   mergeProject(t, manifest, { orgId, source })
//     - runs ENTIRELY inside a pg-promise transaction task `t` (received, never
//       created here): it does NOT commit/rollback and does NOT touch the
//       filesystem — pure Postgres. The CALLER owns the tx() and the {slug}.db
//       file swap.
//     - "último upload manda" por (organization_id, slug): the bundle is the
//       project's FULL state (not a delta), so purge+reinsert is safe and
//       idempotent (rerunning the same manifest reproduces the same state).
//     - returns { projectId, dbFilename, photoCount } for the caller to drive the
//       tx commit + atomic file swap.
//
// Real columns: see src/database/migrations/005_sv360.sql. The geom of a
// photo is filled by trg_sv360_photos_geom from lon/lat — never written here.
import * as AQ from './sv360.admin.queries.js';
import { ConflictError } from '../../utils/errors.js';

// Deterministic default org id (012_organizations.sql). Used by the ETL backfill
// when a project's orgSlug is absent or the legacy 'org-legacy' marker (D9.x).
export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
const LEGACY_ORG_SLUGS = new Set(['', 'default', 'org-legacy']);

/**
 * Normalize a project slug to a filesystem-safe token: lowercase, keep only
 * [a-z0-9_-], collapse any other run into a single '-', and trim leading/trailing
 * '-'. Used ONLY to DERIVE the {slug}.db filename server-side — the studio's slug
 * is already constrained to /^[a-z0-9-]+$/ by the Joi schema, so this is defense
 * in depth (the ETL backfill slug is less constrained).
 * @param {string} slug
 * @returns {string}
 */
export function sanitizeSlug(slug) {
  const s = String(slug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'project';
}

/**
 * DERIVE the per-project {slug}.db filename from (organization_id, slug) — the
 * SERVER is the single authority for this name; the client-supplied
 * manifest.project.db_filename is IGNORED (FIX-1, cross-OM BLOB-overwrite guard).
 * The orgId prefix guarantees two organizations sharing the same slug never map
 * to the same file. Format: `${orgId}__${sanitizeSlug(slug)}.db`.
 * @param {string} orgId - resolved target organization_id (uuid)
 * @param {string} slug  - project slug
 * @returns {string} the derived basename (no path separator)
 */
export function deriveDbFilename(orgId, slug) {
  return `${orgId}__${sanitizeSlug(slug)}.db`;
}

/**
 * Resolve an organization_id from a slug (ETL backfill path). When the slug is
 * absent or a known legacy marker, the fixed default org id is used; otherwise
 * the slug is looked up in public.organizations. The lookup runs on the passed
 * tx task `t` so it participates in the same transaction as the merge.
 * @param {Object} t - pg-promise transaction task
 * @param {string} [orgSlug]
 * @returns {Promise<string>} organization_id (uuid)
 * @throws {ConflictError} when a non-default slug does not resolve to an org
 */
export async function resolveOrgIdBySlug(t, orgSlug) {
  const slug = (orgSlug ?? '').trim();
  if (LEGACY_ORG_SLUGS.has(slug)) return DEFAULT_ORG_ID;
  const row = await t.oneOrNone(AQ.RESOLVE_ORG_BY_SLUG, [slug]);
  if (!row) throw new ConflictError(`Unknown organization slug: ${slug}`);
  return row.id;
}

/**
 * Photo-id collision guard. For the manifest's photo ids, fail if ANY id already
 * belongs to a project OTHER than the upload's TARGET (orgId, slug). This covers
 * BOTH a cross-OM collision AND a same-org cross-project collision (FIX-6):
 * sv360.photos.id is a GLOBAL PK, so an id owned by a sibling project — even in the
 * same org — would otherwise blow the INSERT with an opaque 500. The UUID v5 is
 * deterministic per tenant, so any such collision is anomalous. The normal
 * re-upload (SAME org AND slug = the target project) is NOT flagged, so a project
 * re-uploading its own ids is always allowed. MUST run before any write.
 * @param {Object} t - pg-promise transaction task
 * @param {string[]} photoIds
 * @param {string} orgId - the target organization_id
 * @param {string} slug - the target project slug
 * @throws {ConflictError} 409 when ≥1 id belongs to a different project
 */
export async function collisionGuard(t, photoIds, orgId, slug) {
  if (!photoIds || photoIds.length === 0) return;
  const clashes = await t.any(AQ.CHECK_PHOTO_IDS_IN_OTHER_PROJECT, [photoIds, orgId, slug]);
  if (clashes.length > 0) {
    const ids = clashes.map((r) => r.id).join(', ');
    throw new ConflictError(`Photo id(s) belong to another project: ${ids}`);
  }
}

// Coerce an optional numeric field to a value or null (the schemas already
// reject NaN/Infinity, so this only normalizes absent/undefined to null).
function num(v) {
  return v === undefined || v === null ? null : v;
}

// Coerce an optional boolean to a concrete value (DB columns are NOT NULL with
// their own DEFAULTs, but we pass explicit values from the manifest).
function bool(v, dflt = false) {
  return v === undefined || v === null ? dflt : v;
}

/**
 * Idempotent "last upload wins" merge of ONE project's full state, inside the
 * caller's transaction. Steps (per SPEC mergeSemantics):
 *   1. collision guard (cross-OM) BEFORE any write -> 409;
 *   2. UPSERT project by (organization_id, slug) — PRESERVE status/created_at;
 *   3. PURGE the project's child rows (targets -> photos -> tombstones);
 *   4. REINSERT photos[] (geom via trigger), then targets[] (FKs now satisfied),
 *      then deleted_photos[] tombstones;
 *   5. return { projectId, dbFilename, photoCount }.
 * Does NOT commit/rollback and does NOT touch the filesystem.
 *
 * @param {Object} t - pg-promise transaction task (REQUIRED)
 * @param {Object} manifest - { project, photos[], targets[], deleted_photos[] }
 * @param {Object} opts
 * @param {string} opts.orgId - the resolved target organization_id (uuid)
 * @param {string} [opts.source] - free-form provenance tag ('upload' | 'etl'), informational
 * @returns {Promise<{projectId:string, dbFilename:string, photoCount:number}>}
 */
export async function mergeProject(t, manifest, { orgId, source } = {}) {
  void source; // provenance tag is informational only (no audit write here)
  const project = manifest.project ?? {};
  const photos = manifest.photos ?? [];
  const targets = manifest.targets ?? [];
  const tombstones = manifest.deleted_photos ?? [];

  // 1) Collision guard BEFORE any write (cross-OM AND same-org cross-project).
  const photoIds = photos.map((p) => p.id);
  await collisionGuard(t, photoIds, orgId, project.slug);

  // photo_count = number of (non-tombstoned) photos in the manifest. The bundle
  // is the full state, so this is simply the photos[] length (tombstones are a
  // separate carried-over list and are not counted as live photos).
  const photoCount = photos.length;

  // 2) UPSERT project by (organization_id, slug) — status/created_at preserved
  //    on conflict (they are NOT in the UPSERT_PROJECT SET list). db_filename is
  //    DERIVED server-side from (orgId, slug) (FIX-1): the client's manifest value
  //    is IGNORED so an OM cannot point its store at another OM's {slug}.db.
  const dbFilename = deriveDbFilename(orgId, project.slug);
  const upserted = await t.one(AQ.UPSERT_PROJECT, [
    orgId,
    project.slug,
    project.name,
    num(project.center_lat),
    num(project.center_long),
    project.entry_photo_id ?? null,
    photoCount,
    dbFilename,
  ]);
  const projectId = upserted.id;

  // 3) PURGE the project's child rows (targets -> photos -> tombstones). Deleting
  //    targets explicitly first avoids relying solely on the photos CASCADE.
  await t.none(AQ.PURGE_PROJECT_TARGETS, [projectId]);
  const removed = await t.any(AQ.PURGE_PROJECT_PHOTOS, [projectId]);
  const oldIds = removed.map((r) => r.id);
  if (oldIds.length > 0) {
    await t.none(AQ.PURGE_PROJECT_TOMBSTONES, [oldIds]);
  }

  // 4) REINSERT manifest state: photos first (geom filled by trigger), then
  //    targets (FKs satisfied), then carried-over tombstones.
  for (const p of photos) {
    await t.none(AQ.INSERT_PHOTO, [
      p.id,
      projectId,
      p.original_name,
      p.display_name ?? null,
      p.sequence_number,
      p.lat,
      p.lon,
      num(p.ele),
      num(p.heading) ?? 0,
      num(p.camera_height) ?? 0,
      num(p.mesh_rotation_x) ?? 0,
      num(p.mesh_rotation_y) ?? 0,
      num(p.mesh_rotation_z) ?? 0,
      num(p.distance_scale) ?? 1,
      num(p.marker_scale) ?? 1,
      num(p.floor_level) ?? 0,
      num(p.full_size_bytes),
      num(p.preview_size_bytes),
      bool(p.calibration_reviewed),
      p.capture_date ?? null,
    ]);
  }

  for (const tg of targets) {
    await t.none(AQ.INSERT_TARGET, [
      tg.source_id,
      tg.target_id,
      num(tg.distance_m),
      num(tg.bearing_deg),
      bool(tg.is_next),
      bool(tg.is_original),
      num(tg.override_bearing),
      num(tg.override_distance),
      num(tg.override_height),
      bool(tg.hidden),
    ]);
  }

  for (const tomb of tombstones) {
    await t.none(AQ.INSERT_TOMBSTONE, [tomb.photo_id, tomb.deleted_at ?? null]);
  }

  // 5) Hand back the handles the caller needs to drive the commit + file swap.
  return { projectId, dbFilename: upserted.db_filename, photoCount };
}
