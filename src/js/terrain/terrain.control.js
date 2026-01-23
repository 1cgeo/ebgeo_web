// Path: js/terrain/terrain.control.js

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

        // Hillshade source/layer are only added when explicitly requested via catalog
        // No automatic initialization here

        this._updateTerrainIcon()
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
