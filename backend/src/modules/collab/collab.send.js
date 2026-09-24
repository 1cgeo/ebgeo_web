// Path: src/modules/collab/collab.send.js
// THE WEBSOCKET BOUNDARY, and it is a SECOND choke point on purpose: the two transports share no
// outbound object. HTTP goes through an Express `res`; the collaboration socket is opened by
// `wss.on('connection')`, outside the middleware stack entirely, so no Express middleware can ever
// see a frame. Trying to have one boundary would have meant having none for the socket.
//
// Every byte this server sends to a collaboration client leaves through `ws.send` (every site is
// enumerated by `tests/unit/saidas-de-conteudo-censo.test.js`), so wrapping `ws.send` per socket,
// once, at connection time, covers all of them and every one added later — including the relay in
// `handleOperation` that `broadcastOperations` never saw, which is the fourth exit F13 exists to
// close.
//
// TWO INPUT FORMS, AND THE DIFFERENCE MATTERS:
//
//   - an OBJECT is pruned before serialization, so the snapshot's authorized definitions (marked
//     by identity, see `resource-payload.prune.js`) survive. A frame that legitimately carries a
//     definition MUST be handed over as an object; `handleSyncRequest` is the one that does.
//   - a STRING is scanned for the discriminator and only parsed when it is present. Nothing that
//     went through the object prune upstream (`broadcastToRoom`, `broadcastOperations`) still
//     contains one, so the fan-out to N sockets costs N substring scans and zero parses. That is
//     the hot presence path: cursor and selection frames are tiny and never mention a catalog
//     type.
//
// Binary frames are passed through untouched. None exist today on this socket; the guard is there
// so that adding one does not silently start running a Buffer through a JSON scan.

import { pruneResourcePayload, pruneResourceJsonText } from '../catalog/resource-payload.prune.js';

/**
 * @param {*} data
 * @returns {boolean} Whether the payload is binary (Buffer / ArrayBuffer / typed array).
 */
function isBinaryFrame(data) {
  return Buffer.isBuffer(data) || data instanceof ArrayBuffer || ArrayBuffer.isView(data);
}

/**
 * Installs the outbound prune on ONE socket, replacing its `send`.
 *
 * Idempotent: installing twice on the same socket would double the work and, worse, make the
 * second wrapper see the first one's output, so the flag is checked rather than assumed.
 *
 * @param {import('ws').WebSocket} ws
 * @returns {import('ws').WebSocket} The same socket.
 */
export function installOutboundResourcePrune(ws) {
  if (!ws || typeof ws.send !== 'function' || ws._resourcePruneInstalled) return ws;

  const original = ws.send.bind(ws);
  ws._resourcePruneInstalled = true;
  const deliver = (data, ...rest) => {
    if (isBinaryFrame(data)) return original(data, ...rest);
    if (typeof data === 'string') return original(pruneResourceJsonText(data), ...rest);
    if (data !== null && typeof data === 'object') {
      return original(JSON.stringify(pruneResourcePayload(data)), ...rest);
    }
    return original(data, ...rest);
  };
  // The held path of `holdOperationFrames` hands its frames back through the SAME delivery, so the
  // prune above still covers them.
  ws._deliverFrame = deliver;
  ws.send = (data, ...rest) => {
    if (ws._heldOperationFrames && !isBinaryFrame(data) && isOperationFrame(data)) {
      ws._heldOperationFrames.push([data, rest]);
      return undefined;
    }
    return deliver(data, ...rest);
  };
  return ws;
}

// ---------------------------------------------------------------------------------------------
// THE REPLAY WINDOW OF A `sync_request`.
//
// The client applies socket frames IN ARRIVAL ORDER (`_queueApply`, frontend
// `store/sync/ws-client.js`), and only the entity types in its `CONVERGENCE_GUARDED` drop an op older
// than one already applied; a map update, a group membership, a comment, a slide and a catalog layer
// are applied blindly, last one wins. The answer to a `sync_request` is a picture of the moment its
// operations were READ, and it used to leave AFTER a further read: an op committed in that gap and
// broadcast before the answer reached the peer FIRST, and the answer, carrying the previous op of
// the same entity, was then applied over it. The peer that reconnected while a colleague edited kept
// the older value until a full snapshot. Pinned by `tests/ws/sync-request-ordem-dos-quadros.repro.test.js`.
//
// So operation frames addressed to a socket are HELD from the start of its sync request until the
// answer has been sent, and then released after it, dropping every op the answer already covers.
// Presence and control frames are never held: they are not replayed by the answer, so their order
// against it means nothing, and delaying a cursor would only make it lag.
// ---------------------------------------------------------------------------------------------

const OPERATION_FRAME_PREFIX = /^\{"type":"operations?"/;

/**
 * @param {*} data - A frame about to be sent.
 * @returns {boolean} Whether it relays sync operations (`operation` or `operations`).
 */
function isOperationFrame(data) {
  if (typeof data === 'string') return OPERATION_FRAME_PREFIX.test(data);
  return data !== null && typeof data === 'object'
    && (data.type === 'operation' || data.type === 'operations');
}

/**
 * Starts holding operation frames addressed to `ws`. Idempotent while a hold is open.
 * @param {import('ws').WebSocket} ws
 */
export function holdOperationFrames(ws) {
  if (ws && ws._deliverFrame && !ws._heldOperationFrames) ws._heldOperationFrames = [];
}

/**
 * Ends the hold and sends what it kept, in the order it arrived, minus every op the sync answer
 * already carried.
 *
 * WHY AN OP AT OR BELOW `coveredVersion` IS SAFE TO DROP. Per atlas, `server_version` order is commit
 * order (`lockAtlasLog`, `src/modules/sync/atlas-log-lock.js`), so an op at or below the highest
 * version the answer covers was committed before the read the answer came from, and is IN it (or
 * below the cursor the client already holds). Sending it again after the answer would replay an
 * OLDER op over a newer one for the blind-applied types, which is the very reversal the hold exists
 * to prevent.
 *
 * @param {import('ws').WebSocket} ws
 * @param {number} [coveredVersion=-Infinity] - The highest server version the answer covers
 *   (`-Infinity` when no answer was sent, e.g. the pull failed: then everything is released).
 */
export function releaseOperationFrames(ws, coveredVersion = -Infinity) {
  const held = ws?._heldOperationFrames;
  if (!held) return;
  ws._heldOperationFrames = null;
  for (const [data, rest] of held) {
    let frame = data;
    if (typeof data === 'string') {
      try {
        frame = JSON.parse(data);
      } catch {
        ws._deliverFrame(data, ...rest);
        continue;
      }
    }
    const ops = frame.type === 'operation' ? [frame.op] : (Array.isArray(frame.ops) ? frame.ops : []);
    const newer = ops.filter((op) => !(Number.isFinite(op?.serverVersion) && op.serverVersion <= coveredVersion));
    if (newer.length === 0) continue;
    if (newer.length === ops.length) {
      ws._deliverFrame(data, ...rest);
    } else if (frame.type === 'operation') {
      ws._deliverFrame({ ...frame, op: newer[0] }, ...rest);
    } else {
      ws._deliverFrame({ ...frame, ops: newer }, ...rest);
    }
  }
}
