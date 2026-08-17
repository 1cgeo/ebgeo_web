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
import { principalUserId } from '../../utils/principal.js';
import { ForbiddenError, NotFoundError, ConflictError } from '../../utils/errors.js';
import { safeErrorMessage } from '../../utils/safe-error-message.js';
import logger from '../../utils/logger.js';

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
 * Toggles a directed link's visibility. hidden=true makes it disappear from the
 * read targets array (which filters hidden=false).
 * @param {string} uuid - source photo id
 * @param {string} targetId - destination photo id
 * @param {boolean} hidden
 * @param {Object} user
 * @returns {Promise<Object>} frozen photoMetadataShape for the SOURCE photo
 */
export async function updateTargetVisibility(uuid, targetId, hidden, user) {
  // Same L8 transaction envelope as updateCalibration (achado 68).
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
 *
 * The per-item `error` is SANITIZED. The response is a 200, so `sv360ErrorHandler`
 * never runs — the mask it applies to every other failure of this module (and the
 * reason it gives: "the driver message can name columns/constraints") simply did not
 * cover this array, and the overflow described just above was shipping the pg text
 * verbatim. `safeErrorMessage` keeps the `loadWritablePhoto` reasons (NotFound /
 * Forbidden, both `isOperational`) intact and collapses driver text to a fixed
 * sentence; the raw error goes to the log.
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
        logger.warn({ err, uuid }, 'sv360 batch-calibration item failed');
        failed.push({ uuid, error: safeErrorMessage(err, 'Update failed') });
      }
    }
  });

  return { updated, failed };
}

// --- batch by PROJECT / by RUN (stage 2b) ----------------------------------

// Loads the project row for a WRITE by slug and applies the ownership ladder.
//
// Resolution goes through the READ query GET_PROJECT_BY_SLUG on purpose: a slug is
// unique only per organization, and that query is the one place that resolves the
// collision deterministically (own org first, then enabled). Resolving it any other
// way would let a writer address another org's project by slug.
async function loadWritableProject(slug, user, executor = query) {
  // Os TRES parametros de escopo que `GET_PROJECT_BY_SLUG` passou a exigir na fase
  // F6 ([userId, orgId, atlasId]) — antes eram dois, e o primeiro era um booleano.
  // `atlasId` e NULL aqui de proposito: emprestimo de atlas amplia LEITURA, e este
  // e um caminho de ESCRITA, cuja escada de posse (`enforceProjectWritable`) nao
  // conhece nem deve conhecer esse eixo.
  const { rows } = await executor(Q.GET_PROJECT_BY_SLUG, [
    slug,
    principalUserId(user),
    user?.organization_id ?? null,
    null,
  ]);
  const project = rows[0];
  if (!project) throw new NotFoundError('Project');
  enforceProjectWritable(project, user, 'Project');
  return project;
}

/**
 * Builds ONE parametrized batch UPDATE over sv360.photos from the rotation
 * whitelist. Column names come ONLY from ROTATION_COLUMN_WHITELIST (never from
 * input keys); values bind as $2..$N and $1 is the scope id (project or run).
 *
 * `calibration_source = 'manual'` travels with every batch, as in the origin: a
 * value a human typed OVERRIDES whatever automatic origin ('sol', 'imu') the
 * photo carried, and the review interface uses exactly that column to know which
 * photos still have nothing checked against the world.
 * @param {'project'|'run'} scope - which WHERE clause to use
 * @param {string} scopeId - project id or run id (uuid)
 * @param {Object} values - already validated subset of the three angles
 * @returns {{sql: string, params: Array}|null} null when no field is present
 */
function buildBatchRotationUpdate(scope, scopeId, values) {
  const sets = [];
  const params = [scopeId];
  for (const [field, column] of Object.entries(WQ.ROTATION_COLUMN_WHITELIST)) {
    if (values[field] !== undefined) {
      params.push(values[field]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (sets.length === 0) return null;
  const sql = `
    UPDATE sv360.photos
       SET ${sets.join(', ')}, calibration_source = 'manual', updated_at = now()
     WHERE ${WQ.BATCH_ROTATION_SCOPE[scope]}
       AND id NOT IN (SELECT photo_id FROM sv360.deleted_photos)
  `;
  return { sql, params };
}

/**
 * Applies one rotation default to EVERY live photo of a project.
 *
 * One statement per axis would be up to three commits over the same rows; this is
 * one UPDATE inside one transaction, so the project never sits in a half-applied
 * state and the count reported is the count actually written.
 * @param {string} slug
 * @param {Object} values - validated subset of mesh_rotation_y/x/z
 * @param {Object} user
 * @returns {Promise<{ok: true, slug: string, updated: Object}>}
 * @throws {NotFoundError|ForbiddenError} via the ownership ladder
 */
export async function batchCalibrateProject(slug, values, user) {
  return tx(async (t) => {
    const project = await loadWritableProject(slug, user, txExecutor(t));
    const update = buildBatchRotationUpdate('project', project.id, values);
    const result = await t.result(update.sql, update.params);

    const updated = {};
    for (const field of Object.keys(WQ.ROTATION_COLUMN_WHITELIST)) {
      if (values[field] !== undefined) {
        updated[field] = { value: values[field], photosUpdated: result.rowCount };
      }
    }
    return { ok: true, slug: project.slug, updated };
  });
}

/**
 * Clears the review flag of every live photo of a project.
 * @param {string} slug
 * @param {Object} user
 * @returns {Promise<{ok: true, slug: string, photosReset: number}>}
 * @throws {NotFoundError|ForbiddenError} via the ownership ladder
 */
export async function resetProjectReviewed(slug, user) {
  return tx(async (t) => {
    const project = await loadWritableProject(slug, user, txExecutor(t));
    const result = await t.result(WQ.BATCH_RESET_REVIEWED, [project.id]);
    return { ok: true, slug: project.slug, photosReset: result.rowCount };
  });
}

/**
 * Applies one rotation default to EVERY live photo of a capture run.
 *
 * A run is a RECORDING SESSION, which is the granularity at which the camera
 * mounting does not change and therefore the granularity at which one calibration
 * value is right: measured in the origin's `faxinal`, the spread of
 * mesh_rotation_y INSIDE a run is 0,60 degree against 8,40 between run averages.
 * Applying to the whole project is therefore too coarse, off by around 20 degrees
 * at the far end.
 *
 * `applied_rotation_*` on the run is written as a RECORD of what was applied, so
 * the interface can label the run. It is not inheritance: the photo columns stay
 * the only truth, which is why they are written first and in the same transaction.
 *
 * A runId only resolves after scripts/sv360-derive-runs.js has run over the
 * project (`npm run sv360:derive-runs`). That derivation is an offline ETL and is
 * not part of ingestion, so a project it never touched has no rows in
 * sv360.capture_runs and every runId 404s. That is the honest answer for "this run
 * does not exist", and it is not a defect of this endpoint.
 * @param {string} runId
 * @param {Object} values - validated subset of mesh_rotation_y/x/z
 * @param {Object} user
 * @returns {Promise<{ok: true, runId: string, label: string, updated: Object}>}
 * @throws {NotFoundError|ForbiddenError} via the ownership ladder
 */
export async function batchCalibrateRun(runId, values, user) {
  return tx(async (t) => {
    const exec = txExecutor(t);
    const { rows } = await exec(WQ.GET_RUN_FOR_WRITE, [runId]);
    const run = rows[0];
    if (!run) throw new NotFoundError('Capture run');
    enforceProjectWritable(
      { status: run.project_status, organization_id: run.organization_id },
      user,
      'Capture run'
    );

    const update = buildBatchRotationUpdate('run', runId, values);
    const result = await t.result(update.sql, update.params);

    await t.none(WQ.UPDATE_RUN_APPLIED, [
      runId,
      values.mesh_rotation_y ?? null,
      values.mesh_rotation_x ?? null,
      values.mesh_rotation_z ?? null,
    ]);

    const updated = {};
    for (const field of Object.keys(WQ.ROTATION_COLUMN_WHITELIST)) {
      if (values[field] !== undefined) {
        updated[field] = { value: values[field], photosUpdated: result.rowCount };
      }
    }
    return { ok: true, runId, label: run.label, updated };
  });
}
