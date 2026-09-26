// Path: tests/unit/export-nome-de-mapa-como-dado.repro.test.js
// Map names are user data. Object prototype setters must never remove a map
// or one of its side records when the export becomes JSON.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@store', () => ({
    flushPendingLayerWrites: vi.fn(async () => {}),
    getCurrentMapName: vi.fn(async () => '__proto__'),
    getCurrentMapNameSync: vi.fn(() => '__proto__'),
    getMapOrder: vi.fn(async () => ['__proto__']),
    getCurrentMapFeatures: vi.fn(async () => ({ points: [{
        type: 'Feature', properties: { id: 'point-1', source: 'point', nome: 'Preservar' },
        geometry: { type: 'Point', coordinates: [-43, -22] },
    }] })),
    getMapPosition: vi.fn(async () => ({ zoom: 8, center_lat: -22, center_long: -43, bearing: 0, pitch: 0 })),
    isMapLocked: vi.fn(async () => false),
    getMapBadgeColors: vi.fn(async () => ({})),
    getCatalogLayers: vi.fn(async () => []),
    getCurrentBaseLayer: vi.fn(async () => 'carta'),
    getColorUsage: vi.fn(async () => ({ '#ff0000': 1 })),
    getMapNotes: vi.fn(async () => ({ title: 'Anotação' })),
    getMapGroupsFromDB: vi.fn(async () => ({ g: { id: 'g', name: 'Grupo', features: [] } })),
    getLayersRepo: vi.fn(async () => [{ id: 'default', name: 'Camada' }]),
    getCesium3dDataForExport: vi.fn(async () => ({ markers: [] })),
    getStreetview360DataForExport: vi.fn(async () => ({ markers: [], orientations: {} })),
    getMapTemporalConfig: vi.fn(async () => ({ ativo: true })),
    getGridStyle: vi.fn(async () => ({ visible: true })),
    getComments: vi.fn(async () => ({ c: { id: 'c', text: 'Comentário' } })),
    getBriefingsForExport: vi.fn(async () => []),
    getCustomIconsForExport: vi.fn(async () => []),
}));

import { ExportImportService } from '../../src/js/import_export/export-import.service.js';
import { podarDocumentoDeExportacao } from '../../src/js/catalog/private-reference-pruner.js';
import { getMapGroupsFromDB, getBriefingsForExport } from '@store';

describe('map names survive export as own JSON keys', () => {
    const sections = ['maps', 'colorUsage', 'mapNotes', 'groups', 'layers', 'cesium3d',
        'streetview360', 'temporal', 'gridStyle', 'comments'];

    it.each(['__proto__', 'constructor', 'toString'])('preserves %s and every per-map section', async name => {
        const service = new ExportImportService({}, { deactivateCurrentTool: vi.fn() }, {}, null);
        const built = await service.buildExportDataObject([name]);
        const serialized = JSON.parse(JSON.stringify(built));
        for (const section of sections) {
            expect(Object.keys(serialized[section]), section).toEqual([name]);
        }
        expect(serialized.maps[name].features.points[0].properties.nome).toBe('Preservar');
    });

    it('the public-resource filter preserves a __proto__ map that arrived from an archive', () => {
        const original = JSON.parse('{"maps":{"__proto__":{"features":{"points":[{"properties":{"nome":"Preservar"}}]}}},"comments":{"__proto__":{}},"cesium3d":{"__proto__":{}},"streetview360":{"__proto__":{}}}');
        const { documento } = podarDocumentoDeExportacao(original, () => 'public');
        const serialized = JSON.parse(JSON.stringify(documento));
        for (const section of ['maps', 'comments', 'cesium3d', 'streetview360']) {
            expect(Object.keys(serialized[section]), section).toEqual(['__proto__']);
        }
        expect(Reflect.get(serialized.maps, '__proto__').features.points[0].properties.nome).toBe('Preservar');
    });
});

describe('read failures cannot masquerade as empty export sections', () => {
    it('reports the map whose groups could not be read while keeping its features', async () => {
        getMapGroupsFromDB.mockRejectedValueOnce(new Error('IndexedDB unavailable'));
        const service = new ExportImportService({}, { deactivateCurrentTool: vi.fn() }, {}, null);
        const readFailures = [];
        const data = await service.buildExportDataObject(['A'], { readFailures });
        expect(data.maps.A.features.points).toHaveLength(1);
        expect(Object.keys(data.groups)).toEqual([]);
        expect(readFailures).toEqual([{ section: 'groups', mapName: 'A' }]);
    });

    it('reports a briefing read failure rather than silently exporting an empty list', async () => {
        getBriefingsForExport.mockRejectedValueOnce(new Error('IndexedDB unavailable'));
        const service = new ExportImportService({}, { deactivateCurrentTool: vi.fn() }, {}, null);
        const readFailures = [];
        await service.buildExportDataObject(['A'], { readFailures });
        expect(readFailures).toEqual([{ section: 'briefings', mapName: null }]);
    });
});
