// Path: src/modules/collab/collab.handlers.js
// Individual message type handlers for WebSocket collaboration

import { broadcastToRoom, broadcastOperations } from './collab.rooms.js';
import * as syncService from '../sync/sync.service.js';
import { pushSchema } from '../sync/sync.schemas.js';
import {
  cursorPresenceSchema,
  temporalPresenceSchema,
  selectionPresenceSchema,
  validatePresenceFrame,
} from './collab.schemas.js';
import { classifyConnectionQuality, adaptiveSettingsFor } from './collab.quality.js';
import logger from '../../utils/logger.js';
import { safeErrorMessage } from '../../utils/safe-error-message.js';

// `pushOperations`/`pullOperations` run SQL directly inside a `tx`, so a driver error
// arrives here intact — constraint names, column names, the offending row. The REST
// twin of this failure is masked by error-handler.js's PG_ERROR_MAP; this socket used
// to forward `err.message` verbatim, which made the SAME failure leak schema over WS
// and not over HTTP. `safeErrorMessage` gives both sides the same words, and the raw
// error keeps going to `logger.error` right above each `send`, which is where the
// operator needs it.
//
// The Joi messages in `validateOps`/`normalizePresence` are NOT masked, deliberately:
// they describe the client's OWN payload against a public schema (the REST path
// returns the same `details` from error-handler.js:44-56), so masking them would
// remove the only signal a client has about why its own frame was rejected, while
// leaking nothing about the server.

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
 * Validates an EPHEMERAL presence frame (cursor/temporal/selection) and returns the
 * normalized value, or null after answering with a VALIDATION_ERROR.
 *
 * Presence is retained on the socket and re-serialized into the `connected` snapshot of
 * every later join (collab.rooms.js `getRoomUsers` → collab.gateway.js `onConnection`), so
 * ONLY the normalized value may be stored or relayed — never the raw client payload. See
 * collab.schemas.js for the bounds and how they were measured.
 * @param {import('ws').WebSocket} ws
 * @param {import('joi').Schema} schema
 * @param {Object} data - Raw parsed frame.
 * @returns {Object|null}
 */
function normalizePresence(ws, schema, data) {
  const { error, value } = validatePresenceFrame(schema, data);
  if (error) {
    ws.send(JSON.stringify({
      type: 'error',
      code: 'VALIDATION_ERROR',
      message: error.message,
    }));
    return null;
  }
  return value;
}

/**
 * Handles ping messages (heartbeat).
 */
export function handlePing(ws) {
  ws.isAlive = true;
  ws.send(JSON.stringify({ type: 'pong' }));
}

/**
 * Handles cursor position updates. Ungated by design (a read-only viewer / public visitor
 * shares its cursor), which is exactly why the payload must be normalized before it is
 * retained on the socket.
 */
export function handleCursor(ws, data) {
  const value = normalizePresence(ws, cursorPresenceSchema, data);
  if (!value) return;

  ws.cursorPosition = value.position;
  ws.currentMapId = value.mapId;

  broadcastToRoom(ws.atlasId, {
    // `clientId` is NOT optional here, even though the frontend's `resolveKey` falls
    // back to `userId`: the roster is KEYED by clientId (collab.rooms.js:176), so an
    // awareness frame carrying only userId does not update the existing entry, it
    // CREATES A SECOND ONE. The peer then shows two roster rows per person, one with
    // a name and no cursor and one with a cursor labelled by the raw UUID.
    clientId: ws.clientId ?? null,
    type: 'cursor',
    userId: ws.userId,
    position: value.position,
    mapId: value.mapId,
  }, ws);
}

/**
 * Handles temporal-presence updates (caso E). Mirrors handleCursor: live state is
 * kept in-memory on the ws object and broadcast to peers (sender excluded).
 */
export function handleTemporal(ws, data) {
  const value = normalizePresence(ws, temporalPresenceSchema, data);
  if (!value) return;

  ws.temporalState = value.state;
  if (value.mapId !== undefined) ws.currentMapId = value.mapId;

  broadcastToRoom(ws.atlasId, {
    clientId: ws.clientId ?? null, // veja o porquê em handleCursor
    type: 'temporal',
    userId: ws.userId,
    state: value.state,
    mapId: value.mapId,
  }, ws);
}

/**
 * Handles feature selection updates (live presence awareness, across the 2D map,
 * 3D and 360 surfaces).
 *
 * Gated to editors-and-above: owner / manage / write broadcast their selection.
 * A Comentarista (`comment`) or Visualizador (`read`) only RECEIVES peers'
 * selections — it never emits its own. (Cursor/temporal stay ungated; selection
 * is intentionally stricter, per product decision.) Selection is ephemeral: the
 * context is held in-memory on the ws object for the join snapshot and never
 * persisted.
 *
 * The payload carries `surface` ('2d'|'3d'|'360') plus its scope: `mapId` for 2D,
 * `tilesetId` for 3D, `photoName` for 360. `featureMeta` (optional) ships the
 * per-feature type so a 2D peer can resolve the right highlight without a lookup.
 */
export function handleSelection(ws, data) {
  if (ws.permission === 'read' || ws.permission === 'comment') {
    return;
  }

  const value = normalizePresence(ws, selectionPresenceSchema, data);
  if (!value) return;

  const { surface, featureIds } = value;
  // `selectedFeatures` (legacy field of the join snapshot) and `selectionContext.featureIds`
  // are the SAME array instance on purpose: the snapshot ships both, so sharing the
  // instance keeps one copy in memory instead of two.
  ws.selectedFeatures = featureIds;
  ws.selectionContext = {
    surface,
    mapId: value.mapId ?? null,
    featureIds,
    ...(Array.isArray(value.featureMeta) ? { featureMeta: value.featureMeta } : {}),
    ...(value.tilesetId != null ? { tilesetId: value.tilesetId } : {}),
    ...(value.photoName != null ? { photoName: value.photoName } : {}),
  };

  broadcastToRoom(ws.atlasId, {
    clientId: ws.clientId ?? null, // veja o porquê em handleCursor
    type: 'selection',
    userId: ws.userId,
    surface,
    featureIds,
    mapId: value.mapId,
    ...(Array.isArray(value.featureMeta) ? { featureMeta: value.featureMeta } : {}),
    ...(value.tilesetId != null ? { tilesetId: value.tilesetId } : {}),
    ...(value.photoName != null ? { photoName: value.photoName } : {}),
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

    // A per-op REFUSAL (locked map, map delete/lock by a non-owner) leaves nothing on the
    // server: no entity row, no log row, no server_version. Relaying it anyway would make the
    // peer apply an edit that does not exist server-side and that no snapshot will ever
    // contain — divergence that only a full resync could clear.
    if (result.results?.[0]?.success === false) return;

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
      message: safeErrorMessage(err, 'Operation failed'),
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
    // Refused ops are dropped from the relay (see handleOperation): they changed nothing on the
    // server, so a peer applying them would diverge until its next full snapshot.
    const refused = new Set((result.results || []).filter((r) => r.success === false).map((r) => r.operationId));
    const opsOut = data.ops
      .filter((op) => !refused.has(op.id))
      .map((op) => ({ ...op, serverVersion: versionByOp.get(op.id) ?? result.serverVersion }));
    if (opsOut.length > 0) {
      broadcastOperations(ws.atlasId, opsOut, { userId: ws.userId, excludeWs: ws });
    }
  } catch (err) {
    logger.error({ err, atlasId: ws.atlasId }, 'Failed to process operations batch');
    ws.send(JSON.stringify({
      type: 'error',
      code: 'OPERATION_FAILED',
      message: safeErrorMessage(err, 'Operation failed'),
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
    // Estes eram os DOIS ÚLTIMOS frames de percepção sem `clientId`, e a razão está escrita
    // por extenso em `handleCursor`: o roster é CHAVEADO por clientId, então um frame que só
    // carrega userId não atualiza a entrada existente, ele CRIA UMA SEGUNDA. Quem editava um
    // briefing aparecia duas vezes na lista de quem está online, uma com nome e outra com o
    // UUID cru. Cursor e temporal foram corrigidos; estes dois ficaram para trás, e só um
    // teste que CONTA as linhas do roster pegaria isso (contar era o que faltava).
    clientId: ws.clientId ?? null,
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
    clientId: ws.clientId ?? null, // veja o porquê em handleBriefingEditStart
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
    // `ws.userId` travels for the same reason the HTTP pull threads `req.user.id`: since F11 the
    // snapshot embeds catalog-layer definitions filtered by what THIS principal may see, and the
    // WS `sync_request` returns the very same snapshot. Omitting it here would have made the two
    // transports disagree about a permission — with the socket being the LESS restrictive of the
    // two, since a snapshot without a principal is public-only.
    const result = await syncService.pullOperations(
      ws.atlasId, data.lastVersion || 0, ws.permission, ws.userId ?? null,
    );

    // THE OBJECT, NOT THE STRING, and this is the one place in the module where the difference is
    // load-bearing. The outbound boundary (`collab.send.js`) prunes catalog-resource definitions,
    // and the snapshot is the ONLY frame that legitimately carries one: `rehydrateCatalogLayer`
    // resolved it against what this principal may see. That authorization is recorded by object
    // IDENTITY (a wire marker would be forgeable by any client), so it does not survive a
    // `JSON.stringify` done here — serialising before the boundary would strip the very
    // definitions the rehydration just earned, and the layers would arrive as "camada
    // indisponível" for someone who holds the grant. Handing the object over keeps identity.
    if (result.isSnapshot) {
      ws.send({
        type: 'sync_response',
        isSnapshot: true,
        snapshot: result.snapshot,
        currentVersion: result.currentVersion,
      });
    } else {
      ws.send({
        type: 'sync_response',
        isSnapshot: false,
        ops: result.operations,
        currentVersion: result.currentVersion,
      });
    }
  } catch (err) {
    logger.error({ err, atlasId: ws.atlasId }, 'Failed to process sync request');
    ws.send(JSON.stringify({
      type: 'error',
      code: 'SYNC_FAILED',
      message: safeErrorMessage(err, 'Sync failed'),
    }));
  }
}
