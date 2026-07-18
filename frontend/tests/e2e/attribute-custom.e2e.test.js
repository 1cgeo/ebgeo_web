// Path: tests/e2e/attribute-custom.e2e.test.js

/**
 * @fileoverview Real-backend E2E for feature custom attributes (§17.11-13 / §18.4).
 *
 * Exercises a feature whose `properties` carry arbitrary, app-defined custom
 * attributes (e.g. `properties.atributos` plus free-form keys), then pushes an
 * `update` that mutates one attribute value and adds a new one. The feature's
 * persisted `properties` are read back from a fresh `pullSync` snapshot to assert
 * the backend applies a whole-`properties` Last-Write-Wins replacement (not a deep
 * field-level merge) — the contract the sync service implements (the `properties`
 * JSONB column is overwritten wholesale on update).
 *
 * Isolation: each run creates its own user / atlas / map in beforeAll. All
 * assertions are made against observable backend state via the snapshot — no DB.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import {
    E2E_SKIP,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * Pulls a fresh snapshot and locates the point feature with the given id.
 * @param {import('../../src/js/store/sync/api-client.js').ApiClient} api
 * @param {string} atlasId
 * @param {string} mapId
 * @param {string} featureId
 * @returns {Promise<Object|undefined>} The GeoJSON Feature, or undefined if absent.
 */
async function readPointFeature(api, atlasId, mapId, featureId) {
    const { snapshot, isSnapshot } = await api.pullSync(atlasId, 0);
    expect(isSnapshot).toBe(true);
    const map = snapshot.maps.find((m) => m.id === mapId);
    expect(map, 'map present in snapshot').toBeTruthy();
    return map.features.points.find((f) => f.properties.id === featureId);
}

describe.skipIf(E2E_SKIP)('feature custom attributes (LWW whole-properties)', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlasId;
    let mapId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Attr Custom Owner' });
        const atlas = await createAtlas(api, { name: 'Attr Custom Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Attr Map' });
    });

    it('create persists arbitrary custom attributes in properties', async () => {
        const featureId = generateUUID();
        const createOp = createOperation('feature', 'create', featureId, mapId, {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
            properties: {
                // feature_type is derived from properties.source by the backend.
                source: 'point',
                layerId: null,
                nome: 'Posto de Comando',
                // The custom-attribute bag the app stores under a namespaced key.
                atributos: { escalao: 'BDA', situacao: 'ativo', efetivo: 120 },
                // A free-form top-level custom key as well.
                observacao: 'inicial',
            },
        });

        const res = await api.pushOperations(atlasId, [createOp]);
        expect(res.results[0].success).toBe(true);

        const feature = await readPointFeature(api, atlasId, mapId, featureId);
        expect(feature, 'created feature is in the snapshot').toBeTruthy();
        expect(feature.type).toBe('Feature');
        // Backend injects source from the feature_type column.
        expect(feature.properties.source).toBe('point');
        // Custom attributes round-trip verbatim.
        expect(feature.properties.atributos).toEqual({
            escalao: 'BDA',
            situacao: 'ativo',
            efetivo: 120,
        });
        expect(feature.properties.observacao).toBe('inicial');
        expect(feature.properties.nome).toBe('Posto de Comando');
    });

    it('update replaces whole properties (LWW): changes one attr, adds another, drops omitted ones', async () => {
        const featureId = generateUUID();
        await api.pushOperations(atlasId, [
            createOperation('feature', 'create', featureId, mapId, {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.18, -22.91] },
                properties: {
                    source: 'point',
                    layerId: null,
                    atributos: { escalao: 'CIA', situacao: 'ativo' },
                    legado: 'should-be-dropped',
                },
            }),
        ]);

        // The update payload carries the FULL desired properties bag (the frontend
        // emits whole-properties on a feature edit). It changes `situacao`, adds
        // `prioridade`, and deliberately omits `legado` to prove the whole-object
        // replacement (LWW) rather than a deep merge.
        const updateOp = createOperation('feature', 'update', featureId, mapId, {
            properties: {
                source: 'point',
                layerId: null,
                atributos: { escalao: 'CIA', situacao: 'recuando', prioridade: 'alta' },
            },
        });
        const updRes = await api.pushOperations(atlasId, [updateOp]);
        expect(updRes.results[0].success).toBe(true);

        const feature = await readPointFeature(api, atlasId, mapId, featureId);
        expect(feature, 'updated feature is in the snapshot').toBeTruthy();

        // Changed value applied.
        expect(feature.properties.atributos.situacao).toBe('recuando');
        // New attribute added.
        expect(feature.properties.atributos.prioridade).toBe('alta');
        // Untouched attribute preserved within the rewritten bag.
        expect(feature.properties.atributos.escalao).toBe('CIA');
        // Negative/edge: a top-level key omitted from the update payload is GONE —
        // the backend overwrites the properties JSONB wholesale (LWW), it does not
        // deep-merge the previous value.
        expect(feature.properties).not.toHaveProperty('legado');

        // Backend-managed fields remain present after the update.
        expect(feature.properties.source).toBe('point');
        expect(typeof feature.properties.version).toBe('number');
        expect(feature.properties.id).toBe(featureId);
    });
});
