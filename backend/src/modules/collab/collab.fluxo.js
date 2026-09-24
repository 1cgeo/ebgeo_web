// Path: src/modules/collab/collab.fluxo.js
// Per-recipient flow control of PRESENCE frames (cursor, cursor batch, selection), read from the
// recipient's own delivery, so a slow link never queues presence ahead of the sync.
//
// WHY THE BUFFER THRESHOLD WAS NOT ENOUGH, measured on 2026-09-24. `broadcastToRoom` dropped a
// presence frame only when the socket's `bufferedAmount` passed 1 MiB. With the browser throttled
// to 40 kbps (CDP, the throttle inside the browser, like a real slow link) and a stream of 1 KB
// frames offered at 20 KB/s, `bufferedAmount` stayed at ZERO for the whole run while the frames
// reached the page up to 14 s late: the bytes wait in the kernel and in whatever sits between the
// two ends (nginx in production, the browser's network stack in the test), never in the Node
// buffer. The same probe showed what does see the backlog: a protocol ping sent after a frame is
// answered only once everything before it was delivered, and its round trip grew from 1.1 s to
// 13.5 s with the queue. So the window is read from THAT, per recipient.
//
// THE RULE, per recipient socket:
//   - at most ONE presence frame (or flush) in flight: after it goes out, a protocol ping with a
//     sequence tag follows it, and until the matching pong arrives, new presence to this recipient
//     is RETAINED, keeping only the last frame per sender (and per surface, for the selection);
//   - after the pong, the next presence waits a PAUSE proportional to the delay the link added
//     beyond its best observed round trip (`FATOR_DE_PAUSA` x (rtt - rttMin), capped), so presence
//     backs off exactly when something else (the sync) is occupying the path;
//   - everything else (operations, acks, control frames) never passes through here: it is sent at
//     once and never retained, never coalesced, never dropped. An operation therefore waits behind
//     at most one presence frame.
//
// On a LAN the pong comes back in about a millisecond and the rule is invisible (the server batches
// cursors every 100 ms anyway). On the 40 kbps link three colleagues moving the mouse filled 62% of
// the link with presence and an edit reached the slow peer up to 4.9 s late, growing with every
// edit; see `frontend/tests/e2e-ui/presenca-nao-disputa-com-sync.spec.js` for the numbers after.
//
// EVERY SERVER PING CARRIES A SEQUENCE, the heartbeat's included (`proximaMarca`). Pongs come back
// in order, so the pong of ANY later ping proves the marker was delivered too: if a browser or an
// intermediary ever answered only the latest of two pings (RFC 6455 allows it), the heartbeat
// recovers the window within one sweep instead of freezing presence for that recipient.
//
// A marker that is never answered still expires (`MARCADOR_EXPIRA_MS`), so a path that swallows
// control frames degrades presence to one frame per expiry instead of stopping it.
//
// VALVE: `WS_PRESENCE_FLOW=0` turns the whole rule off, read live from the environment like
// `WS_CURSOR_BATCH_MS`, so it can be reverted without a deploy and both regimes are measurable in
// the same process.

/** Presence frame types this module may retain and coalesce. Nothing else ever enters it. */
export const TIPOS_DE_PRESENCA = new Set(['cursor', 'cursors', 'selection']);

/** How many times the delay beyond the best round trip the next presence waits. */
export const FATOR_DE_PAUSA = 3;

/** Longest pause between two presence frames to one recipient, in ms. */
export const PAUSA_MAX_MS = 5000;

/** A marker older than this is taken as lost and the window reopens, in ms. */
export const MARCADOR_EXPIRA_MS = 30000;

/** Prefix of the application data of every server ping, followed by the sequence number. */
const PREFIXO_DA_MARCA = 'p';

/**
 * Whether the flow control is on, read live (see the file header).
 * @returns {boolean}
 */
export function fluxoLigado() {
  const bruto = process.env.WS_PRESENCE_FLOW;
  return !(bruto === '0' || bruto === 'false');
}

/**
 * The per-socket state, created on first use.
 * @param {import('ws').WebSocket} ws
 * @returns {{ seq: number, emVoo: ({seq: number, desde: number}|null), rttMin: number,
 *   liberarEm: number, pendentes: Map<string, {tipo: 'item'|'quadro', valor: Object}>,
 *   timer: (NodeJS.Timeout|null) }}
 */
function estado(ws) {
  if (!ws._fluxoPresenca) {
    ws._fluxoPresenca = {
      seq: 0,
      emVoo: null,
      rttMin: Infinity,
      liberarEm: 0,
      pendentes: new Map(),
      timer: null,
    };
  }
  return ws._fluxoPresenca;
}

/**
 * The application data for the next ping of this socket, and it advances the sequence. Every
 * server ping takes its tag from here, so any pong can acknowledge an older marker.
 * @param {import('ws').WebSocket} ws
 * @returns {string}
 */
export function proximaMarca(ws) {
  const f = estado(ws);
  f.seq += 1;
  return `${PREFIXO_DA_MARCA}${f.seq}`;
}

/**
 * Parses the sequence out of a pong's application data.
 * @param {*} data - Buffer (from `ws`) or string.
 * @returns {number} NaN when the pong carries no sequence of ours.
 */
function sequenciaDoPong(data) {
  const texto = Buffer.isBuffer(data) ? data.toString('utf8') : String(data ?? '');
  if (!texto.startsWith(PREFIXO_DA_MARCA)) return NaN;
  const n = Number(texto.slice(PREFIXO_DA_MARCA.length));
  return Number.isInteger(n) ? n : NaN;
}

/**
 * Sends the protocol ping that follows presence out of this socket, opening the in-flight window.
 * @param {import('ws').WebSocket} ws
 * @param {ReturnType<typeof estado>} f
 */
function enviarMarcador(ws, f) {
  const marca = proximaMarca(ws);
  try {
    ws.ping(marca);
    f.emVoo = { seq: f.seq, desde: Date.now() };
  } catch {
    // Closing socket: nothing more will be delivered to it.
    f.emVoo = null;
  }
}

/**
 * The retention keys of one presence frame for one recipient.
 *
 * The cursor is ONE slot per sender (the server batch already keeps one per `clientId`, whatever
 * the surface); the selection is one slot per sender AND surface, because the peer paints the
 * selection per surface and dropping a clear on one surface for a selection on another would leave
 * the old highlight drawn. The recipient's own cursor, which the room batch carries to everyone to
 * serialize once, is not retained: the client drops it anyway.
 * @param {Object} mensagem
 * @param {import('ws').WebSocket} destino
 * @returns {Array<[string, {tipo: 'item'|'quadro', valor: Object}]>}
 */
function entradasDe(mensagem, destino) {
  const quem = (o) => o?.clientId ?? o?.userId;
  if (mensagem.type === 'cursors') {
    return (Array.isArray(mensagem.lote) ? mensagem.lote : [])
      .filter((item) => !(item?.clientId && item.clientId === destino.clientId))
      .map((item) => [`c:${quem(item)}`, { tipo: 'item', valor: item }]);
  }
  if (mensagem.type === 'cursor') return [[`c:${quem(mensagem)}`, { tipo: 'quadro', valor: mensagem }]];
  return [[`s:${quem(mensagem)}:${mensagem.surface ?? '2d'}`, { tipo: 'quadro', valor: mensagem }]];
}

/**
 * Retains a presence frame, the newest per key replacing the older one and moving to the end, so
 * the flush keeps the order in which the latest states arrived.
 * @param {ReturnType<typeof estado>} f
 * @param {Object} mensagem
 * @param {import('ws').WebSocket} destino
 */
function reter(f, mensagem, destino) {
  for (const [chave, entrada] of entradasDe(mensagem, destino)) {
    f.pendentes.delete(chave);
    f.pendentes.set(chave, entrada);
  }
}

/**
 * Sends what is retained for this recipient, in one flush followed by one marker.
 * @param {import('ws').WebSocket} ws
 */
function descarregar(ws) {
  const f = estado(ws);
  if (f.pendentes.size === 0) return;
  if (ws.readyState !== 1) {
    f.pendentes.clear();
    return;
  }
  const lote = [];
  const quadros = [];
  for (const { tipo, valor } of f.pendentes.values()) {
    if (tipo === 'item') lote.push(valor);
    else quadros.push(valor);
  }
  f.pendentes.clear();
  // Serialized here, as a string: the per-socket boundary (`collab.send.js`) scans it for catalog
  // definitions like every other string frame, and a fake socket in a test needs no wrapper.
  if (lote.length > 0) ws.send(JSON.stringify({ type: 'cursors', lote }));
  for (const quadro of quadros) ws.send(JSON.stringify(quadro));
  enviarMarcador(ws, f);
}

/**
 * Arranges the next flush: at the pong when a marker is in flight, else when the pause ends.
 * @param {import('ws').WebSocket} ws
 * @param {ReturnType<typeof estado>} f
 */
function agendar(ws, f) {
  if (f.emVoo || f.timer || f.pendentes.size === 0) return;
  const espera = f.liberarEm - Date.now();
  if (espera <= 0) {
    descarregar(ws);
    return;
  }
  f.timer = setTimeout(() => {
    f.timer = null;
    if (!f.emVoo) descarregar(ws);
  }, espera);
  f.timer.unref?.();
}

/**
 * Reopens the window of a marker nobody answered for {@link MARCADOR_EXPIRA_MS}.
 * @param {ReturnType<typeof estado>} f
 * @param {number} agora
 */
function expirarMarcador(f, agora) {
  if (f.emVoo && agora - f.emVoo.desde > MARCADOR_EXPIRA_MS) f.emVoo = null;
}

/**
 * Delivers one PRESENCE frame to one recipient, or retains it.
 *
 * @param {import('ws').WebSocket} ws - The recipient.
 * @param {Object} mensagem - The frame as an object (its `type` is one of {@link TIPOS_DE_PRESENCA}).
 * @param {string} payload - The same frame already serialized for the room.
 * @param {{ bufferAlto?: boolean }} [opts] - `bufferAlto`: the socket's own buffer is already backed
 *   up (by operations), so the frame waits for a marker to come back instead of joining the queue.
 * @returns {boolean} Whether the frame went out now (false: retained, it will go out coalesced).
 */
export function entregarPresenca(ws, mensagem, payload, { bufferAlto = false } = {}) {
  // A socket without protocol ping (a test double) cannot report delivery: the old path.
  if (typeof ws.ping !== 'function') {
    if (bufferAlto) return false;
    ws.send(payload);
    return true;
  }
  const f = estado(ws);
  expirarMarcador(f, Date.now());
  if (!bufferAlto && !f.emVoo && f.pendentes.size === 0 && Date.now() >= f.liberarEm) {
    ws.send(payload);
    enviarMarcador(ws, f);
    return true;
  }
  reter(f, mensagem, ws);
  // A backed-up buffer with no marker in flight: a bare marker tells when it drained.
  if (bufferAlto && !f.emVoo) enviarMarcador(ws, f);
  agendar(ws, f);
  return false;
}

/**
 * Handles a protocol pong of this socket: closes the window of the marker it acknowledges, sets the
 * pause from the round trip, and schedules what was retained meanwhile.
 * @param {import('ws').WebSocket} ws
 * @param {*} data - The pong's application data.
 */
export function aoPong(ws, data) {
  const f = ws._fluxoPresenca;
  if (!f?.emVoo) return;
  const seq = sequenciaDoPong(data);
  if (!(seq >= f.emVoo.seq)) return;
  const agora = Date.now();
  const rtt = agora - f.emVoo.desde;
  f.emVoo = null;
  f.rttMin = Math.min(f.rttMin, rtt);
  f.liberarEm = agora + Math.min(PAUSA_MAX_MS, FATOR_DE_PAUSA * (rtt - f.rttMin));
  agendar(ws, f);
}

/**
 * Forgets what is retained FROM a sender, in one recipient: called when that sender leaves the
 * room, so a flush after its `user_left` does not bring it back to the recipient's roster (the
 * phantom that `descartarCursorPendente`, collab.rooms.js, closes for the room batch).
 * @param {import('ws').WebSocket} ws - The recipient.
 * @param {string} chave - The sender's `clientId`, or its `userId` when it has none.
 */
export function esquecerRemetente(ws, chave) {
  const f = ws?._fluxoPresenca;
  if (!f || chave == null) return;
  f.pendentes.delete(`c:${chave}`);
  for (const k of [...f.pendentes.keys()]) {
    if (k.startsWith(`s:${chave}:`)) f.pendentes.delete(k);
  }
}
