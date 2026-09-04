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

/**
 * Opacity-style paint properties, BY LAYER TYPE. Asking a layer for a property of
 * another type makes MapLibre throw, and the previous flat list of six props
 * cost ~170 exceptions (each with a stack trace) per full pass over the 43
 * feature layers. A layer type not listed here receives no opacity multiplier.
 */
const OPACITY_PROPS_BY_TYPE = {
    fill: ['fill-opacity'],
    line: ['line-opacity'],
    circle: ['circle-opacity', 'circle-stroke-opacity'],
    symbol: ['text-opacity', 'icon-opacity'],
};

/**
 * Opacity paint properties a MapLibre layer can carry, from its type.
 * @param {{ type?: string }|null|undefined} layer - `map.getLayer(id)`
 * @returns {string[]}
 */
export function opacityPropsForLayer(layer) {
    return OPACITY_PROPS_BY_TYPE[layer?.type] || [];
}

/**
 * Cache of original paint property expressions, keyed by `${layerId}:${prop}`.
 * Captures the value before any layer-opacity multiplier is applied.
 * @type {Map<string, *>}
 */
const originalPaintCache = new Map();

/** Last applied opacity signature, for short-circuiting redundant work. */
let lastSignature = null;

/**
 * Last map instance handed to `applyLayerOpacities`, so a live preview can reach
 * the map without threading the instance through the sidebar components.
 * @type {Object|null}
 */
let lastMapInstance = null;

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
        let value;
        try {
            value = mapInstance.getPaintProperty(mapLayerId, prop);
        } catch {
            // MapLibre throws when `prop` is not a valid paint property for this
            // layer's type (e.g. 'fill-opacity' on a circle/symbol layer).
            // Treat as absent so the caller skips it.
            value = undefined;
        }
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
    lastMapInstance = mapInstance;
    applyOpacityExpressions(mapInstance, getLayers());
}

/**
 * Applies an opacity that is NOT (yet) in the store, for live feedback while a
 * slider is dragged. Writing the store per frame emits LAYERS_CHANGED and logs a
 * sync operation on every frame; this path only touches paint properties.
 *
 * The signature bookkeeping is shared with `applyLayerOpacities`, so the single
 * store write at the end of the gesture short-circuits instead of repainting.
 * If the gesture never commits, the next real layer change re-applies the stored
 * value and the preview is discarded.
 *
 * @param {string} layerId - Layer being dragged
 * @param {number} opacity - Opacity 0..1 to preview
 * @returns {boolean} True when the preview was applied to a map
 */
export function previewLayerOpacity(layerId, opacity) {
    if (!lastMapInstance) return false;

    const layers = getLayers().map(
        layer => (layer.id === layerId ? { ...layer, opacity } : layer)
    );
    applyOpacityExpressions(lastMapInstance, layers);
    return true;
}

/**
 * Rebuilds the opacity multiplier expressions from a layer list.
 * @param {Object} mapInstance - MapLibre map instance
 * @param {Array<{id: string, opacity?: number}>} layers - Layers to apply
 */
function applyOpacityExpressions(mapInstance, layers) {
    const signature = computeSignature(layers);
    if (signature === lastSignature) return;
    lastSignature = signature;

    const opacityMatch = buildOpacityMatch(layers);

    for (const mapLayerId of FEATURE_LAYER_IDS) {
        const mapLayer = mapInstance.getLayer(mapLayerId);
        if (!mapLayer) continue;

        for (const prop of opacityPropsForLayer(mapLayer)) {
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
