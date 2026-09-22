// Path: src/modules/collab/collab.recorte.js
/**
 * @fileoverview The PER-RECIPIENT CUT of presence: which catalog resource a presence frame points
 * into, and which sockets of the room may learn it (owner, 2026-09-22).
 *
 * THREE FRAMES NAME A RESOURCE, and they share this module so the rule exists once:
 *
 *   - `viewer_context` (collab.viewer.js), the viewer a colleague has open;
 *   - `cursor` on the 3D, walkable-scene and 360 surfaces, whose `tilesetId`/`photoName` is the
 *     scope the receiver draws the pointer in, and whose POSITION is a point inside that resource
 *     (a 3D pick is a geographic coordinate on the model);
 *   - `selection` on the same surfaces, scoped the same way.
 *
 * Until this date the last two went to the whole room, the anonymous public-link visitor
 * included, with the identifier of a private model or 360 photo in clear. The rule now: a PUBLIC
 * resource goes to everyone; a PRIVATE one goes whole only to the recipients for whom
 * `fn_can_see_resource` answers yes IN THE SCOPE OF THIS ATLAS (the loan counts), and REDACTED to
 * the rest. Who decides is the database, through `WHO_SEES_VIEWER_RESOURCE`; nothing here
 * re-spells the rule.
 *
 * AN IDENTIFIER THAT DOES NOT RESOLVE IS PRIVATE TO EVERYONE (a "fantasma" resource), and that is
 * deliberate: relaying the unknown id in clear while redacting the known private one would make
 * the redaction an existence oracle over the private stock (two accounts, one sends guesses, the
 * other reads which ones come back hidden). It is the same NO ROW MEANS REFUSE that the sync
 * write gate applies. A lookup that throws is the same answer.
 *
 * THE MEMOS CARRY THE HOUSE CEILING OF 30 s, the private-asset authorization memo's, for the same
 * reason: a cursor frame arrives up to twelve times a second, and asking the database each time
 * would put presence on the pool that serves sync. The declared price is that a recipient who
 * loses access keeps receiving that resource's frames for up to 30 s, the staleness
 * CONSTITUICAO.md clause 10.3 already accepts for loaded content.
 *
 * NOTHING HERE WRITES: the reads are SELECTs, the memos live in memory and are bounded.
 */

import { query } from '../../database/index.js';
import logger from '../../utils/logger.js';
import * as Q from './collab.queries.js';

/** Ceiling of both memos, in milliseconds. See the fileoverview. */
const MEMO_TTL_MS = 30_000;

/** Entry ceiling of each memo: past it the memo is dropped whole, which is cheap and bounded. */
const MEMO_MAX_ENTRIES = 2000;

/** A bare principal uuid, the only thing `fn_can_see_resource` accepts as a person. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** resource key -> { valor, ate }: what a scope identifier resolves to. */
const memoRecurso = new Map();
/** (principal, atlas, resource) -> { valor, ate }: whether that principal sees that resource. */
const memoVisao = new Map();

/** Test hook: forget both memos. */
export function limparMemosDePresenca() {
  memoRecurso.clear();
  memoVisao.clear();
}

function lerMemo(mapa, chave, agora) {
  const entrada = mapa.get(chave);
  if (!entrada) return undefined;
  if (entrada.ate <= agora) {
    mapa.delete(chave);
    return undefined;
  }
  return entrada.valor;
}

function gravarMemo(mapa, chave, valor, agora) {
  if (mapa.size >= MEMO_MAX_ENTRIES) mapa.clear();
  mapa.set(chave, { valor, ate: agora + MEMO_TTL_MS });
}

/**
 * The person behind a socket, as `fn_can_see_resource` understands one. The public-link visitor
 * (`public-<uuid>`) and anything that is not a bare uuid are NULL: anonymous, which is exactly
 * what they are for the predicate.
 * @param {import('ws').WebSocket} ws
 * @returns {string|null}
 */
export function principalDoSocket(ws) {
  if (!ws || ws.isPublic) return null;
  const id = String(ws.userId ?? '');
  return UUID_RE.test(id) ? id : null;
}

/**
 * The scope keys a frame of this surface may carry, and only those: `tilesetId` for the 3D model
 * and the walkable scene, `photoName` for the 360, neither for the map.
 *
 * CLEANED BY SURFACE on purpose. The schemas accept both keys on every surface, so a 2D frame
 * could carry a `tilesetId` that no rule would look at; keeping only the key the surface uses is
 * what makes "the scope" and "the resource the cut judges" the same thing.
 * @param {{surface?: string, tilesetId?: string|null, photoName?: string|null}} frame - Validated.
 * @returns {{tilesetId: (string|null), photoName: (string|null)}}
 */
export function escopoDaSuperficie(frame) {
  const surface = frame?.surface;
  if (surface === '3d' || surface === 'fp') {
    return { tilesetId: frame.tilesetId || null, photoName: null };
  }
  if (surface === '360') {
    return { tilesetId: null, photoName: frame.photoName || null };
  }
  return { tilesetId: null, photoName: null };
}

/**
 * The stable key of a resolved resource: what groups recipients and keys the visibility memo.
 * @param {{tipo: string, id: (string|null), ref: string}} recurso
 * @returns {string}
 */
export function chaveDoRecurso(recurso) {
  return recurso.id ? `${recurso.tipo}|${recurso.id}` : `${recurso.tipo}|?|${recurso.ref}`;
}

/**
 * Resolves the scope of a frame into the resource it points into.
 *
 * `null` means there is no scope at all (the map, or a frame without an identifier), and nothing
 * to cut. A resource without a row (or whose lookup failed) comes back as a FANTASMA: `id` null,
 * not public, visible to nobody. See the fileoverview for why it is not relayed in clear.
 * @param {{surface?: string, tilesetId?: string|null, photoName?: string|null}} frame - Validated.
 * @param {import('ws').WebSocket} ws - The sender (its organization breaks the 360 tie).
 * @returns {Promise<{tipo: string, id: (string|null), ref: string, nome: string, foto: (string|null),
 *   publico: boolean}|null>}
 */
export async function resolverRecursoDoEscopo(frame, ws) {
  const { tilesetId, photoName } = escopoDaSuperficie(frame);
  const e360 = Boolean(photoName);
  const ref = e360 ? photoName : tilesetId;
  if (!ref) return null;
  const tipo = e360 ? 'sv360_project' : 'tileset';
  const remetente = principalDoSocket(ws);
  const chave = e360 ? `360|${ref}|${remetente ?? ''}` : `tileset|${ref}`;
  const agora = Date.now();
  const memorizado = lerMemo(memoRecurso, chave, agora);
  if (memorizado !== undefined) return memorizado;

  let linha;
  try {
    const { rows } = e360
      ? await query(Q.RESOLVE_VIEWER_360, [[ref], remetente])
      : await query(Q.RESOLVE_VIEWER_TILESET, [ref]);
    linha = rows[0] ?? null;
  } catch (err) {
    logger.warn({ err, atlasId: ws?.atlasId, tipo }, 'presença: recurso do escopo não resolvido');
    // Not memoized: a database blip must not pin the resource as unknown for 30 s.
    return { tipo, id: null, ref, nome: '', foto: null, publico: false };
  }
  const recurso = linha
    ? {
      tipo,
      id: String(linha.id),
      ref,
      nome: String(linha.nome ?? ''),
      foto: e360 && linha.foto ? String(linha.foto) : null,
      publico: linha.nivel === 'public',
    }
    : { tipo, id: null, ref, nome: '', foto: null, publico: false };
  gravarMemo(memoRecurso, chave, recurso, agora);
  return recurso;
}

/**
 * Which of these sockets may learn this resource, in the scope of `atlasId`.
 *
 * Grouped by PRINCIPAL before asking, because two tabs of one person are one question, and every
 * anonymous visitor is the same NULL question. A FANTASMA resource is visible to nobody, without a
 * query. A query that fails answers NOBODY (fail closed): the worst outcome is a colleague seen
 * without the scope, never a scope seen by the wrong person.
 * @param {{tipo: string, id: (string|null), publico: boolean}} recurso
 * @param {Iterable<import('ws').WebSocket>} sockets
 * @param {string} atlasId
 * @returns {Promise<Set<import('ws').WebSocket>>}
 */
export async function quemPodeVer(recurso, sockets, atlasId) {
  const permitidos = new Set();
  if (recurso.publico) {
    for (const s of sockets) permitidos.add(s);
    return permitidos;
  }
  if (!recurso.id) return permitidos;
  const porPrincipal = new Map();
  for (const s of sockets) {
    const chave = principalDoSocket(s) ?? '';
    if (!porPrincipal.has(chave)) porPrincipal.set(chave, []);
    porPrincipal.get(chave).push(s);
  }
  const agora = Date.now();
  const decidido = new Map();
  const faltam = [];
  for (const principal of porPrincipal.keys()) {
    const memorizado = lerMemo(memoVisao, `${principal}|${atlasId}|${chaveDoRecurso(recurso)}`, agora);
    if (memorizado === undefined) faltam.push(principal);
    else decidido.set(principal, memorizado);
  }
  if (faltam.length > 0) {
    try {
      const { rows } = await query(Q.WHO_SEES_VIEWER_RESOURCE, [
        faltam.map((p) => p || null), atlasId, recurso.tipo, recurso.id, 'private',
      ]);
      for (const row of rows) {
        const principal = faltam[row.i - 1];
        const ok = row.ok === true;
        decidido.set(principal, ok);
        gravarMemo(memoVisao, `${principal}|${atlasId}|${chaveDoRecurso(recurso)}`, ok, agora);
      }
    } catch (err) {
      logger.warn({ err, atlasId, tipo: recurso.tipo }, 'presença: não foi possível decidir quem vê o recurso');
    }
  }
  for (const [principal, lista] of porPrincipal) {
    if (decidido.get(principal) !== true) continue;
    for (const s of lista) permitidos.add(s);
  }
  return permitidos;
}

/**
 * Whether a resolved scope is free to go to the whole room: no scope at all, or a public resource.
 * @param {Object|null} recurso
 * @returns {boolean}
 */
export function escopoLivre(recurso) {
  return !recurso || recurso.publico === true;
}

/**
 * A cursor frame for a recipient that may NOT read its scope: the scope id AND the position go.
 *
 * THE POSITION GOES TOO, and it is the half that matters most: inside a 3D model it is a
 * geographic coordinate on the model, which places a private resource on the map. The frame is
 * kept rather than dropped because the receiver's store has to learn that the colleague left the
 * surface it was drawing them on: without it, the last 2D pointer of a colleague who went into a
 * private model would stay frozen on the map. `surface` and `mapId` stay, which say no more than
 * the viewer context already says ("no visualizador 3D", on map M).
 * @param {Object} quadro
 * @returns {Object}
 */
export function redigirCursor(quadro) {
  return { ...quadro, position: null, tilesetId: null, photoName: null };
}

/**
 * A selection frame for a recipient that may NOT read its scope: an EMPTY selection on the same
 * surface, which is what clears whatever highlight that receiver was drawing for the colleague.
 * The marker ids and the per-feature types go with the scope.
 * @param {Object} quadro
 * @returns {Object}
 */
export function redigirSelecao(quadro) {
  return {
    type: quadro.type,
    clientId: quadro.clientId ?? null,
    userId: quadro.userId,
    surface: quadro.surface,
    featureIds: [],
    mapId: quadro.mapId ?? null,
  };
}
