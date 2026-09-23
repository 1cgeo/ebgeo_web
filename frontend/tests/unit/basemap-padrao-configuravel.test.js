// Path: tests/unit/basemap-padrao-configuravel.test.js

/**
 * @fileoverview A BASE COM QUE O MAPA NASCE É ESCOLHA DO ADMINISTRADOR (pedido do dono, 2026-09-23).
 *
 * Era a constante `DEFAULT_LAYER = 'carta-topografica'` de `base-layer.control.js`, e virou
 * `config.map2d.defaultBasemap`, servido por `GET /api/config` e escolhido na aba Sistema. O que
 * este arquivo prende é o NASCIMENTO: o estilo com que `map_sig.js` cria o mapa
 * (`initialBaseStyle()`), os ids que o controle assume dessa mesma base no construtor, a crença
 * inicial dele e o recuo do getter. As quatro coisas têm de dizer a MESMA base, senão a primeira
 * troca mantém a base velha inteira por cima da nova (ver o JSDoc de `initialBaseLayer`).
 *
 * O `config` é o REAL, com os ajudantes reais (`initConfigHelpers`), porque a pergunta "a base
 * escolhida é oferecida a este visitante?" é respondida por `getEnabledBasemaps` e a ordem de
 * nascimento contra `validateBasemapsConfig` só se prova com a validação de verdade. O documento
 * de mapa novo é de `basemap-padrao-documento-novo.test.js`, e a aba do painel, de
 * `admin-mapa-base-inicial.test.js`.
 *
 * O QUE ELE NÃO ALCANÇA: MapLibre real, a ordem do boot em `index.js` (hidratação na Fase 1,
 * mapa na Fase 3) e o que o servidor recusa.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const estadoDaCrenca = { valor: undefined };

vi.mock('../../src/js/store', () => ({
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
    applyMapEntryTemporalView: async () => {},
}));

vi.mock('../../src/js/store/atlas-appearance.service.js', () => ({
    currentGlobeProjection: () => false,
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

const { default: config } = await import('../../src/js/config.js');
const { initConfigHelpers } = await import('../../src/js/config.helpers.js');
initConfigHelpers();

const { default: BaseLayerControl, initialBaseLayer, initialBaseStyle } = await import('../../src/js/baselayers/base-layer.control.js');
const { collectStyleIds } = await import('../../src/js/baselayers/style-transform.js');
const { default: cartaTopografica } = await import('../../src/js/baselayers/carta_topografica.js');
const { default: osmLayer } = await import('../../src/js/baselayers/osm_layer.js');
const { default: imagensLayer } = await import('../../src/js/baselayers/imagens_layer.js');

/** O catálogo da migração `005_catalogo.sql`, na ordem de prioridade de lá. */
function catalogoSemeado() {
    return {
        'carta-topografica': { name: 'Topográfica', enabled: true, priority: 1 },
        'carta-ortoimagem': { name: 'Ortoimagem', enabled: true, priority: 2 },
        bdgex: { name: 'BDGEx', enabled: true, priority: 3 },
        osm: { name: 'OpenStreetMaps', enabled: true, priority: 4 },
        imagens: { name: 'Imagens', enabled: true, priority: 5 },
    };
}

/** Um estilo publicado válido, para a base que o cliente não traz embutida. */
const ESTILO_DO_ACERVO = {
    version: 8,
    sources: { acervo: { type: 'raster', tiles: ['https://exemplo/{z}/{x}/{y}.png'] } },
    layers: [{ id: 'acervo-raster', type: 'raster', source: 'acervo' }],
};

const original = { basemaps: config.basemaps, basemapStyles: config.basemapStyles, map2d: config.map2d };

/** O controle como `map_sig.js` o constrói, sem DOM (a suíte roda em node). */
function controle() {
    const c = new BaseLayerControl(undefined, undefined);
    c.container = { querySelectorAll: () => [], querySelector: () => null };
    return c;
}

/**
 * Os ids de um estilo, ou os que o controle guardou, como listas, para comparar por valor.
 * @param {Object} estiloOuIds - Um estilo MapLibre, ou o `{ sources: Set, layers: Set }` do controle.
 */
function ids(estiloOuIds) {
    const { sources, layers } = estiloOuIds?.sources instanceof Set ? estiloOuIds : collectStyleIds(estiloOuIds);
    return { sources: [...sources], layers: [...layers] };
}

beforeEach(() => {
    estadoDaCrenca.valor = undefined;
    config.basemaps = catalogoSemeado();
    config.basemapStyles = {};
    config.map2d = { ...original.map2d };
});

afterEach(() => {
    config.basemaps = original.basemaps;
    config.basemapStyles = original.basemapStyles;
    config.map2d = original.map2d;
});

describe('sem escolha do administrador, nada muda', () => {
    it('o servidor sem a chave: nasce a carta topográfica, com o estilo embutido, como antes', () => {
        delete config.map2d.defaultBasemap;
        expect(initialBaseLayer()).toBe('carta-topografica');
        expect(initialBaseStyle()).toBe(cartaTopografica);
    });

    it('o padrão servido (`carta-topografica`) dá exatamente o mesmo nascimento', () => {
        config.map2d.defaultBasemap = 'carta-topografica';
        expect(initialBaseLayer()).toBe('carta-topografica');
        expect(initialBaseStyle()).toBe(cartaTopografica);

        const c = controle();
        expect(ids(c._baseStyleIds)).toEqual(ids(cartaTopografica));
        expect(c.currentLayer).toBe('carta-topografica');
    });
});

describe('a escolha do administrador vale no nascimento, e as quatro leituras concordam', () => {
    it('o mapa nasce com o estilo da base escolhida', () => {
        // `imagens` e não `osm`: o esboço de `osm` é o MESMO estilo da carta topográfica
        // (`baselayer-style-uniqueness.repro.test.js`), e um estilo igual não distinguiria nada.
        config.map2d.defaultBasemap = 'imagens';
        expect(initialBaseLayer()).toBe('imagens');
        expect(initialBaseStyle()).toBe(imagensLayer);
    });

    it('o controle assume os ids DESSA base e nasce acreditando nela', () => {
        config.map2d.defaultBasemap = 'imagens';
        const c = controle();
        expect(ids(c._baseStyleIds)).toEqual(ids(imagensLayer));
        expect(ids(c._baseStyleIds)).not.toEqual(ids(cartaTopografica));
        // A crença foi ESCRITA no construtor: o StateManager nasce dizendo `carta-topografica`,
        // e o seletor marcaria uma base enquanto o mapa mostra outra.
        expect(estadoDaCrenca.valor).toBe('imagens');
    });

    it('o recuo do getter, sem crença nenhuma, é a base de nascimento e não a constante velha', () => {
        config.map2d.defaultBasemap = 'imagens';
        const c = controle();
        estadoDaCrenca.valor = undefined;
        expect(c.currentLayer).toBe('imagens');
    });

    it('lida NA HORA, nunca guardada no carregamento do módulo', () => {
        // O módulo já foi importado lá em cima, antes de qualquer caso escrever a chave. Um valor
        // capturado no import diria o piso para sempre, que é o que o `config` vale antes da
        // hidratação.
        config.map2d.defaultBasemap = 'imagens';
        expect(initialBaseLayer()).toBe('imagens');
        config.map2d.defaultBasemap = 'carta-topografica';
        expect(initialBaseLayer()).toBe('carta-topografica');
    });

    it('um mapa base concedido que já chegou (sessão restaurada antes do mapa) nasce com o estilo publicado', () => {
        config.basemaps['acervo-x'] = { name: 'Acervo', enabled: true, priority: 0 };
        config.basemapStyles['acervo-x'] = ESTILO_DO_ACERVO;
        config.map2d.defaultBasemap = 'acervo-x';
        expect(initialBaseLayer()).toBe('acervo-x');
        expect(ids(initialBaseStyle())).toEqual(ids(ESTILO_DO_ACERVO));
        expect(ids(controle()._baseStyleIds)).toEqual(ids(ESTILO_DO_ACERVO));
    });
});

describe('quem não pode desenhar a escolha nasce no primeiro mapa base oferecido', () => {
    /** O catálogo com `osm` à frente, para que o recuo não coincida com o piso por acaso. */
    function comOsmPrimeiro() {
        const c = catalogoSemeado();
        c.osm.priority = 0;
        return c;
    }

    it('a escolha DESABILITADA depois de salva é pulada no nascimento', () => {
        config.basemaps = comOsmPrimeiro();
        config.basemaps.imagens.enabled = false;
        config.map2d.defaultBasemap = 'imagens';
        expect(initialBaseLayer()).toBe('osm');
        expect(initialBaseStyle()).toBe(osmLayer);
    });

    it('a escolha que este visitante não enxerga (privada sem concessão) também', () => {
        config.basemaps = comOsmPrimeiro();
        config.map2d.defaultBasemap = 'acervo-x';
        expect(initialBaseLayer()).toBe('osm');
    });

    it('a escolha oferecida mas SEM estilo nenhum cai no primeiro que resolve', () => {
        // Oferecida pelo seletor e inaplicável: `setStyle(null)` deixaria o mapa sem base.
        config.basemaps = comOsmPrimeiro();
        config.basemaps['acervo-x'] = { name: 'Acervo', enabled: true, priority: -1 };
        config.map2d.defaultBasemap = 'acervo-x';
        expect(initialBaseLayer()).toBe('osm');
    });

    it('catálogo vazio (nada hidratado): o piso, cujo estilo é embutido e sempre resolve', () => {
        config.basemaps = {};
        config.map2d.defaultBasemap = 'imagens';
        expect(initialBaseLayer()).toBe('carta-topografica');
        expect(initialBaseStyle()).toBe(cartaTopografica);
    });

    it('o controle e o mapa concordam mesmo quando `validateBasemapsConfig` reabilita uma base', () => {
        // O PIOR CASO da ordem do construtor. Tudo desabilitado, e sem a carta topográfica no
        // catálogo: `createMap` pergunta ANTES do construtor e ouve o piso; a validação, dentro do
        // construtor, reabilita `imagens` (a primeira entrada). Perguntada DEPOIS da validação, a
        // base de nascimento viraria `imagens`, e o controle assumiria ids que o mapa não tem.
        config.basemaps = {
            imagens: { name: 'Imagens', enabled: false, priority: 1 },
            osm: { name: 'OSM', enabled: false, priority: 2 },
        };
        config.map2d.defaultBasemap = 'osm';

        const estiloDoMapa = initialBaseStyle();
        expect(estiloDoMapa).toBe(cartaTopografica);

        const c = controle();
        expect(config.basemaps.imagens.enabled).toBe(true);
        expect(ids(c._baseStyleIds)).toEqual(ids(estiloDoMapa));
        expect(c.currentLayer).toBe('carta-topografica');
    });
});
