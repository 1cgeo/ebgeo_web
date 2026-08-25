// Path: tests/unit/import-control-decomposicao.test.js

/**
 * @fileoverview Pins the PURE decision layer of `AddImportControl`
 * (`src/js/import_export/import.control.js`): `decomposeMultiGeometry`,
 * `getTargetType`, `generateImportName`, `getTypeCountersFromMapContext` and
 * `_getUniqueLayerName`. These are the four steps that decide HOW MANY features an
 * imported file becomes, WHICH bucket each one lands in, and WHAT it is named.
 *
 * WHAT IT PINS
 * - `decomposeMultiGeometry`: the Multi* fan-out, the GeometryCollection walk (including
 *   the null-member skip that used to abort an import), nested recursion, and the fact
 *   that properties are SHALLOW-copied (nested objects stay shared).
 * - `getTargetType`: the case-insensitive substring match and the order of the three
 *   branches, plus every GeoJSON type name in both cases.
 * - `generateImportName`: the counter mutation contract (the caller's object is advanced).
 * - `getTypeCountersFromMapContext`: the "continue where the map left off" regex, the
 *   per-source try/catch, and the `Math.max(...)` spread that silently loses the count on
 *   a very large map.
 * - `_getUniqueLayerName`: the `_2`, `_3` suffix ladder and the gap-filling behaviour.
 *
 * HOW IT LOADS THE MODULE
 * The control imports JSZip, shpjs, togeojson, the `@store` barrel, terrain, toasts, the
 * GeoJSON dispatcher and user data. All of them are mocked: none is exercised by the five
 * symbols above, and mocking keeps the file loadable under `environment: 'node'`. The
 * class is constructed directly (`new AddImportControl(stub)`), so no `prototype.call`
 * trick is needed.
 *
 * WHAT IT DOES NOT REACH
 * - Everything DOM/MapLibre: `onAdd`, the progress overlay, `zoomToFeatures`,
 *   `updateMapSources`, the FileReader paths (`_readFileWithProgress`, `readKML`,
 *   `readKMZ`, `readGPX`, `readShapefile`).
 * - `prepareFeatureForImportAsync` and `importGeoJSON` end-to-end (they need the store
 *   writes and the drawing-tool DEFAULT_PROPERTIES); only the naming/counting helpers
 *   they call are pinned here.
 * - `calculateProfile` (needs the terrain service and the turf global).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('jszip', () => ({ default: class {} }));
vi.mock('@tmcw/togeojson', () => ({ kml: vi.fn(), gpx: vi.fn() }));
vi.mock('shpjs', () => ({ default: vi.fn() }));
vi.mock('@store', () => ({
    addFeatures: vi.fn(async () => {}),
    createLayerForImport: vi.fn(async (name) => ({ id: 'layer-1', name })),
    getLayers: vi.fn(async () => []),
    getCurrentMapNameSync: vi.fn(() => 'Principal'),
    getEventBus: vi.fn(() => ({ emit: vi.fn() })),
}));
vi.mock('@utils/id_utils.js', () => ({
    IDUtils: { generateFeatureIds: () => ({ id: 'fid', geoJsonId: 1 }) },
}));
vi.mock('@utils/toast_service.js', () => ({ showSuccess: vi.fn(), showError: vi.fn() }));
vi.mock('@js/terrain', () => ({ getTerrainElevation: vi.fn(async () => 0) }));
vi.mock('@events', () => ({ EventTypes: { LAYERS_CHANGED: 'layers:changed' } }));
vi.mock('@layers/geojson-dispatcher.js', () => ({ getGeoJsonDispatcher: vi.fn(() => ({ add: vi.fn() })) }));
vi.mock('@js/user_data', () => ({
    userDataManager: { extractAttributesFromImport: () => ({ attributes: {}, descricao: '' }) },
}));
vi.mock('@js/temporal/temporal-import.js', () => ({
    extractTemporalProperties: () => ({}),
    buildTrajectoryFromGpxFeature: () => [],
    extractGpxTimes: () => [],
    sanitizeImportedTrajectory: () => [],
}));

import AddImportControl from '../../src/js/import_export/import.control.js';
import { getLayers } from '@store';

/**
 * @param {object} [map] optional MapLibre stub
 * @returns {AddImportControl}
 */
function makeControl(map) {
    const control = new AddImportControl({ setActiveTool: vi.fn(), deactivateCurrentTool: vi.fn() });
    if (map) control.setMap(map);
    return control;
}

/**
 * Builds a MapLibre-ish source stub whose `getData()` resolves to the given features.
 * @param {Record<string, Array<object>|Error>} byType
 * @returns {{getSource: Function}}
 */
function makeMapWithSources(byType) {
    return {
        getSource: (name) => {
            if (!(name in byType)) return null;
            const value = byType[name];
            return {
                getData: async () => {
                    if (value instanceof Error) throw value;
                    return { features: value };
                },
            };
        },
    };
}

let warnSpy;
beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warnSpy.mockRestore(); });

describe('decomposeMultiGeometry', () => {
    it('geometria simples volta como o MESMO objeto, sem copia', () => {
        const c = makeControl();
        const feature = {
            type: 'Feature',
            properties: { nome: 'A' },
            geometry: { type: 'Point', coordinates: [1, 2] },
        };

        const out = c.decomposeMultiGeometry(feature);
        expect(out).toHaveLength(1);
        expect(out[0]).toBe(feature);
    });

    it('os tres Multi* viram N feicoes singulares, com o tipo sem o prefixo', () => {
        const c = makeControl();

        const casos = [
            {
                geometry: { type: 'MultiPoint', coordinates: [[0, 0], [1, 1], [2, 2]] },
                esperado: 'Point',
                n: 3,
            },
            {
                geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] },
                esperado: 'LineString',
                n: 2,
            },
            {
                geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] },
                esperado: 'Polygon',
                n: 1,
            },
        ];
        expect(casos).toHaveLength(3);

        for (const { geometry, esperado, n } of casos) {
            const out = c.decomposeMultiGeometry({ type: 'Feature', properties: { nome: 'X' }, geometry });
            expect(out).toHaveLength(n);
            expect(out.map((f) => f.geometry.type)).toEqual(new Array(n).fill(esperado));
            expect(out.map((f) => f.type)).toEqual(new Array(n).fill('Feature'));
            // Each part carries the coordinate element at its own index.
            out.forEach((f, i) => expect(f.geometry.coordinates).toEqual(geometry.coordinates[i]));
        }
    });

    it('EDGE: Multi* com coordinates VAZIO produz ZERO feicoes (o dado desaparece sem erro)', () => {
        const c = makeControl();
        const out = c.decomposeMultiGeometry({
            type: 'Feature',
            properties: { nome: 'vazio' },
            geometry: { type: 'MultiPoint', coordinates: [] },
        });
        expect(out).toEqual([]);
    });

    it('as propriedades sao copiadas por SPREAD: o nivel 1 fica isolado, o aninhado NAO', () => {
        const c = makeControl();
        const original = { nome: 'A', meta: { camada: 1 } };
        const out = c.decomposeMultiGeometry({
            type: 'Feature',
            properties: original,
            geometry: { type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] },
        });
        expect(out).toHaveLength(2);

        // Level 1: independent.
        out[0].properties.nome = 'mudou';
        expect(out[1].properties.nome).toBe('A');
        expect(original.nome).toBe('A');

        // Nested: SHARED with the original and between the parts.
        out[0].properties.meta.camada = 99;
        expect(out[1].properties.meta.camada).toBe(99);
        expect(original.meta.camada).toBe(99);
    });

    it('EDGE: properties null vira {} nas partes (spread de null nao lanca)', () => {
        const c = makeControl();
        const out = c.decomposeMultiGeometry({
            type: 'Feature',
            properties: null,
            geometry: { type: 'MultiPoint', coordinates: [[0, 0]] },
        });
        expect(out).toHaveLength(1);
        expect(out[0].properties).toEqual({});
    });

    it('GeometryCollection: membro NULL e membro sem `type` sao PULADOS, nao lancam', () => {
        const c = makeControl();
        const out = c.decomposeMultiGeometry({
            type: 'Feature',
            properties: { nome: 'GC' },
            geometry: {
                type: 'GeometryCollection',
                geometries: [
                    { type: 'Point', coordinates: [0, 0] },
                    null,
                    undefined,
                    {},
                    { type: '', coordinates: [9, 9] },
                    { type: 'LineString', coordinates: [[1, 1], [2, 2]] },
                ],
            },
        });

        expect(out).toHaveLength(2);
        expect(out.map((f) => f.geometry.type)).toEqual(['Point', 'LineString']);
        expect(out.every((f) => f.properties.nome === 'GC')).toBe(true);
    });

    it('GeometryCollection recorre em Multi* e em GC aninhada', () => {
        const c = makeControl();
        const out = c.decomposeMultiGeometry({
            type: 'Feature',
            properties: { nome: 'raiz' },
            geometry: {
                type: 'GeometryCollection',
                geometries: [
                    { type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] },
                    {
                        type: 'GeometryCollection',
                        geometries: [
                            { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
                            { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] },
                        ],
                    },
                ],
            },
        });

        expect(out).toHaveLength(4);
        expect(out.map((f) => f.geometry.type)).toEqual(['Point', 'Point', 'Polygon', 'LineString']);
    });

    it('EDGE: GeometryCollection com geometries VAZIO devolve lista vazia', () => {
        const c = makeControl();
        expect(c.decomposeMultiGeometry({
            type: 'Feature',
            properties: {},
            geometry: { type: 'GeometryCollection', geometries: [] },
        })).toEqual([]);
    });

    it('CORRIGIDO: GeometryCollection SEM a chave `geometries` devolve lista vazia em vez de abortar o arquivo', () => {
        const c = makeControl();

        // CONTROLE: a mesma chamada com `geometries` presente e alcancavel e devolve o membro.
        expect(c.decomposeMultiGeometry({
            type: 'Feature',
            properties: {},
            geometry: { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [0, 0] }] },
        })).toHaveLength(1);

        // O membro null ja tinha guarda; o CONTEINER ausente nao tinha, e `for..of undefined`
        // lancava para fora do laco por feicao de importGeoJSON, que nao tem catch: UMA colecao
        // malformada derrubava o arquivo inteiro.
        const malformados = [null, 'nao e array', 42, {}];
        expect(malformados).toHaveLength(4);
        expect(c.decomposeMultiGeometry({
            type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection' },
        })).toEqual([]);
        for (const geometries of malformados) {
            expect(c.decomposeMultiGeometry({
                type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries },
            }), String(geometries)).toEqual([]);
        }
    });

    it('EDGE: feicao sem geometry lanca; quem protege e o chamador (`importGeoJSON` faz `continue`)', () => {
        const c = makeControl();
        expect(() => c.decomposeMultiGeometry({ type: 'Feature', properties: {} })).toThrow();
        expect(() => c.decomposeMultiGeometry({ type: 'Feature', properties: {}, geometry: null })).toThrow();
    });
});

describe('getTargetType', () => {
    it('mapeia os sete tipos GeoJSON, e o Multi cai no mesmo balde do singular', () => {
        const c = makeControl();
        const tabela = [
            ['Point', 'points'],
            ['MultiPoint', 'points'],
            ['LineString', 'lines'],
            ['MultiLineString', 'lines'],
            ['Polygon', 'polygons'],
            ['MultiPolygon', 'polygons'],
            ['GeometryCollection', null],
        ];
        expect(tabela).toHaveLength(7);
        for (const [entrada, saida] of tabela) {
            expect(c.getTargetType(entrada)).toBe(saida);
        }
    });

    it('EDGE: o casamento e por SUBSTRING e insensivel a caixa (shapefile devolve MAIUSCULO)', () => {
        const c = makeControl();
        expect(c.getTargetType('POLYGON')).toBe('polygons');
        expect(c.getTargetType('MULTIPOLYGON')).toBe('polygons');
        expect(c.getTargetType('pOiNt')).toBe('points');
        expect(c.getTargetType('linestring')).toBe('lines');
        // Substring, not equality: a made-up type that merely CONTAINS the word matches.
        expect(c.getTargetType('PointZ')).toBe('points');
        expect(c.getTargetType('Polyline')).toBe('lines');
    });

    it('EDGE: a ORDEM point > line > polygon decide o empate', () => {
        const c = makeControl();
        // Contains both 'point' and 'polygon': the first branch wins.
        expect(c.getTargetType('PointInPolygon')).toBe('points');
        // Contains both 'line' and 'polygon': the second branch wins.
        expect(c.getTargetType('LinePolygon')).toBe('lines');
    });

    it('EDGE: string vazia e tipo desconhecido devolvem null; null/undefined LANCAM', () => {
        const c = makeControl();
        expect(c.getTargetType('')).toBeNull();
        expect(c.getTargetType('Triangle')).toBeNull();
        expect(() => c.getTargetType(null)).toThrow(TypeError);
        expect(() => c.getTargetType(undefined)).toThrow(TypeError);
    });
});

describe('generateImportName', () => {
    it('nomeia em pt-BR e AVANCA o contador do chamador', () => {
        const c = makeControl();
        const counters = { points: 1, lines: 1, polygons: 1 };

        expect(c.generateImportName('points', counters)).toBe('Ponto #1');
        expect(c.generateImportName('points', counters)).toBe('Ponto #2');
        expect(c.generateImportName('lines', counters)).toBe('Linha #1');
        expect(c.generateImportName('polygons', counters)).toBe('Polígono #1');

        expect(counters).toEqual({ points: 3, lines: 2, polygons: 2 });
    });

    it('EDGE: contador 0 e usado como 0 (nao ha `contador || 1` engolindo o zero)', () => {
        const c = makeControl();
        const counters = { points: 0 };
        expect(c.generateImportName('points', counters)).toBe('Ponto #0');
        expect(counters.points).toBe(1);
    });

    it('CORRIGIDO: tipo fora dos tres baldes LANCA, em vez de nomear "undefined #undefined"', () => {
        const c = makeControl();
        const counters = { points: 1 };

        // CONTROLE: o caminho valido responde e e alcancavel.
        expect(c.generateImportName('points', counters)).toBe('Ponto #1');

        // Antes, nem o tipo nem o contador eram validados: a feicao entrava no store chamada
        // "undefined #undefined" e `counters[tipo]` virava NaN, de modo que TODA feicao
        // seguinte daquele tipo recebia o MESMO nome. `getTargetType` so devolve os tres
        // baldes ou null (filtrado pelo chamador), entao chegar aqui com outro tipo e bug de
        // chamador, e o lance o torna audivel em vez de escrever lixo no dado do usuario.
        expect(() => c.generateImportName('circles', counters)).toThrow(/circles/);
        expect(counters.circles).toBeUndefined();
        // Uma chave herdada do prototipo tambem e recusada (o lookup e Object.hasOwn).
        expect(() => c.generateImportName('toString', counters)).toThrow();
        expect(() => c.generateImportName('constructor', counters)).toThrow();
    });

    it('CORRIGIDO: um contador ausente ou nao-finito recomeca em 1, em vez de virar NaN', () => {
        const c = makeControl();
        // `counters.lines ?? 1` NAO cobriria o NaN; a guarda e Number.isFinite.
        const counters = { points: NaN, lines: undefined };
        expect(c.generateImportName('points', counters)).toBe('Ponto #1');
        expect(counters.points).toBe(2);
        expect(c.generateImportName('lines', counters)).toBe('Linha #1');
        expect(counters.lines).toBe(2);
    });
});

describe('getTypeCountersFromMapContext', () => {
    it('sem mapa devolve os tres contadores em 1', async () => {
        const c = makeControl();
        await expect(c.getTypeCountersFromMapContext()).resolves.toEqual({ points: 1, lines: 1, polygons: 1 });
    });

    it('continua a numeracao a partir do MAIOR nome ja existente, por tipo', async () => {
        const nomeado = (nome) => ({ properties: { nome } });
        const c = makeControl(makeMapWithSources({
            points: [nomeado('Ponto #3'), nomeado('Ponto #7'), nomeado('Ponto #5')],
            lines: [nomeado('Linha #1')],
            polygons: [],
        }));

        await expect(c.getTypeCountersFromMapContext()).resolves.toEqual({ points: 8, lines: 2, polygons: 1 });
    });

    it('EDGE: so o formato exato conta; nome livre, prefixo errado e numero nao-inteiro sao ignorados', async () => {
        const nomeado = (nome) => ({ properties: { nome } });
        const c = makeControl(makeMapWithSources({
            points: [
                nomeado('Ponto A'),
                nomeado('ponto #9'),        // caixa diferente: o regex e sensivel
                nomeado('Ponto #9 (copia)'),// ancora de fim
                nomeado('Meu Ponto #9'),    // ancora de inicio
                nomeado('Ponto #-2'),       // sinal
                nomeado('Ponto #1.5'),      // decimal
                { properties: {} },          // sem nome
                { properties: null },        // sem properties
                {},                          // sem nada
            ],
        }));

        const counters = await c.getTypeCountersFromMapContext();
        expect(counters.points).toBe(1);
    });

    it('EDGE: o espaco antes do # e opcional e zeros a esquerda contam como decimal', async () => {
        const nomeado = (nome) => ({ properties: { nome } });
        const c = makeControl(makeMapWithSources({
            points: [nomeado('Ponto#4'), nomeado('Ponto   #007')],
        }));
        await expect(c.getTypeCountersFromMapContext()).resolves.toMatchObject({ points: 8 });
    });

    it('fonte ausente ou getData que lanca nao derrubam a contagem dos outros tipos', async () => {
        const nomeado = (nome) => ({ properties: { nome } });
        const c = makeControl(makeMapWithSources({
            points: new Error('fonte quebrada'),
            lines: [nomeado('Linha #4')],
            // `polygons` ausente de proposito: getSource devolve null.
        }));

        await expect(c.getTypeCountersFromMapContext()).resolves.toEqual({ points: 1, lines: 5, polygons: 1 });
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('CORRIGIDO: a numeracao continua do maior nome mesmo num mapa de 200k feicoes, e SEM warn', async () => {
        // Antes: `Math.max(...existingNumbers)` empilha um argumento por elemento e lanca
        // RangeError acima de ~125k neste Node (mesma classe ja corrigida em
        // `add_brush_geometry.getBoundingBox`). O lance caia no try/catch por fonte, entao
        // nada aparecia: o contador voltava a 1 e todo nome importado colidia com um
        // existente. Agora e UMA varredura, sem spread.
        const grande = Array.from({ length: 200000 }, (_, i) => ({ properties: { nome: `Ponto #${i + 1}` } }));
        expect(grande).toHaveLength(200000);

        const c = makeControl(makeMapWithSources({ points: grande }));

        // CONTROLE: o mesmo caminho, com uma amostra pequena, conta certo.
        const pequeno = makeControl(makeMapWithSources({ points: grande.slice(0, 10) }));
        await expect(pequeno.getTypeCountersFromMapContext()).resolves.toMatchObject({ points: 11 });

        await expect(c.getTypeCountersFromMapContext()).resolves.toMatchObject({ points: 200001 });
        // Nenhum RangeError engolido: o catch por fonte nao foi acionado.
        expect(warnSpy).not.toHaveBeenCalled();
    });
});

describe('_getUniqueLayerName', () => {
    it('nome livre volta inalterado', async () => {
        getLayers.mockResolvedValueOnce([{ name: 'Outra' }]);
        const c = makeControl();
        await expect(c._getUniqueLayerName('Importação')).resolves.toBe('Importação');
    });

    it('o sufixo comeca em _2 e sobe enquanto colidir', async () => {
        getLayers.mockResolvedValueOnce([{ name: 'trilha' }, { name: 'trilha_2' }, { name: 'trilha_3' }]);
        const c = makeControl();
        await expect(c._getUniqueLayerName('trilha')).resolves.toBe('trilha_4');
    });

    it('EDGE: um BURACO na sequencia e preenchido (nao continua do maior)', async () => {
        getLayers.mockResolvedValueOnce([{ name: 'trilha' }, { name: 'trilha_5' }]);
        const c = makeControl();
        await expect(c._getUniqueLayerName('trilha')).resolves.toBe('trilha_2');
    });

    it('EDGE: sem camada nenhuma, e com camadas sem nome, o nome base sobrevive', async () => {
        const c = makeControl();

        getLayers.mockResolvedValueOnce([]);
        await expect(c._getUniqueLayerName('vazio')).resolves.toBe('vazio');

        getLayers.mockResolvedValueOnce([{ id: 'a' }, { name: null }]);
        await expect(c._getUniqueLayerName('vazio')).resolves.toBe('vazio');
    });

    it('EDGE: nome vazio e comparado como qualquer outro (colide com uma camada de nome vazio)', async () => {
        getLayers.mockResolvedValueOnce([{ name: '' }]);
        const c = makeControl();
        await expect(c._getUniqueLayerName('')).resolves.toBe('_2');
    });
});
