// Path: js/store/sync/structural-markers.js

/**
 * @fileoverview OS NOMES DOS ATOS ESTRUTURAIS FEITOS POR REST, do lado do cliente. Uma op de
 * entrada carimbada com um destes NÃO é aplicada entidade a entidade: ela significa "o servidor
 * moveu linhas em massa, tire um snapshot".
 *
 * POR QUE UM MÓDULO FOLHA, E NÃO UMA CONSTANTE DENTRO DO `sync-engine.js`, que é quem a consome.
 * Esta lista é METADE de um contrato de fio cujo outro lado é `STRUCTURAL_MARKER`
 * (`backend/src/modules/sync/structural-marker.js`), e o espelho só é verificável se os dois
 * lados puderem ser importados no MESMO processo: o `sync-engine.js` arrasta a store inteira e
 * não carrega em node puro, então uma constante lá dentro seria conferida por leitura, que é
 * exatamente o regime em que os dois vocabulários divergem sem nada ficar vermelho. Zero imports
 * aqui é o que mantém isso possível (`frontend/tests/unit/marcador-estrutural-espelha-backend.test.js`).
 *
 * QUATRO NOMES, E ATÉ 2026-09-13 O SERVIDOR PUBLICAVA UM SÓ. As quatro exceções REST (merge,
 * duplicação de mapa, clone e importação de atlas) sempre gravaram marcador próprio, mas todas
 * viajavam como `map_merge`, porque um cliente de build anterior ignoraria em silêncio um tipo
 * que não conhecesse. A decisão D6 derrubou essa restrição (a linha nunca foi implantada, então
 * não há cliente anterior em campo) e cada ato passou a viajar pelo nome dele.
 *
 * O QUE NÃO MUDA COM ISSO: o desfecho dos quatro é o MESMO (um snapshot). Quem quiser tratar um
 * deles de forma diferente precisa de mais que o nome, porque o payload do marcador carrega
 * contagens e identificadores, nunca o conteúdo do que mudou.
 */

/**
 * Tipos de entidade que significam "mudança estrutural por REST": o par resincroniza em vez de
 * aplicar. Espelho de `STRUCTURAL_MARKER` do backend.
 * @type {ReadonlySet<string>}
 */
export const STRUCTURAL_RESYNC_OPS = new Set([
    'map_merge',
    'map_duplicate',
    'atlas_clone',
    'atlas_import',
]);

/**
 * Se uma op de entrada é um marcador estrutural.
 * @param {Object} [operation] - Envelope vindo do servidor (replay ou socket).
 * @returns {boolean}
 */
export function isStructuralMarker(operation) {
    return STRUCTURAL_RESYNC_OPS.has(operation?.entityType);
}
