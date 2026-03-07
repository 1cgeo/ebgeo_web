// Path: js/terrain/terrain.control.js

import { getEventBus } from '../store';
import { EventTypes } from '../events/event_types.js';
import { getCatalogLayers, toggleCatalogLayerVisibility } from '../store/catalog.operations.js';
import { CATALOG_ITEM_TYPES } from '../catalog/catalog.constants.js';
import { DEFAULT_TERRAIN_EXAGGERATION } from '../store/atlas/atlas.entity.js';

/**
 * Gets terrain elevation at given coordinates
 * @param {Object} map - MapLibre GL map instance
 * @param {Array|Object} coordinates - [lng, lat] or {lng, lat}
 * @param {Object} options - Query options
 * @returns {Promise<number>} Elevation in meters
 */
export async function getTerrainElevation(map, coordinates, options = { exaggerated: false }) {
    const terrain = map.getTerrain();
    if (!terrain) return 0;

    const fixedPoint = [0, 0];
    const fixedPointElevation = await map.queryTerrainElevation(fixedPoint, options) || 0;
    const sceneElevation = await map.queryTerrainElevation(coordinates, options) || 0;
    const altitude = sceneElevation - fixedPointElevation;

    return altitude / (terrain.exaggeration || 1.5);
}

class TerrainControl {
    constructor(config) {
        this.terrainSourceConfig = config.terrainSource;
        this.hillshadeSourceConfig = config.hillshadeSource;
        this.hillshadeConfig = config.hillshade;
        this._exaggeration = DEFAULT_TERRAIN_EXAGGERATION;
        this._globeProjection = config.globe_projection || false;
        this._wasTerrainActive = false;
        this._map = null;
        this._container = null;
        this._name = 'TerrainControl';
        this._terrainPitch = 60;
        this._unsubBaseLayerChanged = null;
    }

    /** @returns {{ source: string, exaggeration: number }} */
    get terrainConfig() {
        return { source: 'terrainSource', exaggeration: this._exaggeration };
    }

    /**
     * Sets the exaggeration value without triggering a map update (startup use)
     * @param {number} value
     */
    initExaggeration(value) {
        this._exaggeration = value;
    }

    /**
     * Sets the exaggeration value and updates the live terrain if active
     * @param {number} value
     */
    setExaggeration(value) {
        this._exaggeration = value;
        if (this._map?.getTerrain()) {
            this._map.setTerrain(this.terrainConfig);
        }
    }

    onAdd(map) {
        this._map = map;
        // UI is handled by BottomControlsControl - return hidden container
        this._container = document.createElement('div');
        this._container.style.display = 'none';

        this._handleBaseLayerChanged = this._handleBaseLayerChanged.bind(this);
        this._unsubBaseLayerChanged = getEventBus().on(EventTypes.BASE_LAYER_CHANGED, this._handleBaseLayerChanged);

        return this._container;
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

    /**
     * Toggles terrain on/off.
     * When activating: disables globe, enables terrain with pitch, enables hillshade.
     * When deactivating: resets pitch, restores globe.
     */
    _toggleTerrain() {
        if (!this.terrainSourceConfig) {
            console.warn('Terrain configuration not available');
            return;
        }

        if (this._map.getTerrain()) {
            this._wasTerrainActive = false;
            this._map.setTerrain(null);
            this._restoreGlobeProjection();
            this._map.easeTo({ pitch: 0, duration: 500 });
        } else {
            // Globe + terrain is a known MapLibre bug (#4792, #4927)
            this._disableGlobeForTerrain();
            this._wasTerrainActive = true;
            this._map.setTerrain(this.terrainConfig);
            this._map.easeTo({ pitch: this._terrainPitch, duration: 500 });
            this._ensureHillshadeEnabled();
        }
    }

    /**
     * Controls hillshade layer visibility.
     * Creates source and layer on demand when enabling for the first time.
     * @param {boolean} enabled
     */
    setHillshadeVisibility(enabled) {
        if (!this.hillshadeConfig?.enabled) return;

        if (enabled) {
            if (!this._map.getSource('hillshadeSource')) {
                if (!this.hillshadeSourceConfig) {
                    console.warn('Hillshade source configuration not available');
                    return;
                }
                this._map.addSource('hillshadeSource', this.hillshadeSourceConfig);
            }

            if (!this._map.getLayer('hillshade')) {
                this._addHillshadeLayerInCorrectPosition();
            }
        }

        if (!this._map.getLayer('hillshade')) return;

        try {
            this._map.setLayoutProperty('hillshade', 'visibility', enabled ? 'visible' : 'none');
        } catch (error) {
            console.error('Error changing hillshade visibility:', error);
        }
    }

    // --- Private helpers ---

    /** Restores terrain after a base layer change */
    async _handleBaseLayerChanged() {
        if (!this._wasTerrainActive) return;

        this._disableGlobeForTerrain();
        await this._setupTerrainSources();
        this._map.setTerrain(this.terrainConfig);
    }

    _disableGlobeForTerrain() {
        if (this._globeProjection) {
            this._map.setProjection({ type: 'mercator' });
        }
    }

    _restoreGlobeProjection() {
        if (this._globeProjection) {
            this._map.setProjection({ type: 'globe' });
            this._map.setSky(undefined);
        }
    }

    _setupTerrainSources() {
        if (!this.terrainSourceConfig) {
            console.warn('Terrain source configuration not available');
            return;
        }

        if (!this._map.getSource('terrainSource')) {
            this._map.addSource('terrainSource', this.terrainSourceConfig);
        }
    }

    /**
     * Enables hillshade when terrain is activated, if it exists in catalog but is hidden
     * @private
     */
    async _ensureHillshadeEnabled() {
        if (!this.hillshadeConfig?.enabled) return;

        try {
            const catalogLayers = await getCatalogLayers();
            const hillshadeLayer = catalogLayers?.find(l => l.type === CATALOG_ITEM_TYPES.HILLSHADE);

            if (hillshadeLayer && !hillshadeLayer.visible) {
                await toggleCatalogLayerVisibility(hillshadeLayer.id, true);
                this.setHillshadeVisibility(true);
            }
        } catch (error) {
            console.warn('Error enabling hillshade with terrain:', error);
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
