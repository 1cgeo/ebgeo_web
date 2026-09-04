import { describe, it, expect, vi } from 'vitest';

import { readGeoJSONSourceData, readGeoJSONSourceDataAsync } from '../../src/js/utilities/geojson-source.js';

// Shape of a MapLibre 5.18 GeoJSONSource, reduced to what the helper touches:
// `serialize()` returns the collection last given to `setData` BY REFERENCE, and
// `getData()` is the worker round trip that returns a clone.
function makeSource(collection) {
    const src = {
        _data: { geojson: collection },
        serialize() { return { type: 'geojson', data: this._data.geojson }; },
        getData: vi.fn(async function () { return JSON.parse(JSON.stringify(this._data.geojson)); }),
        setData(next) { this._data.geojson = next; },
    };
    return src;
}

const fc = (n) => ({ type: 'FeatureCollection', features: Array.from({ length: n }, (_, i) => ({ type: 'Feature', properties: { id: i }, geometry: { type: 'Point', coordinates: [i, 0] } })) });

describe('readGeoJSONSourceData', () => {
    it('returns the held collection by reference, without calling getData', () => {
        const held = fc(3);
        const src = makeSource(held);
        const data = readGeoJSONSourceData(src);
        expect(data).toBe(held);
        expect(src.getData).not.toHaveBeenCalled();
    });

    it('sees an in-place mutation followed by setData on the next read', () => {
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

describe('readGeoJSONSourceDataAsync', () => {
    it('prefers the synchronous read', async () => {
        const src = makeSource(fc(1));
        const data = await readGeoJSONSourceDataAsync(src);
        expect(data).toBe(src._data.geojson);
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
