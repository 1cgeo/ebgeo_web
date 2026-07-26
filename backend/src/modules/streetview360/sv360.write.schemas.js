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

// PUT /photos/:uuid/calibration — any subset of the FROZEN calibration fields;
// at least one (.min(1)). Field names are the contract names (`height` maps to
// camera_height in the service whitelist).
export const calibrationBodySchema = Joi.object({
  heading: finiteNumber,
  height: finiteNumber,
  mesh_rotation_x: finiteNumber,
  mesh_rotation_y: finiteNumber,
  mesh_rotation_z: finiteNumber,
  distance_scale: finiteNumber,
  marker_scale: finiteNumber,
  floor_level: floorLevel,
  calibration_reviewed: calibrationReviewed,
})
  .min(1)
  .unknown(false);

// --- granular single-field bodies ------------------------------------------

export const heightBodySchema = Joi.object({
  height: finiteNumber.required(),
}).unknown(false);

export const rotationXBodySchema = Joi.object({
  mesh_rotation_x: finiteNumber.required(),
}).unknown(false);

export const rotationZBodySchema = Joi.object({
  mesh_rotation_z: finiteNumber.required(),
}).unknown(false);

export const distanceScaleBodySchema = Joi.object({
  distance_scale: finiteNumber.required(),
}).unknown(false);

export const markerScaleBodySchema = Joi.object({
  marker_scale: finiteNumber.required(),
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

// PUT /photos/:uuid/targets/:targetId/override — each override is a number (SET)
// or null (CLEAR); at least one key required.
export const targetOverrideBodySchema = Joi.object({
  override_bearing: finiteNumber.allow(null),
  override_distance: finiteNumber.allow(null),
  override_height: finiteNumber.allow(null),
})
  .min(1)
  .unknown(false);

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
  override_distance: finiteNumber.allow(null),
  override_height: finiteNumber.allow(null),
  hidden: Joi.boolean().default(false),
}).unknown(false);

// --- batch -----------------------------------------------------------------

// POST /photos/batch-calibration — array of calibration items, each with a
// required uuid + at least one calibration field. Max 500 (mirrors sync push).
const batchItemSchema = Joi.object({
  uuid: photoId.required(),
  heading: finiteNumber,
  height: finiteNumber,
  mesh_rotation_x: finiteNumber,
  mesh_rotation_y: finiteNumber,
  mesh_rotation_z: finiteNumber,
  distance_scale: finiteNumber,
  marker_scale: finiteNumber,
  floor_level: floorLevel,
  calibration_reviewed: calibrationReviewed,
})
  .min(2) // uuid + at least one calibration field
  .unknown(false);

export const batchCalibrationBodySchema = Joi.object({
  photos: Joi.array().items(batchItemSchema).min(1).max(500).required(),
}).unknown(false);
