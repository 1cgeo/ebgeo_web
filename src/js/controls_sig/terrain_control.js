// Path: js/controls_sig/terrain_control.js

import { getMapHillshadeState } from './store/store.js';

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
    }

    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl terrain-control controls-column-left';

        this._button = document.createElement('button');
        this._button.type = 'button';
        this._button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        this._button.setAttribute("id", "terrain-tool");
        this._button.title = 'Ligar/desligar terreno 3D';
        this._button.onclick = this._toggleTerrain;

        this._container.appendChild(this._button);

        this._map.on('terrain', this._updateTerrainIcon);

        return this._container;
    }

    onRemove() {
        if (this._map) {
            this._map.off('terrain', this._updateTerrainIcon);
        }
        this._container.parentNode.removeChild(this._container);
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

        if (this.hillshadeConfig?.enabled) {
            if (!this._map.getSource('hillshadeSource')) {
                this._map.addSource('hillshadeSource', this.hillshadeSourceConfig);
            }

            try {
                const hillshadeEnabled = await getMapHillshadeState();
                this.setHillshadeVisibility(hillshadeEnabled);
            } catch (error) {
                console.warn('Error restoring hillshade state:', error);
                this.setHillshadeVisibility(false);
            }
        }
        this._updateTerrainIcon()
    }

    _toggleTerrain = () => {
        if (!this.terrainSourceConfig) {
            console.warn('Terrain configuration not available');
            return;
        }

        if (this._map.getTerrain()) {
            this._wasTerrainActive = false;
            this._map.setTerrain(null);
        } else {
            this._wasTerrainActive = true;
            this._map.setTerrain(this.terrainConfig);
        }
    }

    _updateTerrainIcon = () => {
        if (!this._button || !this.terrainSourceConfig) {
            this._button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_terrain_disabled.svg" alt="TERRAIN DISABLED" />';
            this._button.disabled = true;
            this._button.title = 'Terreno não disponível';
            return;
        }

        const terrainSourceExists = this._map.getSource('terrainSource') !== undefined;
        if (!terrainSourceExists) {
            this._button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_terrain_disabled.svg" alt="TERRAIN DISABLED" />';
            this._button.disabled = true;
            this._button.title = 'Terreno não disponível';
            return;
        }

        if (this._map.getTerrain()) {
            this._button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_terrain_active.svg" alt="TERRAIN 3D ON" />';
            this._button.disabled = false;
            this._button.title = 'Desligar terreno 3D';
        } else {
            this._button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_terrain_black.svg" alt="TERRAIN 3D OFF" />';
            this._button.disabled = false;
            this._button.title = 'Ligar terreno 3D';
        }
    }

    // ===== HILLSHADE VISIBILITY CONTROL =====

    /**
     * Controls hillshade layer visibility
     * @param {boolean} enabled - true to show, false to hide
     */
    setHillshadeVisibility = (enabled) => {
        if (!this.hillshadeConfig?.enabled) {
            return;
        }

        if (!this._map.getSource('hillshadeSource')) {
            console.warn('Hillshade source not available');
            return;
        }

        if (!this._map.getLayer('hillshade')) {
            this._addHillshadeLayerInCorrectPosition();
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
