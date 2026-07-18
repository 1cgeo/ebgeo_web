// Path: tests/e2e/base-layer-grid.e2e.test.js

/**
 * @fileoverview Real-backend E2E for §13/§26 map sub-field updates: `baseLayer`
 * and `gridStyle`. Drives the frontend sync transport against the spawned
 * ebgeo_backend over real HTTP, pushing CRDT update operations and asserting the
 * observable server state via the pull-sync snapshot.
 *
 * Coverage:
 *  - `baseLayer` update -> snapshot map.base_layer === 'carta-ortoimagem'.
 *  - `gridStyle` update -> snapshot map.grid_style === { format: 'utm', visible: true }.
 *  - Edge: a `gridStyle` op may ONLY touch its own column — a sensitive sibling
 *    (base_layer) smuggled in the payload must NOT overwrite the base layer.
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

describe.skipIf(E2E_SKIP)('E2E §13/§26 baseLayer + gridStyle map updates', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    /** @type {string} */
    let atlasId;
    /** @type {string} */
    let mapId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'BaseLayer Grid E2E' });
        const atlas = await createAtlas(api, { name: 'BaseLayer Grid Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Grid Map' });
    });

    /**
     * Pulls a fresh full snapshot and returns the row for the test's map.
     * @returns {Promise<Object>} The snapshot map row (raw backend fields).
     */
    async function pullMap() {
        const res = await api.pullSync(atlasId, 0);
        expect(res.isSnapshot).toBe(true);
        const map = res.snapshot.maps.find((m) => m.id === mapId);
        expect(map, 'created map present in snapshot').toBeTruthy();
        return map;
    }

    it('defaults the base layer at creation (carta-topografica)', async () => {
        const map = await pullMap();
        // Sanity baseline so the later mutation is provably observable.
        expect(map.base_layer).toBe('carta-topografica');
    });

    it('applies a baseLayer update -> map.base_layer === carta-ortoimagem', async () => {
        const op = createOperation('baseLayer', 'update', mapId, mapId, {
            baseLayer: 'carta-ortoimagem',
        });
        await api.pushOperations(atlasId, [op]);

        const map = await pullMap();
        expect(map.base_layer).toBe('carta-ortoimagem');
    });

    it('applies a gridStyle update -> map.grid_style === { format: utm, visible: true }', async () => {
        const op = createOperation('gridStyle', 'update', mapId, mapId, {
            format: 'utm',
            visible: true,
        });
        await api.pushOperations(atlasId, [op]);

        const map = await pullMap();
        expect(map.grid_style).toEqual({ format: 'utm', visible: true });
        // The grid update must not have disturbed the previously-set base layer.
        expect(map.base_layer).toBe('carta-ortoimagem');
    });

    it('edge: a gridStyle op cannot smuggle a base_layer overwrite (column whitelist)', async () => {
        // The server confines a sub-typed map update to its own column(s). A
        // base_layer riding alongside the grid payload must be ignored.
        const op = createOperation('gridStyle', 'update', mapId, mapId, {
            format: 'mgrs',
            visible: false,
            base_layer: 'carta-topografica',
        });
        await api.pushOperations(atlasId, [op]);

        const map = await pullMap();
        // Grid fields applied...
        expect(map.grid_style).toEqual({ format: 'mgrs', visible: false });
        // ...but the smuggled base_layer was rejected: it stays carta-ortoimagem.
        expect(map.base_layer).toBe('carta-ortoimagem');
    });
});
