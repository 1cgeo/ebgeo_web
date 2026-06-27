// Path: src/modules/collab/collab.rooms.js
// In-memory room management for WebSocket collaboration

import { recordSpan, isTraceEnabled, TraceStage, TraceOutcome } from '../../utils/sync-trace.js';

const rooms = new Map(); // atlasId -> Set<WebSocket>

// Backpressure thresholds (bytes of un-drained outbound buffer per socket). One slow client must
// not back up the whole room. Coalescable presence frames (cursor/temporal/selection) are dropped
// to a backed-up client — the next frame supersedes them, so the drop self-heals. A socket past the
// hard ceiling is terminated so it reconnects and replays via sync_request; dropping a durable op
// would silently diverge that peer instead.
const COALESCABLE_TYPES = new Set(['cursor', 'temporal', 'selection']);
const BACKPRESSURE_DROP_BYTES = 1 << 20; // 1 MiB — drop coalescable presence frames
const BACKPRESSURE_KILL_BYTES = 8 << 20; // 8 MiB — terminate a hopelessly backed-up socket

/**
 * Adds a WebSocket to an atlas room.
 */
export function joinRoom(atlasId, ws) {
  if (!rooms.has(atlasId)) {
    rooms.set(atlasId, new Set());
  }
  rooms.get(atlasId).add(ws);
}

/**
 * Removes a WebSocket from an atlas room.
 */
export function leaveRoom(atlasId, ws) {
  const room = rooms.get(atlasId);
  if (room) {
    room.delete(ws);
    if (room.size === 0) {
      rooms.delete(atlasId);
    }
  }
}

/**
 * Gets all clients in a room.
 */
export function getRoomClients(atlasId) {
  return rooms.get(atlasId) || new Set();
}

/**
 * Broadcasts a message to all clients in a room, optionally excluding the sender. With
 * `opts.skipReadOnly`, read-only connections (Visualizador / public visitor) are skipped — used to
 * keep spatial-comment ops away from viewers (the comment visibility rule).
 * @param {string} atlasId
 * @param {Object|string} message
 * @param {import('ws').WebSocket|null} [excludeWs]
 * @param {{ skipReadOnly?: boolean }} [opts]
 */
export function broadcastToRoom(atlasId, message, excludeWs = null, { skipReadOnly = false } = {}) {
  const room = rooms.get(atlasId);
  if (!room) return { sent: 0, recipients: [] };

  const coalescable = typeof message === 'object' && message !== null && COALESCABLE_TYPES.has(message.type);
  const payload = typeof message === 'string' ? message : JSON.stringify(message);

  const recipients = [];
  for (const client of room) {
    if (client === excludeWs || client.readyState !== 1) continue; // WebSocket.OPEN = 1
    if (skipReadOnly && client.permission === 'read') continue;
    const buffered = client.bufferedAmount || 0;
    if (buffered > BACKPRESSURE_KILL_BYTES) { client.terminate?.(); continue; } // drowning → reconnect+replay
    if (coalescable && buffered > BACKPRESSURE_DROP_BYTES) continue; // superseded by the next frame
    client.send(payload);
    recipients.push(client.clientId || client.userId);
  }
  return { sent: recipients.length, recipients };
}

/**
 * Broadcasts an operations batch honoring the spatial-comment visibility rule: read-only
 * connections never receive `comment` ops. Non-comment ops go to everyone except the sender; a
 * MIXED batch is split so read clients still get the non-comment ops.
 * @param {string} atlasId
 * @param {Object[]} ops - The operation batch.
 * @param {{ userId?: string, excludeWs?: import('ws').WebSocket|null }} [opts]
 */
export function broadcastOperations(atlasId, ops, { userId, excludeWs = null } = {}) {
  const room = rooms.get(atlasId);
  if (!room || !Array.isArray(ops) || ops.length === 0) return { sent: 0, recipients: [] };

  const fullPayload = JSON.stringify({ type: 'operations', userId, ops });
  const nonComment = ops.filter((o) => o && (o.entityType || o.target) !== 'comment');
  const hasComment = nonComment.length !== ops.length;
  const readPayload = nonComment.length
    ? JSON.stringify({ type: 'operations', userId, ops: nonComment })
    : null;

  const recipients = [];
  let skippedSelf = 0;
  let skippedClosed = 0;
  let skippedReadOnly = 0;
  for (const client of room) {
    if (client === excludeWs) { skippedSelf++; continue; }
    if (client.readyState !== 1) { skippedClosed++; continue; }
    // Durable ops are never dropped; a hopelessly backed-up socket is terminated so it reconnects
    // and replays missed ops via sync_request (a silent drop would diverge it).
    if ((client.bufferedAmount || 0) > BACKPRESSURE_KILL_BYTES) { client.terminate?.(); skippedClosed++; continue; }
    if (!hasComment || client.permission !== 'read') {
      client.send(fullPayload);
      recipients.push(client.clientId || client.userId);
    } else if (readPayload) {
      client.send(readPayload);
      recipients.push(client.clientId || client.userId);
    } else {
      // read-only client + all-comment batch → nothing sent.
      skippedReadOnly++;
    }
  }

  const summary = { sent: recipients.length, recipients, skippedSelf, skippedClosed, skippedReadOnly };

  // SyncLedger: turn the historically fire-and-forget fan-out into an assertable span
  // (invariant I7 — who received an op, and why someone didn't).
  if (isTraceEnabled()) {
    for (const op of ops) {
      recordSpan(atlasId, TraceStage.SERVER_BROADCAST, {
        opId: op.id,
        traceId: op.traceId,
        entityType: op.entityType || op.target,
        sent: summary.sent,
        recipients: summary.recipients,
        skippedSelf,
        skippedClosed,
        skippedReadOnly,
        outcome: TraceOutcome.OK,
      });
    }
  }

  return summary;
}

/**
 * Broadcasts a message to all clients in a room, then closes all connections.
 * Used when an atlas is deleted to notify and disconnect all users.
 */
export function closeRoom(atlasId, message) {
  const room = rooms.get(atlasId);
  if (!room) return;

  const payload = typeof message === 'string' ? message : JSON.stringify(message);

  for (const client of room) {
    if (client.readyState === 1) {
      client.send(payload);
      client.close(4001, 'Atlas deleted');
    }
  }

  rooms.delete(atlasId);
}

/**
 * Gets user info for all connected clients in a room.
 */
export function getRoomUsers(atlasId) {
  const room = rooms.get(atlasId);
  if (!room) return [];

  const users = [];
  for (const client of room) {
    if (client.userId) {
      users.push({
        id: client.userId,
        nome: client.userName,
        posto_graduacao: client.userPosto,
        mapId: client.currentMapId,
        cursorPosition: client.cursorPosition,
        // B-be2: late-joiners get peers' current selection in the join snapshot.
        selectedFeatures: client.selectedFeatures,
        // Full selection context (surface 2d/3d/360 + scope) so a late-joiner can
        // render a peer's 3D/360 selection, not just the 2D featureIds.
        selectionContext: client.selectionContext,
        // Caso E: temporal-presence state mirrors the cursor (in-memory, per-ws).
        temporalState: client.temporalState,
        // Fase 8 (Tarefa 2): a client kept in the room during the away grace
        // window (abnormal close) is reported as `away`; live ones as `online`.
        status: client.away ? 'away' : 'online',
      });
    }
  }
  return users;
}

/**
 * Gets the number of clients in a room.
 */
export function getRoomSize(atlasId) {
  const room = rooms.get(atlasId);
  return room ? room.size : 0;
}
