// Path: src/modules/streetview360/sv360.admin.schemas.js
// Joi schemas for the StreetView 360 ADMIN / INGESTION path (Fase 9, stage 3a).
// Kept SEPARATE from sv360.schemas.js (read params) and sv360.write.schemas.js
// (calibration bodies). Validation errors are translated to the FROZEN flat
// { error: '...' } envelope by the router-level sv360ErrorHandler.
//
// The manifest is the project's FULL state (not a delta) — the studio re-exports
// the whole project each time and ingestion is "last upload wins" by
// (organization_id, slug). The exact studio format is an assumption flagged in
// the SPEC (docs/plano/fase-9-absorver-360.md); this schema maps 1:1 onto the
// real §4.3 / 005_sv360.sql columns.
//
// What it rejects (the contract the SPEC's validateManifest must enforce):
//   - NaN / Infinity in ANY numeric (Joi.number() rejects non-finite);
//   - lat ∉ [-90,90] / lon ∉ [-180,180];
//   - missing required NOT NULL columns (id, original_name, sequence_number,
//     lat, lon, full_size_bytes, preview_size_bytes);
//   - db_filename containing a path separator (basename only — traversal guard);
//   - duplicate sequence_number within photos[] (UNIQUE(project_id, seq));
//   - a target whose source_id/target_id is not a photo id present in photos[]
//     (referential integrity INSIDE the bundle) — enforced by .custom() below.
import Joi from 'joi';
import { slugParamSchema } from './sv360.schemas.js';

// Re-export the shared :slug param schema so the admin routes/controller have a
// single import surface (params validation for status/delete/get).
export { slugParamSchema };

// Photo id — the studio's deterministic uuidv5 (D9.6), OR the v4 that the legacy
// index.db corpus carries. The backend validates the FORMAT and trusts the id; it
// does NOT recompute it. A v5-only guard here would 422 the ingestion of every
// legacy bundle, i.e. block the migration itself. See sv360.schemas.js.
const photoId = Joi.string()
  .trim()
  .guid({ version: ['uuidv4', 'uuidv5'] });

// A finite number (Joi.number() already rejects NaN/Infinity/non-numeric).
const finiteNumber = Joi.number();

// db_filename: OPTIONAL and IGNORED (FIX-1). The {slug}.db filename is DERIVED
// server-side from (organization_id, slug) in sv360.merge.js (deriveDbFilename),
// so a malicious manifest cannot point the store at another OM's file. We still
// accept the field for backward-compat (older bundles include it) but only
// validate it as a harmless basename when present — it is never written.
const dbFilename = Joi.string()
  .trim()
  .min(1)
  .max(255)
  .pattern(/[/\\]/, { invert: true })
  .messages({
    'string.pattern.invert.base': 'db_filename must be a basename (no path separator)',
  });

// --- project ---------------------------------------------------------------

const projectSchema = Joi.object({
  // Charset matches `sanitizeSlug` (sv360.merge.js), UNDERSCORE INCLUDED: the real
  // corpus slugs are `27o_gac`, `ponta_grossa_1`, `santana_livramento`. Kebab-only
  // here would 422 the upload of a project the ETL can already import, so the two
  // ingestion paths would disagree about what a valid project is.
  slug: Joi.string()
    .trim()
    .pattern(/^[a-z0-9_-]+$/)
    .min(1)
    .max(255)
    .required(),
  name: Joi.string().trim().min(1).max(512).required(),
  // OPTIONAL: resolved to organization_id by the service (global admin may set
  // any OM; an om_data_admin is forced to its own org). Default org if omitted.
  orgSlug: Joi.string().trim().min(1).max(255).allow(null),
  center_lat: finiteNumber.min(-90).max(90).allow(null),
  center_long: finiteNumber.min(-180).max(180).allow(null),
  // Optional LOGICAL ref to a photos.id (NOT a DB FK); the photo need not exist.
  entry_photo_id: Joi.string().trim().max(255).allow(null),
  // OPTIONAL + IGNORED (FIX-1) — derived server-side from (org, slug). Still
  // validated as a harmless basename when present, but never used.
  db_filename: dbFilename.optional().allow(null),
}).unknown(true);

// --- photo -----------------------------------------------------------------

const photoSchema = Joi.object({
  id: photoId.required(),
  original_name: Joi.string().trim().min(1).max(512).required(),
  display_name: Joi.string().trim().max(512).allow(null),
  sequence_number: Joi.number().integer().required(),
  lat: finiteNumber.min(-90).max(90).required(),
  lon: finiteNumber.min(-180).max(180).required(),
  ele: finiteNumber.allow(null),
  heading: finiteNumber.allow(null),
  camera_height: finiteNumber.allow(null),
  mesh_rotation_x: finiteNumber.allow(null),
  mesh_rotation_y: finiteNumber.allow(null),
  mesh_rotation_z: finiteNumber.allow(null),
  distance_scale: finiteNumber.allow(null),
  marker_scale: finiteNumber.allow(null),
  floor_level: Joi.number().integer().allow(null),
  // The O(1) ETag source — MUST be a non-negative integer (matches the images.db
  // BLOB byte length; the cross-check against the actual BLOB is done by the
  // service's validateImagesDb, not here).
  full_size_bytes: Joi.number().integer().min(0).required(),
  preview_size_bytes: Joi.number().integer().min(0).required(),
  calibration_reviewed: Joi.boolean().allow(null),
  capture_date: Joi.string().isoDate().allow(null),
}).unknown(true);

// --- target ----------------------------------------------------------------

const targetSchema = Joi.object({
  source_id: photoId.required(),
  target_id: photoId.required(),
  distance_m: finiteNumber.allow(null),
  bearing_deg: finiteNumber.allow(null),
  is_next: Joi.boolean().allow(null),
  is_original: Joi.boolean().allow(null),
  override_bearing: finiteNumber.allow(null),
  override_distance: finiteNumber.allow(null),
  override_height: finiteNumber.allow(null),
  hidden: Joi.boolean().allow(null),
}).unknown(true);

// --- tombstone -------------------------------------------------------------

const tombstoneSchema = Joi.object({
  photo_id: photoId.required(),
  deleted_at: Joi.string().isoDate().allow(null),
}).unknown(true);

// --- capture track ---------------------------------------------------------

// One capture-run segment: a [lon, lat] polyline. A project is MANY runs (the
// legacy corpus averages ~115 per project), so this is source data, not something
// derivable from the photo sequence. >= 2 points, because a 1-point LINESTRING is
// rejected by PostGIS. Ranges match the photo lat/lon bounds.
const trackSchema = Joi.object({
  coords: Joi.array()
    .items(
      Joi.array()
        .ordered(finiteNumber.min(-180).max(180).required(), finiteNumber.min(-90).max(90).required())
        .length(2)
    )
    .min(2)
    .required(),
  source: Joi.string().trim().max(64).allow(null),
}).unknown(true);

// --- aggregate manifest ----------------------------------------------------

// .custom() enforces the two cross-array invariants Joi cannot express
// field-locally: duplicate sequence_number within photos[], and a target whose
// source_id/target_id does not reference a photo id present in photos[].
export const manifestSchema = Joi.object({
  schemaVersion: Joi.number().integer().min(1).default(1),
  project: projectSchema.required(),
  photos: Joi.array().items(photoSchema).min(1).required(),
  targets: Joi.array().items(targetSchema).default([]),
  deleted_photos: Joi.array().items(tombstoneSchema).default([]),
  // Optional: a bundle without tracks leaves the project with none, and the tile
  // falls back to synthesizing the line from the photo sequence.
  tracks: Joi.array().items(trackSchema).default([]),
})
  .unknown(true)
  .custom((value, helpers) => {
    const photoIds = new Set();
    const seqs = new Set();
    for (const p of value.photos) {
      if (seqs.has(p.sequence_number)) {
        return helpers.message(
          `Duplicate sequence_number ${p.sequence_number} within photos[]`
        );
      }
      seqs.add(p.sequence_number);
      photoIds.add(p.id);
    }
    for (const tg of value.targets || []) {
      if (!photoIds.has(tg.source_id)) {
        return helpers.message(`Target source_id ${tg.source_id} not present in photos[]`);
      }
      if (!photoIds.has(tg.target_id)) {
        return helpers.message(`Target target_id ${tg.target_id} not present in photos[]`);
      }
    }
    return value;
  }, 'manifest referential integrity');

// --- request schemas (params / body / query) -------------------------------

// PATCH /admin/projects/:slug/status — { status: 'enabled' | 'disabled' }.
// Mirrors the sv360.projects.status CHECK constraint.
export const statusBodySchema = Joi.object({
  status: Joi.string().valid('enabled', 'disabled').required(),
}).unknown(false);

// GET /admin/projects — optional ?orgId filter (a global admin may scope the list
// to a single OM). Non-admins ignore it (forced to their own org in the service).
export const listAdminQuerySchema = Joi.object({
  // L9 — ANY uuid version, not just v4: the seeded default organization is
  // `00000000-0000-0000-0000-000000000001`, which is not a v4, so pinning v4
  // made `?orgId=<default org>` 422 — rejecting the single most likely value.
  orgId: Joi.string().guid(),
}).unknown(true);

// PATCH/DELETE /admin/projects/:slug[/status] — optional ?orgId / ?orgSlug used by
// a global admin to disambiguate a slug owned by ≥2 OMs (FIX-5). Validated so a
// MALFORMED ?orgId yields a clean 422 (Joi → frozen { error }) via the generic
// `validate` middleware + sv360 error handler, instead of a 500 when the value
// reaches the SQL uuid cast in the service. orgSlug is a free token.
export const orgScopeQuerySchema = Joi.object({
  // Any uuid version — same reason as listAdminQuerySchema (L9): the default org
  // id is not a v4, so a v4-only rule 422s the most common scoping value.
  orgId: Joi.string().guid(),
  orgSlug: Joi.string().trim().min(1).max(255),
}).unknown(true);
