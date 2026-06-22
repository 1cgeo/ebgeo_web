import { describe, it, expect, vi } from 'vitest';

// The export builder reads the whole store through the `@store` barrel. Mock only the getters
// it uses, with controlled data, so we can assert the `.ebgeo` data object is COMPLETE — this is
// the layer where the "groups never exported" bug lived (a `.size`/Map check on a plain object).
vi.mock('@store', () => ({
    getAllMapNamesStore: vi.fn(async () => ['Mapa A']),
    getCurrentMapName: vi.fn(async () => 'Mapa A'),
    getCurrentMapNameSync: vi.fn(() => 'Mapa A'),
    getMapOrder: vi.fn(async () => ['Mapa A']),
    getCurrentMapFeatures: vi.fn(async () => ({
        points: [{ type: 'Feature', properties: { id: 'p1', source: 'point', nome: 'Alfa' }, geometry: { type: 'Point', coordinates: [-43.2123456789, -22.9123456789] } }],
        polygons: [{ type: 'Feature', properties: { id: 'poly1', source: 'polygon' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }],
    })),
    getMapPosition: vi.fn(async () => ({ zoom: 8, center_lat: -22.9, center_long: -43.2, bearing: 0, pitch: 0 })),
    getCatalogLayers: vi.fn(async () => []),
    getCurrentBaseLayer: vi.fn(async () => 'carta-ortoimagem'),
    getColorUsage: vi.fn(async () => ({ '#ff0000': 2 })),
    getMapNotes: vi.fn(async () => ({ title: 'Titulo', description: 'Desc' })),
    // getMapGroups returns a PLAIN OBJECT keyed by group id (NOT a Map) — the exact shape the bug
    // mishandled. importGroupsDirectly expects this same shape.
    getMapGroups: vi.fn(async () => ({ g1: { id: 'g1', name: 'Grupo 1', features: [{ type: 'point', id: 'p1' }] } })),
    getLayers: vi.fn(async () => [{ id: 'default', name: 'Padrão', order: 0, visible: true, locked: false, opacity: 1 }]),
    getCesium3dDataForExport: vi.fn(async () => ({ cameraPositions: {}, markers: [{ id: 'm1', tilesetId: 't1' }], measurements: [], viewsheds: [] })),
    getStreetview360DataForExport: vi.fn(async () => ({ orientations: {}, markers: [{ id: 's1', photoName: 'p' }] })),
    getMapTemporalConfig: vi.fn(async () => ({ ativo: true, modo: 'absoluto', unidade: 'h', inicio: 0, fim: 1000, origem: 0 })),
    getGridStyle: vi.fn(async () => ({ format: 'utm', visible: true })),
    getComments: vi.fn(async () => ({ c1: { id: 'c1', parentId: null, lng: -43.2, lat: -22.9, text: 'Atenção neste ponto', status: 'open' } })),
    getBriefingsForExport: vi.fn(async () => [{ id: 'b1', name: 'Briefing', slides: [{ id: 's1', mapId: 'Mapa A' }] }]),
    getCustomIconsForExport: vi.fn(async () => [{ id: 'icon1', name: 'Icone', type: 'image/png' }]),
}));

import { ExportImportService } from '../../src/js/import_export/export-import.service.js';

function makeService() {
    return new ExportImportService(/* baseLayerControl */ {}, /* toolManager */ { deactivateCurrentTool: vi.fn() }, /* mapManager */ {}, null);
}

describe('ExportImportService.buildExportDataObject — .ebgeo coverage (P9/P11)', () => {
    it('includes EVERY persisted data type for the map', async () => {
        const data = await makeService().buildExportDataObject(['Mapa A']);

        // Map core
        const m = data.maps['Mapa A'];
        expect(m.baseLayer).toBe('carta-ortoimagem');
        expect(m.zoom).toBe(8);
        expect(m.features.points).toHaveLength(1);
        expect(m.features.polygons).toHaveLength(1);

        // Per-map side data — each of these was, or could become, a silent-drop bug.
        expect(data.layers['Mapa A']).toHaveLength(1);
        expect(data.mapNotes['Mapa A']).toEqual({ title: 'Titulo', description: 'Desc' });
        expect(data.colorUsage['Mapa A']).toEqual({ '#ff0000': 2 });
        expect(data.temporal['Mapa A'].ativo).toBe(true);
        expect(data.gridStyle['Mapa A']).toEqual({ format: 'utm', visible: true });
        expect(data.comments['Mapa A']).toEqual({ c1: { id: 'c1', parentId: null, lng: -43.2, lat: -22.9, text: 'Atenção neste ponto', status: 'open' } });
        expect(data.cesium3d['Mapa A'].markers).toHaveLength(1);
        expect(data.streetview360['Mapa A'].markers).toHaveLength(1);

        // Global
        expect(data.briefings).toHaveLength(1);
        expect(data.customIcons).toHaveLength(1);
        expect(data.mapOrder).toEqual(['Mapa A']);
    });

    it('REGRESSION: exports groups when getMapGroups returns a plain object', async () => {
        // The bug: the export task used a Map-only check (`v?.size` / `Object.fromEntries`) against a
        // plain object, so groups NEVER reached the .ebgeo (local AND remote). Guard it: a non-empty
        // plain object MUST be exported, keyed by group id, matching importGroupsDirectly's contract.
        const data = await makeService().buildExportDataObject(['Mapa A']);
        expect(data.groups['Mapa A']).toEqual({
            g1: { id: 'g1', name: 'Grupo 1', features: [{ type: 'point', id: 'p1' }] },
        });
    });

    it('rounds feature coordinates to 6 decimals (optimizeFeature)', async () => {
        const data = await makeService().buildExportDataObject(['Mapa A']);
        const coords = data.maps['Mapa A'].features.points[0].geometry.coordinates;
        expect(coords).toEqual([-43.212346, -22.912346]);
    });
});

describe('ExportImportService.optimizeMapData / optimizeFeature (pure)', () => {
    it('does not crash on features without geometry/coordinates', () => {
        const svc = makeService();
        const out = svc.optimizeMapData({ baseLayer: 'osm', features: { texts: [{ properties: { id: 't1' } }] } });
        expect(out.baseLayer).toBe('osm');
        expect(out.features.texts[0].properties.id).toBe('t1');
    });
});

describe('ExportImportService._importMappedData — import side of the round-trip', () => {
    // gridStyle, temporal, cesium3d and streetview360 all import back through _importMappedData;
    // this is the read-back half of their .ebgeo round-trip.
    it('applies each per-map value through the setter (with name remap when provided)', async () => {
        const svc = makeService();
        const setter = vi.fn(async () => {});
        await svc._importMappedData(
            { 'Mapa A': { format: 'utm' }, 'Mapa B': { format: 'mgrs' } },
            setter, null, 'grid style',
        );
        expect(setter).toHaveBeenCalledWith('Mapa A', { format: 'utm' });
        expect(setter).toHaveBeenCalledWith('Mapa B', { format: 'mgrs' });

        // name → finalMapName remap (additive import).
        const setter2 = vi.fn(async () => {});
        const mapping = new Map([['Mapa A', { finalMapName: 'Mapa A (2)' }]]);
        await svc._importMappedData({ 'Mapa A': { ativo: true } }, setter2, mapping, 'temporal');
        expect(setter2).toHaveBeenCalledWith('Mapa A (2)', { ativo: true });
    });

    it('is a no-op for undefined / empty / null-valued entries (old .ebgeo without the key)', async () => {
        const svc = makeService();
        const setter = vi.fn();
        await svc._importMappedData(undefined, setter, null, 'x');
        await svc._importMappedData({}, setter, null, 'x');
        await svc._importMappedData({ 'Mapa A': null }, setter, null, 'x');
        expect(setter).not.toHaveBeenCalled();
    });
});
