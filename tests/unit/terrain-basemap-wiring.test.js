// Path: tests/unit/terrain-basemap-wiring.test.js

/**
 * @fileoverview A FIACAO da base preferida, acionada pelo mesmo metodo que o botao
 * do terreno aciona.
 *
 * O arquivo vizinho (terrain-basemap-model.test.js) prende a decisao. Este prende o
 * que o controle FAZ com ela, que e a metade que uma decisao correta nao garante:
 * uma funcao pura impecavel ligada a nada da um mapa que nunca troca de base e uma
 * suite verde.
 *
 * As tres propriedades que so se veem aqui:
 *   - com a chave NULA o controle de camada base nao e sequer procurado (o padrao do
 *     repositorio tem de continuar byte a byte o que era);
 *   - a troca sai por `applySharedBasemap`, o caminho que NAO grava a escolha no
 *     registro do mapa, e nunca por `switchLayer` ou `setBaseLayer`;
 *   - a troca que a propria fiacao provoca nao pode ser lida como o usuario mudando
 *     de ideia, senao o desligar nunca restaura.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const getEventBus = vi.fn();
const getControl = vi.fn();

vi.mock('../../src/js/store', () => ({
    getEventBus: (...a) => getEventBus(...a),
    getControl: (...a) => getControl(...a),
}));
vi.mock('../../src/js/store/catalog.operations.js', () => ({
    getCatalogLayers: async () => [],
    toggleCatalogLayerVisibility: async () => {},
}));
vi.mock('../../src/js/store/atlas/atlas.entity.js', () => ({ DEFAULT_TERRAIN_EXAGGERATION: 1.5 }));

const TerrainControl = (await import('../../src/js/terrain/terrain.control.js')).default;
const { EventTypes } = await import('../../src/js/events/event_types.js');

/** Barramento de eventos sincrono, para o handler rodar dentro do await da troca. */
function criarBarramento() {
    const inscritos = new Map();
    return {
        on(evento, fn) {
            if (!inscritos.has(evento)) inscritos.set(evento, new Set());
            inscritos.get(evento).add(fn);
            return () => inscritos.get(evento).delete(fn);
        },
        emit(evento, payload) {
            for (const fn of inscritos.get(evento) ?? []) fn(payload);
        },
    };
}

/** Mapa dublê: guarda o terreno aplicado e a posicao da camera. */
function criarMapa(centro = { lng: -52.4, lat: -28.3 }) {
    let terreno = null;
    return {
        chamadas: [],
        getTerrain: () => terreno,
        setTerrain: (t) => { terreno = t; },
        getCenter: () => centro,
        getProjection: () => ({ type: 'mercator' }),
        easeTo: () => {},
        getSource: () => ({}),
        addSource: () => {},
        getLayer: () => undefined,
        setLayoutProperty: () => {},
    };
}

/**
 * Controle de camada base dublê. Alem de `applySharedBasemap` (o caminho sem
 * persistencia), expoe os dois caminhos QUE PERSISTEM, para o teste poder provar
 * que nenhum deles foi tocado.
 */
function criarControleBase(bus, inicial = 'carta-topografica') {
    const controle = {
        currentLayer: inicial,
        styleUrls: { 'carta-topografica': {}, 'carta-ortoimagem': {}, 'bdgex': {} },
        applySharedBasemap: vi.fn(async (id) => {
            controle.currentLayer = id;
            // O de verdade anuncia a base aplicada ao fim, e e esse anuncio que a
            // fiacao nao pode confundir com uma troca do usuario.
            bus.emit(EventTypes.BASE_LAYER_CHANGED, { layer: id });
            return id;
        }),
        switchLayer: vi.fn(async () => {}),
        executeLayerChange: vi.fn(async () => {}),
    };
    return controle;
}

/** Config do `map2d` reduzida ao que o TerrainControl le. */
function criarConfig(extra = {}) {
    return {
        terrainSource: { type: 'raster-dem', url: 'https://exemplo/tiles.json' },
        hillshadeSource: { type: 'raster-dem', url: 'https://exemplo/tiles.json' },
        hillshade: { enabled: false },
        globe_projection: false,
        ...extra,
    };
}

/** Monta o conjunto ja com `onAdd` feito, que e o que registra o ouvinte. */
function montar(extraConfig = {}, { centro, baseInicial } = {}) {
    const bus = criarBarramento();
    getEventBus.mockImplementation(() => bus);
    const base = criarControleBase(bus, baseInicial ?? 'carta-topografica');
    getControl.mockImplementation((nome) => (nome === 'BaseLayerControl' ? base : null));

    const controle = new TerrainControl(criarConfig(extraConfig));
    const mapa = criarMapa(centro);
    controle.onAdd(mapa);
    return { controle, mapa, base, bus };
}

// O ambiente do vitest e `node`. `onAdd` cria um div escondido (a UI do terreno
// mora no BottomControlsControl), e sem este minimo o controle nem chega a
// registrar o ouvinte que este arquivo mede.
const documentoOriginal = globalThis.document;

beforeEach(() => {
    globalThis.document = { createElement: () => ({ style: {}, parentNode: null }) };
    getEventBus.mockReset();
    getControl.mockReset();
});

afterAll(() => {
    globalThis.document = documentoOriginal;
});

// ============================================================================
// O padrao do repositorio: chave nula
// ============================================================================

describe('com a chave de base preferida nula (o padrao)', () => {
    it('nao procura o controle de camada base ao ligar nem ao desligar', async () => {
        const { controle, base } = montar();

        await controle._toggleTerrain();
        await controle._toggleTerrain();

        expect(getControl).not.toHaveBeenCalled();
        expect(base.applySharedBasemap).not.toHaveBeenCalled();
        expect(base.switchLayer).not.toHaveBeenCalled();
        expect(base.executeLayerChange).not.toHaveBeenCalled();
        expect(base.currentLayer).toBe('carta-topografica');
    });

    it('continua ligando e desligando o terreno', async () => {
        const { controle, mapa } = montar();

        await controle._toggleTerrain();
        expect(mapa.getTerrain()).toEqual({ source: 'terrainSource', exaggeration: 1.5 });

        await controle._toggleTerrain();
        expect(mapa.getTerrain()).toBe(null);
    });
});

// ============================================================================
// A chave apontando uma base do STYLE_MAP
// ============================================================================

describe('com a chave apontando carta-ortoimagem', () => {
    it('troca ao ligar, pelo caminho que nao persiste, e restaura ao desligar', async () => {
        const { controle, base } = montar({ terrainPreferredBasemap: 'carta-ortoimagem' });

        await controle._toggleTerrain();
        expect(base.applySharedBasemap).toHaveBeenCalledTimes(1);
        expect(base.applySharedBasemap).toHaveBeenCalledWith('carta-ortoimagem');
        expect(base.currentLayer).toBe('carta-ortoimagem');

        await controle._toggleTerrain();
        expect(base.applySharedBasemap).toHaveBeenCalledTimes(2);
        expect(base.applySharedBasemap).toHaveBeenLastCalledWith('carta-topografica');
        expect(base.currentLayer).toBe('carta-topografica');

        // Nenhum dos dois caminhos que gravam a escolha no registro do mapa.
        expect(base.switchLayer).not.toHaveBeenCalled();
        expect(base.executeLayerChange).not.toHaveBeenCalled();
    });

    it('ligar duas vezes seguidas nao troca duas vezes', async () => {
        const { controle, base } = montar({ terrainPreferredBasemap: 'carta-ortoimagem' });

        await controle._toggleTerrain();
        // O terreno ja esta ligado; o segundo toque do botao desliga. Simula o
        // caminho em que a fiacao e chamada de novo com o terreno ja ligado.
        await controle._syncBasemapWithTerrain(true);

        expect(base.applySharedBasemap).toHaveBeenCalledTimes(1);
    });

    it('nao desfaz a base que o usuario escolheu com o terreno ligado', async () => {
        const { controle, base, bus } = montar({ terrainPreferredBasemap: 'carta-ortoimagem' });

        await controle._toggleTerrain();
        expect(base.currentLayer).toBe('carta-ortoimagem');

        // O usuario troca no seletor: o controle de base anuncia a mudanca.
        base.currentLayer = 'bdgex';
        bus.emit(EventTypes.BASE_LAYER_CHANGED, { layer: 'bdgex' });

        await controle._toggleTerrain();
        expect(base.applySharedBasemap).toHaveBeenCalledTimes(1);
        expect(base.currentLayer).toBe('bdgex');
    });

    it('nao troca com o centro da vista fora do recorte da base preferida', async () => {
        const { controle, base } = montar(
            {
                terrainPreferredBasemap: 'carta-ortoimagem',
                terrainPreferredBasemapBounds: [-58.1, -33.4, -48.7, -27.1],
            },
            { centro: { lng: -43.2, lat: -22.9 } },
        );

        await controle._toggleTerrain();
        await controle._toggleTerrain();

        expect(base.applySharedBasemap).not.toHaveBeenCalled();
        expect(base.currentLayer).toBe('carta-topografica');
    });

    it('troca com o centro da vista dentro do recorte', async () => {
        const { controle, base } = montar(
            {
                terrainPreferredBasemap: 'carta-ortoimagem',
                terrainPreferredBasemapBounds: [-58.1, -33.4, -48.7, -27.1],
            },
            { centro: { lng: -52.4, lat: -28.3 } },
        );

        await controle._toggleTerrain();
        expect(base.applySharedBasemap).toHaveBeenCalledWith('carta-ortoimagem');
    });

    it('nao mexe na base quando o mapa ja esta na preferida', async () => {
        const { controle, base } = montar(
            { terrainPreferredBasemap: 'carta-ortoimagem' },
            { baseInicial: 'carta-ortoimagem' },
        );

        await controle._toggleTerrain();
        await controle._toggleTerrain();

        expect(base.applySharedBasemap).not.toHaveBeenCalled();
        expect(base.currentLayer).toBe('carta-ortoimagem');
    });

    it('nao troca para uma base que o controle nao tem estilo registrado', async () => {
        const { controle, base } = montar({ terrainPreferredBasemap: 'topografica-raster' });

        await controle._toggleTerrain();

        expect(base.applySharedBasemap).not.toHaveBeenCalled();
    });

    it('esquece a lembranca quando a troca falha, para nao restaurar o que nao mudou', async () => {
        const { controle, base } = montar({ terrainPreferredBasemap: 'carta-ortoimagem' });
        base.applySharedBasemap.mockRejectedValueOnce(new Error('estilo indisponivel'));

        await controle._toggleTerrain();
        expect(base.currentLayer).toBe('carta-topografica');

        await controle._toggleTerrain();
        expect(base.applySharedBasemap).toHaveBeenCalledTimes(1);
    });
});
