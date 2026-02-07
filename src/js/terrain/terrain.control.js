// Path: js/terrain/terrain.control.js

import { getEventBus } from '../store';
import { EventTypes } from '../events/event_types.js';

// Hillshade is managed via catalog - no automatic state needed

/**
 * Gets terrain elevation at given coordinates
 * @param {Object} map - MapLibre GL map instance
 * @param {Array|Object} coordinates - [lng, lat] or {lng, lat}
 * @param {Object} options - Query options
 * @returns {Promise<number>} Elevation in meters
 */
export async function getTerrainElevation(map, coordinates, options = { exaggerated: false }) {
    const fixedPoint = [0, 0];
    const fixedPointElevation = await map.queryTerrainElevation(fixedPoint, options) || 0;

    const sceneElevation = await map.queryTerrainElevation(coordinates, options) || 0;
    const altitude = sceneElevation - fixedPointElevation;

    const terrain = map.getTerrain();
    const exaggeration = terrain?.exaggeration || 1.5;

    return altitude / exaggeration;
}

class TerrainControl {
    constructor(config) {
        this.terrainSourceConfig = config.terrainSource;
        this.hillshadeSourceConfig = config.hillshadeSource;
        this.terrainConfig = config.terrain;
        this.hillshadeConfig = config.hillshade;
        this._wasTerrainActive = false;
        this._map = null;
        this._container = null;
        this._button = null;
        this._name = 'TerrainControl';
        this._terrainPitch = 60; // Pitch angle when terrain is active (like Google Maps 3D)
        this._unsubBaseLayerChanged = null;
    }

    onAdd(map) {
        this._map = map;
        // UI is now handled by BottomControlsControl - return empty container
        this._container = document.createElement('div');
        this._container.style.display = 'none';

        // Listen for base layer changes to restore terrain if it was active
        this._unsubBaseLayerChanged = getEventBus().on(EventTypes.BASE_LAYER_CHANGED, this._handleBaseLayerChanged);

        return this._container;
    }

    /**
     * Handles base layer change event.
     * Restores terrain if it was active before the base layer change.
     * @private
     */
    _handleBaseLayerChanged = async () => {
        if (this._wasTerrainActive) {
            // Re-add terrain source and restore terrain
            await this._setupTerrainSources();
            this._map.setTerrain(this.terrainConfig);
        }
    }

    onRemove() {
        if (this._unsubBaseLayerChanged) {
            this._unsubBaseLayerChanged();
            this._unsubBaseLayerChanged = null;
        }
        if (this._container?.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }
        this._map = undefined;
    }

    _setupTerrainSources = async () => {
        if (!this.terrainSourceConfig) {
            console.warn('Terrain source configuration not available');
            return;
        }

        if (!this._map.getSource('terrainSource')) {
            this._map.addSource('terrainSource', this.terrainSourceConfig);
        }

        // Hillshade source/layer are only added when explicitly requested via catalog
        // No automatic initialization here
        // UI state is managed by BottomControlsControl
    }

    _toggleTerrain = () => {
        if (!this.terrainSourceConfig) {
            console.warn('Terrain configuration not available');
            return;
        }

        if (this._map.getTerrain()) {
            // Deactivating terrain - reset pitch to 0
            this._wasTerrainActive = false;
            this._map.setTerrain(null);
            this._map.easeTo({
                pitch: 0,
                duration: 500
            });
        } else {
            // Activating terrain - apply 3D pitch
            this._wasTerrainActive = true;
            this._map.setTerrain(this.terrainConfig);
            this._map.easeTo({
                pitch: this._terrainPitch,
                duration: 500
            });
        }
    }


    // ===== HILLSHADE VISIBILITY CONTROL =====

    /**
     * Controls hillshade layer visibility.
     * Creates source and layer on demand when enabling for the first time.
     * @param {boolean} enabled - true to show, false to hide
     */
    setHillshadeVisibility = (enabled) => {
        if (!this.hillshadeConfig?.enabled) {
            return;
        }

        // When enabling, ensure source and layer exist
        if (enabled) {
            // Add source if needed
            if (!this._map.getSource('hillshadeSource')) {
                if (!this.hillshadeSourceConfig) {
                    console.warn('Hillshade source configuration not available');
                    return;
                }
                this._map.addSource('hillshadeSource', this.hillshadeSourceConfig);
            }

            // Add layer if needed
            if (!this._map.getLayer('hillshade')) {
                this._addHillshadeLayerInCorrectPosition();
            }
        }

        // If disabling and layer doesn't exist, nothing to do
        if (!enabled && !this._map.getLayer('hillshade')) {
            return;
        }

        const visibility = enabled ? 'visible' : 'none';
        try {
            this._map.setLayoutProperty('hillshade', 'visibility', visibility);
        } catch (error) {
            console.error('Error changing hillshade visibility:', error);
        }
    }

    _addHillshadeLayerInCorrectPosition() {
        const beforeId = 'analysis-separator';

        try {
            if (this._map.getLayer(beforeId)) {
                this._map.addLayer(this.hillshadeConfig.layer, beforeId);
            } else {
                this._map.addLayer(this.hillshadeConfig.layer);
                console.warn('Separator analysis-separator not found, adding hillshade without reference');
            }
        } catch (error) {
            console.error('Error adding hillshade layer:', error);
        }
    }
}

export default TerrainControl;
