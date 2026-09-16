// Path: tests/integration/basemap-remoto-na-tela.test.js
//
// A TROCA DE MAPA BASE DE UM PAR CHEGA À TELA (2026-09-16).
//
// O DEFEITO QUE ESTE ARQUIVO PRENDE, medido com dois navegadores contra o ambiente real: a
// operação do colega era gravada no registro do mapa e o handler emitia `BASE_LAYER_CHANGED`, mas
// quem chama `map.setStyle` é o `BaseLayerControl`, que é o EMISSOR daquele evento e nunca o
// ouviu. No par, o CARTÃO do seletor passava a mostrar a base nova enquanto o MapLibre seguia
// desenhando a antiga (medido: 242 camadas do estilo velho contra 335 do novo), e só um F5
// trocava de verdade. A UI anunciava uma base que a tela não tinha.
//
// ELE DIRIGE O CONTROLE DE VERDADE, no molde de `tests/unit/troca-de-base-decide-pelo-mapa.test.js`:
// o que está sob teste é o ouvinte do controle, não uma cópia dele escrita no teste. O sinal medido
// é `setStyle` no mapa falso, ou seja o gesto que troca o que está desenhado.
//
// O QUE ELE NÃO ALCANÇA: MapLibre real, sync real e DOM. Ele diz que o controle aplica a base do
// par no mapa certo, nunca que o tile chegou.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const chamadas = { setBaseLayer: [], setupMapFeatures: [] };
const barramento = criarBarramento();
const estado = { mapaAtivo: 'mapa-1', crenca: undefined };

function criarBarramento() {
    const registro = new Map();
    return {
        on(evento, handler) {
            if (!registro.has(evento)) registro.set(evento, new Set());
            registro.get(evento).add(handler);
            return () => registro.get(evento).delete(handler);
        },
        off(evento, handler) { registro.get(evento)?.delete(handler); },
        emitidos: [],
        emit(evento, payload) {
            this.emitidos.push({ evento, payload });
            for (const handler of [...(registro.get(evento) ?? [])]) handler(payload);
        },
        async disparar(evento, payload) {
            const saidas = [...(registro.get(evento) ?? [])].map((h) => h(payload));
            await Promise.all(saidas);
        },
        contar(evento) { return registro.get(evento)?.size ?? 0; },
    };
}

vi.mock('../../src/js/store', () => ({
    setBaseLayer: async (id) => { chamadas.setBaseLayer.push(id); },
    getCurrentMapName: async () => estado.mapaAtivo,
    getCurrentBaseLayer: async () => 'carta-topografica',
    hasMapSavedPosition: async () => false,
    getMapPosition: async () => null,
    getCatalogLayers: async () => [],
    getEventBus: () => barramento,
    getStateManager: () => ({
        get: (chave) => (chave === 'baseLayer.activeLayer' ? estado.crenca : undefined),
        set: (chave, valor) => { if (chave === 'baseLayer.activeLayer') estado.crenca = valor; },
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

vi.mock('../../src/js/layers/layer_setup.js', () => ({ clearFeatureSources: () => {} }));
vi.mock('../../src/js/layers/remote-feature-render.js', () => ({ wireRemoteFeatureRender: () => () => {} }));
vi.mock('../../src/js/utilities', () => ({ showError: () => {} }));

vi.mock('../../src/js/config.js', () => ({
    default: {
        validateBasemapsConfig: () => {},
        getEnabledBasemaps: () => [
            ['carta-topografica', { name: 'Carta Topográfica' }],
            ['imagens', { name: 'Imagens' }],
        ],
        getBasemapLayoutClass: () => 'layout',
        getValidBasemapFallback: (id) => id,
        basemaps: {
            'carta-topografica': { name: 'Carta Topográfica' },
            imagens: { name: 'Imagens' },
        },
        get basemapStyles() { return {}; },
        map2d: { minZoom: 2, maxZoom: 21 },
        features: { grid: false },
    },
}));

const { EventTypes } = await import('../../src/js/events/event_types.js');
const { default: BaseLayerControl } = await import('../../src/js/baselayers/base-layer.control.js');
const { default: cartaTopografica } = await import('../../src/js/baselayers/carta_topografica.js');

/** Mapa falso: registra os `setStyle`, que é o gesto que troca o que está na tela. */
function mapaFalso(estiloInicial) {
    const ouvintes = new Map();
    return {
        _estilo: JSON.parse(JSON.stringify(estiloInicial)),
        _setStyles: [],
        getStyle() { return this._estilo; },
        getLayer(id) { return (this._estilo?.layers || []).find((l) => l.id === id) || null; },
        getSource(id) { return this._estilo?.sources?.[id] || null; },
        setStyle(proximo, opcoes = {}) {
            this._setStyles.push(proximo);
            const alvo = opcoes.transformStyle ? opcoes.transformStyle(this._estilo, proximo) : proximo;
            this._estilo = JSON.parse(JSON.stringify(alvo));
            queueMicrotask(() => { for (const fn of ouvintes.get('styledata') || []) fn({}); });
        },
        setSky() {}, setProjection() {},
        on(evt, fn) { if (!ouvintes.has(evt)) ouvintes.set(evt, new Set()); ouvintes.get(evt).add(fn); },
        off(evt, fn) { ouvintes.get(evt)?.delete(fn); },
        getMinZoom: () => 2, getMaxZoom: () => 21, setMinZoom() {}, setMaxZoom() {},
    };
}

/** Controles vivos do caso corrente: soltos no fim, senão o do caso anterior ouve o próximo. */
const vivos = [];

/** O controle com o ouvinte remoto montado, que é o que `setDependencies` faz na aplicação. */
function controleLigado(map) {
    const c = new BaseLayerControl(undefined, undefined);
    c.map = map;
    c.container = { querySelectorAll: () => [], querySelector: () => null, remove: () => {} };
    c.setDependencies({});
    vivos.push(c);
    return c;
}

afterEach(() => {
    while (vivos.length) vivos.pop().onRemove();
});

beforeEach(() => {
    chamadas.setBaseLayer.length = 0;
    chamadas.setupMapFeatures.length = 0;
    barramento.emitidos.length = 0;
    estado.mapaAtivo = 'mapa-1';
    estado.crenca = 'carta-topografica';
});

describe('mapa base trocado por um colega', () => {
    it('TROCA O ESTILO DO MAPA, e não só o cartão do seletor', async () => {
        const map = mapaFalso(cartaTopografica);
        const c = controleLigado(map);

        await barramento.disparar(EventTypes.BASE_LAYER_REMOTE_CHANGED, {
            layer: 'imagens', mapId: 'uuid-1', mapName: 'mapa-1',
        });

        expect(map._setStyles.length).toBeGreaterThan(0);
        expect(c.currentLayer).toBe('imagens');
        // E o anúncio que o seletor ouve sai DEPOIS da troca, lendo o que ficou na tela.
        const anunciados = barramento.emitidos.filter((e) => e.evento === EventTypes.BASE_LAYER_CHANGED);
        expect(anunciados.at(-1)?.payload).toEqual({ layer: 'imagens' });
    });

    it('NÃO PERSISTE e NÃO enfileira operação: o dado veio do par', async () => {
        // `setBaseLayer` grava no registro e enfileira a op; reescrevê-la aqui devolveria a
        // operação ao servidor em laço.
        const c = controleLigado(mapaFalso(cartaTopografica));

        await barramento.disparar(EventTypes.BASE_LAYER_REMOTE_CHANGED, {
            layer: 'imagens', mapId: 'uuid-1', mapName: 'mapa-1',
        });

        expect(chamadas.setBaseLayer).toEqual([]);
        expect(c.currentLayer).toBe('imagens');
    });

    it('NÃO troca a base quando a operação é de OUTRO mapa do atlas', async () => {
        // Sem este filtro, um colega editando outro mapa troca a base debaixo de quem está aqui.
        const map = mapaFalso(cartaTopografica);
        const c = controleLigado(map);

        await barramento.disparar(EventTypes.BASE_LAYER_REMOTE_CHANGED, {
            layer: 'imagens', mapId: 'uuid-2', mapName: 'outro-mapa',
        });

        expect(map._setStyles).toEqual([]);
        expect(c.currentLayer).toBe('carta-topografica');
    });

    it('não repinta quando a base que chegou já é a que está na tela', async () => {
        const map = mapaFalso(cartaTopografica);
        controleLigado(map);

        await barramento.disparar(EventTypes.BASE_LAYER_REMOTE_CHANGED, {
            layer: 'carta-topografica', mapId: 'uuid-1', mapName: 'mapa-1',
        });

        expect(map._setStyles).toEqual([]);
    });

    it('o ouvinte se solta no onRemove, e um controle removido não mexe mais no mapa', async () => {
        const map = mapaFalso(cartaTopografica);
        const c = controleLigado(map);
        const antes = barramento.contar(EventTypes.BASE_LAYER_REMOTE_CHANGED);
        c.onRemove();

        await barramento.disparar(EventTypes.BASE_LAYER_REMOTE_CHANGED, {
            layer: 'imagens', mapId: 'uuid-1', mapName: 'mapa-1',
        });

        expect(map._setStyles).toEqual([]);
        // O ouvinte SAIU do barramento: sem isto, um controle morto seguiria reagindo (a
        // discriminação é a contagem cair, e não ser zero, porque o barramento é do arquivo).
        expect(barramento.contar(EventTypes.BASE_LAYER_REMOTE_CHANGED)).toBe(antes - 1);
    });
});
