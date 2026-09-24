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
 * B6.1 (owner decision, 2026-09-24): part size of a SPLITTABLE gesture. Mirror of
 * `MAX_OPS_PER_LOGICAL_BATCH` (`operation-factory.js`, itself the mirror of the server's
 * `LOTE_MAX_OPS`), copied because this module imports nothing of the queue side; the equality is
 * asserted by `tests/integration/lote-partido.repro.test.js`.
 * @type {number}
 */
export const GESTURE_PART_SIZE = 200;

/** @type {{id: string, nextIndex: number, depth: number, splittable: boolean, partIds: string[]}|null} */
let aberto = null;

/**
 * The `batchId` of the operation at `index` of a gesture. One id for the whole gesture, unless it
 * was opened as SPLITTABLE: then one id per part of {@link GESTURE_PART_SIZE}.
 * @param {{id: string, splittable: boolean, partIds: string[]}} gesto
 * @param {number} index - Absolute `batchIndex` inside the gesture.
 * @returns {string}
 */
function partIdOf(gesto, index) {
    if (!gesto.splittable) return gesto.id;
    const part = Math.floor(index / GESTURE_PART_SIZE);
    while (gesto.partIds.length <= part) gesto.partIds.push(generateUUID());
    return gesto.partIds[part];
}

/**
 * Roda `fn` dentro de um lote lógico único.
 *
 * Reentrante: um gesto aberto dentro de outro (uma conversão feita durante uma transferência)
 * ADERE ao de fora em vez de abrir o seu, porque o de fora é o gesto que a pessoa pediu.
 *
 * B6.1 (owner decision, 2026-09-24): `splittable` declara que o gesto e O MESMO VERBO SOBRE N
 * FEICOES INDEPENDENTES (desfazer uma colagem, uma exclusao em massa, um estilo em massa). Ele
 * continua um lote so ate {@link GESTURE_PART_SIZE} operacoes e, dali em diante, cada parte desse
 * tamanho ganha o seu `batchId`, com o `batchIndex` continuo: acima do teto do servidor um lote so
 * era recusado inteiro no cliente. Um gesto de dentro que NAO se declare assim desliga a divisao
 * do de fora (o composto vence), e os compostos (transferir camada, converter) nunca a pedem.
 *
 * @template T
 * @param {function(): Promise<T>} fn - O corpo do gesto.
 * @param {{ splittable?: boolean }} [options]
 * @returns {Promise<T>} O que `fn` devolveu.
 */
export async function withGestureBatch(fn, { splittable = false } = {}) {
    if (aberto) {
        aberto.depth += 1;
        if (!splittable) aberto.splittable = false;
    } else {
        const id = generateUUID();
        aberto = { id, nextIndex: 0, depth: 1, splittable, partIds: [id] };
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
 * A identidade do gesto ABERTO agora, para quem precisa esperá-lo terminar.
 * @returns {string|null} O `batchId` aberto, ou null.
 */
export function openGestureBatchId() {
    // A SPLITTABLE gesture holds only the part still being written: a finished part of the same
    // verb over independent features is sendable, which is the point of splitting it.
    return aberto ? partIdOf(aberto, aberto.nextIndex) : null;
}

/**
 * Reserva `count` posições no lote do gesto aberto.
 *
 * Chamado UMA vez por transação, pela fábrica de operações. Devolve null quando não há gesto
 * aberto, e nesse caso a transação é um lote em si mesma, como sempre foi.
 *
 * @param {number} count - Quantas operações a transação vai criar.
 * @returns {{id: string, startIndex: number, idAt: function(number): string}|null} A identidade,
 *   o índice inicial e o `batchId` de cada posição (igual a `id` fora de gesto divisível).
 */
export function reserveGestureBatchSlots(count) {
    if (!aberto) return null;
    let startIndex = aberto.nextIndex;
    // A TRANSACTION NEVER STRADDLES TWO PARTS: its operations (a feature delete and the membership
    // deletes it records, say) belong together. It starts the next part instead, leaving a gap in
    // `batchIndex`, which only orders and does not need to be contiguous.
    if (aberto.splittable && count <= GESTURE_PART_SIZE) {
        const lastPart = Math.floor((startIndex + count - 1) / GESTURE_PART_SIZE);
        if (lastPart !== Math.floor(startIndex / GESTURE_PART_SIZE)) startIndex = lastPart * GESTURE_PART_SIZE;
    }
    aberto.nextIndex = startIndex + count;
    const gesto = aberto;
    return {
        id: gesto.id,
        startIndex,
        idAt: (index) => partIdOf(gesto, index),
    };
}
