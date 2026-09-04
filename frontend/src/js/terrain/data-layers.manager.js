// Path: js/terrain/data-layers.manager.js
// Manages vector data layers (molduras, etc.) from config.dataLayers
import config from '../config.js';
import { LAYOUT_PROPS } from '@layers/layer-style/layer-style.schema.js';
import { generatePointImage, needsPerFeatureImage, getSymbolIds } from '@js/draw_tools/point_tool/point-marker-symbols.js';
import { getLayerFailureNotice } from './layer-failure-notice.js';
import { antimeridianSafeLngSpan } from '@utils/geometry-utils.js';

/** Prefix every source and sub-layer of a data layer carries on the map. */
const SOURCE_PREFIX = 'data-';

/** Suffix of the SECOND source a layer may declare (`config.labelSource`). */
const LABEL_SOURCE_SUFFIX = '-label-source';

/** Key this manager's layers are filed under in the shared notice. */
export const DATA_SURFACE = 'data';

/**
 * Returns `value` when it is a usable number, otherwise `fallback`.
 *
 * The `|| default` form ate three legitimate zeros here: a border declared
 * INVISIBLE (`width: 0` or `opacity: 0`) drew at full strength, and a layer
 * configured to never appear (`maxzoom: 0`) appeared at every zoom. `fill.opacity`
 * three lines away already used `??` and preserved its zero, which is what made
 * the inconsistency visible. `??` alone is not enough: NaN is not a paint value.
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function numberOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

/**
 * Manages vector data layers in the system.
 * State persistence is handled by catalogLayers, not by this manager.
 *
 * WHEN A LAYER DOES NOT DRAW, IT IS SAID, AND NOT BY THIS FILE ANY MORE. Until 2026-08-23 both
 * failure paths ended in `console.error` and nothing else, so a person with a legitimate grant
 * switched a layer on, nothing painted, and the screen stayed silent. The panel, the per-layer
 * aggregation, the burst timer and the retry moved to `layer-failure-notice.js` on 2026-08-24,
 * when the analysis layers and the basemap joined the same panel; the wording lives in
 * `data-layer-phrases.js`, whose header carries the reason it refuses to name a cause (clauses
 * 10.1 and 10.3 of `CONSTITUICAO.md` point in opposite directions, and the client cannot tell
 * them apart). What stays here is the only half that is about DATA layers: which source id maps
 * to which layer, whether it is on, and how to ask for it again.
 *
 * TWO DIFFERENT FAILURES END UP IN THE SAME PLACE, and that is deliberate: the SYNCHRONOUS one
 * (`addDataLayer` throwing on a malformed source) and the ASYNCHRONOUS one (the tile request
 * failing later, which is the case that actually happens in production and which no `try/catch`
 * in this file could ever have caught). To the person looking at the map they are one event: the
 * layer is not there.
 */
class DataLayersManager {
    constructor(map) {
        this.map = map;
        this._initializedLayers = new Set();
        this._notice = getLayerFailureNotice(map);
        this._notice.registerSurface(DATA_SURFACE, {
            resolveLayerId: (sourceId) => this._layerIdFromSourceId(sourceId),
            layerName: (layerId) => this.getLayerConfig(layerId)?.name,
            isVisible: (layerId) => this.isLayerVisible(layerId),
            retry: (layerId) => this._retryLayer(layerId),
        });
    }

    /**
     * Hands the surface back. Nothing calls this today (the manager lives as long as the map
     * does), and it exists anyway because a registration without its withdrawal is the same leak
     * this codebase pairs by convention, not by whether the pairing runs: the notice would keep
     * calling into a dead manager on every map error.
     */
    destroy() {
        this._notice?.unregisterSurface(DATA_SURFACE);
        this._notice = null;
        this._initializedLayers.clear();
    }

    /**
     * Checks if data layers system is enabled
     * @returns {boolean}
     */
    isEnabled() {
        return config.dataLayers?.enabled === true &&
               config.dataLayers.layers?.length > 0;
    }

    /**
     * Initial setup - adds all data layers with visibility: 'none'.
     * Layers are only made visible when explicitly added via catalog.
     */
    async setupDataLayers() {
        if (!this.isEnabled()) return;

        try {
            this._initializedLayers.clear();
            // A style reload rebuilds every layer from scratch, so whatever failed against the
            // PREVIOUS style is no longer a statement about what is on screen. Keeping the notice
            // up would accuse a layer that is being asked for again right now. Only THIS surface
            // is cleared: a basemap failure standing at this moment is still true.
            this._notice.clearSurface(DATA_SURFACE);

            for (const layerConfig of config.dataLayers.layers) {
                this.addDataLayer(layerConfig.id);
            }
        } catch (error) {
            console.error('Error setting up data layers:', error);
        }
    }

    /**
     * Gets configuration of a specific layer
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     * @returns {Object|null}
     */
    getLayerConfig(layerId) {
        return config.dataLayers?.layers?.find(l => l.id === layerId) || null;
    }

    /**
     * Gets all layer configurations for UI construction
     * @returns {Array}
     */
    getLayersConfig() {
        return config.dataLayers?.layers || [];
    }

    /**
     * Adds a data layer to the map with visibility: 'none'
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     * @param {string} [beforeId='features-separator']
     * @param {{announceFailure?: boolean}} [options] - `announceFailure` says this call came from
     *   an explicit gesture (a switch, the retry button), so a failure is worth a word on screen.
     *   It defaults to FALSE because `setupDataLayers` re-adds EVERY layer on every style load,
     *   and a notice raised there would accuse layers nobody asked for, on a basemap switch.
     * @returns {boolean} true if layer was added successfully
     */
    addDataLayer(layerId, beforeId = 'features-separator', { announceFailure = false } = {}) {
        const layerConfig = this.getLayerConfig(layerId);
        if (!layerConfig) {
            // NOT reported through the notice, and the boundary matters: a layer with no config at
            // all is a layer the catalog no longer serves, and the catalog already says so in its
            // own words (`attachUnavailableLayerEvents` / `showUnavailableLayerPopover` in
            // `features_tab/catalog-layers.component.js`). The notice below is for the other case:
            // the definition is here and the bytes are not.
            console.warn(`Data layer config not found: ${layerId}`);
            return false;
        }

        const sourceId = `data-${layerConfig.id}`;

        try {
            this._addSourceSafe(sourceId, this._withBounds(layerConfig.source, layerConfig.bounds));

            // Add label source if different from main source
            const labelSourceId = layerConfig.labelSource ? `data-${layerConfig.id}-label-source` : sourceId;
            if (layerConfig.labelSource) {
                this._addSourceSafe(labelSourceId, this._withBounds(layerConfig.labelSource, layerConfig.bounds));
            }

            this._registerMarkerImage(layerConfig);

            this._addFillLayer(layerConfig, sourceId, beforeId);
            this._addBorderLayer(layerConfig, sourceId, beforeId);
            this._addLabelLayer(layerConfig, labelSourceId, beforeId);

            this._initializedLayers.add(layerId);
            return true;
        } catch (error) {
            console.error(`Error adding data layer ${layerId}:`, error);
            // The SYNCHRONOUS failure (a malformed source, a style the map refuses) lands in the
            // same aggregation as the asynchronous tile failure. To the person looking at the map
            // the two are one event: the layer is not there.
            if (announceFailure) this._notice.report(DATA_SURFACE, layerId);
            return false;
        }
    }

    /**
     * Toggles visibility of a data layer on the map
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     * @param {boolean} enabled
     */
    async toggleLayer(layerId, enabled) {
        if (!this._initializedLayers.has(layerId)) {
            const added = this.addDataLayer(layerId, undefined, { announceFailure: enabled });
            if (!added) return;
        }

        // Switching a layer OFF retires whatever it was accused of. Without this, turning the
        // layer back on later would be met by a notice about the previous attempt, and a person
        // who dismissed the notice could never get it back for a genuinely new failure.
        if (!enabled) this._notice.clear(DATA_SURFACE, layerId);

        this._applyVisibility(layerId, enabled);
    }

    /**
     * Zooms to the extent of a data layer's visible features
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     */
    zoomToLayer(layerId) {
        const layerConfig = this.getLayerConfig(layerId);
        if (!layerConfig) {
            console.warn(`Layer config not found for: ${layerId}`);
            return;
        }

        const bounds = this._getBoundsFromFeatures(layerId, layerConfig);
        if (bounds) {
            this.map.fitBounds(bounds, { padding: 20, duration: 1000, essential: true });
        } else {
            console.warn(`No features found for layer "${layerId}" to calculate bounds`);
        }
    }

    /**
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     * @returns {boolean} true if layer is visible
     */
    isLayerVisible(layerId) {
        const checkLayerId = this.map.getLayer(`data-${layerId}-border`)
            ? `data-${layerId}-border`
            : `data-${layerId}-fill`;

        if (!this.map.getLayer(checkLayerId)) return false;

        return this.map.getLayoutProperty(checkLayerId, 'visibility') === 'visible';
    }

    /**
     * Removes a data layer and its sources from the map
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     */
    removeLayer(layerId) {
        try {
            this._removeLayerSafe(`data-${layerId}-label`);
            this._removeLayerSafe(`data-${layerId}-border`);
            this._removeLayerSafe(`data-${layerId}-fill`);

            this._removeSourceSafe(`data-${layerId}-label-source`);
            this._removeSourceSafe(`data-${layerId}`);

            this._removeImageSafe(this._markerImageId(layerId));

            // Unconditional here BECAUSE `clear` is a no-op for a layer that is not accused: the
            // retry path empties the entry before calling this, and a clear that ran anyway would
            // reset the retry flag and make the second failure repeat the first sentence word for
            // word. The guard lives in the notice, once, instead of at each call site.
            this._notice.clear(DATA_SURFACE, layerId);

            this._initializedLayers.delete(layerId);
        } catch (error) {
            console.warn(`Error removing data layer ${layerId}:`, error);
        }
    }

    /** Removes all data layers from the map */
    removeAllLayers() {
        if (!this.isEnabled()) return;

        for (const layerId of this._initializedLayers) {
            this.removeLayer(layerId);
        }
    }

    // --- Failure reporting (the panel and the aggregation live in layer-failure-notice.js) ---

    /**
     * @private The layer a map source id belongs to, or `null` for anything that is not ours.
     *
     * TWO SOURCES CAN NAME THE SAME LAYER (`config.source` and the independent `config.labelSource`),
     * and both must fold onto the one layer, or a layer with a second source would be counted and
     * announced twice. The literal id is tried FIRST so a layer whose own id happens to end in the
     * suffix is not mistaken for somebody else's label source.
     * @param {*} sourceId
     * @returns {string|null}
     */
    _layerIdFromSourceId(sourceId) {
        if (typeof sourceId !== 'string' || !sourceId.startsWith(SOURCE_PREFIX)) return null;
        const raw = sourceId.slice(SOURCE_PREFIX.length);
        if (this.getLayerConfig(raw)) return raw;
        if (raw.endsWith(LABEL_SOURCE_SUFFIX)) {
            const base = raw.slice(0, -LABEL_SOURCE_SUFFIX.length);
            if (this.getLayerConfig(base)) return base;
        }
        return null;
    }

    /**
     * @private Asks for ONE failed layer again. Called by the shared notice, never directly.
     *
     * DROPPING THE SOURCE IS THE POINT. MapLibre keeps a failed tile cached for the life of the
     * source, so re-adding the layer without removing the source first repaints nothing at all and
     * the button looks inert. `removeLayer` takes the source with it, which is what makes the next
     * `addDataLayer` a genuinely new request.
     *
     * The visibility is read BEFORE the removal, because `removeLayer` is what destroys the
     * sub-layers the answer is read from.
     * @param {string} layerId
     */
    _retryLayer(layerId) {
        const wasVisible = this.isLayerVisible(layerId);
        this.removeLayer(layerId);
        if (this.addDataLayer(layerId, undefined, { announceFailure: true }) && wasVisible) {
            this._applyVisibility(layerId, true);
        }
    }

    // --- Private helpers ---

    /** Applies visibility to all sub-layers of a data layer */
    _applyVisibility(layerId, enabled) {
        const visibility = enabled ? 'visible' : 'none';
        const subLayers = [`data-${layerId}-fill`, `data-${layerId}-border`, `data-${layerId}-label`];

        for (const id of subLayers) {
            if (this.map.getLayer(id)) {
                this.map.setLayoutProperty(id, 'visibility', visibility);
            }
        }
    }

    /**
     * Builds a structured style descriptor for a vector data layer: which
     * sub-layers exist and the default (config) value of each editable property.
     * Values may be plain colors/numbers OR data-driven MapLibre expressions
     * (case/match/interpolate/step), preserved verbatim from config.
     *
     * Defaults for absent properties mirror MapLibre's own paint defaults so
     * that applying a descriptor never changes the look of a property the user
     * did not edit.
     * @param {string} layerId
     * @returns {{kind:'vector', sublayers:Object}}
     */
    getStyleDescriptor(layerId) {
        const style = this.getLayerConfig(layerId)?.style || {};
        const fill = style.fill;
        const border = style.border;
        const label = style.label;
        const labelPaint = label?.paint || {};
        const labelLayout = label?.layout || {};

        return {
            kind: 'vector',
            sublayers: {
                fill: {
                    present: !!fill,
                    // Mirror _addFillLayer's own fallbacks (|| not ??) so applying
                    // the descriptor never changes an untouched property.
                    values: {
                        'fill-color': fill?.color || 'rgba(0,0,0,0.1)',
                        'fill-opacity': fill?.opacity ?? 1
                    }
                },
                border: {
                    present: !!border,
                    // Mirror _addBorderLayer's fallbacks exactly, `numberOr`
                    // included, so a declared zero survives on both paths.
                    values: {
                        'line-color': border?.color || '#666666',
                        'line-width': numberOr(border?.width, 1),
                        'line-opacity': numberOr(border?.opacity, 1)
                    }
                },
                label: {
                    present: !!label,
                    values: {
                        'text-color': labelPaint['text-color'] ?? '#000000',
                        'text-halo-color': labelPaint['text-halo-color'] ?? 'rgba(0,0,0,0)',
                        'text-halo-width': labelPaint['text-halo-width'] ?? 0,
                        'text-size': labelLayout['text-size'] ?? 16
                    }
                }
            }
        };
    }

    /**
     * Applies user style overrides to the fill / border / label sub-layers,
     * falling back to config defaults for any property not overridden. Accepts
     * scalar values or data-driven expressions.
     * @param {string} layerId
     * @param {Object} overrides - Nested map { fill:{prop:val}, border:{...}, label:{...} }.
     */
    applyStyleOverrides(layerId, overrides) {
        const descriptor = this.getStyleDescriptor(layerId);

        for (const [subKey, sub] of Object.entries(descriptor.sublayers)) {
            if (!sub.present) continue;

            const mapLayerId = `data-${layerId}-${subKey}`;
            if (!this.map.getLayer(mapLayerId)) continue;

            const merged = { ...sub.values, ...(overrides?.[subKey] || {}) };
            for (const [prop, value] of Object.entries(merged)) {
                if (LAYOUT_PROPS.has(prop)) {
                    this._setLayout(mapLayerId, prop, value);
                } else {
                    this._setPaint(mapLayerId, prop, value);
                }
            }
        }
    }

    /** Safely sets a paint property if the layer exists. */
    _setPaint(layerId, prop, value) {
        if (value === undefined || value === null) return;
        if (!this.map.getLayer(layerId)) return;
        try {
            this.map.setPaintProperty(layerId, prop, value);
        } catch (error) {
            console.warn(`Error setting paint ${prop} on ${layerId}:`, error);
        }
    }

    /** Safely sets a layout property if the layer exists. */
    _setLayout(layerId, prop, value) {
        if (value === undefined || value === null) return;
        if (!this.map.getLayer(layerId)) return;
        try {
            this.map.setLayoutProperty(layerId, prop, value);
        } catch (error) {
            console.warn(`Error setting layout ${prop} on ${layerId}:`, error);
        }
    }

    /**
     * Source config with the layer's `bounds` applied when the source itself declares
     * none. A vector source without bounds is asked for tiles over the whole view, and
     * every tile outside the data's coverage is a wasted request plus an error event. The
     * source's OWN bounds win: a TileJSON source carries the server's, which is the true
     * one.
     *
     * The shape is checked here because, unlike `analysis-layers.manager.js`, this manager
     * has no `_validateLayersConfig`: a three-number `bounds` handed to `addSource` throws
     * and takes the whole layer down.
     * @param {Object} sourceConfig - the layer's `source` (or `labelSource`)
     * @param {Array<number>} [bounds] - [west, south, east, north] from the catalog row
     * @returns {Object} the same object when there is nothing to add, a copy otherwise
     */
    _withBounds(sourceConfig, bounds) {
        if (!sourceConfig || sourceConfig.bounds || !Array.isArray(bounds) || bounds.length !== 4) {
            return sourceConfig;
        }
        return { ...sourceConfig, bounds };
    }

    /** Adds a source if it does not already exist */
    _addSourceSafe(sourceId, sourceConfig) {
        if (!this.map.getSource(sourceId)) {
            this.map.addSource(sourceId, sourceConfig);
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

    /** Safely removes a layer if it exists */
    _removeLayerSafe(layerId) {
        if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
    }

    /** Safely removes a source if it exists */
    _removeSourceSafe(sourceId) {
        if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
    }

    /** Safely removes a registered map image if it exists */
    _removeImageSafe(imageId) {
        if (this.map.hasImage(imageId)) this.map.removeImage(imageId);
    }

    /**
     * Stable map-image id for a layer's marker.
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     * @returns {string}
     */
    _markerImageId(layerId) {
        return `data-${layerId}-marker`;
    }

    /**
     * Registers `style.marker` as a map image, reusing the point tool's symbol
     * generator so no external asset is needed. Called from addDataLayer, which
     * setupDataLayers re-runs on every style load — that is what restores the
     * image after a basemap switch wipes it.
     * @param {Object} layerConfig
     */
    _registerMarkerImage(layerConfig) {
        const marker = layerConfig.style?.marker;
        if (!marker) return;

        const imageId = this._markerImageId(layerConfig.id);
        if (this.map.hasImage(imageId)) return;

        // 'circle' is excluded: points render it as a native circle layer, so
        // the generator has no drawer for it and would emit a blank image.
        if (!needsPerFeatureImage(marker.symbol) || !getSymbolIds().includes(marker.symbol)) {
            console.warn(`Unsupported marker symbol "${marker.symbol}" on data layer ${layerConfig.id}`);
            return;
        }

        try {
            const imageData = generatePointImage(
                marker.symbol,
                marker.color || '#3f4fb5',
                marker.borderColor || '#000000',
                // ?? not || so a valid borderWidth of 0 ("no border") is preserved.
                marker.borderWidth ?? 0
            );
            this.map.addImage(imageId, imageData, { pixelRatio: 2 });
        } catch (error) {
            console.warn(`Error registering marker image for ${layerConfig.id}:`, error);
        }
    }

    _addFillLayer(layerConfig, sourceId, beforeId) {
        const fillLayerId = `data-${layerConfig.id}-fill`;
        if (this.map.getLayer(fillLayerId) || !layerConfig.style?.fill) return;

        this._addLayerSafe({
            id: fillLayerId,
            type: 'fill',
            source: sourceId,
            'source-layer': layerConfig.sourceLayer,
            paint: {
                'fill-color': layerConfig.style.fill.color || 'rgba(0,0,0,0.1)',
                'fill-outline-color': layerConfig.style.fill.outlineColor || 'rgba(0,0,0,0)'
            },
            layout: { visibility: 'none' },
            minzoom: layerConfig.minzoom || 0,
            maxzoom: numberOr(layerConfig.maxzoom, 22)
        }, beforeId);
    }

    _addBorderLayer(layerConfig, sourceId, beforeId) {
        const borderLayerId = `data-${layerConfig.id}-border`;
        if (this.map.getLayer(borderLayerId) || !layerConfig.style?.border) return;

        const paint = {
            'line-color': layerConfig.style.border.color || '#666666',
            'line-width': numberOr(layerConfig.style.border.width, 1),
            'line-opacity': numberOr(layerConfig.style.border.opacity, 1)
        };

        if (layerConfig.style.border.offset) {
            paint['line-offset'] = layerConfig.style.border.offset;
        }

        this._addLayerSafe({
            id: borderLayerId,
            type: 'line',
            source: sourceId,
            'source-layer': layerConfig.sourceLayer,
            paint,
            layout: { visibility: 'none' },
            minzoom: layerConfig.minzoom || 0,
            maxzoom: numberOr(layerConfig.maxzoom, 22)
        }, beforeId);
    }

    _addLabelLayer(layerConfig, labelSourceId, beforeId) {
        const labelLayerId = `data-${layerConfig.id}-label`;
        const label = layerConfig.style?.label;
        const marker = layerConfig.style?.marker;

        // The symbol sub-layer carries the label, the marker, or both — a marker
        // alone is enough to justify creating it.
        if (this.map.getLayer(labelLayerId) || (!label && !marker)) return;

        // Honor any author-specified layout (text-size, text-font, anchor, …) —
        // text-field/visibility are forced afterwards so the layer starts hidden.
        const layout = {
            ...(label?.layout || {}),
            'text-field': label ? (label.textField || ['get', 'name']) : '',
            visibility: 'none'
        };

        // Symbols on polygons are placed at the centroid, so this renders one
        // marker per feature. Gate it by zoom with icon-opacity / icon-size.
        //
        // The `hasImage` check is what ties this to `_registerMarkerImage`, which
        // runs immediately before it and REFUSES some markers ('circle' has no
        // drawer, an unknown symbol has none either, and the generator can throw).
        // Declaring `icon-image` anyway left the sub-layer pointing at an image
        // the map does not hold, and MapLibre answers that with a per-tile
        // "image not found" and no marker.
        const markerImageId = this._markerImageId(layerConfig.id);
        if (marker && !layout['icon-image'] && this.map.hasImage(markerImageId)) {
            layout['icon-image'] = markerImageId;
        }

        if (label?.textAllowOverlap) {
            layout['text-allow-overlap'] = true;
        }

        this._addLayerSafe({
            id: labelLayerId,
            type: 'symbol',
            source: labelSourceId,
            'source-layer': layerConfig.labelSourceLayer || layerConfig.sourceLayer,
            layout,
            paint: label?.paint || {},
            minzoom: layerConfig.labelMinzoom || layerConfig.minzoom || 0,
            maxzoom: numberOr(layerConfig.maxzoom, 22)
        }, beforeId);
    }

    /**
     * Tries to calculate bounds from rendered or source features
     * @returns {Array|null} Bounds as [[west, south], [east, north]]
     * @private
     */
    _getBoundsFromFeatures(layerId, layerConfig) {
        const borderLayerId = `data-${layerId}-border`;
        const fillLayerId = `data-${layerId}-fill`;

        // Try rendered features first
        let features = [];
        if (this.map.getLayer(borderLayerId)) {
            features = this.map.queryRenderedFeatures({ layers: [borderLayerId] });
        }
        if (features.length === 0 && this.map.getLayer(fillLayerId)) {
            features = this.map.queryRenderedFeatures({ layers: [fillLayerId] });
        }

        if (features.length > 0) {
            const bounds = this._calculateBounds(features);
            if (bounds) return bounds;
        }

        // Fallback: query source features
        const sourceId = `data-${layerId}`;
        if (this.map.getSource(sourceId)) {
            const sourceFeatures = this.map.querySourceFeatures(sourceId, {
                sourceLayer: layerConfig.sourceLayer
            });
            if (sourceFeatures.length > 0) return this._calculateBounds(sourceFeatures);
        }

        return null;
    }

    /**
     * Calculates bounding box from GeoJSON features
     * @param {Array} features
     * @returns {Array|null} [[west, south], [east, north]]
     * @private
     */
    _calculateBounds(features) {
        const lngs = [];
        const lats = [];

        const processCoordinates = (coords) => {
            if (typeof coords[0] === 'number') {
                const [lng, lat] = coords;
                // A NaN corner used to vanish: every `<` and `>` against it is
                // false, so the box quietly SHRANK around the bad point instead
                // of reporting anything. It is dropped explicitly now, and a
                // feature whose points are ALL non-finite still yields null.
                if (Number.isFinite(lng) && Number.isFinite(lat)) {
                    lngs.push(lng);
                    lats.push(lat);
                }
            } else {
                coords.forEach(processCoordinates);
            }
        };

        for (const feature of features) {
            if (feature.geometry?.coordinates) {
                processCoordinates(feature.geometry.coordinates);
            }
        }

        if (lngs.length === 0) return null;

        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const [west, east] = antimeridianSafeLngSpan(lngs);

        return [[west, minLat], [east, maxLat]];
    }
}

export default DataLayersManager;
