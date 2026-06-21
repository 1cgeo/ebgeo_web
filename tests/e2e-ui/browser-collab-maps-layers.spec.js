// Path: e2e-ui/browser-collab-maps-layers.spec.js

/**
 * MAPS + LAYERS + cross-map MOVE synced cross-client — TWO real browsers + real
 * backend. Client A drives the app's OWN store ops (addMap / createLayer / addFeature /
 * moveFeaturesToMap via the store facade) and client B asserts the change propagated,
 * with no workarounds. Structure mirrors browser-collab-feature-mutations.spec.js.
 *
 * Covered, in order:
 *   1. A creates a SECOND map "Mapa Secundário" (addMap)        → B's repo lists it.
 *   2. A creates a LAYER on the shared map (createLayer)        → the layer reaches the
 *      backend (snapshot pulled from B's own authenticated session — see NOTE below).
 *   3. A adds a LINE to the shared map, then MOVES it to the
 *      second map (moveFeaturesToMap)                           → on B the line is gone
 *      from the shared map and present on "Mapa Secundário".
 *
 * APIs (discovered by reading src):
 *   - addMap(mapName, mapData=null, ...)  src/js/store/map.operations.js — emits a
 *     map `create` op (logMapOperation CREATE). Remote map-create persists to the peer
 *     repo (applyRemoteMapOp → repo.saveMap), so B's getAllMaps() lists it.
 *   - createLayer(name='Nova Camada', mapName=null)  src/js/store/layer.operations.js
 *     → layerManager._createLayerInternal emits a layer `create` op (logLayerOperation
 *     CREATE). NOTE: the REMOTE layer-create handler (applyRemoteLayerOp) only EMITS
 *     LAYER_CREATED/LAYERS_CHANGED — it does NOT call repo.saveLayers — and no app
 *     listener persists it, so a remotely-created layer does NOT land in the peer's
 *     LOCAL store. We therefore assert the layer reached the BACKEND snapshot (the
 *     authoritative source, exactly as browser-layer-ops.spec.js does), pulling it from
 *     B's own live ApiClient session. See REPORT note.
 *   - moveFeaturesToMap(features, targetMapName)  src/js/store/feature.operations.js —
 *     `features` is an ARRAY of full feature objects; each must carry
 *     properties.{id,source,layerId} (getFeatureType reads properties.source via
 *     FEATURE_TYPE_MAPPINGS; 'line' → 'lines'). We read A's own stored line back and
 *     pass [thatFeature].
 *
 * The seed/login/open plumbing + poll helpers come from ./helpers/collab-helpers.js.
 *
 * Run headed:  npx playwright test browser-collab-maps-layers --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import {
    seedSharedAtlas,
    openClient,
    readFeatures,
    pollPeerFeature,
    currentMapName,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const SHARED_MAP = 'Mapa Tático';
const SECOND_MAP = 'Mapa Secundário';
const LAYER_NAME = 'Camada Tática';

/** Drives a store op on `page` through the app's REAL store facade. */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

/** Reads the peer's repo-backed map names (repo.getAllMaps → mapData.name). */
function readPeerMapNames(page) {
    return page.evaluate(async () => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const all = await getRepository().getAllMaps();
        const maps = Array.from(all instanceof Map ? all.values() : Object.values(all || {}));
        return maps.map((m) => m && m.name).filter(Boolean);
    });
}

/** Polls until the peer's repo lists a map named `name`. */
async function pollPeerHasMap(page, name, timeout = 20000) {
    await expect
        .poll(async () => (await readPeerMapNames(page)).includes(name), { timeout })
        .toBe(true);
}

/** Reads a specific map's features (by storage type) directly from the peer repo. */
function readPeerMapFeatures(page, mapName, type) {
    return page.evaluate(async ({ mn, t }) => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const mapData = await getRepository().getMap(mn);
        const arr = (mapData && mapData.features && mapData.features[t]) || [];
        return arr.map((x) => x.properties?.id);
    }, { mn: mapName, t: type });
}

/** Polls until the peer repo's `mapName`/`type` features contain `id`. */
async function pollPeerMapHasFeature(page, mapName, type, id, timeout = 20000) {
    await expect
        .poll(async () => (await readPeerMapFeatures(page, mapName, type)).includes(id), { timeout })
        .toBe(true);
}

/**
 * Pulls the backend snapshot from the peer's OWN authenticated session and returns the
 * layers array for the shared map. A fresh ApiClient logged in as B (which holds WRITE
 * on the atlas) proves the layer-create op reached the backend — the authoritative
 * source, since remote layer-create does not land in the peer's local store.
 */
function readBackendMapLayers(page, baseUrl, creds, atlasId, mapName) {
    return page.evaluate(async ({ base, c, id, mn }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const api = new ApiClient({ baseUrl: `${base}/api/v1` });
        await api.login(c.username, c.password);
        const pulled = await api.pullSync(id, 0);
        const maps = pulled.snapshot?.maps || [];
        const map = maps.find((m) => m.name === mn);
        return (map?.layers || []).map((l) => ({ id: l.id, name: l.name }));
    }, { base: baseUrl, c: creds, id: atlasId, mn: mapName });
}

/** Polls the backend snapshot (from B's session) until the shared map has a layer named `name`. */
async function pollBackendMapHasLayer(page, baseUrl, creds, atlasId, mapName, layerName, timeout = 20000) {
    await expect
        .poll(
            async () => (await readBackendMapLayers(page, baseUrl, creds, atlasId, mapName)).some((l) => l.name === layerName),
            { timeout },
        )
        .toBe(true);
}

describeOrSkip('Maps + layers + cross-map move sync cross-client (two real browsers, real store ops)', () => {
    test('create second map → B lists it; create layer → backend has it; move feature between maps → B reflects it', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { mapName: SHARED_MAP });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);

        try {
            // Both open onto the shared atlas map (the app auto-activates it).
            expect(await currentMapName(A)).toBe(SHARED_MAP);
            expect(await currentMapName(B)).toBe(SHARED_MAP);

            // 1. A creates a SECOND map → B's repo eventually lists "Mapa Secundário".
            //    addMap emits a map `create` op; remote map-create persists via repo.saveMap.
            const createdMap = await applyStoreOp(A, 'addMap', [SECOND_MAP]);
            expect(createdMap, 'addMap returned the created map data').toBeTruthy();
            expect(createdMap.name, 'new map keeps the requested name').toBe(SECOND_MAP);
            expect(createdMap.id, 'new map gets a UUID so it can sync').toBeTruthy();
            await pollPeerHasMap(B, SECOND_MAP);

            // 2. A creates a LAYER on the SHARED map → it reaches the backend snapshot.
            //    (Remote layer-create does not land in B's local store — see file header.)
            const createdLayer = await applyStoreOp(A, 'createLayer', [LAYER_NAME, SHARED_MAP]);
            expect(createdLayer, 'createLayer returned the created layer').toBeTruthy();
            await pollBackendMapHasLayer(B, state.baseUrl, seed.userB, seed.atlasId, SHARED_MAP, LAYER_NAME);

            // 3. A adds a LINE to the shared map → B receives it (native feature sync).
            const lineId = crypto.randomUUID();
            const line = {
                type: 'Feature',
                properties: {
                    id: lineId,
                    source: 'line',
                    layerId: 'default',
                    nome: 'Eixo de Progressão',
                    lineColor: '#2f7fd0',
                    lineWidth: 4,
                },
                geometry: {
                    type: 'LineString',
                    coordinates: [[-43.2, -22.9], [-43.1, -22.8]],
                },
            };
            await applyStoreOp(A, 'addFeature', ['lines', line]);
            await pollPeerFeature(B, 'lines', lineId);

            // A reads its OWN stored line back (full cleaned shape with source/layerId)
            // and MOVES it to the second map. moveFeaturesToMap takes an array of feature
            // objects keyed by properties.source.
            const lineOnA = (await readFeatures(A, 'lines')).find((x) => x.id === lineId);
            expect(lineOnA, "A's line is in its own store before the move").toBeTruthy();
            const featureToMove = { type: 'Feature', properties: lineOnA.props, geometry: line.geometry };
            await applyStoreOp(A, 'moveFeaturesToMap', [[featureToMove], SECOND_MAP]);

            // Sanity on A: after the move the line left the shared map and joined the second.
            await expect
                .poll(async () => (await readFeatures(A, 'lines')).some((x) => x.id === lineId), { timeout: 10000 })
                .toBe(false);
            await pollPeerMapHasFeature(A, SECOND_MAP, 'lines', lineId);

            // 3 (assert on B): the line is GONE from the shared map and PRESENT on the second.
            // Read the second map's features directly from B's repo (no current-map switch).
            await pollPeerMapHasFeature(B, SECOND_MAP, 'lines', lineId);
            await expect
                .poll(async () => (await readFeatures(B, 'lines')).some((x) => x.id === lineId), { timeout: 20000 })
                .toBe(false);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});
