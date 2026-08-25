// Path: tests/unit/export-import-helpers-puros.test.js

/**
 * @fileoverview Pins the four PURE helpers of `ExportImportService`
 * (`src/js/import_export/export-import.service.js`) that the `.ebgeo` pipeline runs on
 * every export and every import: `roundCoordinates`, `optimizeFeature`/`optimizeMapData`,
 * `getBlobExtension` and `xorData`.
 *
 * WHAT IT PINS
 * - The 6-decimal (about 1 m) rounding, its recursion through polygon rings, what it does
 *   to the non-finite values it never guards, and the sign asymmetry at the .5 boundary.
 * - That `optimize*` are SHALLOW: they hand back a new top-level object while writing the
 *   rounded coordinates into the geometry of the object they were given.
 * - The blob-MIME to extension table, including the two silent fallbacks (unknown MIME and
 *   an upper-case MIME both come back as `png`).
 * - `xorData` self-inverse over the whole byte range, and what it does to inputs that are
 *   not byte arrays.
 *
 * WHAT IT DOES NOT REACH
 * - `buildExportDataObject` / `buildPrunedExportData` / the pruning notice: already pinned
 *   by `tests/unit/export-import-service.test.js`, `tests/unit/poda-de-saida-fiacao.test.js`,
 *   `tests/unit/aviso-de-perda-de-recursos.test.js` and
 *   `tests/unit/saida-de-dados-visitante-deslogado.test.js`.
 * - `handleExport`/`handleImport` (JSZip, file dialogs, modals) and everything store-backed.
 * - `isV1Format`, which is module-private and has no export seam.
 */

import { describe, it, expect, vi } from 'vitest';

// Same shape as `tests/unit/export-import-service.test.js`: the module-level `@store`
// barrel import must resolve for the file to load; none of these are called here.
vi.mock('@store', () => ({
    getAllMapNamesStore: vi.fn(async () => []),
    getCurrentMapName: vi.fn(async () => 'Mapa A'),
    getCurrentMapNameSync: vi.fn(() => 'Mapa A'),
    getMapOrder: vi.fn(async () => []),
    getCurrentMapFeatures: vi.fn(async () => ({})),
    getMapPosition: vi.fn(async () => ({ zoom: 8, center_lat: 0, center_long: 0, bearing: 0, pitch: 0 })),
    getCatalogLayers: vi.fn(async () => []),
    getCurrentBaseLayer: vi.fn(async () => 'carta'),
    getColorUsage: vi.fn(async () => ({})),
    getMapNotes: vi.fn(async () => ({})),
    getMapGroups: vi.fn(() => ({})),
    getLayers: vi.fn(async () => []),
    getCesium3dDataForExport: vi.fn(async () => ({})),
    getStreetview360DataForExport: vi.fn(async () => ({})),
    getMapTemporalConfig: vi.fn(async () => ({})),
    getGridStyle: vi.fn(async () => ({})),
    getComments: vi.fn(async () => ({})),
    getBriefingsForExport: vi.fn(async () => []),
    getCustomIconsForExport: vi.fn(async () => []),
}));

import { ExportImportService } from '../../src/js/import_export/export-import.service.js';

/** @returns {ExportImportService} */
function makeService() {
    return new ExportImportService({}, { deactivateCurrentTool: vi.fn() }, {}, null);
}

describe('roundCoordinates', () => {
    it('arredonda a 6 casas um par lng/lat', () => {
        expect(makeService().roundCoordinates([-43.2123456789, -22.9123454321]))
            .toEqual([-43.212346, -22.912345]);
    });

    it('recorre por anel de poligono e por multipoligono, preservando a profundidade', () => {
        const s = makeService();
        const anel = [[[0.1234567, 1.7654321], [2.0000004, 3.0000006], [0.1234567, 1.7654321]]];
        const out = s.roundCoordinates(anel);

        expect(out).toHaveLength(1);
        expect(out[0]).toHaveLength(3);
        expect(out).toEqual([[[0.123457, 1.765432], [2, 3.000001], [0.123457, 1.765432]]]);

        // Multipolygon: one level deeper, same result shape.
        const multi = s.roundCoordinates([anel]);
        expect(multi).toEqual([out]);
    });

    it('EDGE: a terceira componente (altitude) tambem e arredondada, nao preservada', () => {
        expect(makeService().roundCoordinates([1.11111149, 2.2, 1234.5678901]))
            .toEqual([1.111111, 2.2, 1234.56789]);
    });

    it('nao-finito e PRESERVADO, e nao trocado por um numero plausivel', () => {
        // CONSERTADO EM 2026-08-24, e o conserto nao e "rejeitar": e PARAR de inventar. Antes,
        // `null` virava 0 (porque `null * 1e6 === 0`), gravando uma coordenada que ninguem
        // digitou dentro de um `.ebgeo` que circula por e-mail e pendrive. NaN e Infinity ja
        // atravessavam e continuam atravessando, de proposito: quem valida geometria e o import
        // do outro lado, e um zero plausivel e o que faz o defeito chegar longe da causa.
        const out = makeService().roundCoordinates([NaN, Infinity, -Infinity, null]);
        expect(out).toHaveLength(4);
        expect(Number.isNaN(out[0])).toBe(true);
        expect(out[1]).toBe(Infinity);
        expect(out[2]).toBe(-Infinity);
        expect(out[3]).toBeNull();
    });

    it('CONTROLE: o numero finito ao lado do lixo continua sendo arredondado', () => {
        // Sem este caso, uma guarda larga demais (devolver a entrada inteira sem tocar) passaria
        // verde no caso de cima e teria desligado o arredondamento do produto.
        expect(makeService().roundCoordinates([-43.2123456789, NaN]))
            .toEqual([-43.212346, NaN]);
    });

    it('EDGE: a fronteira .5 e ASSIMETRICA no sinal (Math.round arredonda para +Infinito)', () => {
        const s = makeService();
        expect(s.roundCoordinates([0.0000005])).toEqual([0.000001]);

        const negativo = s.roundCoordinates([-0.0000005]);
        // -0.5 rounds to -0, so the negative half-step collapses to zero instead of -1e-6,
        // and the zero it produces is NEGATIVE zero (identical under ===, distinct under Object.is).
        expect(negativo[0] === 0).toBe(true);
        expect(Object.is(negativo[0], -0)).toBe(true);
    });

    it('EDGE: antimeridiano e polos passam sem normalizacao nenhuma (o valor cru sobrevive)', () => {
        const s = makeService();
        expect(s.roundCoordinates([-180.0000001, -90])).toEqual([-180, -90]);
        expect(s.roundCoordinates([180.0000004, 90])).toEqual([180, 90]);
        // Um valor FORA da faixa nao e corrigido nem recusado.
        expect(s.roundCoordinates([200.1234567, 100.7654321])).toEqual([200.123457, 100.765432]);
    });

    it('EDGE: lista vazia devolve lista vazia; coordenada nao-array lanca', () => {
        const s = makeService();
        expect(s.roundCoordinates([])).toEqual([]);
        expect(() => s.roundCoordinates(null)).toThrow(TypeError);
        expect(() => s.roundCoordinates(undefined)).toThrow(TypeError);
    });

    it('EDGE: valor nao numerico dentro do par e PRESERVADO como veio', () => {
        // CONSERTADO EM 2026-08-24. O `null` era o unico dos tres que MENTIA: ele virava `0`
        // (`null * 1e6 === 0`), uma coordenada plausivel que ninguem digitou, no meridiano de
        // Greenwich ou no equador. `'abc'` e `undefined` viravam NaN, que pelo menos e visivel.
        // Agora os tres atravessam intactos, e quem valida geometria e o import do outro lado.
        const out = makeService().roundCoordinates([null, 'abc', undefined]);
        expect(out).toHaveLength(3);
        expect(out[0]).toBeNull();
        expect(out[1]).toBe('abc');
        expect(out[2]).toBeUndefined();
    });

    it('EDGE: uma linha de 200k vertices e arredondada sem estourar a pilha (recursao por nivel, nao por ponto)', () => {
        const linha = Array.from({ length: 200000 }, (_, i) => [i * 1e-7, 0]);
        expect(linha).toHaveLength(200000);
        const out = makeService().roundCoordinates(linha);
        expect(out).toHaveLength(200000);
        expect(out[199999]).toEqual([0.02, 0]);
    });
});

describe('optimizeFeature / optimizeMapData', () => {
    it('devolve uma feicao NOVA no nivel 1 com as coordenadas arredondadas', () => {
        const feature = {
            type: 'Feature',
            properties: { nome: 'A' },
            geometry: { type: 'Point', coordinates: [-43.2123456789, -22.9123456789] },
        };
        const out = makeService().optimizeFeature(feature);

        expect(out).not.toBe(feature);
        expect(out.geometry.coordinates).toEqual([-43.212346, -22.912346]);
        expect(out.properties).toBe(feature.properties);
    });

    it('feicao sem geometria, ou com geometria sem coordinates, passa intacta', () => {
        const s = makeService();
        expect(s.optimizeFeature({ properties: { id: 'x' } })).toEqual({ properties: { id: 'x' } });
        expect(s.optimizeFeature({ geometry: { type: 'Point' } })).toEqual({ geometry: { type: 'Point' } });
        expect(s.optimizeFeature({ geometry: null })).toEqual({ geometry: null });
    });

    it('DEFEITO OBSERVADO: optimizeFeature ESCREVE no objeto de entrada (a geometria e compartilhada)', () => {
        const s = makeService();
        const feature = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [1.1234567, 2.7654321] },
        };
        const geometriaOriginal = feature.geometry;

        // CONTROLE: a funcao e alcancavel e produz o valor arredondado.
        const out = s.optimizeFeature(feature);
        expect(out.geometry.coordinates).toEqual([1.123457, 2.765432]);

        // OBSERVADO: a copia rasa deixa `optimized.geometry === feature.geometry`, entao a
        // atribuicao de `.coordinates` cai no MESMO objeto de geometria que o chamador passou.
        expect(out.geometry).toBe(geometriaOriginal);
        expect(feature.geometry.coordinates).toEqual([1.123457, 2.765432]);
    });

    it('optimizeMapData arredonda toda categoria que for array e ignora as demais', () => {
        const s = makeService();
        const mapData = {
            baseLayer: 'carta',
            features: {
                points: [{ geometry: { type: 'Point', coordinates: [1.1234567, 0] } }],
                polygons: [{ geometry: { type: 'Polygon', coordinates: [[[0.9999999, 0], [1, 1], [0.9999999, 0]]] } }],
                coordination_measures: null,
                lines: 'nao e array',
            },
        };

        const out = s.optimizeMapData(mapData);

        expect(Object.keys(out.features)).toHaveLength(4);
        expect(out.features.points[0].geometry.coordinates).toEqual([1.123457, 0]);
        expect(out.features.polygons[0].geometry.coordinates[0][0]).toEqual([1, 0]);
        expect(out.features.coordination_measures).toBeNull();
        expect(out.features.lines).toBe('nao e array');
        expect(out.baseLayer).toBe('carta');
    });

    it('optimizeMapData sem `features` nao lanca', () => {
        expect(makeService().optimizeMapData({ baseLayer: 'x' })).toEqual({ baseLayer: 'x' });
    });

    it('DEFEITO OBSERVADO: optimizeMapData reescreve o objeto `features` do chamador (mesma copia rasa)', () => {
        const s = makeService();
        const features = { points: [{ geometry: { type: 'Point', coordinates: [1.1234567, 0] } }] };
        const mapData = { features };

        const out = s.optimizeMapData(mapData);

        // CONTROLE: o nivel 1 e mesmo uma copia.
        expect(out).not.toBe(mapData);

        // OBSERVADO: `features` e a MESMA referencia, e a lista dentro dela foi trocada.
        expect(out.features).toBe(features);
        expect(features.points[0].geometry.coordinates).toEqual([1.123457, 0]);
    });
});

describe('getBlobExtension', () => {
    it('mapeia os quatro MIME conhecidos, com jpeg virando jpg', () => {
        const s = makeService();
        const tabela = [
            ['image/svg+xml', 'svg'],
            ['image/jpeg', 'jpg'],
            ['image/webp', 'webp'],
            ['image/png', 'png'],
        ];
        expect(tabela).toHaveLength(4);
        for (const [mime, ext] of tabela) {
            expect(s.getBlobExtension({ type: mime })).toBe(ext);
        }
    });

    it('EDGE: type vazio/ausente cai no padrao png (`|| image/png`, e aqui o falsy so pode ser a string vazia)', () => {
        const s = makeService();
        expect(s.getBlobExtension({ type: '' })).toBe('png');
        expect(s.getBlobExtension({})).toBe('png');
    });

    it('MIME em MAIUSCULA e MIME COM PARAMETRO resolvem, porque o tipo e normalizado', () => {
        // CONSERTADO EM 2026-08-24. Estas quatro asserções diziam `png`, e esse era o defeito:
        // o teste fixava como esperado o que a pessoa via de errado. MIME e case-insensitive por
        // RFC 2045 e o parametro depois do `;` e legitimo, entao uma foto JPEG vinda de um canvas
        // ou de um arquivo escolhido a mao era gravada no `.ebgeo` com extensao `.png`.
        const s = makeService();
        expect(s.getBlobExtension({ type: 'IMAGE/JPEG' })).toBe('jpg');
        expect(s.getBlobExtension({ type: 'image/jpeg; charset=binary' })).toBe('jpg');
        expect(s.getBlobExtension({ type: 'Image/WebP' })).toBe('webp');
        expect(s.getBlobExtension({ type: '  image/svg+xml  ' })).toBe('svg');
    });

    it('EDGE: MIME desconhecido continua caindo em png, sem aviso', () => {
        // Esta metade NAO mudou, e continua sendo buraco declarado: uma gif sai como `.png` e
        // nada sinaliza. Normalizar a caixa nao acrescenta a gif a tabela.
        const s = makeService();
        expect(s.getBlobExtension({ type: 'image/gif' })).toBe('png');
        expect(s.getBlobExtension({ type: 'image/avif' })).toBe('png');
        expect(s.getBlobExtension({ type: 'application/pdf' })).toBe('png');
    });

    it('EDGE: blob null lanca (sem guarda de entrada)', () => {
        expect(() => makeService().getBlobExtension(null)).toThrow(TypeError);
    });
});

describe('xorData', () => {
    it('e auto-inverso para toda a faixa de bytes, com a chave padrao', () => {
        const s = makeService();
        const dados = new Uint8Array(256).map((_, i) => i);
        expect(dados).toHaveLength(256);

        const mascarado = s.xorData(dados);
        expect(mascarado).toBeInstanceOf(Uint8Array);
        expect(mascarado).toHaveLength(256);
        // It really masks: at least one byte differs (0xAA ^ 0xAA === 0 is the only fixed point).
        expect(Array.from(mascarado)).not.toEqual(Array.from(dados));

        expect(Array.from(s.xorData(mascarado))).toEqual(Array.from(dados));
    });

    it('e auto-inverso para TODA chave de 0 a 255 (varredura, com o tamanho asserido)', () => {
        const s = makeService();
        const dados = new Uint8Array([0, 1, 127, 128, 200, 255]);
        expect(dados).toHaveLength(6);

        let chaves = 0;
        for (let k = 0; k <= 255; k++) {
            chaves++;
            expect(Array.from(s.xorData(s.xorData(dados, k), k))).toEqual(Array.from(dados));
        }
        expect(chaves).toBe(256);
    });

    it('EDGE: chave 0 e identidade; entrada vazia sai vazia', () => {
        const s = makeService();
        const dados = new Uint8Array([1, 2, 3]);
        expect(Array.from(s.xorData(dados, 0))).toEqual([1, 2, 3]);
        expect(s.xorData(new Uint8Array(0))).toHaveLength(0);
    });

    it('EDGE: chave acima de 255 e chave nao inteira continuam auto-inversas (XOR trunca para o byte)', () => {
        const s = makeService();
        const dados = new Uint8Array([9, 200, 255]);
        for (const k of [0x1aa, 65535, -86, 1.9]) {
            expect(Array.from(s.xorData(s.xorData(dados, k), k))).toEqual([9, 200, 255]);
        }
    });

    it('EDGE: chave NaN vira 0 e a mascara nao mascara nada', () => {
        const s = makeService();
        const dados = new Uint8Array([7, 8, 9]);
        expect(Array.from(s.xorData(dados, NaN))).toEqual([7, 8, 9]);
    });

    it('EDGE: array comum funciona, mas uma STRING vira lixo de zeros em silencio', () => {
        const s = makeService();
        expect(Array.from(s.xorData([1, 2, 3]))).toEqual([1 ^ 0xaa, 2 ^ 0xaa, 3 ^ 0xaa]);

        // A character is not a number: ToNumber('a') is NaN, and the XOR operator coerces
        // NaN to 0, so every byte comes out as the KEY itself. Round-tripping the result
        // does NOT give the string back: the content is gone, silently.
        const daString = s.xorData('abc');
        expect(daString).toHaveLength(3);
        expect(Array.from(daString)).toEqual([0xaa, 0xaa, 0xaa]);
    });
});
