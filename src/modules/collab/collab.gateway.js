// Path: src/modules/collab/collab.gateway.js
// WebSocket upgrade handler and message router

import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { query } from '../../database/index.js';
import { joinRoom, leaveRoom, getRoomUsers, broadcastToRoom } from './collab.rooms.js';
import * as collabService from './collab.service.js';
import * as handlers from './collab.handlers.js';

/**
 * Resolves atlas permission for a user.
 * For public tokens, validates that the token is for the requested atlas.
 */
async function resolvePermission(atlasId, userId, payload) {
  // Public token - validate atlas match and return read permission
  if (payload.isPublic) {
    if (payload.atlasId !== atlasId) {
      return null; // Token was issued for a different atlas
    }
    // Verify atlas still exists and is public
    const atlasResult = await query(
      'SELECT is_public FROM atlas WHERE id = $1 AND deleted_at IS NULL',
      [atlasId]
    );
    if (atlasResult.rows.length === 0 || !atlasResult.rows[0].is_public) {
      return null;
    }
    return 'read';
  }

  // Regular user - existing logic
  const atlasResult = await query(
    'SELECT owner_id, is_public FROM atlas WHERE id = $1 AND deleted_at IS NULL',
    [atlasId]
  );

  if (atlasResult.rows.length === 0) {
    return null;
  }

  const atlas = atlasResult.rows[0];

  // Owner check
  if (userId === atlas.owner_id) {
    return 'owner';
  }

  // Share check
  const shareResult = await query(
    'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
    [atlasId, userId]
  );

  if (shareResult.rows.length > 0) {
    return shareResult.rows[0].permission;
  }

  // Public check
  if (atlas.is_public) {
    return 'read';
  }

  return null;
}

/**
 * Attaches WebSocket handling to the HTTP server.
 */
export function attachWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  // Handle HTTP upgrade requests
  server.on('upgrade', async (request, socket, head) => {
    try {
      // Parse URL
      const url = new URL(request.url, `http://${request.headers.host}`);
      const atlasId = url.searchParams.get('atlasId');
      const token = url.searchParams.get('token');

      if (!atlasId || !token) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      // Verify JWT
      let payload;
      try {
        payload = jwt.verify(token, config.jwt.secret);
      } catch (err) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const userId = payload.sub;
      const isPublicUser = payload.isPublic === true;

      // Resolve permission
      const permission = await resolvePermission(atlasId, userId, payload);
      if (!permission) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      // Complete upgrade
      wss.handleUpgrade(request, socket, head, (ws) => {
        onConnection(ws, {
          id: userId,
          username: isPublicUser ? 'visitante' : payload.username,
          nome: isPublicUser ? 'Visitante' : payload.nome,
          posto_graduacao: isPublicUser ? null : payload.posto,
          isPublic: isPublicUser,
        }, atlasId, permission);
      });
    } catch (err) {
      logger.error({ err }, 'WebSocket upgrade error');
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });

  // Heartbeat interval
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        logger.debug({ userId: ws.userId, atlasId: ws.atlasId }, 'Terminating inactive WebSocket');
        return ws.terminate();
      }
      ws.isAlive = false;
    });
  }, config.ws.heartbeatIntervalMs);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });
}

/**
 * Handles a new WebSocket connection.
 */
function onConnection(ws, user, atlasId, permission) {
  const clientId = crypto.randomUUID();

  // Attach user info to WebSocket
  ws.userId = user.id;
  ws.userName = user.nome;
  ws.userPosto = user.posto_graduacao;
  ws.atlasId = atlasId;
  ws.permission = permission;
  ws.clientId = clientId;
  ws.isAlive = true;
  ws.isPublic = user.isPublic || false;
  ws.cursorPosition = null;
  ws.currentMapId = null;
  ws.selectedFeatures = [];

  // Create session
  collabService.createSession(user.id, atlasId, clientId);

  // Join room
  joinRoom(atlasId, ws);

  // Get current users
  const usersOnline = getRoomUsers(atlasId);

  // Send connected message
  ws.send(JSON.stringify({
    type: 'connected',
    sessionId: clientId,
    userId: user.id,
    permission,
    usersOnline,
  }));

  // Broadcast user joined to others
  collabService.broadcastUserJoined(atlasId, user, ws);

  logger.info({ userId: user.id, atlasId, permission }, 'WebSocket connected');

  // Set up message handler
  ws.on('message', (rawData) => {
    try {
      const data = JSON.parse(rawData.toString());
      handleMessage(ws, data);
    } catch (err) {
      logger.error({ err, userId: ws.userId }, 'Failed to parse WebSocket message');
    }
  });

  // Set up close handler
  ws.on('close', () => {
    onClose(ws);
  });

  // Set up error handler
  ws.on('error', (err) => {
    logger.error({ err, userId: ws.userId, atlasId: ws.atlasId }, 'WebSocket error');
  });
}

/**
 * Routes incoming messages to appropriate handlers.
 */
function handleMessage(ws, data) {
  switch (data.type) {
    case 'ping':
      handlers.handlePing(ws);
      break;

    case 'cursor':
      handlers.handleCursor(ws, data);
      break;

    case 'selection':
      handlers.handleSelection(ws, data);
      break;

    case 'operation':
      handlers.handleOperation(ws, data);
      break;

    case 'operations':
      handlers.handleOperations(ws, data);
      break;

    case 'sync_request':
      handlers.handleSyncRequest(ws, data);
      break;

    default:
      logger.warn({ type: data.type, userId: ws.userId }, 'Unknown message type');
  }
}

/**
 * Handles WebSocket close event.
 */
function onClose(ws) {
  logger.info({ userId: ws.userId, atlasId: ws.atlasId }, 'WebSocket disconnected');

  // Leave room
  leaveRoom(ws.atlasId, ws);

  // Delete session
  collabService.deleteSession(ws.userId, ws.atlasId, ws.clientId);

  // Broadcast user left
  collabService.broadcastUserLeft(ws.atlasId, ws.userId);
}
