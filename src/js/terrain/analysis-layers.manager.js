// Path: js/terrain/analysis-layers.manager.js
// Note: Analysis layer state is now managed via catalogLayers, not separate settings
import config from '../config.js';
import { getMapAnalysisLayersStates } from '../store/settings.operations.js';

/**
 * Manages raster analysis layers in the system
 * Single responsibility: configure, position and control analysis layers
 */
class AnalysisLayersManager {
    constructor(map) {
        this.map = map;
        this.validateLayersConfig();
    }

    /**
     * Validates analysis layers configuration at initialization
     * Fails fast if configuration is incorrect
     */
    validateLayersConfig() {
        if (!config.analysisLayers?.enabled) return;

        config.analysisLayers.layers.forEach(layer => {
            if (!layer.bounds || !Array.isArray(layer.bounds) || layer.bounds.length !== 4) {
                throw new Error(`Analysis layer "${layer.id}" deve ter bounds válidos [west, south, east, north]`);
            }

            const [west, south, east, north] = layer.bounds;
            if (west >= east || south >= north) {
                throw new Error(`Analysis layer "${layer.id}" tem bounds inválidos: west < east e south < north`);
            }
        });
    }

    /**
     * Initial setup of analysis layers
     * Adds sources and layers in correct position with visibility: 'none'.
     * Layers are only made visible when explicitly added via catalog.
     */
    async setupAnalysisLayers() {
        if (!this.isEnabled()) {
            return;
        }

        try {
            for (const layerConfig of config.analysisLayers.layers) {
                this.addAnalysisLayer(layerConfig);
            }

            // Note: restoreLayersState() is NOT called here anymore.
            // Analysis layers are restored via restoreCatalogLayers() in layer_setup.js
            // which only activates layers that were explicitly added via catalog.

        } catch (error) {
            console.error('Error setting up analysis layers:', error);
        }
    }

    /**
     * Adds an individual analysis layer in the correct position
     * @param {Object} layerConfig - Layer configuration from config.js
     * @param {string} beforeId - ID of layer to insert before (default: features-separator)
     */
    addAnalysisLayer(layerConfig, beforeId = 'features-separator') {
        const sourceId = `analysis-${layerConfig.id}`;
        const layerId = `analysis-${layerConfig.id}-layer`;

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
                    layout: {
                        visibility: 'none'
                    }
                };

                if (this.map.getLayer(beforeId)) {
                    this.map.addLayer(layer, beforeId);
                } else {
                    this.map.addLayer(layer);
                }
            }

        } catch (error) {
            console.error(`Error adding analysis layer ${layerConfig.id}:`, error);
        }
    }

    /**
     * Toggles visibility of an analysis layer on the map.
     * Note: State persistence is handled by catalogLayers, not by this method.
     * @param {string} layerId - Layer ID (without 'analysis-' prefix)
     * @param {boolean} enabled - true to show, false to hide
     */
    async toggleLayer(layerId, enabled) {
        try {
            // Initialize layer if not already on the map (fallback for lazy init)
            const layerMapId = `analysis-${layerId}-layer`;
            if (!this.map.getLayer(layerMapId)) {
                const layerConfig = this.getLayerConfig(layerId);
                if (!layerConfig) {
                    console.warn(`Analysis layer config not found for: ${layerId}`);
                    return;
                }
                this.addAnalysisLayer(layerConfig);
            }

            // State is managed via catalogLayers (toggleCatalogLayerVisibility)
            // This method only applies the visual change to the map
            this.applyLayerState(layerId, enabled);

        } catch (error) {
            console.error(`Error toggling analysis layer ${layerId}:`, error);
        }
    }

    /**
     * Zooms to bounds of an analysis layer
     * @param {string} layerId - Layer ID (without 'analysis-' prefix)
     */
    zoomToLayer(layerId) {
        try {
            const layerConfig = this.getLayerConfig(layerId);
            if (!layerConfig) {
                console.warn(`Layer config not found for: ${layerId}`);
                return;
            }

            const bounds = layerConfig.bounds;

            this.map.fitBounds(bounds, {
                padding: 20,
                duration: 1000,
                essential: true
            });

        } catch (error) {
            console.error(`Error zooming to analysis layer ${layerId}:`, error);
        }
    }

    /**
     * Gets configuration of a specific layer
     * @param {string} layerId - Layer ID (without 'analysis-' prefix)
     * @returns {Object|null} Layer configuration or null if not found
     */
    getLayerConfig(layerId) {
        return config.analysisLayers.layers.find(l => l.id === layerId) || null;
    }

    /**
     * Applies visibility state of a layer on the map
     * @param {string} layerId - Layer ID (without 'analysis-' prefix)
     * @param {boolean} enabled - true to show, false to hide
     */
    applyLayerState(layerId, enabled) {
        const layerMapId = `analysis-${layerId}-layer`;

        if (this.map.getLayer(layerMapId)) {
            const visibility = enabled ? 'visible' : 'none';
            this.map.setLayoutProperty(layerMapId, 'visibility', visibility);
        } else {
            console.warn(`Analysis layer ${layerMapId} not found on map`);
        }
    }

    /**
     * Restores saved states of all analysis layers
     * Loads from store and applies visibility on the map
     */
    async restoreLayersState() {
        if (!this.isEnabled()) {
            return;
        }

        try {
            const layersStates = await getMapAnalysisLayersStates();

            for (const layerConfig of config.analysisLayers.layers) {
                const isEnabled = layersStates[layerConfig.id] ?? layerConfig.defaultVisibility ?? false;
                this.applyLayerState(layerConfig.id, isEnabled);
            }

        } catch (error) {
            console.error('Error restoring analysis layers states:', error);
        }
    }

    /**
     * Gets layers configurations for UI construction
     * @returns {Array} Array of layer configurations
     */
    getLayersConfig() {
        return config.analysisLayers?.layers || [];
    }

    /**
     * Checks if analysis layers system is enabled
     * @returns {boolean} true if enabled in config
     */
    isEnabled() {
        return config.analysisLayers?.enabled === true &&
               config.analysisLayers.layers?.length > 0;
    }

    /**
     * Gets current state of a specific layer
     * @param {string} layerId - Layer ID (without 'analysis-' prefix)
     * @returns {boolean} true if layer is visible
     */
    isLayerVisible(layerId) {
        const layerMapId = `analysis-${layerId}-layer`;
        const layer = this.map.getLayer(layerMapId);

        if (!layer) return false;

        const visibility = this.map.getLayoutProperty(layerMapId, 'visibility');
        return visibility === 'visible';
    }

    /**
     * Removes all analysis layers from the map
     * Useful for cleanup or reconfiguration
     */
    removeAllLayers() {
        if (!this.isEnabled()) return;

        for (const layerConfig of config.analysisLayers.layers) {
            const sourceId = `analysis-${layerConfig.id}`;
            const layerId = `analysis-${layerConfig.id}-layer`;

            try {
                if (this.map.getLayer(layerId)) {
                    this.map.removeLayer(layerId);
                }

                if (this.map.getSource(sourceId)) {
                    this.map.removeSource(sourceId);
                }
            } catch (error) {
                console.warn(`Error removing analysis layer ${layerConfig.id}:`, error);
            }
        }
    }
}

export default AnalysisLayersManager;
