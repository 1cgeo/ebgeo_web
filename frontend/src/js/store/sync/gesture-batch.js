// Path: js/store/sync/gesture-batch.js

/**
 * @fileoverview O LOTE LÓGICO DE UM GESTO COMPOSTO, que atravessa mais de uma transação.
 *
 * UMA TRANSAÇÃO JÁ É UM LOTE, e para a maioria dos gestos isso basta: `persistOperationIntents`
 * cria as intenções de uma transação por `createBatchOperations`, que cunha um `batchId` e o
 * carimba em todas. Colar, duplicar e importar caem aí, porque escrevem tudo num `addFeatures`
 * só.
 *
 * TRÊS GESTOS NÃO CABEM EM UMA TRANSAÇÃO, e a razão é a trava de documento, não descuido.
 * Converter uma feição cria a nova e remove a de origem; transferir uma camada escreve o
 * registro no destino, as feições no destino e remove na origem; desfazer inverte N feições. Os
 * três awaitam folhas que tomam `withMapDocument` cada uma na sua chave, e a fila de
 * `store/document-lock.js` é FIFO SEM reentrância: uma seção que espera outra seção da mesma
 * chave espera por si mesma, para sempre. A transferência está declarada como composta no
 * cabeçalho daquele arquivo justamente por isso.
 *
 * ENTÃO O LOTE É AMBIENTE, e não um argumento passado de mão em mão. `withGestureBatch` abre uma
 * identidade de gesto, e toda transação que se completar enquanto ela estiver aberta carimba
 * aquele `batchId`, com o `batchIndex` CONTINUANDO de onde a transação anterior parou (o servidor
 * lê pai antes de filho por esse índice). É a mesma forma do `startBatchUndo`
 * (`store/store-state-manager.js`), que já agrupa exatamente estes gestos para o Ctrl+Z e já
 * atravessa await do mesmo jeito.
 *
 * O QUE ESSA FORMA CUSTA, dito em voz alta porque uma ausência se lê como descuido: enquanto um
 * gesto está aberto, uma transação de OUTRA origem que se complete na mesma janela entra no lote
 * e passa a ser recusada junto com ele. A janela é o corpo do gesto (dezenas de milissegundos), e
 * nada em `src/` escreve na store fora de um gesto do usuário (a aplicação de operação remota não
 * usa `runTransaction`). A troca é deliberada: um gesto partido em dois lotes é um defeito que o
 * servidor não tem como detectar, e uma op estranha dentro de um lote é um problema durável que a
 * pessoa vê e reenvia.
 *
 * O GESTO ABERTO SEGURA O ENVIO, e é isso que torna a promessa verdadeira em vez de provável. A
 * fila não entrega ao flush nenhuma operação do lote ainda ABERTO (`openGestureBatchId`, lido por
 * `operation-queue.js`): sem isso, o disparo de 1,5 s caindo entre a primeira e a segunda
 * transação do gesto mandaria a primeira metade sozinha, e o servidor a aplicaria como um gesto
 * completo.
 *
 * ZERO IMPORTS além do gerador de id, por contrato: a fila, a fábrica de operações e as três
 * telas de gesto leem daqui, e nenhuma delas pode arrastar as outras.
 */

import { generateUUID } from '../../utilities/uuid.js';

/**
 * B6.1 (owner decision, 2026-09-24): part size of a gesture above the server ceiling. Mirror of
 * `MAX_OPS_PER_LOGICAL_BATCH` (`operation-factory.js`, itself the mirror of the server's
 * `LOTE_MAX_OPS`), copied because this module imports nothing of the queue side; the equality is
 * asserted by `tests/integration/lote-partido.repro.test.js`.
 * @type {number}
 */
export const GESTURE_PART_SIZE = 200;

/**
 * @typedef {Object} OpenGesture
 * @property {string} id - `batchId` of the first part, and of the whole gesture while it fits.
 * @property {number} nextIndex - Next free `batchIndex`.
 * @property {number} depth - Reentrancy depth.
 * @property {string[]} partIds - `batchId` of each part, created on demand.
 * @property {string[]} lastOpOfPart - Id of the last operation written in each part.
 */

/** @type {OpenGesture|null} */
let aberto = null;

/**
 * The `batchId` of the operation at `index` of a gesture: one per part of
 * {@link GESTURE_PART_SIZE}, so a gesture that fits keeps a single id.
 * @param {OpenGesture} gesto
 * @param {number} index - Absolute `batchIndex` inside the gesture.
 * @returns {string}
 */
function partIdOf(gesto, index) {
    const part = Math.floor(index / GESTURE_PART_SIZE);
    while (gesto.partIds.length <= part) gesto.partIds.push(generateUUID());
    return gesto.partIds[part];
}

/**
 * Records the operation written at `index` and answers what it must depend on: the last
 * operation of the PREVIOUS part, for EVERY operation of a part after the first.
 *
 * EVERY ONE, NOT ONLY THE FIRST. The first version linked only the op that opens a part and let
 * the loader's poisoning by `batchId` hold the rest, which the pending list does not see: after
 * "Aceitar o servidor" on the refused part, the link of the first op went with it and the other
 * 199 left on the next flush without the part they followed. A link on each member is a fact
 * every reader of the queue sees (`PendingBlockade`, `getProblems`, the pending list).
 * @param {OpenGesture} gesto
 * @param {number} index - Absolute `batchIndex`.
 * @param {string} opId - The operation's id.
 * @returns {string|null}
 */
function linkOf(gesto, index, opId) {
    const part = Math.floor(index / GESTURE_PART_SIZE);
    const dependency = part > 0 ? (gesto.lastOpOfPart[part - 1] ?? null) : null;
    gesto.lastOpOfPart[part] = opId;
    return dependency;
}

/**
 * Roda `fn` dentro de um lote lógico único.
 *
 * Reentrante: um gesto aberto dentro de outro (uma conversão feita durante uma transferência)
 * ADERE ao de fora em vez de abrir o seu, porque o de fora é o gesto que a pessoa pediu.
 *
 * ACIMA DO TETO DO SERVIDOR O GESTO VIAJA EM PARTES ENCADEADAS (B6.1, decisão do dono de
 * 2026-09-24). Um lote lógico só, acima de {@link GESTURE_PART_SIZE} operações, era recusado
 * inteiro no cliente: transferir uma camada de mil feições, desfazer uma exclusão em massa. Agora
 * cada parte desse tamanho ganha o seu `batchId`, o `batchIndex` continua de uma parte para a
 * outra, e a primeira operação de cada parte depende (`dependsOn`) da última da parte anterior:
 * a fila não entrega uma parte cuja anterior ficou com problema (`PendingBlockade`,
 * `operation-queue.js`), e o envio manda uma parte por vez, com o recibo antes da seguinte.
 * Então uma parte recusada SEGURA as seguintes, e um membro de grupo nunca sai antes do grupo que
 * o servidor confirmou. O preço declarado: o gesto deixa de ser tudo-ou-nada no servidor.
 *
 * @template T
 * @param {function(): Promise<T>} fn - O corpo do gesto.
 * @returns {Promise<T>} O que `fn` devolveu.
 */
export async function withGestureBatch(fn) {
    if (aberto) {
        aberto.depth += 1;
    } else {
        const id = generateUUID();
        aberto = { id, nextIndex: 0, depth: 1, partIds: [id], lastOpOfPart: [] };
    }
    try {
        return await fn();
    } finally {
        // SEMPRE, inclusive quando `fn` lança: um gesto que ficasse aberto seguraria o envio de
        // tudo o que ele já escreveu pelo resto da sessão.
        aberto.depth -= 1;
        if (aberto.depth <= 0) aberto = null;
    }
}

/**
 * A identidade da parte ABERTA do gesto agora, para quem precisa esperá-la terminar.
 *
 * Só a parte ainda sendo escrita fica retida: uma parte já completa pode sair, e a seguinte a
 * espera pelo encadeamento.
 * @returns {string|null} O `batchId` aberto, ou null.
 */
export function openGestureBatchId() {
    return aberto ? partIdOf(aberto, aberto.nextIndex) : null;
}

/**
 * Reserva `count` posições no lote do gesto aberto.
 *
 * Chamado UMA vez por transação, pela fábrica de operações. Devolve null quando não há gesto
 * aberto, e nesse caso a transação é um lote em si mesma, como sempre foi.
 *
 * @param {number} count - Quantas operações a transação vai criar.
 * @returns {{id: string, startIndex: number, idAt: function(number): string,
 *   link: function(number, string): (string|null)}|null} A identidade, o índice inicial, o
 *   `batchId` de cada posição e o encadeamento entre partes.
 */
export function reserveGestureBatchSlots(count) {
    if (!aberto) return null;
    const startIndex = aberto.nextIndex;
    aberto.nextIndex += count;
    const gesto = aberto;
    return {
        id: gesto.id,
        startIndex,
        idAt: (index) => partIdOf(gesto, index),
        link: (index, opId) => linkOf(gesto, index, opId),
    };
}
