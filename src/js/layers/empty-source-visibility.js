// Path: js/layers/empty-source-visibility.js

/**
 * @fileoverview Mantem escondida a camada cuja fonte GeoJSON esta vazia.
 *
 * Numa sessao tipica o estilo tem 103 fontes e 302 camadas, e 67 dessas fontes
 * (uma por tipo de feicao, mais as de apoio `-feedback`, `-edit-handles` e
 * `-labels`) estao VAZIAS: o usuario ainda nao desenhou nada. As 82 camadas
 * delas ficavam visiveis, e com terreno 3D ligado isso custava duas vezes por
 * quadro.
 *
 * PRIMEIRO CUSTO. `Style._updateSources` percorre TODA fonte
 * (`for (const t in this.tileManagers) this.tileManagers[t].update(e, this.map.terrain)`)
 * e o `TileManager.update` so pula o `coveringTiles` com elevacao quando a fonte
 * nao esta em uso: `this.used || this.usedForTerrain ? (... coveringTiles com
 * terrain ...) : a = []`. Uma fonte vazia com camada visivel entra no ramo caro
 * e consulta a elevacao para nada. Medido: 13 a 15 ms por quadro no gesto.
 *
 * SEGUNDO CUSTO. As camadas `symbol` e `circle` intercaladas entre `fill` e
 * `line` quebram as pilhas de render-to-texture do terreno. Eram 17 pilhas x 20
 * tiles = 340 texturas por quadro contra um pool de 30, e o
 * `renderToTexture.prepareForRender` pagava 10 a 14 ms.
 *
 * A CHAVE e o `Style.update`, que marca a fonte como usada por camada NAO
 * escondida: `!i.isHidden(e.zoom) && i.source && (this.tileManagers[i.source].used = !0)`.
 * Camada com `visibility: none` nao conta, entao a fonte sai dos dois mecanismos
 * e nao abre pilha. Medido com as 82 camadas escondidas na mao: 2 pilhas, quadro
 * parado de 26 ms para 5,7 ms, rotacao de 38 ms para 7,7 ms (60 fps).
 *
 * POR QUE UM OUVINTE, E NAO UM HELPER. O app escreve em fonte GeoJSON em 311
 * lugares, espalhados por 55 arquivos, e nao existe helper central de escrita
 * (o `utilities/geojson-source.js` e so de leitura). Um helper novo exigiria
 * migrar os 311, e o call site esquecido esconderia uma camada COM feicao
 * dentro, que e um defeito visivel. O evento `sourcedata` nasce dentro do
 * proprio `GeoJSONSource`, abaixo de qualquer chamador, e cobre os 311 com uma
 * mudanca so. Mesmo filtro que o `features_tab.js` ja usa: interessa apenas
 * `sourceDataType === 'content'`, que e o que um `setData` produz, e nao o
 * evento por tile.
 *
 * O ouvinte e seguro porque `GeoJSONSource._dispatchWorkerUpdate` dispara
 * `metadata` e `content` sem consultar `used` em ponto nenhum. Se dependesse
 * disso, esconder a camada mataria o gatilho que a traria de volta.
 *
 * O QUE O MODULO GUARDA. So o conjunto das camadas que ELE escondeu. Nao ha
 * registro do que o app "quer", porque a aba de camadas do atlas nao mexe em
 * `visibility`: ela reescreve o FILTRO (`visibility-filter.js`,
 * `mapInstance.setFilter(layerId, filter)`), assim como o modo temporal, e a
 * opacidade so escreve `setPaintProperty`. Camada escondida por outro nunca e
 * reexibida por aqui, e por isso os dois separadores (`analysis-separator` e
 * `features-separator`, que nascem `none` como ancora de `beforeId`) ficam como
 * estao. Ancora escondida continua servindo: `Style.addLayer` resolve o
 * `beforeId` por `this._order.indexOf(beforeId)`, um array de ids, sem olhar a
 * visibilidade.
 */

import { readGeoJSONSourceData } from '../utilities/geojson-source.js';

/**
 * Fontes GeoJSON com dado embutido cujas camadas o proprio dono liga e desliga
 * por `visibility`. Se a regra as governasse, a chegada de dado reexibiria uma
 * camada que o dono acabou de esconder.
 *
 * As demais fontes de terceiros saem sozinhas: as do grid e as do catalogo nao
 * sao GeoJSON, e a de linhas do 360 e GeoJSON por URL, cujo `serialize().data`
 * e uma string.
 */
export const UNMANAGED_SOURCE_IDS = Object.freeze(new Set([
    // add_3d_models_viewer_control.js: sourceId na linha 138, alterna nas 604 e 619
    '3d-models-source',
    // streetview_markers.js: sourceId na linha 42, alterna nas 269 a 272 e 295 a 298
    'streetview-markers-source',
    // saved_photos_markers.js: sourceId na linha 30, alterna nas 322 a 324 e 339 a 341
    'saved-photos-markers-source',
]));

/**
 * Estado por mapa: as camadas que este modulo escondeu, e o ouvinte instalado.
 * @type {WeakMap<Object, { hidden: Set<string>, handler: Function|null }>}
 */
const stateByMap = new WeakMap();

/**
 * Devolve (criando na primeira vez) o estado deste mapa.
 * @param {Object} map - Instancia do MapLibre
 * @returns {{ hidden: Set<string>, handler: Function|null }}
 */
function ensureState(map) {
    let state = stateByMap.get(map);
    if (!state) {
        state = { hidden: new Set(), handler: null };
        stateByMap.set(map, state);
    }
    return state;
}

/**
 * Quantas feicoes a fonte tem AGORA, lida sem ida ao worker.
 *
 * Devolve `null` quando a pergunta nao se aplica, e nesse caso o modulo nao
 * mexe em nada: fonte que nao existe, que nao e GeoJSON, que carrega por URL
 * (o `data` e uma string) ou que guarda uma forma que nao sabemos contar.
 * Vazio se prova, nunca se presume.
 *
 * @param {Object} map - Instancia do MapLibre
 * @param {string} sourceId - Id da fonte
 * @returns {number|null} Numero de feicoes, ou null quando indeterminado
 */
export function countSourceFeatures(map, sourceId) {
    const source = map?.getSource?.(sourceId);
    if (!source) return null;

    // Caminho quente: FeatureCollection embutida, lida por referencia.
    const collection = readGeoJSONSourceData(source);
    if (collection) return collection.features.length;

    // O helper acima devolve null para qualquer coisa que nao seja uma
    // FeatureCollection, e um `Feature` solto tambem desenha.
    if (typeof source.serialize !== 'function') return null;
    let data;
    try {
        data = source.serialize()?.data;
    } catch {
        return null;
    }
    if (data && typeof data === 'object' && data.type === 'Feature') return 1;
    return null;
}

/**
 * A visibilidade efetiva da camada, com o default da especificacao aplicado.
 *
 * `StyleLayer.getLayoutProperty('visibility')` devolve `undefined` na camada que
 * nunca declarou `layout.visibility`, e o MapLibre nao tem default de classe. Sem
 * esta normalizacao a comparacao de idempotencia falharia: `undefined` e
 * diferente de `'visible'`, o `setLayoutProperty` passaria pelo curto-circuito
 * do proprio MapLibre e marcaria a fonte para reload a toa.
 *
 * @param {Object} map - Instancia do MapLibre
 * @param {string} layerId - Id da camada
 * @returns {'visible'|'none'}
 */
function currentVisibility(map, layerId) {
    let value;
    try {
        value = map.getLayoutProperty(layerId, 'visibility');
    } catch {
        return 'visible';
    }
    return value === 'none' ? 'none' : 'visible';
}

/**
 * Os ids das camadas que desenham de uma fonte, na ordem do estilo.
 * Monta do estilo VIVO, porque o app nao tem mapa fonte -> camadas em lugar
 * nenhum e as fontes de apoio nascem por prefixo (`${prefix}-feedback` e
 * companhia) em `styles/shape.layers.js`.
 *
 * @param {Object} map - Instancia do MapLibre
 * @param {string} sourceId - Id da fonte
 * @returns {string[]} Ids das camadas
 */
function layersOfSource(map, sourceId) {
    const ids = [];
    for (const layerId of map.getLayersOrder()) {
        const layer = map.getLayer(layerId);
        if (layer && layer.source === sourceId) ids.push(layerId);
    }
    return ids;
}

/**
 * Aplica a regra a uma lista de camadas ja conhecida.
 *
 * @param {Object} map - Instancia do MapLibre
 * @param {string[]} layerIds - Camadas da fonte
 * @param {boolean} isEmpty - Se a fonte esta vazia
 * @returns {number} Quantas escritas de `visibility` foram feitas
 */
function applyToLayers(map, layerIds, isEmpty) {
    const state = ensureState(map);
    let writes = 0;

    for (const layerId of layerIds) {
        const visible = currentVisibility(map, layerId) === 'visible';

        if (isEmpty) {
            // Camada ja escondida por outro nao entra no conjunto, e assim nunca
            // sera reexibida por aqui.
            if (!visible) continue;
            map.setLayoutProperty(layerId, 'visibility', 'none');
            state.hidden.add(layerId);
            writes++;
            continue;
        }

        if (!state.hidden.has(layerId)) continue;
        if (visible) {
            // Alguem reexibiu antes de nos: o registro deixou de valer.
            state.hidden.delete(layerId);
            continue;
        }
        map.setLayoutProperty(layerId, 'visibility', 'visible');
        state.hidden.delete(layerId);
        writes++;
    }

    return writes;
}

/**
 * Poe as camadas de UMA fonte no estado que a contagem dela pede.
 *
 * Nao escreve quando o valor ja e o desejado, e essa guarda importa: toda
 * escrita de `visibility` faz o `Style._updateLayer` marcar a fonte com
 * `_updatedSources[source] = 'reload'` e pausar o `TileManager` dela.
 *
 * @param {Object} map - Instancia do MapLibre
 * @param {string} sourceId - Id da fonte
 * @returns {number} Quantas escritas de `visibility` foram feitas
 */
export function syncSourceLayersVisibility(map, sourceId) {
    if (!map || !sourceId) return 0;
    if (UNMANAGED_SOURCE_IDS.has(sourceId)) return 0;
    if (typeof map.getLayersOrder !== 'function') return 0;

    const count = countSourceFeatures(map, sourceId);
    if (count === null) return 0;

    return applyToLayers(map, layersOfSource(map, sourceId), count === 0);
}

/**
 * Passa a regra por todas as fontes que o estilo desenha.
 *
 * Percorre a ordem das camadas UMA vez e agrupa por fonte, em vez de varrer a
 * ordem por fonte. Fonte sem camada nenhuma nao aparece, e nao ha o que
 * esconder nela.
 *
 * @param {Object} map - Instancia do MapLibre
 * @returns {number} Quantas escritas de `visibility` foram feitas
 */
export function syncAllSourcesVisibility(map) {
    if (!map || typeof map.getLayersOrder !== 'function') return 0;

    const bySource = new Map();
    for (const layerId of map.getLayersOrder()) {
        const layer = map.getLayer(layerId);
        const sourceId = layer?.source;
        if (!sourceId || UNMANAGED_SOURCE_IDS.has(sourceId)) continue;
        const list = bySource.get(sourceId);
        if (list) list.push(layerId);
        else bySource.set(sourceId, [layerId]);
    }

    let writes = 0;
    for (const [sourceId, layerIds] of bySource) {
        const count = countSourceFeatures(map, sourceId);
        if (count === null) continue;
        writes += applyToLayers(map, layerIds, count === 0);
    }
    return writes;
}

/**
 * Instala a regra num mapa: sincroniza o estado atual e passa a acompanhar cada
 * `setData`.
 *
 * Idempotente. Roda de novo a cada `setupMapFeatures`, isto e, a cada troca de
 * mapa do atlas e a cada troca de mapa base, sem empilhar ouvinte.
 *
 * @param {Object} map - Instancia do MapLibre
 * @returns {Function} Desinstala o ouvinte (nao reexibe o que foi escondido)
 */
export function installEmptySourceVisibility(map) {
    if (!map || typeof map.on !== 'function') return () => {};

    const state = ensureState(map);

    if (!state.handler) {
        state.handler = (event) => {
            // O `sourcedata` dispara uma vez por TILE que a fonte produz. So o
            // `setData` carrega `content`, e so ele muda a contagem.
            if (event?.sourceDataType !== 'content') return;
            if (!event.sourceId) return;
            syncSourceLayersVisibility(map, event.sourceId);
        };
        map.on('sourcedata', state.handler);
    }

    syncAllSourcesVisibility(map);

    return () => {
        if (!state.handler) return;
        map.off('sourcedata', state.handler);
        state.handler = null;
    };
}

/**
 * As camadas que este modulo escondeu no mapa dado. Serve a teste e a
 * diagnostico, e nunca ao caminho de render.
 *
 * @param {Object} map - Instancia do MapLibre
 * @returns {string[]} Ids das camadas escondidas pela regra
 */
export function layersHiddenByRule(map) {
    return [...(stateByMap.get(map)?.hidden || [])];
}
