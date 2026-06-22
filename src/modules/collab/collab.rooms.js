// Path: src/modules/collab/collab.rooms.js
// In-memory room management for WebSocket collaboration

const rooms = new Map(); // atlasId -> Set<WebSocket>

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
  if (!room) return;

  const payload = typeof message === 'string' ? message : JSON.stringify(message);

  for (const client of room) {
    if (client === excludeWs || client.readyState !== 1) continue; // WebSocket.OPEN = 1
    if (skipReadOnly && client.permission === 'read') continue;
    client.send(payload);
  }
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
  if (!room || !Array.isArray(ops) || ops.length === 0) return;

  const fullPayload = JSON.stringify({ type: 'operations', userId, ops });
  const nonComment = ops.filter((o) => o && (o.entityType || o.target) !== 'comment');
  const hasComment = nonComment.length !== ops.length;
  const readPayload = nonComment.length
    ? JSON.stringify({ type: 'operations', userId, ops: nonComment })
    : null;

  for (const client of room) {
    if (client === excludeWs || client.readyState !== 1) continue;
    if (!hasComment || client.permission !== 'read') {
      client.send(fullPayload);
    } else if (readPayload) {
      client.send(readPayload);
    }
    // read-only client + all-comment batch → nothing sent.
  }
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
