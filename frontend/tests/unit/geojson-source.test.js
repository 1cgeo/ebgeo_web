import { describe, it, expect, vi } from 'vitest';

import { readGeoJSONSourceData, readGeoJSONSourceDataAsync } from '../../src/js/utilities/geojson-source.js';

// Shape of a MapLibre 5.18 GeoJSONSource that NO dispatcher owns (`*-feedback`,
// `*-edit-handles`, `selection-boxes`, `text-backgrounds`), reduced to what the helper
// touches: `_data` stays `{geojson}`, so `serialize()` returns the collection last given
// to `setData` BY REFERENCE, and `getData()` is the worker round trip that returns a clone.
function makeSource(collection) {
    const src = {
        _data: { geojson: collection },
        serialize() { return { type: 'geojson', data: this._data.geojson }; },
        getData: vi.fn(async function () { return JSON.parse(JSON.stringify(this._data.geojson)); }),
        setData(next) { this._data.geojson = next; },
    };
    return src;
}

// The OTHER kind of source on this branch: one of the sixteen the diff dispatcher owns
// (`layers/geojson-dispatcher.js`), written by `updateData`. The first `updateData` turns
// `_data` into `{updateable: Map}`, and `serialize()` then BUILDS a new collection on every
// call. Copied from the branch the bundle takes (the vendored 5.18 when this was written;
// re-read on 6.7.0 from npm, `src/source/geojson_source.ts`, where it is the same):
//
//   data: this._data.updateable
//     ? {type:"FeatureCollection", features: Array.from(this._data.updateable.values())}
//     : this._data.url || this._data.geojson
//
// `echoWorkerData()` stands for `_updateWorkerData`, which reassigns
// `this._data = {geojson: <what the worker echoed>}` after each round trip: the collection
// is held by reference again, but the features are structured clones, never the objects
// the application passed in.
function makeDispatchedSource(features) {
    return {
        _data: { updateable: new Map(features.map((f) => [f.properties.id, f])) },
        serialize() {
            return {
                type: 'geojson',
                data: this._data.updateable
                    ? { type: 'FeatureCollection', features: Array.from(this._data.updateable.values()) }
                    : this._data.url || this._data.geojson,
            };
        },
        echoWorkerData() {
            const echoed = JSON.parse(JSON.stringify({ type: 'FeatureCollection', features: Array.from(this._data.updateable.values()) }));
            this._data = { geojson: echoed };
        },
        getData: vi.fn(async function () { return JSON.parse(JSON.stringify(this.serialize().data)); }),
        setData: vi.fn(),
    };
}

const fc = (n) => ({ type: 'FeatureCollection', features: Array.from({ length: n }, (_, i) => ({ type: 'Feature', properties: { id: i }, geometry: { type: 'Point', coordinates: [i, 0] } })) });

describe('readGeoJSONSourceData', () => {
    it('returns the held collection by reference, without calling getData', () => {
        // ONLY on a source with no dispatcher: `_data` is `{geojson}`, so `serialize()`
        // hands back the very object the source holds. On a dispatcher-owned source the
        // same call rebuilds the collection, which is the block further down.
        const held = fc(3);
        const src = makeSource(held);
        const data = readGeoJSONSourceData(src);
        expect(data).toBe(held);
        expect(src.getData).not.toHaveBeenCalled();
    });

    it('sees an in-place mutation followed by setData on the next read', () => {
        // Same restriction: mutate-then-setData is valid on a source with no dispatcher,
        // and only there.
        const src = makeSource(fc(2));
        const data = readGeoJSONSourceData(src);
        data.features[0].properties.calculatedSize = 99;
        src.setData(data);
        expect(readGeoJSONSourceData(src).features[0].properties.calculatedSize).toBe(99);
    });

    it('returns an EMPTY collection as-is (the cheap early exit the zoom passes need)', () => {
        const data = readGeoJSONSourceData(makeSource(fc(0)));
        expect(data).not.toBeNull();
        expect(data.features).toHaveLength(0);
    });

    it('returns null for a missing source, a non-GeoJSON source, or url-backed data', () => {
        expect(readGeoJSONSourceData(null)).toBeNull();
        expect(readGeoJSONSourceData({})).toBeNull();
        expect(readGeoJSONSourceData({ serialize: () => ({ type: 'vector', url: 'x' }) })).toBeNull();
        expect(readGeoJSONSourceData({ serialize: () => ({ type: 'geojson', data: 'https://a/b.json' }) })).toBeNull();
        expect(readGeoJSONSourceData({ serialize: () => { throw new Error('boom'); } })).toBeNull();
    });
});

describe('readGeoJSONSourceData on a source the diff dispatcher owns', () => {
    it('reads the features a `{updateable: Map}` source holds', () => {
        const src = makeDispatchedSource(fc(3).features);
        const data = readGeoJSONSourceData(src);
        expect(data.type).toBe('FeatureCollection');
        expect(data.features).toHaveLength(3);
        expect(data.features.map((f) => f.properties.id)).toEqual([0, 1, 2]);
        expect(src.getData).not.toHaveBeenCalled();
    });

    it('builds a NEW collection on every call, so two reads are not the same object', () => {
        const src = makeDispatchedSource(fc(3).features);
        const a = readGeoJSONSourceData(src);
        const b = readGeoJSONSourceData(src);
        expect(a).not.toBe(b);
        expect(a.features).not.toBe(b.features);
        expect(a).toEqual(b);
    });

    it('discards a mutation of what it returned, which is why the write goes through the dispatcher', () => {
        // The worst case the file header warns about: mutating here reaches neither the
        // screen nor the next diff, and nothing throws. `source.setData` would be worse
        // still, since it also drops the dispatcher's pending batch.
        const src = makeDispatchedSource(fc(2).features);
        const data = readGeoJSONSourceData(src);
        data.type = 'MutatedCollection';
        data.features.push({ type: 'Feature', properties: { id: 'ghost' }, geometry: null });

        const again = readGeoJSONSourceData(src);
        expect(again.type).toBe('FeatureCollection');
        expect(again.features).toHaveLength(2);
        expect(again.features.map((f) => f.properties.id)).not.toContain('ghost');
        expect(src.setData).not.toHaveBeenCalled();
    });

    it('hands back clones, not the feature objects the application built, once the worker echoed', () => {
        const original = fc(2).features;
        const src = makeDispatchedSource(original);
        src.echoWorkerData();

        const data = readGeoJSONSourceData(src);
        expect(data.features).toHaveLength(2);
        expect(data.features[0]).not.toBe(original[0]);
        expect(data.features[0]).toEqual(original[0]);
    });
});

describe('readGeoJSONSourceDataAsync', () => {
    it('prefers the synchronous read', async () => {
        const src = makeSource(fc(1));
        const data = await readGeoJSONSourceDataAsync(src);
        expect(data).toBe(src._data.geojson);
        expect(src.getData).not.toHaveBeenCalled();
    });

    it('prefers the synchronous read on a dispatcher-owned source too, rebuilt each time', async () => {
        const src = makeDispatchedSource(fc(2).features);
        const a = await readGeoJSONSourceDataAsync(src);
        const b = await readGeoJSONSourceDataAsync(src);
        expect(a.features).toHaveLength(2);
        expect(a).not.toBe(b);
        expect(src.getData).not.toHaveBeenCalled();
    });

    it('falls back to getData when the synchronous read is not available', async () => {
        const src = { getData: vi.fn(async () => fc(4)) };
        const data = await readGeoJSONSourceDataAsync(src);
        expect(data.features).toHaveLength(4);
        expect(src.getData).toHaveBeenCalledTimes(1);
    });

    it('returns null when there is nothing to read', async () => {
        expect(await readGeoJSONSourceDataAsync(null)).toBeNull();
        expect(await readGeoJSONSourceDataAsync({})).toBeNull();
    });
});
