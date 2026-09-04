// Path: js/terrain/terrain.control.js

import { getEventBus } from '../store';
import { EventTypes } from '../events/event_types.js';
import { getCatalogLayers, toggleCatalogLayerVisibility } from '../store/catalog.operations.js';
import { CATALOG_ITEM_TYPES } from '../catalog/catalog.constants.js';
import { DEFAULT_TERRAIN_EXAGGERATION } from '../store/atlas/atlas.entity.js';

// Elevation reads live in a leaf module so the analysis geometry can be tested
// against a fake map. Re-exported here to keep the historical import path.
export { getTerrainElevation, createTerrainSampler, resolveTerrainLookupZoom } from './terrain-elevation.js';

/**
 * Resolves after the map has rendered one frame, which is when MapLibre applies
 * the pending style changes (a hidden layer releases its tiles there).
 * @param {Object} map - MapLibre map
 * @returns {Promise<void>}
 */
function afterNextRender(map) {
    return new Promise((resolve) => {
        map.once('render', () => resolve());
        map.triggerRepaint();
    });
}

/**
 * Changes the projection without leaving the hillshade tiles stuck.
 *
 * MapLibre 5.18 marks every non-raster source for reload when a layer on it
 * changes or the projection changes, and its `raster-dem` `loadTile` only
 * finishes a tile that has no actor yet or is `expired`: a LOADED tile put in
 * `reloading` keeps that state for ever. Measured on 2026-09-03: after
 * `setProjection({type:'mercator'})` with the hillshade visible, all 28 hillshade
 * tiles stayed `reloading`, `map.loaded()` stayed false and `idle` never fired
 * again, which is what the screenshot control waits for.
 *
 * The way out uses only public API and takes two frames: hide the hillshade
 * layer, let one render release its tiles (a reload of a source with no tiles is
 * a no-op), change the projection, and show the layer again so its tiles load
 * fresh. Hiding and showing in the SAME frame does not work: the reload marker
 * is processed before the tiles are released, and the tiles get stuck anyway.
 *
 * @param {Object} map - MapLibre map
 * @param {{ type: string }} projection - Projection to apply
 * @param {string} [hillshadeLayerId='hillshade']
 * @returns {Promise<void>} Resolves once the projection is applied and the layer restored
 */
export async function setProjectionKeepingHillshade(map, projection, hillshadeLayerId = 'hillshade') {
    const hasLayer = !!map.getLayer(hillshadeLayerId);
    const wasVisible = hasLayer && map.getLayoutProperty(hillshadeLayerId, 'visibility') !== 'none';
    if (!wasVisible) {
        map.setProjection(projection);
        return;
    }
    map.setLayoutProperty(hillshadeLayerId, 'visibility', 'none');
    await afterNextRender(map);
    map.setProjection(projection);
    await afterNextRender(map);
    if (map.getLayer(hillshadeLayerId)) {
        map.setLayoutProperty(hillshadeLayerId, 'visibility', 'visible');
    }
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
    async _toggleTerrain() {
        if (!this.terrainSourceConfig) {
            console.warn('Terrain configuration not available');
            return;
        }

        if (this._map.getTerrain()) {
            this._wasTerrainActive = false;
            this._map.setTerrain(null);
            await this._restoreGlobeProjection();
            this._map.easeTo({ pitch: 0, duration: 500 });
        } else {
            // Globe + terrain is a known MapLibre bug (#4792, #4927). The
            // projection change is awaited so the terrain never meets the globe.
            await this._disableGlobeForTerrain();
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

        await this._disableGlobeForTerrain();
        await this._setupTerrainSources();
        this._map.setTerrain(this.terrainConfig);
    }

    /**
     * Mercator for the terrain. Skips the projection call when the map is
     * already there: the call itself is what reloads the DEM tiles.
     * @returns {Promise<void>}
     */
    async _disableGlobeForTerrain() {
        if (this._globeProjection && this._map.getProjection?.()?.type !== 'mercator') {
            await setProjectionKeepingHillshade(this._map, { type: 'mercator' });
        }
    }

    /** @returns {Promise<void>} */
    async _restoreGlobeProjection() {
        if (this._globeProjection) {
            if (this._map.getProjection?.()?.type !== 'globe') {
                await setProjectionKeepingHillshade(this._map, { type: 'globe' });
            }
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
