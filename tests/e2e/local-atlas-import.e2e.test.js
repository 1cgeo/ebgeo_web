// Path: tests/e2e/local-atlas-import.e2e.test.js

/**
 * @fileoverview Real-backend E2E for item 2 ("Salvar atlas local no servidor"): drives the
 * `buildServerImportPayload` transform output through the live `POST /atlas/import` and asserts
 * the bulk-imported atlas round-trips in the pull-sync snapshot — proving the transform output
 * is accepted by the backend Joi `importSchema` AND persisted/reshaped correctly.
 *
 * Uses the BUILT payload as the source of truth for the (transform-assigned) UUIDs, so the
 * assertions follow whatever ids the transform minted (e.g. the per-map 'default' layer UUID).
 */

import { describe, it, beforeAll, expect } from 'vitest';
import { E2E_SKIP, makeApi, registerAndLogin } from './helpers/harness.js';
import { buildServerImportPayload } from '../../src/js/import_export/local-atlas-to-server.js';
import { generateUUID, isValidUUID } from '../../src/js/utilities/uuid.js';

describe.skipIf(E2E_SKIP)('E2E local atlas → server import (item 2 transform)', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let snapshot;
    /** @type {Object} the built server payload (id source-of-truth). */
    let payload;
    let serverMap;
    const pointId = generateUUID();
    const sectorId = generateUUID();

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Import E2E' });

        const exportData = {
            maps: {
                'Mapa A': {
                    baseLayer: 'carta-ortoimagem', zoom: 8, center_lat: -22.9, center_long: -43.2, bearing: 0, pitch: 0,
                    analysisLayers: {}, catalogLayers: [],
                    features: {
                        points: [{
                            type: 'Feature', id: 1,
                            properties: { id: pointId, source: 'point', layerId: 'default', nome: 'P1' },
                            geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                        }],
                        setores: [{
                            type: 'Feature', id: 2,
                            properties: { id: sectorId, source: 'sector', layerId: 'default' },
                            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
                        }],
                        // Unsupported bucket — must be dropped by the transform.
                        coordenadas: [{
                            type: 'Feature', id: 3,
                            properties: { id: generateUUID(), source: 'coordenada' },
                            geometry: { type: 'Point', coordinates: [0, 0] },
                        }],
                    },
                },
            },
            layers: { 'Mapa A': [{ id: 'default', name: 'Padrão', order: 0, visible: true, locked: false, opacity: 1 }] },
            groups: { 'Mapa A': { g1: { id: generateUUID(), name: 'G1', features: [{ type: 'point', id: pointId }] } } },
            temporal: { 'Mapa A': { ativo: true, modo: 'absoluto', unidade: 'h', inicio: 0, fim: 1000, origem: 0 } },
            gridStyle: { 'Mapa A': { format: 'utm', visible: true } },
            mapNotes: { 'Mapa A': { title: 'T', description: 'D' } },
            cesium3d: {
                'Mapa A': {
                    cameraPositions: { t1: { id: generateUUID(), tilesetId: 't1' } },
                    markers: [{ id: generateUUID(), tilesetId: 't1' }], measurements: [], viewsheds: [],
                },
            },
            streetview360: { 'Mapa A': { orientations: { 'photo-a': { id: generateUUID(), photoName: 'photo-a' } }, markers: [] } },
            briefings: [{ id: generateUUID(), name: 'Brief', slides: [{ id: generateUUID(), mode: '2d', mapId: 'Mapa A', title: 'S1' }] }],
            mapOrder: ['Mapa A'],
        };

        const built = buildServerImportPayload(exportData, { name: 'Atlas Importado', description: 'via item 2' });
        expect(built.stats.droppedFeatures).toBe(1); // the coordenada feature
        payload = built.payload;
        serverMap = payload.maps[0];

        const atlas = await api.importAtlas(payload);
        expect(atlas.id).toBeTruthy();
        const res = await api.pullSync(atlas.id, 0);
        expect(res.isSnapshot).toBe(true);
        snapshot = res.snapshot;
    }, 30000);

    it('creates the atlas with name + atlas-level settings (mapOrder)', () => {
        expect(snapshot.atlas.name).toBe('Atlas Importado');
        expect(snapshot.atlas.settings.mapOrder).toEqual(['Mapa A']);
    });

    it('imports the map metadata (base layer, position, notes, grid, temporal)', () => {
        const m = snapshot.maps.find((x) => x.id === serverMap.id);
        expect(m).toBeTruthy();
        expect(m.name).toBe('Mapa A');
        expect(m.base_layer).toBe('carta-ortoimagem');
        expect(m.grid_style).toEqual({ format: 'utm', visible: true });
        expect(m.temporal_config.ativo).toBe(true);
        expect(m.notes_title).toBe('T');
        expect(m.zoom).toBe(8);
    });

    it('imports the supported features into their typed collections (coordenada dropped)', () => {
        const m = snapshot.maps.find((x) => x.id === serverMap.id);
        expect(m.features.points).toHaveLength(1);
        expect(m.features.points[0].properties.id).toBe(pointId);
        expect(m.features.setores).toHaveLength(1);
        expect(m.features.setores[0].properties.id).toBe(sectorId);
        // The dropped coordenada must not appear anywhere.
        const all = Object.values(m.features).flat();
        expect(all.some((f) => f.properties.source === 'coordenada')).toBe(false);
    });

    it("imports the layer with 'default' remapped to a UUID, and binds the feature to it", () => {
        const m = snapshot.maps.find((x) => x.id === serverMap.id);
        const layer = m.layers.find((l) => l.id === serverMap.layers[0].id);
        expect(layer).toBeTruthy();
        expect(isValidUUID(layer.id)).toBe(true);
        expect(layer.id).not.toBe('default');
        expect(m.features.points[0].properties.layerId).toBe(layer.id);
    });

    it('imports the group + its membership of the point', () => {
        const m = snapshot.maps.find((x) => x.id === serverMap.id);
        expect(m.groups).toHaveLength(1);
        expect(m.groups[0].id).toBe(serverMap.groups[0].id);
        expect(m.groups[0].features.map((f) => f.id)).toContain(pointId);
    });

    it('imports the briefing with a slide bound to the server map id', () => {
        expect(snapshot.briefings).toHaveLength(1);
        const slide = snapshot.briefings[0].slides[0];
        expect(slide.title).toBe('S1');
        expect(slide.map_id).toBe(serverMap.id);
    });
});
