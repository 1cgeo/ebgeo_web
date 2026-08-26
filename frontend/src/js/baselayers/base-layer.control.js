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
import { currentGlobeProjection } from '../store/atlas-appearance.service.js';
import cartaTopografica from './carta_topografica.js';
import cartaOrtoimagem from './carta_ortoimagem.js';
import osmLayer from './osm_layer.js';
import imagensLayer from './imagens_layer.js';
import bdgexLayer from './bdgex_layer.js';
import config from '../config.js';
import { resolveBasemapStyle, firstStyledBasemap } from './basemap-style.js';
// DO ARQUIVO, e não do barrel `@js/terrain`: o barrel arrasta os dois gerentes de camada, e
// este controle é do caminho de boot do mapa.
import { getLayerFailureNotice } from '../terrain/layer-failure-notice.js';
import { setupMapFeatures } from '../layers';
// DO ARQUIVO, e não do barrel `../layers`: o barrel já é arrastado pela linha acima, mas o
// `clearFeatureSources` é do mesmo módulo e o caminho direto é o que o próprio barrel recomenda.
import { clearFeatureSources } from '../layers/layer_setup.js';
import { wireRemoteFeatureRender } from '../layers/remote-feature-render.js';
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
    }

    /**
     * The style a basemap id renders with: the built-in module when there is one, else the style the
     * server published for it (`config.basemapStyles`).
     *
     * RESOLVED ON DEMAND, NOT SNAPSHOTTED IN THE CONSTRUCTOR, and that is the whole point of the
     * method. The control is built once, at map boot; a PRIVATE basemap only reaches `config` later
     * — when the user logs in, receives a grant, or opens an atlas that lends it — and leaves it
     * again on logout. A table built in the constructor could only ever describe the anonymous boot,
     * so the granted basemap would be offered by the selector and switch to something else.
     * @private
     * @param {string} id
     * @returns {Object|string|null}
     */
    _styleFor(id) {
        return resolveBasemapStyle(id, STYLE_MAP, config.basemapStyles);
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

        // Repopulate the 2D map sources when a PEER's feature op arrives, then rebuild
        // the features tree (which reads from the sources). The remote-op handler only
        // updated the store, leaving the MapLibre sources — and thus the live map and
        // the tree — stale until a base-layer/map switch.
        if (this._unwireRemoteRender) this._unwireRemoteRender();
        this._unwireRemoteRender = wireRemoteFeatureRender(async () => {
            await setupMapFeatures(this.map, this._analysisLayersManager, this._dataLayersManager, getEventBus());
            getEventBus().emit(EventTypes.LAYERS_CHANGED, {});
        });

        // A full store wipe (logout / "Limpar Tudo" / non-additive import) resets the store + loads a
        // BLANK map, but nothing repopulated the MapLibre feature sources — so the OLD map's features
        // stayed drawn on the canvas after logout. Sem um ouvinte AQUI o defeito relatado volta
        // (`tests/e2e-ui/browser-logout-clears-map.repro.spec.js`), porque depois do wipe nada mais
        // repinta o mapa.
        //
        // E A RESPOSTA É PROPORCIONAL AO WIPE, que é o que `rebuild` diz. Com `rebuild` verdadeiro o
        // escopo que o wipe deixou vai ser USADO (trocar de atlas, "Limpar Tudo", importar), e a
        // remontagem inteira é o certo: ela restaura terreno, camadas de catálogo e filtros a partir
        // do mapa em branco. Com `rebuild` falso o escopo morre em seguida (a saída da conta destrói
        // o namespace), e remontá-lo é pintar um mapa para jogá-lo fora. Só o traço visual precisa
        // sumir, e é isso que `clearFeatureSources` faz.
        //
        // O PADRÃO É `true` porque o evento tem oito outros ouvintes que não passam argumento nenhum,
        // e um wipe sem opinião sobre isto é o wipe que quer o comportamento antigo.
        if (this._unsubAllCleared) this._unsubAllCleared();
        this._unsubAllCleared = getEventBus().on(EventTypes.ALL_DATA_CLEARED, async ({ rebuild = true } = {}) => {
            if (!rebuild) {
                clearFeatureSources(this.map);
                return;
            }
            await setupMapFeatures(this.map, this._analysisLayersManager, this._dataLayersManager, getEventBus());
        });
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');

        const enabledBasemaps = config.getEnabledBasemaps();
        const layoutClass = config.getBasemapLayoutClass(enabledBasemaps.length);

        this.container.className = `mapboxgl-ctrl base-layer-control ${layoutClass}`;

        // Built node by node instead of by innerHTML: the basemap id, name and image
        // come from the server catalog (free-form strings, admin-authored), and both
        // the id and the image landed inside quoted attributes.
        enabledBasemaps.forEach(([id, basemapConfig], index) => {
            const label = document.createElement('label');
            label.className = 'layer-switch';

            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'base-layer';
            input.value = id;
            input.checked = index === 0;

            const span = document.createElement('span');
            if (basemapConfig.image) {
                const img = document.createElement('img');
                img.className = 'layer-icon';
                img.src = basemapConfig.image;
                span.appendChild(img);
            }
            span.appendChild(document.createTextNode(basemapConfig.name ?? ''));

            label.appendChild(input);
            label.appendChild(span);
            this.container.appendChild(label);
        });

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
        // config.basemaps and the style lists are separate: a basemap can be enabled
        // in config (so getValidBasemapFallback accepts it) and still have no style
        // anywhere. setStyle(undefined) never completes, so fall back to a layer that
        // actually has one — and look for it among the OFFERED basemaps, in priority
        // order, so the fallback is one the selector also shows as selected.
        if (!this._styleFor(layer)) {
            const offered = config.getEnabledBasemaps().map(([id]) => id);
            const fallback = firstStyledBasemap(offered, STYLE_MAP, config.basemapStyles);
            console.warn(`Base layer "${layer}" has no registered style. Using "${fallback}".`);
            // O SILÊNCIO ERA O DEFEITO, e ele não chegava por evento nenhum: nenhum `error` do
            // MapLibre, nenhum tile falho, nada que o painel de camadas indisponíveis pudesse
            // pegar. A pessoa escolhia um mapa base, o produto trocava para OUTRO, e a única
            // pista era um `console.warn`. Quem sente isto primeiro é quem enxerga acervo
            // privado que não resolve para estilo, porque para ele o cartão diz "Privado" e a
            // base simplesmente é outra.
            //
            // O NOME É CONHECIDO AQUI, ao contrário do caso da falha de TILE: quem pediu ainda
            // está na variável, antes da reatribuição. É a única forma deste aviso que pode
            // nomear a camada sem mentir.
            getLayerFailureNotice(this.map).reportBasemapFailure({
                name: config.basemaps?.[layer]?.name || layer,
            });
            // No basemap at all resolves to a style (an empty catalog): return without
            // touching the map, exactly as before. Switching to nothing would blank it.
            if (!fallback) {
                return;
            }
            layer = fallback;
        } else {
            // O PEDIDO RESOLVEU: retirar a acusação vale tanto quanto levantá-la, e um aviso
            // que fica depois de resolvido treina a ignorar aviso.
            getLayerFailureNotice(this.map).clearBasemapFailure();
        }

        if (!skipPersist) {
            await setBaseLayer(layer);
        }

        this.uiManager?.saveChangesAndClosePanel?.();

        const styleUrl = this._styleFor(layer);
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
            // stall the boot for the full timeout. A missed event must not be
            // fatal: the style is either already correct or MapLibre finishes
            // applying it on its own.
            await styleLoadPromise.catch((error) => console.warn(`[base-layer] ${error.message}`));
            this.currentLayer = layer;

            // Reapply globe projection after style change (setStyle resets projection)
            // Skip if terrain is active — globe + terrain is incompatible (MapLibre #4792)
            const terrainActive = getControl('TerrainControl')?._wasTerrainActive;
            // A escolha do ATLAS, com o deploy como padrão — nunca o deploy direto, senão trocar
            // de mapa base desfaria a projeção que o projeto pediu.
            if (currentGlobeProjection() && !terrainActive) {
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
     * not an edit. A plain `switchLayer` would go through `setBaseLayer`, which in
     * this package does two things a visitor must not do: it writes the choice into
     * the map record, and it ENQUEUES a `baseLayer` op, so a reader visiting a
     * shared atlas would push a mutation the server then refuses, stalling the whole
     * outbound queue. Nothing here asks the guard, because nothing here writes.
     *
     * `setupMapFeatures` IS NOT OPTIONAL AFTER A STYLE SWAP, and forgetting it is
     * the trap this method exists to close: `setStyle` drops every source and layer
     * the app added, so the drawn features vanish and nothing reports an error. It
     * is the same pairing `switchMap` does, which is why this lives next to it
     * rather than in the deep-link module.
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
