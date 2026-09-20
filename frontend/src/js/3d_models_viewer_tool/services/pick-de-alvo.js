// Path: js/3d_models_viewer_tool/services/pick-de-alvo.js

/**
 * @fileoverview O RETÂNGULO DE ACERTO DE UM ALVO NA CENA 3D, que era de três pixels.
 *
 * `scene.pick` do Cesium recebe a posição na tela e, opcionalmente, a LARGURA e a ALTURA do
 * retângulo em que procurar; sem elas ele usa três pixels, que é a régua de um mouse. Os três
 * sítios que escolhem um ALVO na cena (o marcador, a seleção fora da ferramenta e o balão de
 * comentário) chamavam assim, de modo que num tablet acertar um marcador exigia pôr o dedo a
 * menos de um pixel e meio do centro dele, contra uma ponta de dedo de cerca de trinta.
 *
 * O ALARGAMENTO SÓ FUNCIONA PORQUE O ALVO DESENHA POR CIMA. As três famílias nascem com
 * `disableDepthTestDistance: Number.POSITIVE_INFINITY`, ou seja, o `billboard` é pintado à frente
 * do terreno e do tileset sejam quais forem as profundidades; dentro do retângulo, portanto, ele
 * ganha do chão que também está ali embaixo. Sem essa propriedade o retângulo maior traria o
 * tileset com mais frequência e a troca seria ruim.
 *
 * ELE NÃO SERVE PARA `pickPosition`, e essa é a distinção que separa os sítios que mudaram dos
 * que ficaram: `pickPosition` lê a profundidade do pixel EXATO para descobrir onde no mundo o
 * gesto caiu, e um retângulo não faz sentido ali (não existe "a posição aproximada"). Os quatro
 * sítios de posição em `cesium-measure.js`, `viewshed-3d.js` e no próprio caminho de criação de
 * marcador continuam como estavam, de propósito.
 *
 * É FOLHA de um import só, o predicado de ponteiro, para poder ser exercitado em node.
 */

import { isCoarsePointer } from '@utils/tablet-mode.js';

/** O padrão do Cesium, que é a régua de um mouse. */
export const LARGURA_DE_ACERTO_PX = 3;

/**
 * A régua de um dedo, em pixels de lado.
 *
 * TRINTA E NÃO QUARENTA E QUATRO, que é o número da régua de alvo do produto: aqui o retângulo
 * não é o tamanho do comando, é a VIZINHANÇA em que se procura, e ela disputa com o vizinho.
 * Um retângulo de 44 sobre uma cena com marcadores próximos passaria a entregar o errado, que é
 * pior que não entregar nenhum, porque abre o painel de outra coisa.
 */
export const LARGURA_DE_ACERTO_PX_TOQUE = 30;

/**
 * O lado do retângulo de busca, em pixels.
 * @param {boolean} [grosso] - Se o ponteiro é um dedo; o padrão pergunta ao navegador.
 * @returns {number}
 */
export function larguraDeAcerto(grosso = isCoarsePointer()) {
    return grosso ? LARGURA_DE_ACERTO_PX_TOQUE : LARGURA_DE_ACERTO_PX;
}

/**
 * Escolhe o alvo da cena sob a posição, com a folga do ponteiro corrente.
 *
 * @param {Object} scene - A cena do Cesium.
 * @param {Object} posicao - `Cartesian2` da tela, como o evento de clique entrega.
 * @returns {Object|undefined} O que o Cesium escolheu, ou `undefined`.
 */
export function escolherAlvo(scene, posicao) {
    const lado = larguraDeAcerto();
    return scene?.pick?.(posicao, lado, lado);
}
