// Path: js/utilities/geojson-source.js

/**
 * @fileoverview Synchronous read of the collection a MapLibre GeoJSON source holds.
 *
 * `GeoJSONSource.getData()` is a round trip to the worker: a message out, a
 * structured clone of the whole FeatureCollection back. Fifteen zoom handlers
 * used to call it on every frame of a zoom gesture, sixteen round trips per
 * frame, even with nothing drawn. But the main thread never lets go of the object
 * it last passed to `setData`: MapLibre 5.18 keeps it in `_data.geojson` and
 * hands it back through the public `serialize()` (read from the vendored bundle:
 * `serialize(){return {...this._options, type, data: this._data.updateable ? ... :
 * this._data.url || this._data.geojson}}`). Reading it costs nothing and needs no
 * worker.
 *
 * THE OBJECT COMES BACK BY REFERENCE, and that is the contract to respect: it is
 * the very collection the source holds, not a clone. Mutate it only when the
 * mutation is followed by `setData` on the same source, which is exactly what the
 * zoom passes do. A caller that wants a private copy keeps using `getData()`.
 *
 * `updateData()` (diff updates) would turn the source "updateable" and make
 * `serialize()` rebuild a fresh collection on every call; the application never
 * uses it. If it ever does, mutations through this helper stop sticking, and the
 * caller must go back to `getData()` plus `setData()`.
 */

/**
 * The FeatureCollection a GeoJSON source currently holds, read without a worker
 * round trip; null when the source is not a GeoJSON source with inline data.
 *
 * @param {Object} source - MapLibre source (`map.getSource(id)`)
 * @returns {{ type: string, features: Array }|null} The collection, by reference
 */
export function readGeoJSONSourceData(source) {
    if (!source || typeof source.serialize !== 'function') return null;
    let data;
    try {
        data = source.serialize()?.data;
    } catch {
        return null;
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.features)) return null;
    return data;
}

/**
 * Same as `readGeoJSONSourceData`, falling back to the worker round trip when the
 * synchronous read is not available (a source without inline data, or another
 * MapLibre build).
 *
 * @param {Object} source - MapLibre source
 * @returns {Promise<{ type: string, features: Array }|null>}
 */
export async function readGeoJSONSourceDataAsync(source) {
    const data = readGeoJSONSourceData(source);
    if (data) return data;
    if (source && typeof source.getData === 'function') return source.getData();
    return null;
}
