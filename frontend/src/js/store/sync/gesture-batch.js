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

/** @type {{id: string, nextIndex: number, depth: number}|null} */
let aberto = null;

/**
 * Roda `fn` dentro de um lote lógico único.
 *
 * Reentrante: um gesto aberto dentro de outro (uma conversão feita durante uma transferência)
 * ADERE ao de fora em vez de abrir o seu, porque o de fora é o gesto que a pessoa pediu.
 *
 * @template T
 * @param {function(): Promise<T>} fn - O corpo do gesto.
 * @returns {Promise<T>} O que `fn` devolveu.
 */
export async function withGestureBatch(fn) {
    if (aberto) {
        aberto.depth += 1;
    } else {
        aberto = { id: generateUUID(), nextIndex: 0, depth: 1 };
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
    return aberto ? aberto.id : null;
}

/**
 * Reserva `count` posições no lote do gesto aberto.
 *
 * Chamado UMA vez por transação, pela fábrica de operações. Devolve null quando não há gesto
 * aberto, e nesse caso a transação é um lote em si mesma, como sempre foi.
 *
 * @param {number} count - Quantas operações a transação vai criar.
 * @returns {{id: string, startIndex: number}|null} A identidade e o índice inicial.
 */
export function reserveGestureBatchSlots(count) {
    if (!aberto) return null;
    const startIndex = aberto.nextIndex;
    aberto.nextIndex += count;
    return { id: aberto.id, startIndex };
}
