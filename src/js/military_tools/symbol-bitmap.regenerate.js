// Path: js/military_tools/symbol-bitmap.regenerate.js

/**
 * @fileoverview Map-free, store-free regeneration of a symbol bitmap.
 *
 * The tool controls regenerate a bitmap with a live MapLibre source and the store
 * at hand. The migration, the `.ebgeo` import and the KMZ export have neither: they
 * hold plain feature properties and only need the PNG back. This module is that
 * narrow path — properties in, generator result out, nothing else touched.
 *
 * The generators are imported lazily because they need the DOM (canvas) and the
 * `ms` global, which the store chunk must not drag in. Tests inject fakes through
 * `deps` and stay pure.
 *
 * @module military_tools/symbol-bitmap.regenerate
 */

import { hasCurrentBitmap } from './bitmap-version.js';

/** Feature types whose bitmap this module can rebuild. */
const MILITARY_SYMBOL = 'military_symbol';
const COORDINATION_MEASURE = 'coordination_measure';

/**
 * Echelon point codes that are catalog ALIASES, not catalog entries.
 *
 * The measure panel offers a single "escalão" point whose actual drawing depends on
 * the chosen echelon, stored apart in `echelonCode`. Handing the alias straight to
 * the generator throws (`Point ECHELON not found in catalog`), so every caller has
 * to resolve it first — the control does, and so must this module.
 */
const ECHELON_ALIASES = Object.freeze({
    ECHELON: 'ECHELON_16',
    ECHELON_FT: 'ECHELON_FT_16',
});

/**
 * Resolves the catalog point code a coordination measure must be generated from.
 *
 * @param {Object} properties - Feature properties
 * @returns {string|undefined} Catalog point code, or the original value when it is
 *   not an echelon alias
 */
export function resolveMeasurePointCode(properties) {
    const pointCode = properties?.pointCode;
    const fallback = ECHELON_ALIASES[pointCode];
    if (!fallback) return pointCode;

    return properties.echelonCode || fallback;
}

/**
 * Whether a feature's stored bitmap predates the current layout and has to be
 * rebuilt. Only the two symbol types carry a bitmap version.
 *
 * @param {string} featureType - Source feature type (singular)
 * @param {Object} properties - Feature properties
 * @returns {boolean} True when the bitmap is stale
 */
export function isStaleBitmapFeature(featureType, properties) {
    if (featureType !== MILITARY_SYMBOL && featureType !== COORDINATION_MEASURE) {
        return false;
    }

    return !hasCurrentBitmap(properties);
}

/**
 * Rebuilds the bitmap of one military symbol or coordination measure.
 *
 * Never throws: a symbol whose catalog entry vanished, or a generator that fails on
 * one odd feature, must not abort a whole migration or import. The caller reads
 * `null` as "leave this feature as it is".
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
            // The alias is resolved HERE so every caller — real generator or test
            // double — receives a point code the catalog actually holds.
            const resolved = { ...properties, pointCode: resolveMeasurePointCode(properties) };
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
