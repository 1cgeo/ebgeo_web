// Path: js/utilities/geojson-source.js

/**
 * @fileoverview Synchronous read of the collection a MapLibre GeoJSON source holds.
 *
 * `GeoJSONSource.getData()` is a round trip to the worker: a message out, a structured
 * clone of the whole FeatureCollection back. The zoom passes used to call it on every
 * frame of a zoom gesture, once per tool, even with nothing drawn. The main thread never
 * needs that trip: it already holds the collection, and the public `serialize()` hands it
 * back. Read from the MapLibre source the app ships, verbatim. First measured on the
 * vendored 5.18 bundle; RE-READ on 6.7.0 after the move to npm
 * (`node_modules/maplibre-gl/src/source/geojson_source.ts`, `serialize()`), where the
 * branch is IDENTICAL: `_data` is still the three-shape envelope
 * (`{url} | {geojson} | {updateable: Map}`) and `serialize()` still rebuilds the
 * collection from the Map. The minified 5.18 form is kept below because it is the
 * one this module was written against:
 *
 *   serialize(){return t.e({},this._options,{type:this.type,
 *     data:this._data.updateable
 *       ? {type:"FeatureCollection",features:Array.from(this._data.updateable.values())}
 *       : this._data.url||this._data.geojson})}
 *
 * THE CONTRACT IS NOT THE SAME ON BOTH KINDS OF SOURCE IN THIS BRANCH, and getting that
 * backwards corrupts data in silence:
 *
 * - On a source NOT owned by the diff dispatcher (`*-feedback`, `*-edit-handles`,
 *   `selection-boxes`, `text-backgrounds`), `_data` stays `{geojson}` and the object comes
 *   back BY REFERENCE: it is the very collection the source holds. Mutating it and calling
 *   `setData` on the same source is valid there, and that is the only place it is.
 *
 * - On one of the sixteen sources the dispatcher owns (`layers/geojson-dispatcher.js`),
 *   the first `updateData` turns `_data` into `{updateable: Map}`, and from then on
 *   `serialize()` BUILDS A NEW collection on every call. Worse, `_updateWorkerData`
 *   reassigns `this._data = {geojson: <what the worker echoed>}` after each round trip, so
 *   the feature objects are not the ones the application passed in either. A mutation
 *   applied here reaches neither the screen nor the next diff: it is discarded without an
 *   error. On those sources this helper is a READ, and the write goes through the
 *   dispatcher (`patch`/`add`/`setData` plus `flush`), never through `source.setData`,
 *   which would also discard the dispatcher's pending batch.
 *
 * What holds on BOTH is the only property the zoom passes need: the read is synchronous
 * and costs no worker traffic.
 */

/**
 * The FeatureCollection a GeoJSON source currently holds, read without a worker round
 * trip; null when the source is not a GeoJSON source with inline data.
 *
 * By reference on a source with no dispatcher, rebuilt on one the dispatcher owns: see
 * the file header before mutating anything that comes out of here.
 *
 * @param {Object} source - MapLibre source (`map.getSource(id)`)
 * @returns {{ type: string, features: Array }|null} The collection
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
 * synchronous read is not available (a source declared by url, or another MapLibre build).
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
