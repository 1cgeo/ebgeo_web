// Path: src/modules/sync/sync.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import { NotFoundError } from '../../utils/errors.js';
import * as syncService from './sync.service.js';
import { broadcastToRoom } from '../collab/collab.rooms.js';

export const pushOperations = asyncHandler(async (req, res) => {
  const result = await syncService.pushOperations(
    req.atlasId,
    req.body.operations,
    req.user.id,
    req.atlasPermission
  );

  // Broadcast the pushed operations to WS peers for real-time updates.
  // The service returns { acks, serverVersion } (no `applied`); we broadcast the
  // normalized input. The HTTP sender has no socket, so it can't be excluded —
  // clients must ignore ops whose clientId is their own (contract: fase-1/fase-8).
  broadcastToRoom(req.atlasId, {
    type: 'operations',
    userId: req.user.id,
    ops: req.body.operations,
  });

  res.json({ data: result });
});

export const pullOperations = asyncHandler(async (req, res) => {
  const sinceVersion = parseInt(req.params.version, 10) || 0;
  const result = await syncService.pullOperations(req.atlasId, sinceVersion);
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
