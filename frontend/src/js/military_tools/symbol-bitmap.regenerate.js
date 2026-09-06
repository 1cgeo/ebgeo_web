// Path: js/military_tools/symbol-bitmap.regenerate.js

/**
 * @fileoverview Map-free, store-free regeneration of a symbol bitmap.
 *
 * The tool controls regenerate a bitmap with a live MapLibre source and the store
 * at hand. The `.ebgeo` import and the KMZ export have neither: they hold plain
 * feature properties and only need the PNG back. This module is that narrow path,
 * properties in, generator result out, nothing else touched.
 *
 * The generators are imported lazily because they need the DOM (canvas) and the
 * milsymbol bundle, which the store chunk must not drag in. The point catalog is
 * lazy for the same reason: it is a hundred kilobytes of generated SVG, and this
 * module is in `core`. Tests inject fakes through `deps` and stay pure.
 *
 * @module military_tools/symbol-bitmap.regenerate
 */

import { needsBitmapRebuild } from '@layers/bitmap-version.js';

/** Feature types whose bitmap this module can rebuild. */
const MILITARY_SYMBOL = 'military_symbol';
const COORDINATION_MEASURE = 'coordination_measure';

/**
 * Whether a feature's stored bitmap predates the current layout and has to be
 * rebuilt. Only the two symbol types carry a bitmap version.
 *
 * Delegates to `needsBitmapRebuild`, which owns that list: the map-load path in
 * `layers/layer_setup.js` asks the same question and cannot import this module (the
 * map page budgets zero eager `military_tools` modules), so a copy of the list here
 * would be a second answer free to drift from the first.
 *
 * @param {string} featureType - Source feature type (singular)
 * @param {Object} properties - Feature properties
 * @returns {boolean} True when the bitmap is stale
 */
export function isStaleBitmapFeature(featureType, properties) {
    return needsBitmapRebuild(featureType, properties);
}

/**
 * Rebuilds the bitmap of one military symbol or coordination measure.
 *
 * Never throws: a symbol whose catalog entry vanished, or a generator that fails on
 * one odd feature, must not abort a whole import. The caller reads `null` as "leave
 * this feature as it is".
 *
 * @param {string} featureType - Source feature type (singular)
 * @param {Object} properties - Feature properties
 * @param {Object} [deps] - Injected generators, for tests
 * @param {(properties: Object) => Promise<Object>} [deps.military] - Military generator
 * @param {(properties: Object) => Promise<Object>} [deps.measure] - Measure generator
 * @returns {Promise<{blob: Blob, width: number, height: number}|null>} Generator
 *   result, or null when nothing could be generated
 */
export async function regenerateSymbolBitmap(featureType, properties, deps = {}) {
    try {
        if (featureType === MILITARY_SYMBOL) {
            const generate = deps.military || generateMilitarySymbol;
            return (await generate(properties)) || null;
        }

        if (featureType === COORDINATION_MEASURE) {
            const generate = deps.measure || generateCoordinationMeasure;
            // The Nucleo screen code is resolved HERE, through the catalog's own
            // `resolveDrawablePointCode`, so every caller (real generator or test
            // double) receives a point code the catalog actually holds. A second
            // alias table in this module would be a copy of the catalog's rule that
            // can drift from it; the import is dynamic so the catalog stays out of
            // the static graph of `core`.
            const pointCode = await resolveDrawablePointCode(properties);
            const resolved = { ...properties, pointCode };
            return (await generate(resolved)) || null;
        }
    } catch (error) {
        console.warn(`Could not regenerate the ${featureType} bitmap`, error);
    }

    return null;
}

/**
 * Default military symbol generator (lazy import).
 * @param {Object} properties - Feature properties
 * @returns {Promise<Object>} Generator result
 */
async function generateMilitarySymbol(properties) {
    const { MilitarySymbolGenerator } = await import(
        './military_symbol_tool/military_symbol_generator.js'
    );
    return new MilitarySymbolGenerator().generateSymbolBlob(properties);
}

/**
 * Default coordination measure generator (lazy import).
 * @param {Object} properties - Feature properties, with `pointCode` already resolved
 * @returns {Promise<Object>} Generator result
 */
async function generateCoordinationMeasure(properties) {
    const { CoordinationMeasureGenerator } = await import(
        './coordination_measure_tool/coordination_measure_generator.js'
    );
    return new CoordinationMeasureGenerator().generateSymbolBlob(properties);
}

/**
 * Resolves the drawable catalog code of a coordination measure (lazy import).
 * @param {Object} properties - Feature properties
 * @returns {Promise<string>} Catalog point code
 */
async function resolveDrawablePointCode(properties) {
    const { resolveDrawablePointCode: resolver } = await import(
        './coordination_measure_tool/coordination_points_catalog.js'
    );
    return resolver(properties);
}
