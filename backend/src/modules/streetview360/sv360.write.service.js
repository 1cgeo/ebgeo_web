// Path: src/modules/streetview360/sv360.write.service.js
// Write/calibration business logic for the StreetView 360 module (Fase 9,
// stage 2). Builds on the stage-1 read module WITHOUT changing it:
//   - ownership is enforced HERE (not in middleware), after loading photo->project
//     so a missing/tombstoned photo or hidden project yields the same 404 as a
//     read (never leaking existence);
//   - every write that returns a photo RE-READS via the stage-1 read queries and
//     calls the EXISTING buildPhotoMetadata, so the FROZEN photoMetadataShape has
//     a single source of truth (no hand-assembly here);
//   - photos are SOFT-deleted via the sv360.deleted_photos tombstone (idempotent),
//     NEVER hard-deleted; targets ARE hard-deleted (regenerable adjacency).
//
// The 360 module is OUTSIDE the atlas sync/CRDT/WS system: sv360.photos has
// updated_at (bumped on calibration) but NO version column, sv360.targets has
// neither — and there is NO WS broadcast for 360 writes.
import { query, tx } from '../../database/index.js';
import * as WQ from './sv360.write.queries.js';
import * as Q from './sv360.queries.js';
import { buildPhotoMetadata, isProjectReadable } from './sv360.service.js';
import { ForbiddenError, NotFoundError, ConflictError } from '../../utils/errors.js';

/**
 * Write-access predicate for a project.
 *   (a) global admin (user.role === 'admin'); OR
 *   (b) same-org writer: user.organization_id matches project.organization_id
 *       AND user.org_role ∈ {owner, admin, editor}.
 * A same-org `viewer` can READ (stage 1) but NOT write.
 * @param {Object} [user]    - req.user ({ role, organization_id, org_role })
 * @param {Object} project   - { organization_id }
 * @returns {boolean}
 */
export function canWriteProject(user, project) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!user.organization_id || user.organization_id !== project.organization_id) return false;
  return ['owner', 'admin', 'editor'].includes(user.org_role);
}

/**
 * Ownership ladder reused by every write: 404 if not even readable (no leak),
 * then 403 if readable-but-not-writable (caller already knows it exists, so 403
 * is the honest "you may look but not edit" signal).
 * @param {Object} project - { status, organization_id }
 * @param {Object} [user]
 * @param {string} [resource='Photo']
 * @throws {NotFoundError} when not readable (404)
 * @throws {ForbiddenError} when readable but not writable (403)
 */
export function enforceProjectWritable(project, user, resource = 'Photo') {
  if (!isProjectReadable(project, user)) throw new NotFoundError(resource);
  if (!canWriteProject(user, project)) throw new ForbiddenError();
}

// --- internal --------------------------------------------------------------

// Normalizes a pg-promise transaction context `t` into the same `{ rows }`
// contract as the module-level `query()` helper, so the load/rebuild helpers can
// run unchanged inside or outside a transaction (t.any returns a bare array).
function txExecutor(t) {
  return async (text, values) => {
    const result = await t.any(text, values);
    return { rows: result, rowCount: result.length };
  };
}

// Loads the photo->project row for the WRITE path (does NOT exclude tombstones)
// and applies the ownership ladder. Returns the loaded row.
async function loadWritablePhoto(uuid, user, executor = query) {
  const { rows } = await executor(WQ.GET_PHOTO_FOR_WRITE, [uuid]);
  const photo = rows[0];
  if (!photo) throw new NotFoundError('Photo');
  enforceProjectWritable(
    { status: photo.project_status, organization_id: photo.organization_id },
    user
  );
  return photo;
}

// Re-reads the photo + its targets via the stage-1 read queries and rebuilds the
// FROZEN photoMetadataShape — the single source of truth for the write response.
async function rebuildPhotoShape(uuid, executor = query) {
  const { rows } = await executor(Q.GET_PHOTO_BY_ID, [uuid]);
  const photo = rows[0];
  if (!photo) throw new NotFoundError('Photo');
  const { rows: targets } = await executor(Q.GET_TARGETS_FOR_PHOTO, [photo.id]);
  return buildPhotoMetadata(photo, targets);
}

// Builds a dynamic, parametrized calibration UPDATE from the column whitelist.
// Column names come ONLY from CALIBRATION_COLUMN_WHITELIST (never from input
// keys); values are bound as $2..$N. $1 is reserved for the WHERE id. Returns
// null when no whitelisted field is present.
function buildCalibrationUpdate(uuid, fields) {
  const sets = [];
  const params = [uuid];
  for (const [field, column] of Object.entries(WQ.CALIBRATION_COLUMN_WHITELIST)) {
    if (Object.prototype.hasOwnProperty.call(fields, field) && fields[field] !== undefined) {
      params.push(fields[field]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (sets.length === 0) return null;
  const sql = `UPDATE sv360.photos SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`;
  return { sql, params };
}

// --- public API ------------------------------------------------------------

/**
 * Applies a subset of calibration fields to a photo, then returns the rebuilt
 * frozen shape. Ownership is checked first; the UPDATE is whitelist-driven.
 * @param {string} uuid
 * @param {Object} fields - validated subset of the calibration contract fields
 * @param {Object} user
 * @returns {Promise<Object>} frozen photoMetadataShape
 */
export async function updateCalibration(uuid, fields, user) {
  // L8 — one transaction, so a photo that turns out to be tombstoned does not
  // keep the UPDATE. The write gate (GET_PHOTO_FOR_WRITE) deliberately KEEPS
  // tombstoned rows so ownership still resolves, but the read used to rebuild the
  // response (GET_PHOTO_BY_ID) excludes them — so the old sequence persisted the
  // calibration and only THEN threw 404, leaving a write the caller was told
  // never happened. The batch path already rolled back; this now matches it.
  return tx(async (t) => {
    const exec = txExecutor(t);
    await loadWritablePhoto(uuid, user, exec);
    const update = buildCalibrationUpdate(uuid, fields);
    if (update) await exec(update.sql, update.params);
    return rebuildPhotoShape(uuid, exec);
  });
}

/**
 * PATCHES the per-link overrides of a directed link: a number SETS, an explicit
 * null CLEARS, an ABSENT key is LEFT UNTOUCHED. The three are distinguished by a
 * per-column "provided" flag (`!== undefined`), exactly like updateAtlas /
 * updateOrganization / updateRank — `??`/`||`/COALESCE all collapse two of the
 * three, and `||` would additionally eat a legitimate 0.
 * @param {string} uuid - source photo id
 * @param {string} targetId - destination photo id
 * @param {Object} overrides - { override_bearing?, override_distance?, override_height? } (number|null)
 * @param {Object} user
 * @returns {Promise<Object>} frozen photoMetadataShape for the SOURCE photo
 */
export async function updateTargetOverride(uuid, targetId, overrides, user) {
  // L8 (achado 68) — one transaction, exactly like updateCalibration: the write gate
  // (GET_PHOTO_FOR_WRITE) deliberately KEEPS tombstoned rows, while the rebuild
  // (GET_PHOTO_BY_ID) excludes them and throws 404. With loose query() calls each
  // statement committed on its own, so a tombstoned source persisted the UPDATE and
  // only THEN 404'd — a write the caller was told never happened.
  return tx(async (t) => {
    const exec = txExecutor(t);
    await loadWritablePhoto(uuid, user, exec);
    const { rows: link } = await exec(WQ.GET_TARGET_LINK, [uuid, targetId]);
    if (!link[0]) throw new NotFoundError('Target');
    await exec(WQ.UPDATE_TARGET_OVERRIDE, [
      uuid,
      targetId,
      // [value, provided?] per column: an explicit null CLEARS, an omitted field
      // leaves the column alone. `?? null` alone could not tell those apart and
      // wiped every field the caller did not send.
      overrides.override_bearing ?? null,
      overrides.override_distance ?? null,
      overrides.override_height ?? null,
      overrides.override_bearing !== undefined,
      overrides.override_distance !== undefined,
      overrides.override_height !== undefined,
    ]);
    return rebuildPhotoShape(uuid, exec);
  });
}

/**
 * Toggles a directed link's visibility. hidden=true makes it disappear from the
 * read targets array (which filters hidden=false).
 * @param {string} uuid - source photo id
 * @param {string} targetId - destination photo id
 * @param {boolean} hidden
 * @param {Object} user
 * @returns {Promise<Object>} frozen photoMetadataShape for the SOURCE photo
 */
export async function updateTargetVisibility(uuid, targetId, hidden, user) {
  // Same L8 transaction envelope as updateTargetOverride (achado 68).
  return tx(async (t) => {
    const exec = txExecutor(t);
    await loadWritablePhoto(uuid, user, exec);
    const { rows: link } = await exec(WQ.GET_TARGET_LINK, [uuid, targetId]);
    if (!link[0]) throw new NotFoundError('Target');
    await exec(WQ.UPDATE_TARGET_VISIBILITY, [uuid, targetId, hidden]);
    return rebuildPhotoShape(uuid, exec);
  });
}

/**
 * Creates a directed adjacency link from :uuid to body.target_id. The target
 * must exist in the SAME project and not be tombstoned; a duplicate link 409s.
 * @param {string} uuid - source photo id
 * @param {Object} body - { target_id, is_next?, is_original?, distance_m?, bearing_deg?, override_*?, hidden? }
 * @param {Object} user
 * @returns {Promise<Object>} frozen photoMetadataShape for the SOURCE photo (incl. new target)
 */
export async function createTarget(uuid, body, user) {
  // Same L8 transaction envelope (achado 68): CHECK_TARGET_SAME_PROJECT only filters
  // the DESTINATION's tombstone, so a tombstoned SOURCE reached the INSERT and the
  // 404 came from the rebuild afterwards — leaving an orphan link behind.
  return tx(async (t) => {
    const exec = txExecutor(t);
    await loadWritablePhoto(uuid, user, exec);

    const { rows: same } = await exec(WQ.CHECK_TARGET_SAME_PROJECT, [uuid, body.target_id]);
    if (!same[0]) {
      throw new ConflictError('Target photo must exist in the same project');
    }

    const { rows: existing } = await exec(WQ.GET_TARGET_LINK, [uuid, body.target_id]);
    if (existing[0]) throw new ConflictError('Target link already exists');

    await exec(WQ.INSERT_TARGET, [
      uuid,
      body.target_id,
      body.distance_m ?? null,
      body.bearing_deg ?? null,
      body.is_next ?? false,
      body.is_original ?? false,
      body.override_bearing ?? null,
      body.override_distance ?? null,
      body.override_height ?? null,
      body.hidden ?? false,
    ]);
    return rebuildPhotoShape(uuid, exec);
  });
}

/**
 * Hard-deletes a directed adjacency link (the one intentional hard-delete).
 * Idempotent: a no-match still resolves (the controller returns 204).
 * @param {string} uuid - source photo id
 * @param {string} targetId - destination photo id
 * @param {Object} user
 * @returns {Promise<void>}
 */
export async function deleteTarget(uuid, targetId, user) {
  await loadWritablePhoto(uuid, user);
  await query(WQ.DELETE_TARGET, [uuid, targetId]);
}

/**
 * Soft-deletes a photo by writing an idempotent tombstone (ON CONFLICT DO
 * NOTHING) inside a transaction. NEVER hard-deletes the photos row; all reads
 * exclude it afterwards. First delete -> tombstone written; a re-delete loads
 * via GET_PHOTO_FOR_WRITE (which keeps tombstoned rows) so ownership still
 * passes and the tombstone insert is a no-op (clean idempotent path).
 * @param {string} uuid - photo id
 * @param {Object} user
 * @returns {Promise<void>}
 */
export async function softDeletePhoto(uuid, user) {
  await tx(async (t) => {
    await loadWritablePhoto(uuid, user, txExecutor(t));
    await t.none(WQ.SOFT_DELETE_PHOTO, [uuid]);
  });
}

/**
 * Per-item batch calibration with partial failure (a batch may span photos of
 * different projects, so ownership is checked per item). One bad item never
 * fails the rest. Each item runs in its OWN nested transaction (a SAVEPOINT):
 * if an item's SQL fails — e.g. a finite-but-out-of-range floor_level overflows
 * the INTEGER column — only that savepoint rolls back, leaving the outer tx (and
 * the already-committed successes) intact. A plain shared `t` would instead enter
 * the aborted state on the first SQL error and silently drop every other item.
 * @param {Array<Object>} items - each { uuid, ...calibration subset }
 * @param {Object} user
 * @returns {Promise<{updated: Object[], failed: {uuid:string, error:string}[]}>}
 */
export async function batchCalibration(items, user) {
  const updated = [];
  const failed = [];

  await tx(async (t) => {
    for (const item of items) {
      const { uuid, ...fields } = item;
      try {
        // Nested tx => SAVEPOINT: an item failure rolls back ONLY this item.
        const shape = await t.tx(async (t2) => {
          const exec = txExecutor(t2);
          await loadWritablePhoto(uuid, user, exec);
          const update = buildCalibrationUpdate(uuid, fields);
          if (update) await exec(update.sql, update.params);
          return rebuildPhotoShape(uuid, exec);
        });
        updated.push(shape);
      } catch (err) {
        failed.push({ uuid, error: err.message });
      }
    }
  });

  return { updated, failed };
}
