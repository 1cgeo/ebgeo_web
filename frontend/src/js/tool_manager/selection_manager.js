// Path: js/tool_manager/selection_manager.js

/**
 * @fileoverview Selection manager for map features.
 * Delegates selection state to StateManager (single source of truth).
 * Handles click events, multi-select, group selection, and context menus.
 */

import {
    getFeatureGroup,
    getVisibleLayerIds,
    isFeatureEffectivelyLocked,
    isCurrentMapLockedSync,
    getStateManager,
    getControl,
    startBatchUndo,
    commitBatchUndo,
    discardBatchUndo,
    getFeatureIcon,
    getFeatureById,
    getStorageTypeFromSource
} from '../store';
import { createTwoFingerTapHandler } from '../utilities/pointer-utils';
import { ensureTurf } from '../utilities/turf-loader.js';

class SelectionManager {
    /**
     * @param {Object} map - MapLibre map instance
     */
    constructor(map) {
        this.map = map;
        this.uiManager = null;
        this.vectorTileInfoControl = null;
        this.rectangleSelectionControl = null;

        /** @type {Map<string, Object>} Tool controls registry */
        this.controls = new Map();

        /**
         * @type {Map<string, {getSourceNames: Function, getEditHandleSource: Function, ensure: Function}>}
         *
         * AS FERRAMENTAS QUE AINDA NAO EXISTEM, e este e o ponto mais delicado da carga tardia.
         *
         * Clicar numa feicao JA DESENHADA num mapa recem carregado procura o controle POR TIPO,
         * sem gesto de ferramenta nenhum. Antes da carga tardia toda ferramenta estava
         * instanciada no boot, entao `this.controls` respondia sempre. Agora nem sempre.
         *
         * O descritor e o meio-termo: ele responde SINCRONO o que a varredura de clique precisa
         * (as fontes que a ferramenta possui e a fonte das alcas de edicao), porque essa
         * varredura roda dentro do handler de clique do mapa e nao pode esperar por rede. O
         * modulo so e resolvido quando a selecao de fato acontece, por `ensureControlFor`, e a
         * partir dai a instancia vive em `this.controls` como qualquer outra.
         */
        this.controlFactories = new Map();

        // Context menu state (local, not in StateManager - ephemeral UI)
        this.contextMenu = null;
        this.pendingFeatures = null;
        this.pendingEvent = null;

        /** @type {Array<Function>} Cleanup functions for subscriptions */
        this._unsubscribers = [];

        /** @type {boolean} Flag to prevent re-entrancy in deselectAllFeatures */
        this._isDeselecting = false;

        /** @type {number} Version counter to cancel stale selectFeature calls */
        this._selectVersion = 0;

        /** @type {Function|null} Cleanup for two-finger tap handler */
        this._cleanupTwoFingerTap = null;

        /** @type {Function|null} Bound keydown handler for cleanup */
        this._handleKeydown = null;

        /** @type {Function|null} Bound movestart/zoomstart handler for cleanup */
        this._handleMapInteraction = null;

        this._setupEventListeners();
    }

    // =========================================================================
    // SELECTION STATE (delegated to StateManager)
    // =========================================================================

    /**
     * Check if feature is selected.
     * @param {string} type - Feature type
     * @param {string} featureId - Feature ID
     * @returns {boolean}
     */
    isFeatureSelected(type, featureId) {
        try {
            return getStateManager().isFeatureSelected(type, String(featureId));
        } catch (_e) {
            // StateManager not initialized yet
            return false;
        }
    }

    /**
     * Get all selected features (GeoJSON objects only).
     * @returns {Array<Object>} Array of GeoJSON features
     */
    getAllSelectedFeatures() {
        try {
            return getStateManager().getSelectedFeatures().map(item => item.feature);
        } catch (_e) {
            return [];
        }
    }

    /**
     * Get selected features filtered by type.
     * @param {string} type - Feature type
     * @returns {Array<{type: string, id: string, feature: Object}>}
     */
    getSelectedFeaturesByType(type) {
        try {
            return getStateManager().getSelectedFeatures().filter(item => item.type === type);
        } catch (_e) {
            return [];
        }
    }

    /**
     * Get IDs of selected features by type.
     * @param {string} type - Feature type
     * @returns {Array<string>}
     */
    getSelectedFeatureIdsByType(type) {
        return this.getSelectedFeaturesByType(type).map(item => item.id);
    }

    /**
     * Get a specific selected feature.
     * @param {string} type - Feature type
     * @param {string} featureId - Feature ID
     * @returns {Object|null} GeoJSON feature or null
     */
    getSelectedFeature(type, featureId) {
        try {
            return getStateManager().getSelectedFeature(type, String(featureId));
        } catch (_e) {
            return null;
        }
    }

    /**
     * Check if any features are selected.
     * @returns {boolean}
     */
    hasSelectedFeatures() {
        try {
            return getStateManager().getSelectionCount() > 0;
        } catch (_e) {
            return false;
        }
    }

    /**
     * Update a selected feature in place (after geometry/property changes).
     * Used by tool controls after drag or edit operations.
     * @param {string} type - Feature type
     * @param {string} featureId - Feature ID
     * @param {Object} feature - Updated GeoJSON feature
     */
    updateSelectedFeature(type, featureId, feature) {
        try {
            const stateManager = getStateManager();
            stateManager.updateSelectedFeature(type, String(featureId), feature);
        } catch (e) {
            console.warn('Could not update selected feature in StateManager:', e);
        }
    }

    // =========================================================================
    // SELECTION MUTATIONS
    // =========================================================================

    /**
     * Toggle feature selection state.
     * @param {string} type - Feature type
     * @param {string} featureId - Feature ID
     * @param {Object} feature - GeoJSON feature (may be incomplete from render)
     * @param {boolean} [forceDeselect=false] - If true, deselect even if not selected
     */
    async toggleFeatureSelection(type, featureId, feature, forceDeselect = false) {
        const featureIdStr = String(featureId);

        let stateManager;
        try {
            stateManager = getStateManager();
        } catch (_e) {
            console.warn('StateManager not available for selection');
            return;
        }

        const control = await this.ensureControlFor(type);
        const isSelected = stateManager.isFeatureSelected(type, featureIdStr);

        if (isSelected && forceDeselect) {
            // Deselect
            stateManager.removeFromSelection(type, featureIdStr);
            if (control?.onFeatureDeselected) {
                control.onFeatureDeselected(feature);
            }
        } else if (!isSelected) {
            // Select - get complete feature from source for full geometry
            const completeFeature = await this.getCompleteFeatureFromSource(type, featureId);
            const featureToStore = completeFeature || feature;

            stateManager.addToSelection(type, featureIdStr, featureToStore);

            if (control?.onFeatureSelected) {
                control.onFeatureSelected(featureToStore);
            }
        }
    }

    /**
     * Select a single feature (clears previous selection).
     * @param {string} type - Feature type
     * @param {string} featureId - Feature ID
     * @param {Object} [feature=null] - GeoJSON feature
     */
    async selectFeature(type, featureId, feature = null) {
        // Increment version so any in-flight selectFeature call is invalidated
        const version = ++this._selectVersion;

        // Notify controls of global deselect
        this.controls.forEach((control) => {
            if (control.onGlobalDeselect) {
                control.onGlobalDeselect();
            }
        });

        let stateManager;
        try {
            stateManager = getStateManager();
        } catch (_e) {
            // StateManager not available
        }

        // Fetch complete feature (async - may yield to another selectFeature call)
        const completeFeature = await this.getCompleteFeatureFromSource(type, featureId);

        // Discard if a newer selectFeature call started while awaiting
        if (version !== this._selectVersion) return;

        const featureToStore = completeFeature || feature;
        const featureIdStr = String(featureId);

        // Batch clear + add so selection.features subscribers fire only ONCE
        // (avoids double updateSelectionHighlight: once for empty, once for new)
        if (stateManager) {
            stateManager.batchUpdate(() => {
                stateManager.clearSelection();
                stateManager.addToSelection(type, featureIdStr, featureToStore);
            });
        }

        // A ferramenta e resolvida AQUI, e nao la em cima: `getCompleteFeatureFromSource` ja
        // nao precisa dela (le as fontes pelo descritor), e o par `_mapLocked = true` /
        // `onFeatureSelected` / `_mapLocked = false` tem de ficar SINCRONO. Um await no meio
        // dele devolveria o controle com o flag ja limpo, e um mapa bloqueado ganharia alcas
        // de edicao.
        const control = await this.ensureControlFor(type);
        if (control?.onFeatureSelected) {
            // Signal locked state so controls skip edit handle creation
            const locked = isCurrentMapLockedSync();
            if (locked) control._mapLocked = true;

            control.onFeatureSelected(featureToStore);

            if (locked) control._mapLocked = false;
        }

        this.updateUI();
    }

    /**
     * Selects ALL features of a group (clearing any prior selection first). Public wrapper
     * around the group-aware selection used by the map click path, so other entry points
     * (e.g. the layers tab) can give a grouped feature the same whole-group selection
     * instead of selecting a single member.
     * @param {Object} group - Group object ({ features: [{type, id}], ... })
     */
    async selectGroup(group) {
        if (!group) return;
        this.deselectAllFeatures();
        await this._selectGroup(group);
        this.updateUI();
    }

    /**
     * Deselect all features.
     * Saves any pending changes before deselecting.
     * @param {Object} [options]
     * @param {boolean} [options.skipSave=false] - Skip saving when caller already saved
     */
    deselectAllFeatures({ skipSave = false } = {}) {
        // Prevent re-entrancy (saveChangesAndClosePanel may trigger this again)
        if (this._isDeselecting) {
            return;
        }
        this._isDeselecting = true;

        try {
            if (!skipSave) {
                // Save any pending changes before deselecting
                this.uiManager?.saveChangesAndClosePanel();
            } else {
                // Caller already saved — just close panel UI without saving again
                this.uiManager?.closePanelWithoutSave();
            }

            // Notify controls of global deselect
            this.controls.forEach((control) => {
                if (control.onGlobalDeselect) {
                    control.onGlobalDeselect();
                }
            });

            try {
                getStateManager().clearSelection();
            } catch (_e) {
                // StateManager not available
            }

            this.updateUI();
        } finally {
            this._isDeselecting = false;
        }
    }

    /**
     * Clear selections of a specific type only.
     * @param {string} type - Feature type to clear
     */
    clearSelectionsByType(type) {
        try {
            const stateManager = getStateManager();
            const features = stateManager.getSelectedFeatures();
            const toRemove = features.filter(f => f.type === type);

            stateManager.batchUpdate(() => {
                toRemove.forEach(f => stateManager.removeFromSelection(f.type, f.id));
            });
        } catch (_e) {
            // StateManager not available
        }
    }

    // =========================================================================
    // CONTROL REGISTRATION
    // =========================================================================

    /**
     * Register a tool control for selection handling.
     * @param {string} type - Tool type identifier
     * @param {Object} control - Tool control instance
     */
    registerControl(type, control) {
        this.controls.set(type, control);
        // Uma vez instanciada, a ferramenta responde por si: o descritor cumpriu o papel dele.
        this.controlFactories.delete(type);
    }

    /**
     * Register a LAZY tool control: static metadata now, module on demand.
     *
     * @param {string} type - Feature type identifier (`properties.source`)
     * @param {Object} descriptor
     * @param {() => string[]} descriptor.getSourceNames - Sources the tool owns (sync)
     * @param {() => string|null} descriptor.getEditHandleSource - Edit-handle source (sync)
     * @param {() => Promise<Object>} descriptor.ensure - Loads + instantiates the control
     */
    registerControlFactory(type, descriptor) {
        if (this.controls.has(type)) return;
        this.controlFactories.set(type, descriptor);
    }

    /**
     * The control for `type`, loading it on first use.
     *
     * Every selection path is already `async`, so the await costs nothing where the control is
     * present and is the whole point where it is not.
     *
     * @param {string} type - Feature type
     * @returns {Promise<Object|null>}
     */
    async ensureControlFor(type) {
        const pronto = this.controls.get(type);
        if (pronto) return pronto;

        const descritor = this.controlFactories.get(type);
        if (!descritor) return null;

        try {
            const controle = await descritor.ensure();
            // `ensure` ja chama `registerControl` por dentro do registro de ferramentas; a
            // linha abaixo cobre um descritor de teste que nao o faca.
            if (controle) this.controls.set(type, controle);
            this.controlFactories.delete(type);
            return controle ?? null;
        } catch (erro) {
            console.warn(`Falha ao carregar a ferramenta do tipo ${type}:`, erro);
            return null;
        }
    }

    /**
     * Every registered type with the two SYNCHRONOUS lookups the click sweep needs, loaded or
     * not. Iterating only `this.controls` would make a click on a feature of a never-loaded
     * tool land on empty ground — the feature is drawn, and nothing would find it.
     * @returns {Array<[string, {getSourceNames: Function, getEditHandleSource: Function}]>}
     * @private
     */
    _descritoresDeTipo() {
        return [...this.controls.entries(), ...this.controlFactories.entries()];
    }

    /**
     * Source names a type owns, WITHOUT loading the tool.
     * @param {string} type
     * @returns {string[]}
     * @private
     */
    _fontesDoTipo(type) {
        const alvo = this.controls.get(type) ?? this.controlFactories.get(type);
        return alvo?.getSourceNames?.() ?? [];
    }

    /**
     * Set UI manager reference.
     * @param {Object} uiManager
     */
    setUIManager(uiManager) {
        this.uiManager = uiManager;
    }

    /**
     * Set vector tile info control reference.
     * @param {Object} vectorTileInfoControl
     */
    setvectorTileInfoControl(vectorTileInfoControl) {
        this.vectorTileInfoControl = vectorTileInfoControl;
    }

    /**
     * Set rectangle selection control reference.
     * @param {Object} rectangleSelectionControl
     */
    setRectangleSelectionControl(rectangleSelectionControl) {
        this.rectangleSelectionControl = rectangleSelectionControl;
    }

    // =========================================================================
    // EVENT HANDLING
    // =========================================================================

    /**
     * Setup map event listeners.
     * @private
     */
    _setupEventListeners() {
        this.map.on('click', this._handleMapClick);

        // Store bound handlers for cleanup
        this._handleKeydown = (e) => {
            if (e.key === 'Escape' && this.contextMenu) {
                this._hideFeatureSelectionMenu();
            }
        };
        document.addEventListener('keydown', this._handleKeydown);

        this._handleMapInteraction = () => {
            if (this.contextMenu) this._hideFeatureSelectionMenu();
        };
        this.map.on('movestart', this._handleMapInteraction);
        this.map.on('zoomstart', this._handleMapInteraction);

        // Two-finger tap para multi-select em dispositivos touch
        this._setupTwoFingerTap();
    }

    /**
     * Setup two-finger tap for multi-select (equivalent to Shift+Click)
     * @private
     */
    _setupTwoFingerTap() {
        const canvas = this.map.getCanvasContainer();

        this._cleanupTwoFingerTap = createTwoFingerTapHandler(
            canvas,
            (e, midpoint) => {
                // Skip if special tools are active
                if (this.vectorTileInfoControl?.isActive) return;
                if (this.rectangleSelectionControl?.isActive) return;

                const activeTool = this.getActiveTool();
                if (activeTool) return;

                // Get canvas-relative coordinates
                const rect = canvas.getBoundingClientRect();
                const point = {
                    x: midpoint.x - rect.left,
                    y: midpoint.y - rect.top
                };

                // Query features at the midpoint
                const clickedFeatures = this.getAllClickedCustomFeatures([point.x, point.y]);

                if (clickedFeatures.length > 0) {
                    // Simulate shift+click event for multi-select
                    const fakeEvent = {
                        point,
                        lngLat: this.map.unproject([point.x, point.y]),
                        originalEvent: { shiftKey: true }
                    };

                    if (clickedFeatures.length === 1) {
                        this._handleFeatureClick(clickedFeatures[0], fakeEvent);
                    } else {
                        this._showFeatureSelectionMenu(clickedFeatures, fakeEvent);
                    }
                }
            },
            { maxDuration: 300, maxDistance: 20 }
        );
    }

    /**
     * Handle map click event.
     * @private
     */
    _handleMapClick = (e) => {
        // Skip if special tools are active
        if (this.vectorTileInfoControl?.isActive) return;
        if (this.rectangleSelectionControl?.isActive) return;
        // Skip while the trajectory editor is appending keypoints: those map clicks
        // add waypoints to the selected feature and must not deselect it (which would
        // close the panel and tear down the editor).
        if (getControl('TrajectoryEditControl')?.isAdding?.()) return;

        // Skip if click is on viewer layers (3D Models, Street View)
        // These have their own click handlers and should not trigger feature selection
        const viewerLayers = [
            // 3D Models Viewer layers
            '3d-models-clusters', '3d-models-markers',
            // Street View: a linha de tracado. A camada de pontos `street-view`
            // saiu daqui junto com a fonte invisivel que o mapa principal
            // carregava e ninguem lia.
            'street-view-lines',
            // Streetview Markers clustering layers
            'streetview-markers-clusters', 'streetview-markers-pins'
        ];

        const clickedLayers = this.map.queryRenderedFeatures(e.point)
            .map(f => f.layer?.id)
            .filter(Boolean);

        if (clickedLayers.some(layer => viewerLayers.includes(layer))) {
            return; // Let viewer handlers process the click
        }

        const activeTool = this.getActiveTool();
        if (activeTool) {
            activeTool.handleMapClick(e);
            return;
        }

        const clickedFeatures = this.getAllClickedCustomFeatures([e.point.x, e.point.y]);

        if (clickedFeatures.length > 0) {
            if (clickedFeatures.length === 1) {
                this._handleFeatureClick(clickedFeatures[0], e);
            } else {
                this._showFeatureSelectionMenu(clickedFeatures, e);
            }
        } else {
            this._hideFeatureSelectionMenu();
            if (!e.originalEvent.shiftKey && this.hasSelectedFeatures()) {
                this.uiManager?.saveChangesAndClosePanel();
                if (this.hasSelectedFeatures()) {
                    // skipSave: saveChangesAndClosePanel already saved above
                    this.deselectAllFeatures({ skipSave: true });
                }
            }
        }
    }

    /**
     * Get all custom features at click point, filtered by visibility.
     * @param {Array<number>} point - [x, y] screen coordinates
     * @returns {Array<Object>} Clicked features with toolType added
     */
    getAllClickedCustomFeatures(point) {
        const features = this.map.queryRenderedFeatures(point);
        const clickedFeatures = [];
        const visibleLayerSet = new Set(getVisibleLayerIds());

        // Descritores, NAO instancias: uma feicao desenhada por uma ferramenta que ainda nao
        // carregou continua clicavel, porque as fontes dela sao dado estatico da tabela.
        for (const [type, descritor] of this._descritoresDeTipo()) {
            const sourceNames = descritor.getSourceNames?.() ?? [];
            for (const sourceName of sourceNames) {
                const matchingFeatures = features.filter(f =>
                    f.source === sourceName && f.properties.source === type
                );
                matchingFeatures.forEach(feature => {
                    if (isFeatureEffectivelyLocked(feature)) return;

                    const featureLayerId = feature.properties.layerId || 'default';
                    if (!visibleLayerSet.has(featureLayerId)) return;

                    clickedFeatures.push({ ...feature, toolType: type });
                });
            }
        }

        // Deduplicate by type:id
        const uniqueFeatures = [];
        const seenKeys = new Set();
        clickedFeatures.forEach(feature => {
            const key = `${feature.toolType}:${feature.properties.id}`;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                uniqueFeatures.push(feature);
            }
        });
        return uniqueFeatures;
    }

    /**
     * Get first clicked custom feature.
     * @param {Array<number>} point - [x, y] screen coordinates
     * @returns {Object|null}
     */
    getClickedCustomFeature(point) {
        const features = this.getAllClickedCustomFeatures(point);
        return features.length > 0 ? features[0] : null;
    }

    /**
     * Handle click on a specific feature.
     * @private
     */
    _handleFeatureClick = async (clickedFeature, e) => {
        if (isFeatureEffectivelyLocked(clickedFeature)) return;

        const type = clickedFeature.toolType;
        const featureId = clickedFeature.properties.id;
        const group = getFeatureGroup(type, featureId);

        if (group) {
            await this._handleGroupClick(group, clickedFeature, e);
        } else {
            await this._handleSingleFeatureClick(clickedFeature, e);
        }
    }

    /**
     * Handle click on grouped feature.
     * @private
     */
    _handleGroupClick = async (group, clickedFeature, e) => {
        const isShiftPressed = e.originalEvent.shiftKey;

        if (isShiftPressed) {
            const isGroupSelected = this._isGroupSelected(group);
            if (isGroupSelected) {
                await this._deselectGroup(group);
            } else {
                await this._selectGroup(group);
            }
        } else {
            this.deselectAllFeatures();
            await this._selectGroup(group);
        }

        this.updateUI();
    }

    /**
     * Handle click on individual (non-grouped) feature.
     * @private
     */
    _handleSingleFeatureClick = async (clickedFeature, e) => {
        const type = clickedFeature.toolType;
        const featureId = clickedFeature.properties.id;
        const isSelected = this.isFeatureSelected(type, featureId);

        if (isSelected && e.originalEvent.shiftKey) {
            // Shift+click on selected = deselect
            await this.toggleFeatureSelection(type, featureId, clickedFeature, true);
            this.updateUI();
        } else if (!isSelected) {
            if (!e.originalEvent.shiftKey) {
                // Single click on unselected: use selectFeature() which saves
                // inline and avoids close→reopen panel bounce
                await this.selectFeature(type, featureId, clickedFeature);
            } else {
                // Shift+click: add to multi-selection
                await this.toggleFeatureSelection(type, featureId, clickedFeature, false);
                this.updateUI();
            }
        }
    }

    /**
     * Select all features in a group.
     * @private
     */
    _selectGroup = async (group) => {
        let stateManager;
        try {
            stateManager = getStateManager();
        } catch (_e) {
            return;
        }

        for (const featureRef of group.features) {
            // Resolve each member INDEPENDENTLY and resiliently: prefer the live map source,
            // fall back to the store. Both lookups are wrapped so a single feature's failure
            // (the source query can throw or hang when the map is mid-render / under load)
            // never aborts the whole-group selection — otherwise the group highlighted
            // partially or not at all. selectFeature already falls back to the store this way.
            let completeFeature = null;
            try {
                completeFeature = await this.getCompleteFeatureFromSource(featureRef.type, featureRef.id);
            } catch (_e) {
                completeFeature = null;
            }
            if (!completeFeature) {
                const storageType = getStorageTypeFromSource(featureRef.type);
                try {
                    completeFeature = await getFeatureById(storageType, featureRef.id);
                } catch (_e) {
                    completeFeature = null;
                }
            }
            if (completeFeature) {
                stateManager.addToSelection(featureRef.type, String(featureRef.id), completeFeature);
                const control = await this.ensureControlFor(featureRef.type);
                if (control?.onFeatureSelected) {
                    control.onFeatureSelected(completeFeature);
                }
            }
        }
    }

    /**
     * Deselect all features in a group.
     * @private
     */
    _deselectGroup = async (group) => {
        let stateManager;
        try {
            stateManager = getStateManager();
        } catch (_e) {
            return;
        }

        // As ferramentas do grupo sao resolvidas ANTES do lote. `batchUpdate` recebe uma funcao
        // SINCRONA (ela existe para disparar os assinantes uma vez so), entao um await la dentro
        // sairia do lote e cada membro do grupo notificaria por conta propria.
        const controlesPorTipo = new Map();
        for (const featureRef of group.features) {
            if (controlesPorTipo.has(featureRef.type)) continue;
            controlesPorTipo.set(featureRef.type, await this.ensureControlFor(featureRef.type));
        }

        stateManager.batchUpdate(() => {
            for (const featureRef of group.features) {
                stateManager.removeFromSelection(featureRef.type, String(featureRef.id));
                const control = controlesPorTipo.get(featureRef.type);
                if (control?.onFeatureDeselected) {
                    control.onFeatureDeselected(null);
                }
            }
        });
    }

    /**
     * Check if all features in group are selected.
     * @private
     */
    _isGroupSelected(group) {
        return group.features.every(featureRef =>
            this.isFeatureSelected(featureRef.type, featureRef.id)
        );
    }

    // =========================================================================
    // CONTEXT MENU
    // =========================================================================

    /**
     * Show feature selection context menu.
     * @private
     */
    _showFeatureSelectionMenu(features, e) {
        this._hideFeatureSelectionMenu();

        const availableFeatures = features.filter(f => !isFeatureEffectivelyLocked(f));
        if (availableFeatures.length === 0) return;

        if (availableFeatures.length === 1) {
            this._handleFeatureClick(availableFeatures[0], e);
            return;
        }

        this.pendingFeatures = availableFeatures;
        this.pendingEvent = e;
        this.contextMenu = this._createContextMenuElement(availableFeatures, e);
        document.body.appendChild(this.contextMenu);
    }

    /**
     * Create context menu DOM element.
     * @private
     */
    _createContextMenuElement(features, e) {
        const menu = document.createElement('div');
        menu.className = 'feature-selection-menu';

        // Position is dynamic and must be computed at runtime
        const x = Math.min(e.originalEvent.clientX, window.innerWidth - 220);
        const y = Math.min(e.originalEvent.clientY, window.innerHeight - 50);
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        // Header
        const header = document.createElement('div');
        header.className = 'feature-selection-menu__header';
        header.textContent = `Selecionar feição (${features.length})`;
        menu.appendChild(header);

        // Feature items
        features.forEach((feature) => {
            const item = document.createElement('div');
            item.className = 'feature-selection-menu__item';
            const featureName = this._getFeatureName(feature);

            const iconPath = getFeatureIcon(feature.toolType);
            if (iconPath) {
                const icon = document.createElement('img');
                icon.src = iconPath;
                icon.alt = '';
                icon.className = 'feature-selection-menu__item-icon';
                item.appendChild(icon);
            }

            const nameSpan = document.createElement('span');
            nameSpan.textContent = featureName;
            item.appendChild(nameSpan);

            item.addEventListener('click', (evt) => {
                evt.stopPropagation();
                this._handleFeatureClick(feature, this.pendingEvent);
                this._hideFeatureSelectionMenu();
            });

            menu.appendChild(item);
        });

        // Separator
        const separator = document.createElement('div');
        separator.className = 'feature-selection-menu__separator';
        menu.appendChild(separator);

        // Select all option
        const selectAllItem = document.createElement('div');
        selectAllItem.className = 'feature-selection-menu__select-all';
        selectAllItem.textContent = 'Selecionar Todas';

        selectAllItem.addEventListener('click', async (evt) => {
            evt.stopPropagation();
            await this._selectAllPendingFeatures();
            this._hideFeatureSelectionMenu();
        });

        menu.appendChild(selectAllItem);

        return menu;
    }

    /**
     * Select all features from pending context menu.
     * @private
     */
    _selectAllPendingFeatures = async () => {
        if (!this.pendingFeatures || !this.pendingEvent) return;

        if (!this.pendingEvent.originalEvent.shiftKey) {
            this.deselectAllFeatures();
        }

        for (const feature of this.pendingFeatures) {
            const type = feature.toolType;
            const featureId = feature.properties.id;

            if (!this.isFeatureSelected(type, featureId)) {
                await this.toggleFeatureSelection(type, featureId, feature, false);
            }
        }

        this.updateUI();
    }

    /**
     * Get display name for feature.
     * @private
     */
    _getFeatureName(feature) {
        const nome = feature.properties.nome;
        if (nome && nome.trim()) {
            return nome;
        }
        return `ID: ${feature.properties.id}`;
    }

    /**
     * Hide context menu.
     * @private
     */
    _hideFeatureSelectionMenu() {
        if (this.contextMenu) {
            this.contextMenu.remove();
            this.contextMenu = null;
            this.pendingFeatures = null;
            this.pendingEvent = null;
        }
    }

    // =========================================================================
    // UTILITY METHODS
    // =========================================================================

    /**
     * Check if click is on an edit handle.
     * @param {Array<number>} point - [x, y] screen coordinates
     * @returns {boolean}
     */
    isClickOnEditHandle(point) {
        const features = this.map.queryRenderedFeatures(point);

        for (const [, descritor] of this._descritoresDeTipo()) {
            const editHandleSource = descritor.getEditHandleSource?.();
            if (editHandleSource) {
                const hasHandle = features.some(f =>
                    f.source === editHandleSource && f.properties.user_isEditingHandle
                );
                if (hasHandle) return true;
            }
        }

        return false;
    }

    /**
     * Get complete feature from map source (with full geometry).
     * @param {string} type - Feature type
     * @param {string} featureId - Feature ID
     * @returns {Promise<Object|null>} Complete GeoJSON feature or null
     */
    async getCompleteFeatureFromSource(type, featureId) {
        // O SEGUNDO FUNIL DO TURF, e o que fecha o caminho que `ensureControl` nao ve.
        //
        // Quem le `turf.bbox` na selecao e o `createSelectionBox` de vinte e quatro controles,
        // e ele e chamado de dois lugares, os DOIS sincronos: `managers/selection-highlight.
        // manager.js` (a caixa local) e `presence/remote-selections.layer.js` (a caixa do
        // colega). O segundo nao pode ser tocado nesta onda, e nao precisa: ele e `async` e
        // chama ESTE metodo antes de pedir a caixa ao controle. Um `await` aqui garante o Turf
        // um gesto antes, e vale para os dois caminhos de uma vez.
        //
        // A CONTA E BARATA depois da primeira vez: `ensureTurf` devolve uma promessa ja
        // resolvida, e este metodo ja era `async` e ja fazia um `await mapSource.getData()`.
        // Selecao em grupo chama isto por feicao, e o memo do carregador absorve o laco.
        await ensureTurf().catch((erro) => {
            // Turf ausente nao pode cancelar a SELECAO: sem a caixa a feicao ainda seleciona,
            // ainda abre o painel e ainda edita. Cancelar aqui trocaria uma caixa que falta
            // por uma ferramenta que nao responde.
            console.warn('Turf nao carregou antes da selecao:', erro);
        });

        // Le a FONTE pelo descritor, nunca pela instancia: ler a geometria completa de uma
        // feicao nao e motivo para baixar a ferramenta que a desenha.
        const sourceNames = this._fontesDoTipo(type);
        if (!sourceNames?.length) {
            console.warn(`Source names not found for type: ${type}`);
            return null;
        }

        const sourceName = sourceNames[0];
        const mapSource = this.map.getSource(sourceName);
        if (!mapSource) return null;

        const data = await mapSource.getData();
        if (!data) return null;

        return data.features.find(f => f.properties.id === featureId);
    }

    /**
     * Notify UI of geometry change (for cache invalidation).
     * @param {string} featureId
     */
    notifyGeometryChange(featureId) {
        this.uiManager?.notifyGeometryChange(featureId);
    }

    /**
     * Notify UI of multiple geometry changes.
     * @param {Array<string>} featureIds
     */
    notifyMultipleGeometryChanges(featureIds) {
        featureIds.forEach(id => this.notifyGeometryChange(id));
    }

    /**
     * Update UI after selection changes.
     */
    updateUI() {
        // Selection highlight is updated via StateManager subscription
        // in UIManager._initSubscriptions() when selection.features changes.
        this.uiManager?.updatePanels();
    }

    /**
     * Update elevation profile display.
     */
    updateProfile() {
        this.uiManager?.updateProfile();
    }

    /**
     * Get currently active tool.
     * @returns {Object|null}
     */
    getActiveTool() {
        if (this.vectorTileInfoControl?.isActive) return this.vectorTileInfoControl;
        if (this.rectangleSelectionControl?.isActive) return this.rectangleSelectionControl;

        // So instancias, e nao ha buraco nisso: uma ferramenta que nunca carregou nunca foi
        // ativada, porque ativa-la e o que a carrega.
        for (const control of this.controls.values()) {
            if (control.isActive) return control;
        }

        return null;
    }

    /**
     * Delete all selected features.
     * Uses batch undo so all deletions can be undone with a single Ctrl+Z.
     */
    async deleteSelectedFeatures() {
        const featuresByType = new Map();
        const selectedFeatures = this.getAllSelectedFeatures();

        for (const feature of selectedFeatures) {
            const type = feature.properties.source;
            if (!featuresByType.has(type)) {
                featuresByType.set(type, []);
            }
            featuresByType.get(type).push(feature);
        }

        // Batch all deletions so they produce a single undo entry
        const needsBatch = featuresByType.size > 1 ||
            [...featuresByType.values()].some(features => features.length > 1);

        if (needsBatch) startBatchUndo();
        try {
            for (const [type, features] of featuresByType) {
                const control = await this.ensureControlFor(type);
                await control?.deleteFeatures?.(features);
            }
            if (needsBatch) commitBatchUndo();
        } catch (error) {
            // Commit (not discard): some features may have already been deleted and
            // persisted; discarding would drop their undo records, making the
            // already-committed deletions impossible to undo with Ctrl+Z.
            if (needsBatch) commitBatchUndo();
            console.error('Error during batch delete:', error);
        }

        this.deselectAllFeatures();
    }

    /**
     * Update all selected features (after batch property change).
     * Uses batch undo so all updates can be undone with a single Ctrl+Z.
     */
    async updateSelectedFeatures() {
        const selectedFeatures = this.getAllSelectedFeatures();
        const featuresByType = new Map();
        const allFeatureIds = [];

        for (const feature of selectedFeatures) {
            const type = feature.properties.source;
            if (!featuresByType.has(type)) {
                featuresByType.set(type, []);
            }
            featuresByType.get(type).push(feature);

            if (feature.properties?.id) {
                allFeatureIds.push(feature.properties.id);
            }
        }

        this.notifyMultipleGeometryChanges(allFeatureIds);

        // Batch all updates so they produce a single undo entry
        const totalFeatures = [...featuresByType.values()].reduce((sum, f) => sum + f.length, 0);
        const needsBatch = totalFeatures > 1;

        if (needsBatch) startBatchUndo();
        try {
            for (const [type, features] of featuresByType) {
                const control = await this.ensureControlFor(type);
                await control?.updateFeatures?.(features, true);
            }
            if (needsBatch) commitBatchUndo();
        } catch (error) {
            if (needsBatch) discardBatchUndo();
            console.error('Error during batch update:', error);
        }
    }

    /**
     * Cleanup resources.
     * Call when component is destroyed.
     */
    destroy() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        this._hideFeatureSelectionMenu();

        // Cleanup map event listeners
        this.map.off('click', this._handleMapClick);

        if (this._handleMapInteraction) {
            this.map.off('movestart', this._handleMapInteraction);
            this.map.off('zoomstart', this._handleMapInteraction);
            this._handleMapInteraction = null;
        }

        // Cleanup document event listener
        if (this._handleKeydown) {
            document.removeEventListener('keydown', this._handleKeydown);
            this._handleKeydown = null;
        }

        // Cleanup two-finger tap handler
        if (this._cleanupTwoFingerTap) {
            this._cleanupTwoFingerTap();
            this._cleanupTwoFingerTap = null;
        }
    }
}

export default SelectionManager;
