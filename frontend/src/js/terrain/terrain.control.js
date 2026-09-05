// Path: js/terrain/terrain.control.js

import { getEventBus, getControl } from '../store';
import { EventTypes } from '../events/event_types.js';
import { getCatalogLayers, toggleCatalogLayerVisibility } from '../store/catalog.operations.js';
import { CATALOG_ITEM_TYPES } from '../catalog/catalog.constants.js';
import { DEFAULT_TERRAIN_EXAGGERATION } from '../store/atlas/atlas.entity.js';
import { currentGlobeProjection } from '../store/atlas-appearance.service.js';
import { TERRAIN_BASEMAP_ACTION, decideTerrainBasemap } from './terrain-basemap.model.js';

// Elevation reads moved to a leaf module so the analysis geometry can be tested
// against a fake map, and because they stopped querying twice per sample: the fixed
// point at [0, 0] cancelled an offset that does not exist in MapLibre 5.18 (the
// value is `DEM * exaggeration`, with no camera term). Re-exported here to keep the
// historical import path, which a dozen call sites and their test doubles use.
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
 * changes or the projection changes, and its `raster-dem` `loadTile` only finishes
 * a tile that has no actor yet or is `expired`: a LOADED tile put in `reloading`
 * keeps that state for ever. Measured on 2026-09-03: after
 * `setProjection({type:'mercator'})` with the hillshade visible, all 28 hillshade
 * tiles stayed `reloading`, `map.loaded()` stayed false and `idle` never fired
 * again, which is what the screenshot control waits for.
 *
 * The way out uses only public API and takes two frames: hide the hillshade layer,
 * let one render release its tiles (a reload of a source with no tiles is a no-op),
 * change the projection, and show the layer again so its tiles load fresh. Hiding
 * and showing in the SAME frame does not work: the reload marker is processed
 * before the tiles are released, and the tiles get stuck anyway.
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
        this._wasTerrainActive = false;
        this._map = null;
        this._container = null;
        this._name = 'TerrainControl';
        this._terrainPitch = 60;
        this._unsubBaseLayerChanged = null;

        // O OBJETO, e não os campos da base preferida: `GET /api/config` hidrata este
        // mesmo `config.map2d` por deep-merge (`store/sync/runtime-config.js`), e o
        // controle nasce em `map_sig.js` com a referência na mão. Um campo copiado
        // aqui ficaria preso ao que existia no instante do boot, que é o defeito que
        // `currentGlobeProjection()` já consertou logo abaixo.
        this._map2dConfig = config;
        // Só de memória, como o `_wasTerrainActive`: o terreno nasce desligado, então
        // uma base lembrada nunca sobrevive à página.
        this._rememberedBasemap = null;
        this._userSwitchedBasemap = false;
        this._switchingBasemap = false;
    }

    /** @returns {string|null} Id da base que o terreno prefere, ou null (mecanismo desligado) */
    get _preferredBasemap() {
        return this._map2dConfig?.terrainPreferredBasemap || null;
    }

    /** @returns {Array<number>|null} Cobertura da base preferida, [oeste, sul, leste, norte] */
    get _preferredBasemapBounds() {
        return this._map2dConfig?.terrainPreferredBasemapBounds || null;
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
            // DEPOIS de `_wasTerrainActive` virar falso, para a troca de estilo que
            // isto pode causar reaplicar a projeção do atlas em vez de pulá-la.
            await this._syncBasemapWithTerrain(false);
        } else {
            // Globe + terrain is a known MapLibre bug (#4792, #4927). The projection
            // change is AWAITED so the terrain never meets the globe, and because the
            // swap now spends two frames hiding and restoring the hillshade.
            await this._disableGlobeForTerrain();
            this._wasTerrainActive = true;
            this._map.setTerrain(this.terrainConfig);
            this._map.easeTo({ pitch: this._terrainPitch, duration: 500 });
            this._ensureHillshadeEnabled();
            // POR ÚLTIMO, e com o terreno já aplicado: a troca de base passa por
            // `setStyle`, que derruba todas as fontes, e quem repõe o terreno é o
            // `_handleBaseLayerChanged`, que já escutava. É o mesmo caminho que uma
            // troca manual de base percorre hoje.
            await this._syncBasemapWithTerrain(true);
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
        // Toda troca de base que NÃO foi nossa é o usuário tendo opinião própria, e o
        // desligar do terreno não pode desfazê-la. `_switchingBasemap` é o que separa
        // as duas: `applySharedBasemap` anuncia a base aplicada ANTES de resolver,
        // então o anúncio da nossa própria troca chega aqui com a bandeira levantada.
        if (!this._switchingBasemap && this._preferredBasemap) {
            this._userSwitchedBasemap = true;
        }

        if (!this._wasTerrainActive) return;

        await this._disableGlobeForTerrain();
        await this._setupTerrainSources();
        this._map.setTerrain(this.terrainConfig);
    }

    /**
     * Leva o mapa base para o que o terreno prefere, e o traz de volta.
     *
     * POR QUE É OPCIONAL E NASCE DESLIGADO. Medido em 2026-09-04
     * (`docs/wiki/desempenho-do-mapa-2d.md`, que aponta o relatório com os números por
     * causa): com o terreno ligado, uma base raster custa de metade a um terço do
     * quadro de uma vetorial. A base raster que compensa NÃO está em nenhuma das duas
     * linhas do produto: ela é gerada por implantação, e é por isso que a chave NOMEIA
     * uma base em vez de fixar uma, e que a chave nula tem de deixar o app byte a byte
     * como era.
     *
     * A TROCA NÃO PERSISTE. `applySharedBasemap` é o caminho do link compartilhado
     * exatamente porque não grava a escolha no registro do mapa e não enfileira op de
     * sync: o terreno é um modo de ver, não uma edição do mapa do usuário. Um
     * `switchLayer` comum passaria por `setBaseLayer`, e um leitor visitando atlas
     * alheio empurraria uma mutação que o servidor recusa, travando a fila de saída.
     *
     * @param {boolean} terrainOn - O estado para o qual o terreno está indo
     * @returns {Promise<void>}
     * @private
     */
    async _syncBasemapWithTerrain(terrainOn) {
        if (!this._preferredBasemap && !this._rememberedBasemap) return;

        const baseLayerControl = getControl('BaseLayerControl');
        if (!baseLayerControl?.applySharedBasemap) {
            this._rememberedBasemap = null;
            this._userSwitchedBasemap = false;
            return;
        }

        const decision = decideTerrainBasemap({
            terrainOn,
            preferred: this._preferredBasemap,
            current: baseLayerControl.currentLayer ?? null,
            remembered: this._rememberedBasemap,
            userSwitchedSince: this._userSwitchedBasemap,
            bounds: this._preferredBasemapBounds,
            center: this._map?.getCenter?.() ?? null,
            // Habilitada no catálogo E resolvendo para algum estilo. Sem esta lista, um
            // id que ninguém oferece NÃO seria ignorado lá embaixo: `applySharedBasemap`
            // o passa por `getValidBasemapFallback`, que devolve a primeira base
            // habilitada, e o mapa do usuário mudaria para algo que ninguém pediu.
            available: baseLayerControl.availableBasemaps ?? [],
        });

        this._rememberedBasemap = decision.remember;
        this._userSwitchedBasemap = false;

        if (decision.action === TERRAIN_BASEMAP_ACTION.NONE) return;

        this._switchingBasemap = true;
        try {
            const applied = await baseLayerControl.applySharedBasemap(decision.to);
            // LÊ DE VOLTA, nunca ecoa o argumento: `switchLayer` tem um fallback
            // próprio, e a base na tela é a única resposta honesta.
            if (applied !== decision.to) {
                console.warn(`[terrain] Base "${decision.to}" indisponivel; o mapa esta em "${applied}".`);
            }
        } catch (error) {
            console.warn('Error switching base layer for terrain:', error);
            // O mapa ficou onde estava, então não há para onde voltar.
            this._rememberedBasemap = null;
        } finally {
            this._switchingBasemap = false;
        }
    }

    /**
     * Mercator for the terrain. Skips the projection call when the map is already
     * there: the call ITSELF is what marks the DEM tiles for reload.
     * @returns {Promise<void>}
     */
    async _disableGlobeForTerrain() {
        // Perguntado NA HORA, nunca guardado no construtor: a projeção passou a ser escolha do
        // atlas, e um campo lido no boot ficaria preso ao projeto que estava montado naquele
        // instante — o mesmo defeito que o handle de banco guardado no import.
        if (currentGlobeProjection() && this._map.getProjection?.()?.type !== 'mercator') {
            await setProjectionKeepingHillshade(this._map, { type: 'mercator' });
        }
    }

    /** @returns {Promise<void>} */
    async _restoreGlobeProjection() {
        if (currentGlobeProjection()) {
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
