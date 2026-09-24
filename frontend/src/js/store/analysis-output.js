// Path: js/store/analysis-output.js

/**
 * @fileoverview The OUTPUT of the two terrain analyses (line of sight and viewshed), derived
 * from the INPUT feature by a pure function, and the only place that derivation lives.
 *
 * WHY IT IS DERIVED AND NOT SYNCED (decision of 2026-09-23). The input (`los`, `visibility`) is
 * what the operator draws and what the server stores; the output (`processed_*`) is the green and
 * red drawing that is actually VISIBLE, because the input layers are painted with zero opacity
 * (`layers/styles/tactical.layers.js`). The output's id is `<inputId>-visible` /
 * `<inputId>-obstructed`, which is not a UUID, and the server refuses it. Measured in two browsers
 * on an atlas of the server: the author kept two refusals forever and lost the drawing on F5, and
 * the peer never saw the analysis at all. Nothing is lost by deriving: the line of sight keeps
 * both halves in its own `MultiLineString`, and the viewshed keeps the verdict of every cell in
 * `properties.cellData`.
 *
 * ONE FUNCTION, TWO CALLERS, AND THAT IS THE POINT. The tools (`add_los_geometry.js`,
 * `add_visibility_geometry.js`) produce the author's output through `deriveAnalysisOutput`, and
 * the inbound path and the snapshot (`store/sync/remote-operation-handler.js`) produce the peer's
 * through the same call. Two copies of the split would drift, and the drift would read as "the
 * peer sees a different analysis". `frontend/tests/unit/saida-de-analise-derivada.test.js` runs
 * both on one corpus.
 *
 * Imports only the type registry, which has zero imports: this module loads in plain node.
 */

import { DERIVED_OUTPUT_BUCKET_OF } from './feature-type.registry.js';

/** Colors of the two halves of an analysis output. */
export const ANALYSIS_OUTPUT_COLORS = Object.freeze({ visible: '#00FF00', obstructed: '#FF0000' });

/** The output buckets, as a set, for membership checks. */
const OUTPUT_BUCKETS = new Set(Object.values(DERIVED_OUTPUT_BUCKET_OF));

/**
 * The output bucket derived from an input bucket, or null when the bucket is not an input.
 * @param {string} inputBucket - Store bucket of the input feature
 * @returns {string|null}
 */
export function derivedOutputBucketOf(inputBucket) {
    return Object.hasOwn(DERIVED_OUTPUT_BUCKET_OF, inputBucket) ? DERIVED_OUTPUT_BUCKET_OF[inputBucket] : null;
}

/**
 * True when the bucket holds a derived analysis output, whose writes never travel.
 * @param {string} bucket - Store bucket
 * @returns {boolean}
 */
export function isDerivedOutputBucket(bucket) {
    return OUTPUT_BUCKETS.has(bucket);
}

/**
 * The ids an input feature's output may carry.
 * @param {string} inputId - Id of the input feature
 * @returns {string[]}
 */
export function derivedOutputIdsOf(inputId) {
    return [`${inputId}-visible`, `${inputId}-obstructed`];
}

/**
 * @private One half of an output.
 * @param {string} id
 * @param {Object} properties - Properties shared by both halves
 * @param {string} color
 * @param {Object} geometry
 * @returns {Object} GeoJSON feature
 */
function half(id, properties, color, geometry) {
    return { type: 'Feature', id, properties: { ...properties, id, color }, geometry };
}

/**
 * @private The line of sight: a `MultiLineString` is already split at the obstruction (visible
 * part first); any other geometry is a clear line, visible end to end.
 */
function deriveLineOfSight(mainFeature, colors) {
    const properties = mainFeature.properties;
    const [visibleId, obstructedId] = derivedOutputIdsOf(properties.id);
    const geometry = mainFeature.geometry;
    if (geometry.type === 'MultiLineString') {
        return [
            half(visibleId, properties, colors.visible, { type: 'LineString', coordinates: geometry.coordinates[0] }),
            half(obstructedId, properties, colors.obstructed, { type: 'LineString', coordinates: geometry.coordinates[1] }),
        ];
    }
    return [half(visibleId, properties, colors.visible, geometry)];
}

/**
 * @private The viewshed: every polygon of the `MultiPolygon` is one cell, and `cellData` at the
 * same index says whether it is visible. `cellData` indexes the INPUT's polygons and means nothing
 * on a half, so it is left out of both.
 */
function deriveViewshed(mainFeature, colors) {
    const properties = mainFeature.properties;
    // A verdict list that does not cover every cell is not an analysis this function can draw
    // honestly. The tool used to THROW here, which on the inbound path would have failed the whole
    // remote apply of a peer's viewshed; an empty output is the answer that keeps the input intact.
    if (mainFeature.geometry.type !== 'MultiPolygon' || !Array.isArray(properties.cellData)
        || properties.cellData.length < mainFeature.geometry.coordinates.length) return [];
    const visibleCoords = [];
    const obstructedCoords = [];
    mainFeature.geometry.coordinates.forEach((polygonCoords, index) => {
        if (properties.cellData[index]?.isVisible) visibleCoords.push(polygonCoords);
        else obstructedCoords.push(polygonCoords);
    });
    const { cellData: _cellData, ...shared } = properties;
    const [visibleId, obstructedId] = derivedOutputIdsOf(properties.id);
    const out = [];
    if (visibleCoords.length > 0) {
        out.push(half(visibleId, shared, colors.visible, { type: 'MultiPolygon', coordinates: visibleCoords }));
    }
    if (obstructedCoords.length > 0) {
        out.push(half(obstructedId, shared, colors.obstructed, { type: 'MultiPolygon', coordinates: obstructedCoords }));
    }
    return out;
}

/**
 * The output features of one input feature. Empty for anything that is not a usable input.
 * @param {string} inputBucket - Store bucket of the input (`los` or `visibility`)
 * @param {Object} mainFeature - The input feature
 * @param {{visible: string, obstructed: string}} [colors]
 * @returns {Object[]} GeoJSON features for the output bucket
 */
export function deriveAnalysisOutput(inputBucket, mainFeature, colors = ANALYSIS_OUTPUT_COLORS) {
    if (!mainFeature?.geometry || !mainFeature.properties) return [];
    if (inputBucket === 'los') return deriveLineOfSight(mainFeature, colors);
    if (inputBucket === 'visibility') return deriveViewshed(mainFeature, colors);
    return [];
}

/**
 * Replaces, IN PLACE, the output of one input feature inside a map's feature buckets: the old
 * halves are removed and, when the input still exists, the new ones are derived from it.
 * @param {Object} features - The map document's `features` object
 * @param {string} inputBucket - Store bucket of the input
 * @param {string} inputId - Id of the input feature
 * @param {Object|null} mainFeature - The input as it now stands, or null when it was removed
 * @returns {boolean} Whether the bucket was an input bucket (i.e. anything was re-derived)
 */
export function replaceDerivedOutput(features, inputBucket, inputId, mainFeature) {
    const outputBucket = derivedOutputBucketOf(inputBucket);
    if (!outputBucket || !features || !inputId) return false;
    const stale = new Set(derivedOutputIdsOf(inputId));
    const kept = (Array.isArray(features[outputBucket]) ? features[outputBucket] : [])
        .filter((f) => !stale.has(f?.properties?.id));
    features[outputBucket] = mainFeature ? kept.concat(deriveAnalysisOutput(inputBucket, mainFeature)) : kept;
    return true;
}

/**
 * Rebuilds EVERY output bucket of a map from its input buckets, discarding whatever the output
 * buckets held. Used on a snapshot from the server, whose output rows (legacy uploads of a local
 * atlas, with ids the derivation would never produce) must not survive next to the derived ones.
 * @param {Object} features - The map document's `features` object, mutated in place
 * @returns {Object} The same object
 */
export function rederiveAllAnalysisOutputs(features) {
    if (!features || typeof features !== 'object') return features;
    for (const [inputBucket, outputBucket] of Object.entries(DERIVED_OUTPUT_BUCKET_OF)) {
        // A map that carries neither bucket keeps its shape: fabricating empty buckets here would
        // change a document nobody analysed (the bucket set is `ensureMapDataShape`'s business).
        if (!Object.hasOwn(features, inputBucket) && !Object.hasOwn(features, outputBucket)) continue;
        const inputs = Array.isArray(features[inputBucket]) ? features[inputBucket] : [];
        features[outputBucket] = inputs.flatMap((f) => deriveAnalysisOutput(inputBucket, f));
    }
    return features;
}
