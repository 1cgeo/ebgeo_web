// Path: src/modules/sync/sync.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import { NotFoundError } from '../../utils/errors.js';
import * as syncService from './sync.service.js';
import { broadcastOperations } from '../collab/collab.rooms.js';

export const pushOperations = asyncHandler(async (req, res) => {
  const result = await syncService.pushOperations(
    req.atlasId,
    req.body.operations,
    req.user.id,
    req.atlasPermission
  );

  // Stamp each broadcast op with its server-assigned arrival order (serverVersion) so peers can
  // resolve concurrent edits by LWW-by-arrival in REAL TIME (convergence). The order lives in
  // result.results[].currentVersion, keyed by operationId. Without it the broadcast op carried
  // no order and concurrent same-feature edits diverged.
  const versionByOp = new Map((result.results || []).map((r) => [r.operationId, r.currentVersion]));

  // L3 — also stamp the entity id AS RECORDED. An atlas-level op arrives with the
  // non-UUID sentinel 'atlas' but is logged against the atlas's own UUID, so
  // broadcasting the raw op handed peers a different entityId than the one they
  // would later read via incremental pull — the same operation with two identities
  // depending on the arrival path. (The frontend routes settings ops by entityType
  // and ignores entityId, so this only makes the two paths agree.)
  const entityIdByOp = new Map((result.acks || []).map((a) => [a.opId, a.entityId]));
  const stamped = req.body.operations.map((op) => ({
    ...op,
    serverVersion: versionByOp.get(op.id) ?? result.serverVersion,
    ...(entityIdByOp.get(op.id) ? { entityId: entityIdByOp.get(op.id) } : {}),
  }));

  // Broadcast the pushed operations to WS peers for real-time updates. Comment ops are kept
  // away from read-only viewers (visibility rule); a mixed batch still reaches them minus the
  // comments. The HTTP sender has no socket, so it can't be excluded — clients ignore ops whose
  // clientId is their own (contract: fase-1/fase-8).
  broadcastOperations(req.atlasId, stamped, { userId: req.user.id });

  res.json({ data: result });
});

export const pullOperations = asyncHandler(async (req, res) => {
  const sinceVersion = parseInt(req.params.version, 10) || 0;
  const result = await syncService.pullOperations(req.atlasId, sinceVersion, req.atlasPermission);
  res.json({ data: result });
});

// Admin endpoints for cleanup management
export const getCleanupStats = asyncHandler(async (req, res) => {
  const atlasId = req.params.atlasId;
  const stats = await syncService.getCleanupStats(atlasId);
  // getCleanupStats returns null for a non-existent/deleted atlas — surface 404
  // instead of a silent 200 with data:null.
  if (!stats) {
    throw new NotFoundError('Atlas');
  }
  res.json({ data: stats });
});

export const cleanupOperations = asyncHandler(async (req, res) => {
  const atlasId = req.params.atlasId;
  const { keepFromVersion, keepDays } = req.body;
  const result = await syncService.cleanupOldOperations(atlasId, {
    keepFromVersion: keepFromVersion ? parseInt(keepFromVersion, 10) : undefined,
    keepDays: keepDays ? parseInt(keepDays, 10) : 7,
  });
  res.json({ data: result });
});
