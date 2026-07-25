// Path: src/modules/collab/collab.service.js
// Presence and session management for WebSocket collaboration

import { broadcastToRoom, getRoomUsers } from './collab.rooms.js';

// PRESENCE IS ENTIRELY IN MEMORY. NOTHING HERE TOUCHES THE DATABASE.
//
// Two layers were peeled off this file, and the second one is the one worth remembering:
//
//  1. (B-be1) Cursor position, current map, selected features and temporal state live on the `ws`
//     object (collab.gateway.js / collab.handlers.js) and are broadcast to the room. Per-cursor DB
//     writes would be waste, so `updateSessionPresence`/`updateSessionHeartbeat` were removed.
//
//  2. (2026-07-25) `createSession`/`deleteSession`, the last two writers of `active_sessions`,
//     were removed as well — together with the INSERT/DELETE SQL and the `query` import. The
//     table had NO reader anywhere in `backend/src`, so the writes bought nothing while looking
//     like a durable session trail: fire-and-forget calls that could commit out of order and
//     orphan a row, no reaper, and a restart orphaning every live row in silence. The functions
//     are DELETED rather than kept exported-with-a-note, because an exported writer for a
//     write-only table is an invitation to call it, and a call site is exactly what turns the
//     illusion back on. The table itself is kept (forward-only migrations) and is RESERVED, with
//     no writer, by decision — see the note at the createSession call site in collab.gateway.js.
//
// If durable sessions are ever needed, the design starts with the READER.

/**
 * Broadcasts user joined event to the room.
 *
 * O `clientId` viaja em TODO frame de presença, e isso é contrato com o cliente,
 * não enfeite: o `resolveKey` do frontend
 * (`frontend/src/js/presence/presence-store.js:48-64`) PREFERE `clientId` sobre
 * `userId`. Enquanto só `user_away`/`user_back` o carregavam, a entrada do roster
 * era gravada sob a chave `userId` e o estado `away` chegava sob uma chave
 * DIFERENTE — o par ficava com duas entradas para a mesma pessoa e o "ausente"
 * nunca aparecia. Uma identidade por frame significa uma chave por frame.
 *
 * Também é a identidade mais correta: a mesma conta em duas abas são duas
 * presenças, com cursores independentes.
 */
export function broadcastUserJoined(atlasId, user, excludeWs, clientId = null) {
  broadcastToRoom(atlasId, {
    type: 'user_joined',
    clientId,
    user: {
      id: user.id,
      nome: user.nome,
      posto_graduacao: user.posto_graduacao,
      clientId,
    },
  }, excludeWs);
}

/**
 * Broadcasts user left event to the room.
 * Carrega `clientId` pelo mesmo motivo do `user_joined`: sair de UMA aba não
 * pode apagar do roster a presença da outra aba da mesma conta.
 */
export function broadcastUserLeft(atlasId, userId, clientId = null) {
  broadcastToRoom(atlasId, {
    type: 'user_left',
    userId,
    clientId,
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
