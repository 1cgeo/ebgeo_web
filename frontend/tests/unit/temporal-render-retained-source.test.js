import { describe, it, expect, beforeEach } from 'vitest';
import {
    updateTrajectoryPositions,
    resetTrajectoryCache,
    updateSourceFeatureProperty,
} from '../../src/js/temporal/temporal-render.service.js';

/**
 * The playback frame retains the FeatureCollection it read from the source instead
 * of paying a getData() worker round-trip per frame. These tests pin the part that
 * makes the cache safe rather than fast: that it is DROPPED the moment someone else
 * writes to the source. A retained copy that survived a foreign write would push
 * pre-edit coordinates back and silently revert the other writer's change.
 */

const T0 = 1_700_000_000_000;

/** Two-keypoint trajectory from lng `a` to lng `b` over one second. */
function traj(a, b) {
    return [
        { t: T0, lng: a, lat: 0 },
        { t: T0 + 1000, lng: b, lat: 0 },
    ];
}

function movingFeature(id, from, to, coords = [from, 0]) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [...coords] },
        properties: { id, trajetoria: traj(from, to) },
    };
}

function staticFeature(id, coords) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [...coords] },
        properties: { id },
    };
}

function collection(...features) {
    return { type: 'FeatureCollection', features };
}

/**
 * Fake GeoJSONSource: `_data.geojson` is the identity token MapLibre keeps for the
 * last object handed to setData, and `_worker` stands for what the worker holds
 * (getData returns a clone of it, as the real round-trip does).
 *
 * `updateData` mirrors two behaviours measured on the vendored MapLibre 5.18 bundle:
 * an update entry merges properties into the feature carrying that promoted key, and
 * `_data` is swapped for the internal updateable map, so the identity token above
 * disappears until the next whole-collection setData restores it.
 */
function makeSource(data, { emit } = {}) {
    return {
        _data: { geojson: data },
        _worker: data,
        getDataCalls: 0,
        setDataCalls: 0,
        updateDataCalls: 0,
        async getData() {
            this.getDataCalls++;
            return structuredClone(this._worker);
        },
        setData(obj) {
            this.setDataCalls++;
            this._data = { geojson: obj };
            this._worker = obj;
            emit?.();
        },
        updateData(diff) {
            this.updateDataCalls++;
            const features = this._worker.features.slice();
            for (const patch of diff.update || []) {
                const i = features.findIndex((f) => f.properties?.id === patch.id);
                if (i === -1) continue;
                const properties = { ...features[i].properties };
                for (const { key, value } of patch.addOrUpdateProperties || []) properties[key] = value;
                features[i] = { ...features[i], properties };
            }
            this._data = { updateable: new Map() };
            this._worker = { type: 'FeatureCollection', features };
            emit?.();
        },
        /** Another module (a draw tool, the attribute table) replacing the collection. */
        foreignWrite(obj) {
            this._data = { geojson: obj };
            this._worker = obj;
        },
    };
}

/**
 * Fake map with the listener pair the dispatcher needs to know a write settled.
 * `makeSource` is handed an emitter so a write reports back synchronously, which is
 * what keeps these tests off the dispatcher's settle timeout.
 */
function makeMap(sources) {
    const listeners = new Map();
    return {
        getSource: (id) => sources[id] || null,
        on(type, fn) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(fn);
        },
        off(type, fn) {
            listeners.get(type)?.delete(fn);
        },
        emit(type, event) {
            for (const fn of [...(listeners.get(type) || [])]) fn(event);
        },
    };
}

/** A source plus the map that owns it, wired so writes emit the settle signal. */
function makeMapWithSource(sourceId, data) {
    const sources = {};
    const map = makeMap(sources);
    const source = makeSource(data, {
        emit: () => map.emit('sourcedata', { sourceId, sourceDataType: 'content' }),
    });
    sources[sourceId] = source;
    return { map, source };
}

/** Longitude the map currently shows for a feature. */
function lngOf(source, id) {
    return source._worker.features.find((f) => f.properties.id === id)?.geometry.coordinates[0];
}

describe('updateTrajectoryPositions — retained source data', () => {
    beforeEach(() => {
        resetTrajectoryCache();
    });

    it('reads the collection once and reuses it across frames', async () => {
        const source = makeSource(collection(movingFeature('a', 0, 1)));
        const map = makeMap({ points: source });

        await updateTrajectoryPositions(map, T0);
        expect(source.getDataCalls).toBe(1);

        await updateTrajectoryPositions(map, T0 + 500);
        await updateTrajectoryPositions(map, T0 + 750);

        expect(source.getDataCalls).toBe(1);
        expect(lngOf(source, 'a')).toBeCloseTo(0.75, 10);
    });

    it('re-reads after a foreign write, so an edited trajectory takes effect', async () => {
        const source = makeSource(collection(movingFeature('a', 0, 1)));
        const map = makeMap({ points: source });

        await updateTrajectoryPositions(map, T0 + 500);
        expect(lngOf(source, 'a')).toBeCloseTo(0.5, 10);

        // The trajectory is re-authored (0 → 10) and an unrelated feature is added,
        // both through a write this module did not make.
        source.foreignWrite(collection(movingFeature('a', 0, 10), staticFeature('novo', [7, 7])));

        await updateTrajectoryPositions(map, T0 + 500);

        expect(lngOf(source, 'a')).toBeCloseTo(5, 10); // the NEW trajectory, not the old one
        expect(lngOf(source, 'novo')).toBe(7);         // the foreign write survived
        expect(source.getDataCalls).toBe(2);
    });

    it('re-reads after resetTrajectoryCache', async () => {
        const source = makeSource(collection(movingFeature('a', 0, 1)));
        const map = makeMap({ points: source });

        await updateTrajectoryPositions(map, T0 + 500);
        expect(source.getDataCalls).toBe(1);

        resetTrajectoryCache();
        await updateTrajectoryPositions(map, T0 + 500);

        expect(source.getDataCalls).toBe(2);
    });

    it('re-reads after updateSourceFeatureProperty rewrites the trajectory', async () => {
        const { map, source } = makeMapWithSource('points', collection(movingFeature('a', 0, 1)));

        await updateTrajectoryPositions(map, T0 + 500);
        expect(lngOf(source, 'a')).toBeCloseTo(0.5, 10);

        await updateSourceFeatureProperty(map, 'points', 'a', 'trajetoria', traj(0, 4));
        await updateTrajectoryPositions(map, T0 + 500);

        expect(lngOf(source, 'a')).toBeCloseTo(2, 10);
    });

    it('updateSourceFeatureProperty ships a diff and never reads the collection', async () => {
        const { map, source } = makeMapWithSource(
            'points',
            collection(movingFeature('a', 0, 1), staticFeature('outro', [5, 5])),
        );
        const readsBefore = source.getDataCalls;

        await updateSourceFeatureProperty(map, 'points', 'a', 'trajetoria', traj(0, 4));

        // One diff, no read-modify-write of the whole collection: this is the O(N) travel
        // the migration exists to remove, so a regression to the old shape shows up here.
        expect(source.updateDataCalls).toBe(1);
        expect(source.setDataCalls).toBe(0);
        expect(source.getDataCalls).toBe(readsBefore);
        // The patched feature carries the new value and the untouched one is intact.
        expect(source._worker.features[0].properties.trajetoria).toEqual(traj(0, 4));
        expect(source._worker.features[1].geometry.coordinates).toEqual([5, 5]);
    });

    it('updateSourceFeatureProperty on an unknown id changes nothing', async () => {
        const { map, source } = makeMapWithSource('points', collection(staticFeature('parado', [3, 4])));

        await updateSourceFeatureProperty(map, 'points', 'inexistente', 'trajetoria', traj(0, 4));

        // MapLibre no-ops an update on an absent key, which is what the old early return did.
        expect(source._worker.features).toHaveLength(1);
        expect(source._worker.features[0].properties.trajetoria).toBeUndefined();
    });

    it('updateSourceFeatureProperty ignores a null feature id', async () => {
        const { map, source } = makeMapWithSource('points', collection(staticFeature('parado', [3, 4])));

        await updateSourceFeatureProperty(map, 'points', null, 'trajetoria', traj(0, 4));

        // A keyless patch would make the dispatcher fall back to rewriting the collection.
        expect(source.updateDataCalls).toBe(0);
        expect(source.setDataCalls).toBe(0);
    });

    it('re-reads every frame when the source exposes no identity token', async () => {
        // Fail-safe path: if MapLibre stops exposing the object, the token reads
        // undefined and the cache degrades to the pre-cache behaviour, never to a
        // stale frame.
        const source = makeSource(collection(movingFeature('a', 0, 1)));
        delete source._data;
        source.setData = function setData(obj) {
            this.setDataCalls++;
            this._worker = obj;
        };
        const map = makeMap({ points: source });

        await updateTrajectoryPositions(map, T0 + 250);
        await updateTrajectoryPositions(map, T0 + 500);

        expect(source.getDataCalls).toBe(2);
        expect(lngOf(source, 'a')).toBeCloseTo(0.5, 10);
    });

    it('leaves features without a trajectory alone and writes nothing when nothing moved', async () => {
        const source = makeSource(collection(staticFeature('parado', [3, 4])));
        const map = makeMap({ points: source });

        await updateTrajectoryPositions(map, T0 + 500);
        await updateTrajectoryPositions(map, T0 + 900);

        expect(source.setDataCalls).toBe(0);
        expect(source._worker.features[0].geometry.coordinates).toEqual([3, 4]);
        expect(source._worker.features[0].properties._temporalHome).toBeUndefined();
    });

    it('ignores a single-keypoint trajectory (not usable) but still moves a usable one', async () => {
        const source = makeSource(collection(
            { type: 'Feature', geometry: { type: 'Point', coordinates: [9, 9] }, properties: { id: 'curta', trajetoria: [{ t: T0, lng: 0, lat: 0 }] } },
            movingFeature('a', 0, 1),
        ));
        const map = makeMap({ points: source });

        await updateTrajectoryPositions(map, T0 + 500);

        expect(lngOf(source, 'curta')).toBe(9);
        expect(lngOf(source, 'a')).toBeCloseTo(0.5, 10);
    });

    it('snaps back to the stashed home and drops the stash when the cursor is null', async () => {
        const source = makeSource(collection(movingFeature('a', 0, 1, [42, 7])));
        const map = makeMap({ points: source });

        await updateTrajectoryPositions(map, T0 + 500);
        expect(lngOf(source, 'a')).toBeCloseTo(0.5, 10);

        await updateTrajectoryPositions(map, null);

        expect(source._worker.features[0].geometry.coordinates).toEqual([42, 7]);
        expect(source._worker.features[0].properties._temporalHome).toBeUndefined();
    });

    it('survives a source whose getData rejects', async () => {
        const source = makeSource(collection(movingFeature('a', 0, 1)));
        source.getData = async () => { throw new Error('worker gone'); };
        const map = makeMap({ points: source });

        await expect(updateTrajectoryPositions(map, T0 + 500)).resolves.toBeUndefined();
    });
});
