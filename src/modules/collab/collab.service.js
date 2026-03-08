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

const UPDATE_SESSION_HEARTBEAT = `
  UPDATE active_sessions
  SET last_heartbeat = NOW()
  WHERE user_id = $1 AND atlas_id = $2 AND client_id = $3
`;

const UPDATE_SESSION_PRESENCE = `
  UPDATE active_sessions
  SET cursor_position = $4::jsonb,
      current_map_id = $5,
      selected_features = $6,
      last_heartbeat = NOW()
  WHERE user_id = $1 AND atlas_id = $2 AND client_id = $3
`;

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
 * Updates session heartbeat timestamp.
 */
export async function updateSessionHeartbeat(userId, atlasId, clientId) {
  try {
    await query(UPDATE_SESSION_HEARTBEAT, [userId, atlasId, clientId]);
  } catch (err) {
    logger.error({ err, userId, atlasId }, 'Failed to update session heartbeat');
  }
}

/**
 * Updates session presence data.
 */
export async function updateSessionPresence(userId, atlasId, clientId, presence) {
  try {
    await query(UPDATE_SESSION_PRESENCE, [
      userId,
      atlasId,
      clientId,
      presence.cursorPosition ? JSON.stringify(presence.cursorPosition) : null,
      presence.currentMapId || null,
      presence.selectedFeatures || [],
    ]);
  } catch (err) {
    logger.error({ err, userId, atlasId }, 'Failed to update session presence');
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
 * Gets online users for a room.
 */
export function getOnlineUsers(atlasId) {
  return getRoomUsers(atlasId);
}
