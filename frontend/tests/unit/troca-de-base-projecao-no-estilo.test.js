// Path: tests/unit/troca-de-base-projecao-no-estilo.test.js

/**
 * @fileoverview A PROJEÇÃO DA TROCA DE MAPA BASE VAI DENTRO DO ESTILO, e nunca é escrita num
 * estilo que ainda está carregando.
 *
 * O DEFEITO (tabela de defeitos da pilha de teste, release 1c3c19c9, 3 ocorrências em 2 sessões):
 * "Error: Style is not done loading.", de `Style._checkLoaded` <- `Map.setProjection` <-
 * `switchLayer` <- `switchMap`. `switchLayer` esperava o PRIMEIRO `styledata` (ou os 10 s do
 * temporizador) e então chamava `map.setProjection({ type: 'globe' })` e `map.setSky(undefined)`.
 * Os dois passam por `_checkLoaded`, e o primeiro `styledata` não quer dizer "carregado": numa
 * remontagem de estilo o `_loaded` ainda é falso, e o `setProjection` lança.
 *
 * O MAPA FALSO IMPÕE A GUARDA REAL: `setProjection` e `setSky` lançam a mesma frase enquanto o
 * estilo pedido não terminou de carregar, e o `styledata` chega ANTES do fim da carga, como na
 * remontagem. O estilo pedido só "pousa" num temporizador, e é nesse instante que o
 * `transformStyle` do chamador roda, como no `Style._load` do bundle em uso.
 *
 * CONTROLES NEGATIVOS (o que fica vermelho ao voltar ao código anterior):
 *   - repor o `this.map.setProjection({ type: 'globe' })` depois da espera: o primeiro caso
 *     reprova com "Style is not done loading.";
 *   - repor só o `this.map.setSky(undefined)`: o mesmo caso reprova pela mesma frase;
 *   - calcular a projeção FORA do `transformStyle` (no início de `switchLayer`): o caso da troca
 *     dupla reprova, porque o estilo da primeira pousa com a escolha velha.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const estado = { globo: true, terrenoAtivo: false, crenca: undefined };

vi.mock('../../src/js/store', () => ({
    setBaseLayer: async () => {},
    getCurrentMapName: async () => 'mapa-1',
    getCurrentBaseLayer: async () => 'carta-topografica',
    hasMapSavedPosition: async () => false,
    getMapPosition: async () => null,
    getCatalogLayers: async () => [],
    getEventBus: () => ({ on: () => () => {}, emit: () => {} }),
    getStateManager: () => ({
        get: (chave) => (chave === 'baseLayer.activeLayer' ? estado.crenca : undefined),
        set: (chave, valor) => { if (chave === 'baseLayer.activeLayer') estado.crenca = valor; },
    }),
    getControl: (nome) => (nome === 'TerrainControl' ? { _wasTerrainActive: estado.terrenoAtivo } : null),
    isCurrentMapLockedSync: () => false,
}));

vi.mock('../../src/js/store/atlas-appearance.service.js', () => ({
    currentGlobeProjection: () => estado.globo,
    refreshAtlasAppearance: async () => {},
    reapplyAtlasAppearance: async () => {},
}));

vi.mock('../../src/js/terrain/layer-failure-notice.js', () => ({
    getLayerFailureNotice: () => ({ reportBasemapFailure: () => {}, clearBasemapFailure: () => {} }),
}));
vi.mock('../../src/js/layers', () => ({ setupMapFeatures: async () => {} }));
vi.mock('../../src/js/layers/layer_setup.js', () => ({ clearFeatureSources: () => {} }));
vi.mock('../../src/js/layers/remote-feature-render.js', () => ({ wireRemoteFeatureRender: () => () => {} }));
vi.mock('../../src/js/utilities', () => ({ showError: () => {} }));

vi.mock('../../src/js/config.js', () => ({
    default: {
        validateBasemapsConfig: () => {},
        getEnabledBasemaps: () => [['carta-topografica', {}], ['imagens', {}], ['bdgex', {}]],
        getBasemapLayoutClass: () => 'layout',
        getValidBasemapFallback: (id) => id,
        basemaps: { 'carta-topografica': {}, imagens: {}, bdgex: {} },
        basemapStyles: {},
        map2d: { minZoom: 2, maxZoom: 21 },
        features: { grid: false },
    },
}));

const { default: BaseLayerControl } = await import('../../src/js/baselayers/base-layer.control.js');
const { withSwitchAppearance } = await import('../../src/js/baselayers/style-transform.js');
const { default: cartaTopografica } = await import('../../src/js/baselayers/carta_topografica.js');

const NAO_CARREGADO = 'Style is not done loading.';

/**
 * Mapa falso com a guarda de `Style._checkLoaded`: `setStyle` REMONTA (o estilo fica não
 * carregado), emite `styledata` antes de terminar, e só pousa o estilo, rodando o
 * `transformStyle`, depois de `atrasoMs`.
 */
function mapaQueRemonta(estiloInicial, atrasoMs = 15) {
    const ouvintes = new Map();
    const emitir = (evt) => { for (const fn of [...(ouvintes.get(evt) || [])]) fn({}); };
    const map = {
        _estilo: JSON.parse(JSON.stringify(estiloInicial)),
        _carregado: true,
        _pousos: [],
        _escritasDiretas: [],
        getStyle() { return this._estilo; },
        getLayer(id) { return (this._estilo?.layers || []).find((l) => l.id === id) || null; },
        getSource(id) { return this._estilo?.sources?.[id] || null; },
        isStyleLoaded() { return this._carregado; },
        setStyle(proximo, opcoes = {}) {
            map._carregado = false;
            // O `styledata` que chega ANTES do fim da carga: o primeiro evento não é "carregado".
            queueMicrotask(() => emitir('styledata'));
            setTimeout(() => {
                const antes = map._estilo;
                const alvo = opcoes.transformStyle ? opcoes.transformStyle(antes, proximo) : proximo;
                map._estilo = JSON.parse(JSON.stringify(alvo));
                map._carregado = true;
                map._pousos.push({ projecao: alvo.projection?.type ?? null, ceu: 'sky' in alvo });
                emitir('style.load');
            }, atrasoMs);
        },
        setProjection(p) {
            if (!map._carregado) throw new Error(NAO_CARREGADO);
            map._escritasDiretas.push(['setProjection', p]);
        },
        setSky(s) {
            if (!map._carregado) throw new Error(NAO_CARREGADO);
            map._escritasDiretas.push(['setSky', s]);
        },
        on(evt, fn) { if (!ouvintes.has(evt)) ouvintes.set(evt, new Set()); ouvintes.get(evt).add(fn); },
        once(evt, fn) { const um = (e) => { map.off(evt, um); fn(e); }; map.on(evt, um); },
        off(evt, fn) { ouvintes.get(evt)?.delete(fn); },
        getMinZoom: () => 2,
        getMaxZoom: () => 21,
        setMinZoom() {},
        setMaxZoom() {},
    };
    return map;
}

function controle(map) {
    const c = new BaseLayerControl(undefined, undefined);
    c.map = map;
    c.container = { querySelectorAll: () => [], querySelector: () => null };
    return c;
}

const esperarPousos = (map, n) => vi.waitFor(() => expect(map._pousos.length).toBeGreaterThanOrEqual(n));

beforeEach(() => {
    estado.globo = true;
    estado.terrenoAtivo = false;
    estado.crenca = undefined;
});

describe('withSwitchAppearance (puro)', () => {
    it('globo pedido e terreno desligado: a projeção vai no estilo, e o céu sai', () => {
        const s = { version: 8, sky: { 'sky-color': '#fff' }, sources: {}, layers: [] };
        const r = withSwitchAppearance(s, { globe: true, terrainActive: false });
        expect(r.projection).toEqual({ type: 'globe' });
        expect('sky' in r).toBe(false);
        // Não muta a entrada: ela é o estilo mesclado que o MapLibre ainda vai ler.
        expect(s.sky).toEqual({ 'sky-color': '#fff' });
    });

    it('terreno ligado ou plano pedido: fica a projeção que a mesclagem manteve', () => {
        const s = { version: 8, projection: { type: 'mercator' }, sources: {}, layers: [] };
        expect(withSwitchAppearance(s, { globe: true, terrainActive: true }).projection).toEqual({ type: 'mercator' });
        expect(withSwitchAppearance(s, { globe: false, terrainActive: false }).projection).toEqual({ type: 'mercator' });
        expect(withSwitchAppearance({ version: 8, sources: {}, layers: [] }, { globe: false, terrainActive: false }).projection)
            .toBeUndefined();
    });

    it('o que não é objeto passa intacto', () => {
        for (const x of [null, undefined, 'https://h/estilo.json']) {
            expect(withSwitchAppearance(x, { globe: true, terrainActive: false })).toBe(x);
        }
    });
});

describe('switchLayer sobre um estilo que remonta', () => {
    it('não escreve projeção nem céu no mapa, e o estilo pousa com o globo', async () => {
        const map = mapaQueRemonta(cartaTopografica);
        const c = controle(map);

        await expect(c.switchLayer('imagens')).resolves.toBeUndefined();
        await esperarPousos(map, 1);

        expect(map._escritasDiretas).toEqual([]);
        expect(map._pousos).toEqual([{ projecao: 'globe', ceu: false }]);
        expect(map.getStyle().projection).toEqual({ type: 'globe' });
    });

    it('com o terreno ligado o globo não entra (MapLibre #4792)', async () => {
        estado.terrenoAtivo = true;
        const map = mapaQueRemonta(cartaTopografica);
        await controle(map).switchLayer('imagens');
        await esperarPousos(map, 1);
        expect(map._pousos).toEqual([{ projecao: null, ceu: false }]);
        expect(map._escritasDiretas).toEqual([]);
    });

    it('TROCA DUPLA RÁPIDA: cada estilo pousa com a escolha do instante em que pousa', async () => {
        const map = mapaQueRemonta(cartaTopografica, 25);
        const c = controle(map);

        const primeira = c.switchLayer('imagens');
        // O atlas muda para "plano" e a pessoa troca de novo antes de a primeira pousar.
        estado.globo = false;
        const segunda = c.switchLayer('bdgex');
        await Promise.all([primeira, segunda]);
        await esperarPousos(map, 2);

        // Nenhum pouso leva o globo que valia quando a PRIMEIRA troca começou.
        expect(map._pousos.map((p) => p.projecao)).toEqual([null, null]);
        expect(map._escritasDiretas).toEqual([]);
        expect(map.getStyle().projection).toBeUndefined();
    });
});
