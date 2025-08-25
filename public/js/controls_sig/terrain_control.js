// Path: js\controls_sig\terrain_control.js

import { getMapHillshadeState } from './store.js';

export async function getTerrainElevation(map, coordinates, options = { exaggerated: false }) {
    // Fixed reference point outside the DEM
    const fixedPoint = [0, 0];
    const fixedPointElevation = await map.queryTerrainElevation(fixedPoint, options) || 0;

    // Get the elevation at the given coordinates
    const sceneElevation = await map.queryTerrainElevation(coordinates, options) || 0;
    const altitude = sceneElevation - fixedPointElevation;

    // Use exaggeration from terrain config to adjust elevation
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
                
        // Listen to terrain events to update button state
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

        // Add terrainSource for elevation queries and 3D terrain
        if (!this._map.getSource('terrainSource')) {
            this._map.addSource('terrainSource', this.terrainSourceConfig);
        }

        // Add hillshadeSource if configured, but NOT the layer yet
        if (this.hillshadeConfig?.enabled) {
            if (!this._map.getSource('hillshadeSource')) {
                this._map.addSource('hillshadeSource', this.hillshadeSourceConfig);
            }

            // NOVO: Restaurar estado do hillshade (que gerenciará a layer)
            try {
                const hillshadeEnabled = await getMapHillshadeState();
                this.setHillshadeVisibility(hillshadeEnabled);
            } catch (error) {
                console.warn('Erro ao restaurar estado do hillshade:', error);
                // Em caso de erro, usar padrão (habilitado)
                this.setHillshadeVisibility(true);
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
            // Disable 3D terrain
            this._wasTerrainActive = false;
            this._map.setTerrain(null);
        } else {
            // Enable 3D terrain
            this._wasTerrainActive = true;
            this._map.setTerrain(this.terrainConfig);
        }
    }

    _updateTerrainIcon = () => {
        if (!this._button || !this.terrainSourceConfig) {
            // Terrain source not available - disabled state
            this._button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_terrain_disabled.svg" alt="TERRAIN DISABLED" />';
            this._button.disabled = true;
            this._button.title = 'Terreno não disponível';
            return;
        }

        // Check if terrain source exists (not if terrain 3D is active)
        const terrainSourceExists = this._map.getSource('terrainSource') !== undefined;
        if (!terrainSourceExists) {
            // Source failed to load - disabled state
            this._button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_terrain_disabled.svg" alt="TERRAIN DISABLED" />';
            this._button.disabled = true;
            this._button.title = 'Terreno não disponível';
            return;
        }

        // Source available - check 3D terrain state
        if (this._map.getTerrain()) {
            // 3D terrain enabled - active state
            this._button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_terrain_active.svg" alt="TERRAIN 3D ON" />';
            this._button.disabled = false;
            this._button.title = 'Desligar terreno 3D';
        } else {
            // 3D terrain disabled - normal state
            this._button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_terrain_black.svg" alt="TERRAIN 3D OFF" />';
            this._button.disabled = false;
            this._button.title = 'Ligar terreno 3D';
        }
    }

    // ===== NOVO: MÉTODO PÚBLICO PARA CONTROLE DE HILLSHADE =====

    /**
     * Método público para controlar visibilidade do hillshade
     * Chamado pelo features_tab.js
     * NOVO: Adiciona/remove layer dinamicamente para evitar requisições desnecessárias
     * @param {boolean} enabled - true para mostrar, false para ocultar
     */
    setHillshadeVisibility = (enabled) => {
        if (!this.hillshadeConfig?.enabled) {
            return; // Hillshade não disponível
        }

        // Garantir que source existe antes de qualquer operação de layer
        if (!this._map.getSource('hillshadeSource')) {
            console.warn('Hillshade source não disponível');
            return;
        }
        
        if (enabled) {
            // ADICIONAR layer se não existe
            if (!this._map.getLayer('hillshade')) {
                try {
                    this._map.addLayer(this.hillshadeConfig.layer);
                } catch (error) {
                    console.error('Erro ao adicionar hillshade layer:', error);
                }
            }
        } else {
            // REMOVER layer se existe  
            if (this._map.getLayer('hillshade')) {
                try {
                    this._map.removeLayer('hillshade');
                } catch (error) {
                    console.error('Erro ao remover hillshade layer:', error);
                }
            }
        }
    }
}

export default TerrainControl;