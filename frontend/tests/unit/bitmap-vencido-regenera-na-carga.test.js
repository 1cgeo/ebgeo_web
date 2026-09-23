// Path: tests/unit/bitmap-vencido-regenera-na-carga.test.js

// Restoring generated images validates content, not just the bitmap layout version.
// Real rendering/migration is covered separately in the browser suite.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------------------
// O ambiente mínimo que `loadSingleImage` usa. `Image` resolve SÍNCRONO (o código atribui
// `onload` antes de `src`), então nada aqui depende de temporizador; os falsos existem só
// para descartar o `setTimeout` de 10 s que a função agenda e que ninguém cancela.
// ---------------------------------------------------------------------------------------

class ImagemFalsa {
    set src(valor) {
        this._src = valor;
        if (this.onload) this.onload();
    }

    get src() {
        return this._src;
    }
}

const { registro, imagensPedidas } = vi.hoisted(() => ({
    registro: new Map(),
    imagensPedidas: [],
}));

vi.mock('../../src/js/layers/image-regen-registry.js', () => ({
    getImageRegenerator: (source) => registro.get(source) || null,
}));

const colecao = { value: {} };
const blobs = { value: new Set() };

vi.mock('../../src/js/store', () => ({
    getCurrentMapFeatures: async () => colecao.value,
    getImage: async (id) => {
        imagensPedidas.push(id);
        return blobs.value.has(id) ? { tipo: 'blob', id } : null;
    },
    hasImage: async (id) => blobs.value.has(id),
    getCurrentMapNameSync: () => 'mapa-1',
    getGridStyle: async () => null,
    getCatalogLayers: async () => [],
    getControl: () => null,
}));

vi.mock('../../src/js/layers/styles/index.js', () => {
    const mod = { setupLayerSeparators: () => {} };
    for (const nome of [
        'setupPointLayers', 'setupLineLayers', 'setupBrushLayers', 'setupPolygonLayers',
        'setupCircleLayers', 'setupRectangleLayers', 'setupEllipseLayers', 'setupSectorLayers',
        'setupTextLayers', 'setupImageLayers', 'setupArrowLayers', 'setupMilitarySymbolsLayers',
        'setupCoordinationMeasureLayers', 'setupDeclinationLayers', 'setupBoundaryLayers',
        'setupOccupiedFrontLayers', 'setupCoordinationLineLayers', 'setupLOSLayers',
        'setupVisibilityLayers', 'setupAuxiliaryLayers',
    ]) {
        mod[nome] = () => {};
    }
    return mod;
});

vi.mock('../../src/js/utilities/turf-loader.js', () => ({ ensureTurf: async () => ({}) }));
vi.mock('../../src/js/grid/index.js', () => ({ initGridLayers: () => {} }));
vi.mock('../../src/js/draw_tools/point_tool/point-marker-symbols.js', () => ({
    generatePointImage: async () => null,
    needsPerFeatureImage: () => false,
    pointImageSignature: () => '',
}));
vi.mock('../../src/js/draw_tools/point_tool/point-custom-icons.js', () => ({
    parseCustomMarker: () => null,
    registerCustomFeatureImage: async () => {},
}));
vi.mock('../../src/js/layers/visibility-filter.js', () => ({
    updateAllLayerFilters: () => {},
    invalidateFilterCache: () => {},
    updateMeasurementLabelVisibility: () => {},
}));
vi.mock('../../src/js/layers/layer-opacity-applier.js', () => ({
    applyLayerOpacities: () => {},
    invalidateOpacityCache: () => {},
}));
vi.mock('../../src/js/measurement_tool/measurement-labels.js', () => ({ setupMeasurementLayers: () => {} }));
vi.mock('../../src/js/config.js', () => ({ default: { features: { grid: false } } }));

const { setupMapFeatures } = await import('../../src/js/layers/layer_setup.js');
const { SYMBOL_BITMAP_VERSION, VERSIONED_BITMAP_SOURCES, needsBitmapRebuild } = await import('../../src/js/layers/bitmap-version.js');

// ---------------------------------------------------------------------------------------

/** Mapa falso com o que `setImages` e `setupMapFeatures` tocam. */
function mapaFalso() {
    const sources = new Map();
    const imagens = new Map();
    return {
        imagensAdicionadas: [],
        getSource: (id) => sources.get(id) || null,
        addSource: (id) => sources.set(id, { setData() {}, updateData() {} }),
        removeSource: (id) => sources.delete(id),
        hasImage: (id) => imagens.has(id),
        removeImage: (id) => imagens.delete(id),
        addImage(id, img, opts) {
            imagens.set(id, img);
            this.imagensAdicionadas.push({ id, opts });
        },
        on: () => {},
        off: () => {},
    };
}

const gerentes = { setupAnalysisLayers: async () => {}, setupDataLayers: async () => {} };
const barramento = { on: () => () => {}, emit: () => {} };

/**
 * @param {string} id
 * @param {string} source
 * @param {Object} extras - Propriedades extra (carimbo, tamanho)
 */
function feicao(id, source, extras = {}) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { id, source, ...extras },
    };
}

/** Regenerador espião registrado para um source. */
function espiao(source, impl = async () => {}) {
    const chamadas = [];
    registro.set(source, async (f) => {
        chamadas.push(f.properties.id);
        return impl(f);
    });
    return chamadas;
}

/** Roda o caminho de carga com uma coleção e devolve o mapa falso usado. */
async function carregar(colecaoDeFeicoes) {
    colecao.value = colecaoDeFeicoes;
    const map = mapaFalso();
    map.addSource('points', {});
    await setupMapFeatures(map, gerentes, gerentes, barramento);
    return map;
}

// Os globais são RESTAURADOS no fim, e não só sobrescritos: `URL.createObjectURL` e `Image`
// são do ambiente, e um arquivo que os deixa trocados contamina quem rodar depois dele no
// mesmo worker, com falha longe daqui.
const originais = {
    Image: globalThis.Image,
    createObjectURL: globalThis.URL.createObjectURL,
    revokeObjectURL: globalThis.URL.revokeObjectURL,
};

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', () => 1);
    globalThis.Image = ImagemFalsa;
    globalThis.URL.createObjectURL = () => 'blob:falso';
    globalThis.URL.revokeObjectURL = () => {};
    registro.clear();
    imagensPedidas.length = 0;
    blobs.value = new Set();
    colecao.value = {};
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    globalThis.Image = originais.Image;
    globalThis.URL.createObjectURL = originais.createObjectURL;
    globalThis.URL.revokeObjectURL = originais.revokeObjectURL;
});

describe('a lista de tipos versionados', () => {
    it('inclui os quatro tipos cujos geradores carimbam o recorte', () => {
        expect([...VERSIONED_BITMAP_SOURCES]).toEqual(['military_symbol', 'coordination_measure', 'engineering_symbol', 'magnetic_declination']);
        expect(needsBitmapRebuild('magnetic_declination', {})).toBe(true);
        expect(needsBitmapRebuild('military_symbol', {})).toBe(true);
        expect(needsBitmapRebuild('military_symbol', { bitmapVersion: SYMBOL_BITMAP_VERSION })).toBe(false);
    });
});

describe('setImages e o carimbo de layout do bitmap', () => {
    it('carimbo atual e blob no disco ainda exigem conferir as propriedades', async () => {
        const chamadas = espiao('military_symbol');
        blobs.value.add('sim-1');

        const map = await carregar({
            military_symbols: [feicao('sim-1', 'military_symbol', { bitmapVersion: SYMBOL_BITMAP_VERSION })],
        });

        expect(chamadas).toEqual(['sim-1']);
        expect(imagensPedidas).toEqual([]);
        expect(map.imagensAdicionadas).toEqual([]);
    });

    it('SEM carimbo (bitmap v1) e blob no disco: REGENERA — este é o caso novo', async () => {
        const chamadas = espiao('military_symbol');
        blobs.value.add('sim-1');

        await carregar({ military_symbols: [feicao('sim-1', 'military_symbol')] });

        expect(chamadas).toEqual(['sim-1']);
        // E não gastou uma leitura de blob para descobrir isso: a pergunta é síncrona.
        expect(imagensPedidas).toEqual([]);
    });

    it('carimbo de versão ANTERIOR e blob no disco: regenera', async () => {
        const chamadas = espiao('military_symbol');
        blobs.value.add('sim-1');

        await carregar({
            military_symbols: [feicao('sim-1', 'military_symbol', { bitmapVersion: SYMBOL_BITMAP_VERSION - 1 })],
        });

        expect(chamadas).toEqual(['sim-1']);
    });

    it('a medida de coordenação segue a mesma regra', async () => {
        const chamadas = espiao('coordination_measure');
        blobs.value.add('med-1');

        await carregar({
            coordination_measures: [feicao('med-1', 'coordination_measure')],
        });

        expect(chamadas).toEqual(['med-1']);
    });

    it('SEM blob no disco: regenera, com carimbo atual — o comportamento antigo fica de pé', async () => {
        const chamadas = espiao('military_symbol');

        await carregar({
            military_symbols: [feicao('sim-1', 'military_symbol', { bitmapVersion: SYMBOL_BITMAP_VERSION })],
        });

        expect(chamadas).toEqual(['sim-1']);
    });

    it('declinação também regenera para conferir os ângulos, mesmo com blob', async () => {
        const chamadas = espiao('magnetic_declination');
        blobs.value.add('dec-1');

        await carregar({
            magnetic_declinations: [feicao('dec-1', 'magnetic_declination')],
        });

        expect(chamadas).toEqual(['dec-1']);
        expect(imagensPedidas).toEqual([]);
    });

    it('a declinação SEM blob continua regenerando, que é o caminho que ela sempre teve', async () => {
        const chamadas = espiao('magnetic_declination');

        await carregar({ magnetic_declinations: [feicao('dec-1', 'magnetic_declination')] });

        expect(chamadas).toEqual(['dec-1']);
    });

    it('feição de imagem (sem regenerador) não passa pelo ramo, mesmo sem carimbo', async () => {
        blobs.value.add('img-1');

        const map = await carregar({ images: [feicao('img-1', 'image')] });

        expect(imagensPedidas).toEqual(['img-1']);
        expect(map.imagensAdicionadas.map((i) => i.id)).toEqual(['img-1']);
    });

    it('regenerador que lança COM blob antigo no disco: carrega o bitmap antigo, não o ícone de erro', async () => {
        // Um bitmap v1 que não pôde ser refeito continua sendo um bitmap do símbolo: o
        // layout velho vence o ícone de erro, e a próxima carga tenta de novo.
        espiao('military_symbol', async () => { throw new Error('milsymbol fora'); });
        blobs.value.add('sim-1');
        const espiaoDeConsole = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const map = await carregar({ military_symbols: [feicao('sim-1', 'military_symbol')] });

        expect(map.hasImage('sim-1')).toBe(true);
        expect(imagensPedidas).toEqual(['sim-1']);
        espiaoDeConsole.mockRestore();
    });

    it('regenerador que lança SEM blob no disco: instala a imagem de ERRO, e a carga não aborta', async () => {
        espiao('military_symbol', async () => { throw new Error('milsymbol fora'); });
        const espiaoDeConsole = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const map = await carregar({ military_symbols: [feicao('sim-1', 'military_symbol')] });

        expect(map.hasImage('sim-1')).toBe(true);
        expect(imagensPedidas).toEqual([]);
        espiaoDeConsole.mockRestore();
    });

    it('imagem registrada sem assinatura de conteúdo precisa ser conferida', async () => {
        const chamadas = espiao('military_symbol');
        blobs.value.add('sim-1');
        colecao.value = { military_symbols: [feicao('sim-1', 'military_symbol')] };

        const map = mapaFalso();
        map.addSource('points', {});
        map.addImage('sim-1', {});
        await setupMapFeatures(map, gerentes, gerentes, barramento);

        expect(chamadas).toEqual(['sim-1']);
        expect(imagensPedidas).toEqual([]);
    });
});


it('retries a failed photo on the same map and replaces its placeholder', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const map = await carregar({ images: [feicao('photo', 'image')] });
    expect(map.imagensAdicionadas).toHaveLength(1);
    blobs.value.add('photo');
    await setupMapFeatures(map, gerentes, gerentes, barramento);
    expect(map.imagensAdicionadas).toHaveLength(2);
    expect(imagensPedidas).toEqual(['photo', 'photo']);
    warn.mockRestore();
});

it('rebuilds a cached bitmap after properties change but reuses unchanged pixels', async () => {
    colecao.value = { military_symbols: [feicao('symbol', 'military_symbol', { bitmapVersion: 2, uniqueDesignation: 'A' })] };
    const map = mapaFalso();
    map.addSource('points', {});
    const calls = espiao('military_symbol', async f => { map.addImage(f.properties.id, {}); return { blob: {} }; });
    await setupMapFeatures(map, gerentes, gerentes, barramento);
    await setupMapFeatures(map, gerentes, gerentes, barramento);
    expect(calls).toHaveLength(1);
    colecao.value.military_symbols[0].properties.uniqueDesignation = 'B';
    await setupMapFeatures(map, gerentes, gerentes, barramento);
    expect(calls).toHaveLength(2);
});
