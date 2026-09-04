// Path: js/terrain/data-layers.manager.js
// Manages vector data layers (molduras, etc.) from config.dataLayers
import config from '../config.js';
import { LAYOUT_PROPS } from '@layers/layer-style/layer-style.schema.js';
import { generatePointImage, needsPerFeatureImage, getSymbolIds } from '@js/draw_tools/point_tool/point-marker-symbols.js';

/**
 * Manages vector data layers in the system.
 * State persistence is handled by catalogLayers, not by this manager.
 */
class DataLayersManager {
    constructor(map) {
        this.map = map;
        this._initializedLayers = new Set();
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
     * @returns {boolean} true if layer was added successfully
     */
    addDataLayer(layerId, beforeId = 'features-separator') {
        const layerConfig = this.getLayerConfig(layerId);
        if (!layerConfig) {
            console.warn(`Data layer config not found: ${layerId}`);
            return false;
        }

        const sourceId = `data-${layerConfig.id}`;

        try {
            this._addSourceSafe(sourceId, this._withBounds(layerConfig.source, layerConfig.bounds));

            // Add label source if different from main source
            const labelSourceId = layerConfig.labelSource ? `data-${layerConfig.id}-label-source` : sourceId;
            if (layerConfig.labelSource) {
                this._addSourceSafe(labelSourceId, layerConfig.labelSource);
            }

            this._registerMarkerImage(layerConfig);

            this._addFillLayer(layerConfig, sourceId, beforeId);
            this._addBorderLayer(layerConfig, sourceId, beforeId);
            this._addLabelLayer(layerConfig, labelSourceId, beforeId);

            this._initializedLayers.add(layerId);
            return true;
        } catch (error) {
            console.error(`Error adding data layer ${layerId}:`, error);
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
            const added = this.addDataLayer(layerId);
            if (!added) return;
        }

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
                    // Mirror _addBorderLayer's fallbacks exactly (|| 1, || '#666666').
                    values: {
                        'line-color': border?.color || '#666666',
                        'line-width': border?.width || 1,
                        'line-opacity': border?.opacity || 1
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

    /** Adds a source if it does not already exist */
    /**
     * Source config with the layer's `bounds` applied when the source itself
     * declares none. A vector source without bounds is asked for tiles over the
     * whole view, and every tile outside the data's coverage is a wasted request.
     * @param {Object} sourceConfig
     * @param {Array<number>} [bounds] - [west, south, east, north]
     * @returns {Object}
     */
    _withBounds(sourceConfig, bounds) {
        if (!sourceConfig || sourceConfig.bounds || !Array.isArray(bounds) || bounds.length !== 4) {
            return sourceConfig;
        }
        return { ...sourceConfig, bounds };
    }

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
            maxzoom: layerConfig.maxzoom || 22
        }, beforeId);
    }

    _addBorderLayer(layerConfig, sourceId, beforeId) {
        const borderLayerId = `data-${layerConfig.id}-border`;
        if (this.map.getLayer(borderLayerId) || !layerConfig.style?.border) return;

        const paint = {
            'line-color': layerConfig.style.border.color || '#666666',
            'line-width': layerConfig.style.border.width || 1,
            'line-opacity': layerConfig.style.border.opacity || 1
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
            maxzoom: layerConfig.maxzoom || 22
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
        if (marker && !layout['icon-image']) {
            layout['icon-image'] = this._markerImageId(layerConfig.id);
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
            maxzoom: layerConfig.maxzoom || 22
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
        let minLng = Infinity;
        let minLat = Infinity;
        let maxLng = -Infinity;
        let maxLat = -Infinity;

        const processCoordinates = (coords) => {
            if (typeof coords[0] === 'number') {
                const [lng, lat] = coords;
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
            } else {
                coords.forEach(processCoordinates);
            }
        };

        for (const feature of features) {
            if (feature.geometry?.coordinates) {
                processCoordinates(feature.geometry.coordinates);
            }
        }

        if (minLng === Infinity) return null;

        return [[minLng, minLat], [maxLng, maxLat]];
    }
}

export default DataLayersManager;
