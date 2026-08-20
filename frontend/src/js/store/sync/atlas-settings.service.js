// Path: js/store/sync/atlas-settings.service.js

/**
 * @fileoverview Per-atlas config overlay (Fase 1 — "Configuração por atlas").
 *
 * A connected remote atlas can RESTRICT which capabilities are available (3D, 360,
 * basemaps) via its `atlas.settings` (set by a Gestor, broadcast as `atlas_settings_updated`).
 * This service applies those restrictions onto the global `config` singleton — and only ever
 * RESTRICTS: the overlay is the **intersection** of the deployment's capabilities and the
 * atlas's allowances. It can never ENABLE what the deployment disabled (e.g. 3D is stripped on
 * the GitHub Pages build — no atlas setting can turn it back on). Coherent with P1/P12.
 *
 * A baseline of the deploy-level values is captured on first apply so `revertAtlasSettings()`
 * restores them when the user disconnects / returns to the local store.
 *
 * Backend → frontend key mapping: `features.panoramic_images` → `config.features.imagens_panoramicas`.
 */

import config from '../../config.js';

/**
 * The captured deploy-level baseline (set on first apply, cleared on revert).
 * @type {{ map_3d: boolean, imagens_panoramicas: boolean, basemaps: Object<string, boolean> }|null}
 */
let _baseline = null;

/** Per-atlas 360-view allowlist (raw ids); null = no restriction. Set on apply, cleared on revert.
 *  360 lives outside `config` (sv360 preflight cache), so the catalog reads this directly. */
let _atlas360Allowlist = null;

/**
 * As últimas `settings` aplicadas, guardadas para que a soma dos recursos concedidos
 * possa RE-APLICAR a interseção por cima do baseline novo (D1: somar primeiro,
 * intersectar depois). Sem isso a ordem de chegada decidiria o resultado, e a
 * ordem de chegada é a coisa menos estável do boot.
 * @type {Object|null}
 */
let _lastSettings = null;

/**
 * Os recursos PRIVADOS concedidos, por grupo, como foram somados por último.
 * Guardados para que `revertGrantedResources()` saiba EXATAMENTE o que tirar: sem
 * essa lista, "tirar o concedido" viraria "tirar o que não estava no deploy", que
 * é uma pergunta que este módulo não tem como responder depois que o overlay
 * mexeu nos arrays.
 * @type {{basemaps: Array, tilesets: Array, dataLayers: Array, analysisLayers: Array, views360: Array}}
 */
let _granted = { basemaps: [], tilesets: [], dataLayers: [], analysisLayers: [], views360: [] };

/**
 * Os três grupos de catálogo que são ARRAY, cada um com o array VIVO em `config` e o
 * campo correspondente do baseline.
 *
 * Dois grupos ficam de fora, por razões diferentes: `views360` não mora em `config`
 * (vem do preflight do sv360) e quem o consome é o catálogo, por
 * `getGrantedViews360()`; `basemaps` mora em `config` mas como OBJETO indexado por
 * id, com o estilo MapLibre numa segunda chave, então tem caminho próprio em
 * `aplicarBasemapsConcedidos`.
 */
const GRUPOS_CONCEDIDOS = [
    { chave: 'tilesets', vivo: () => config.tilesets, campoBaseline: 'tilesets' },
    { chave: 'dataLayers', vivo: () => config.dataLayers?.layers, campoBaseline: 'dataLayers' },
    { chave: 'analysisLayers', vivo: () => config.analysisLayers?.layers, campoBaseline: 'analysisLayers' },
];

/** @private Captures the current (deploy-level) availability from the config singleton. */
function captureBaseline() {
    const basemaps = {};
    if (config.basemaps) {
        for (const [id, cfg] of Object.entries(config.basemaps)) {
            basemaps[id] = cfg?.enabled !== false;
        }
    }
    return {
        map_3d: config.features?.map_3d !== false,
        imagens_panoramicas: config.features?.imagens_panoramicas !== false,
        terrain_3d: config.features?.terrain_3d !== false,
        basemaps,
        // Data/analysis layers are FLAT arrays (no per-layer `enabled` flag, unlike basemaps), so
        // the baseline keeps the full deploy arrays and the intersection FILTERS them to the allowlist.
        dataLayers: Array.isArray(config.dataLayers?.layers) ? [...config.dataLayers.layers] : [],
        analysisLayers: Array.isArray(config.analysisLayers?.layers) ? [...config.analysisLayers.layers] : [],
        // Global category on/off (the whole "Dados"/"Análise" group): the catalog reads `.enabled`.
        dataLayersEnabled: config.dataLayers?.enabled !== false,
        analysisLayersEnabled: config.analysisLayers?.enabled !== false,
        // 3D models: config.tilesets is a flat array of {id,...}; filter it by available_3d_models.
        tilesets: Array.isArray(config.tilesets) ? [...config.tilesets] : [],
    };
}

/** @private Filters a layer array by an id allowlist ([]/absent = keep all). */
function filterLayers(layers, allowlist) {
    const all = Array.isArray(layers) ? layers : [];
    const allow = Array.isArray(allowlist) ? allowlist : [];
    if (allow.length === 0) return [...all];
    return all.filter((l) => allow.includes(l?.id));
}

/**
 * Pure: computes the restricted availability = deploy baseline ∩ atlas settings.
 * Never enables what the baseline disabled. An empty/absent `basemaps` allowlist means the
 * atlas does not restrict basemaps (the deploy set is kept).
 *
 * @param {{ map_3d: boolean, imagens_panoramicas: boolean, basemaps: Object<string, boolean> }} baseline
 * @param {{ features?: Object, basemaps?: string[] }} [settings] - Backend atlas.settings shape.
 * @returns {{ map_3d: boolean, imagens_panoramicas: boolean, basemaps: Object<string, boolean> }}
 */
export function intersectAvailability(baseline, settings) {
    const features = settings?.features || {};
    const allow = Array.isArray(settings?.basemaps) ? settings.basemaps : [];
    const basemaps = {};
    for (const [id, enabled] of Object.entries(baseline.basemaps || {})) {
        // Keep a basemap iff it was enabled in the deploy AND (no allowlist OR it is listed).
        basemaps[id] = enabled !== false && (allow.length === 0 || allow.includes(id));
    }
    return {
        map_3d: baseline.map_3d !== false && features.map_3d !== false,
        imagens_panoramicas: baseline.imagens_panoramicas !== false && features.panoramic_images !== false,
        terrain_3d: baseline.terrain_3d !== false && features.terrain_3d !== false,
        basemaps,
        // Empty/absent allowlist = no restriction (keep the full deploy array); else keep only listed ids.
        dataLayers: filterLayers(baseline.dataLayers, settings?.available_data_layers),
        analysisLayers: filterLayers(baseline.analysisLayers, settings?.available_analysis_layers),
        dataLayersEnabled: baseline.dataLayersEnabled !== false && features.data_layers !== false,
        analysisLayersEnabled: baseline.analysisLayersEnabled !== false && features.analysis_layers !== false,
        tilesets: filterLayers(baseline.tilesets, settings?.available_3d_models),
    };
}

/**
 * Applies a connected atlas's settings as a restrictive overlay onto the global config.
 * Idempotent: re-applying recomputes from the captured baseline (never compounds).
 * @param {{ features?: Object, basemaps?: string[] }} [settings] - Backend atlas.settings.
 */
export function applyAtlasSettings(settings) {
    if (!_baseline) _baseline = captureBaseline();
    _lastSettings = settings ?? null;
    const next = intersectAvailability(_baseline, settings);
    _atlas360Allowlist = Array.isArray(settings?.available_360_views) && settings.available_360_views.length
        ? settings.available_360_views
        : null;
    if (config.features) {
        config.features.map_3d = next.map_3d;
        config.features.imagens_panoramicas = next.imagens_panoramicas;
        config.features.terrain_3d = next.terrain_3d;
    }
    if (config.basemaps) {
        for (const [id, enabled] of Object.entries(next.basemaps)) {
            if (config.basemaps[id]) config.basemaps[id].enabled = enabled;
        }
    }
    if (config.dataLayers) {
        replaceArrayInPlace(config.dataLayers.layers, next.dataLayers);
        config.dataLayers.enabled = next.dataLayersEnabled;
    }
    if (config.analysisLayers) {
        replaceArrayInPlace(config.analysisLayers.layers, next.analysisLayers);
        config.analysisLayers.enabled = next.analysisLayersEnabled;
    }
    replaceArrayInPlace(config.tilesets, next.tilesets);
}

/**
 * @private Replaces an array's contents IN PLACE (preserves the reference) so modules that
 * captured the original array (e.g. the catalog) keep seeing the overlay-filtered list.
 * No-op when `arr` is not an array.
 * @param {*} arr - The live array to mutate.
 * @param {Array} next - The new contents.
 */
function replaceArrayInPlace(arr, next) {
    if (!Array.isArray(arr)) return;
    arr.length = 0;
    arr.push(...(Array.isArray(next) ? next : []));
}

/**
 * @private Remove de `arr` toda entrada cujo id esteja em `ids`, IN PLACE.
 * @param {*} arr
 * @param {Set<string>} ids
 */
function removeByIdInPlace(arr, ids) {
    if (!Array.isArray(arr) || ids.size === 0) return;
    const mantidos = arr.filter((item) => !ids.has(item?.id));
    arr.length = 0;
    arr.push(...mantidos);
}

/**
 * @private Acrescenta a `arr` os itens de `novos` cujo id ainda não está lá, IN PLACE.
 * @param {*} arr
 * @param {Array} novos
 */
function appendMissingInPlace(arr, novos) {
    if (!Array.isArray(arr)) return;
    const presentes = new Set(arr.map((item) => item?.id));
    for (const item of novos) {
        if (!presentes.has(item?.id)) arr.push(item);
    }
}

/**
 * @private A soma dos basemaps concedidos, que é a única que não mexe num array.
 *
 * `config.basemaps` é um OBJETO indexado por id, e o estilo MapLibre de cada um
 * viaja separado, em `config.basemapStyles` — é assim que o servidor entrega os
 * públicos (`config.service.js` separa os dois na montagem do `/api/config`),
 * enquanto o payload aditivo traz o item INTEIRO, com o estilo dentro. Reprojetar
 * aqui é o que torna um basemap concedido indistinguível de um público para quem
 * consome: o seletor de camada base lê `config.basemaps` e mais nada.
 *
 * O BASELINE GUARDA SÓ O FLAG `enabled` (é o que `captureBaseline` captura e o que
 * `revertAtlasSettings` restaura), então o id concedido precisa entrar LÁ também,
 * senão a interseção da allowlist do atlas nunca o alcançaria — que é o caminho
 * pelo qual um Gestor restringe camadas base.
 *
 * @param {Array} anteriores - Os basemaps da soma anterior, a serem removidos.
 * @param {Array} novos - Os desta soma.
 */
function aplicarBasemapsConcedidos(anteriores, novos) {
    for (const item of anteriores) {
        const id = item?.id;
        if (id == null) continue;
        delete config.basemaps?.[id];
        delete config.basemapStyles?.[id];
        if (_baseline) delete _baseline.basemaps[id];
    }
    if (!config.basemaps) return;
    for (const item of novos) {
        const id = item?.id;
        if (id == null) continue;
        const meta = { ...item };
        const style = meta.style;
        delete meta.id;
        delete meta.style;
        config.basemaps[id] = meta;
        if (style && config.basemapStyles) config.basemapStyles[id] = style;
        if (_baseline) _baseline.basemaps[id] = meta.enabled !== false;
    }
}

/**
 * Soma ao baseline os recursos PRIVADOS que o servidor concedeu a este usuário
 * (`GET /api/v1/resource-access/visible`).
 *
 * AMPLIATIVO, ao contrário de tudo o mais neste arquivo. `applyAtlasSettings`
 * RESTRINGE (interseção) e nunca pode habilitar o que o deploy desabilitou; esta
 * função é o outro sentido, e as duas convivem por uma ordem fixa (D1): o baseline
 * passa a ser `público(deploy) ∪ concedido(pessoal) ∪ emprestado(atlas)`, e só
 * depois a allowlist do atlas intersecta por cima. A ordem inversa faria o recurso
 * emprestado escapar da restrição que o Gestor configurou no mesmo atlas.
 *
 * POR QUE ELA MEXE NO `_baseline`, E NÃO SÓ NO `config`. O baseline é capturado na
 * PRIMEIRA chamada de `applyAtlasSettings` e `revertAtlasSettings` restaura
 * exatamente aquilo. Se a soma chegasse depois do primeiro apply e mexesse só no
 * `config`, o revert apagaria os recursos concedidos e eles não voltariam até um
 * F5. Por isso a soma entra no baseline, e por isso ela RE-APLICA a interseção
 * quando já existe overlay: assim a ordem de chegada deixa de decidir o resultado.
 *
 * Chamar de novo SUBSTITUI a soma anterior (o payload é a verdade do escopo atual),
 * e não acumula: sair de um atlas que empresta e entrar noutro que não empresta
 * precisa tirar o que o primeiro deu.
 *
 * @param {{basemaps?: Array, tilesets?: Array, dataLayers?: Array, analysisLayers?: Array, views360?: Array}} [payload]
 * @returns {void}
 */
export function mergeGrantedIntoBaseline(payload) {
    const anterior = _granted;
    _granted = {
        basemaps: Array.isArray(payload?.basemaps) ? [...payload.basemaps] : [],
        tilesets: Array.isArray(payload?.tilesets) ? [...payload.tilesets] : [],
        dataLayers: Array.isArray(payload?.dataLayers) ? [...payload.dataLayers] : [],
        analysisLayers: Array.isArray(payload?.analysisLayers) ? [...payload.analysisLayers] : [],
        views360: Array.isArray(payload?.views360) ? [...payload.views360] : [],
    };

    aplicarBasemapsConcedidos(anterior.basemaps, _granted.basemaps);

    for (const grupo of GRUPOS_CONCEDIDOS) {
        const idsAntigos = new Set(anterior[grupo.chave].map((item) => item?.id));
        const novos = _granted[grupo.chave];

        if (_baseline) {
            removeByIdInPlace(_baseline[grupo.campoBaseline], idsAntigos);
            appendMissingInPlace(_baseline[grupo.campoBaseline], novos);
        }
        // O array VIVO também, porque sem overlay ativo ninguém mais o tocaria —
        // e é ele que o catálogo já capturou por referência.
        removeByIdInPlace(grupo.vivo(), idsAntigos);
        appendMissingInPlace(grupo.vivo(), novos);
    }

    // D1: com overlay ativo, a interseção precisa correr DE NOVO por cima do
    // baseline recém-somado. Sem isto, um recurso concedido que a allowlist do
    // atlas não lista continuaria visível até o próximo apply.
    if (_baseline) applyAtlasSettings(_lastSettings);
}

/** Os panoramas 360 privados concedidos (o 360 não mora em `config`). @returns {Array} */
export function getGrantedViews360() {
    return _granted.views360;
}

/**
 * Desfaz a soma dos recursos concedidos (logout, ou troca de escopo).
 *
 * Independente de `revertAtlasSettings`, e as duas podem rodar em qualquer ordem:
 * esta tira os ids concedidos do baseline E do `config` vivo, aquela restaura o
 * baseline por cima do `config`. Chamar só uma delas deixa metade do trabalho
 * feito, e é por isso que o motor de sync chama as duas no mesmo ponto.
 * @returns {void}
 */
export function revertGrantedResources() {
    mergeGrantedIntoBaseline(null);
}

/**
 * Restores the deploy-level baseline (call on disconnect / return to the local store).
 * No-op if nothing was applied.
 */
export function revertAtlasSettings() {
    if (!_baseline) return;
    if (config.features) {
        config.features.map_3d = _baseline.map_3d;
        config.features.imagens_panoramicas = _baseline.imagens_panoramicas;
        config.features.terrain_3d = _baseline.terrain_3d;
    }
    if (config.basemaps) {
        for (const [id, enabled] of Object.entries(_baseline.basemaps)) {
            if (config.basemaps[id]) config.basemaps[id].enabled = enabled;
        }
    }
    if (config.dataLayers) {
        replaceArrayInPlace(config.dataLayers.layers, _baseline.dataLayers);
        config.dataLayers.enabled = _baseline.dataLayersEnabled;
    }
    if (config.analysisLayers) {
        replaceArrayInPlace(config.analysisLayers.layers, _baseline.analysisLayers);
        config.analysisLayers.enabled = _baseline.analysisLayersEnabled;
    }
    replaceArrayInPlace(config.tilesets, _baseline.tilesets);
    _atlas360Allowlist = null;
    _baseline = null;
    _lastSettings = null;
    // `_granted` NÃO é zerado aqui, e a omissão é deliberada: o baseline que
    // acabou de ser restaurado CONTÉM os recursos concedidos (é o que impede o
    // revert de apagá-los), então esquecer quais são deixaria
    // `revertGrantedResources()` sem como tirá-los depois.
}

/**
 * Returns the deploy-level (UNrestricted) data layers. The atlas-config modal must use this — not
 * `config.dataLayers.layers`, which the active overlay has already FILTERED — so a manager always
 * sees the full list and can re-enable a previously restricted layer. Falls back to the live config
 * when no overlay is active (then it IS the full deploy list).
 *
 * Desde os recursos privados, "deploy-level" significa PÚBLICO ∪ CONCEDIDO, e é o
 * conjunto certo para a tela de restrição: o Gestor precisa poder listar na
 * allowlist um recurso privado que ele enxerga, senão restringir a categoria o
 * derrubaria sem que ele tivesse como reinclui-lo (D1).
 * @returns {Array}
 */
export function getDeployDataLayers() {
    if (_baseline) return _baseline.dataLayers;
    return Array.isArray(config.dataLayers?.layers) ? config.dataLayers.layers : [];
}

/** As {@link getDeployDataLayers}, for analysis layers. @returns {Array} */
export function getDeployAnalysisLayers() {
    if (_baseline) return _baseline.analysisLayers;
    return Array.isArray(config.analysisLayers?.layers) ? config.analysisLayers.layers : [];
}

/** As {@link getDeployDataLayers}, for 3D models (config.tilesets). @returns {Array} */
export function getDeployTilesets() {
    if (_baseline) return _baseline.tilesets;
    return Array.isArray(config.tilesets) ? config.tilesets : [];
}

/** The per-atlas 360-view allowlist (raw ids), or null = no restriction. @returns {string[]|null} */
export function getAtlas360Allowlist() {
    return _atlas360Allowlist;
}

/** Test hook: resets the captured baseline. @private */
export function _resetAtlasSettingsBaseline() {
    _baseline = null;
    _lastSettings = null;
    _granted = { basemaps: [], tilesets: [], dataLayers: [], analysisLayers: [], views360: [] };
}
