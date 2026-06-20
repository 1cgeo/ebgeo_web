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
  height: 'camera_height',
  mesh_rotation_x: 'mesh_rotation_x',
  mesh_rotation_y: 'mesh_rotation_y',
  mesh_rotation_z: 'mesh_rotation_z',
  distance_scale: 'distance_scale',
  marker_scale: 'marker_scale',
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

// NOTE: the calibration SET clause is assembled in the service from the
// whitelist above. This constant documents the invariant tail the service
// always appends: `updated_at = now()` + `WHERE id = $N`. Kept as a marker so
// callers don't reinvent the WHERE/updated_at handling.
export const UPDATE_PHOTO_CALIBRATION_TAIL = `updated_at = now() WHERE id = $1`;

// Per-link override update on a directed (source -> target) adjacency row.
// override_* are nullable: a number SETS the override, NULL CLEARS it. No
// version/updated_at on sv360.targets — the write just mutates the row.
//   $1 = source_id, $2 = target_id,
//   $3 = override_bearing, $4 = override_distance, $5 = override_height
export const UPDATE_TARGET_OVERRIDE = `
  UPDATE sv360.targets
     SET override_bearing  = $3,
         override_distance = $4,
         override_height   = $5
   WHERE source_id = $1 AND target_id = $2
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
//   $5 = is_next, $6 = is_original, $7 = override_bearing,
//   $8 = override_distance, $9 = override_height, $10 = hidden
export const INSERT_TARGET = `
  INSERT INTO sv360.targets
    (source_id, target_id, distance_m, bearing_deg, is_next, is_original,
     override_bearing, override_distance, override_height, hidden)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
