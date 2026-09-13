// Path: tests/fixtures/censo-record-operation/literais-de-operacao.js
//
// FIXTURE DO CONTROLE NEGATIVO de `tests/unit/record-operation-sem-literal.test.js`.
//
// Ela não é alcançada por `git ls-files src/js` e ninguém a importa: existe para que o
// censo possa ser apontado, num caso do próprio arquivo, às DUAS formas que ele proíbe, e
// reprovar. Sem ela, "o censo pega literal novo" seria uma afirmação do guarda sobre o
// guarda, e uma varredura que deixasse de casar qualquer coisa passaria todos os outros
// casos verdes comparando vazio com vazio.
//
// São QUATRO violações e DUAS formas legítimas, de propósito: o censo tem de discriminar,
// e uma regra que acusasse as seis seria uma regra que acusa tudo.

import { EntityType, OperationType } from '../../../src/js/store/sync/operation-types.js';

/** Violação 1: literal no PRIMEIRO argumento (o tipo de entidade). */
export function tipoDeEntidadeSolto(tx) {
    tx.recordOperation('feature', OperationType.UPDATE, 'id', 'mapa', {}, null);
}

/** Violação 2: literal no SEGUNDO argumento (o tipo de operação). */
export function tipoDeOperacaoSolto(tx) {
    tx.recordOperation(EntityType.LAYER, 'update', 'id', 'mapa', {}, null);
}

/** Violação 3: a mesma chamada sem o receptor, quebrada em várias linhas. */
export function semReceptorEEmVariasLinhas(recordOperation) {
    recordOperation(
        'mapNotes',
        OperationType.CREATE,
        'id',
    );
}

/** Violação 4: literal de tipo de operação num log de entidade. */
export function logComLiteral(logMapOperation) {
    logMapOperation('update', 'id', { locked: true });
}

/** Legítima 1: as duas constantes, que é a forma da casa. */
export function comConstantes(tx) {
    tx.recordOperation(EntityType.FEATURE, OperationType.CREATE, 'id', 'mapa', {}, null);
}

/** Legítima 2: tipo de operação calculado, que também não é literal. */
export function comValorCalculado(tx, previous) {
    const opType = previous ? OperationType.UPDATE : OperationType.CREATE;
    tx.recordOperation(EntityType.GRID_STYLE, opType, 'id', 'mapa', {}, previous);
}
