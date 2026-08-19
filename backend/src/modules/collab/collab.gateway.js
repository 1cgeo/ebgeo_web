// Path: src/modules/collab/collab.gateway.js
// WebSocket upgrade handler and message router

import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { query } from '../../database/index.js';
import { orgIsActive, getLiveAuthState, tokenPredatesSessionCut } from '../../utils/org-status.js';
import { joinRoom, leaveRoom, getRoomUsers, getRoomClients } from './collab.rooms.js';
import { toFrontendRole } from '../../utils/roles.js';
import * as collabService from './collab.service.js';
import * as handlers from './collab.handlers.js';
import { installOutboundResourcePrune } from './collab.send.js';

// The only path this WebSocket gateway serves (matches the documented contract).
const COLLAB_WS_PATH = '/api/v1/collab';

// Accepted shape of a client-provided clientId (UUID v4 or nanoid-style).
const CLIENT_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

// WebSocket close code for an abnormal closure (no close frame): network drop
// or `terminate()`. Anything else (1000/1005/1001/4001…) is a clean/intentional
// close and removes the user immediately.
const ABNORMAL_CLOSE = 1006;

// Largest collab frame accepted, matching the HTTP JSON body limit (10 MB). See
// the maxPayload note in attachWebSocket.
const COLLAB_MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;

// Fase 8 (Tarefa 2): pending away-removal timers keyed by `${atlasId}::${userId}::${clientId}`.
// On an abnormal close the user is kept in the room as `away` and removed after
// the grace window; a reconnect with the same clientId cancels the timer.
const awayTimers = new Map();

// Grace window before an `away` user is actually removed. Configurable for tests.
let awayGraceMs = config.ws.awayGraceMs;

/** Test/ops hook to shorten (or lengthen) the away grace window. */
export function setAwayGraceMs(ms) {
  awayGraceMs = ms;
}

/**
 * Identity of a suspended (away) presence slot.
 *
 * `userId` is part of the key, and it is not decoration: the `clientId` comes from the browser
 * profile's localStorage, so two people sharing a machine (or one machine with two accounts) send
 * the SAME `clientId`. Keyed by `atlasId::clientId` alone, B's reconnect inside A's 120 s grace
 * hijacked A's slot — it cancelled A's removal timer, dropped A's dead socket from the room
 * WITHOUT announcing `user_left`, and broadcast `user_back` carrying B's userId. The peers were
 * left listing A forever (nothing would ever announce the departure again, since the timer was
 * gone) and were told a user who had never been away was back. A presence slot belongs to a
 * (user, client) pair, so the key has to say both.
 */
function awayKey(atlasId, userId, clientId) {
  return `${atlasId}::${userId}::${clientId}`;
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

  // Global admins have full (owner-level) access to every atlas so they can
  // support/debug and manage any user's project.
  if (payload.role === 'admin') {
    return 'owner';
  }

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

// How many CONSECUTIVE reconciliation failures a socket may accumulate before it is closed.
//
// The asymmetry is the whole point. Tolerating one failure keeps a transient database blip from
// mass-disconnecting every collaborator (the sweep touches all sockets at once, so a 200 ms
// outage would otherwise be a fleet-wide logout). Not tolerating an UNBOUNDED number keeps the
// socket from living on cached permission forever: while reconciliation throws, `ws.permission`
// is whatever the handshake resolved, so a revoked share stays effective. Three ticks at the
// 30 s heartbeat bounds the staleness at ~90 s instead of "until the client leaves".
const AUTHZ_MAX_CONSECUTIVE_FAILURES = 3;

// Reconciliations in flight at once during a sweep. The sweep used to fire `reconcileAuthorization`
// for every socket without `await`, so N sockets meant N simultaneous queries against a pool of
// ten: the sweep could starve the pool it shares with every request handler, and — worse for the
// guarantee it exists to provide — a sweep still draining when the next one started meant a
// revocation took two ticks (~60 s) to land instead of the ~30 s the contract promises.
const AUTHZ_SWEEP_CONCURRENCY = 4;

/**
 * W1 + O1: re-reconciles a LIVE socket's authorization against the DB. Called on
 * every heartbeat tick (and unit-testable directly). A revoked share / unpublished
 * atlas / deactivated org closes the socket with code 4003 (a clean close → the peer
 * is removed immediately, not kept `away`). A downgrade (write→read) just lowers
 * ws.permission so the next write is rejected by the handlers.
 *
 * A FAILED reconciliation (database unreachable, query error) is counted, not swallowed: see
 * AUTHZ_MAX_CONSECUTIVE_FAILURES. The counter resets on the first tick that completes, so only a
 * sustained inability to verify authorization closes the socket.
 * @param {import('ws').WebSocket} ws - a connected socket (ws.atlasId/userId/permission/...).
 */
export async function reconcileAuthorization(ws) {
  try {
    // A conta em si (não só a org). O gate P1 vivia apenas no `auth` estrito do
    // HTTP, então um socket JÁ ABERTO sobrevivia à desativação do usuário
    // indefinidamente: `deleteUser` revoga só o refresh token, e o sweep nunca
    // reexaminava `users.is_active`. O papel global também vem daqui — um admin
    // rebaixado mantinha acesso owner a todo atlas via `resolvePermission`.
    if (!ws.isPublic) {
      const live = await getLiveAuthState(ws.userId);
      if (live) {
        if (!live.userIsActive) {
          ws.close(4003, 'account deactivated');
          return;
        }
        if (!live.orgIsActive) {
          ws.close(4003, 'organization deactivated');
          return;
        }
        // Adota o papel VIVO antes de resolver a permissão.
        ws.userRole = live.role;
      } else if (ws.organizationId && !(await orgIsActive(ws.organizationId))) {
        // Sem linha em `users` (princípio sintético): cai no gate org-only.
        ws.close(4003, 'organization deactivated');
        return;
      }
    }
    const current = await resolvePermission(ws.atlasId, ws.userId, {
      isPublic: ws.isPublic,
      atlasId: ws.atlasId,
      role: ws.userRole,
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
    // Verified: the socket's cached permission is known-good again.
    ws.authzFailures = 0;
  } catch (err) {
    ws.authzFailures = (ws.authzFailures || 0) + 1;
    logger.error(
      { err, userId: ws.userId, atlasId: ws.atlasId, failures: ws.authzFailures },
      'WS authorization re-resolution failed'
    );
    if (ws.authzFailures >= AUTHZ_MAX_CONSECUTIVE_FAILURES) {
      logger.warn(
        { userId: ws.userId, atlasId: ws.atlasId, failures: ws.authzFailures },
        'WS closed: authorization unverifiable for too many consecutive heartbeats'
      );
      ws.close(4003, 'authorization unverifiable');
    }
  }
}

/**
 * One heartbeat sweep over all sockets: terminate a socket that has not ponged
 * since the previous sweep (isAlive=false → network-drop close 1006 → `away`),
 * otherwise flip isAlive=false (a client `ping` re-arms it via handlePing) and
 * re-reconcile live authorization (W1/O1). Exported so tests can drive the reap
 * deterministically instead of waiting the 30s interval.
 *
 * Returns a promise that settles when EVERY reconciliation of this tick has finished, and runs
 * them through a bounded worker pool (AUTHZ_SWEEP_CONCURRENCY). The reap itself stays synchronous
 * so an existing caller that ignores the promise still gets the terminate() behaviour it had.
 * @param {import('ws').WebSocketServer} wss
 * @returns {Promise<void>}
 */
export async function heartbeatSweep(wss) {
  const live = [];
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      logger.debug({ userId: ws.userId, atlasId: ws.atlasId }, 'Terminating inactive WebSocket');
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    live.push(ws);
  });

  let next = 0;
  const worker = async () => {
    while (next < live.length) {
      const ws = live[next];
      next += 1;
      // reconcileAuthorization never rejects (it owns its try/catch), so one bad socket cannot
      // abandon the rest of the sweep.
      await reconcileAuthorization(ws);
    }
  };
  const workers = Math.min(AUTHZ_SWEEP_CONCURRENCY, live.length);
  await Promise.all(Array.from({ length: workers }, worker));
}

// The WebSocketServer created by the most recent attachWebSocket() call. Held so
// `closeAllSockets()` can reach it during shutdown (P4).
let activeWss = null;

/**
 * Closes every collab socket and the WebSocketServer itself, so a pending
 * `server.close()` can finish. WS close code 1001 ("going away") tells clients
 * this is a server shutdown and they should reconnect later, not an error.
 *
 * Safe to call when no server was ever attached, and idempotent.
 * @returns {Promise<void>} resolves once the WebSocketServer is closed.
 */
export function closeAllSockets() {
  const wss = activeWss;
  if (!wss) return Promise.resolve();
  activeWss = null;

  for (const client of wss.clients) {
    try {
      client.close(1001, 'Server shutting down');
    } catch {
      // Already closing/closed — nothing to do.
    }
  }

  return new Promise((resolve) => wss.close(() => resolve()));
}

/**
 * Attaches WebSocket handling to the HTTP server. Returns the WebSocketServer
 * (used by tests to drive heartbeatSweep / inspect clients).
 */
export function attachWebSocket(server) {
  // L2 — bound the frame size. `ws` defaults to 100 MiB, so an unauthenticated-
  // sized frame 10× larger than the HTTP body limit was buffered in memory BEFORE
  // any validation ran. Collab frames are ops/cursor/selection JSON, so the HTTP
  // json limit is a generous ceiling; a client that exceeds it is closed with 1009
  // (message too big) by `ws` itself.
  const wss = new WebSocketServer({ noServer: true, maxPayload: COLLAB_MAX_PAYLOAD_BYTES });

  // P4 — expose the live server so a graceful shutdown can close the collab
  // sockets. Without this, `server.close()` waits forever on a long-lived
  // WebSocket (they are open by design) and its callback never fires.
  activeWss = wss;

  // Handle HTTP upgrade requests
  server.on('upgrade', async (request, socket, head) => {
    // Node removes ITS OWN 'error' listener from the socket before emitting 'upgrade'
    // (_http_server.js), and everything below awaits the database before reaching
    // handleUpgrade. Without a listener of our own, a client RST inside that window
    // emits 'error' on a listener-less EventEmitter, which Node throws as an uncaught
    // exception and kills the process; the try/catch below cannot catch it because the
    // emission is asynchronous. This is the step the `ws` README prescribes for exactly
    // this reason. See tests/ws/collab-upgrade-crash.repro.test.js.
    const onSocketError = (err) => {
      logger.debug({ err }, 'collab upgrade: socket error before handshake (client went away)');
    };
    socket.on('error', onSocketError);

    // Never write to a socket the peer already tore down: that would emit a second
    // error (ERR_STREAM_DESTROYED) from inside the rejection path itself.
    const reject = (statusLine) => {
      if (!socket.destroyed && socket.writable) {
        socket.write(`HTTP/1.1 ${statusLine}\r\n\r\n`);
      }
      socket.destroy();
    };

    try {
      // Parse URL
      const url = new URL(request.url, `http://${request.headers.host}`);

      // Only the collab channel is served here; reject upgrades to any other path
      // so this handler never hijacks a future WS endpoint on the same server.
      if (url.pathname !== COLLAB_WS_PATH) {
        reject('404 Not Found');
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
        reject('400 Bad Request');
        return;
      }

      // Verify JWT (algorithm allowlist — reject `none`/asymmetric forgery)
      let payload;
      try {
        payload = jwt.verify(token, config.jwt.secret, { algorithms: config.jwt.algorithms });
      } catch (err) {
        reject('401 Unauthorized');
        return;
      }

      const userId = payload.sub;
      const isPublicUser = payload.isPublic === true;

      // P1/O1 no HANDSHAKE, não só no sweep. `reconcileAuthorization` (abaixo)
      // declara o princípio "conta desativada / admin rebaixado perde acesso
      // IMEDIATAMENTE" e lê o banco; este gate, na mesma página, decidia só pelo
      // claim do JWT (`payload.organization_id` + `payload.role`). A assimetria era
      // explorável sem nenhum artifício: um usuário DESATIVADO com access token
      // ainda válido (15 min) abria socket novo, escrevia até o sweep derrubá-lo
      // (~30 s) e reconectava em laço durante toda a vida do token. Idem para um
      // admin rebaixado, que `resolvePermission` promovia a `owner` em QUALQUER
      // atlas via `payload.role === 'admin'`. Um gate que vive num só dos dois
      // pontos de entrada não é um gate.
      //
      // A leitura viva substitui o `orgIsActive` do claim pelo mesmo custo de UMA
      // query, e é ela também que dá a org e o papel VIVOS (o claim pode apontar
      // para a org antiga, ainda ativa, depois de o usuário ser movido).
      let liveRole = payload.role;
      if (!isPublicUser) {
        const live = await getLiveAuthState(userId);
        if (live) {
          if (!live.userIsActive || !live.orgIsActive) {
            reject('403 Forbidden');
            return;
          }
          // Mesmo argumento do parágrafo acima, agora para o CORTE DE SESSÃO
          // (`users.sessions_valid_from`, migração 008): revogação em massa passou a
          // recusar o access token no `auth` estrito e a bloquear a renovação
          // deslizante, e deixar o handshake de fora daria ao token morto exatamente
          // a porta que sobrou. O `iat` já está no payload, e o `live` já foi lido.
          //
          // ESCOPO, explicitamente: isto barra a ABERTURA de socket novo. Um socket
          // JÁ ABERTO não cai por causa do corte — `reconcileAuthorization` não o
          // avalia, de propósito, porque o ciclo de vida do socket é client-driven
          // por contrato e o sweep reconcilia AUTORIZAÇÃO (share, publicação, org),
          // não sessão. O socket vivo continua limitado pelo que sempre o limitou:
          // o cliente fechá-lo, ou o sweep achar outro motivo.
          if (tokenPredatesSessionCut(payload.iat, live.sessionsValidFrom)) {
            reject('403 Forbidden');
            return;
          }
          liveRole = live.role;
        } else if (payload.organization_id && !(await orgIsActive(payload.organization_id))) {
          // Sem linha em `users` (princípio sintético): cai no gate org-only,
          // exatamente como reconcileAuthorization.
          reject('403 Forbidden');
          return;
        }
      }

      // Resolve permission (com o papel VIVO, nunca o do claim)
      const permission = await resolvePermission(atlasId, userId, { ...payload, role: liveRole });
      if (!permission) {
        reject('403 Forbidden');
        return;
      }

      // Handshake is going through: hand the socket to ws, which installs its own
      // error handling from here on. Leaving ours attached would double-handle.
      socket.removeListener('error', onSocketError);

      // Complete upgrade
      wss.handleUpgrade(request, socket, head, (ws) => {
        onConnection(ws, {
          id: userId,
          username: isPublicUser ? 'visitante' : payload.username,
          nome: isPublicUser ? 'Visitante' : payload.nome,
          posto_graduacao: isPublicUser ? null : payload.posto,
          role: isPublicUser ? 'user' : (liveRole || 'user'),
          organization_id: isPublicUser ? null : (payload.organization_id ?? null),
          isPublic: isPublicUser,
        }, atlasId, permission, clientId);
      });
    } catch (err) {
      logger.error({ err }, 'WebSocket upgrade error');
      reject('500 Internal Server Error');
    }
  });

  // Heartbeat interval — also the hook for W1/O1: a WS connection caches its
  // permission at handshake and lives for hours, so each tick re-reconciles live
  // authorization (share downgrade/revoke, atlas unpublished, org deactivated)
  // against the DB. Staleness is thus bounded to one heartbeat interval (~30s).
  const heartbeatInterval = setInterval(() => {
    // heartbeatSweep is async now; a floating promise here would turn any future defect inside it
    // into an unhandled rejection that kills the process.
    heartbeatSweep(wss).catch((err) => logger.error({ err }, 'heartbeat sweep failed'));
  }, config.ws.heartbeatIntervalMs);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return wss;
}

/**
 * Handles a new WebSocket connection.
 */
function onConnection(ws, user, atlasId, permission, providedClientId = null) {
  // FIRST LINE OF THE CONNECTION, and the position is the contract: this replaces `ws.send` with
  // the outbound resource prune, so every frame this socket ever emits passes it — the `connected`
  // frame below, every relay in `collab.handlers.js`, every fan-out in `collab.rooms.js`, and
  // whatever is written next. Installing it later would leave whatever ran before it uncovered,
  // which is the shape of hole this phase exists to remove. See `collab.send.js`.
  installOutboundResourcePrune(ws);

  // Use the client-provided stable id when present; otherwise generate one.
  const clientId = providedClientId || crypto.randomUUID();

  // Reconnect within the away grace window: cancel the pending removal and drop
  // the stale (closed) socket from the room so presence is not duplicated.
  // The key includes the userId (see awayKey), so a pending slot can only ever be
  // adopted by the same user — `pending.ws.userId === user.id` holds by construction.
  const pending = awayTimers.get(awayKey(atlasId, user.id, clientId));
  if (pending) {
    clearTimeout(pending.timer);
    awayTimers.delete(awayKey(atlasId, user.id, clientId));
    leaveRoom(atlasId, pending.ws);
    collabService.broadcastUserBack(atlasId, user.id, clientId);
  }

  // A DIFFERENT user arriving on the same (atlasId, clientId): same browser profile, second
  // account. It is not a reconnect, so nothing is adopted — but the old slot cannot be left
  // suspended either, because the frontend roster is keyed by `clientId` (`resolveKey`,
  // frontend/src/js/presence/presence-store.js) and the two would collide on one entry. Evict
  // it NOW, through the normal path, so the peers get the `user_left` they are owed.
  for (const [key, stale] of awayTimers) {
    if (stale.ws.atlasId !== atlasId) continue;
    if (stale.ws.clientId !== clientId) continue;
    if (stale.ws.userId === user.id) continue;
    clearTimeout(stale.timer);
    awayTimers.delete(key);
    removeConnection(stale.ws);
  }

  // Attach user info to WebSocket
  ws.userId = user.id;
  ws.userName = user.nome;
  ws.userPosto = user.posto_graduacao;
  ws.userRole = user.role;
  ws.atlasId = atlasId;
  ws.permission = permission;
  ws.clientId = clientId;
  ws.isAlive = true;
  // Consecutive failed authorization reconciliations (see reconcileAuthorization).
  ws.authzFailures = 0;
  ws.isPublic = user.isPublic || false;
  ws.organizationId = user.organization_id || null;
  ws.cursorPosition = null;
  ws.currentMapId = null;
  ws.selectedFeatures = [];
  // Inicializado explicitamente porque `getRoomUsers` o serializa em TODA entrada do
  // roster: sem isto o valor era `undefined`, e `JSON.stringify` remove a chave — o
  // frame `connected` mudava de SHAPE conforme o par já ter emitido uma seleção ou
  // não. Os vizinhos (`selectedFeatures`, `temporalState`) já tinham default; este
  // faltava, e um contrato congelado que só às vezes traz o campo não está congelado.
  ws.selectionContext = null;
  ws.temporalState = null;

  // NO SESSION ROW IS WRITTEN HERE, by decision of 2026-07-25.
  //
  // A `collabService.createSession(user.id, atlasId, clientId)` used to run at this point (and a
  // matching `deleteSession` in `removeConnection`). Both are gone, and the reason is not that the
  // write was expensive — it is that nothing ever read it. `active_sessions` had no SELECT
  // anywhere in `backend/src`: live presence is the in-memory room map (`collab.rooms.js`), keyed
  // by clientId. What the table actually did was LOOK like a session trail while being unable to
  // be one: the two calls were fire-and-forget, so a fast connect→close could commit the DELETE
  // before the INSERT and orphan a row; nothing purged it; and every process restart orphaned
  // every live row at once, silently. A half-alive column misleads MORE than an absent one — the
  // same lesson already recorded for `org_role` without a writer.
  //
  // The TABLE stays (migrations are forward-only and additive; dropping it would be destructive
  // DDL, which `tests/unit/migrations-higiene.test.js` refuses). It is RESERVED, with no writer.
  // If a durable session trail is ever wanted, write it deliberately — transactionally, with a
  // reaper and a reader — instead of reviving these two calls.

  // Join room
  joinRoom(atlasId, ws);

  // Get current users
  const usersOnline = getRoomUsers(atlasId);

  // Send connected message. `permission` is the frozen field and tem CINCO valores
  // (read < comment < write < manage < owner); `role` expõe o vocabulário do frontend, que
  // tem SEIS (owner, admin, manager, editor, commenter, viewer), via `toFrontendRole`.
  //
  // Este comentário listava três permissões e quatro papéis até 2026-07-25, omitindo
  // `manage`/`comment` e `manager`/`commenter`. É a mesma lista fechada que a constituição
  // proíbe e que já produziu bug real duas vezes, agora na forma mais barata de propagar:
  // um comentário de contrato, que é onde quem for consumir o frame vai olhar primeiro.
  ws.send(JSON.stringify({
    type: 'connected',
    sessionId: clientId,
    userId: user.id,
    permission,
    role: toFrontendRole(permission, user.role),
    usersOnline,
  }));

  // Broadcast user joined to others
  collabService.broadcastUserJoined(atlasId, user, ws, ws.clientId ?? null);

  logger.info({ userId: user.id, atlasId, permission }, 'WebSocket connected');

  // Set up message handler.
  //
  // As mensagens de UM socket são processadas EM SÉRIE (encadeadas numa promise).
  // Antes, `handleMessage` era disparado sem `await`: um cliente em rajada abria N
  // `pushOperations` concorrentes no mesmo atlas, e como cada um retém uma conexão
  // do pool enquanto espera o advisory lock, um único socket conseguia esgotar o
  // pool (poolMax=10) e travar o processo inteiro. Serializar por socket preserva a
  // ordem das ops do cliente e limita cada conexão a uma escrita em voo.
  ws.on('message', (rawData) => {
    let data;
    try {
      data = JSON.parse(rawData.toString());
    } catch (err) {
      logger.error({ err, userId: ws.userId }, 'Failed to parse WebSocket message');
      return;
    }
    ws._messageChain = (ws._messageChain || Promise.resolve())
      .then(() => handleMessage(ws, data))
      .catch((err) => {
        logger.error({ err, userId: ws.userId, type: data?.type }, 'WebSocket message handler failed');
      });
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
async function handleMessage(ws, data) {
  switch (data.type) {
    case 'ping':
      handlers.handlePing(ws);
      break;

    case 'cursor':
      handlers.handleCursor(ws, data);
      break;

    case 'temporal':
      handlers.handleTemporal(ws, data);
      break;

    case 'selection':
      handlers.handleSelection(ws, data);
      break;

    case 'operation':
      await handlers.handleOperation(ws, data);
      break;

    case 'operations':
      await handlers.handleOperations(ws, data);
      break;

    case 'sync_request':
      await handlers.handleSyncRequest(ws, data);
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
 * Removes a connection from the room and presence for good (room + peer
 * notification). Shared by the intentional-close path and the away timeout.
 */
function removeConnection(ws) {
  leaveRoom(ws.atlasId, ws);
  // No `active_sessions` DELETE here: nothing writes the table anymore (see the note in
  // onConnection, decision of 2026-07-25). The room map is the whole of presence.

  // P8 — a guarda compara `clientId`, não `userId`, e a diferença importa nos
  // dois sentidos porque o roster do par é chaveado POR CLIENTE (o `resolveKey`
  // do frontend prefere `clientId`, e `userLeft` apaga UMA chave):
  //
  //  - por userId, duas abas da mesma conta compartilhavam o anúncio: fechar a
  //    primeira não emitia nada e a entrada dela ficava no roster dos pares para
  //    sempre, porque só o ÚLTIMO socket anunciava — e anunciava o clientId dele,
  //    não o da aba que saiu;
  //  - sem guarda nenhuma, uma reconexão reusa o MESMO clientId (ele é
  //    persistido e estável), então o close atrasado do socket velho apagaria a
  //    presença recém-criada.
  //
  // Comparar clientId resolve os dois: anuncia a saída daquele cliente, e cala
  // enquanto existir outro socket vivo com a mesma identidade de cliente.
  // leaveRoom already removed this ws, so the room holds exactly the survivors.
  //
  // The survivor must match on BOTH userId and clientId. `clientId` alone identifies a browser
  // profile, not a person: two accounts on the same machine send the same one (it lives in
  // localStorage), and matching on it alone made B's live socket suppress A's `user_left` — the
  // peers kept listing A forever, which is the other half of the away-slot defect above.
  for (const client of getRoomClients(ws.atlasId)) {
    if (client.clientId && ws.clientId && client.clientId === ws.clientId && client.userId === ws.userId) return;
    // Sem clientId dos dois lados não há identidade de cliente para comparar:
    // cai no comportamento antigo, por usuário, que é o seguro nesse caso.
    if ((!client.clientId || !ws.clientId) && client.userId === ws.userId) return;
  }
  collabService.broadcastUserLeft(ws.atlasId, ws.userId, ws.clientId ?? null);
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
    const key = awayKey(ws.atlasId, ws.userId, ws.clientId);
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

  const key = awayKey(ws.atlasId, ws.userId, ws.clientId);
  const existing = awayTimers.get(key);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    awayTimers.delete(key);
    removeConnection(ws);
  }, awayGraceMs);
  if (typeof timer.unref === 'function') timer.unref();
  awayTimers.set(key, { ws, timer });
}
