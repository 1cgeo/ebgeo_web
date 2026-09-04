// Path: js/layers/layer-opacity-applier.js

/**
 * @fileoverview Applies per-layer opacity multipliers to MapLibre paint properties.
 *
 * Strategy: snapshot each MapLibre layer's original opacity expressions on first
 * application, then rebuild from the snapshot whenever layer opacities change.
 * The new expression multiplies the original (typically `['get', 'opacity']`
 * for feature opacity) by a `match` expression keyed on `layerId`.
 *
 * DUAS ECONOMIAS MEDIDAS, e as duas valem em TODO boot e em toda troca de mapa base, porque
 * `invalidateOpacityCache()` zera o cache e este modulo recomeca do nada. Os numeros vem do
 * pacote de producao, boot de visitante com IndexedDB vazio:
 *
 *   - a varredura pergunta a propriedade de tinta PELO TIPO da camada, e nao as seis em todas.
 *     Eram 252 `getPaintProperty`, 209 delas lancando excecao usada como teste; passaram a 43,
 *     nenhuma lancando (`OPACITY_PROPS_POR_TIPO`);
 *   - com toda opacidade valendo 1 o multiplicador e a identidade, e a escrita e pulada. Eram
 *     43 `setPaintProperty` por boot; passaram a zero, e a expressao de tinta fica como o modulo
 *     de estilo a escreveu, mais barata de avaliar por feicao a cada quadro.
 *
 * O guarda das duas, incluindo o caso que o atalho poderia engolir (opacidade que VOLTA para 1),
 * esta em `tests/unit/opacidade-de-camada-nao-escreve-a-toa.test.js`.
 */

import { FEATURE_LAYER_IDS } from './layer.constants.js';
import { getLayers } from '../store';

/**
 * As propriedades de opacidade QUE EXISTEM em cada tipo de camada do MapLibre.
 *
 * POR QUE UM MAPA POR TIPO, e nao uma lista unica varrida em todas as camadas. `getPaintProperty`
 * LANCA quando a propriedade nao pertence ao tipo daquela camada, e a versao anterior usava esse
 * lance como teste: varria as seis propriedades nas 42 camadas e engolia o erro num `catch`.
 * Medido no pacote de producao, o boot de visitante fazia 252 chamadas de `getPaintProperty`, das
 * quais 209 lancavam. Excecao nao e barata: cada uma captura pilha. Com o tipo em maos a varredura
 * pergunta so o que pode existir, e nenhuma lanca.
 *
 * Um tipo ausente daqui devolve lista vazia, entao camada de raster, hillshade ou fundo passa
 * batido em vez de virar erro. Isso e proposital: `FEATURE_LAYER_IDS` so lista camadas de feicao,
 * mas ela e editada a mao e um id de outro tipo nao pode quebrar a aplicacao inteira.
 */
const OPACITY_PROPS_POR_TIPO = {
    fill: ['fill-opacity'],
    line: ['line-opacity'],
    circle: ['circle-opacity', 'circle-stroke-opacity'],
    symbol: ['text-opacity', 'icon-opacity'],
    'fill-extrusion': ['fill-extrusion-opacity'],
    raster: ['raster-opacity'],
    heatmap: ['heatmap-opacity'],
    background: ['background-opacity'],
};

/**
 * Cache of original paint property expressions, keyed by `${layerId}:${prop}`.
 * Captures the value before any layer-opacity multiplier is applied.
 * @type {Map<string, *>}
 */
const originalPaintCache = new Map();

/** Last applied opacity signature, for short-circuiting redundant work. */
let lastSignature = null;

/**
 * A ultima instancia de mapa entregue a `applyLayerOpacities`, para que o preview ao vivo
 * alcance o mapa sem passar a instancia pelos componentes da barra lateral.
 * @type {Object|null}
 */
let ultimoMapa = null;

/**
 * Se ALGUM multiplicador diferente de 1 ja foi escrito no estilo VIVO desde o ultimo
 * `invalidateOpacityCache()`.
 *
 * Ele existe por causa do atalho de identidade abaixo, e a assimetria e o ponto: enquanto ninguem
 * mexeu na opacidade de camada nenhuma, escrever `['*', <original>, ['match', ..., 1, 1]]` nao muda
 * pixel algum, entao a escrita inteira e desperdicio. Assim que UMA opacidade sai de 1, porem, o
 * estilo vivo passa a carregar o multiplicador, e voltar todas para 1 exige reescrever para
 * restaurar. Sem esta bandeira o atalho engoliria justamente essa volta.
 * @type {boolean}
 */
let multiplicadorAplicado = false;

/**
 * Captures the original paint property if not already cached.
 * Returns the original expression, or `undefined` if the property is not set.
 * @param {Object} mapInstance
 * @param {string} mapLayerId
 * @param {string} prop
 * @returns {*}
 */
function snapshotOriginal(mapInstance, mapLayerId, prop) {
    const key = `${mapLayerId}:${prop}`;
    if (!originalPaintCache.has(key)) {
        // Sem `try`: `OPACITY_PROPS_POR_TIPO` ja garante que a propriedade pertence ao tipo desta
        // camada, e um `getPaintProperty` que ainda assim lance aqui e defeito de verdade, que
        // deve aparecer em vez de virar `undefined` silencioso.
        originalPaintCache.set(key, mapInstance.getPaintProperty(mapLayerId, prop));
    }
    return originalPaintCache.get(key);
}

/**
 * Builds a MapLibre `match` expression that maps each layerId to its opacity.
 * Layers not present in the map default to opacity 1.
 * @param {Array<{id: string, opacity?: number}>} layers
 * @returns {Array} MapLibre expression
 */
function buildOpacityMatch(layers) {
    const match = ['match', ['coalesce', ['get', 'layerId'], 'default']];
    for (const layer of layers) {
        const opacity = typeof layer.opacity === 'number' ? layer.opacity : 1;
        match.push(layer.id, opacity);
    }
    match.push(1); // default for unknown layerIds
    return match;
}

/**
 * Computes a stable signature of layer opacities to skip no-op updates.
 * @param {Array<{id: string, opacity?: number}>} layers
 * @returns {string}
 */
function computeSignature(layers) {
    return layers
        .map(l => `${l.id}=${typeof l.opacity === 'number' ? l.opacity : 1}`)
        .sort()
        .join('|');
}

/**
 * Applies current per-layer opacity multipliers to all feature MapLibre layers.
 * Safe to call multiple times.
 * @param {Object} mapInstance - MapLibre map instance
 */
export function applyLayerOpacities(mapInstance) {
    if (!mapInstance) return;
    ultimoMapa = mapInstance;
    aplicarExpressoesDeOpacidade(mapInstance, getLayers());
}

/**
 * Aplica uma opacidade que ainda NAO esta no store, para o retorno ao vivo enquanto o
 * controle deslizante e arrastado.
 *
 * Escrever o store por quadro emite LAYERS_CHANGED (que acorda todos os ouvintes, a aba de
 * mapas inclusive, que le um documento de mapa por mapa do atlas) e grava uma operacao de
 * sync no IndexedDB por quadro. Este caminho toca so as propriedades de tinta.
 *
 * A contabilidade da assinatura e a mesma de `applyLayerOpacities`, entao a UNICA escrita do
 * store no fim do gesto cai no curto-circuito em vez de repintar. Se o gesto nunca fechar, a
 * proxima mudanca real de camada reaplica o valor guardado e o preview se perde.
 *
 * @param {string} layerId - Camada sendo arrastada
 * @param {number} opacity - Opacidade 0..1 a prever
 * @returns {boolean} Verdadeiro quando o preview chegou a um mapa
 */
export function previewLayerOpacity(layerId, opacity) {
    if (!ultimoMapa) return false;

    const layers = getLayers().map(
        (layer) => (layer.id === layerId ? { ...layer, opacity } : layer),
    );
    aplicarExpressoesDeOpacidade(ultimoMapa, layers);
    return true;
}

/**
 * Reconstroi as expressoes de multiplicador a partir de uma lista de camadas.
 * @param {Object} mapInstance - Instancia do mapa MapLibre
 * @param {Array<{id: string, opacity?: number}>} layers - Camadas a aplicar
 */
function aplicarExpressoesDeOpacidade(mapInstance, layers) {
    const signature = computeSignature(layers);
    if (signature === lastSignature) return;
    lastSignature = signature;

    // O ATALHO DA IDENTIDADE. Toda opacidade valendo 1 faz de `opacityMatch` um `match` que devolve
    // 1 para qualquer `layerId`, e o que se escreveria seria `['*', <original>, 1]`: expressao
    // diferente, pixel igual. Enquanto nada foi multiplicado ainda, pular a escrita economiza as
    // 43 mutacoes de estilo que o boot de visitante media, e deixa a expressao de tinta como o
    // modulo de estilo a escreveu, mais barata de avaliar por feicao a cada quadro.
    //
    // A bandeira e obrigatoria: depois que uma opacidade saiu de 1, voltar todas para 1 e uma
    // RESTAURACAO, e restaurar exige escrever.
    const todasEmUm = layers.every((l) => (typeof l.opacity === 'number' ? l.opacity : 1) === 1);
    if (todasEmUm && !multiplicadorAplicado) return;
    multiplicadorAplicado = !todasEmUm;

    const opacityMatch = buildOpacityMatch(layers);

    for (const mapLayerId of FEATURE_LAYER_IDS) {
        const camada = mapInstance.getLayer(mapLayerId);
        if (!camada) continue;

        for (const prop of (OPACITY_PROPS_POR_TIPO[camada.type] || [])) {
            const original = snapshotOriginal(mapInstance, mapLayerId, prop);
            if (original === undefined || original === null) continue;

            try {
                mapInstance.setPaintProperty(mapLayerId, prop, ['*', original, opacityMatch]);
            } catch (error) {
                console.warn(`Error applying opacity ${prop} on ${mapLayerId}:`, error);
            }
        }
    }
}

/**
 * Clears cached state. Call when the map style is reset (e.g. base layer change)
 * so the next application re-snapshots the fresh paint properties.
 */
export function invalidateOpacityCache() {
    originalPaintCache.clear();
    lastSignature = null;
    // O estilo foi remontado, entao nenhum multiplicador sobreviveu nele. Nao zerar aqui deixaria
    // o atalho de identidade acreditando que ainda ha o que restaurar, e reescreveria 43
    // propriedades de tinta a cada troca de mapa base sem motivo.
    multiplicadorAplicado = false;
}
