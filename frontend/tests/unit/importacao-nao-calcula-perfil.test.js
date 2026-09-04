// Path: tests/unit/importacao-nao-calcula-perfil.test.js

/**
 * @fileoverview A importação calculava o PERFIL DE ELEVAÇÃO de toda linha, e ninguém podia
 * lê-lo.
 *
 * O DEFEITO. `prepareFeatureForImportAsync` (`frontend/src/js/import_export/import.control.js`)
 * chamava `calculateProfile` para cada feição de linha, sem condição nenhuma, enquanto as
 * propriedades padrão do controle de linha nascem `profile: false`. O painel só desenha quando
 * `profileData` E `profile` estão presentes (`ProfilePanelManager.showProfilePanel`), e o único
 * gesto que liga `profile` (`line_attributes_panel.js`) passa por
 * `AddLineControl.updateFeaturesProperty`, que RECALCULA o perfil naquele instante a partir de
 * `baseCoordinates`. Ou seja, o perfil da importação era descartado antes de ser exibido, uma
 * vez por linha.
 *
 * O CUSTO, medido num arquivo sintético de 2000 linhas de 5 vértices: 52 mil `turf.along`, 104
 * mil consultas de terreno e 3,2 MB de JSON gravado no IndexedDB e empurrado pelo sync. O laço
 * de preparação caiu de 110 ms para 68 ms (mediana de 7 rodadas em série) com um duplo de
 * terreno praticamente grátis; no navegador a consulta de terreno é uma leitura de DEM, então o
 * ganho real é maior que este.
 *
 * O QUE ESTE ARQUIVO PRENDE, e o que ele deliberadamente NÃO prende. Ele prende o predicado puro
 * e o produto da preparação (a feição importada nasce sem `profileData`), com controle positivo:
 * um controle de linha cujos padrões trouxessem `profile: true` volta a calcular, o que é o que
 * impede este teste de passar com uma importação que simplesmente nunca calcula nada. O caminho
 * SOB DEMANDA (ligar o interruptor e o perfil aparecer) é de outro arquivo,
 * `tests/integration/perfil-sob-demanda-ao-ligar.test.js`, porque ele precisa do controle de
 * linha inteiro e de outros duplos.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `globalThis.turf` com os TRÊS métodos que `calculateProfile` usa, e só eles, como manda
// `.claude/rules/testing.md`. A geometria é equirretangular: o controle positivo afirma a FORMA
// do perfil (contagem, primeira distância, elevações finitas), não a precisão geodésica, que é
// assunto do Turf e não deste arquivo.
const turfStub = {
    lineString: (coordinates) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates } }),
    length: (line) => {
        const c = line.geometry.coordinates;
        let total = 0;
        for (let i = 1; i < c.length; i++) total += metros(c[i - 1], c[i]);
        return total;
    },
    along: (line, distancia) => {
        const c = line.geometry.coordinates;
        let restante = distancia;
        for (let i = 1; i < c.length; i++) {
            const trecho = metros(c[i - 1], c[i]);
            if (restante <= trecho || i === c.length - 1) {
                const t = trecho === 0 ? 0 : Math.min(1, restante / trecho);
                return {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [
                            c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t,
                            c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t,
                        ],
                    },
                };
            }
            restante -= trecho;
        }
        return { type: 'Feature', geometry: { type: 'Point', coordinates: c.at(-1) } };
    },
};

/** Equirectangular distance in metres between two [lng, lat] pairs. */
function metros([lng1, lat1], [lng2, lat2]) {
    const R = 6371008.8;
    const x = ((lng2 - lng1) * Math.PI / 180) * Math.cos((lat1 + lat2) * Math.PI / 360);
    const y = (lat2 - lat1) * Math.PI / 180;
    return Math.sqrt(x * x + y * y) * R;
}

vi.mock('@store', () => ({
    addFeatures: vi.fn(async () => {}),
    createLayerForImport: vi.fn(async () => ({ id: 'layer-1', name: 'importado' })),
    getLayers: vi.fn(async () => []),
    getCurrentMapNameSync: vi.fn(() => 'Principal'),
    getEventBus: vi.fn(() => ({ emit: vi.fn() })),
}));
// O perfil le o terreno pelo AMOSTRADOR (createTerrainSampler), construido uma vez por
// calculo, com `elevation` sincrona. O duplo mantem o mesmo terreno deterministico.
vi.mock('@js/terrain', () => ({
    createTerrainSampler: vi.fn(() => ({
        elevation: ([lng, lat]) => (lng * 37 + lat * 91) % 500,
        fast: true,
        zoom: 12,
    })),
}));
vi.mock('@js/user_data', () => ({
    userDataManager: {
        extractAttributesFromImport: vi.fn(() => ({ attributes: {}, descricao: '' })),
    },
}));
vi.mock('@utils/toast_service.js', () => ({
    showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(), showToast: vi.fn(),
}));

const { default: AddImportControl, shouldComputeProfileOnImport } =
    await import('../../src/js/import_export/import.control.js');

/** Os padrões reais de `AddLineControl.DEFAULT_PROPERTIES`, na parte que decide o perfil. */
function fakeLineControl(profile) {
    return class {
        static DEFAULT_PROPERTIES = {
            lineColor: '#3f4fb5', lineWidth: 5, opacity: 0.7, lineStyle: 'solid',
            measure: false, profile, profileData: null, source: 'line',
            nome: '', descricao: '', visivel: true, bloqueado: false, observations: [],
        };
    };
}

function makeMap() {
    return {
        getZoom: () => 12,
        getSource: () => null,
        getTerrain: () => ({ exaggeration: 1.5 }),
        queryTerrainElevation: async () => 100,
        fitBounds: () => {},
    };
}

const LINHA = {
    type: 'Feature',
    properties: { nome: 'trilha' },
    geometry: {
        type: 'LineString',
        coordinates: [[-47.9, -15.8], [-47.89, -15.79], [-47.88, -15.81]],
    },
};

/**
 * Prepares one imported line with a line control whose defaults carry `profile`.
 * @param {boolean} profile
 * @returns {Promise<{prepared: Object, perfis: number}>}
 */
async function prepararLinha(profile) {
    const control = new AddImportControl({ deactivateCurrentTool: vi.fn() });
    // INSTÂNCIAS, não classes: `getDefaultProperties` lê `this.lineControl.constructor`, e uma
    // classe passada direto resolve para `Function`, cujo `DEFAULT_PROPERTIES` é undefined. O
    // resultado seria um bloco de propriedades vazio, que passa em qualquer asserção frouxa.
    const Ponto = class { static DEFAULT_PROPERTIES = { size: 10, labelSize: 12 }; };
    const Poligono = class { static DEFAULT_PROPERTIES = { labelSize: 12 }; };
    const Linha = fakeLineControl(profile);
    control.setControls(new Ponto(), new Linha(), new Poligono());
    control.setMap(makeMap());

    let perfis = 0;
    const real = control.calculateProfile.bind(control);
    control.calculateProfile = async (...args) => { perfis++; return real(...args); };

    const prepared = await control.prepareFeatureForImportAsync(
        LINHA, 'lines', { points: 1, lines: 1, polygons: 1 }, 'layer-1'
    );
    return { prepared, perfis };
}

let documentoAnterior;

beforeEach(() => {
    documentoAnterior = globalThis.document;
    globalThis.document = {
        body: { appendChild: () => {} },
        createElement: () => ({ style: {}, appendChild: () => {}, remove: () => {} }),
    };
    globalThis.turf = turfStub;
});

afterEach(() => {
    globalThis.document = documentoAnterior;
    delete globalThis.turf;
});

describe('shouldComputeProfileOnImport', () => {
    it('só o booleano `true` liga o cálculo', () => {
        expect(shouldComputeProfileOnImport({ profile: true })).toBe(true);
    });

    it.each([
        ['profile: false', { profile: false }],
        ['profile ausente', { lineColor: '#000' }],
        ['objeto vazio', {}],
        ['null', null],
        ['undefined', undefined],
    ])('nega %s', (_rotulo, entrada) => {
        expect(shouldComputeProfileOnImport(entrada)).toBe(false);
    });

    it.each([
        ['a string "true"', { profile: 'true' }],
        ['o número 1', { profile: 1 }],
        ['um objeto', { profile: {} }],
    ])('nega %s: o gate do painel compara com `true`, não com verdadeiro', (_rotulo, entrada) => {
        expect(shouldComputeProfileOnImport(entrada)).toBe(false);
    });
});

describe('prepareFeatureForImportAsync — a linha importada nasce sem perfil', () => {
    it('com os padrões de hoje (profile: false) não calcula nada e não grava profileData', async () => {
        const { prepared, perfis } = await prepararLinha(false);

        expect(perfis).toBe(0);
        expect(prepared.properties.profile).toBe(false);
        // `profileData` continua sendo o `null` dos padrões: ausência e null são o mesmo para
        // `showProfilePanel`, que exige o valor VERDADEIRO das duas chaves.
        expect(prepared.properties.profileData ?? null).toBeNull();
        // O que a linha PRECISA carregar para o cálculo sob demanda existir depois.
        expect(prepared.properties.baseCoordinates).toEqual(LINHA.geometry.coordinates);
    });

    it('CONTROLE POSITIVO: com padrões `profile: true` volta a calcular um perfil de verdade', async () => {
        const { prepared, perfis } = await prepararLinha(true);

        expect(perfis).toBe(1);
        expect(typeof prepared.properties.profileData).toBe('string');
        const perfil = JSON.parse(prepared.properties.profileData);
        expect(perfil).toHaveLength(26);
        expect(perfil[0].distance).toBe(0);
        expect(perfil.every(p => Number.isFinite(p.elevation))).toBe(true);
    });
});
