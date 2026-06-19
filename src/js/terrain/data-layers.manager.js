// Path: js/terrain/data-layers.manager.js
// Manages vector data layers (molduras, etc.) from config.dataLayers
import config from '../config.js';

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
            this._addSourceSafe(sourceId, layerConfig.source);

            // Add label source if different from main source
            const labelSourceId = layerConfig.labelSource ? `data-${layerConfig.id}-label-source` : sourceId;
            if (layerConfig.labelSource) {
                this._addSourceSafe(labelSourceId, layerConfig.labelSource);
            }

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
     * Returns the default style values for a vector data layer.
     * Flat map of property names matching applyStyleOverrides keys.
     * @param {string} layerId
     * @returns {Object}
     */
    getDefaultStyle(layerId) {
        const layerConfig = this.getLayerConfig(layerId);
        if (!layerConfig) return {};

        const fill = layerConfig.style?.fill || {};
        const border = layerConfig.style?.border || {};
        const label = layerConfig.style?.label || {};
        const labelPaint = label.paint || {};
        const labelLayout = label.layout || {};

        return {
            'fill-color': fill.color || 'rgba(0,0,0,0.1)',
            'fill-opacity': fill.opacity ?? 1,
            'line-color': border.color || '#666666',
            'line-width': border.width ?? 1,
            'line-opacity': border.opacity ?? 1,
            'text-color': labelPaint['text-color'] || '#000000',
            'text-halo-color': labelPaint['text-halo-color'] || '#ffffff',
            'text-halo-width': labelPaint['text-halo-width'] ?? 1,
            'text-size': labelLayout['text-size'] ?? labelPaint['text-size'] ?? 12
        };
    }

    /**
     * Applies user style overrides to fill / border / label sub-layers.
     * Missing properties fall back to config defaults.
     * @param {string} layerId
     * @param {Object} overrides - Flat map of property → value
     */
    applyStyleOverrides(layerId, overrides) {
        const merged = { ...this.getDefaultStyle(layerId), ...(overrides || {}) };

        const fillId = `data-${layerId}-fill`;
        const borderId = `data-${layerId}-border`;
        const labelId = `data-${layerId}-label`;

        this._setPaint(fillId, 'fill-color', merged['fill-color']);
        this._setPaint(fillId, 'fill-opacity', merged['fill-opacity']);

        this._setPaint(borderId, 'line-color', merged['line-color']);
        this._setPaint(borderId, 'line-width', merged['line-width']);
        this._setPaint(borderId, 'line-opacity', merged['line-opacity']);

        this._setPaint(labelId, 'text-color', merged['text-color']);
        this._setPaint(labelId, 'text-halo-color', merged['text-halo-color']);
        this._setPaint(labelId, 'text-halo-width', merged['text-halo-width']);
        this._setLayout(labelId, 'text-size', merged['text-size']);
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
        if (this.map.getLayer(labelLayerId) || !layerConfig.style?.label) return;

        const layout = {
            'text-field': layerConfig.style.label.textField || ['get', 'name'],
            visibility: 'none'
        };

        if (layerConfig.style.label.textAllowOverlap) {
            layout['text-allow-overlap'] = true;
        }

        this._addLayerSafe({
            id: labelLayerId,
            type: 'symbol',
            source: labelSourceId,
            'source-layer': layerConfig.labelSourceLayer || layerConfig.sourceLayer,
            layout,
            paint: layerConfig.style.label.paint || {},
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
