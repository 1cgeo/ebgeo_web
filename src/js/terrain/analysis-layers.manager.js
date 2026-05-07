// Path: js/terrain/analysis-layers.manager.js
import config from '../config.js';
import { getMapAnalysisLayersStates } from '../store/settings.operations.js';

/**
 * Manages raster analysis layers in the system.
 * State persistence is handled by catalogLayers, not by this manager.
 */
class AnalysisLayersManager {
    constructor(map) {
        this.map = map;
        this._validateLayersConfig();
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
                console.warn(`Analysis layer config not found for: ${layerId}`);
                return;
            }
            this._addAnalysisLayer(layerConfig);
        }

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
        return config.analysisLayers.layers.find(l => l.id === layerId) || null;
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
            const sourceId = `analysis-${layerConfig.id}`;
            const layerId = this._mapLayerId(layerConfig.id);

            try {
                if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
                if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
            } catch (error) {
                console.warn(`Error removing analysis layer ${layerConfig.id}:`, error);
            }
        }
    }

    // --- Private helpers ---

    /** @returns {string} MapLibre layer ID */
    _mapLayerId(layerId) {
        return `analysis-${layerId}-layer`;
    }

    /**
     * Returns the default raster paint properties from the layer's config.
     * Used as the baseline when applying style overrides or resetting to default.
     * @param {string} layerId
     * @returns {Object}
     */
    getDefaultStyle(layerId) {
        const layerConfig = this.getLayerConfig(layerId);
        if (!layerConfig) return {};

        const paint = layerConfig.paint || {};
        return {
            'raster-opacity': layerConfig.opacity ?? paint['raster-opacity'] ?? 1,
            'raster-brightness-min': paint['raster-brightness-min'] ?? 0,
            'raster-brightness-max': paint['raster-brightness-max'] ?? 1,
            'raster-contrast': paint['raster-contrast'] ?? 0,
            'raster-saturation': paint['raster-saturation'] ?? 0,
            'raster-hue-rotate': paint['raster-hue-rotate'] ?? 0
        };
    }

    /**
     * Applies user style overrides to a raster analysis layer.
     * Missing properties fall back to the layer's config defaults.
     * @param {string} layerId
     * @param {Object} overrides - Map of MapLibre paint property → value
     */
    applyStyleOverrides(layerId, overrides) {
        const mapLayerId = this._mapLayerId(layerId);
        if (!this.map.getLayer(mapLayerId)) return;

        const merged = { ...this.getDefaultStyle(layerId), ...(overrides || {}) };
        for (const [prop, value] of Object.entries(merged)) {
            try {
                this.map.setPaintProperty(mapLayerId, prop, value);
            } catch (error) {
                console.warn(`Error setting paint ${prop} on ${mapLayerId}:`, error);
            }
        }
    }

    /** Validates analysis layers configuration at initialization */
    _validateLayersConfig() {
        if (!config.analysisLayers?.enabled) return;

        for (const layer of config.analysisLayers.layers) {
            if (!layer.bounds || !Array.isArray(layer.bounds) || layer.bounds.length !== 4) {
                throw new Error(`Analysis layer "${layer.id}" deve ter bounds válidos [west, south, east, north]`);
            }

            const [west, south, east, north] = layer.bounds;
            if (west >= east || south >= north) {
                throw new Error(`Analysis layer "${layer.id}" tem bounds inválidos: west < east e south < north`);
            }
        }
    }

    /**
     * Adds an individual analysis layer to the map
     * @param {Object} layerConfig - Layer configuration from config.js
     * @param {string} [beforeId='features-separator']
     */
    _addAnalysisLayer(layerConfig, beforeId = 'features-separator') {
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
                        'raster-opacity': layerConfig.opacity || 1.0
                    },
                    layout: { visibility: 'none' }
                };
                this._addLayerSafe(layer, beforeId);
            }
        } catch (error) {
            console.error(`Error adding analysis layer ${layerConfig.id}:`, error);
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
