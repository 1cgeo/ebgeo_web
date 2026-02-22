// Path: js/terrain/data-layers.manager.js
// Manages vector data layers (molduras, etc.) from config.dataLayers
// Note: Data layer state is now managed via catalogLayers, not separate settings
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
     * Initial setup of data layers
     * Adds sources and layers in correct position with visibility: 'none'.
     * Layers are only made visible when explicitly added via catalog.
     */
    async setupDataLayers() {
        if (!this.isEnabled()) {
            return;
        }

        try {
            // Clear initialized layers tracking (important for style changes/basemap switches)
            this._initializedLayers.clear();

            for (const layerConfig of config.dataLayers.layers) {
                this.addDataLayer(layerConfig.id);
            }

            // Note: restoreLayersState() is NOT called here anymore.
            // Data layers are restored via restoreCatalogLayers() in layer_setup.js
            // which only activates layers that were explicitly added via catalog.

        } catch (error) {
            console.error('Error setting up data layers:', error);
        }
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
     * @returns {boolean} true if layer was added successfully
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
     * Toggles visibility of a data layer on the map.
     * Note: State persistence is handled by catalogLayers, not by this method.
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     * @param {boolean} enabled - true to show, false to hide
     */
    async toggleLayer(layerId, enabled) {
        try {
            // Initialize layer if not already done (fallback for lazy init)
            if (!this._initializedLayers.has(layerId)) {
                const added = this.addDataLayer(layerId);
                if (!added) return;
            }

            // State is managed via catalogLayers (toggleCatalogLayerVisibility)
            // This method only applies the visual change to the map
            this.applyLayerState(layerId, enabled);

        } catch (error) {
            console.error(`Error toggling data layer ${layerId}:`, error);
        }
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
     * Zooms to the extent of a data layer's visible features
     * Calculates bounds from currently loaded vector tiles
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     */
    zoomToLayer(layerId) {
        try {
            const layerConfig = this.getLayerConfig(layerId);
            if (!layerConfig) {
                console.warn(`Layer config not found for: ${layerId}`);
                return;
            }

            // Try to get bounds from rendered features
            const borderLayerId = `data-${layerId}-border`;
            const fillLayerId = `data-${layerId}-fill`;

            // Query rendered features from the layer
            let features = [];
            if (this.map.getLayer(borderLayerId)) {
                features = this.map.queryRenderedFeatures({ layers: [borderLayerId] });
            }
            if (features.length === 0 && this.map.getLayer(fillLayerId)) {
                features = this.map.queryRenderedFeatures({ layers: [fillLayerId] });
            }

            if (features.length > 0) {
                // Calculate bounds from features
                const bounds = this._calculateBoundsFromFeatures(features);
                if (bounds) {
                    this.map.fitBounds(bounds, {
                        padding: 20,
                        duration: 1000,
                        essential: true
                    });
                    return;
                }
            }

            // Fallback: query source features if available
            const sourceId = `data-${layerId}`;
            const source = this.map.getSource(sourceId);
            if (source) {
                // For vector tile sources, we need to query source features
                const sourceFeatures = this.map.querySourceFeatures(sourceId, {
                    sourceLayer: layerConfig.sourceLayer
                });

                if (sourceFeatures.length > 0) {
                    const bounds = this._calculateBoundsFromFeatures(sourceFeatures);
                    if (bounds) {
                        this.map.fitBounds(bounds, {
                            padding: 20,
                            duration: 1000,
                            essential: true
                        });
                        return;
                    }
                }
            }

            console.warn(`No features found for layer "${layerId}" to calculate bounds`);

        } catch (error) {
            console.error(`Error zooming to data layer ${layerId}:`, error);
        }
    }

    /**
     * Calculates bounding box from an array of GeoJSON features
     * @param {Array} features - Array of GeoJSON features
     * @returns {Array|null} Bounds as [[west, south], [east, north]] or null
     * @private
     */
    _calculateBoundsFromFeatures(features) {
        if (!features || features.length === 0) return null;

        let minLng = Infinity;
        let minLat = Infinity;
        let maxLng = -Infinity;
        let maxLat = -Infinity;

        const processCoordinates = (coords) => {
            if (typeof coords[0] === 'number') {
                // It's a point [lng, lat]
                const [lng, lat] = coords;
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
            } else {
                // It's an array of coordinates
                coords.forEach(processCoordinates);
            }
        };

        for (const feature of features) {
            if (feature.geometry && feature.geometry.coordinates) {
                processCoordinates(feature.geometry.coordinates);
            }
        }

        if (minLng === Infinity || minLat === Infinity ||
            maxLng === -Infinity || maxLat === -Infinity) {
            return null;
        }

        return [[minLng, minLat], [maxLng, maxLat]];
    }

    /**
     * Gets current state of a specific layer
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     * @returns {boolean} true if layer is visible
     */
    isLayerVisible(layerId) {
        const borderLayerId = `data-${layerId}-border`;
        const fillLayerId = `data-${layerId}-fill`;

        // Check border layer first, then fill layer
        let layerToCheck = borderLayerId;
        if (!this.map.getLayer(borderLayerId)) {
            layerToCheck = fillLayerId;
        }

        const layer = this.map.getLayer(layerToCheck);
        if (!layer) return false;

        const visibility = this.map.getLayoutProperty(layerToCheck, 'visibility');
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
     * Useful for cleanup or reconfiguration
     */
    removeAllLayers() {
        if (!this.isEnabled()) return;

        for (const layerId of this._initializedLayers) {
            this.removeLayer(layerId);
        }
    }
}

export default DataLayersManager;
