// Path: src/modules/collab/collab.gateway.js
// WebSocket upgrade handler and message router

import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { query } from '../../database/index.js';
import { orgIsActive } from '../../utils/org-status.js';
import { joinRoom, leaveRoom, getRoomUsers } from './collab.rooms.js';
import { toFrontendRole } from '../../utils/roles.js';
import * as collabService from './collab.service.js';
import * as handlers from './collab.handlers.js';

// The only path this WebSocket gateway serves (matches the documented contract).
const COLLAB_WS_PATH = '/api/v1/collab';

// Accepted shape of a client-provided clientId (UUID v4 or nanoid-style).
const CLIENT_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

// WebSocket close code for an abnormal closure (no close frame): network drop
// or `terminate()`. Anything else (1000/1005/1001/4001…) is a clean/intentional
// close and removes the user immediately.
const ABNORMAL_CLOSE = 1006;

// Fase 8 (Tarefa 2): pending away-removal timers keyed by `${atlasId}::${clientId}`.
// On an abnormal close the user is kept in the room as `away` and removed after
// the grace window; a reconnect with the same clientId cancels the timer.
const awayTimers = new Map();

// Grace window before an `away` user is actually removed. Configurable for tests.
let awayGraceMs = config.ws.awayGraceMs;

/** Test/ops hook to shorten (or lengthen) the away grace window. */
export function setAwayGraceMs(ms) {
  awayGraceMs = ms;
}

function awayKey(atlasId, clientId) {
  return `${atlasId}::${clientId}`;
}

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
 * W1 + O1: re-reconciles a LIVE socket's authorization against the DB. Called on
 * every heartbeat tick (and unit-testable directly). A revoked share / unpublished
 * atlas / deactivated org closes the socket with code 4003 (a clean close → the peer
 * is removed immediately, not kept `away`). A downgrade (write→read) just lowers
 * ws.permission so the next write is rejected by the handlers.
 * @param {import('ws').WebSocket} ws - a connected socket (ws.atlasId/userId/permission/...).
 */
export async function reconcileAuthorization(ws) {
  try {
    if (!ws.isPublic && ws.organizationId && !(await orgIsActive(ws.organizationId))) {
      ws.close(4003, 'organization deactivated');
      return;
    }
    const current = await resolvePermission(ws.atlasId, ws.userId, {
      isPublic: ws.isPublic,
      atlasId: ws.atlasId,
    });
    if (!current) {
      ws.close(4003, 'access revoked');
      return;
    }
    if (current !== ws.permission) {
      logger.info(
        { userId: ws.userId, atlasId: ws.atlasId, from: ws.permission, to: current },
        'WS permission re-resolved on heartbeat'
      );
      ws.permission = current;
    }
  } catch (err) {
    logger.error({ err, userId: ws.userId, atlasId: ws.atlasId }, 'WS authorization re-resolution failed');
  }
}

/**
 * One heartbeat sweep over all sockets: terminate a socket that has not ponged
 * since the previous sweep (isAlive=false → network-drop close 1006 → `away`),
 * otherwise flip isAlive=false (a client `ping` re-arms it via handlePing) and
 * re-reconcile live authorization (W1/O1). Exported so tests can drive the reap
 * deterministically instead of waiting the 30s interval.
 * @param {import('ws').WebSocketServer} wss
 */
export function heartbeatSweep(wss) {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      logger.debug({ userId: ws.userId, atlasId: ws.atlasId }, 'Terminating inactive WebSocket');
      return ws.terminate();
    }
    ws.isAlive = false;
    reconcileAuthorization(ws);
  });
}

/**
 * Attaches WebSocket handling to the HTTP server. Returns the WebSocketServer
 * (used by tests to drive heartbeatSweep / inspect clients).
 */
export function attachWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  // Handle HTTP upgrade requests
  server.on('upgrade', async (request, socket, head) => {
    try {
      // Parse URL
      const url = new URL(request.url, `http://${request.headers.host}`);

      // Only the collab channel is served here; reject upgrades to any other path
      // so this handler never hijacks a future WS endpoint on the same server.
      if (url.pathname !== COLLAB_WS_PATH) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      const atlasId = url.searchParams.get('atlasId');
      const token = url.searchParams.get('token');
      // Stable clientId across reconnects (idempotency + presence). Validate the
      // format (UUID v4 / nanoid-ish); an absent OR malformed value falls back to
      // a server-generated one (preserves back-compat, avoids log/presence noise).
      // It is only a presence/idempotency key — never a credential (auth is the JWT).
      const rawClientId = url.searchParams.get('clientId');
      const clientId = (rawClientId && CLIENT_ID_RE.test(rawClientId)) ? rawClientId : null;

      if (!atlasId || !token) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      // Verify JWT (algorithm allowlist — reject `none`/asymmetric forgery)
      let payload;
      try {
        payload = jwt.verify(token, config.jwt.secret, { algorithms: config.jwt.algorithms });
      } catch (err) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const userId = payload.sub;
      const isPublicUser = payload.isPublic === true;

      // O1: a member of a deactivated organization cannot open a collab socket.
      if (!isPublicUser && payload.organization_id && !(await orgIsActive(payload.organization_id))) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

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
          role: isPublicUser ? 'user' : (payload.role || 'user'),
          organization_id: isPublicUser ? null : (payload.organization_id ?? null),
          isPublic: isPublicUser,
        }, atlasId, permission, clientId);
      });
    } catch (err) {
      logger.error({ err }, 'WebSocket upgrade error');
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });

  // Heartbeat interval — also the hook for W1/O1: a WS connection caches its
  // permission at handshake and lives for hours, so each tick re-reconciles live
  // authorization (share downgrade/revoke, atlas unpublished, org deactivated)
  // against the DB. Staleness is thus bounded to one heartbeat interval (~30s).
  const heartbeatInterval = setInterval(() => heartbeatSweep(wss), config.ws.heartbeatIntervalMs);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return wss;
}

/**
 * Handles a new WebSocket connection.
 */
function onConnection(ws, user, atlasId, permission, providedClientId = null) {
  // Use the client-provided stable id when present; otherwise generate one.
  const clientId = providedClientId || crypto.randomUUID();

  // Reconnect within the away grace window: cancel the pending removal and drop
  // the stale (closed) socket from the room so presence is not duplicated.
  const pending = awayTimers.get(awayKey(atlasId, clientId));
  if (pending) {
    clearTimeout(pending.timer);
    awayTimers.delete(awayKey(atlasId, clientId));
    leaveRoom(atlasId, pending.ws);
    collabService.broadcastUserBack(atlasId, user.id, clientId);
  }

  // Attach user info to WebSocket
  ws.userId = user.id;
  ws.userName = user.nome;
  ws.userPosto = user.posto_graduacao;
  ws.atlasId = atlasId;
  ws.permission = permission;
  ws.clientId = clientId;
  ws.isAlive = true;
  ws.isPublic = user.isPublic || false;
  ws.organizationId = user.organization_id || null;
  ws.cursorPosition = null;
  ws.currentMapId = null;
  ws.selectedFeatures = [];

  // Create session (skip for public visitors: their `sub` is `public-<uuid>`,
  // which has no row in `users` and would break the active_sessions FK).
  if (!ws.isPublic) {
    collabService.createSession(user.id, atlasId, clientId);
  }

  // Join room
  joinRoom(atlasId, ws);

  // Get current users
  const usersOnline = getRoomUsers(atlasId);

  // Send connected message. `permission` (owner/write/read) is the frozen field;
  // `role` exposes the frontend vocabulary (owner/editor/viewer/admin).
  ws.send(JSON.stringify({
    type: 'connected',
    sessionId: clientId,
    userId: user.id,
    permission,
    role: toFrontendRole(permission, user.role),
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

  // Set up close handler (the close code distinguishes a clean leave from a
  // network drop — see onClose).
  ws.on('close', (code) => {
    onClose(ws, code);
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

    case 'connection-quality':
      handlers.handleConnectionQuality(ws, data);
      break;

    case 'leave':
      // Explicit intentional leave: flag it and close cleanly so onClose removes
      // the user immediately (no away grace).
      ws.intentionalLeave = true;
      ws.close(1000, 'leave');
      break;

    case 'briefing_edit_start':
      handlers.handleBriefingEditStart(ws, data);
      break;

    case 'briefing_edit_end':
      handlers.handleBriefingEditEnd(ws, data);
      break;

    default:
      logger.warn({ type: data.type, userId: ws.userId }, 'Unknown message type');
  }
}

/**
 * Removes a connection from the room and presence for good (room + session +
 * peer notification). Shared by the intentional-close path and the away timeout.
 */
function removeConnection(ws) {
  leaveRoom(ws.atlasId, ws);
  if (!ws.isPublic) {
    collabService.deleteSession(ws.userId, ws.atlasId, ws.clientId);
  }
  collabService.broadcastUserLeft(ws.atlasId, ws.userId);
}

/**
 * Handles WebSocket close event.
 *
 * A clean/intentional close (any code other than 1006, or an explicit `leave`)
 * removes the user immediately. An abnormal close (1006 — network drop or
 * heartbeat `terminate()`) marks the user `away` and keeps the session for a
 * grace window so a reconnect with the same clientId can resume it without the
 * user "blinking" out of the presence list.
 */
function onClose(ws, code) {
  const networkDrop = code === ABNORMAL_CLOSE && ws.intentionalLeave !== true;
  logger.info({ userId: ws.userId, atlasId: ws.atlasId, code, networkDrop }, 'WebSocket disconnected');

  if (!networkDrop) {
    // Defensive: clear any stale away timer for this client before removing.
    const key = awayKey(ws.atlasId, ws.clientId);
    const pending = awayTimers.get(key);
    if (pending) {
      clearTimeout(pending.timer);
      awayTimers.delete(key);
    }
    removeConnection(ws);
    return;
  }

  // Network drop: keep the (now-closed) socket in the room marked `away` so
  // presence still lists it, broadcast `user_away`, and schedule removal.
  ws.away = true;
  collabService.broadcastUserAway(ws.atlasId, ws.userId, ws.clientId);

  const key = awayKey(ws.atlasId, ws.clientId);
  const existing = awayTimers.get(key);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    awayTimers.delete(key);
    removeConnection(ws);
  }, awayGraceMs);
  if (typeof timer.unref === 'function') timer.unref();
  awayTimers.set(key, { ws, timer });
}
