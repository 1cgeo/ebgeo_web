// Path: js/layers/layer-opacity-applier.js

/**
 * @fileoverview Applies per-layer opacity multipliers to MapLibre paint properties.
 *
 * Strategy: snapshot each MapLibre layer's original opacity expressions on first
 * application, then rebuild from the snapshot whenever layer opacities change.
 * The new expression multiplies the original (typically `['get', 'opacity']`
 * for feature opacity) by a `match` expression keyed on `layerId`.
 */

import { FEATURE_LAYER_IDS } from './layer.constants.js';
import { getLayers } from '../store';

/** Opacity-style paint properties found in feature MapLibre layers. */
const OPACITY_PROPS = [
    'fill-opacity',
    'line-opacity',
    'circle-opacity',
    'circle-stroke-opacity',
    'text-opacity',
    'icon-opacity'
];

/**
 * Cache of original paint property expressions, keyed by `${layerId}:${prop}`.
 * Captures the value before any layer-opacity multiplier is applied.
 * @type {Map<string, *>}
 */
const originalPaintCache = new Map();

/** Last applied opacity signature, for short-circuiting redundant work. */
let lastSignature = null;

/**
 * Captures the original paint property if not already cached.
 * Returns the original expression, or `undefined` if the property is not set.
 * @param {Object} mapInstance
 * @param {string} mapLayerId
 * @param {string} prop
 * @returns {*}
 */
function snapshotOriginal(mapInstance, mapLayerId, prop) {
    const key = `${mapLayerId}:${prop}`;
    if (!originalPaintCache.has(key)) {
        const value = mapInstance.getPaintProperty(mapLayerId, prop);
        originalPaintCache.set(key, value);
    }
    return originalPaintCache.get(key);
}

/**
 * Builds a MapLibre `match` expression that maps each layerId to its opacity.
 * Layers not present in the map default to opacity 1.
 * @param {Array<{id: string, opacity?: number}>} layers
 * @returns {Array} MapLibre expression
 */
function buildOpacityMatch(layers) {
    const match = ['match', ['coalesce', ['get', 'layerId'], 'default']];
    for (const layer of layers) {
        const opacity = typeof layer.opacity === 'number' ? layer.opacity : 1;
        match.push(layer.id, opacity);
    }
    match.push(1); // default for unknown layerIds
    return match;
}

/**
 * Computes a stable signature of layer opacities to skip no-op updates.
 * @param {Array<{id: string, opacity?: number}>} layers
 * @returns {string}
 */
function computeSignature(layers) {
    return layers
        .map(l => `${l.id}=${typeof l.opacity === 'number' ? l.opacity : 1}`)
        .sort()
        .join('|');
}

/**
 * Applies current per-layer opacity multipliers to all feature MapLibre layers.
 * Safe to call multiple times.
 * @param {Object} mapInstance - MapLibre map instance
 */
export function applyLayerOpacities(mapInstance) {
    if (!mapInstance) return;

    const layers = getLayers();
    const signature = computeSignature(layers);
    if (signature === lastSignature) return;
    lastSignature = signature;

    const opacityMatch = buildOpacityMatch(layers);

    for (const mapLayerId of FEATURE_LAYER_IDS) {
        if (!mapInstance.getLayer(mapLayerId)) continue;

        for (const prop of OPACITY_PROPS) {
            const original = snapshotOriginal(mapInstance, mapLayerId, prop);
            if (original === undefined || original === null) continue;

            try {
                mapInstance.setPaintProperty(mapLayerId, prop, ['*', original, opacityMatch]);
            } catch (error) {
                console.warn(`Error applying opacity ${prop} on ${mapLayerId}:`, error);
            }
        }
    }
}

/**
 * Clears cached state. Call when the map style is reset (e.g. base layer change)
 * so the next application re-snapshots the fresh paint properties.
 */
export function invalidateOpacityCache() {
    originalPaintCache.clear();
    lastSignature = null;
}
