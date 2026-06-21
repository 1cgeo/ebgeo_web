// Path: tests/e2e/snapshot-fidelity.e2e.test.js

/**
 * @fileoverview E2E "snapshot-fidelity" scenario. Builds a populated atlas
 * (1 map + 2 layers + 3 features + 1 group linking 2 features + 1 briefing with
 * 1 slide) entirely through CRDT sync operations, then asserts that a fresh
 * `pullSync(atlasId, 0)` snapshot round-trips every entity with correct counts
 * and key fields. Drives the live backend only through the public ApiClient and
 * `createOperation`; no direct DB access.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * Builds a `group_feature` link op envelope. This entity is backend-only (not a
 * frontend EntityType), so it is hand-built to match what normalizeOperation reads:
 * the association lives in data.{group_id,feature_id}; entity_id is a fresh uuid
 * (the operations log persists entity_id as a UUID).
 * @param {string} groupId
 * @param {string} featureId
 * @returns {Object}
 */
function groupFeatureOp(groupId, featureId) {
    return {
        id: generateUUID(),
        entityType: 'group_feature',
        operationType: 'create',
        entityId: generateUUID(),
        mapId: null,
        data: { group_id: groupId, feature_id: featureId },
        previousData: null,
        timestamp: Date.now(),
        lamportTimestamp: 1,
        clientId: generateUUID(),
    };
}

describe.skipIf(E2E_SKIP)('e2e: snapshot-fidelity', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlasId;
    let mapId;

    // Stable ids so we can assert exact membership in the snapshot.
    const layerAId = generateUUID();
    const layerBId = generateUUID();
    const featurePointId = generateUUID();
    const featureLineId = generateUUID();
    const featurePolyId = generateUUID();
    const groupId = generateUUID();
    const briefingId = generateUUID();
    const slideId = generateUUID();

    let snapshot;
    let snapMap;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Snapshot Fidelity User' });
        const atlas = await createAtlas(api, { name: 'Snapshot Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa Operacional' });

        // Two layers (frontend sends `order`; backend stores sort_order).
        const ops = [
            createOperation('layer', 'create', layerAId, mapId, {
                name: 'Camada A',
                visible: true,
                locked: false,
                opacity: 1,
                order: 0,
                style: { color: '#ff0000' },
            }),
            createOperation('layer', 'create', layerBId, mapId, {
                name: 'Camada B',
                visible: false,
                locked: true,
                opacity: 0.5,
                order: 1,
                style: {},
            }),
            // Three features as raw GeoJSON: type lives in properties.source,
            // layer in properties.layerId (backend derives the flat columns).
            createOperation('feature', 'create', featurePointId, mapId, {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { source: 'point', layerId: layerAId, name: 'Ponto 1' },
            }),
            createOperation('feature', 'create', featureLineId, mapId, {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[-43.2, -22.9], [-43.1, -22.8]] },
                properties: { source: 'line', layerId: layerAId, name: 'Linha 1' },
            }),
            createOperation('feature', 'create', featurePolyId, mapId, {
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [[[-43.2, -22.9], [-43.1, -22.9], [-43.1, -22.8], [-43.2, -22.9]]],
                },
                properties: { source: 'polygon', layerId: layerBId, name: 'Poligono 1' },
            }),
            // Group linking the point + line (NOT the polygon).
            createOperation('group', 'create', groupId, mapId, {
                name: 'Grupo 1',
                visible: true,
                locked: false,
                style: {},
            }),
            // `group_feature` is a backend-only CRDT entity (not a frontend EntityType),
            // so `createOperation` would reject it — hand-build the envelope. The
            // association rides in data.{group_id,feature_id}; entity_id is a fresh uuid.
            groupFeatureOp(groupId, featurePointId),
            groupFeatureOp(groupId, featureLineId),
            // Briefing (atlas-level) with one slide.
            createOperation('briefing', 'create', briefingId, null, {
                name: 'Briefing 1',
                description: 'Briefing de teste',
                slide_order: [slideId],
            }),
            createOperation('slide', 'create', slideId, null, {
                briefing_id: briefingId,
                title: 'Slide 1',
                content: 'Conteudo do slide',
                mode: '2d',
                map_id: mapId,
            }),
        ];

        const res = await api.pushOperations(atlasId, ops);
        expect(res.results.every((r) => r.success)).toBe(true);

        // Fresh full snapshot (version 0 forces a snapshot, not incremental ops).
        const pull = await api.pullSync(atlasId, 0);
        expect(pull.isSnapshot).toBe(true);
        snapshot = pull.snapshot;
        expect(snapshot).toBeTruthy();
        snapMap = snapshot.maps.find((m) => m.id === mapId);
    }, 30000);

    it('round-trips the atlas + map metadata', () => {
        expect(snapshot.atlas.id).toBe(atlasId);
        expect(snapshot.atlas.name).toBe('Snapshot Atlas');
        expect(snapshot.maps).toHaveLength(1);
        expect(snapMap).toBeTruthy();
        expect(snapMap.name).toBe('Mapa Operacional');
        expect(snapshot.currentVersion).toBeGreaterThan(0);
    });

    it('round-trips both layers with order/opacity/visibility preserved', () => {
        expect(snapMap.layers).toHaveLength(2);
        const a = snapMap.layers.find((l) => l.id === layerAId);
        const b = snapMap.layers.find((l) => l.id === layerBId);
        expect(a).toBeTruthy();
        expect(a.name).toBe('Camada A');
        expect(a.visible).toBe(true);
        expect(a.order).toBe(0); // sort_order surfaced as `order`
        expect(b).toBeTruthy();
        expect(b.name).toBe('Camada B');
        expect(b.visible).toBe(false);
        expect(b.locked).toBe(true);
        expect(b.opacity).toBe(0.5);
        expect(b.order).toBe(1);
    });

    it('round-trips all three features into their typed collections', () => {
        expect(snapMap.features.points).toHaveLength(1);
        expect(snapMap.features.lines).toHaveLength(1);
        expect(snapMap.features.polygons).toHaveLength(1);

        const point = snapMap.features.points[0];
        expect(point.type).toBe('Feature');
        expect(point.properties.id).toBe(featurePointId);
        expect(point.properties.source).toBe('point');
        expect(point.geometry.type).toBe('Point');
        expect(point.geometry.coordinates).toEqual([-43.2, -22.9]);
        expect(point.properties.name).toBe('Ponto 1');

        const line = snapMap.features.lines[0];
        expect(line.properties.id).toBe(featureLineId);
        expect(line.geometry.type).toBe('LineString');

        const poly = snapMap.features.polygons[0];
        expect(poly.properties.id).toBe(featurePolyId);
        expect(poly.geometry.type).toBe('Polygon');
    });

    it('round-trips the group linking exactly the point + line (not the polygon)', () => {
        expect(snapMap.groups).toHaveLength(1);
        const group = snapMap.groups[0];
        expect(group.id).toBe(groupId);
        expect(group.name).toBe('Grupo 1');
        expect(group.features).toHaveLength(2);

        const linkedIds = group.features.map((f) => f.id).sort();
        expect(linkedIds).toEqual([featurePointId, featureLineId].sort());
        // Negative assertion: the polygon was never linked to the group.
        expect(group.features.some((f) => f.id === featurePolyId)).toBe(false);
        // Each ref carries the feature's type (resolved from feature_type).
        const pointRef = group.features.find((f) => f.id === featurePointId);
        expect(pointRef.type).toBe('point');
    });

    it('round-trips the briefing with its single ordered slide', () => {
        expect(snapshot.briefings).toHaveLength(1);
        const briefing = snapshot.briefings.find((b) => b.id === briefingId);
        expect(briefing).toBeTruthy();
        expect(briefing.name).toBe('Briefing 1');
        expect(briefing.slides).toHaveLength(1);

        const slide = briefing.slides[0];
        expect(slide.id).toBe(slideId);
        expect(slide.title).toBe('Slide 1');
        expect(slide.content).toBe('Conteudo do slide');
        expect(slide.map_id).toBe(mapId);
        expect(slide.order).toBe(0); // index within slide_order
    });

    it('does not leak entities into a freshly created sibling atlas (isolation)', async () => {
        // Edge/negative: a brand-new atlas owned by the same user must snapshot
        // empty — none of the above entities bleed across atlas boundaries.
        const other = await createAtlas(api, { name: 'Empty Sibling' });
        const pull = await api.pullSync(other.id, 0);
        expect(pull.isSnapshot).toBe(true);
        expect(pull.snapshot.maps).toHaveLength(0);
        expect(pull.snapshot.briefings).toHaveLength(0);
    }, 15000);
});
