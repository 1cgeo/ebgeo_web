// Path: src/modules/collab/collab.handlers.js
// Individual message type handlers for WebSocket collaboration

import { broadcastToRoom, broadcastOperations } from './collab.rooms.js';
import * as syncService from '../sync/sync.service.js';
import { pushSchema } from '../sync/sync.schemas.js';
import { classifyConnectionQuality, adaptiveSettingsFor } from './collab.quality.js';
import logger from '../../utils/logger.js';

/**
 * Validates a batch of operations against the shared push schema.
 * The WS path does not go through the `validate` middleware, so we validate
 * here. Returns true if valid; otherwise sends an `error` message and returns false.
 */
function validateOps(ws, ops) {
  const { error } = pushSchema.validate({ operations: ops });
  if (error) {
    ws.send(JSON.stringify({
      type: 'error',
      code: 'VALIDATION_ERROR',
      message: error.message,
    }));
    return false;
  }
  return true;
}

/**
 * Handles ping messages (heartbeat).
 */
export function handlePing(ws) {
  ws.isAlive = true;
  ws.send(JSON.stringify({ type: 'pong' }));
}

/**
 * Handles cursor position updates.
 */
export function handleCursor(ws, data) {
  ws.cursorPosition = data.position;
  ws.currentMapId = data.mapId;

  broadcastToRoom(ws.atlasId, {
    type: 'cursor',
    userId: ws.userId,
    position: data.position,
    mapId: data.mapId,
  }, ws);
}

/**
 * Handles temporal-presence updates (caso E). Mirrors handleCursor: live state is
 * kept in-memory on the ws object and broadcast to peers (sender excluded).
 */
export function handleTemporal(ws, data) {
  ws.temporalState = data.state;
  if (data.mapId !== undefined) ws.currentMapId = data.mapId;

  broadcastToRoom(ws.atlasId, {
    type: 'temporal',
    userId: ws.userId,
    state: data.state,
    mapId: data.mapId,
  }, ws);
}

/**
 * Handles feature selection updates.
 */
export function handleSelection(ws, data) {
  ws.selectedFeatures = data.featureIds;

  broadcastToRoom(ws.atlasId, {
    type: 'selection',
    userId: ws.userId,
    featureIds: data.featureIds,
    mapId: data.mapId,
  }, ws);
}

/**
 * Handles a single operation.
 */
export async function handleOperation(ws, data) {
  // Check write permission
  if (ws.permission === 'read') {
    ws.send(JSON.stringify({
      type: 'error',
      code: 'FORBIDDEN',
      message: 'Read-only users cannot send operations',
    }));
    return;
  }

  if (!validateOps(ws, [data.op])) return;

  try {
    const result = await syncService.pushOperations(
      ws.atlasId,
      [data.op],
      ws.userId,
      ws.permission
    );

    // Send ack to sender (per-op result included for confident dequeue)
    ws.send(JSON.stringify({
      type: 'ack',
      opId: data.op.id,
      serverVersion: result.serverVersion,
      result: result.results[0],
    }));

    // Broadcast operation to peers. A comment op must NOT reach read-only viewers
    // (Visualizador / public visitor) — the spatial-comment visibility rule. Stamp the op with
    // its server arrival order (serverVersion) so peers converge by LWW-by-arrival.
    const isComment = (data.op?.entityType || data.op?.target) === 'comment';
    const opOut = { ...data.op, serverVersion: result.results?.[0]?.currentVersion ?? result.serverVersion };
    broadcastToRoom(ws.atlasId, {
      type: 'operation',
      userId: ws.userId,
      op: opOut,
    }, ws, { skipReadOnly: isComment });
  } catch (err) {
    logger.error({ err, atlasId: ws.atlasId }, 'Failed to process operation');
    ws.send(JSON.stringify({
      type: 'error',
      code: 'OPERATION_FAILED',
      message: err.message,
    }));
  }
}

/**
 * Handles a batch of operations.
 */
export async function handleOperations(ws, data) {
  if (ws.permission === 'read') {
    ws.send(JSON.stringify({
      type: 'error',
      code: 'FORBIDDEN',
      message: 'Read-only users cannot send operations',
    }));
    return;
  }

  if (!Array.isArray(data.ops) || !validateOps(ws, data.ops)) return;

  try {
    const result = await syncService.pushOperations(
      ws.atlasId,
      data.ops,
      ws.userId,
      ws.permission
    );

    // Send batch ack to sender (per-op results for confident dequeue)
    ws.send(JSON.stringify({
      type: 'ack_batch',
      opIds: data.ops.map((op) => op.id),
      serverVersion: result.serverVersion,
      results: result.results,
    }));

    // Broadcast all operations to peers. Comment ops are split out for read-only viewers
    // (a mixed batch still delivers the non-comment ops to them). Stamp each op with its server
    // arrival order (serverVersion) so peers converge by LWW-by-arrival.
    const versionByOp = new Map((result.results || []).map((r) => [r.operationId, r.currentVersion]));
    const opsOut = data.ops.map((op) => ({ ...op, serverVersion: versionByOp.get(op.id) ?? result.serverVersion }));
    broadcastOperations(ws.atlasId, opsOut, { userId: ws.userId, excludeWs: ws });
  } catch (err) {
    logger.error({ err, atlasId: ws.atlasId }, 'Failed to process operations batch');
    ws.send(JSON.stringify({
      type: 'error',
      code: 'OPERATION_FAILED',
      message: err.message,
    }));
  }
}

/**
 * Handles a client-reported connection quality sample (round-trip latency).
 * When the quality band changes, pushes `adaptive-settings` to that client so
 * it can adjust batch interval / geometry precision / viewport-only mode.
 */
export function handleConnectionQuality(ws, data) {
  const rtt = Number(data.rttMs);
  if (!Number.isFinite(rtt) || rtt < 0) return;

  const quality = classifyConnectionQuality(rtt);
  if (quality === ws.qualityClass) return; // only emit on change

  ws.qualityClass = quality;
  ws.rttMs = rtt;
  ws.send(JSON.stringify({
    type: 'adaptive-settings',
    quality,
    ...adaptiveSettingsFor(quality),
  }));
}

/**
 * Handles briefing edit start awareness.
 */
export function handleBriefingEditStart(ws, data) {
  broadcastToRoom(ws.atlasId, {
    type: 'briefing_edit_started',
    userId: ws.userId,
    userName: ws.userName,
    briefingId: data.briefingId,
  }, ws);
}

/**
 * Handles briefing edit end awareness.
 */
export function handleBriefingEditEnd(ws, data) {
  broadcastToRoom(ws.atlasId, {
    type: 'briefing_edit_ended',
    userId: ws.userId,
    userName: ws.userName,
    briefingId: data.briefingId,
  }, ws);
}

/**
 * Handles sync requests (pull operations since version).
 */
export async function handleSyncRequest(ws, data) {
  try {
    const result = await syncService.pullOperations(ws.atlasId, data.lastVersion || 0, ws.permission);

    if (result.isSnapshot) {
      ws.send(JSON.stringify({
        type: 'sync_response',
        isSnapshot: true,
        snapshot: result.snapshot,
        currentVersion: result.currentVersion,
      }));
    } else {
      ws.send(JSON.stringify({
        type: 'sync_response',
        isSnapshot: false,
        ops: result.operations,
        currentVersion: result.currentVersion,
      }));
    }
  } catch (err) {
    logger.error({ err, atlasId: ws.atlasId }, 'Failed to process sync request');
    ws.send(JSON.stringify({
      type: 'error',
      code: 'SYNC_FAILED',
      message: err.message,
    }));
  }
}
