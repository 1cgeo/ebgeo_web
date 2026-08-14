// Path: src/modules/streetview360/sv360.write.controller.js
// HTTP layer for the StreetView 360 WRITE/calibration module (Fase 9, stage 2).
//
// Every handler is reached only AFTER the STRICT `auth` middleware (401 if no
// credential) and `validate` (422 on bad body/params, fields already coerced).
// Ownership (404-then-403 ladder) lives in the SERVICE, not here.
//
// Responses are BARE (NOT wrapped in {data}) to match the FROZEN 360 contract —
// same as the stage-1 read controller. Writes that return a photo get the rebuilt
// photoMetadataShape straight from the service. Hard-deletes (target/photo) reply
// 204; create replies 201; the rest reply 200.
import { asyncHandler } from '../../utils/async-handler.js';
import * as wsvc from './sv360.write.service.js';

// PUT /sv360/photos/:uuid/calibration — aggregate calibration update (subset).
// Returns the frozen photoMetadataShape for :uuid. 200, bare.
export const updateCalibration = asyncHandler(async (req, res) => {
  res.json(await wsvc.updateCalibration(req.params.uuid, req.body, req.user));
});

// --- granular single-field aliases of /calibration -------------------------
// Each forwards exactly the one validated field to the same whitelist-driven
// UPDATE path in the service. 200, bare frozen shape.

// PUT /sv360/photos/:uuid/rotation-x — { mesh_rotation_x }.
export const updateRotationX = asyncHandler(async (req, res) => {
  res.json(
    await wsvc.updateCalibration(
      req.params.uuid,
      { mesh_rotation_x: req.body.mesh_rotation_x },
      req.user
    )
  );
});

// PUT /sv360/photos/:uuid/rotation-z — { mesh_rotation_z }.
export const updateRotationZ = asyncHandler(async (req, res) => {
  res.json(
    await wsvc.updateCalibration(
      req.params.uuid,
      { mesh_rotation_z: req.body.mesh_rotation_z },
      req.user
    )
  );
});

// PUT /sv360/photos/:uuid/reviewed — { calibration_reviewed }.
export const updateReviewed = asyncHandler(async (req, res) => {
  res.json(
    await wsvc.updateCalibration(
      req.params.uuid,
      { calibration_reviewed: req.body.calibration_reviewed },
      req.user
    )
  );
});

// --- target (adjacency) writes ---------------------------------------------

// PUT /sv360/photos/:uuid/targets/:targetId/visibility — toggle hidden. 200,
// frozen shape for the SOURCE photo (a hidden target drops out of `targets`).
export const setTargetVisibility = asyncHandler(async (req, res) => {
  res.json(
    await wsvc.updateTargetVisibility(
      req.params.uuid,
      req.params.targetId,
      req.body.hidden,
      req.user
    )
  );
});

// POST /sv360/photos/:uuid/targets — create a directed link. 201, frozen shape
// for the SOURCE photo (incl. the new target). 409 on duplicate/cross-project.
export const createTarget = asyncHandler(async (req, res) => {
  res.status(201).json(await wsvc.createTarget(req.params.uuid, req.body, req.user));
});

// DELETE /sv360/photos/:uuid/targets/:targetId — hard-delete the link (the one
// intentional hard-delete). 204, idempotent.
export const deleteTarget = asyncHandler(async (req, res) => {
  await wsvc.deleteTarget(req.params.uuid, req.params.targetId, req.user);
  res.status(204).end();
});

// --- photo soft-delete ------------------------------------------------------

// DELETE /sv360/photos/:uuid — SOFT-delete via tombstone (idempotent). 204.
// Never hard-deletes the photos row; subsequent reads exclude it.
export const softDeletePhoto = asyncHandler(async (req, res) => {
  await wsvc.softDeletePhoto(req.params.uuid, req.user);
  res.status(204).end();
});

// --- batch ------------------------------------------------------------------

// POST /sv360/photos/batch-calibration — per-item calibration with partial
// failure. 200, bare { updated: [<frozen shape>...], failed: [{uuid, error}] }.
export const batchCalibration = asyncHandler(async (req, res) => {
  res.json(await wsvc.batchCalibration(req.body.photos, req.user));
});

// --- batch by PROJECT / by RUN (stage 2b) ----------------------------------
// These write ONE default onto MANY photos and are therefore all-or-nothing (one
// transaction), unlike POST /photos/batch-calibration, which is per-item with
// partial failure because its items may span different projects.

// PUT /sv360/projects/:slug/batch-calibration — one rotation default for every
// live photo of the project. 200, bare { ok, slug, updated }.
export const batchCalibrateProject = asyncHandler(async (req, res) => {
  res.json(await wsvc.batchCalibrateProject(req.params.slug, req.body, req.user));
});

// POST /sv360/projects/:slug/reset-reviewed — clears the review flag of every
// live photo of the project. 200, bare { ok, slug, photosReset }.
export const resetProjectReviewed = asyncHandler(async (req, res) => {
  res.json(await wsvc.resetProjectReviewed(req.params.slug, req.user));
});

// PUT /sv360/runs/:runId/batch-calibration — one rotation default for every live
// photo of the capture run. 200, bare { ok, runId, label, updated }. 404 while the
// project has no derived runs: sv360.capture_runs is filled by the offline ETL
// scripts/sv360-derive-runs.js, which ingestion does not call.
export const batchCalibrateRun = asyncHandler(async (req, res) => {
  res.json(await wsvc.batchCalibrateRun(req.params.runId, req.body, req.user));
});
