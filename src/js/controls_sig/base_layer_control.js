// Path: js/controls_sig/base_layer_control.js

/**
 * @fileoverview Base layer control for switching map styles.
 * Delegates current layer state to StateManager.
 */

import {
    setBaseLayer,
    getCurrentMapName,
    getCurrentBaseLayer,
    hasMapSavedPosition,
    getMapPosition
} from './store/store.js';
import cartaTopografica from './baselayers/carta_topografica.js';
import cartaOrtoimagem from './baselayers/carta_ortoimagem.js';
import osmLayer from './baselayers/osm_layer.js';
import imagensLayer from './baselayers/imagens_layer.js';
import bdgexLayer from './baselayers/bdgex_layer.js';
import config from '../config.js';
import { setupMapFeatures } from './layer_setup.js';
import { showError } from './utilities/toast_service.js';
import { getEventBus, getStateManager } from './services.js';

class BaseLayerControl {
    constructor(uiManager, hillshadeConfig) {
        this.container = null;
        this.uiManager = uiManager;
        this.hillshadeConfig = hillshadeConfig;
        this.mapControl = null;

        this.isChanging = false;
        this.changeDebounceTimer = null;

        config.validateBasemapsConfig();

        this.styleUrls = {};
        config.getEnabledBasemaps().forEach(([id, basemapConfig]) => {
            switch(id) {
                case 'carta-topografica':
                    this.styleUrls[id] = cartaTopografica;
                    break;
                case 'carta-ortoimagem':
                    this.styleUrls[id] = cartaOrtoimagem;
                    break;
                case 'osm':
                    this.styleUrls[id] = osmLayer;
                    break;
                case 'imagens':
                    this.styleUrls[id] = imagensLayer;
                    break;
                case 'bdgex':
                    this.styleUrls[id] = bdgexLayer;
                    break;
            }
        });
    }

    // =========================================================================
    // STATE MANAGER INTEGRATION
    // =========================================================================

    /**
     * Get current layer from StateManager.
     * @returns {string}
     */
    get currentLayer() {
        try {
            return getStateManager().get('baseLayer.activeLayer') || 'carta-topografica';
        } catch (e) {
            return 'carta-topografica';
        }
    }

    /**
     * Set current layer in StateManager.
     * @param {string} value
     */
    set currentLayer(value) {
        try {
            getStateManager().set('baseLayer.activeLayer', value);
        } catch (e) {
            // StateManager not available
        }
    }

    // =========================================================================
    // CONTROL SETUP
    // =========================================================================

    setMapControl(mapControl) {
        this.mapControl = mapControl;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');

        const enabledBasemaps = config.getEnabledBasemaps();
        const layoutClass = config.getBasemapLayoutClass(enabledBasemaps.length);

        this.container.className = `mapboxgl-ctrl base-layer-control ${layoutClass}`;

        let htmlContent = '';
        enabledBasemaps.forEach(([id, basemapConfig], index) => {
            const isFirst = index === 0;

            let iconHtml = '';
            if (basemapConfig.icon.startsWith('./')) {
                iconHtml = `<img src="${basemapConfig.icon}" class="layer-icon">`;
            } else {
                iconHtml = basemapConfig.icon;
            }

            htmlContent += `
                <label class="layer-switch">
                    <input type="radio" name="base-layer" value="${id}" ${isFirst ? 'checked' : ''}>
                    <span>${iconHtml}${basemapConfig.name}</span>
                </label>
            `;
        });

        this.container.innerHTML = htmlContent;

        this.container.querySelectorAll('input[name="base-layer"]').forEach((input) => {
            input.addEventListener('change', this.handleLayerChange);
        });

        return this.container;
    }

    onRemove() {
        if (this.changeDebounceTimer) {
            clearTimeout(this.changeDebounceTimer);
            this.changeDebounceTimer = null;
        }

        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.map = null;
    }

    // =========================================================================
    // LAYER CHANGE HANDLING
    // =========================================================================

    handleLayerChange = async (event) => {
        const layer = event.target.value
        this.syncVisualState(layer);
        if (this.changeDebounceTimer) {
            clearTimeout(this.changeDebounceTimer);
        }

        if (this.isChanging) {
            return;
        }

        this.changeDebounceTimer = setTimeout(async () => {
            await this.executeLayerChange(layer);
        }, 50);
    }

    async executeLayerChange(newLayer) {
        this.isChanging = true;
        const previousLayer = await getCurrentBaseLayer();

        try {
            await setBaseLayer(newLayer);
            await this.switchMap(false);

        } catch (error) {
            console.error('Error changing base layer:', error);

            // Rollback on error
            setBaseLayer(previousLayer);
            this.syncVisualState(previousLayer);

            showError('Erro ao trocar camada base');

        } finally {
            this.isChanging = false;
        }
    }

    async switchLayer(layer) {
        setBaseLayer(layer);

        if (this.uiManager && this.uiManager.saveChangesAndClosePanel) {
            this.uiManager.saveChangesAndClosePanel();
        }

        const styleUrl = this.styleUrls[layer];
        if (this.currentLayer !== layer) {
            const styleLoadPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error(`Timeout loading style for layer: ${layer}`));
                }, 10000);

                const cleanup = () => {
                    clearTimeout(timeout);
                    this.map.off('styledata', handleStyleData);
                };

                const handleStyleData = () => {
                    cleanup();
                    resolve();
                };

                this.map.on('styledata', handleStyleData);
            });

            this.map.setStyle(styleUrl);
            await styleLoadPromise;
            this.currentLayer = layer;
        }
        this._updateHillshadeVisibility(layer);
        this.syncVisualState(layer);
    }

    syncVisualState(layer = null) {
        const targetLayer = layer || this.currentLayer;

        const targetInput = this.container.querySelector(`input[value="${targetLayer}"]`);
        if (targetInput) {
            this.container.querySelectorAll('input[name="base-layer"]').forEach(input => {
                input.checked = false;
            });

            targetInput.checked = true;
        }

        this.updateActiveState(targetLayer);
    }

    async switchMap(applyPosition = true) {
        const currentMapName = await getCurrentMapName();

        let baseLayer = await getCurrentBaseLayer();

        const validFallback = config.getValidBasemapFallback(baseLayer);

        if (baseLayer !== validFallback) {
            console.warn(`Base layer "${baseLayer}" not available. Using "${validFallback}".`);
            baseLayer = validFallback;
            await setBaseLayer(baseLayer);
        }

        this.mapControl.deactivateActiveTools();
        this.mapControl.selectionManager.deselectAllFeatures();

        await this.switchLayer(baseLayer);

        const analysisLayersManager = this.mapControl.getAnalysisLayersManager();
        await setupMapFeatures(this.map, analysisLayersManager, getEventBus());

        if(applyPosition){
            await this.applyMapSavedPosition(currentMapName);
        }
    }

    async applyMapSavedPosition(mapName = null) {
        try {
            const targetMapName = mapName || await getCurrentMapName();

            const hasSavedPosition = await hasMapSavedPosition(targetMapName);

            if (hasSavedPosition) {
                const position = await getMapPosition(targetMapName);

                this.map.jumpTo({
                    center: [position.center_long, position.center_lat],
                    bearing: position.bearing,
                    pitch: position.pitch,
                    zoom: position.zoom
                });

                return true;
            } else {
                return false;
            }
        } catch (error) {
            console.error('Error applying saved position:', error);
            return false;
        }
    }

    // =========================================================================
    // HILLSHADE
    // =========================================================================

    _updateHillshadeVisibility(currentLayer) {
        if (!this.hillshadeConfig?.enabled || !this.map.getLayer('hillshade')) {
            return;
        }

        const visibility = 'visible';

        try {
            this.map.setLayoutProperty('hillshade', 'visibility', visibility);
        } catch (error) {
            console.warn('Could not update hillshade visibility:', error);
        }
    }

    updateActiveState(activeLayer) {
        this.container.querySelectorAll('.layer-switch span').forEach(span => {
            span.classList.remove('active-layer');
        });

        const activeInput = this.container.querySelector(`input[value="${activeLayer}"]`);
        if (activeInput) {
            const activeSpan = activeInput.nextElementSibling;
            if (activeSpan) {
                activeSpan.classList.add('active-layer');
            }
        }
    }
}

export default BaseLayerControl;
