import { describe, it, expect } from 'vitest';
import { buildServerImportPayload } from '../../src/js/import_export/local-atlas-to-server.js';
import { generateUUID, isValidUUID } from '../../src/js/utilities/uuid.js';

/** Minimal GeoJSON point feature factory. */
function pointFeature({ id = generateUUID(), source = 'point', layerId, ...extra } = {}) {
    return {
        type: 'Feature',
        id: 1,
        properties: { id, source, ...(layerId ? { layerId } : {}), ...extra },
        geometry: { type: 'Point', coordinates: [0, 0] },
    };
}

describe('buildServerImportPayload', () => {
    it('handles an empty export safely', () => {
        const { payload, imageIds, stats } = buildServerImportPayload({}, { name: 'Vazio' });
        expect(payload.atlas.name).toBe('Vazio');
        expect(payload.maps).toEqual([]);
        expect(payload.briefings).toEqual([]);
        expect(imageIds).toEqual([]);
        expect(stats.maps).toBe(0);
    });

    it('caps the atlas name to 255 chars and defaults description', () => {
        const { payload } = buildServerImportPayload({}, { name: 'x'.repeat(300) });
        expect(payload.atlas.name).toHaveLength(255);
        expect(payload.atlas.description).toBe('');
    });

    it('maps the maps object to an array with fresh UUID ids + name', () => {
        const { payload, mapNameToId } = buildServerImportPayload({
            maps: { 'Mapa A': { baseLayer: 'osm', zoom: 5, center_lat: -22, center_long: -43, features: {} } },
        }, { name: 'A' });
        expect(payload.maps).toHaveLength(1);
        const m = payload.maps[0];
        expect(isValidUUID(m.id)).toBe(true);
        expect(m.id).toBe(mapNameToId['Mapa A']);
        expect(m.name).toBe('Mapa A');
        expect(m.base_layer).toBe('osm');
        expect(m.zoom).toBe(5);
        expect(m.center_lat).toBe(-22);
    });

    it('flattens feature buckets and derives feature_type from properties.source', () => {
        const { payload, stats } = buildServerImportPayload({
            maps: { M: { features: { points: [pointFeature({ source: 'point' })], setores: [pointFeature({ source: 'sector' })] } } },
        }, { name: 'A' });
        const types = payload.maps[0].features.map((f) => f.feature_type).sort();
        expect(types).toEqual(['point', 'sector']);
        expect(stats.features).toBe(2);
    });

    it('falls back to the bucket→source mapping when properties.source is absent', () => {
        const f = pointFeature();
        delete f.properties.source;
        const { payload } = buildServerImportPayload({ maps: { M: { features: { magnetic_declinations: [f] } } } }, { name: 'A' });
        expect(payload.maps[0].features[0].feature_type).toBe('magnetic_declination');
    });

    it('drops features of unsupported buckets (coordenadas) and counts them', () => {
        const { payload, stats } = buildServerImportPayload({
            maps: { M: { features: { coordenadas: [pointFeature({ source: 'coordenada' })], points: [pointFeature()] } } },
        }, { name: 'A' });
        expect(payload.maps[0].features).toHaveLength(1);
        expect(stats.droppedFeatures).toBe(1);
    });

    it("remaps the literal 'default' layer to a per-map UUID and aligns feature.layer_id", () => {
        const { payload } = buildServerImportPayload({
            maps: {
                M: {
                    features: { points: [pointFeature({ layerId: 'default' })] },
                },
            },
            layers: { M: [{ id: 'default', name: 'Padrão', order: 0, visible: true }] },
        }, { name: 'A' });
        const layer = payload.maps[0].layers[0];
        const feature = payload.maps[0].features[0];
        expect(isValidUUID(layer.id)).toBe(true);
        expect(layer.sort_order).toBe(0);
        expect(feature.layer_id).toBe(layer.id);
        expect(feature.properties.layerId).toBe(layer.id);
    });

    it("keeps the SAME map's 'default' stable but distinct across maps", () => {
        const { payload } = buildServerImportPayload({
            maps: {
                A: { features: { points: [pointFeature({ layerId: 'default' })] } },
                B: { features: { points: [pointFeature({ layerId: 'default' })] } },
            },
        }, { name: 'X' });
        const a = payload.maps.find((m) => m.name === 'A').features[0].layer_id;
        const b = payload.maps.find((m) => m.name === 'B').features[0].layer_id;
        expect(isValidUUID(a)).toBe(true);
        expect(isValidUUID(b)).toBe(true);
        expect(a).not.toBe(b);
    });

    it('remaps a non-UUID feature id consistently into groupFeatures', () => {
        const { payload } = buildServerImportPayload({
            maps: { M: { features: { points: [pointFeature({ id: 'legacy-123' })] } } },
            groups: { M: { 'g-uuid': { id: generateUUID(), name: 'G', features: [{ type: 'point', id: 'legacy-123' }] } } },
        }, { name: 'A' });
        const featureId = payload.maps[0].features[0].id;
        const gf = payload.maps[0].groupFeatures[0];
        expect(isValidUUID(featureId)).toBe(true);
        expect(gf.feature_id).toBe(featureId);
        expect(isValidUUID(gf.group_id)).toBe(true);
        expect(payload.maps[0].groups[0].parent_id).toBeNull();
    });

    it('flattens cesium3d into typed rows (camera_position keyed by tilesetId + markers)', () => {
        const { payload } = buildServerImportPayload({
            maps: { M: { features: {} } },
            cesium3d: {
                M: {
                    cameraPositions: { 't1': { id: generateUUID(), tilesetId: 't1' } },
                    markers: [{ id: generateUUID(), tilesetId: 't1' }],
                    measurements: [],
                    viewsheds: [],
                },
            },
        }, { name: 'A' });
        const rows = payload.maps[0].cesium3dData;
        expect(rows.map((r) => r.data_type).sort()).toEqual(['camera_position', 'marker']);
        expect(rows.every((r) => r.tileset_id === 't1')).toBe(true);
    });

    it('flattens streetview360 into typed rows (orientation keyed by photoName + markers)', () => {
        const { payload } = buildServerImportPayload({
            maps: { M: { features: {} } },
            streetview360: {
                M: {
                    orientations: { 'photo-a': { id: generateUUID(), photoName: 'photo-a' } },
                    markers: [{ id: generateUUID(), photoName: 'photo-a' }],
                },
            },
        }, { name: 'A' });
        const rows = payload.maps[0].streetview360Data;
        expect(rows.map((r) => r.data_type).sort()).toEqual(['marker', 'orientation']);
        expect(rows.every((r) => r.photo_name === 'photo-a')).toBe(true);
    });

    it('resolves a briefing slide map reference (by name) to the server map UUID', () => {
        const { payload, mapNameToId } = buildServerImportPayload({
            maps: { 'Mapa A': { features: {} } },
            briefings: [{
                id: generateUUID(), name: 'B', slides: [{ id: generateUUID(), mode: '2d', mapId: 'Mapa A' }],
            }],
        }, { name: 'A' });
        expect(payload.briefings[0].slides[0].map_id).toBe(mapNameToId['Mapa A']);
    });

    it('collects image ids (image features + custom icons) and surfaces settings', () => {
        const imgId = generateUUID();
        const iconId = generateUUID();
        const { payload, imageIds } = buildServerImportPayload({
            maps: { M: { features: { images: [pointFeature({ id: imgId, source: 'image' })] } } },
            colorUsage: { M: { '#ff0000': 3 } },
            customIcons: [{ id: iconId, name: 'icon', type: 'image/png' }],
            mapOrder: ['M'],
        }, { name: 'A' });
        expect(imageIds).toContain(imgId);
        expect(imageIds).toContain(iconId);
        expect(payload.atlas.settings.colorUsage).toEqual({ M: { '#ff0000': 3 } });
        expect(payload.atlas.settings.customIcons).toHaveLength(1);
        expect(payload.atlas.settings.mapOrder).toEqual(['M']);
    });

    it('rewrites an image-feature id (and group refs) to its uploaded server id', () => {
        const localImgId = 'img-local-1';
        const serverImgId = generateUUID();
        const { payload } = buildServerImportPayload({
            maps: { M: { features: { images: [pointFeature({ id: localImgId, source: 'image' })] } } },
            groups: { M: { g: { id: generateUUID(), name: 'G', features: [{ type: 'image', id: localImgId }] } } },
        }, { name: 'A', imageIdMap: { [localImgId]: serverImgId } });
        const feature = payload.maps[0].features[0];
        expect(feature.id).toBe(serverImgId);
        expect(feature.properties.id).toBe(serverImgId); // blob ref must follow
        expect(payload.maps[0].groupFeatures[0].feature_id).toBe(serverImgId);
    });

    it('rewrites a custom-icon markerSymbol and the customIcons registry id', () => {
        const localIcon = 'icon-local';
        const serverIcon = generateUUID();
        const { payload } = buildServerImportPayload({
            maps: { M: { features: { points: [pointFeature({ markerSymbol: `custom:${localIcon}` })] } } },
            customIcons: [{ id: localIcon, name: 'i', type: 'image/png' }],
        }, { name: 'A', imageIdMap: { [localIcon]: serverIcon } });
        expect(payload.maps[0].features[0].properties.markerSymbol).toBe(`custom:${serverIcon}`);
        expect(payload.atlas.settings.customIcons[0].id).toBe(serverIcon);
    });

    it('rewrites 3D/360 item images[] to server ids', () => {
        const localImg = 'cesium-img';
        const serverImg = generateUUID();
        const { payload } = buildServerImportPayload({
            maps: { M: { features: {} } },
            cesium3d: { M: { cameraPositions: {}, markers: [{ id: generateUUID(), images: [localImg] }], measurements: [], viewsheds: [] } },
        }, { name: 'A', imageIdMap: { [localImg]: serverImg } });
        expect(payload.maps[0].cesium3dData[0].data.images).toEqual([serverImg]);
    });

    // ------------------------------------------------------------------------
    // F11 — O DOCUMENTO ANTIGO SUBINDO PARA O SERVIDOR.
    //
    // Esta é a segunda saída de documento INTEIRO (a outra é o `.ebgeo`), e ela é a que menos
    // perdoa: `POST /atlas/import` é uma das três exceções estruturais de escrita por REST, e
    // grava o `catalog_layers` que recebe VERBATIM. Ela não passa pelo gate de escrita do sync,
    // então uma entrada legada que ainda carregasse a cópia plantaria no servidor uma definição
    // obsoleta — e ela ficaria lá até alguém tocar naquela camada.
    //
    // O documento antigo continua existindo em disco, de propósito (a fase decidiu não varrer o
    // IndexedDB), então quem garante é a fronteira. Sem este caso, o único guarda de catálogo
    // deste arquivo seria não haver nenhum.
    // ------------------------------------------------------------------------
    it('F11: sobe REFERÊNCIA e estado por atlas, nunca a definição do catálogo', () => {
        const URL_PRIVADA = 'https://interno.eb.mil.br/tiles/restrito/{z}/{x}/{y}.pbf';
        const { payload } = buildServerImportPayload({
            maps: {
                M: {
                    features: {},
                    catalogLayers: [
                        {
                            id: 'analysis-declividade',
                            type: 'analysis_layer',
                            name: 'Declividade (rótulo de 2025)',
                            visible: false,
                            opacity: 0.7,
                            config: { id: 'declividade', source: { url: URL_PRIVADA } },
                        },
                        {
                            id: 'legado-1',
                            type: 'data_layer',
                            name: 'Molduras',
                            visible: true,
                            config: { id: 'molduras', source: { url: URL_PRIVADA } },
                        },
                    ],
                },
            },
        }, { name: 'A' });

        const subiram = payload.maps[0].catalog_layers;
        expect(subiram).toHaveLength(2);
        for (const camada of subiram) {
            expect(camada.config).toBeUndefined();
            expect(camada.name).toBeUndefined();
        }
        // A referência sobrevive nas duas formas: pelo prefixo do id, e por `originalId` na
        // entrada legada, cuja única referência morava dentro do `config` removido.
        expect(subiram[0].id).toBe('analysis-declividade');
        expect(subiram[0].visible).toBe(false);
        expect(subiram[0].opacity).toBe(0.7);
        expect(subiram[1].originalId).toBe('molduras');

        expect(JSON.stringify(payload)).not.toContain(URL_PRIVADA);
    });

    it('F11: mapa sem camada de catálogo sobe um array vazio, como sempre subiu', () => {
        // O par: a poda recebe `undefined` do documento que nunca teve catálogo, e o contrato
        // da rota de import é um array. Devolver `undefined` aqui viraria `23502` no servidor.
        const { payload } = buildServerImportPayload({ maps: { M: { features: {} } } }, { name: 'A' });
        expect(payload.maps[0].catalog_layers).toEqual([]);
    });
});
