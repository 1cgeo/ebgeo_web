// Path: js/3d_models_viewer_tool/services/orcamento-de-memoria.js

/**
 * @fileoverview O TETO DE CACHE DE UM TILESET, que era um gigabyte para toda máquina.
 *
 * `Cesium3DTileset` nasce com `cacheBytes` de 1 GB nesta árvore, e o número foi escolhido para uma
 * estação de trabalho. Num equipamento de 4 GB com vídeo integrado, que divide memória com o
 * sistema, um gigabyte de tile decodificado é um quarto da máquina entregue a UM tileset, ao lado
 * do navegador inteiro; e é essa a classe de equipamento em que o 3D é aberto em campo.
 *
 * AS PISTAS SÃO IMPERFEITAS E A REGRA É CONSERVADORA, pela mesma razão que já vale para o teto de
 * textura do 360: `navigator.deviceMemory` vem arredondada para baixo em degraus (4 significa "4
 * ou menos") e não existe no Firefox nem no Safari, e `hardwareConcurrency` conta núcleos lógicos
 * e não diz nada sobre o vídeo. Na ausência das duas o teto NÃO baixa, porque é melhor pagar
 * memória numa máquina boa do que estrangular o cache de uma máquina que ninguém mediu.
 *
 * POR QUE ELE NÃO REUSA `tetoDaMaquina`, que aplica exatamente este julgamento: aquela função mora
 * em `street_view_tool/tile-loader.js`, que é cópia CONVERGIDA com o repositório `ebgeo_360` e tem
 * um delta declarado, item a item, em `.claude/rules/common-tasks.md`. Importá-la daqui amarraria
 * o visualizador 3D ao carregador de tiles do 360, e mover a regra para um lugar comum exigiria
 * editar o arquivo convergido, que é a operação cara. São duas contas do mesmo fato, portanto, e
 * isto está escrito aqui para que quem mexer numa vá olhar a outra.
 *
 * NÃO PERGUNTA PELO PONTEIRO, de propósito. Um tablet não é necessariamente uma máquina pequena
 * (um iPad Pro não é), e uma estação com tela de toque é uma máquina grande. O que decide aqui é a
 * MEMÓRIA declarada, que é o recurso em disputa.
 *
 * Folha de ZERO imports, para ser exercitada em node.
 */

/** O teto histórico, e o que continua valendo onde não há pista de aperto. */
export const CACHE_DE_TILESET_BYTES = 1073741824;

/** O teto de uma máquina que se declarou pequena: um quarto do de cima. */
export const CACHE_DE_TILESET_BYTES_APERTADO = 268435456;

/** Abaixo ou igual a isto, em GB, a máquina se considera apertada. */
export const MEMORIA_APERTADA_GB = 4;

/** Abaixo ou igual a isto, em núcleos lógicos, idem. */
export const NUCLEOS_APERTADOS = 4;

/**
 * O teto de cache que ESTA máquina merece, em bytes.
 *
 * @param {Navigator} [navegador] - Injetável para teste; o padrão é o do navegador.
 * @returns {number}
 */
export function cacheDeTileset(navegador = globalThis.navigator) {
    const memoriaGB = navegador?.deviceMemory;
    const nucleos = navegador?.hardwareConcurrency;
    const poucaMemoria = typeof memoriaGB === 'number' && memoriaGB <= MEMORIA_APERTADA_GB;
    const poucosNucleos = typeof nucleos === 'number' && nucleos <= NUCLEOS_APERTADOS;
    return poucaMemoria || poucosNucleos
        ? CACHE_DE_TILESET_BYTES_APERTADO
        : CACHE_DE_TILESET_BYTES;
}
