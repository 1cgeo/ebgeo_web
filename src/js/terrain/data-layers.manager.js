// Path: js/terrain/data-layers.manager.js
// Manages vector data layers (molduras, etc.) from config.dataLayers
import config from '../config.js';

/**
 * Manages vector data layers in the system
 * Single responsibility: configure, position and control data layers (molduras, etc.)
 */
class DataLayersManager {
    constructor(map) {
        this.map = map;
        this._initializedLayers = new Set();
    }

    /**
     * Checks if data layers system is enabled
     * @returns {boolean} true if enabled in config
     */
    isEnabled() {
        return config.dataLayers?.enabled === true &&
               config.dataLayers.layers?.length > 0;
    }

    /**
     * Gets configuration of a specific layer
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     * @returns {Object|null} Layer configuration or null if not found
     */
    getLayerConfig(layerId) {
        return config.dataLayers?.layers?.find(l => l.id === layerId) || null;
    }

    /**
     * Gets all layers configurations for UI construction
     * @returns {Array} Array of layer configurations
     */
    getLayersConfig() {
        return config.dataLayers?.layers || [];
    }

    /**
     * Adds a data layer to the map
     * Creates sources and layers with visibility: 'none' initially
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     * @param {string} beforeId - ID of layer to insert before (default: features-separator)
     */
    addDataLayer(layerId, beforeId = 'features-separator') {
        const layerConfig = this.getLayerConfig(layerId);
        if (!layerConfig) {
            console.warn(`Data layer config not found: ${layerId}`);
            return false;
        }

        const sourceId = `data-${layerConfig.id}`;
        const fillLayerId = `data-${layerConfig.id}-fill`;
        const borderLayerId = `data-${layerConfig.id}-border`;
        const labelLayerId = `data-${layerConfig.id}-label`;

        try {
            // Add main source
            if (!this.map.getSource(sourceId)) {
                this.map.addSource(sourceId, layerConfig.source);
            }

            // Add label source if different
            const labelSourceId = layerConfig.labelSource ? `data-${layerConfig.id}-label-source` : sourceId;
            if (layerConfig.labelSource && !this.map.getSource(labelSourceId)) {
                this.map.addSource(labelSourceId, layerConfig.labelSource);
            }

            // Add fill layer
            if (!this.map.getLayer(fillLayerId) && layerConfig.style?.fill) {
                const fillLayer = {
                    id: fillLayerId,
                    type: 'fill',
                    source: sourceId,
                    'source-layer': layerConfig.sourceLayer,
                    paint: {
                        'fill-color': layerConfig.style.fill.color || 'rgba(0,0,0,0.1)',
                        'fill-outline-color': layerConfig.style.fill.outlineColor || 'rgba(0,0,0,0)'
                    },
                    layout: {
                        visibility: 'none'
                    },
                    minzoom: layerConfig.minzoom || 0,
                    maxzoom: layerConfig.maxzoom || 22
                };

                if (this.map.getLayer(beforeId)) {
                    this.map.addLayer(fillLayer, beforeId);
                } else {
                    this.map.addLayer(fillLayer);
                }
            }

            // Add border layer
            if (!this.map.getLayer(borderLayerId) && layerConfig.style?.border) {
                const borderLayer = {
                    id: borderLayerId,
                    type: 'line',
                    source: sourceId,
                    'source-layer': layerConfig.sourceLayer,
                    paint: {
                        'line-color': layerConfig.style.border.color || '#666666',
                        'line-width': layerConfig.style.border.width || 1,
                        'line-opacity': layerConfig.style.border.opacity || 1
                    },
                    layout: {
                        visibility: 'none'
                    },
                    minzoom: layerConfig.minzoom || 0,
                    maxzoom: layerConfig.maxzoom || 22
                };

                if (layerConfig.style.border.offset) {
                    borderLayer.paint['line-offset'] = layerConfig.style.border.offset;
                }

                if (this.map.getLayer(beforeId)) {
                    this.map.addLayer(borderLayer, beforeId);
                } else {
                    this.map.addLayer(borderLayer);
                }
            }

            // Add label layer
            if (!this.map.getLayer(labelLayerId) && layerConfig.style?.label) {
                const labelLayer = {
                    id: labelLayerId,
                    type: 'symbol',
                    source: labelSourceId,
                    'source-layer': layerConfig.labelSourceLayer || layerConfig.sourceLayer,
                    layout: {
                        'text-field': layerConfig.style.label.textField || ['get', 'name'],
                        visibility: 'none'
                    },
                    paint: layerConfig.style.label.paint || {},
                    minzoom: layerConfig.labelMinzoom || layerConfig.minzoom || 0,
                    maxzoom: layerConfig.maxzoom || 22
                };

                if (layerConfig.style.label.textAllowOverlap) {
                    labelLayer.layout['text-allow-overlap'] = true;
                }

                if (this.map.getLayer(beforeId)) {
                    this.map.addLayer(labelLayer, beforeId);
                } else {
                    this.map.addLayer(labelLayer);
                }
            }

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
     * @param {boolean} enabled - true to show, false to hide
     */
    toggleLayer(layerId, enabled) {
        // Initialize layer if not already done
        if (!this._initializedLayers.has(layerId)) {
            const added = this.addDataLayer(layerId);
            if (!added) return;
        }

        this.applyLayerState(layerId, enabled);
    }

    /**
     * Applies visibility state of a layer on the map
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     * @param {boolean} enabled - true to show, false to hide
     */
    applyLayerState(layerId, enabled) {
        const fillLayerId = `data-${layerId}-fill`;
        const borderLayerId = `data-${layerId}-border`;
        const labelLayerId = `data-${layerId}-label`;

        const visibility = enabled ? 'visible' : 'none';

        if (this.map.getLayer(fillLayerId)) {
            this.map.setLayoutProperty(fillLayerId, 'visibility', visibility);
        }

        if (this.map.getLayer(borderLayerId)) {
            this.map.setLayoutProperty(borderLayerId, 'visibility', visibility);
        }

        if (this.map.getLayer(labelLayerId)) {
            this.map.setLayoutProperty(labelLayerId, 'visibility', visibility);
        }
    }

    /**
     * Gets current state of a specific layer
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     * @returns {boolean} true if layer is visible
     */
    isLayerVisible(layerId) {
        const borderLayerId = `data-${layerId}-border`;
        const layer = this.map.getLayer(borderLayerId);

        if (!layer) return false;

        const visibility = this.map.getLayoutProperty(borderLayerId, 'visibility');
        return visibility === 'visible';
    }

    /**
     * Removes a data layer from the map
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     */
    removeLayer(layerId) {
        const sourceId = `data-${layerId}`;
        const labelSourceId = `data-${layerId}-label-source`;
        const fillLayerId = `data-${layerId}-fill`;
        const borderLayerId = `data-${layerId}-border`;
        const labelLayerId = `data-${layerId}-label`;

        try {
            // Remove layers
            if (this.map.getLayer(labelLayerId)) {
                this.map.removeLayer(labelLayerId);
            }
            if (this.map.getLayer(borderLayerId)) {
                this.map.removeLayer(borderLayerId);
            }
            if (this.map.getLayer(fillLayerId)) {
                this.map.removeLayer(fillLayerId);
            }

            // Remove sources
            if (this.map.getSource(labelSourceId)) {
                this.map.removeSource(labelSourceId);
            }
            if (this.map.getSource(sourceId)) {
                this.map.removeSource(sourceId);
            }

            this._initializedLayers.delete(layerId);

        } catch (error) {
            console.warn(`Error removing data layer ${layerId}:`, error);
        }
    }

    /**
     * Removes all data layers from the map
     */
    removeAllLayers() {
        for (const layerId of this._initializedLayers) {
            this.removeLayer(layerId);
        }
    }
}

export default DataLayersManager;
