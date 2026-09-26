// Path: tests/unit/kmz-tracejado-volta-inteiro.repro.test.js
//
// UMA LINHA TRACEJADA VOLTA DO KMZ COMO UMA FEIÇÃO, e não uma por traço (decisão do dono de
// 2026-09-26).
//
// O DEFEITO. KML não diz "tracejado", então "Simular linhas tracejadas" escreve a linha (e o contorno
// tracejado de uma área) como os próprios traços, muitas linhas curtas num `MultiGeometry`, que é o
// que o Google Earth precisa para mostrá-la. A nossa importação desmembrava essa coleção em uma feição
// por traço: três feições exportadas voltavam como 156 (medido em
// `tests/e2e-ui/kmz-ida-e-volta-campo-a-campo.spec.js`, que por isso desligava a opção).
//
// O CONSERTO. A exportação grava a geometria ORIGINAL dentro do `ebgeo_estilo` da feição fatiada, e a
// importação a põe de volta antes de desmembrar (`comGeometriaOriginal`, `estilo-importado.js`). O
// estilo restaurado traz o tracejado de volta.
//
// O ambiente é node: o mapeador roda de verdade, e o que o leitor de KML entregaria é montado a partir
// do XML por expressão regular, como em `kmz-exporta-janela-temporal.repro.test.js`, porque o
// `@tmcw/togeojson` precisa de um `DOMParser` que não existe aqui.

import { describe, it, expect, vi } from 'vitest';

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
vi.mock('@utils/toast_service.js', () => ({ showSuccess: vi.fn(), showError: vi.fn() }));
vi.mock('@js/terrain', () => ({ createTerrainSampler: vi.fn(() => ({ elevation: () => 0, fast: true, zoom: 12 })) }));
vi.mock('@layers/geojson-dispatcher.js', () => ({ getGeoJsonDispatcher: vi.fn(() => ({ add: vi.fn() })) }));
vi.mock('@js/user_data', () => ({
    userDataManager: { extractAttributesFromImport: () => ({ attributes: {}, descricao: '' }) },
}));

import AddImportControl from '../../src/js/import_export/import.control.js';
import { mapFeatureToKml } from '@js/import_export/kmz/kmz-feature-mapper.js';
import { StyleRegistry } from '@js/import_export/kmz/kml-document.js';
import {
    CHAVE_DO_ESTILO, CHAVE_DA_GEOMETRIA_ORIGINAL, comGeometriaOriginal, separarEstiloImportado,
} from '@js/import_export/estilo-importado.js';

const assetsStub = { has: () => true, get: () => ({ href: 'files/x.png', width: 64, height: 64 }), add: () => null };

const LINHA = { type: 'LineString', coordinates: [[-47.9, -15.8], [-47.85, -15.79], [-47.8, -15.8]] };
const AREA = {
    type: 'Polygon',
    coordinates: [[[-47.9, -15.8], [-47.8, -15.8], [-47.8, -15.7], [-47.9, -15.7], [-47.9, -15.8]]],
};

/** Exports one feature the way the KMZ export does. */
function exportar(geometry, featureType, properties, options = {}) {
    return mapFeatureToKml({
        feature: { type: 'Feature', properties: { id: 'f1', nome: 'Eixo', ...properties }, geometry },
        featureType,
        styles: new StyleRegistry(),
        assets: assetsStub,
        options: { includePhotos: false, ...options },
    });
}

const desescapar = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const posicoes = (texto) => texto.trim().split(/\s+/).map((p) => p.split(',').slice(0, 2).map(Number));

/**
 * What the KML reader hands the import for one placemark: its ExtendedData as properties and its
 * `MultiGeometry` as a `GeometryCollection` of what it contains.
 */
function lidoPeloLeitor(xml) {
    const propriedades = {};
    for (const [, nome, valor] of xml.matchAll(/<Data name="([^"]*)"><value>([\s\S]*?)<\/value><\/Data>/g)) {
        propriedades[desescapar(nome)] = desescapar(valor);
    }
    const geometrias = [];
    for (const [, coords] of xml.matchAll(/<LineString>[\s\S]*?<coordinates>([^<]*)<\/coordinates>[\s\S]*?<\/LineString>/g)) {
        geometrias.push({ type: 'LineString', coordinates: posicoes(coords) });
    }
    for (const [, coords] of xml.matchAll(/<outerBoundaryIs><LinearRing><coordinates>([^<]*)<\/coordinates>/g)) {
        geometrias.push({ type: 'Polygon', coordinates: [posicoes(coords)] });
    }
    return { type: 'Feature', properties: propriedades, geometry: { type: 'GeometryCollection', geometries: geometrias } };
}

const controle = () => new AddImportControl({ setActiveTool: vi.fn(), deactivateCurrentTool: vi.fn() });

describe('KMZ: a feição tracejada, fatiada na ida, volta inteira', () => {
    it('a ida fatia a linha e grava a geometria original no ebgeo_estilo', async () => {
        const xml = await exportar(LINHA, 'lines', { lineStyle: 'dashed', lineColor: '#2e7d32', lineWidth: 3 });

        expect((xml.match(/<LineString>/g) ?? []).length).toBeGreaterThan(10);
        const estilo = JSON.parse(lidoPeloLeitor(xml).properties[CHAVE_DO_ESTILO]);
        expect(estilo[CHAVE_DA_GEOMETRIA_ORIGINAL]).toEqual(LINHA);
        expect(estilo.lineStyle).toBe('dashed');
    });

    it('REPRO: a volta devolve UMA linha com a geometria original, e o estilo traz o tracejado', async () => {
        const xml = await exportar(LINHA, 'lines', { lineStyle: 'dashed' });
        const lido = lidoPeloLeitor(xml);
        expect(lido.geometry.geometries.length).toBeGreaterThan(10);

        const voltaram = controle().featuresDoArquivo(lido);

        expect(voltaram).toHaveLength(1);
        expect(voltaram[0].geometry).toEqual(LINHA);
        expect(separarEstiloImportado(voltaram[0].properties).estilo.lineStyle).toBe('dashed');
    });

    it('REPRO: a área de contorno tracejado volta como UM polígono, sem os traços do contorno', async () => {
        const xml = await exportar(AREA, 'polygons', { lineStyle: 'dashed', fillColor: '#6a1b9a' });
        const lido = lidoPeloLeitor(xml);
        expect(lido.geometry.geometries.length).toBeGreaterThan(10);

        const voltaram = controle().featuresDoArquivo(lido);

        expect(voltaram).toHaveLength(1);
        expect(voltaram[0].geometry).toEqual(AREA);
    });

    it('CONTROLE: a linha contínua não carrega a geometria (o arquivo não dobra de tamanho à toa)', async () => {
        const xml = await exportar(LINHA, 'lines', { lineStyle: 'solid' });
        const estilo = JSON.parse(lidoPeloLeitor(xml).properties[CHAVE_DO_ESTILO]);
        expect(Object.hasOwn(estilo, CHAVE_DA_GEOMETRIA_ORIGINAL)).toBe(false);
        expect(controle().featuresDoArquivo(lidoPeloLeitor(xml))).toHaveLength(1);
    });

    it('CONTROLE: sem "Simular linhas tracejadas" nada é fatiado, e nada é gravado', async () => {
        const xml = await exportar(LINHA, 'lines', { lineStyle: 'dashed' }, { simulateDash: false });
        expect((xml.match(/<LineString>/g) ?? []).length).toBe(1);
        const estilo = JSON.parse(lidoPeloLeitor(xml).properties[CHAVE_DO_ESTILO]);
        expect(Object.hasOwn(estilo, CHAVE_DA_GEOMETRIA_ORIGINAL)).toBe(false);
    });
});

describe('comGeometriaOriginal', () => {
    const fatiada = (estilo) => ({
        type: 'Feature',
        properties: { [CHAVE_DO_ESTILO]: estilo },
        geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] },
    });

    it('um estilo que não se lê, sem a chave, ou com um valor que não é geometria fatiável não muda nada', () => {
        for (const estilo of ['{nao json', '{"lineStyle":"dashed"}', '{"geometriaOriginal":{"type":"Point","coordinates":[0,0]}}',
            '{"geometriaOriginal":{"type":"LineString","coordinates":[]}}', '{"geometriaOriginal":"LineString"}']) {
            const f = fatiada(estilo);
            expect(comGeometriaOriginal(f)).toBe(f);
        }
    });

    it('feição de KML de terceiros (sem ebgeo_estilo) passa intacta', () => {
        const f = { type: 'Feature', properties: { name: 'x' }, geometry: { type: 'Point', coordinates: [0, 0] } };
        expect(comGeometriaOriginal(f)).toBe(f);
        expect(comGeometriaOriginal(null)).toBe(null);
    });
});
