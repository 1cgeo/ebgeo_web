// Path: js/terrain/analysis-layers.manager.js
import config from '../config.js';
import { getMapAnalysisLayersStates } from '../store/settings.operations.js';
import { getLayerFailureNotice } from './layer-failure-notice.js';

/** Prefix every source of an analysis layer carries on the map. */
const SOURCE_PREFIX = 'analysis-';

/** Key this manager's layers are filed under in the shared notice. */
export const ANALYSIS_SURFACE = 'analysis';

/**
 * Returns `value` when it is a usable number, otherwise `fallback`.
 *
 * `opacity || 1` sent a layer declared FULLY TRANSPARENT to the map fully opaque,
 * in two places that have to agree (the style descriptor and the paint of the
 * layer actually added). `??` alone would not do: NaN is not a paint value
 * MapLibre accepts.
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function numberOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

/**
 * Manages raster analysis layers in the system.
 * State persistence is handled by catalogLayers, not by this manager.
 *
 * WHEN A LAYER DOES NOT DRAW, IT IS SAID — since 2026-08-24, and by the panel the data layers
 * already used (`layer-failure-notice.js`). Before that every failure here ended in
 * `console.error` and nothing else: the catalog item switched on, the raster did not paint, and
 * the screen said nothing, which is exactly the state the data layers left the day before.
 *
 * ONE SOURCE PER LAYER, and that is the difference from the data layers worth writing down: a
 * data layer can declare a SECOND source (`config.labelSource`), and folding the pair back onto
 * one layer is what stops it being counted twice. `_addAnalysisLayer` adds `analysis-<id>` and
 * nothing else, so there is no pair to fold here and `_layerIdFromSourceId` is a plain strip of
 * the prefix.
 */
class AnalysisLayersManager {
    constructor(map) {
        this.map = map;
        this._validateLayersConfig();
        this._notice = getLayerFailureNotice(map);
        this._notice.registerSurface(ANALYSIS_SURFACE, {
            resolveLayerId: (sourceId) => this._layerIdFromSourceId(sourceId),
            layerName: (layerId) => this.getLayerConfig(layerId)?.name,
            isVisible: (layerId) => this.isLayerVisible(layerId),
            retry: (layerId) => this._retryLayer(layerId),
        });
    }

    /**
     * Hands the surface back. Nothing calls this today (the manager lives as long as the map
     * does), and it exists anyway because a registration the notice keeps calling into after this
     * object is dead is the same class of leak as an unpaired `map.on()`.
     */
    destroy() {
        this._notice?.unregisterSurface(ANALYSIS_SURFACE);
        this._notice = null;
    }

    /**
     * @private The layer a map source id belongs to, or `null` for anything that is not ours.
     * @param {*} sourceId
     * @returns {string|null}
     */
    _layerIdFromSourceId(sourceId) {
        if (typeof sourceId !== 'string' || !sourceId.startsWith(SOURCE_PREFIX)) return null;
        const raw = sourceId.slice(SOURCE_PREFIX.length);
        return this.getLayerConfig(raw) ? raw : null;
    }

    /**
     * @private Asks for ONE failed layer again. Called by the shared notice, never directly.
     *
     * DROPPING THE SOURCE IS THE POINT: MapLibre keeps a failed tile cached for the life of the
     * source, so re-adding the layer over the old source repaints nothing and the button looks
     * inert. The visibility is read BEFORE the removal, which is what destroys the map layer the
     * answer comes from.
     * @param {string} layerId
     */
    _retryLayer(layerId) {
        const wasVisible = this.isLayerVisible(layerId);
        const layerConfig = this.getLayerConfig(layerId);
        this._removeAnalysisLayer(layerId);
        if (!layerConfig) return;
        this._addAnalysisLayer(layerConfig, undefined, { announceFailure: true });
        if (wasVisible) this._applyVisibility(layerId, true);
    }

    /**
     * Checks if analysis layers system is enabled
     * @returns {boolean}
     */
    isEnabled() {
        return config.analysisLayers?.enabled === true &&
               config.analysisLayers.layers?.length > 0;
    }

    /**
     * Initial setup - adds all analysis layers with visibility: 'none'.
     * Layers are only made visible when explicitly added via catalog.
     */
    async setupAnalysisLayers() {
        if (!this.isEnabled()) return;

        try {
            // A style reload rebuilds every layer from scratch, so whatever failed against the
            // PREVIOUS style is no longer a statement about what is on screen. Only THIS surface
            // is cleared: a basemap or data-layer failure standing right now is still true.
            this._notice.clearSurface(ANALYSIS_SURFACE);

            for (const layerConfig of config.analysisLayers.layers) {
                this._addAnalysisLayer(layerConfig);
            }
        } catch (error) {
            console.error('Error setting up analysis layers:', error);
        }
    }

    /**
     * Toggles visibility of an analysis layer on the map
     * @param {string} layerId - Layer ID (without 'analysis-' prefix)
     * @param {boolean} enabled
     */
    async toggleLayer(layerId, enabled) {
        const mapLayerId = this._mapLayerId(layerId);

        if (!this.map.getLayer(mapLayerId)) {
            const layerConfig = this.getLayerConfig(layerId);
            if (!layerConfig) {
                // NOT reported through the notice: a layer with no config at all is one the
                // catalog no longer serves, and the catalog says so in its own words. The notice
                // is for the other case, where the definition is here and the bytes are not.
                console.warn(`Analysis layer config not found for: ${layerId}`);
                return;
            }
            this._addAnalysisLayer(layerConfig, undefined, { announceFailure: enabled });
        }

        // Switching a layer OFF retires whatever it was accused of. Without this, turning it back
        // on later would be met by a notice about the previous attempt, and a person who dismissed
        // the notice could never get it back for a genuinely new failure.
        if (!enabled) this._notice.clear(ANALYSIS_SURFACE, layerId);

        this._applyVisibility(layerId, enabled);
    }

    /**
     * Zooms to bounds of an analysis layer
     * @param {string} layerId - Layer ID (without 'analysis-' prefix)
     */
    zoomToLayer(layerId) {
        const layerConfig = this.getLayerConfig(layerId);
        if (!layerConfig) {
            console.warn(`Layer config not found for: ${layerId}`);
            return;
        }

        this.map.fitBounds(layerConfig.bounds, {
            padding: 20,
            duration: 1000,
            essential: true
        });
    }

    /**
     * Gets configuration of a specific layer
     * @param {string} layerId - Layer ID (without 'analysis-' prefix)
     * @returns {Object|null}
     */
    getLayerConfig(layerId) {
        // Optional chaining, not a bare read: this now runs on EVERY map `error` event, through
        // `_layerIdFromSourceId`, and a deploy whose `/api/config` omits `analysisLayers` would
        // otherwise throw inside a listener, from a path that has nothing to do with analysis.
        return config.analysisLayers?.layers?.find(l => l.id === layerId) || null;
    }

    /**
     * Gets all layer configurations for UI construction
     * @returns {Array}
     */
    getLayersConfig() {
        return config.analysisLayers?.layers || [];
    }

    /**
     * Restores saved states of all analysis layers from the store
     */
    async restoreLayersState() {
        if (!this.isEnabled()) return;

        try {
            const layersStates = await getMapAnalysisLayersStates();

            for (const layerConfig of config.analysisLayers.layers) {
                const isEnabled = layersStates[layerConfig.id] ?? layerConfig.defaultVisibility ?? false;
                this._applyVisibility(layerConfig.id, isEnabled);
            }
        } catch (error) {
            console.error('Error restoring analysis layers states:', error);
        }
    }

    /**
     * @param {string} layerId - Layer ID (without 'analysis-' prefix)
     * @returns {boolean} true if layer is visible
     */
    isLayerVisible(layerId) {
        const mapLayerId = this._mapLayerId(layerId);
        if (!this.map.getLayer(mapLayerId)) return false;

        return this.map.getLayoutProperty(mapLayerId, 'visibility') === 'visible';
    }

    /** Removes all analysis layers from the map */
    removeAllLayers() {
        if (!this.isEnabled()) return;

        for (const layerConfig of config.analysisLayers.layers) {
            this._removeAnalysisLayer(layerConfig.id);
        }
    }

    /**
     * Removes one analysis layer and its source from the map.
     * @param {string} layerId - Layer ID (without 'analysis-' prefix)
     * @private
     */
    _removeAnalysisLayer(layerId) {
        const sourceId = `${SOURCE_PREFIX}${layerId}`;
        const mapLayerId = this._mapLayerId(layerId);

        try {
            if (this.map.getLayer(mapLayerId)) this.map.removeLayer(mapLayerId);
            if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
            // Unconditional BECAUSE `clear` is a no-op for a layer that is not accused: the retry
            // path empties the entry before calling this, and a clear that ran anyway would reset
            // the retry flag and make the second failure repeat the first sentence word for word.
            this._notice.clear(ANALYSIS_SURFACE, layerId);
        } catch (error) {
            console.warn(`Error removing analysis layer ${layerId}:`, error);
        }
    }

    // --- Private helpers ---

    /** @returns {string} MapLibre layer ID */
    _mapLayerId(layerId) {
        return `analysis-${layerId}-layer`;
    }

    /**
     * Builds a structured style descriptor for a raster analysis layer. Raster
     * paint is always scalar (the tiles are pre-rendered RGB). Defaults mirror
     * the values used when the layer is added in `_addAnalysisLayer`.
     * @param {string} layerId
     * @returns {{kind:'raster', sublayers:Object}}
     */
    getStyleDescriptor(layerId) {
        const layerConfig = this.getLayerConfig(layerId);
        const paint = layerConfig?.paint || {};

        return {
            kind: 'raster',
            sublayers: {
                raster: {
                    present: true,
                    values: {
                        // _addAnalysisLayer sets raster-opacity through the same
                        // `numberOr` guard (the explicit key overrides the paint
                        // spread); mirror it, zero included.
                        'raster-opacity': numberOr(layerConfig?.opacity, 1),
                        'raster-brightness-min': paint['raster-brightness-min'] ?? 0,
                        'raster-brightness-max': paint['raster-brightness-max'] ?? 1,
                        'raster-contrast': paint['raster-contrast'] ?? 0,
                        'raster-saturation': paint['raster-saturation'] ?? 0,
                        'raster-hue-rotate': paint['raster-hue-rotate'] ?? 0
                    }
                }
            }
        };
    }

    /**
     * Applies user style overrides to a raster analysis layer, falling back to
     * config defaults for any property not overridden.
     * @param {string} layerId
     * @param {Object} overrides - Nested map { raster:{prop:val} }.
     */
    applyStyleOverrides(layerId, overrides) {
        const mapLayerId = this._mapLayerId(layerId);
        if (!this.map.getLayer(mapLayerId)) return;

        const descriptor = this.getStyleDescriptor(layerId);
        const merged = { ...descriptor.sublayers.raster.values, ...(overrides?.raster || {}) };
        for (const [prop, value] of Object.entries(merged)) {
            try {
                this.map.setPaintProperty(mapLayerId, prop, value);
            } catch (error) {
                console.warn(`Error setting paint ${prop} on ${mapLayerId}:`, error);
            }
        }
    }

    /**
     * Validates analysis layers configuration at initialization and DROPS any
     * malformed layer (missing/invalid bounds) instead of aborting app boot.
     *
     * The layers array is merged in from the remote `/api/config`, which may carry a
     * layer without bounds (e.g. a seeded `hillshade` with an empty config). A single
     * malformed remote layer must NOT crash the whole app (which would tear down every
     * map control); it is logged and skipped so the rest of the app — and every other
     * valid layer — boots normally. `bounds` stays required for a layer to be usable
     * (zoomToLayer relies on it).
     */
    _validateLayersConfig() {
        if (!config.analysisLayers?.enabled) return;
        const layers = config.analysisLayers.layers;
        if (!Array.isArray(layers)) return;

        config.analysisLayers.layers = layers.filter((layer) => {
            if (!layer.bounds || !Array.isArray(layer.bounds) || layer.bounds.length !== 4) {
                console.warn(
                    `Analysis layer "${layer.id}" sem bounds válidos [west, south, east, north] — ignorada.`
                );
                return false;
            }
            const [west, south, east, north] = layer.bounds;
            if (west >= east || south >= north) {
                console.warn(
                    `Analysis layer "${layer.id}" com bounds inválidos (exige west < east e south < north) — ignorada.`
                );
                return false;
            }
            return true;
        });
    }

    /**
     * Adds an individual analysis layer to the map
     * @param {Object} layerConfig - Layer configuration from config.js
     * @param {string} [beforeId='features-separator']
     * @param {{announceFailure?: boolean}} [options] - `announceFailure` says this call came from
     *   an explicit gesture (a switch, the retry button), so a failure is worth a word on screen.
     *   It defaults to FALSE because `setupAnalysisLayers` re-adds EVERY layer on every style
     *   load, and a notice raised there would accuse layers nobody asked for, on a basemap switch.
     */
    _addAnalysisLayer(layerConfig, beforeId = 'features-separator', { announceFailure = false } = {}) {
        const sourceId = `analysis-${layerConfig.id}`;
        const layerId = this._mapLayerId(layerConfig.id);

        try {
            if (!this.map.getSource(sourceId)) {
                this.map.addSource(sourceId, layerConfig.source);
            }

            if (!this.map.getLayer(layerId)) {
                const layer = {
                    id: layerId,
                    type: 'raster',
                    source: sourceId,
                    paint: {
                        ...layerConfig.paint,
                        'raster-opacity': numberOr(layerConfig.opacity, 1)
                    },
                    layout: { visibility: 'none' }
                };
                this._addLayerSafe(layer, beforeId);
            }
        } catch (error) {
            console.error(`Error adding analysis layer ${layerConfig.id}:`, error);
            // The SYNCHRONOUS failure (a malformed source, a style the map refuses) lands in the
            // same aggregation as the asynchronous tile failure. To the person looking at the map
            // the two are one event: the layer is not there.
            if (announceFailure) this._notice.report(ANALYSIS_SURFACE, layerConfig.id);
        }
    }

    /** Applies visibility state of a layer on the map */
    _applyVisibility(layerId, enabled) {
        const mapLayerId = this._mapLayerId(layerId);

        if (this.map.getLayer(mapLayerId)) {
            this.map.setLayoutProperty(mapLayerId, 'visibility', enabled ? 'visible' : 'none');
        } else {
            console.warn(`Analysis layer ${mapLayerId} not found on map`);
        }
    }

    /** Adds a layer, inserting before beforeId if it exists */
    _addLayerSafe(layer, beforeId) {
        if (this.map.getLayer(beforeId)) {
            this.map.addLayer(layer, beforeId);
        } else {
            this.map.addLayer(layer);
        }
    }
}

export default AnalysisLayersManager;
