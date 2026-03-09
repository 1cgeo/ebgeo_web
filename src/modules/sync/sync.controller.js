// Path: src/modules/sync/sync.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as syncService from './sync.service.js';
import { broadcastToRoom } from '../collab/collab.rooms.js';

export const pushOperations = asyncHandler(async (req, res) => {
  const result = await syncService.pushOperations(
    req.atlasId,
    req.body.operations,
    req.user.id
  );

  // Broadcast to WS clients so they receive real-time updates
  // Use result.applied (the server-acknowledged ops) rather than raw input
  broadcastToRoom(req.atlasId, {
    type: 'operations',
    userId: req.user.id,
    ops: result.applied || req.body.operations,
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
