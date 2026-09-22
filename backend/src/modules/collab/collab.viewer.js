// Path: src/modules/collab/collab.viewer.js
/**
 * @fileoverview The VIEWER CONTEXT of presence: which immersive viewer each person has open, and
 * over which resource (owner, 2026-09-22). Also the late joiner's COMPLEMENT for every presence
 * frame that names a private resource (viewer, cursor and selection).
 *
 * WHAT IT ANSWERS. Until this date the roster said, at most, which MAP a colleague was on. With the
 * 3D model, the walkable scene and the 360 photo open on top of the map, "is on map M" said nothing
 * about where the person actually was. The frame `viewer_context` carries the surface and the
 * identifier; the server turns the identifier into a NAME and decides, per recipient, who may read
 * it. The rule and the memos live in `collab.recorte.js`, shared with the cursor and the selection.
 *
 *   - the NAME is resolved HERE, from the catalog, never taken from the sender;
 *   - a PUBLIC resource goes to everyone, in one serialization;
 *   - a PRIVATE resource goes named only to recipients for whom `fn_can_see_resource` answers yes
 *     IN THE SCOPE OF THIS ATLAS (so the loan counts), and redacted to the rest: they learn the
 *     colleague is "in the 3D viewer", never which model, and never its id;
 *   - the join snapshot (`getRoomUsers`) carries only the everyone-safe projection, and the private
 *     ones reach the newcomer in a follow-up frame, after the same question is asked about THEM.
 *
 * THE PUBLIC-LINK VISITOR'S OWN CONTEXT DOES NOT TRAVEL and is not retained, by the same decision
 * that stopped its cursor (2026-09-20): the visitor is counted, not followed. As a RECIPIENT the
 * visitor is judged like anyone else, with a NULL principal, which is what makes the loan the only
 * private thing it can read.
 *
 * NOTHING HERE WRITES. Presence keeps its "no database write" property
 * (tests/ws/collab-presenca-sem-banco.test.js).
 */

import { WebSocket } from 'ws';
import { getRoomClients } from './collab.rooms.js';
import { quemPodeVer, resolverRecursoDoEscopo, escopoLivre } from './collab.recorte.js';

/**
 * The resource half of a context, in the shape that travels to a recipient allowed to read it.
 * `publico` and `ref` stay on the server: they are how the fan-out decides, not something the
 * roster needs.
 * @param {{tipo: string, id: string, nome: string, foto: string|null}|null} recurso
 * @returns {{tipo: string, id: string, nome: string, foto: string|null}|null}
 */
function recursoNoFio(recurso) {
  if (!recurso || !recurso.id) return null;
  return { tipo: recurso.tipo, id: recurso.id, nome: recurso.nome, foto: recurso.foto ?? null };
}

/**
 * The `viewer` value of a frame or of the join snapshot, for a recipient that may (or may not)
 * read the resource.
 * @param {Object|null} contexto - The retained context (`ws.viewerContext`).
 * @param {boolean} podeVer
 * @returns {{surface: string, recurso: Object|null}|null}
 */
function viewerNoFio(contexto, podeVer) {
  if (!contexto) return null;
  return { surface: contexto.surface, recurso: podeVer ? recursoNoFio(contexto.recurso) : null };
}

/**
 * The frame one recipient receives about one peer.
 * @param {import('ws').WebSocket} par - The socket whose context this is.
 * @param {Object|null} contexto
 * @param {boolean} podeVer
 * @returns {Object}
 */
function quadroDoVisualizador(par, contexto, podeVer) {
  return {
    type: 'viewer_context',
    // The roster is keyed by clientId (see `handleCursor`): a frame without it would mint a second
    // row for the same person.
    clientId: par.clientId ?? null,
    userId: par.userId,
    viewer: viewerNoFio(contexto, podeVer),
  };
}

/**
 * Builds the context retained on the socket from a validated frame.
 *
 * `2d` is NO context (the person is on the map), which is also what a socket starts with.
 * `paraTodos` is the projection EVERY member may read (the resource only when it is public), and
 * it is precomputed here so the synchronous join snapshot never has to ask the database. An
 * identifier that does not resolve is a resource visible to nobody (`collab.recorte.js`), so the
 * surface travels and the resource does not.
 * @param {{surface: string, tilesetId?: string|null, photoName?: string|null}} frame
 * @param {import('ws').WebSocket} ws
 * @returns {Promise<Object|null>}
 */
async function resolverContextoDoVisualizador(frame, ws) {
  if (frame.surface === '2d') return null;
  const recurso = await resolverRecursoDoEscopo(frame, ws);
  const contexto = { surface: frame.surface, recurso };
  contexto.paraTodos = viewerNoFio(contexto, recurso?.publico === true);
  return contexto;
}

/**
 * Retains and relays one sender's viewer context. Called in the sender's message chain, so two
 * frames of the same socket never interleave.
 * @param {import('ws').WebSocket} ws
 * @param {{surface: string, tilesetId?: string|null, photoName?: string|null}} frame - Validated.
 * @returns {Promise<void>}
 */
export async function anunciarContextoDoVisualizador(ws, frame) {
  // The visitor is counted, not followed. See the fileoverview.
  if (ws.isPublic) {
    ws.viewerContext = null;
    return;
  }
  const contexto = await resolverContextoDoVisualizador(frame, ws);
  // The socket may have closed during the lookup, and the peers already received its `user_left`:
  // relaying now would resurrect it in their roster.
  if (ws.readyState !== WebSocket.OPEN) return;
  // RETAINED BEFORE THE FAN-OUT, so a newcomer joining while the audience is being decided gets
  // this context from the snapshot or from its own follow-up instead of missing it.
  ws.viewerContext = contexto;

  const destinatarios = [...getRoomClients(ws.atlasId)]
    .filter((c) => c !== ws && c.readyState === WebSocket.OPEN);
  if (destinatarios.length === 0) return;

  const recurso = contexto?.recurso ?? null;
  const permitidos = escopoLivre(recurso)
    ? null
    : await quemPodeVer(recurso, destinatarios, ws.atlasId);
  const completo = JSON.stringify(quadroDoVisualizador(ws, contexto, true));
  const oculto = permitidos ? JSON.stringify(quadroDoVisualizador(ws, contexto, false)) : completo;
  for (const client of destinatarios) {
    if (client.readyState !== WebSocket.OPEN) continue;
    client.send(!permitidos || permitidos.has(client) ? completo : oculto);
  }
}

/**
 * The cursor frame a peer's retained state stands for, whole.
 * @param {import('ws').WebSocket} par
 * @returns {Object}
 */
function quadroDeCursorDoPar(par) {
  const ctx = par.cursorContext ?? {};
  return {
    type: 'cursor',
    clientId: par.clientId ?? null,
    userId: par.userId,
    position: par.cursorPosition ?? null,
    mapId: ctx.mapId ?? null,
    surface: ctx.surface ?? '2d',
    tilesetId: ctx.tilesetId ?? null,
    photoName: ctx.photoName ?? null,
  };
}

/**
 * The selection frame a peer's retained state stands for, whole.
 * @param {import('ws').WebSocket} par
 * @returns {Object}
 */
function quadroDeSelecaoDoPar(par) {
  const ctx = par.selectionContext ?? {};
  return {
    type: 'selection',
    clientId: par.clientId ?? null,
    userId: par.userId,
    surface: ctx.surface ?? '2d',
    featureIds: ctx.featureIds ?? [],
    mapId: ctx.mapId ?? null,
    ...(Array.isArray(ctx.featureMeta) ? { featureMeta: ctx.featureMeta } : {}),
    ...(ctx.tilesetId != null ? { tilesetId: ctx.tilesetId } : {}),
    ...(ctx.photoName != null ? { photoName: ctx.photoName } : {}),
  };
}

/**
 * What a newcomer may be owed about one peer: every retained presence value that names a PRIVATE
 * resource, as (resource, frame builder). The builder answers null when the peer's state changed
 * since it was judged, because that change was relayed to the newcomer already, judged on its own.
 * @param {import('ws').WebSocket} par
 * @returns {Array<[Object, () => (Object|null)]>}
 */
function complementosDoPar(par) {
  const devidos = [];
  const viewer = par.viewerContext;
  if (viewer?.recurso && !escopoLivre(viewer.recurso)) {
    devidos.push([viewer.recurso, () => (par.viewerContext === viewer ? quadroDoVisualizador(par, viewer, true) : null)]);
  }
  const cursor = par.cursorContext;
  const posicao = par.cursorPosition;
  if (par.cursorRecurso && !escopoLivre(par.cursorRecurso) && posicao) {
    devidos.push([par.cursorRecurso, () => (
      par.cursorContext === cursor && par.cursorPosition === posicao ? quadroDeCursorDoPar(par) : null
    )]);
  }
  const selecao = par.selectionContext;
  if (par.selectionRecurso && !escopoLivre(par.selectionRecurso) && selecao?.featureIds?.length) {
    devidos.push([par.selectionRecurso, () => (par.selectionContext === selecao ? quadroDeSelecaoDoPar(par) : null)]);
  }
  return devidos;
}

/**
 * Sends a newcomer the PRIVATE presence it may read, which the join snapshot left redacted: the
 * viewer a peer has open, the pointer inside a private scene, the selection inside one.
 *
 * STALE IS WORSE THAN LATE: the peer may move or change viewer while the question is in flight,
 * and that change was relayed to the newcomer on its own, already judged. So a follow-up only goes
 * out when the peer still holds the SAME state object that was judged.
 * @param {import('ws').WebSocket} novo
 * @returns {Promise<void>}
 */
export async function enviarContextosAoRecemChegado(novo) {
  if (!novo || novo.readyState !== WebSocket.OPEN) return;
  const pares = [...getRoomClients(novo.atlasId)].filter((c) => c !== novo);
  for (const par of pares) {
    for (const [recurso, montar] of complementosDoPar(par)) {
      const permitidos = await quemPodeVer(recurso, [novo], novo.atlasId);
      if (!permitidos.has(novo) || novo.readyState !== WebSocket.OPEN) continue;
      const quadro = montar();
      if (quadro) novo.send(JSON.stringify(quadro));
    }
  }
}
