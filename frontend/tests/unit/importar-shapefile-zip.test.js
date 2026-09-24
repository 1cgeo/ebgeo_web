// Path: tests/unit/importar-shapefile-zip.test.js

/**
 * The shapefile ZIP reader (`_lerShapefileZip`) and the multi-layer import (`_importarLido`) of
 * `src/js/import_export/import.control.js`, with the REAL JSZip, shpjs and proj4 over ZIPs written
 * byte by byte (`tests/helpers/shapefile-sintetico.js`).
 *
 * THE REGRESSIONS THIS FILE PINS (review of f75f6d14, 2026-09-23):
 *   - a shapefile shipped with a metadata `.json` imported NOTHING: `shp(zip)` turns every `.json`
 *     into a "layer", and the check that every layer had `features` refused the whole file;
 *   - a second layer that fails after the first entered left the person reading "não foi possível
 *     importar o arquivo", with the first layer already saved and synced.
 * And the cost that the first version paid: a DBF with no `.cpg` made the whole ZIP be
 * regenerated uncompressed; the reader now passes the encoding instead (asserted by not calling
 * `generateAsync`).
 */

import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { Buffer } from 'node:buffer';
import { shpDePontos, dbfDeTexto } from '../helpers/shapefile-sintetico.js';

vi.mock('@store', () => ({
    addFeatures: vi.fn(async () => {}),
    createLayerForImport: vi.fn(async (name) => ({ id: `layer-${name}`, name })),
    getLayers: vi.fn(async () => []),
    getCurrentMapNameSync: vi.fn(() => 'Principal'),
    getEventBus: vi.fn(() => ({ emit: vi.fn() })),
}));
vi.mock('@utils/toast_service.js', () => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }));
vi.mock('@js/terrain', () => ({ createTerrainSampler: vi.fn(() => ({ elevation: () => 0 })) }));
vi.mock('@events', () => ({ EventTypes: { LAYERS_CHANGED: 'layers:changed' } }));
vi.mock('@layers/geojson-dispatcher.js', () => ({ getGeoJsonDispatcher: vi.fn(() => ({ add: vi.fn() })) }));
vi.mock('@js/user_data', () => ({
    userDataManager: { extractAttributesFromImport: () => ({ attributes: {}, descricao: '' }) },
}));

const { default: AddImportControl } = await import('../../src/js/import_export/import.control.js');

const campos = [{ nome: 'MUNICIPIO', tamanho: 30 }];
const controle = () => new AddImportControl({ setActiveTool: vi.fn(), deactivateCurrentTool: vi.fn() });

async function zipCom(arquivos) {
    const zip = new JSZip();
    for (const [nome, conteudo] of Object.entries(arquivos)) zip.file(nome, conteudo);
    return zip.generateAsync({ type: 'arraybuffer' });
}

describe('_lerShapefileZip', () => {
    it('REGRESSION: a metadata .json beside the shapefile does not cost the import', async () => {
        const buffer = await zipCom({
            'cidades.shp': shpDePontos([[-47.9, -15.8]]),
            'cidades.dbf': dbfDeTexto(campos, [{ MUNICIPIO: 'Brasilia' }]),
            'metadados.json': JSON.stringify({ fonte: 'IBGE', ano: 2022 }),
        });
        const colecoes = await controle()._lerShapefileZip(buffer);
        expect(colecoes).toHaveLength(1);
        expect(colecoes[0].fileName).toBe('cidades');
        expect(colecoes[0].features.map((f) => f.properties.MUNICIPIO)).toEqual(['Brasilia']);
    });

    it('a .json that IS a FeatureCollection still counts as a layer', async () => {
        const fc = { type: 'FeatureCollection', features: [
            { type: 'Feature', properties: { a: 1 }, geometry: { type: 'Point', coordinates: [1, 2] } }] };
        const colecoes = await controle()._lerShapefileZip(await zipCom({ 'pontos.json': JSON.stringify(fc) }));
        expect(colecoes).toHaveLength(1);
        expect(colecoes[0].features).toHaveLength(1);
    });

    it('a Windows-1252 DBF with no .cpg is read right WITHOUT regenerating the ZIP', async () => {
        const buffer = await zipCom({
            'cidades.shp': shpDePontos([[-47.9, -15.8]]),
            'cidades.dbf': dbfDeTexto(campos, [{ MUNICIPIO: 'Brasília' }], { codificacao: 'latin1' }),
        });
        const gerar = vi.spyOn(JSZip.prototype, 'generateAsync');
        const [colecao] = await controle()._lerShapefileZip(buffer);
        expect(colecao.features[0].properties.MUNICIPIO).toBe('Brasília');
        expect(gerar).not.toHaveBeenCalled();
        gerar.mockRestore();
    });

    it('an existing .cpg wins, in any casing of the extension', async () => {
        const buffer = await zipCom({
            'A.SHP': shpDePontos([[-47.9, -15.8]]),
            'A.DBF': dbfDeTexto(campos, [{ MUNICIPIO: 'Brasília' }], { codificacao: 'utf8' }),
            'A.CPG': 'UTF-8',
        });
        const [colecao] = await controle()._lerShapefileZip(buffer);
        expect(colecao.features[0].properties.MUNICIPIO).toBe('Brasília');
    });

    it('a .prj the projection library cannot read refuses, naming the layer', async () => {
        const buffer = await zipCom({
            'cidades.shp': shpDePontos([[500000, 8000000]]),
            'cidades.dbf': dbfDeTexto(campos, [{ MUNICIPIO: 'x' }]),
            'cidades.prj': 'isto não é WKT',
        });
        await expect(controle()._lerShapefileZip(buffer)).rejects.toThrow(/cidades/);
    });

    it('a ZIP with no shapefile and no FeatureCollection says so', async () => {
        await expect(controle()._lerShapefileZip(await zipCom({ 'leia-me.txt': 'x' })))
            .rejects.toThrow('nenhum shapefile');
    });

    it('__MACOSX shadows are ignored', async () => {
        const buffer = await zipCom({
            'cidades.shp': shpDePontos([[-47.9, -15.8]]),
            '__MACOSX/._cidades.shp': Buffer.from([0, 1, 2]),
        });
        expect(await controle()._lerShapefileZip(buffer)).toHaveLength(1);
    });
});

describe('_importarLido', () => {
    const camada = (nome) => ({ type: 'FeatureCollection', fileName: nome, features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }] });

    it('REGRESSION: a layer failing after others entered says what entered', async () => {
        const c = controle();
        c.getTypeCountersFromMapContext = vi.fn(async () => ({ points: 1, lines: 1, polygons: 1 }));
        c.importGeoJSON = vi.fn()
            .mockResolvedValueOnce(2)
            .mockRejectedValueOnce(new Error('Mapa bloqueado'));
        await expect(c._importarLido([camada('cidades'), camada('quarteis')], 'temas'))
            .rejects.toThrow('2 geometrias entraram ("cidades"), mas a camada "quarteis" não: Mapa bloqueado');
    });

    it('CONTROL: a failure on the FIRST layer keeps its own error', async () => {
        const c = controle();
        c.getTypeCountersFromMapContext = vi.fn(async () => ({ points: 1, lines: 1, polygons: 1 }));
        c.importGeoJSON = vi.fn().mockRejectedValueOnce(new Error('Mapa bloqueado'));
        await expect(c._importarLido([camada('cidades'), camada('quarteis')], 'temas'))
            .rejects.toThrow(/^Mapa bloqueado$/);
    });

    it('all layers share one counter object', async () => {
        const c = controle();
        const contadores = { points: 7, lines: 1, polygons: 1 };
        c.getTypeCountersFromMapContext = vi.fn(async () => contadores);
        c.importGeoJSON = vi.fn(async () => 1);
        expect(await c._importarLido([camada('a'), camada('b')], 'x')).toBe(2);
        expect(c.importGeoJSON.mock.calls.map((chamada) => chamada[2])).toEqual([contadores, contadores]);
        expect(c.getTypeCountersFromMapContext).toHaveBeenCalledTimes(1);
    });
});
