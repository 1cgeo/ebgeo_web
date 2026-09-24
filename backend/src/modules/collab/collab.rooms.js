// Path: src/modules/collab/collab.rooms.js
// In-memory room management for WebSocket collaboration

import { recordSpan, isTraceEnabled, TraceStage, TraceOutcome } from '../../utils/sync-trace.js';
import { PERMISSION_LEVELS } from '../../middleware/permissions.js';
import { pruneResourcePayload } from '../catalog/resource-payload.prune.js';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { quemPodeVer, escopoLivre, chaveDoRecurso, redigirCursor } from './collab.recorte.js';
import {
  TIPOS_DE_PRESENCA, fluxoLigado, entregarPresenca, esquecerRemetente,
} from './collab.fluxo.js';

const rooms = new Map(); // atlasId -> Set<WebSocket>

// Backpressure thresholds (bytes of un-drained outbound buffer per socket). One slow client must
// not back up the whole room. Coalescable presence frames (cursor/selection) go through the
// per-recipient flow control of `collab.fluxo.js`, which retains the latest one per sender while
// the recipient has not received the previous one; the buffer threshold below only closes that
// window early (it alone never fired behind a real slow link, see that file). A socket past the
// hard ceiling is terminated so it reconnects and replays via sync_request; dropping a durable op
// would silently diverge that peer instead.
const COALESCABLE_TYPES = TIPOS_DE_PRESENCA;
const BACKPRESSURE_DROP_BYTES = 1 << 20; // 1 MiB — hold coalescable presence frames
const BACKPRESSURE_KILL_BYTES = 8 << 20; // 8 MiB — terminate a hopelessly backed-up socket

/**
 * Adds a WebSocket to an atlas room.
 */
export function joinRoom(atlasId, ws) {
  if (!rooms.has(atlasId)) {
    rooms.set(atlasId, new Set());
  }
  rooms.get(atlasId).add(ws);
}

/**
 * Removes a WebSocket from an atlas room.
 */
export function leaveRoom(atlasId, ws) {
  const room = rooms.get(atlasId);
  if (room) {
    room.delete(ws);
    if (room.size === 0) {
      rooms.delete(atlasId);
    }
  }
}

/**
 * Gets all clients in a room.
 */
export function getRoomClients(atlasId) {
  return rooms.get(atlasId) || new Set();
}

/**
 * Broadcasts a message to all clients in a room, optionally excluding the sender.
 *
 * Two independent recipient filters, because the room is NOT an audience:
 * - `opts.skipReadOnly` skips read-only connections (Visualizador / public visitor) — the
 *   spatial-comment visibility rule.
 * - `opts.minPermission` delivers only to sockets at or above a level of the atlas hierarchy
 *   (`read < comment < write < manage < owner`), with `opts.alsoUserIds` as an explicit
 *   allow-list of affected users who receive it whatever their level. This is what a frame
 *   carrying data the REST route gates must use: `skipReadOnly` alone is NOT equivalent, since
 *   it still delivers to `comment` and `write` — the closed-list mistake this repo has made
 *   twice. Comparison is by LEVEL, never by equality, and an unknown/absent `client.permission`
 *   scores 0, so the gate fails closed.
 *
 * @param {string} atlasId
 * @param {Object|string} message
 * @param {import('ws').WebSocket|null} [excludeWs]
 * - `opts.somenteA` restricts delivery to the sockets of that set (still subject to the checks
 *   above): it is how one audience class of a per-recipient cut is served in one serialization.
 *
 * @param {{ skipReadOnly?: boolean, minPermission?: string|null, alsoUserIds?: string[]|null,
 *   somenteA?: Set<import('ws').WebSocket>|null }} [opts]
 * @throws {TypeError} When `minPermission` is not a known level (a typo must be loud, not silently
 *   deliver to nobody — the failure mode of a fail-closed default here is an invisible outage).
 */
export function broadcastToRoom(
  atlasId,
  message,
  excludeWs = null,
  { skipReadOnly = false, minPermission = null, alsoUserIds = null, somenteA = null } = {}
) {
  const minLevel = minPermission == null ? 0 : PERMISSION_LEVELS[minPermission];
  if (minPermission != null && !minLevel) {
    throw new TypeError(`broadcastToRoom: unknown minPermission "${minPermission}"`);
  }
  const allowedUsers = alsoUserIds?.length ? new Set(alsoUserIds.map(String)) : null;

  const room = rooms.get(atlasId);
  if (!room) return { sent: 0, recipients: [] };

  const coalescable = typeof message === 'object' && message !== null && COALESCABLE_TYPES.has(message.type);
  // Pruned as an OBJECT, once, before the fan-out. The per-socket boundary (`collab.send.js`)
  // would catch it anyway, but it would catch it N times over a serialized string; doing it here
  // means the string handed to every socket carries no discriminator, so each of them pays one
  // substring scan and no parse. Cost and correctness point the same way.
  const payload = typeof message === 'string'
    ? message
    : JSON.stringify(pruneResourcePayload(message));

  const fluxo = coalescable && fluxoLigado();
  const recipients = [];
  for (const client of room) {
    if (client === excludeWs || client.readyState !== 1) continue; // WebSocket.OPEN = 1
    // The per-recipient cut of a presence frame that names a private resource
    // (`difundirRecortado`, below): each audience class gets its own serialization.
    if (somenteA && !somenteA.has(client)) continue;
    if (skipReadOnly && client.permission === 'read') continue;
    if (minLevel) {
      const level = PERMISSION_LEVELS[client.permission] ?? 0;
      const affected = allowedUsers?.has(String(client.userId ?? '')) ?? false;
      if (level < minLevel && !affected) continue;
    }
    const buffered = client.bufferedAmount || 0;
    if (buffered > BACKPRESSURE_KILL_BYTES) { client.terminate?.(); continue; } // drowning → reconnect+replay
    if (fluxo) {
      // Sent now, or retained and delivered coalesced once this recipient caught up: either way it
      // receives the latest state, so it counts as a recipient.
      const bufferAlto = buffered > BACKPRESSURE_DROP_BYTES;
      if (entregarPresenca(client, message, payload, { bufferAlto }) || typeof client.ping === 'function') {
        recipients.push(client.clientId || client.userId);
      }
      continue;
    }
    if (coalescable && buffered > BACKPRESSURE_DROP_BYTES) continue; // superseded by the next frame
    client.send(payload);
    recipients.push(client.clientId || client.userId);
  }
  return { sent: recipients.length, recipients };
}

/**
 * Broadcasts an operations batch honoring the spatial-comment visibility rule: read-only
 * connections never receive `comment` ops. Non-comment ops go to everyone except the sender; a
 * MIXED batch is split so read clients still get the non-comment ops.
 * @param {string} atlasId
 * @param {Object[]} ops - The operation batch.
 * @param {{ userId?: string, excludeWs?: import('ws').WebSocket|null }} [opts]
 */
export function broadcastOperations(atlasId, ops, { userId, excludeWs = null } = {}) {
  const room = rooms.get(atlasId);
  if (!room || !Array.isArray(ops) || ops.length === 0) return { sent: 0, recipients: [] };

  // Pruned by CONTENT, before the fan-out. `sync.controller.js` (HTTP push) and
  // `collab.handlers.js` (WS push) each re-broadcast the pusher's payload verbatim, and a client
  // still stamps the catalog-layer DEFINITION into what it writes. Relayed as-is, that URL reaches
  // every socket in the room — the anonymous public-link visitor included, who holds `read`.
  //
  // THIS IS NOT THE GUARANTEE, ONLY THE CHEAP HALF OF IT, and saying otherwise is what cost F12 a
  // whole phase: the comment that used to sit here concluded that "a third relay caller is covered
  // by construction", and a fourth relay caller (`handleOperation`, which broadcasts a SINGULAR
  // `operation` frame and never touches this function) was live the whole time. What covers every
  // relay, counted or not, is the per-socket boundary in `collab.send.js`. Pruning here as well
  // keeps the fan-out from paying for it once per recipient. See `catalog/resource-payload.prune.js`.
  const servedOps = pruneResourcePayload(ops);

  const fullPayload = JSON.stringify({ type: 'operations', userId, ops: servedOps });
  const nonComment = servedOps.filter((o) => o && (o.entityType || o.target) !== 'comment');
  const hasComment = nonComment.length !== servedOps.length;
  const readPayload = nonComment.length
    ? JSON.stringify({ type: 'operations', userId, ops: nonComment })
    : null;

  const recipients = [];
  let skippedSelf = 0;
  let skippedClosed = 0;
  let skippedReadOnly = 0;
  for (const client of room) {
    if (client === excludeWs) { skippedSelf++; continue; }
    if (client.readyState !== 1) { skippedClosed++; continue; }
    // Durable ops are never dropped; a hopelessly backed-up socket is terminated so it reconnects
    // and replays missed ops via sync_request (a silent drop would diverge it).
    if ((client.bufferedAmount || 0) > BACKPRESSURE_KILL_BYTES) { client.terminate?.(); skippedClosed++; continue; }
    if (!hasComment || client.permission !== 'read') {
      client.send(fullPayload);
      recipients.push(client.clientId || client.userId);
    } else if (readPayload) {
      client.send(readPayload);
      recipients.push(client.clientId || client.userId);
    } else {
      // read-only client + all-comment batch → nothing sent.
      skippedReadOnly++;
    }
  }

  const summary = { sent: recipients.length, recipients, skippedSelf, skippedClosed, skippedReadOnly };

  // SyncLedger: turn the historically fire-and-forget fan-out into an assertable span
  // (invariant I7 — who received an op, and why someone didn't).
  if (isTraceEnabled()) {
    for (const op of ops) {
      recordSpan(atlasId, TraceStage.SERVER_BROADCAST, {
        opId: op.id,
        traceId: op.traceId,
        entityType: op.entityType || op.target,
        sent: summary.sent,
        recipients: summary.recipients,
        skippedSelf,
        skippedClosed,
        skippedReadOnly,
        outcome: TraceOutcome.OK,
      });
    }
  }

  return summary;
}

/**
 * Broadcasts a message to all clients in a room, then closes all connections.
 * Used when an atlas is deleted to notify and disconnect all users.
 */
export function closeRoom(atlasId, message) {
  const room = rooms.get(atlasId);
  if (!room) return;

  const payload = typeof message === 'string' ? message : JSON.stringify(message);

  for (const client of room) {
    if (client.readyState === 1) {
      client.send(payload);
      client.close(4001, 'Atlas deleted');
    }
  }

  rooms.delete(atlasId);
}

/**
 * Gets user info for all connected clients in a room.
 */
export function getRoomUsers(atlasId) {
  const room = rooms.get(atlasId);
  if (!room) return [];

  const users = [];
  for (const client of room) {
    if (client.userId) {
      // ESTE RETRATO É O MESMO PARA TODO RECÉM-CHEGADO e é montado sem ir ao banco, então ele leva
      // do cursor e da seleção só o que TODO membro pode ler (2026-09-22): escopo de recurso
      // PRIVADO (ou que não resolve) sai sem o identificador, sem a posição e sem os marcadores,
      // e quem pode lê-lo recebe o quadro inteiro à parte (`enviarContextosAoRecemChegado`).
      const cursorLivre = escopoLivre(client.cursorRecurso);
      const selecaoLivre = escopoLivre(client.selectionRecurso);
      users.push({
        id: client.userId,
        // O snapshot precisa da MESMA identidade dos frames ao vivo: o
        // `resolveKey` do frontend prefere `clientId`, então um roster sem ele
        // era chaveado por `userId` e nunca casava com o `user_away`/`user_back`
        // que chegava depois. O valor sempre esteve aqui, só não era exposto.
        clientId: client.clientId ?? null,
        nome: client.userName,
        nome_guerra: client.userWarName ?? null,
        posto_graduacao: client.userPosto,
        mapId: client.currentMapId,
        cursorPosition: cursorLivre ? client.cursorPosition : null,
        // Superficie e escopo do cursor (2d/3d/360), pelo mesmo motivo do `selectionContext`
        // logo abaixo: sem eles o late-joiner desenha um cursor de panorama sobre o mapa.
        cursorContext: cursorLivre || !client.cursorContext
          ? client.cursorContext
          : { ...client.cursorContext, tilesetId: null, photoName: null },
        // B-be2: late-joiners get peers' current selection in the join snapshot.
        selectedFeatures: selecaoLivre ? client.selectedFeatures : [],
        // Full selection context (surface 2d/3d/360 + scope) so a late-joiner can
        // render a peer's 3D/360 selection, not just the 2D featureIds.
        selectionContext: selecaoLivre || !client.selectionContext
          ? client.selectionContext
          : {
            surface: client.selectionContext.surface,
            mapId: client.selectionContext.mapId ?? null,
            featureIds: [],
          },
        // O VISUALIZADOR ABERTO (3D, cena caminhável, 360), na projeção que TODO membro pode ler:
        // o recurso só aparece quando é público. O privado chega a quem pode lê-lo num quadro
        // `viewer` à parte, depois de o servidor perguntar por ele (`enviarContextosAoRecemChegado`,
        // collab.viewer.js), porque este retrato é o MESMO para todo recém-chegado e é montado
        // sem ir ao banco. `null` é "está no mapa".
        viewer: client.viewerContext?.paraTodos ?? null,
        // O INSTANTE DA LINHA DO TEMPO NÃO ENTRA NESTE RETRATO (dono, 2026-09-21): havia aqui
        // uma chave que devolvia a quem entrasse depois o instante em que cada par estava, e o
        // quadro que a alimentava saiu inteiro. A presença diz em que MAPA a pessoa está, não
        // em que momento da linha do tempo ela olha.
        // Fase 8 (Tarefa 2): a client kept in the room during the away grace
        // window (abnormal close) is reported as `away`; live ones as `online`.
        status: client.away ? 'away' : 'online',
      });
    }
  }
  return users;
}

/**
 * Gets the number of clients in a room.
 */
export function getRoomSize(atlasId) {
  const room = rooms.get(atlasId);
  return room ? room.size : 0;
}

// =================================================================================================
// AGRUPAMENTO DE CURSOR
//
// O CUSTO QUE ISTO ATACA, medido. A sala e `atlasId -> Set<WebSocket>` e nao tem subcanal, entao
// cada quadro de cursor vira uma escrita em socket POR PAR. Com `S` membros e uma fracao `f` deles
// movendo o mouse a 12,5 quadros por segundo (o throttle do cliente e de 80 ms), o servidor escreve
// `S x f x 12,5 x (S - 1)` vezes por segundo. Dobrar a sala QUADRUPLICA o trabalho.
//
// A bancada mediu o teto: a sala de 100 entrega 60.636 quadros/s dos 61.707 que o desenho pede; a
// de 200 pede 246.302 e entrega 46.436; a de 400 pede 971.086 e entrega os mesmos 46 mil. Acima do
// teto o servidor gasta CPU DECIDINDO DESCARTAR, e a latencia de escrita vai junto: o ack mediano
// sai de 16 ms na sala de 50 para 3,8 s na de 100.
//
// O QUE MUDA. Em vez de retransmitir cada quadro, guarda-se o ULTIMO de cada cliente e emite-se um
// lote por sala a cada `cursorBatchMs`. As escritas caem de `S x f x 12,5 x (S-1)` para `S x 10`
// por segundo: na sala de 400, de 971.086 para cerca de 4.000.
//
// POR QUE O REMETENTE NAO E EXCLUIDO. O ganho vem de serializar UMA vez por sala. Excluir cada
// remetente exigiria um payload por destinatario, que e exatamente o custo que se quer eliminar. O
// lote carrega `clientId` e o cliente descarta o proprio eco, que e o mesmo gesto que ele ja faz
// com operacoes (ver `client-id-estavel`).
//
// PERDER QUADRO INTERMEDIARIO E O OBJETIVO, NAO UM EFEITO COLATERAL. Presenca nao tem historia: so
// a ultima posicao importa. O que se perde e granularidade, de 80 ms para `cursorBatchMs`.
//
// UM TEMPORIZADOR SO, PARA TODAS AS SALAS. Um por sala custaria um `setInterval` por atlas aberto,
// e o `unref` impede que ele segure o processo no encerramento.
// =================================================================================================

/**
 * O intervalo do lote, lido VIVO do ambiente, com o `config` como piso.
 *
 * A leitura viva segue o mesmo padrao que `RATE_LIMIT_FORCE` e `EBGEO_TRACE` ja usam neste
 * repositorio, e aqui ela paga duas contas de uma vez. Operacionalmente, permite desligar o
 * agrupamento sem novo deploy, que e a valvula que se quer ter para uma mudanca de contrato no fio.
 * E de teste, permite exercitar os dois regimes no mesmo processo: `config.ws` e `Object.freeze`,
 * entao a propriedade nao se redefine, e sem isto o caminho antigo ficaria sem cobertura.
 */
function intervaloDeLote() {
  const bruto = process.env.WS_CURSOR_BATCH_MS;
  if (bruto === undefined || bruto === '') return config.ws.cursorBatchMs;
  const n = parseInt(bruto, 10);
  return Number.isFinite(n) ? n : config.ws.cursorBatchMs;
}

/**
 * atlasId -> Map<clientId, { quadro, recurso }>. So o ULTIMO quadro de cada cliente sobrevive, e
 * ele viaja com o RECURSO do escopo ja resolvido (`resolverRecursoDoEscopo`, collab.recorte.js),
 * que fica no servidor: e ele que decide quem recebe o quadro inteiro.
 */
const cursoresPendentes = new Map();
let temporizadorDeCursor = null;

/**
 * As descargas em SERIE. Com escopo privado no lote a descarga pergunta ao banco quem pode ve-lo
 * (so no memo vencido, a cada 30 s), e duas descargas em voo ao mesmo tempo poderiam entregar o
 * lote velho DEPOIS do novo. Encadeadas, a ordem de chegada e a ordem dos tiques.
 */
let cadeiaDeDescarga = Promise.resolve();

/**
 * Emite o lote de cada sala com pendencia e desarma o temporizador quando nao ha mais nada.
 *
 * O RETRATO DAS PENDENCIAS E TIRADO NA HORA, e a emissao pode esperar a pergunta ao banco: o que
 * chegar depois deste tique vai para o proximo lote, nunca para este.
 */
function descarregarCursores() {
  const lotes = [];
  for (const [atlasId, porCliente] of cursoresPendentes) {
    if (porCliente.size === 0) continue;
    lotes.push([atlasId, [...porCliente.values()]]);
    porCliente.clear();
  }
  cursoresPendentes.clear();
  if (temporizadorDeCursor) {
    clearInterval(temporizadorDeCursor);
    temporizadorDeCursor = null;
  }
  if (lotes.length === 0) return;
  cadeiaDeDescarga = cadeiaDeDescarga
    .then(() => emitirLotesDeCursor(lotes))
    .catch((err) => logger.warn({ err }, 'presença: lote de cursor não emitido'));
}

/**
 * Emite os lotes de um tique, RECORTADOS POR DESTINATARIO quando algum escopo e privado.
 *
 * O CUSTO FICA O DO LOTE (decisao de 2026-08-28): sem escopo privado, UMA serializacao por sala,
 * como antes. Com escopo privado, os destinatarios sao agrupados pela ASSINATURA do que podem ver
 * (o conjunto de recursos privados do lote que o predicado libera para cada um), e cada grupo
 * recebe UMA serializacao; na pratica sao duas classes, quem ve e quem nao ve. O que um grupo nao
 * pode ver sai redigido (`redigirCursor`): sem escopo e sem posicao.
 *
 * QUEM JA SAIU DA SALA NAO ENTRA NO LOTE, e a conferencia e feita AQUI, depois de qualquer espera:
 * `descartarCursorPendente` tira o quadro de quem sai antes do tique, mas o `user_left` pode
 * acontecer entre o tique e a emissao, e o quadro dele chegaria ao par depois do anuncio.
 * @param {Array<[string, Array<{quadro: Object, recurso: Object|null}>]>} lotes
 * @returns {Promise<void>}
 */
async function emitirLotesDeCursor(lotes) {
  for (const [atlasId, itens] of lotes) {
    const privados = new Map();
    for (const { recurso } of itens) {
      if (!escopoLivre(recurso)) privados.set(chaveDoRecurso(recurso), recurso);
    }
    const permitidosPor = new Map();
    if (privados.size > 0) {
      const destinatarios = [...getRoomClients(atlasId)].filter((c) => c.readyState === 1);
      for (const [chave, recurso] of privados) {
        permitidosPor.set(chave, await quemPodeVer(recurso, destinatarios, atlasId));
      }
    }

    const presentes = new Set();
    for (const c of getRoomClients(atlasId)) presentes.add(c.clientId ?? c.userId);
    const vivos = itens.filter(({ quadro }) => presentes.has(quadro.clientId ?? quadro.userId));
    if (vivos.length === 0) continue;

    if (privados.size === 0) {
      // Sem `excludeWs`: uma serializacao para a sala inteira, e cada cliente descarta o proprio.
      broadcastToRoom(atlasId, { type: 'cursors', lote: vivos.map((i) => i.quadro) });
      continue;
    }

    const grupos = new Map();
    for (const c of getRoomClients(atlasId)) {
      if (c.readyState !== 1) continue;
      const assinatura = [...privados.keys()]
        .filter((chave) => permitidosPor.get(chave)?.has(c))
        .join('\n');
      if (!grupos.has(assinatura)) grupos.set(assinatura, new Set());
      grupos.get(assinatura).add(c);
    }
    for (const [assinatura, grupo] of grupos) {
      const visiveis = new Set(assinatura ? assinatura.split('\n') : []);
      const lote = vivos.map(({ quadro, recurso }) => (
        escopoLivre(recurso) || visiveis.has(chaveDoRecurso(recurso)) ? quadro : redigirCursor(quadro)
      ));
      broadcastToRoom(atlasId, { type: 'cursors', lote }, null, { somenteA: grupo });
    }
  }
}

/**
 * Enfileira um quadro de cursor para sair no proximo lote da sala.
 *
 * @param {string} atlasId
 * @param {Object} quadro - `{ clientId, userId, position, mapId, surface, tilesetId, photoName }`.
 * @param {Object|null} [recurso] - O recurso do escopo, ja resolvido; `null` para o mapa.
 * @returns {boolean} `false` quando o agrupamento esta desligado, e o chamador deve retransmitir
 *   na hora. Devolver um booleano em vez de decidir aqui mantem o caminho antigo intacto e
 *   comparavel, que e o que permite medir antes e depois.
 */
export function enfileirarCursor(atlasId, quadro, recurso = null) {
  const intervalo = intervaloDeLote();
  if (!intervalo || intervalo <= 0) return false;

  let porCliente = cursoresPendentes.get(atlasId);
  if (!porCliente) {
    porCliente = new Map();
    cursoresPendentes.set(atlasId, porCliente);
  }
  // A CHAVE E O `clientId`, e nao o `userId`: duas abas da mesma pessoa sao duas presencas, e o
  // registro da sala e keyed por clientId. Agrupar por usuario faria uma aba apagar a outra.
  porCliente.set(quadro.clientId ?? quadro.userId, { quadro, recurso });

  if (!temporizadorDeCursor) {
    temporizadorDeCursor = setInterval(descarregarCursores, intervalo);
    temporizadorDeCursor.unref?.();
  }
  return true;
}

/**
 * Difunde um quadro de presença (cursor fora do lote, seleção) RECORTADO POR DESTINATÁRIO.
 *
 * Escopo livre (o mapa, ou recurso público) vai inteiro à sala, como sempre foi. Escopo PRIVADO
 * vai inteiro só a quem `fn_can_see_resource` libera no escopo do atlas, e redigido ao resto; um
 * identificador que não resolve é privado para todos (`collab.recorte.js`). Duas serializações, no
 * máximo, e o remetente continua excluído.
 * @param {import('ws').WebSocket} remetente
 * @param {Object} mensagem - O quadro inteiro, com `type`.
 * @param {Object|null} recurso - O recurso do escopo, já resolvido.
 * @param {(mensagem: Object) => Object} redigir - A forma que vai a quem não pode ver.
 * @returns {Promise<void>}
 */
export async function difundirRecortado(remetente, mensagem, recurso, redigir) {
  const atlasId = remetente.atlasId;
  if (escopoLivre(recurso)) {
    broadcastToRoom(atlasId, mensagem, remetente);
    return;
  }
  const destinatarios = [...getRoomClients(atlasId)]
    .filter((c) => c !== remetente && c.readyState === 1);
  if (destinatarios.length === 0) return;
  const permitidos = await quemPodeVer(recurso, destinatarios, atlasId);
  // A espera pode ter atravessado o fechamento do remetente, e o par já recebeu o `user_left`.
  if (remetente.readyState !== 1) return;
  const outros = new Set(destinatarios.filter((c) => !permitidos.has(c)));
  if (permitidos.size > 0) broadcastToRoom(atlasId, mensagem, remetente, { somenteA: permitidos });
  if (outros.size > 0) broadcastToRoom(atlasId, redigir(mensagem), remetente, { somenteA: outros });
}

/**
 * Descarta o quadro PENDENTE de um cliente que acabou de SAIR da sala.
 *
 * O FANTASMA QUE ISTO FECHA (2026-09-22, relato do dono: "ainda diz que tem usuário presente
 * mesmo depois de sair"). O `user_left` sai NA HORA, e o lote de cursor sai no próximo tique de
 * `cursorBatchMs`. Um quadro que chegou antes do fechamento (o mouse ainda andando quando a aba
 * fecha, a pose de 1 s da cena caminhável, o `mouseleave` do 3D a caminho do X da aba) saía DEPOIS
 * do `user_left`, e o par o recebia como um cursor de alguém que não está na lista: o armazém de
 * presença do cliente CRIA a entrada nesse caso, e a pessoa voltava ao roster sem nome, para
 * sempre, porque nada mais anunciaria a saída dela.
 *
 * Quem chama é `removeConnection` (collab.gateway.js), e só no ramo em que o `user_left` É
 * anunciado: com um socket gêmeo vivo (mesmo usuário, mesmo cliente) o quadro pendente é dele.
 * @param {string} atlasId
 * @param {string} chave - O `clientId` (ou o `userId` do quadro sem cliente), a mesma chave de
 *   `enfileirarCursor`.
 */
export function descartarCursorPendente(atlasId, chave) {
  if (chave == null) return;
  cursoresPendentes.get(atlasId)?.delete(chave);
  // The SAME phantom one level down: what the per-recipient flow control retained from this sender
  // for a recipient on a slow link would go out after the `user_left` too (`collab.fluxo.js`).
  for (const client of getRoomClients(atlasId)) esquecerRemetente(client, chave);
}

/** Descarta o que estiver pendente. Usado no encerramento e pelos testes. */
export function limparCursoresPendentes() {
  cursoresPendentes.clear();
  if (temporizadorDeCursor) {
    clearInterval(temporizadorDeCursor);
    temporizadorDeCursor = null;
  }
}
