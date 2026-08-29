// Path: src/modules/streetview360/sv360.write.queries.js
// Named SQL constants for the StreetView 360 WRITE/calibration module (Fase 9,
// stage 2). Kept SEPARATE from sv360.queries.js so the read module is untouched.
//
// Conventions:
//   - All values are passed as parameters ($1..$N) — never string-interpolated.
//   - The calibration UPDATE is built DYNAMICALLY in the service from
//     CALIBRATION_COLUMN_WHITELIST (column names come from this hard-coded
//     whitelist, values stay parametrized) per _padroes §8.
//   - GET_PHOTO_FOR_WRITE does NOT exclude tombstoned rows, so the ownership
//     check works AND re-deleting an already-tombstoned photo stays idempotent.
//   - Photos are SOFT-deleted (tombstone, idempotent). Targets are the ONE
//     intentional hard-delete (regenerable adjacency, no tombstone table).

// Contract field name -> real column. The dynamic calibration UPDATE only ever
// uses VALUES from this map's right-hand side; input keys are never trusted as
// column names.
export const CALIBRATION_COLUMN_WHITELIST = {
  heading: 'heading',
  mesh_rotation_x: 'mesh_rotation_x',
  mesh_rotation_y: 'mesh_rotation_y',
  mesh_rotation_z: 'mesh_rotation_z',
  floor_level: 'floor_level',
  calibration_reviewed: 'calibration_reviewed',
};

// Photo -> project context for the ownership check on the WRITE path. Unlike the
// read GET_PHOTO_BY_ID, this does NOT exclude tombstoned photos, so:
//   - the ownership ladder (404-then-403) still works on the delete path, and
//   - re-deleting an already-tombstoned photo is a clean idempotent 204.
//   $1 = photo id (TEXT uuid v5)
export const GET_PHOTO_FOR_WRITE = `
  SELECT p.id, p.project_id,
         pr.organization_id,
         pr.status AS project_status,
         pr.slug   AS project_slug,
         pr.db_filename
  FROM sv360.photos p
  JOIN sv360.projects pr ON pr.id = p.project_id
  WHERE p.id = $1
`;

// Per-link visibility toggle. hidden = true REMOVES the link from the read
// GET_TARGETS_FOR_PHOTO result (which filters hidden = false).
//   $1 = source_id, $2 = target_id, $3 = hidden
export const UPDATE_TARGET_VISIBILITY = `
  UPDATE sv360.targets
     SET hidden = $3
   WHERE source_id = $1 AND target_id = $2
`;

// Create a directed adjacency link. ON CONFLICT on the composite PK is left to
// raise (the service maps the PK violation / pre-check to a 409 ConflictError).
//   $1 = source_id, $2 = target_id, $3 = distance_m, $4 = bearing_deg,
//   $5 = is_next, $6 = is_original, $7 = override_bearing, $8 = hidden
export const INSERT_TARGET = `
  INSERT INTO sv360.targets
    (source_id, target_id, distance_m, bearing_deg, is_next, is_original,
     override_bearing, hidden)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
`;

// Guard for createTarget: the destination photo must exist, live in the SAME
// project as the source, and not be tombstoned. Returns a single row when the
// link is allowable.
//   $1 = source_id, $2 = target_id
export const CHECK_TARGET_SAME_PROJECT = `
  SELECT 1
  FROM sv360.photos src
  JOIN sv360.photos dst ON dst.project_id = src.project_id
  WHERE src.id = $1
    AND dst.id = $2
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = dst.id)
`;

// Existence probe for a directed link (404 on override/visibility when missing).
//   $1 = source_id, $2 = target_id
export const GET_TARGET_LINK = `
  SELECT 1
  FROM sv360.targets
  WHERE source_id = $1 AND target_id = $2
`;

// Hard-delete a directed adjacency link (the one intentional hard-delete in the
// module — targets are regenerable, no tombstone table). Idempotent: a no-match
// simply affects zero rows.
//   $1 = source_id, $2 = target_id
export const DELETE_TARGET = `
  DELETE FROM sv360.targets
  WHERE source_id = $1 AND target_id = $2
`;

// Soft-delete a photo by writing an idempotent tombstone. NEVER hard-delete the
// sv360.photos row — all read queries already exclude tombstoned photos.
//   $1 = photo id (TEXT uuid v5)
export const SOFT_DELETE_PHOTO = `
  INSERT INTO sv360.deleted_photos (photo_id)
  VALUES ($1)
  ON CONFLICT (photo_id) DO NOTHING
`;

// --- batch calibration by PROJECT / by RUN (stage 2b) -----------------------
// These two apply ONE default to MANY photos at once. Both write straight into
// sv360.photos, which stays the single truth of a photo's calibration.

// Contract field name -> real column for the batch routes. DELIBERATELY smaller
// than CALIBRATION_COLUMN_WHITELIST above: applying one default to a whole project
// only makes sense for the three MOUNTING angles, which are constant while the
// camera rig does not move. Everything else in the per-photo whitelist is
// per-photo by nature (heading, scales, floor_level) or is the review flag, which
// has its own endpoint. Same rule as the per-photo path: column names come ONLY
// from this map, never from input keys.
export const ROTATION_COLUMN_WHITELIST = {
  mesh_rotation_y: 'mesh_rotation_y',
  mesh_rotation_x: 'mesh_rotation_x',
  mesh_rotation_z: 'mesh_rotation_z',
};

// The WHERE clause of the two batch UPDATEs, as a marker of the invariant the
// service always appends. The SET list is assembled from the whitelist above.
// Tombstoned photos are excluded: a deleted photo is not part of the project any
// more, and counting it in `photosUpdated` would report work that nobody sees.
export const BATCH_ROTATION_SCOPE = {
  project: 'project_id = $1::uuid',
  run: 'run_id = $1::uuid',
};

// Clears the review flag of every live photo of a project.
//   $1 = project id (uuid)
export const BATCH_RESET_REVIEWED = `
  UPDATE sv360.photos
     SET calibration_reviewed = false, updated_at = now()
   WHERE project_id = $1::uuid
     AND id NOT IN (SELECT photo_id FROM sv360.deleted_photos)
`;

// One capture run plus its project context, for the ownership ladder of
// PUT /runs/:runId/batch-calibration. The run has no slug, so this is the only
// way the write path can resolve which organization owns it.
//   $1 = capture run id (uuid)
export const GET_RUN_FOR_WRITE = `
  SELECT cr.id, cr.label, cr.ordinal, cr.project_id,
         pr.organization_id, pr.status AS project_status, pr.slug AS project_slug
  FROM sv360.capture_runs cr
  JOIN sv360.projects pr ON pr.id = cr.project_id
  WHERE cr.id = $1::uuid
`;

// Records the last default applied to a run, so the interface can say "run
// calibrated at 337 degrees". It is a RECORD, never inheritance: the truth of the
// calibration stays in sv360.photos.
//
// COALESCE preserves the axes this batch did not touch — applying only the roll
// must not erase the memory of the heading applied before.
//   $1 = run id (uuid), $2 = y, $3 = x, $4 = z (each nullable)
export const UPDATE_RUN_APPLIED = `
  UPDATE sv360.capture_runs SET
    applied_rotation_y = COALESCE($2::double precision, applied_rotation_y),
    applied_rotation_x = COALESCE($3::double precision, applied_rotation_x),
    applied_rotation_z = COALESCE($4::double precision, applied_rotation_z)
  WHERE id = $1::uuid
`;
