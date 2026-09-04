// Path: tests/helpers/fake-geojson-dispatcher.js

/**
 * @fileoverview A `geojson-dispatcher` stand-in for tests that drive a real tool control.
 *
 * WHY IT EXISTS. Every migrated source in this branch is written through
 * `layers/geojson-dispatcher.js`, which coalesces adds into ONE `updateData` and then waits
 * for the map's `sourcedata` settle signal before letting the next batch go, giving up after
 * `SETTLE_TIMEOUT_MS` (2 s). A fake map never sends that signal, so a control test that calls
 * a method with two `flush()` in it stalls for four seconds and dies on the 5 s test timeout.
 * That is the instrument failing, not the code under test.
 *
 * The obvious stand-in, `{ add: () => {}, flush: async () => {} }`, is worse than useless
 * here: it makes the write DISAPPEAR, so a test asserting that the edit reached the main
 * source would pass on a control that writes nothing. This one keeps the assertion honest by
 * applying each `add` straight into the source it owns, through the same `setData` the fake
 * map records, so the collection the test reads back is the collection the control asked for.
 *
 * It is deliberately NOT a model of the real dispatcher: no coalescing, no in-flight
 * serialisation, no error path. `tests/unit/geojson-dispatcher.test.js` owns those.
 *
 * Usage, from inside a `vi.mock` factory (which is hoisted, so it must import, not close
 * over):
 *
 *     vi.mock('@layers/geojson-dispatcher.js', async () => {
 *         const { makeFakeDispatcherModule } = await import('../helpers/fake-geojson-dispatcher.js');
 *         return makeFakeDispatcherModule();
 *     });
 */

/**
 * One dispatcher over one source of one (fake) map.
 *
 * @param {Object} map - Anything with `getSource(id)` returning `{ getData, setData }`
 * @param {string} sourceId - The source this dispatcher owns
 * @returns {Object} The stand-in, with `add`, `remove`, `flush` and `setData`
 */
export function makeFakeDispatcher(map, sourceId) {
    /** @type {Array<Object>} queued operations, applied in order on flush */
    const pending = [];

    return {
        add(featureOrFeatures) {
            for (const feature of [].concat(featureOrFeatures)) {
                pending.push({ op: 'add', feature });
            }
        },

        remove(idOrIds) {
            for (const id of [].concat(idOrIds)) {
                pending.push({ op: 'remove', id });
            }
        },

        patch(id, changes = {}) {
            pending.push({ op: 'patch', id, changes });
        },

        setData(collectionOrFeatures) {
            const features = Array.isArray(collectionOrFeatures)
                ? collectionOrFeatures
                : (collectionOrFeatures?.features ?? []);
            pending.push({ op: 'replaceAll', features });
        },

        isIdle() {
            return pending.length === 0;
        },

        destroy() {
            pending.length = 0;
        },

        async flush() {
            if (pending.length === 0) return;

            const source = map.getSource(sourceId);
            if (!source) {
                pending.length = 0;
                return;
            }

            const current = await source.getData();
            let features = [...(current?.features ?? [])];

            for (const item of pending.splice(0)) {
                if (item.op === 'replaceAll') {
                    features = [...item.features];
                    continue;
                }
                if (item.op === 'remove') {
                    features = features.filter(f => f?.properties?.id !== item.id);
                    continue;
                }
                if (item.op === 'patch') {
                    const { geometry, setProps, unsetProps, clearProps } = item.changes;
                    features = features.map((f) => {
                        if (f?.properties?.id !== item.id) return f;
                        const properties = clearProps ? {} : { ...f.properties, ...(setProps ?? {}) };
                        for (const key of unsetProps ?? []) delete properties[key];
                        if (clearProps) properties.id = f.properties.id;
                        return { ...f, properties, geometry: geometry ?? f.geometry };
                    });
                    continue;
                }
                // `add` is a TOTAL replacement of the entry with that id, which is what the
                // real dispatcher does and what every call site in the controls expects.
                const id = item.feature?.properties?.id;
                const at = features.findIndex(f => f?.properties?.id === id);
                if (at >= 0) features[at] = item.feature;
                else features.push(item.feature);
            }

            source.setData({ type: 'FeatureCollection', features });
        },
    };
}

/**
 * The whole module shape, ready to return from a `vi.mock` factory.
 *
 * A fresh dispatcher per call is correct for these tests: every control method gets one,
 * fills it and flushes it before returning, so nothing outlives the call.
 * @returns {Object} `{ getGeoJsonDispatcher, destroyGeoJsonDispatcher }`
 */
export function makeFakeDispatcherModule() {
    return {
        getGeoJsonDispatcher: (map, sourceId) => makeFakeDispatcher(map, sourceId),
        destroyGeoJsonDispatcher: () => {},
    };
}

export default makeFakeDispatcherModule;
