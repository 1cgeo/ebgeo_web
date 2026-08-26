// Path: js/baselayers/base-layer.control.js

/**
 * @fileoverview Base layer control for switching map styles.
 * Delegates current layer state to StateManager.
 */

import {
    setBaseLayer,
    getCurrentMapName,
    getCurrentBaseLayer,
    hasMapSavedPosition,
    getMapPosition,
    getCatalogLayers,
    getEventBus,
    getStateManager,
    getControl,
    isCurrentMapLockedSync
} from '../store';
import { EventTypes } from '../events/event_types.js';
import { CATALOG_ITEM_TYPES } from '../catalog/catalog.constants.js';
import cartaTopografica from './carta_topografica.js';
import cartaOrtoimagem from './carta_ortoimagem.js';
import osmLayer from './osm_layer.js';
import imagensLayer from './imagens_layer.js';
import bdgexLayer from './bdgex_layer.js';
import config from '../config.js';
import { setupMapFeatures } from '../layers';
import { showError } from '../utilities';

const STYLE_MAP = {
    'carta-topografica': cartaTopografica,
    'carta-ortoimagem': cartaOrtoimagem,
    'osm': osmLayer,
    'imagens': imagensLayer,
    'bdgex': bdgexLayer
};

const DEFAULT_LAYER = 'carta-topografica';

class BaseLayerControl {
    constructor(uiManager, hillshadeConfig) {
        this.container = null;
        this.uiManager = uiManager;
        this.hillshadeConfig = hillshadeConfig;
        this._selectionManager = null;
        this._toolManager = null;
        this._analysisLayersManager = null;
        this._dataLayersManager = null;

        this.isChanging = false;
        this.changeDebounceTimer = null;

        config.validateBasemapsConfig();

        this.styleUrls = {};
        for (const [id] of config.getEnabledBasemaps()) {
            if (STYLE_MAP[id]) {
                this.styleUrls[id] = STYLE_MAP[id];
            }
        }
    }

    get currentLayer() {
        try {
            return getStateManager().get('baseLayer.activeLayer') || DEFAULT_LAYER;
        } catch {
            return DEFAULT_LAYER;
        }
    }

    set currentLayer(value) {
        try {
            getStateManager().set('baseLayer.activeLayer', value);
        } catch {
            // StateManager not available
        }
    }

    /**
     * Injects runtime dependencies needed by switchMap().
     * Called once during initialization in map_sig.js.
     */
    setDependencies({ selectionManager, toolManager, analysisLayersManager, dataLayersManager }) {
        this._selectionManager = selectionManager;
        this._toolManager = toolManager;
        this._analysisLayersManager = analysisLayersManager;
        this._dataLayersManager = dataLayersManager;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');

        const enabledBasemaps = config.getEnabledBasemaps();
        const layoutClass = config.getBasemapLayoutClass(enabledBasemaps.length);

        this.container.className = `mapboxgl-ctrl base-layer-control ${layoutClass}`;

        let htmlContent = '';
        enabledBasemaps.forEach(([id, basemapConfig], index) => {
            const iconHtml = basemapConfig.image
                ? `<img src="${basemapConfig.image}" class="layer-icon">`
                : '';

            htmlContent += `
                <label class="layer-switch">
                    <input type="radio" name="base-layer" value="${id}" ${index === 0 ? 'checked' : ''}>
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

        this.container?.remove();
        this.map = null;
    }

    handleLayerChange = async (event) => {
        const layer = event.target.value;
        this.syncVisualState(layer);

        if (this.isChanging) {
            return;
        }

        if (this.changeDebounceTimer) {
            clearTimeout(this.changeDebounceTimer);
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
            await setBaseLayer(previousLayer);
            this.syncVisualState(previousLayer);
            showError('Erro ao trocar camada base');
        } finally {
            this.isChanging = false;
        }
    }

    async switchLayer(layer, { skipPersist = false } = {}) {
        // config.basemaps and STYLE_MAP are separate lists: a basemap can be
        // enabled in config (so getValidBasemapFallback accepts it) and still
        // have no style registered here. setStyle(undefined) never completes,
        // so fall back to a layer that actually has one.
        if (!this.styleUrls[layer]) {
            const fallback = Object.keys(this.styleUrls)[0];
            console.warn(`Base layer "${layer}" has no registered style. Using "${fallback}".`);
            if (!fallback) {
                return;
            }
            layer = fallback;
        }

        if (!skipPersist) {
            await setBaseLayer(layer);
        }

        this.uiManager?.saveChangesAndClosePanel?.();

        const styleUrl = this.styleUrls[layer];
        if (this.currentLayer !== layer) {
            const styleLoadPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error(`Timeout loading style for layer: ${layer}`));
                }, 10000);

                function cleanup() {
                    clearTimeout(timeout);
                    map.off('styledata', handleStyleData);
                }

                function handleStyleData() {
                    cleanup();
                    resolve();
                }

                const { map } = this;
                map.on('styledata', handleStyleData);
            });

            this.map.setStyle(styleUrl);
            // MapLibre diffs the incoming style against the current one and,
            // when the diff yields no operations, returns without ever firing
            // 'styledata' (Style.setState). That happens whenever two entries
            // of STYLE_MAP hold the same style, and waiting for the event would
            // hang the caller. A missed event must not be fatal: the style is
            // either already correct or MapLibre finishes applying it on its own.
            await styleLoadPromise.catch((error) => console.warn(`[base-layer] ${error.message}`));
            this.currentLayer = layer;

            // Reapply globe projection after style change (setStyle resets projection)
            // Skip if terrain is active — globe + terrain is incompatible (MapLibre #4792)
            const terrainActive = getControl('TerrainControl')?._wasTerrainActive;
            if (config.map2d.globe_projection && !terrainActive) {
                this.map.setProjection({ type: 'globe' });
            }

            // Disable sky/fog - setStyle resets it (background is set via CSS)
            this.map.setSky(undefined);
        }
        await this._updateHillshadeVisibility();
        this.syncVisualState(layer);
    }

    syncVisualState(layer = null) {
        const targetLayer = layer || this.currentLayer;

        this.container.querySelectorAll('input[name="base-layer"]').forEach(input => {
            input.checked = (input.value === targetLayer);
        });

        this.updateActiveState(targetLayer);
    }

    async switchMap(applyPosition = true) {
        const currentMapName = await getCurrentMapName();
        const skipPersist = isCurrentMapLockedSync();

        let baseLayer = await getCurrentBaseLayer();
        const validFallback = config.getValidBasemapFallback(baseLayer);

        if (baseLayer !== validFallback) {
            console.warn(`Base layer "${baseLayer}" not available. Using "${validFallback}".`);
            baseLayer = validFallback;
            if (!skipPersist) {
                await setBaseLayer(baseLayer);
            }
        }

        this._toolManager.deactivateCurrentTool();
        this._selectionManager.deselectAllFeatures();

        await this.switchLayer(baseLayer, { skipPersist });
        await setupMapFeatures(this.map, this._analysisLayersManager, this._dataLayersManager, getEventBus());

        if (applyPosition) {
            await this.applyMapSavedPosition(currentMapName);
        }

        getEventBus().emit(EventTypes.BASE_LAYER_CHANGED, { layer: baseLayer });
    }

    /**
     * Applies a base layer that came from a SHARED LINK, without writing it down.
     *
     * THE WHOLE POINT IS THE `skipPersist`. Opening someone else's link is a visit,
     * not an edit: `setBaseLayer` writes the choice into the map record, so a plain
     * `switchLayer` here would silently change the recipient's map (and, once this
     * lands on the branch with a server, everyone else's copy of it too). A visit
     * that mutates what it visits is the one behaviour this feature cannot have.
     *
     * `setupMapFeatures` IS NOT OPTIONAL AFTER A STYLE SWAP, and forgetting it is
     * the trap this method exists to close: `setStyle` drops every source and layer
     * the app added, so the drawn features vanish and nothing reports an error. It
     * is the same pairing `switchMap` does, which is exactly why this lives next to
     * it instead of in the deep-link module.
     *
     * The position is deliberately NOT touched here: the link carries its own
     * camera, and `applyMapSavedPosition` would overwrite it with the stored one.
     *
     * @param {string} basemapId - Base layer id asked for by the link.
     * @returns {Promise<string>} The id actually applied, which differs from the
     *   argument when the requested layer is unavailable and a fallback took over.
     */
    async applySharedBasemap(basemapId) {
        await this.switchLayer(config.getValidBasemapFallback(basemapId), { skipPersist: true });
        await setupMapFeatures(this.map, this._analysisLayersManager, this._dataLayersManager, getEventBus());

        // READ BACK, never echo the argument: `switchLayer` has a SECOND fallback of
        // its own (a basemap enabled in config can still have no registered style),
        // so the only honest answer about what is on screen is the field it sets.
        getEventBus().emit(EventTypes.BASE_LAYER_CHANGED, { layer: this.currentLayer });
        return this.currentLayer;
    }

    async applyMapSavedPosition(mapName = null) {
        try {
            const targetMapName = mapName || await getCurrentMapName();
            const hasSavedPosition = await hasMapSavedPosition(targetMapName);

            if (!hasSavedPosition) {
                return false;
            }

            const position = await getMapPosition(targetMapName);
            this.map.jumpTo({
                center: [position.center_long, position.center_lat],
                bearing: position.bearing,
                pitch: position.pitch,
                zoom: position.zoom
            });

            return true;
        } catch (error) {
            console.error('Error applying saved position:', error);
            return false;
        }
    }

    async _updateHillshadeVisibility() {
        if (!this.hillshadeConfig?.enabled) {
            return;
        }

        try {
            const catalogLayers = await getCatalogLayers();
            const hillshadeLayer = catalogLayers?.find(l => l.type === CATALOG_ITEM_TYPES.HILLSHADE);

            if (hillshadeLayer?.visible && hillshadeLayer.status !== 'unavailable') {
                const terrainControl = getControl('TerrainControl');
                terrainControl?.setHillshadeVisibility?.(true);
            }
        } catch (error) {
            console.warn('Could not update hillshade visibility:', error);
        }
    }

    updateActiveState(activeLayer) {
        this.container.querySelectorAll('.layer-switch span').forEach(span => {
            span.classList.remove('active-layer');
        });

        const activeSpan = this.container.querySelector(`input[value="${activeLayer}"]`)?.nextElementSibling;
        activeSpan?.classList.add('active-layer');
    }
}

export default BaseLayerControl;
