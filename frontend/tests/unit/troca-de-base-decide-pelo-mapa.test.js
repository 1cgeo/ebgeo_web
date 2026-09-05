// Path: tests/unit/troca-de-base-decide-pelo-mapa.test.js

/**
 * @fileoverview A TROCA DE MAPA BASE DECIDE PELO MAPA, E NÃO PELA CRENÇA DO CONTROLE.
 *
 * O QUE ESTAVA ERRADO. `switchLayer` pulava a troca quando `this.currentLayer === layer`.
 * `currentLayer` é um ID guardado no StateManager, e um id não determina mais um estilo
 * neste ramo: o de uma camada base NÃO embutida resolve por `config.basemapStyles`, e essa
 * tabela é gravada e apagada em tempo de execução por
 * `store/sync/atlas-settings.service.js`, toda vez que o pacote aditivo de concessão chega
 * ou é retirado. O mesmo id passa a nomear outro estilo, o portão de id não vê nada, e o
 * mapa fica com a base velha enquanto o seletor marca a nova.
 *
 * O SEGUNDO MODO DE FALHA é o oposto e custa 10 s: `carta_topografica` e `osm_layer` são o
 * MESMO estilo (`baselayer-style-uniqueness.repro.test.js`). Trocar entre os dois faz o
 * portão de id chamar `setStyle`, o diff do MapLibre resolve em zero operações e o
 * `styledata` nunca vem, então o caminho espera o temporizador inteiro.
 *
 * ESTE ARQUIVO DIRIGE O CONTROLE DE VERDADE contra um mapa falso, porque é o portão que
 * está sob teste e não a função pura que ele chama (essa é `style-transform.test.js`). O
 * que o mapa falso impõe são as duas coisas que decidem: qual estilo ele devolve em
 * `getStyle()` e quais camadas ele reconhece em `getLayer()`.
 *
 * O QUE ELE NÃO ALCANÇA: nada de MapLibre real, store, sync ou DOM. Ele diz que o portão
 * decide certo, nunca que o `setStyle` do MapLibre desenhou.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const estadoDaCrenca = { valor: undefined };
const chamadas = { setBaseLayer: [], setupMapFeatures: [] };

vi.mock('../../src/js/store', () => ({
    setBaseLayer: async (id) => { chamadas.setBaseLayer.push(id); },
    getCurrentMapName: async () => 'mapa-1',
    getCurrentBaseLayer: async () => 'carta-topografica',
    hasMapSavedPosition: async () => false,
    getMapPosition: async () => null,
    getCatalogLayers: async () => [],
    getEventBus: () => ({ on: () => () => {}, emit: () => {} }),
    getStateManager: () => ({
        get: (chave) => (chave === 'baseLayer.activeLayer' ? estadoDaCrenca.valor : undefined),
        set: (chave, valor) => { if (chave === 'baseLayer.activeLayer') estadoDaCrenca.valor = valor; },
    }),
    getControl: () => null,
    isCurrentMapLockedSync: () => false,
}));

vi.mock('../../src/js/store/atlas-appearance.service.js', () => ({
    currentGlobeProjection: () => false,
    refreshAtlasAppearance: async () => {},
    reapplyAtlasAppearance: async () => {},
}));

vi.mock('../../src/js/terrain/layer-failure-notice.js', () => ({
    getLayerFailureNotice: () => ({ reportBasemapFailure: () => {}, clearBasemapFailure: () => {} }),
}));

vi.mock('../../src/js/layers', () => ({
    setupMapFeatures: async (_map, _a, _d, _bus, options) => { chamadas.setupMapFeatures.push(options); },
}));

vi.mock('../../src/js/layers/layer_setup.js', () => ({
    clearFeatureSources: () => {},
}));

vi.mock('../../src/js/layers/remote-feature-render.js', () => ({
    wireRemoteFeatureRender: () => () => {},
}));

vi.mock('../../src/js/utilities', () => ({ showError: () => {} }));

const ESTILO_PUBLICADO = {};

vi.mock('../../src/js/config.js', () => ({
    default: {
        validateBasemapsConfig: () => {},
        getEnabledBasemaps: () => [
            ['carta-topografica', { name: 'Carta Topográfica' }],
            ['osm', { name: 'OSM' }],
            ['imagens', { name: 'Imagens' }],
            ['acervo-x', { name: 'Acervo restrito' }],
        ],
        getBasemapLayoutClass: () => 'layout',
        getValidBasemapFallback: (id) => id,
        basemaps: {
            'carta-topografica': { name: 'Carta Topográfica' },
            osm: { name: 'OSM' },
            imagens: { name: 'Imagens' },
            'acervo-x': { name: 'Acervo restrito' },
        },
        get basemapStyles() { return ESTILO_PUBLICADO; },
        map2d: { minZoom: 2, maxZoom: 21 },
        features: { grid: false },
    },
}));

const { default: BaseLayerControl, DEFAULT_LAYER, initialBaseStyle } = await import('../../src/js/baselayers/base-layer.control.js');
const { default: cartaTopografica } = await import('../../src/js/baselayers/carta_topografica.js');
const { default: osmLayer } = await import('../../src/js/baselayers/osm_layer.js');
const { default: imagensLayer } = await import('../../src/js/baselayers/imagens_layer.js');

/**
 * Mapa falso que responde às DUAS perguntas do portão: que estilo ele tem e que camadas
 * reconhece. `setStyle` aplica o `transformStyle` do chamador sobre o estilo serializado,
 * como o `Style.setState` do bundle em uso faz, e emite `styledata` só quando o diff
 * mudou alguma coisa: é assim que o diff vazio deixa de emitir evento na vida real.
 */
function mapaFalso(estiloInicial) {
    const ouvintes = new Map();
    const map = {
        _estilo: JSON.parse(JSON.stringify(estiloInicial)),
        _setStyles: [],
        _sky: [],
        getStyle() { return this._estilo; },
        getLayer(id) { return (this._estilo?.layers || []).find((l) => l.id === id) || null; },
        getSource(id) { return this._estilo?.sources?.[id] || null; },
        setStyle(proximo, opcoes = {}) {
            map._setStyles.push(proximo);
            const antes = map._estilo;
            const alvo = opcoes.transformStyle ? opcoes.transformStyle(antes, proximo) : proximo;
            const mudou = JSON.stringify(alvo) !== JSON.stringify(antes);
            map._estilo = JSON.parse(JSON.stringify(alvo));
            if (mudou) queueMicrotask(() => { for (const fn of ouvintes.get('styledata') || []) fn({}); });
        },
        setSky(v) { map._sky.push(v); },
        setProjection() {},
        on(evt, fn) { if (!ouvintes.has(evt)) ouvintes.set(evt, new Set()); ouvintes.get(evt).add(fn); },
        off(evt, fn) { ouvintes.get(evt)?.delete(fn); },
        getMinZoom: () => 2,
        getMaxZoom: () => 21,
        setMinZoom() {},
        setMaxZoom() {},
    };
    return map;
}

/** O estilo como o MapLibre o serializa depois de a aplicação desenhar por cima da base. */
function comApp(base) {
    return {
        ...base,
        sources: { ...base.sources, points: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
        layers: [...base.layers, { id: 'point-layer', type: 'circle', source: 'points' }],
    };
}

function controle(map) {
    const c = new BaseLayerControl(undefined, undefined);
    c.map = map;
    // `onAdd` monta DOM, e o ambiente da suíte é node. O que `syncVisualState` precisa é
    // só um container que responda às duas consultas.
    c.container = { querySelectorAll: () => [], querySelector: () => null };
    return c;
}

beforeEach(() => {
    estadoDaCrenca.valor = undefined;
    chamadas.setBaseLayer.length = 0;
    chamadas.setupMapFeatures.length = 0;
    for (const k of Object.keys(ESTILO_PUBLICADO)) delete ESTILO_PUBLICADO[k];
});

describe('o estilo de nascimento e a crença do controle são a MESMA coisa', () => {
    it('`initialBaseStyle()` é o estilo de DEFAULT_LAYER, resolvido como a troca resolve', () => {
        expect(DEFAULT_LAYER).toBe('carta-topografica');
        expect(initialBaseStyle()).toBe(cartaTopografica);
    });

    it('o controle nasce sabendo os ids DESSA base, que é como ele separa base de aplicação', () => {
        const c = controle(mapaFalso(comApp(cartaTopografica)));
        expect([...c._baseStyleIds.sources]).toEqual(Object.keys(cartaTopografica.sources));
        expect([...c._baseStyleIds.layers]).toEqual(cartaTopografica.layers.map((l) => l.id));
    });
});

describe('o portão de switchLayer', () => {
    it('O PIOR CASO: o mesmo id com o estilo publicado trocado sob ele NÃO é pulado', async () => {
        const v1 = { version: 8, name: 'acervo_v1', sources: { p: { type: 'raster', tiles: ['a'] } }, layers: [{ id: 'acervo_v1_raster', type: 'raster', source: 'p' }] };
        const v2 = { version: 8, name: 'acervo_v2', sources: { p: { type: 'raster', tiles: ['b'] } }, layers: [{ id: 'acervo_v2_raster', type: 'raster', source: 'p' }] };

        // O mapa nasce com a base do controle, e a primeira troca leva a concedida: é
        // ela que grava os ids da base nova dentro do próprio `transformStyle`.
        ESTILO_PUBLICADO['acervo-x'] = v1;
        const map = mapaFalso(comApp(cartaTopografica));
        const c = controle(map);
        await c.switchLayer('acervo-x');
        expect(map.getLayer('acervo_v1_raster')).not.toBeNull();
        expect(c.currentLayer).toBe('acervo-x');

        // A concessão é reemitida com OUTRO estilo, sob o mesmo id.
        ESTILO_PUBLICADO['acervo-x'] = v2;
        await c.switchLayer('acervo-x');

        expect(map._setStyles).toHaveLength(2);
        expect(map.getLayer('acervo_v2_raster')).not.toBeNull();
        expect(map.getLayer('acervo_v1_raster')).toBeNull();
        // E o desenho da aplicação atravessou a troca.
        expect(map.getSource('points')).not.toBeNull();
        expect(map.getLayer('point-layer')).not.toBeNull();
    });

    it('o estilo que JÁ está no mapa é pulado, mesmo com a crença dizendo outra coisa', async () => {
        const map = mapaFalso(comApp(imagensLayer));
        const c = controle(map);
        estadoDaCrenca.valor = 'carta-topografica';

        await c.switchLayer('imagens');

        expect(map._setStyles).toHaveLength(0);
        // E a crença passa a dizer a verdade: `applySharedBasemap` a devolve como
        // a resposta sobre o que está na tela.
        expect(c.currentLayer).toBe('imagens');
    });

    it('carta-topografica e osm partilham um estilo: a troca entre elas não chama setStyle', async () => {
        // O diff vazio nunca emite `styledata`, e o portão de id pagava os 10 s do
        // temporizador em toda troca dessas.
        expect(JSON.stringify(cartaTopografica)).toBe(JSON.stringify(osmLayer));
        const map = mapaFalso(comApp(cartaTopografica));
        const c = controle(map);
        estadoDaCrenca.valor = 'carta-topografica';

        await c.switchLayer('osm');

        expect(map._setStyles).toHaveLength(0);
        expect(c.currentLayer).toBe('osm');
    });

    it('a base de verdade diferente é trocada, e o desenho do app sobrevive à troca', async () => {
        const map = mapaFalso(comApp(cartaTopografica));
        const c = controle(map);
        estadoDaCrenca.valor = 'carta-topografica';

        await c.switchLayer('imagens');
        expect(map._setStyles).toHaveLength(1);
        expect(map.getLayer('satellite')).not.toBeNull();
        expect(map.getLayer('osm')).toBeNull();
        expect(map.getSource('points')).not.toBeNull();
        expect(map.getLayer('point-layer')).not.toBeNull();
        // A base nova entra POR BAIXO do que a aplicação desenhou.
        expect(map.getStyle().layers.map((l) => l.id)).toEqual(['satellite', 'point-layer']);

        // E a volta funciona: os ids da base foram regravados dentro do hook.
        await c.switchLayer('carta-topografica');
        expect(map._setStyles).toHaveLength(2);
        expect(map.getLayer('osm')).not.toBeNull();
        expect(map.getLayer('satellite')).toBeNull();
        expect(map.getStyle().layers.map((l) => l.id)).toEqual(['osm', 'point-layer']);
        expect(map.getSource('points')).not.toBeNull();
    });

    it('o mapa sem estilo nenhum ainda não tem a base pedida, e não derruba o portão', async () => {
        // `Map.getStyle()` chama `Style.serialize()`, que lê `this.stylesheet` sem guarda;
        // essa propriedade é nula até o primeiro estilo carregar.
        const map = mapaFalso(comApp(cartaTopografica));
        map.getStyle = () => { throw new TypeError("Cannot read properties of null (reading 'version')"); };
        const c = controle(map);
        await c.switchLayer('imagens');
        expect(map._setStyles).toHaveLength(1);
    });
});

describe('quem pode preservar o conteúdo, e quem não pode', () => {
    it('trocar SÓ o mapa base preserva', async () => {
        const c = controle(mapaFalso(comApp(cartaTopografica)));
        c.setDependencies({
            selectionManager: { deselectAllFeatures() {} },
            toolManager: { deactivateCurrentTool() {} },
            analysisLayersManager: {},
            dataLayersManager: {},
        });
        await c.executeLayerChange('imagens');
        expect(chamadas.setupMapFeatures).toEqual([{ contentPreserved: true }]);
    });

    it('todo o resto REMONTA: desfazer, refazer, trocar de mapa, importar, briefing', async () => {
        // Os dez chamadores de `switchMap` fora de `executeLayerChange` não passam opção
        // nenhuma, e é assim que tem de ser: eles mudaram o CONTEÚDO.
        const c = controle(mapaFalso(comApp(cartaTopografica)));
        c.setDependencies({
            selectionManager: { deselectAllFeatures() {} },
            toolManager: { deactivateCurrentTool() {} },
            analysisLayersManager: {},
            dataLayersManager: {},
        });
        await c.switchMap(false);
        await c.switchMap();
        expect(chamadas.setupMapFeatures).toEqual([{ contentPreserved: false }, { contentPreserved: false }]);
    });
});

// ============================================================================
// A lista que quem troca SOZINHO tem de consultar antes
// ============================================================================

describe('availableBasemaps: o que este controle consegue mesmo aplicar', () => {
    // POR QUE ESTA LISTA EXISTE (2026-09-05). `applySharedBasemap` passa o id por
    // `getValidBasemapFallback` ANTES de trocar, então um id que ninguém oferece não vira
    // "não faz nada": vira uma troca para outra base, calada. Quem decide automaticamente
    // (a base preferida do terreno) precisa perguntar antes, e perguntar por fora exigiria
    // o `STYLE_MAP`, que é privado do módulo.
    //
    // A régua que faltava: a fiação do terreno é medida com um dublê que ENTREGA a lista,
    // então ela passa inteira com este getter revertido. O controle negativo pegou.

    it('lista as habilitadas que resolvem para estilo, e omite a que não resolve', () => {
        // `acervo-x` está habilitada e não tem estilo embutido nem publicado: oferecida no
        // seletor, mas inaplicável. É exatamente ela que não pode entrar na lista.
        const c = controle(mapaFalso(comApp(cartaTopografica)));
        expect(c.availableBasemaps).toEqual(['carta-topografica', 'osm', 'imagens']);
    });

    it('a base concedida ENTRA assim que o estilo publicado chega, sem reconstruir o controle', () => {
        // O caso vivo: o pacote aditivo de concessão grava `config.basemapStyles` em tempo de
        // execução. Uma tabela montada no construtor descreveria para sempre o boot anônimo.
        const c = controle(mapaFalso(comApp(cartaTopografica)));
        expect(c.availableBasemaps).not.toContain('acervo-x');

        ESTILO_PUBLICADO['acervo-x'] = {
            version: 8,
            sources: { r: { type: 'raster', tiles: ['x'] } },
            layers: [{ id: 'r', type: 'raster', source: 'r' }],
        };
        expect(c.availableBasemaps).toContain('acervo-x');

        // E SAI de novo no logout, que é o outro lado da mesma propriedade.
        delete ESTILO_PUBLICADO['acervo-x'];
        expect(c.availableBasemaps).not.toContain('acervo-x');
    });

    it('estilo publicado MALFORMADO não entra na lista: ele deixaria o mapa em branco', () => {
        const c = controle(mapaFalso(comApp(cartaTopografica)));
        ESTILO_PUBLICADO['acervo-x'] = { version: 7, sources: {}, layers: [] };
        expect(c.availableBasemaps).not.toContain('acervo-x');
    });
});
