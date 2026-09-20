// Path: js/map/tablet-panel-push.js

/**
 * @fileoverview NO TABLET O PAINEL EMPURRA O MAPA, em vez de deitar por cima dele.
 *
 * A BARRA LATERAL É SOBREPOSIÇÃO (`position: fixed`) e o mapa é sempre 100% da janela, o que
 * na mesa é a escolha certa: sobra tela de sobra e cobrir 456px de um monitor de 1920 não
 * atrapalha ninguém. Num tablet a conta é outra e foi medida: 56px de trilho mais 400px de
 * painel sobre uma janela de 768 em retrato deixam 312px de mapa visível, menos que a largura
 * de um celular deitado. E como nada reenquadra a câmera ao abrir o painel, a feição que a
 * pessoa acabou de selecionar fica atrás dele em quase todo caso: ela edita o atributo de uma
 * coisa que não consegue ver.
 *
 * O EMPURRÃO ENCOLHE A CAIXA (margem mais largura), e não um `easeTo` com `padding` da câmera.
 * Os dois resolvem esconder a feição; só o primeiro resolve o resto. Com `easeTo` o canvas
 * continua inteiro debaixo do painel, então o controle de zoom, a escala, a atribuição e metade
 * do desenho seguem em cima de uma faixa que a pessoa não alcança com o dedo.
 *
 * E NÃO É `padding-left`, QUE FOI A PRIMEIRA TENTATIVA E NÃO FUNCIONOU. `Element.clientWidth`
 * inclui o padding, e é essa a medida que o MapLibre usa para dimensionar o canvas: com padding,
 * o mapa continuava com a largura inteira, só deslocado para dentro da própria caixa, e o
 * `map.resize()` colhia o mesmo número de antes. O defeito sobreviveu a uma revisão de código e
 * a uma mensagem de commit que afirmava o contrário; quem o pegou foi a primeira rodada sob um
 * contexto de toque de verdade (`playwright.tablet.config.js`), que comparou a largura do canvas
 * antes e depois de abrir o painel e achou o mesmo valor.
 *
 * O NÚMERO VEM DO EVENTO, nunca de uma cópia das larguras: `UI_LAYOUT_CHANGED` já carrega
 * `contentLeftOffset`, que é o que a barra de busca e os chips usam para se posicionar. Ler
 * `--sidebar-panel-width` daqui criaria uma segunda fonte para a mesma medida, e ela erraria
 * na primeira vez que alguém mexesse na largura do painel de tablet.
 *
 * ELE NÃO ALCANÇA O TELEFONE, de propósito: lá a interface é outra (`phone/phone-layout.js`),
 * o painel é folha inteira e empurrar não faz sentido. A faixa é a de `@utils/tablet-mode.js`,
 * e o espelho em CSS dela está em `frontend/src/css/responsive.css`, no bloco que casa a mesma
 * consulta. Os dois precisam andar juntos: CSS não importa constante de JS.
 */

import { EventTypes } from '@events/event_types.js';
import { isTabletLayout, watchTabletLayout } from '@utils/tablet-mode.js';

/** O elemento que o MapLibre preenche. */
const SELETOR_DO_MAPA = '#map-sig';

/**
 * Liga o empurrão do painel no tablet.
 *
 * @param {Object} deps
 * @param {import('maplibre-gl').Map} deps.map
 * @param {Object} deps.eventBus
 * @returns {() => void} Desliga e devolve o mapa ao tamanho cheio.
 */
export function installTabletPanelPush({ map, eventBus }) {
    const caixa = document.querySelector(SELETOR_DO_MAPA);
    if (!caixa || !map || !eventBus) return () => {};

    let recuo = 0;

    /**
     * Aplica (ou desfaz) o recuo e redimensiona o canvas.
     *
     * O `resize` VEM DEPOIS e é imediato, sem esperar a transição do painel: o canvas assume o
     * tamanho final enquanto o painel ainda desliza, que é o desfecho certo dos dois possíveis.
     * Esperar o `transitionend` faria a pessoa ver meio segundo de mapa esticado, e um
     * `transitionend` que não dispara (painel aberto por código, com a aba já no destino)
     * deixaria o canvas errado para sempre.
     */
    const aplicar = () => {
        const dentro = isTabletLayout();
        const px = dentro ? recuo : 0;
        // VALOR COMPUTADO EM RUNTIME, que é a exceção declarada da convenção da casa: ele vem
        // do payload do evento e não existe como token.
        caixa.style.setProperty('--tablet-map-inset', `${px}px`);
        document.body.dataset.tabletPanel = dentro && px > 0 ? 'open' : 'closed';
        map.resize();
    };

    const aoMudarLeiaute = (payload) => {
        const aberto = payload?.sidebarExpanded === true || payload?.featurePanelOpen === true;
        // SÓ O PAINEL EMPURRA, e não a trilha de 56px, que está sempre lá: recuar por ela
        // encolheria o mapa o tempo todo, inclusive com tudo fechado, e a trilha é estreita o
        // bastante para conviver com o mapa embaixo dela.
        recuo = aberto ? Number(payload?.contentLeftOffset) || 0 : 0;
        aplicar();
    };

    eventBus.on(EventTypes.UI_LAYOUT_CHANGED, aoMudarLeiaute);
    // GIRAR O APARELHO ENTRA E SAI DA FAIXA: um tablet de 481 por 800 é tablet deitado e
    // telefone em pé. Sem isto, o recuo ficaria preso ao que valia na abertura da página.
    const pararDeObservar = watchTabletLayout(aplicar);

    return () => {
        eventBus.off?.(EventTypes.UI_LAYOUT_CHANGED, aoMudarLeiaute);
        pararDeObservar();
        recuo = 0;
        aplicar();
    };
}
