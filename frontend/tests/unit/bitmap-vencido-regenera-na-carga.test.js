// Path: tests/unit/bitmap-vencido-regenera-na-carga.test.js

/**
 * @fileoverview O BLOB ESTAR NO DISCO DEIXOU DE SER PROVA DE QUE ELE SERVE.
 *
 * O PNG de símbolo militar e de medida de coordenação é cache por cliente: nunca sobe ao
 * servidor, e todo cliente o reconstrói das propriedades sincronizadas
 * (`layers/image-regen-registry.js`). `setImages` (`layers/layer_setup.js`) regenerava
 * quando o blob LOCAL faltava, e só então. A troca de layout do bitmap (v1 centrado num
 * quadrado, com faixas transparentes; v2 recortado no desenho, com `iconOffset`) criou o
 * segundo caso, que aquela condição não vê: o blob está lá, e está velho. Como a caixa de
 * seleção e o hit-test do clique SÃO o retângulo do bitmap, a feição antiga responde ao
 * clique numa área maior que a que se enxerga, sem erro em lugar nenhum.
 *
 * A pergunta passou a ser `needsBitmapRebuild` (`layers/bitmap-version.js`), e o caso que a
 * torna não trivial é o da DECLINAÇÃO MAGNÉTICA: ela também desenha PNG gerado no cliente e
 * também tem regenerador, mas o gerador dela devolve blob pelado e não carimba nada. Ler
 * "sem carimbo" como "vencido" sem a lista de tipos versionados regeneraria toda declinação
 * em toda carga, para sempre. Os dois casos da declinação são o que separa a regra certa da parecida.
 *
 * O QUE ELE NÃO ALCANÇA: que o MapLibre desenhe. O mapa é falso, e a asserção é sobre QUEM
 * foi chamado (regenerador ou leitura de disco), nunca sobre pixel.
 */

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
    globalThis.Image = originais.Image;
    globalThis.URL.createObjectURL = originais.createObjectURL;
    globalThis.URL.revokeObjectURL = originais.revokeObjectURL;
});

describe('a lista de tipos versionados', () => {
    it('são exatamente os DOIS que o gerador carimba, e a declinação não está nela', () => {
        expect([...VERSIONED_BITMAP_SOURCES]).toEqual(['military_symbol', 'coordination_measure']);
        expect(needsBitmapRebuild('magnetic_declination', {})).toBe(false);
        expect(needsBitmapRebuild('military_symbol', {})).toBe(true);
        expect(needsBitmapRebuild('military_symbol', { bitmapVersion: SYMBOL_BITMAP_VERSION })).toBe(false);
    });
});

describe('setImages e o carimbo de layout do bitmap', () => {
    it('carimbo ATUAL e blob no disco: não regenera, carrega o que está lá', async () => {
        const chamadas = espiao('military_symbol');
        blobs.value.add('sim-1');

        const map = await carregar({
            military_symbols: [feicao('sim-1', 'military_symbol', { bitmapVersion: SYMBOL_BITMAP_VERSION })],
        });

        expect(chamadas).toEqual([]);
        expect(imagensPedidas).toEqual(['sim-1']);
        expect(map.imagensAdicionadas.map((i) => i.id)).toEqual(['sim-1']);
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

    it('A DECLINAÇÃO NÃO É VERSIONADA: sem carimbo e com blob, ela carrega do disco', async () => {
        // O caso que separa a regra certa da parecida. O gerador da declinação devolve blob
        // pelado e nunca carimba, então "sem carimbo" é o estado NORMAL dela: tratá-lo como
        // vencido regeneraria toda declinação em toda carga, para sempre.
        const chamadas = espiao('magnetic_declination');
        blobs.value.add('dec-1');

        await carregar({
            magnetic_declinations: [feicao('dec-1', 'magnetic_declination')],
        });

        expect(chamadas).toEqual([]);
        expect(imagensPedidas).toEqual(['dec-1']);
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

    it('imagem JÁ REGISTRADA no mapa não chega nem à pergunta do carimbo', async () => {
        const chamadas = espiao('military_symbol');
        blobs.value.add('sim-1');
        colecao.value = { military_symbols: [feicao('sim-1', 'military_symbol')] };

        const map = mapaFalso();
        map.addSource('points', {});
        map.addImage('sim-1', {});
        await setupMapFeatures(map, gerentes, gerentes, barramento);

        expect(chamadas).toEqual([]);
        expect(imagensPedidas).toEqual([]);
    });
});
