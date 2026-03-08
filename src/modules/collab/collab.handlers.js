// Path: src/modules/collab/collab.handlers.js
// Individual message type handlers for WebSocket collaboration

import { broadcastToRoom } from './collab.rooms.js';
import * as syncService from '../sync/sync.service.js';
import logger from '../../utils/logger.js';

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

  try {
    const result = await syncService.pushOperations(
      ws.atlasId,
      [data.op],
      ws.userId
    );

    // Send ack to sender
    ws.send(JSON.stringify({
      type: 'ack',
      opId: data.op.id,
      serverVersion: result.serverVersion,
    }));

    // Broadcast operation to peers
    broadcastToRoom(ws.atlasId, {
      type: 'operation',
      userId: ws.userId,
      op: data.op,
    }, ws);
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

  try {
    const result = await syncService.pushOperations(
      ws.atlasId,
      data.ops,
      ws.userId
    );

    // Send batch ack to sender
    ws.send(JSON.stringify({
      type: 'ack_batch',
      opIds: data.ops.map(op => op.id),
      serverVersion: result.serverVersion,
    }));

    // Broadcast operations to peers
    for (const op of data.ops) {
      broadcastToRoom(ws.atlasId, {
        type: 'operation',
        userId: ws.userId,
        op,
      }, ws);
    }
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
 * Handles sync requests (pull operations since version).
 */
export async function handleSyncRequest(ws, data) {
  try {
    const result = await syncService.pullOperations(ws.atlasId, data.lastVersion || 0);

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
