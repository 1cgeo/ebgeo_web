// Path: src/modules/collab/collab.service.js
// Presence and session management for WebSocket collaboration

import { query } from '../../database/index.js';
import { broadcastToRoom, getRoomUsers } from './collab.rooms.js';
import logger from '../../utils/logger.js';

const INSERT_SESSION = `
  INSERT INTO active_sessions (user_id, atlas_id, client_id)
  VALUES ($1, $2, $3)
  ON CONFLICT (user_id, atlas_id, client_id) DO UPDATE SET connected_at = NOW(), last_heartbeat = NOW()
  RETURNING id
`;

const DELETE_SESSION = `
  DELETE FROM active_sessions
  WHERE user_id = $1 AND atlas_id = $2 AND client_id = $3
`;

// NOTE (B-be1): live presence is NOT persisted. Cursor position, current map,
// selected features and temporal state are held in-memory on the `ws` object
// (see collab.gateway.js / collab.handlers.js: ws.cursorPosition / ws.currentMapId /
// ws.selectedFeatures / ws.temporalState) and broadcast to the room. Per-cursor DB
// writes would be wasteful, so the old updateSessionPresence/updateSessionHeartbeat
// helpers were removed. `active_sessions` only tracks connect/disconnect.

/**
 * Creates a session record for a WebSocket connection.
 */
export async function createSession(userId, atlasId, clientId) {
  try {
    const { rows } = await query(INSERT_SESSION, [userId, atlasId, clientId]);
    return rows[0].id;
  } catch (err) {
    logger.error({ err, userId, atlasId }, 'Failed to create session');
    return null;
  }
}

/**
 * Deletes a session record.
 */
export async function deleteSession(userId, atlasId, clientId) {
  try {
    await query(DELETE_SESSION, [userId, atlasId, clientId]);
  } catch (err) {
    logger.error({ err, userId, atlasId }, 'Failed to delete session');
  }
}

/**
 * Broadcasts user joined event to the room.
 */
export function broadcastUserJoined(atlasId, user, excludeWs) {
  broadcastToRoom(atlasId, {
    type: 'user_joined',
    user: {
      id: user.id,
      nome: user.nome,
      posto_graduacao: user.posto_graduacao,
    },
  }, excludeWs);
}

/**
 * Broadcasts user left event to the room.
 */
export function broadcastUserLeft(atlasId, userId) {
  broadcastToRoom(atlasId, {
    type: 'user_left',
    userId,
  });
}

/**
 * Broadcasts that a user dropped abnormally and is `away` (still in the
 * presence list, within the grace window) — peers should not remove them yet.
 */
export function broadcastUserAway(atlasId, userId, clientId) {
  broadcastToRoom(atlasId, {
    type: 'user_away',
    userId,
    clientId,
  });
}

/**
 * Broadcasts that an `away` user reconnected within the grace window — peers
 * should clear the `away` state for this client.
 */
export function broadcastUserBack(atlasId, userId, clientId) {
  broadcastToRoom(atlasId, {
    type: 'user_back',
    userId,
    clientId,
  });
}

/**
 * Gets online users for a room.
 */
export function getOnlineUsers(atlasId) {
  return getRoomUsers(atlasId);
}
