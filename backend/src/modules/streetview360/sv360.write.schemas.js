// Path: src/modules/streetview360/sv360.write.schemas.js
// Joi schemas for the StreetView 360 WRITE/calibration module (Fase 9, stage 2).
// One schema per endpoint; validation errors are translated to the FROZEN flat
// { error: '...' } envelope (422) by the router-level sv360ErrorHandler.
//
// NUMERIC RANGES — DELIBERATELY NONE. The frozen contract documents NO numeric
// limits for any calibration field: docs/plano/fase-9-absorver-360.md and
// 99-referencia.md §6.2 only say "faixas preservadas, mudar uma faixa rejeita
// valores antes aceitos" (do NOT tighten), with zero min/max numbers — the real
// ranges live in the un-ported 1cgeo/ebgeo_360 source. The DB columns are plain
// DOUBLE PRECISION / INTEGER with NO CHECK, so they accept any finite value
// (wrapped/negative bearings, a zero or negative scale, etc.). Imposing a guessed
// min/max here would 422 a value the client legitimately sends and the DB would
// accept — the exact contract break the warning is about. So validation here is
// TYPE/FINITENESS ONLY: every numeric field is a finite number (Joi rejects
// NaN/Infinity/non-numeric), with no min/max. If a real bound is ever needed,
// confirm it against the ebgeo_360 source first, then add it narrowly.
import Joi from 'joi';

// --- reusable field fragments ----------------------------------------------

// Any finite number (rejects NaN/Infinity/strings). Used for ALL calibration
// numerics — heading, bearings, scales, distances, rotations, heights — because
// no contract range exists to enforce. Coerces numeric strings ("45" -> 45).
const finiteNumber = Joi.number();

// Floor index (DB INTEGER). Integer TYPE only; sign/range unknown → unbounded
// (basements/negative floors are legal).
const floorLevel = Joi.number().integer();

const calibrationReviewed = Joi.boolean();

// Photo id used in :uuid and :targetId path params and in bodies. v4 AND v5: the
// studio mints v5, but an imported legacy corpus is v4, and a write route that
// rejects v4 makes every migrated photo read-only. See sv360.schemas.js.
const photoId = Joi.string()
  .trim()
  .guid({ version: ['uuidv4', 'uuidv5'] });

// --- aggregate calibration body --------------------------------------------

// PUT /photos/:uuid/calibration — any subset of the calibration fields; at least
// one (.min(1)). Field names are the contract names, mapped to columns by the
// CALIBRATION_COLUMN_WHITELIST in the service. As colunas inertes que o ebgeo_360
// não usa (camera_height, distance_scale, marker_scale) saíram em 2026-08-29.
export const calibrationBodySchema = Joi.object({
  heading: finiteNumber,
  mesh_rotation_x: finiteNumber,
  mesh_rotation_y: finiteNumber,
  mesh_rotation_z: finiteNumber,
  floor_level: floorLevel,
  calibration_reviewed: calibrationReviewed,
})
  .min(1)
  .unknown(false);

// --- granular single-field bodies ------------------------------------------

export const rotationXBodySchema = Joi.object({
  mesh_rotation_x: finiteNumber.required(),
}).unknown(false);

export const rotationZBodySchema = Joi.object({
  mesh_rotation_z: finiteNumber.required(),
}).unknown(false);

export const reviewedBodySchema = Joi.object({
  calibration_reviewed: calibrationReviewed.required(),
}).unknown(false);

// --- target (adjacency) params + bodies ------------------------------------

// :uuid + :targetId path params (both photo ids). Composes with the stage-1
// uuidParamSchema pattern from sv360.schemas.js.
export const targetIdParamSchema = Joi.object({
  uuid: photoId.required(),
  targetId: photoId.required(),
}).unknown(false);

// PUT /photos/:uuid/targets/:targetId/visibility
export const targetVisibilityBodySchema = Joi.object({
  hidden: Joi.boolean().required(),
}).unknown(false);

// POST /photos/:uuid/targets — creation uses the INTERNAL column names
// (distance_m/bearing_deg), this being an admin/calibration write, not the read
// contract.
export const createTargetBodySchema = Joi.object({
  target_id: photoId.required(),
  is_next: Joi.boolean().default(false),
  is_original: Joi.boolean().default(false),
  distance_m: finiteNumber,
  bearing_deg: finiteNumber,
  override_bearing: finiteNumber.allow(null),
  hidden: Joi.boolean().default(false),
}).unknown(false);

// --- batch -----------------------------------------------------------------

// POST /photos/batch-calibration — array of calibration items, each with a
// required uuid + at least one calibration field. Max 500 (mirrors sync push).
const batchItemSchema = Joi.object({
  uuid: photoId.required(),
  heading: finiteNumber,
  mesh_rotation_x: finiteNumber,
  mesh_rotation_y: finiteNumber,
  mesh_rotation_z: finiteNumber,
  floor_level: floorLevel,
  calibration_reviewed: calibrationReviewed,
})
  .min(2) // uuid + at least one calibration field
  .unknown(false);

export const batchCalibrationBodySchema = Joi.object({
  photos: Joi.array().items(batchItemSchema).min(1).max(500).required(),
}).unknown(false);

// --- batch by PROJECT / by RUN (stage 2b) ----------------------------------

// THE RANGES THE HEADER SAID TO CONFIRM FIRST, NOW CONFIRMED.
//
// The header above forbids GUESSING a range. These three are not guessed: they
// are read from the origin's own source, `LIMITES_ROTACAO` in
// ebgeo_360 `src/routes/calibration.js` (branch master), which is the code that
// serves these two endpoints today:
//   mesh_rotation_y [0, 360]   heading, the full turn
//   mesh_rotation_x [-30, 30]  pitch of the rig
//   mesh_rotation_z [-30, 30]  roll of the rig
//
// They are applied ONLY to the two new batch endpoints, never retrofitted onto
// the per-photo routes: those have shipped without bounds, and adding one now
// would reject values the archive already holds. The asymmetry is deliberate and
// narrow — a batch writes one value onto thousands of photos, so an out-of-range
// value there is a mass error, while the per-photo route is one photo an operator
// is looking at.
export const ROTATION_LIMITS = {
  mesh_rotation_y: [0, 360],
  mesh_rotation_x: [-30, 30],
  mesh_rotation_z: [-30, 30],
};

// PUT /projects/:slug/batch-calibration and PUT /runs/:runId/batch-calibration —
// any subset of the three mounting angles, at least one (.min(1)). One schema for
// both endpoints, exactly as the origin extracted one validator for both: keeping
// two copies makes them diverge the first time a limit moves.
export const batchRotationBodySchema = Joi.object({
  mesh_rotation_y: finiteNumber
    .min(ROTATION_LIMITS.mesh_rotation_y[0])
    .max(ROTATION_LIMITS.mesh_rotation_y[1]),
  mesh_rotation_x: finiteNumber
    .min(ROTATION_LIMITS.mesh_rotation_x[0])
    .max(ROTATION_LIMITS.mesh_rotation_x[1]),
  mesh_rotation_z: finiteNumber
    .min(ROTATION_LIMITS.mesh_rotation_z[0])
    .max(ROTATION_LIMITS.mesh_rotation_z[1]),
})
  .min(1)
  .unknown(false);

// :runId path param — a capture run id. gen_random_uuid() mints v4 here, unlike
// the photo ids (which are DATA carried in from the studio); the run row is born
// in this database, so v4 is the only version it can have.
export const runIdParamSchema = Joi.object({
  runId: Joi.string().trim().guid({ version: ['uuidv4'] }).required(),
}).unknown(false);
