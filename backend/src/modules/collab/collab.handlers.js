// Path: src/modules/collab/collab.handlers.js
// Individual message type handlers for WebSocket collaboration

import { WebSocket } from 'ws';
import {
  broadcastToRoom, broadcastOperations, enfileirarCursor, difundirRecortado,
} from './collab.rooms.js';
import {
  resolverRecursoDoEscopo, escopoDaSuperficie, redigirCursor, redigirSelecao,
} from './collab.recorte.js';
import * as syncService from '../sync/sync.service.js';
import { pushSchema } from '../sync/sync.schemas.js';
import { assertSyncProtocol } from '../sync/sync-protocol.js';
import { VALIDATION_OPTIONS } from '../../middleware/validate.js';
import { PERMISSION_LEVELS } from '../../middleware/permissions.js';
import {
  cursorPresenceSchema,
  selectionPresenceSchema,
  viewerPresenceSchema,
  validatePresenceFrame,
} from './collab.schemas.js';
import { anunciarContextoDoVisualizador } from './collab.viewer.js';
import { classifyConnectionQuality, adaptiveSettingsFor } from './collab.quality.js';
import { holdOperationFrames, releaseOperationFrames } from './collab.send.js';
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
 * Validates a batch of operations against the shared push schema and returns the VALIDATED value,
 * or null after answering with a VALIDATION_ERROR.
 *
 * THE RETURN VALUE IS THE POINT. This used to keep only `error` and hand `pushOperations` the raw
 * client frame, with no options passed. Both halves of that were bypasses of the schema: without
 * `VALIDATION_OPTIONS` the schema ran with `stripUnknown` off, and without `value` anything the
 * schema NORMALIZED (today: the free-form JSONB scrub of `free-field.schemas.js`) was computed and
 * thrown away. The HTTP door does `req.body = value`; this one has to do the same, or the same
 * schema means two different things depending on which door the op came through.
 *
 * @param {import('ws').WebSocket} ws
 * @param {Array<Object>} ops
 * @returns {Array<Object>|null}
 */
function validateOps(ws, ops) {
  try {
    assertSyncProtocol(ops);
  } catch (error) {
    ws.send(JSON.stringify({ type: 'error', code: error.code, message: error.message,
      opIds: ops.map(op => op?.id).filter(Boolean), retryable: false }));
    return null;
  }
  const { error, value } = pushSchema.validate({ operations: ops }, VALIDATION_OPTIONS);
  if (error) {
    ws.send(JSON.stringify({
      type: 'error',
      code: 'VALIDATION_ERROR',
      message: error.message,
    }));
    return null;
  }
  return value.operations;
}

/**
 * Validates an EPHEMERAL presence frame (cursor/selection) and returns the
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
 * O frame de erro do socket, agora ATRIBUIVEL e com o sinal de re-tentativa.
 *
 * O PROBLEMA QUE ELE RESOLVE, medido. Sob contencao, o caminho REST responde 503 com mensagem
 * retentavel e o cliente sabe que NADA foi aplicado. O socket colapsava todo throw num
 * `{ type, code, message }` sem `opIds` e sem referencia ao lote: com mais de um lote em voo, o
 * cliente nao tinha como saber O QUE reenviar. A bancada E3, com 16 escritores e lote de 250,
 * mediu 750 operacoes nesse limbo numa unica janela.
 *
 * DOIS CAMPOS, E OS DOIS SAO ADITIVOS. `code` e `message` ficam intactos de proposito: dois testes
 * fixam `code === 'OPERATION_FAILED'` para casos que continuam sendo exatamente isso
 * (`collab-error-leak.repro` e `collab-commenter-authz`), e trocar o codigo por `err.code`
 * transformaria uma recusa de permissao em `FORBIDDEN` no fio, que e mudanca de contrato e nao
 * cabe num conserto de atribuicao.
 *
 * `retryable` sai do `statusCode`, nunca do `code`. O 503 do `lock_timeout` e a unica falha deste
 * caminho que o cliente DEVE reenviar; recusa de permissao e violacao de integridade sao
 * permanentes, e reenvia-las e so gastar a fila. Reenviar e seguro por causa do
 * `ON CONFLICT (atlas_id, op_id) DO NOTHING`, entao o risco do sinal errado e desperdicio, nunca
 * duplicata.
 *
 * OS `opIds` SAO DO PROPRIO REMETENTE, e voltam so para ele. Nao ha vazamento: ele acabou de
 * escrever esses valores. O teste `collab-error-leak.repro.js` exige que o frame inteiro nao
 * contenha separador de caminho, e continua valendo, porque o que entra aqui e o id que o cliente
 * mandou, nunca texto de driver.
 *
 * @param {Error} err
 * @param {string[]} opIds - As ops do lote que falhou, na ordem em que chegaram.
 */
function frameDeErro(err, opIds) {
  return {
    type: 'error',
    code: 'OPERATION_FAILED',
    message: safeErrorMessage(err, 'A operação falhou.'),
    opIds,
    retryable: err?.statusCode === 503,
  };
}

/**
 * Handles ping messages (heartbeat).
 */
export function handlePing(ws) {
  ws.isAlive = true;
  ws.send(JSON.stringify({ type: 'pong' }));
}

/**
 * Handles cursor position updates. Ungated by ROLE by design (a read-only viewer shares its
 * cursor), which is exactly why the payload must be normalized before it is retained on the
 * socket.
 *
 * THE PUBLIC VISITOR IS THE EXCEPTION (owner, 2026-09-20): its POSITION is neither retained nor
 * relayed. Whoever opens a public link is not a collaborator, and an anonymous pointer wandering
 * over the map of the people working is noise. The position is dropped HERE and not only in the
 * client, so a modified client propagates nothing either. The FRAME still goes out, with the
 * position nulled, because it is the only carrier of the ACTIVE MAP: the roster keeps knowing
 * which map each visitor is on, and the count of visitors never depended on the cursor (they are
 * in `getRoomUsers` from the join to the close).
 *
 * THE SCOPE IS CUT PER RECIPIENT (owner, 2026-09-22). A cursor on the 3D, walkable-scene or 360
 * surface names the resource it points into (`tilesetId`/`photoName`), and its position is a
 * point INSIDE that resource. Until this date both went to the whole room. Now the scope is
 * resolved against the catalog (`resolverRecursoDoEscopo`, collab.recorte.js) and a PRIVATE one
 * goes whole only to the recipients `fn_can_see_resource` frees in this atlas; the rest receive
 * the frame without the scope and without the position (`redigirCursor`), which is what clears
 * the pointer they were drawing. The map cursor has no scope and never waits for anything.
 * @param {import('ws').WebSocket} ws
 * @param {Object} data - Raw parsed frame.
 * @returns {Promise<void>}
 */
export async function handleCursor(ws, data) {
  const normalizado = normalizePresence(ws, cursorPresenceSchema, data);
  if (!normalizado) return;
  const value = ws.isPublic ? { ...normalizado, position: null } : normalizado;
  const escopo = escopoDaSuperficie(value);
  const recurso = escopo.tilesetId || escopo.photoName
    ? await resolverRecursoDoEscopo(value, ws)
    : null;
  // Closed during the lookup: its `user_left` already went out, and retaining or relaying now
  // would bring it back to the peers' roster.
  if (ws.readyState !== WebSocket.OPEN) return;

  ws.cursorPosition = value.position;
  ws.currentMapId = value.mapId;
  // A SUPERFICIE FICA RETIDA JUNTO COM A POSICAO, e o motivo e o snapshot de quem entra depois:
  // `getRoomUsers` monta o roster a partir do que esta no socket, entao um cursor de 360 retido
  // sem superfície volta como cursor de MAPA para o late-joiner, que o desenharia num lugar que
  // nao significa nada. Espelha o `selectionContext`, que ja existia pela mesma razao. O RECURSO
  // do escopo fica ao lado, e e ele que decide o que o retrato mostra a todos.
  ws.cursorContext = {
    surface: value.surface,
    mapId: value.mapId,
    tilesetId: escopo.tilesetId,
    photoName: escopo.photoName,
  };
  ws.cursorRecurso = recurso;

  const quadro = {
    // `clientId` is NOT optional here, even though the frontend's `resolveKey` falls
    // back to `userId`: the roster is KEYED by clientId (collab.rooms.js:176), so an
    // awareness frame carrying only userId does not update the existing entry, it
    // CREATES A SECOND ONE. The peer then shows two roster rows per person, one with
    // a name and no cursor and one with a cursor labelled by the raw UUID.
    clientId: ws.clientId ?? null,
    userId: ws.userId,
    position: value.position,
    mapId: value.mapId,
    // O escopo viaja no mesmo quadro para quem pode ve-lo: quem filtra por superficie e o
    // cliente, como ja faz com `mapId` e com a selecao.
    surface: value.surface,
    tilesetId: escopo.tilesetId,
    photoName: escopo.photoName,
  };

  // O AGRUPAMENTO DECIDE, E O CAMINHO ANTIGO FICA INTEIRO. Com `WS_CURSOR_BATCH_MS` em zero o
  // quadro sai na hora, exatamente como antes, e e assim que se mede o antes contra o depois na
  // mesma bancada. Ver a nota longa em `collab.rooms.js`. Os dois caminhos recortam pelo mesmo
  // recurso.
  if (enfileirarCursor(ws.atlasId, quadro, recurso)) return;

  await difundirRecortado(ws, { ...quadro, type: 'cursor' }, recurso, redigirCursor);
}

// NÃO EXISTE MAIS TRATADOR DO QUADRO DE LINHA DO TEMPO, e a ausência é decisão do dono
// (2026-09-21). Havia aqui um "caso E" que retinha o instante do emissor no socket e o
// retransmitia à sala, e `getRoomUsers` o entregava a quem entrasse depois. A presença passou a
// dizer só se a pessoa está no mapa; o instante é visualização de cada um, como já eram o ligar e
// desligar, a reprodução e a velocidade desde 2026-09-20. Um cliente ANTIGO ainda manda o quadro,
// e ele cai no `default` do roteamento do gateway: registrado como tipo desconhecido, sem erro ao
// remetente, sem retransmissão e sem derrubar o socket. Não reponha um tratador para "não perder
// o quadro": o ponto é justamente não ter para onde levá-lo.

/**
 * Handles feature selection updates (live presence awareness, across the 2D map,
 * 3D and 360 surfaces).
 *
 * Gated to editors-and-above: owner / manage / write broadcast their selection.
 * A Comentarista (`comment`) or Visualizador (`read`) only RECEIVES peers'
 * selections — it never emits its own. (The cursor stays ungated; selection
 * is intentionally stricter, per product decision.) Selection is ephemeral: the
 * context is held in-memory on the ws object for the join snapshot and never
 * persisted.
 *
 * The payload carries `surface` ('2d'|'3d'|'360') plus its scope: `mapId` for 2D,
 * `tilesetId` for 3D, `photoName` for 360. `featureMeta` (optional) ships the
 * per-feature type so a 2D peer can resolve the right highlight without a lookup.
 *
 * THE SCOPE IS CUT PER RECIPIENT, like the cursor's (2026-09-22): a selection inside a PRIVATE
 * model or 360 photo goes whole only to who may see that resource, and the rest receive an EMPTY
 * selection on the same surface (`redigirSelecao`), which clears the highlight they were drawing.
 * @param {import('ws').WebSocket} ws
 * @param {Object} data - Raw parsed frame.
 * @returns {Promise<void>}
 */
export async function handleSelection(ws, data) {
  // Editor and up. This was a CLOSED LIST of the two tiers that happen to sit below the floor
  // (`read || comment`), and it is the exact shape this codebase has paid for twice: a tier
  // inserted between `comment` and `write` would fall THROUGH the gate, and so would any value a
  // future server sends that this build does not know. The ladder is imported rather than
  // transcribed, and the test is written POSITIVELY (`>= write`) on purpose: `PERMISSION_LEVELS`
  // yields `undefined` for an unknown tier, every comparison against it is false, and only the
  // positive form turns that into a REFUSAL. The negative form (`< write`) reads the same and
  // fails OPEN on the same garbage.
  if (!(PERMISSION_LEVELS[ws.permission] >= PERMISSION_LEVELS.write)) {
    return;
  }

  const value = normalizePresence(ws, selectionPresenceSchema, data);
  if (!value) return;
  const escopo = escopoDaSuperficie(value);
  const recurso = escopo.tilesetId || escopo.photoName
    ? await resolverRecursoDoEscopo(value, ws)
    : null;
  if (ws.readyState !== WebSocket.OPEN) return;

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
    ...(escopo.tilesetId != null ? { tilesetId: escopo.tilesetId } : {}),
    ...(escopo.photoName != null ? { photoName: escopo.photoName } : {}),
  };
  ws.selectionRecurso = recurso;

  await difundirRecortado(ws, {
    clientId: ws.clientId ?? null, // veja o porquê em handleCursor
    type: 'selection',
    userId: ws.userId,
    surface,
    featureIds,
    mapId: value.mapId,
    ...(Array.isArray(value.featureMeta) ? { featureMeta: value.featureMeta } : {}),
    ...(escopo.tilesetId != null ? { tilesetId: escopo.tilesetId } : {}),
    ...(escopo.photoName != null ? { photoName: escopo.photoName } : {}),
  }, recurso, redigirSelecao);
}

/**
 * Handles the VIEWER CONTEXT frame: which immersive viewer (3D model, walkable scene, 360 photo)
 * the sender has open, or `2d` when it closed them (owner, 2026-09-22).
 *
 * Ungated by ROLE, like the cursor: a read-only colleague in the 3D viewer is somewhere too. What
 * IS gated is the resource NAME, per recipient, and that lives in `collab.viewer.js`, together with
 * the rule that the public-link visitor's own context neither travels nor is retained.
 * @param {import('ws').WebSocket} ws
 * @param {Object} data - Raw parsed frame.
 * @returns {Promise<void>}
 */
export async function handleViewer(ws, data) {
  const value = normalizePresence(ws, viewerPresenceSchema, data);
  if (!value) return;
  await anunciarContextoDoVisualizador(ws, value);
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
      message: 'Seu acesso a este atlas é somente leitura.',
    }));
    return;
  }

  const ops = validateOps(ws, [data.op]);
  if (!ops) return;
  // The VALIDATED op from here down, never `data.op`: the raw frame still carries whatever the
  // client wrote into its free-form JSONB fields, and it is this object that gets stored AND
  // relayed to peers.
  const op = ops[0];

  try {
    // A RECUSA POR OPERACAO NAO TEM GEMEO AQUI, e nao ter e a resposta certa. As cinco
    // recusas (atlas alheio, alvo desconhecido, politica, mapa travado, recurso invisivel)
    // e a de violacao de integridade sao TODAS decididas dentro de `pushOperations`, que e
    // o unico caminho de escrita das duas portas; escrever aqui uma segunda montagem da
    // linha agregada produziria duas gramaticas para o mesmo fato, que e exatamente o que
    // uma investigacao nao pode pagar. O que esta porta acrescenta ao registro e a sua
    // IDENTIDADE (`via`), sem a qual a linha nao distingue uma fila congelada no socket de
    // uma congelada no HTTP.
    //
    // O QUE ELA NAO CONSEGUE AGREGAR, dito em voz alta: este frame carrega UMA op, logo o
    // lote e de um, logo um cliente em laco produz aqui uma linha por recusa. A unidade de
    // agregacao e o lote porque e a unidade que o cliente reenvia, e quem quiser o
    // agrupamento manda `operations` (o `handleOperations` abaixo), que e o que este
    // produto faz por REST. Ver `refusedOpsLogPayload` em sync.service.js.
    const result = await syncService.pushOperations(
      ws.atlasId,
      [op],
      ws.userId,
      ws.permission,
      { via: 'ws' }
    );

    // Send ack to sender (per-op result included for confident dequeue)
    ws.send(JSON.stringify({
      type: 'ack',
      opId: op.id,
      serverVersion: result.serverVersion,
      result: result.results[0],
    }));

    // A per-op REFUSAL (locked map, map delete/lock by a non-owner) leaves nothing on the
    // server: no entity row, no log row, no server_version. Relaying it anyway would make the
    // peer apply an edit that does not exist server-side and that no snapshot will ever
    // contain — divergence that only a full resync could clear.
    if (!result.events.length) return;

    // Broadcast operation to peers. A comment op must NOT reach read-only viewers
    // (Visualizador / public visitor) — the spatial-comment visibility rule. Stamp the op with
    // its server arrival order (serverVersion) so peers converge by LWW-by-arrival.
    const isComment = (op?.entityType || op?.target) === 'comment';
    const opOut = result.events[0];
    broadcastToRoom(ws.atlasId, {
      type: 'operation',
      userId: ws.userId,
      op: opOut,
    }, ws, { skipReadOnly: isComment });
  } catch (err) {
    logger.error({ err, atlasId: ws.atlasId }, 'Failed to process operation');
    ws.send(JSON.stringify(frameDeErro(err, [data.op?.id].filter(Boolean))));
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
      message: 'Seu acesso a este atlas é somente leitura.',
    }));
    return;
  }

  if (!Array.isArray(data.ops)) return;
  const ops = validateOps(ws, data.ops);
  if (!ops) return;

  try {
    // `via: 'ws'` pelo mesmo motivo do `handleOperation` acima, e aqui o lote e um lote de
    // verdade: as ops recusadas deste frame saem numa linha so, agrupadas por motivo e por
    // alvo, exatamente como as da porta REST.
    const result = await syncService.pushOperations(
      ws.atlasId,
      ops,
      ws.userId,
      ws.permission,
      { via: 'ws' }
    );

    // Send batch ack to sender (per-op results for confident dequeue)
    ws.send(JSON.stringify({
      type: 'ack_batch',
      opIds: ops.map((op) => op.id),
      serverVersion: result.serverVersion,
      results: result.results,
    }));

    // Broadcast all operations to peers. Comment ops are split out for read-only viewers
    // (a mixed batch still delivers the non-comment ops to them). Stamp each op with its server
    // arrival order (serverVersion) so peers converge by LWW-by-arrival.
    const opsOut = result.events;
    if (opsOut.length > 0) {
      broadcastOperations(ws.atlasId, opsOut, { userId: ws.userId, excludeWs: ws });
    }
  } catch (err) {
    logger.error({ err, atlasId: ws.atlasId }, 'Failed to process operations batch');
    ws.send(JSON.stringify(frameDeErro(err, ops.map((op) => op.id))));
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
    // UUID cru. Cursor e seleção foram corrigidos; estes dois ficaram para trás, e só um
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
  // THE ANSWER MUST REACH THE PEER BEFORE ANY OP IT DOES NOT CARRY. Operation frames addressed to
  // this socket are held from here until the answer is out, then released minus what it covered.
  // See `holdOperationFrames` in `collab.send.js`.
  holdOperationFrames(ws);
  let coveredVersion = -Infinity;
  try {
    // `ws.userId` travels for the same reason the HTTP pull threads `req.user.id`: since F11 the
    // snapshot embeds catalog-layer definitions filtered by what THIS principal may see, and the
    // WS `sync_request` returns the very same snapshot. Omitting it here would have made the two
    // transports disagree about a permission — with the socket being the LESS restrictive of the
    // two, since a snapshot without a principal is public-only.
    //
    // `haveSnapshot` IS THE HANDSHAKE SAYING WHICH ZERO IT MEANS. `lastVersion: 0` alone cannot
    // separate "I hold nothing" from "I am up to date with an atlas that never had an operation
    // written", and the second is every atlas until its first op, so the handshake of every first
    // open was answered with a full snapshot the client had just applied over HTTP. It is read as
    // a STRICT boolean and never coerced: an absent field is what an older client sends, and it
    // has to keep meaning "send me everything". `lastVersion` is deliberately NOT validated here
    // (a non-numeric one still reaches the query and comes back as a generic SYNC_FAILED, pinned
    // by `tests/ws/collab-error-leak.repro.test.js`).
    const result = await syncService.pullOperations(
      ws.atlasId, data.lastVersion || 0, ws.permission, ws.userId ?? null,
      { haveSnapshot: data.haveSnapshot === true },
    );

    // THE OBJECT, NOT THE STRING, and this is the one place in the module where the difference is
    // load-bearing. The outbound boundary (`collab.send.js`) prunes catalog-resource definitions,
    // and the snapshot is the ONLY frame that legitimately carries one: `rehydrateCatalogLayer`
    // resolved it against what this principal may see. That authorization is recorded by object
    // IDENTITY (a wire marker would be forgeable by any client), so it does not survive a
    // `JSON.stringify` done here — serialising before the boundary would strip the very
    // definitions the rehydration just earned, and the layers would arrive as "camada
    // indisponível" for someone who holds the grant. Handing the object over keeps identity.
    // A reduce, not a spread into Math.max: a long tail would overflow the argument list.
    coveredVersion = (result.operations ?? []).reduce(
      (maior, op) => Math.max(maior, Number(op?.serverVersion) || 0),
      Number(result.currentVersion) || 0,
    );
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
      message: safeErrorMessage(err, 'A sincronização falhou.'),
    }));
  } finally {
    releaseOperationFrames(ws, coveredVersion);
  }
}
