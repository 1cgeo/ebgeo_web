// Path: js/street_view_tool/components/compass-360.js

/**
 * @module street_view_tool/components/compass-360
 * @description Faixa de bussola no topo do visualizador 360: mostra para onde a
 * camera olha, com os rumos cardeais deslizando sob um marcador central fixo.
 *
 * POR QUE UMA FAIXA, E NAO UMA ROSA DOS VENTOS. Dentro do panorama o usuario nao
 * gira um mapa, gira a CABECA: o quadro e uma janela estreita sobre o horizonte.
 * A faixa e a projecao literal desse horizonte, entao ler "estou olhando entre o
 * sul e o sudoeste" custa um relance. Uma rosa exigiria traduzir a posicao de um
 * ponteiro num angulo, e depois o angulo numa direcao.
 *
 * O MARCADOR E QUE FICA PARADO. O centro da faixa e sempre o rumo em que a
 * camera aponta, e a regua e que corre por baixo. O inverso (regua parada,
 * agulha correndo) obrigaria o olho a caçar a agulha a cada arrasto.
 *
 * ABERTURA FIXA, E NAO O CAMPO DE VISAO. Amarrar a abertura ao FOV faria a regua
 * esticar e encolher junto com o zoom, e os rotulos andariam sem que a camera
 * tivesse girado. Uma escala que muda sozinha nao e escala.
 */

import { COMPASS_PRESETS } from '../../azimuth_distance_tool/azimuth_distance_constants.js';

/** Tamanho da faixa em pixels de CSS. */
const LARGURA = 232;
const ALTURA = 34;

/**
 * Graus visiveis de ponta a ponta.
 *
 * 90 e o valor da referencia, e cai bem: com rotulo a cada 45 graus sempre ha
 * dois ou tres na tela, o suficiente para situar sem virar poluicao.
 * @constant {number}
 */
const ABERTURA = 90;

/** Graus entre tracos menores, e entre tracos maiores. */
const PASSO_TRACO = 5;
const PASSO_TRACO_MAIOR = 15;

/**
 * Largura, em pixels, da zona de esmaecimento em cada ponta.
 *
 * Sem ela um rotulo entrando na faixa aparece cortado ao meio pela borda. Com
 * ela ele nasce transparente e ganha corpo, que e como o olho espera que algo
 * entre em cena.
 * @constant {number}
 */
const ESMAECIMENTO = 34;

/**
 * Fonte dos rotulos, escrita por extenso.
 *
 * NAO use `var(--font-family-base)` aqui: o canvas 2D nao resolve variavel de
 * CSS, descarta a atribuicao inteira em silencio e segue desenhando com a fonte
 * anterior. A pilha abaixo repete a do design-tokens.css.
 * @constant {string}
 */
const FONTE_ROTULO = '700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/**
 * Fundo mais escuro que os 0,55 do seletor de andar.
 *
 * A faixa mora no TOPO do quadro, e o topo de um panorama e quase sempre ceu ou
 * teto claro: no Beira-Rio e a membrana branca estourada. O seletor de andar vive
 * na altura do horizonte, onde o fundo e mais escuro e 0,55 basta.
 * @constant {string}
 */
const COR_FUNDO = 'rgba(0, 0, 0, 0.62)';
const COR_BORDA = 'rgba(255, 255, 255, 0.25)';
const COR_TRACO = 'rgba(255, 255, 255, 0.45)';
const COR_TRACO_MAIOR = 'rgba(255, 255, 255, 0.75)';
const COR_ROTULO = '#ffffff';
/** O norte em ambar (--color-warning): achar o norte e a pergunta mais frequente. */
const COR_NORTE = '#f59e0b';

/** @type {HTMLCanvasElement|null} */
let canvasEl = null;
/** @type {CanvasRenderingContext2D|null} */
let ctx = null;
/** Densidade com que o canvas foi dimensionado, para refazer se a janela mudar de zoom. */
let densidade = 0;
/** Ultimo octante anunciado ao leitor de tela, para nao reescrever o rotulo a cada quadro. */
let ultimoOctante = null;

/**
 * Monta a faixa dentro do visualizador.
 * @param {HTMLElement} container - Elemento do visualizador 360
 */
export function initCompass360(container) {
    if (!container || canvasEl) return;

    canvasEl = document.createElement('canvas');
    canvasEl.className = 'sv360-compass';
    // Decorativo para o mouse, informativo para o leitor de tela: o rotulo e
    // reescrito em updateCompass360 quando o octante muda.
    canvasEl.setAttribute('role', 'img');
    canvasEl.setAttribute('aria-label', 'Direcao da camera');
    canvasEl.style.width = `${LARGURA}px`;
    canvasEl.style.height = `${ALTURA}px`;

    container.appendChild(canvasEl);
    ctx = canvasEl.getContext('2d');
    ajustarDensidade();
}

/** Remove a faixa e zera o estado. */
export function destroyCompass360() {
    canvasEl?.remove();
    canvasEl = null;
    ctx = null;
    densidade = 0;
    ultimoOctante = null;
}

/**
 * Redesenha a faixa para um rumo de mundo.
 *
 * Chamada de dentro do laco de animacao do visualizador, que so roda quando a
 * camera mudou. Nao ha guarda de mudanca aqui de proposito: uma segunda guarda
 * sobre a primeira so criaria um jeito novo de a faixa congelar.
 *
 * @param {number} rumo - Azimute do centro da vista, em graus
 */
export function updateCompass360(rumo) {
    if (!ctx || !canvasEl) return;

    ajustarDensidade();

    const centro = LARGURA / 2;
    const pxPorGrau = LARGURA / ABERTURA;

    ctx.clearRect(0, 0, LARGURA, ALTURA);
    ctx.save();
    caminhoDaPilula(ctx, 0.5, 0.5, LARGURA - 1, ALTURA - 1, ALTURA / 2);
    ctx.clip();

    ctx.fillStyle = COR_FUNDO;
    ctx.fillRect(0, 0, LARGURA, ALTURA);

    // Tracos. O primeiro multiplo de PASSO_TRACO antes da borda esquerda, e dai
    // em diante ate sair pela direita.
    const meiaAbertura = ABERTURA / 2;
    const primeiro = Math.ceil((rumo - meiaAbertura) / PASSO_TRACO) * PASSO_TRACO;
    for (let grau = primeiro; grau <= rumo + meiaAbertura; grau += PASSO_TRACO) {
        // Rotulo e traco no mesmo lugar brigam: onde ha rotulo, nao ha traco.
        // 45 divide 360, entao o resto vale igual para grau negativo.
        if (grau % 45 === 0) continue;

        const x = centro + (grau - rumo) * pxPorGrau;
        const maior = grau % PASSO_TRACO_MAIOR === 0;
        const altura = maior ? ALTURA * 0.42 : ALTURA * 0.26;

        ctx.globalAlpha = opacidadeNaBorda(x);
        ctx.fillStyle = maior ? COR_TRACO_MAIOR : COR_TRACO;
        ctx.fillRect(Math.round(x), (ALTURA - altura) / 2, 1, altura);
    }

    // Rotulos cardeais. A volta inteira e varrida uma vez por copia da rosa
    // (-360, 0, +360) para o rotulo continuar aparecendo quando a vista cruza o
    // norte, onde 350 graus e 10 graus sao vizinhos e nao opostos.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = FONTE_ROTULO;
    for (const volta of [-360, 0, 360]) {
        for (const ponto of COMPASS_PRESETS) {
            const grau = ponto.deg + volta;
            if (Math.abs(grau - rumo) > meiaAbertura) continue;

            const x = centro + (grau - rumo) * pxPorGrau;
            ctx.globalAlpha = opacidadeNaBorda(x);
            ctx.fillStyle = ponto.deg === 0 ? COR_NORTE : COR_ROTULO;
            ctx.fillText(ponto.label, x, ALTURA / 2 + 0.5);
        }
    }
    ctx.globalAlpha = 1;

    marcadorCentral(ctx, centro);
    ctx.restore();

    // Borda por fora do clip, senao metade da espessura se perde.
    caminhoDaPilula(ctx, 0.5, 0.5, LARGURA - 1, ALTURA - 1, ALTURA / 2);
    ctx.strokeStyle = COR_BORDA;
    ctx.lineWidth = 1;
    ctx.stroke();

    anunciar(rumo);
}

/**
 * Desenha o marcador do centro: onde a camera olha.
 *
 * A linha ganha um contorno escuro porque ela cruza tracos e rotulos brancos, e
 * branco sobre branco desaparece justo no elemento que nao pode desaparecer.
 * @param {CanvasRenderingContext2D} c - Contexto
 * @param {number} centro - x do centro, em px
 */
function marcadorCentral(c, centro) {
    c.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(centro, 3);
    c.lineTo(centro, ALTURA - 3);
    c.stroke();

    c.strokeStyle = '#ffffff';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(centro, 3);
    c.lineTo(centro, ALTURA - 3);
    c.stroke();
}

/**
 * Opacidade de um elemento pela distancia ate a borda mais proxima.
 * @param {number} x - Posicao horizontal em px
 * @returns {number} Fator de 0 a 1
 */
function opacidadeNaBorda(x) {
    const daBorda = Math.min(x, LARGURA - x);
    return Math.max(0, Math.min(1, daBorda / ESMAECIMENTO));
}

/**
 * Traça o contorno arredondado da faixa.
 * @param {CanvasRenderingContext2D} c - Contexto
 * @param {number} x - Canto esquerdo
 * @param {number} y - Canto superior
 * @param {number} largura - Largura
 * @param {number} altura - Altura
 * @param {number} raio - Raio do canto
 */
function caminhoDaPilula(c, x, y, largura, altura, raio) {
    c.beginPath();
    // roundRect existe em todo navegador que roda o visualizador 360 (que ja
    // exige WebGL), mas o fallback custa tres linhas e cobre um WebView antigo.
    if (typeof c.roundRect === 'function') {
        c.roundRect(x, y, largura, altura, raio);
        return;
    }
    c.moveTo(x + raio, y);
    c.arcTo(x + largura, y, x + largura, y + altura, raio);
    c.arcTo(x + largura, y + altura, x, y + altura, raio);
    c.arcTo(x, y + altura, x, y, raio);
    c.arcTo(x, y, x + largura, y, raio);
    c.closePath();
}

/**
 * Redimensiona o buffer do canvas quando a densidade de tela muda.
 *
 * Ler devicePixelRatio a cada quadro e barato, e cobre o caso que uma leitura so
 * na montagem perde: arrastar a janela para um monitor de densidade diferente,
 * ou dar zoom no navegador, deixava a faixa borrada ate reabrir o visualizador.
 */
function ajustarDensidade() {
    const atual = window.devicePixelRatio || 1;
    if (atual === densidade || !canvasEl || !ctx) return;

    densidade = atual;
    canvasEl.width = Math.round(LARGURA * atual);
    canvasEl.height = Math.round(ALTURA * atual);
    ctx.setTransform(atual, 0, 0, atual, 0, 0);
}

/**
 * Atualiza o texto do leitor de tela, so quando o octante muda.
 * @param {number} rumo - Azimute em graus
 */
function anunciar(rumo) {
    const indice = Math.round((((rumo % 360) + 360) % 360) / 45) % COMPASS_PRESETS.length;
    if (indice === ultimoOctante) return;
    ultimoOctante = indice;
    canvasEl?.setAttribute('aria-label', `Camera olhando para ${COMPASS_PRESETS[indice].label}`);
}
