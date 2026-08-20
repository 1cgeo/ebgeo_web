// Path: src/modules/collab/collab.send.js
// THE WEBSOCKET BOUNDARY, and it is a SECOND choke point on purpose: the two transports share no
// outbound object. HTTP goes through an Express `res`; the collaboration socket is opened by
// `wss.on('connection')`, outside the middleware stack entirely, so no Express middleware can ever
// see a frame. Trying to have one boundary would have meant having none for the socket.
//
// Every byte this server sends to a collaboration client leaves through `ws.send` (18 sites today,
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
  ws.send = (data, ...rest) => {
    if (isBinaryFrame(data)) return original(data, ...rest);
    if (typeof data === 'string') return original(pruneResourceJsonText(data), ...rest);
    if (data !== null && typeof data === 'object') {
      return original(JSON.stringify(pruneResourcePayload(data)), ...rest);
    }
    return original(data, ...rest);
  };
  return ws;
}
