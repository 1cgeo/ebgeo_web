// Path: js/features_tab/features_tab.js

/**
 * @fileoverview FeaturesTab - Main orchestrator for the features panel.
 */

import { FEATURES_TAB_ICONS } from './features_tab.icons.js';
import { injectAllFeaturesTabStyles } from './features_tab.styles.js';
import { FEATURE_SOURCES, REFRESH_DEBOUNCE_MS } from './features_tab.constants.js';
import {
    createCatalogLayersContainer,
    renderCatalogLayers,
    initCatalogLayerListeners,
} from './catalog-layers.component.js';
import {
    createModels3dSectionContainer,
    renderModels3dSection,
    initModels3dSectionListeners,
} from './models3d-section.component.js';
import {
    createStreetview360SectionContainer,
    renderStreetview360Section,
    initStreetview360SectionListeners,
} from './streetview360-section.component.js';
import {
    handleSetActiveLayer,
    handleAddLayer,
    updateActiveLayerIndicators,
    updateLayerVisibilityIndicator,
    updateLayerLockIndicator,
} from './layer-list.component.js';
import {
    handleFeatureClick,
    toggleFeatureVisibility,
    toggleFeatureLock,
    updateVisibilityButton,
    updateLockButton,
    updateItemVisualState,
} from './feature-item.component.js';
import {
    handleGroupFeatureClick,
    toggleGroupExpansion,
    toggleGroupVisibility,
    toggleGroupLock,
    updateGroupVisualState,
    updateGroupLockState,
} from './group-item.component.js';
import { getCollapseStateManager } from './collapse-state.manager.js';
import { getFeaturesFromMapSources, organizeFeaturesByLayers } from './feature-organizer.service.js';
import { initLayerSortable, destroySortable } from './sortable.handler.js';
import {
    createLayerContainer,
    applyLayerCollapseState,
    applyGroupCollapseState,
} from './layer-container.builder.js';

import {
    getLayers,
    setLayerVisibility,
    setLayerLocked,
    createLayer,
    deleteLayer,
    renameLayer,
    getCurrentMapNameSync,
} from '../store';
import { EventTypes } from '../events';
import { showConfirm } from '../modals/index.js';
import { isViewer3DOpen } from '../utilities/viewer3d-state.js';
import { isStreetView360Open } from '../utilities/streetview360-state.js';

/**
 * FeaturesTab class - Main orchestrator for the features panel.
 * Manages layers, groups, and features display in the sidebar.
 */
export class FeaturesTab {
    /**
     * @param {Object} map - MapLibre map instance
     * @param {Object} selectionManager - Selection manager instance
     * @param {Object} analysisLayersManager - Analysis layers manager instance
     * @param {Object} dataLayersManager - Data layers manager instance
     * @param {import('../events/event_bus.js').EventBus} eventBus - Event bus instance
     */
    constructor(map, selectionManager, analysisLayersManager, dataLayersManager, eventBus) {
        this.map = map;
        this.selectionManager = selectionManager;
        this.container = null;
        this.analysisLayersManager = analysisLayersManager;
        this.dataLayersManager = dataLayersManager;
        this._eventBus = eventBus;

        this._sourceDataHandler = null;
        this._groupsChangedHandler = null;
        this._layersChangedHandler = null;
        this._debounceTimer = null;
        this._isVisible = false;

        this._suppressRefresh = false;
        this._suppressLayersChangedRefresh = false;

        this._sortableInstance = null;
        this._unsubscribers = [];
        this._collapseManager = getCollapseStateManager();
        this._catalogLayerUnsubscriber = null;
        this._models3dSectionUnsubscriber = null;
        this._streetview360SectionUnsubscriber = null;

        // Track 3D viewer state
        this._is3DViewerOpen = false;
        // Track 360 viewer state
        this._is360ViewerOpen = false;

        this.INLINE_ICONS = FEATURES_TAB_ICONS;
        this.FEATURE_SOURCES = FEATURE_SOURCES;

        // Attribute table control reference (set by external code)
        this._attributeTableControl = null;

        injectAllFeaturesTabStyles();
    }

    /**
     * Sets the attribute table control reference.
     * @param {Object} control - AttributeTableControl instance
     */
    setAttributeTableControl(control) {
        this._attributeTableControl = control;
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Creates the UI structure for the features tab.
     * @returns {HTMLElement} Container element
     */
    createUI() {
        this.container = document.createElement('div');
        this.container.className = 'features-tab-content';
        this.container.style.display = 'none';

        // Catalog layers container (shows layers added from catalog - analysis section)
        const catalogLayersContainer = createCatalogLayersContainer();
        this.container.appendChild(catalogLayersContainer);

        // 3D models section (shows tilesets with markers)
        const models3dContainer = createModels3dSectionContainer();
        this.container.appendChild(models3dContainer);

        // Street View 360 section (shows photos with orientations and markers)
        const streetview360Container = createStreetview360SectionContainer();
        this.container.appendChild(streetview360Container);

        const header = this._createHeader();
        this.container.appendChild(header);

        const featuresList = document.createElement('div');
        featuresList.className = 'features-list';
        this.container.appendChild(featuresList);

        // Initialize catalog layer listeners
        this._catalogLayerUnsubscriber = initCatalogLayerListeners(
            this.map,
            this._eventBus,
            this.analysisLayersManager,
            this.dataLayersManager
        );

        // Initialize 3D models section listeners
        this._models3dSectionUnsubscriber = initModels3dSectionListeners(
            this.container.querySelector('.models3d-section'),
            this._eventBus
        );

        // Initialize Street View 360 section listeners
        this._streetview360SectionUnsubscriber = initStreetview360SectionListeners(
            this.container.querySelector('.streetview360-section'),
            this._eventBus
        );

        return this.container;
    }

    /**
     * Shows the features tab and loads content.
     */
    async show() {
        if (this.container) {
            this._isVisible = true;
            this.container.style.display = 'block';

            if (!this._sourceDataHandler) {
                this._setupEventListeners();
            }

            // Check initial 3D and 360 viewer state
            this._is3DViewerOpen = isViewer3DOpen();
            this._is360ViewerOpen = isStreetView360Open();

            // Render catalog layers from store (analysis + data sections)
            await renderCatalogLayers(
                this.container.querySelector('.catalog-layers-section'),
                this.map,
                this._eventBus,
                this.analysisLayersManager,
                this.dataLayersManager
            );

            // Render 3D models section
            await renderModels3dSection(
                this.container.querySelector('.models3d-section'),
                this._eventBus
            );

            // Render Street View 360 section
            await renderStreetview360Section(
                this.container.querySelector('.streetview360-section'),
                this._eventBus
            );

            await this.loadFeatures();

            // Apply viewer mode UI after content is loaded
            this._updateViewerModeUI();
        }
    }

    /**
     * Hides the features tab.
     */
    hide() {
        if (this.container) {
            this._isVisible = false;
            this.container.style.display = 'none';
            clearTimeout(this._debounceTimer);
        }
    }

    /**
     * Destroys the features tab and cleans up resources.
     */
    destroy() {
        this._removeEventListeners();
        clearTimeout(this._debounceTimer);
        destroySortable(this._sortableInstance);
        this._sortableInstance = null;

        // Cleanup catalog layer listener
        if (this._catalogLayerUnsubscriber) {
            this._catalogLayerUnsubscriber();
            this._catalogLayerUnsubscriber = null;
        }

        // Cleanup 3D models section listener
        if (this._models3dSectionUnsubscriber) {
            this._models3dSectionUnsubscriber();
            this._models3dSectionUnsubscriber = null;
        }

        // Cleanup Street View 360 section listener
        if (this._streetview360SectionUnsubscriber) {
            this._streetview360SectionUnsubscriber();
            this._streetview360SectionUnsubscriber = null;
        }
    }

    /**
     * Loads and renders features from map sources.
     */
    async loadFeatures() {
        if (!this.container) return;

        const featuresList = this.container.querySelector('.features-list');
        const isInitialLoad =
            !featuresList ||
            featuresList.children.length === 0 ||
            featuresList.querySelector('.features-loading') ||
            featuresList.querySelector('.features-empty-message');

        if (isInitialLoad) {
            this._showLoadingSpinner();
        }

        try {
            const features = await getFeaturesFromMapSources(this.map, this.FEATURE_SOURCES);
            const organizedData = await organizeFeaturesByLayers(features);
            this._renderOrganizedFeatures(organizedData);
        } catch (error) {
            console.error('Error loading features:', error);
            this._renderErrorMessage();
        }
    }

    // =========================================================================
    // LAYER METHODS
    // =========================================================================

    /**
     * Handles adding a new layer.
     */
    async _handleAddLayer() {
        await handleAddLayer(createLayer, {
            onRefresh: () => this.loadFeatures(),
            onLayersChanged: () => this._emitLayersChanged(),
        });
    }

    /**
     * Handles setting the active layer.
     * @param {string} layerId - Layer ID to set as active
     */
    async handleSetActiveLayer(layerId) {
        await handleSetActiveLayer(
            layerId,
            {
                onLayerSelect: (id) => this.handleSetActiveLayer(id),
                onLayersChanged: () => this._emitLayersChanged(),
                onRefresh: () => this.loadFeatures(),
            },
            (prevId, newId) => updateActiveLayerIndicators(this.container, prevId, newId)
        );
    }

    /**
     * Handles toggling layer visibility.
     * @param {string} layerId - Layer ID to toggle
     */
    async handleToggleLayerVisibility(layerId) {
        try {
            const layers = await getLayers();
            const layer = layers.find((l) => l.id === layerId);
            if (!layer) return;

            const newVisibility = !layer.visible;
            await setLayerVisibility(layerId, newVisibility);

            updateLayerVisibilityIndicator(this.container, layerId, newVisibility);

            this._suppressLayersChangedRefresh = true;
            this._emitLayersChanged();
            setTimeout(() => {
                this._suppressLayersChangedRefresh = false;
            }, 50);
        } catch (error) {
            console.error('Error changing visibility:', error);
        }
    }

    /**
     * Handles toggling layer lock state.
     * @param {string} layerId - Layer ID to toggle
     */
    async handleToggleLayerLock(layerId) {
        try {
            const layers = await getLayers();
            const layer = layers.find((l) => l.id === layerId);
            if (!layer) return;

            const newLockState = !layer.locked;
            await setLayerLocked(layerId, newLockState);

            updateLayerLockIndicator(this.container, layerId, newLockState);

            this._suppressLayersChangedRefresh = true;
            this._emitLayersChanged();
            setTimeout(() => {
                this._suppressLayersChangedRefresh = false;
            }, 50);
        } catch (error) {
            console.error('Error changing lock state:', error);
        }
    }

    /**
     * Handles deleting a layer and all its features.
     * @param {string} layerId - Layer ID to delete
     */
    async handleDeleteLayer(layerId) {
        const layers = await getLayers();
        const layer = layers.find((l) => l.id === layerId);
        if (!layer) return;

        const isLastLayer = layers.length <= 1;
        const message = isLastLayer
            ? 'Todas as feições desta camada serão PERMANENTEMENTE excluídas!\n\nUma nova camada "Padrão" vazia será criada automaticamente.'
            : 'Todas as feições desta camada serão PERMANENTEMENTE excluídas!';

        const confirmed = await showConfirm(`Excluir a camada "${layer.name}"?`, {
            message,
            destructive: true
        });
        if (!confirmed) return;

        try {
            this._suppressLayersChangedRefresh = true;

            await this._syncMapSourcesAfterDelete(layerId);

            const deleteResult = await deleteLayer(layerId);

            if (!deleteResult) {
                this._suppressLayersChangedRefresh = false;
                return;
            }

            const layersAfterDelete = await getLayers();

            if (
                isLastLayer &&
                layersAfterDelete.length === 1 &&
                layersAfterDelete[0].name !== 'Padrão'
            ) {
                await renameLayer(layersAfterDelete[0].id, 'Padrão');
            }

            this._suppressLayersChangedRefresh = false;

            await this.loadFeatures();
            this._emitLayersChanged();
        } catch (error) {
            this._suppressLayersChangedRefresh = false;
            console.error('Error deleting layer:', error);
            alert('Erro ao excluir camada: ' + error.message);
        }
    }

    /**
     * Handles renaming a layer.
     * @param {string} layerId - Layer ID to rename
     * @param {string} newName - New layer name
     */
    async handleRenameLayer(layerId, newName) {
        if (!newName || !newName.trim()) {
            throw new Error('Layer name cannot be empty');
        }

        await renameLayer(layerId, newName.trim());
        await this.loadFeatures();
    }

    // =========================================================================
    // FEATURE METHODS
    // =========================================================================

    /**
     * Toggles feature visibility.
     * @param {string} featureId - Feature ID
     * @param {string} featureType - Feature storage type
     */
    async toggleVisibility(featureId, featureType) {
        await toggleFeatureVisibility(
            featureId,
            featureType,
            (type, id, prop, val) => this._propagateFeaturePropertyToSource(type, id, prop, val),
            (id, visible) => updateVisibilityButton(this.container, id, visible),
            (id, visible, locked) => updateItemVisualState(this.container, id, visible, locked),
            this.selectionManager
        );
    }

    /**
     * Toggles feature lock.
     * @param {string} featureId - Feature ID
     * @param {string} featureType - Feature storage type
     */
    async toggleLock(featureId, featureType) {
        await toggleFeatureLock(
            featureId,
            featureType,
            (type, id, prop, val) => this._propagateFeaturePropertyToSource(type, id, prop, val),
            (id, locked) => updateLockButton(this.container, id, locked),
            (id, visible, locked) => updateItemVisualState(this.container, id, visible, locked),
            this.selectionManager
        );
    }

    /**
     * Handles feature click.
     * @param {Object} feature - Feature data
     */
    async handleFeatureClick(feature) {
        await handleFeatureClick(feature, this.map, this.selectionManager);
    }

    // =========================================================================
    // GROUP METHODS
    // =========================================================================

    /**
     * Toggles group expansion.
     * @param {string} groupId - Group ID
     */
    toggleGroupExpansion(groupId) {
        toggleGroupExpansion(this.container, groupId, (id, collapsed) =>
            this._collapseManager.setGroupCollapsed(id, collapsed)
        );
    }

    /**
     * Toggles group visibility.
     * @param {string} groupId - Group ID
     * @param {boolean} currentVisibility - Current visibility state
     */
    async toggleGroupVisibility(groupId, currentVisibility) {
        await toggleGroupVisibility(
            groupId,
            currentVisibility,
            (type, id, prop, val) => this._propagateFeaturePropertyToSource(type, id, prop, val),
            (id, visible) => updateGroupVisualState(this.container, id, visible)
        );
    }

    /**
     * Toggles group lock.
     * @param {string} groupId - Group ID
     * @param {boolean} currentLockState - Current lock state
     */
    async toggleGroupLock(groupId, currentLockState) {
        await toggleGroupLock(
            groupId,
            currentLockState,
            (type, id, prop, val) => this._propagateFeaturePropertyToSource(type, id, prop, val),
            (id, locked) => updateGroupLockState(this.container, id, locked),
            this.selectionManager
        );
    }

    /**
     * Handles click on feature inside group.
     * @param {Object} feature - Feature data
     * @param {Object} groupData - Parent group data
     */
    async handleGroupFeatureClick(feature, groupData) {
        await handleGroupFeatureClick(feature, groupData, this.map, this.selectionManager);
    }

    // =========================================================================
    // PRIVATE - UI RENDERING
    // =========================================================================

    /**
     * Creates the header with add layer button.
     * @returns {HTMLElement} Header element
     */
    _createHeader() {
        const header = document.createElement('div');
        header.className = 'sidebar-section-header sidebar-section-header-with-action';

        const title = document.createElement('span');
        title.textContent = 'Camadas';

        const addLayerBtn = document.createElement('button');
        addLayerBtn.className = 'sidebar-section-header-btn';
        addLayerBtn.title = 'Nova camada';
        addLayerBtn.innerHTML = this.INLINE_ICONS.ADD;
        addLayerBtn.onclick = () => this._handleAddLayer();

        header.appendChild(title);
        header.appendChild(addLayerBtn);

        return header;
    }

    /**
     * Shows loading spinner.
     */
    _showLoadingSpinner() {
        const featuresList = this.container.querySelector('.features-list');
        featuresList.innerHTML = `
            <div class="features-loading">
                <div class="spinner"></div>
                <div class="loading-text">Atualizando...</div>
            </div>
        `;
    }

    /**
     * Renders error message.
     */
    _renderErrorMessage() {
        const featuresList = this.container.querySelector('.features-list');
        featuresList.innerHTML = `
            <div class="features-error" style="
                padding: 20px;
                text-align: center;
                color: #dc3545;
                font-size: 14px;
                background-color: #ffffff;
                border-radius: 4px;
            ">
                Erro ao carregar feições
            </div>
        `;
    }

    /**
     * Renders empty message.
     * @param {HTMLElement} container - Container element
     */
    _renderEmptyMessage(container) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'features-empty-message';
        emptyMessage.style.cssText = `
            padding: 20px;
            text-align: center;
            color: #666;
            font-size: 14px;
            font-style: italic;
            background-color: #ffffff;
            border-radius: 4px;
        `;
        emptyMessage.textContent = 'Sem feições no mapa';
        container.appendChild(emptyMessage);
    }

    /**
     * Renders organized features by layer.
     * @param {Array} organizedLayers - Organized layer data
     */
    _renderOrganizedFeatures(organizedLayers) {
        const featuresList = this.container.querySelector('.features-list');
        featuresList.innerHTML = '';

        if (!Array.isArray(organizedLayers) || organizedLayers.length === 0) {
            this._renderEmptyMessage(featuresList);
            return;
        }

        const callbacks = this._createLayerCallbacks();

        organizedLayers.forEach((layerInfo) => {
            const layerContainer = createLayerContainer(layerInfo, callbacks);
            featuresList.appendChild(layerContainer);

            applyLayerCollapseState(
                layerContainer,
                this._collapseManager.isLayerCollapsed(layerInfo.layer.id)
            );
        });

        // Apply group collapse states
        this._collapseManager.getCollapsedGroups().forEach((groupId) => {
            const groupContainer = featuresList.querySelector(`[data-group-id="${groupId}"]`);
            if (groupContainer) {
                applyGroupCollapseState(groupContainer, true);
            }
        });

        // Initialize sortable for layer reordering
        destroySortable(this._sortableInstance);
        this._sortableInstance = initLayerSortable(featuresList);
    }

    /**
     * Creates callback object for layer container.
     * @returns {Object} Callbacks object
     */
    _createLayerCallbacks() {
        return {
            onLayerSelect: (id) => this.handleSetActiveLayer(id),
            onLayersChanged: () => this._emitLayersChanged(),
            onRefresh: () => this.loadFeatures(),
            onSyncMapSources: (id) => this._syncMapSourcesAfterDelete(id),
            onToggleLayerExpansion: (id) => this._toggleLayerExpansion(id),
            onToggleLayerVisibility: (id) => this.handleToggleLayerVisibility(id),
            onToggleLayerLock: (id) => this.handleToggleLayerLock(id),
            onDeleteLayer: (id) => this.handleDeleteLayer(id),
            onToggleGroupExpansion: (id) => this.toggleGroupExpansion(id),
            onToggleGroupVisibility: (id, vis) => this.toggleGroupVisibility(id, vis),
            onToggleGroupLock: (id, lock) => this.toggleGroupLock(id, lock),
            onGroupFeatureClick: (feature, group) => this.handleGroupFeatureClick(feature, group),
            onFeatureClick: (feature) => this.handleFeatureClick(feature),
            onToggleFeatureVisibility: (id, type) => this.toggleVisibility(id, type),
            onToggleFeatureLock: (id, type) => this.toggleLock(id, type),
            propagatePropertyToSource: (type, id, prop, val) =>
                this._propagateFeaturePropertyToSource(type, id, prop, val),
            onOpenAttributeTable: (layerId) => this._handleOpenAttributeTable(layerId),
        };
    }

    /**
     * Handles opening the attribute table for a layer.
     * @param {string} layerId - Layer ID
     */
    _handleOpenAttributeTable(layerId) {
        if (this._attributeTableControl) {
            this._attributeTableControl.toggle(layerId);
        }
    }

    /**
     * Toggles layer expansion.
     * @param {string} layerId - Layer ID
     */
    _toggleLayerExpansion(layerId) {
        const container = this.container.querySelector(
            `.layer-container[data-layer-id="${layerId}"]`
        );
        if (!container) return;

        const isCollapsed = this._collapseManager.isLayerCollapsed(layerId);
        const newState = !isCollapsed;

        this._collapseManager.setLayerCollapsed(layerId, newState);
        applyLayerCollapseState(container, newState);
    }

    // =========================================================================
    // PRIVATE - DATA SYNC
    // =========================================================================

    /**
     * Syncs MapLibre sources after deleting features from a layer.
     * @param {string} deletedLayerId - Deleted layer ID
     */
    async _syncMapSourcesAfterDelete(deletedLayerId) {
        for (const sourceId of this.FEATURE_SOURCES) {
            const source = this.map.getSource(sourceId);
            if (!source) continue;

            try {
                const data = await source.getData();
                if (data && data.features && data.features.length > 0) {
                    const initialCount = data.features.length;
                    data.features = data.features.filter((f) => {
                        const featureLayerId = f.properties?.layerId || 'default';
                        return featureLayerId !== deletedLayerId;
                    });

                    if (data.features.length !== initialCount) {
                        source.setData(data);
                    }
                }
            } catch (error) {
                console.debug(`Error syncing source ${sourceId}:`, error.message);
            }
        }
    }

    /**
     * Propagates property change to Mapbox source.
     * @param {string} featureType - Feature type
     * @param {string} featureId - Feature ID
     * @param {string} property - Property name
     * @param {*} value - Property value
     */
    async _propagateFeaturePropertyToSource(featureType, featureId, property, value) {
        const source = this.map.getSource(featureType);
        if (!source) {
            console.warn(`Source ${featureType} not found`);
            return;
        }

        try {
            this._suppressRefresh = true;

            const data = await source.getData();

            const featureIndex = data.features.findIndex(
                (f) => f.properties.id === featureId || f.id === featureId
            );

            if (featureIndex !== -1) {
                data.features[featureIndex].properties[property] = value;
                source.setData(data);

                // For LOS and visibility features, also update processed sources
                if ((property === 'visivel' || property === 'bloqueado') &&
                    (featureType === 'los' || featureType === 'visibility')) {
                    await this._propagatePropertyToProcessedSource(featureType, featureId, property, value);
                }
            } else {
                console.warn(`Feature ${featureId} not found in source ${featureType}`);
            }
        } catch (error) {
            console.error(`Error propagating property to source ${featureType}:`, error);
        } finally {
            setTimeout(() => {
                this._suppressRefresh = false;
            }, 50);
        }
    }

    /**
     * Propagates property change to processed sources (LOS, visibility).
     * @param {string} featureType - Feature type ('los' or 'visibility')
     * @param {string} featureId - Feature ID
     * @param {string} property - Property name
     * @param {*} value - Property value
     * @private
     */
    async _propagatePropertyToProcessedSource(featureType, featureId, property, value) {
        const processedSourceName = `processed-${featureType}`;
        const processedSource = this.map.getSource(processedSourceName);

        if (!processedSource) {
            return;
        }

        try {
            const processedData = await processedSource.getData();

            // Update all processed features that belong to this main feature
            // Processed features have IDs like "featureId-visible" and "featureId-obstructed"
            let updated = false;
            for (const feature of processedData.features) {
                if (feature.properties.id?.startsWith(featureId + '-') ||
                    feature.properties.id === featureId + '-visible' ||
                    feature.properties.id === featureId + '-obstructed') {
                    feature.properties[property] = value;
                    updated = true;
                }
            }

            if (updated) {
                processedSource.setData(processedData);
            }
        } catch (error) {
            console.error(`Error propagating property to processed source ${processedSourceName}:`, error);
        }
    }

    /**
     * Emits layers changed event.
     */
    _emitLayersChanged() {
        this._eventBus.emit(EventTypes.LAYERS_CHANGED, {
            mapName: getCurrentMapNameSync(),
        });
    }

    // =========================================================================
    // PRIVATE - EVENT LISTENERS
    // =========================================================================

    /**
     * Sets up event listeners.
     */
    _setupEventListeners() {
        this._sourceDataHandler = (e) => this._handleSourceData(e);
        this.map.on('sourcedata', this._sourceDataHandler);

        this._groupsChangedHandler = () => this._scheduleRefresh();
        this._unsubscribers.push(
            this._eventBus.on(EventTypes.GROUPS_CHANGED, this._groupsChangedHandler)
        );

        this._layersChangedHandler = () => {
            if (this._suppressLayersChangedRefresh) return;
            this._scheduleRefresh();
        };
        this._unsubscribers.push(
            this._eventBus.on(EventTypes.LAYERS_CHANGED, this._layersChangedHandler)
        );

        // Listen for 3D viewer state changes
        this._viewer3DOpenedHandler = () => {
            this._is3DViewerOpen = true;
            this._updateViewerModeUI();
        };
        this._unsubscribers.push(
            this._eventBus.on(EventTypes.VIEWER_3D_OPENED, this._viewer3DOpenedHandler)
        );

        this._viewer3DClosedHandler = () => {
            this._is3DViewerOpen = false;
            this._updateViewerModeUI();
        };
        this._unsubscribers.push(
            this._eventBus.on(EventTypes.VIEWER_3D_CLOSED, this._viewer3DClosedHandler)
        );

        // Listen for 360 viewer state changes
        this._viewer360OpenedHandler = () => {
            this._is360ViewerOpen = true;
            this._updateViewerModeUI();
        };
        this._unsubscribers.push(
            this._eventBus.on(EventTypes.STREETVIEW_360_OPENED, this._viewer360OpenedHandler)
        );

        this._viewer360ClosedHandler = () => {
            this._is360ViewerOpen = false;
            this._updateViewerModeUI();
        };
        this._unsubscribers.push(
            this._eventBus.on(EventTypes.STREETVIEW_360_CLOSED, this._viewer360ClosedHandler)
        );
    }

    /**
     * Removes event listeners.
     */
    _removeEventListeners() {
        if (this._sourceDataHandler) {
            this.map.off('sourcedata', this._sourceDataHandler);
            this._sourceDataHandler = null;
        }

        this._unsubscribers.forEach((unsub) => unsub());
        this._unsubscribers = [];

        this._groupsChangedHandler = null;
        this._layersChangedHandler = null;
        this._viewer3DOpenedHandler = null;
        this._viewer3DClosedHandler = null;
        this._viewer360OpenedHandler = null;
        this._viewer360ClosedHandler = null;
    }

    /**
     * Updates UI based on 3D or 360 viewer mode.
     * When 3D viewer is open, disable non-3D sections and move 3D models section to top.
     * When 360 viewer is open, disable non-360 sections and move 360 section to top.
     * @private
     */
    _updateViewerModeUI() {
        if (!this.container) return;

        const catalogSection = this.container.querySelector('.catalog-layers-section');
        const models3dSection = this.container.querySelector('.models3d-section');
        const streetview360Section = this.container.querySelector('.streetview360-section');
        const layersHeader = this.container.querySelector('.sidebar-section-header-with-action');
        const featuresList = this.container.querySelector('.features-list');

        if (this._is3DViewerOpen) {
            // Disable non-3D sections
            if (catalogSection) {
                catalogSection.classList.add('disabled-3d-mode');
            }
            if (streetview360Section) {
                streetview360Section.classList.add('disabled-3d-mode');
            }
            if (layersHeader) {
                layersHeader.classList.add('disabled-3d-mode');
            }
            if (featuresList) {
                featuresList.classList.add('disabled-3d-mode');
            }
            // Ensure 3D section is enabled and at top
            if (models3dSection) {
                models3dSection.classList.remove('disabled-3d-mode');
                models3dSection.classList.add('active-3d-mode');
                // Move to top of container
                this.container.insertBefore(models3dSection, this.container.firstChild);
            }
        } else if (this._is360ViewerOpen) {
            // Disable non-360 sections
            if (catalogSection) {
                catalogSection.classList.add('disabled-3d-mode');
            }
            if (models3dSection) {
                models3dSection.classList.add('disabled-3d-mode');
            }
            if (layersHeader) {
                layersHeader.classList.add('disabled-3d-mode');
            }
            if (featuresList) {
                featuresList.classList.add('disabled-3d-mode');
            }
            // Ensure 360 section is enabled and at top
            if (streetview360Section) {
                streetview360Section.classList.remove('disabled-3d-mode');
                streetview360Section.classList.add('active-360-mode');
                // Move to top of container
                this.container.insertBefore(streetview360Section, this.container.firstChild);
            }
        } else {
            // Re-enable all sections
            if (catalogSection) {
                catalogSection.classList.remove('disabled-3d-mode');
            }
            if (models3dSection) {
                models3dSection.classList.remove('disabled-3d-mode');
            }
            if (streetview360Section) {
                streetview360Section.classList.remove('disabled-3d-mode');
            }
            if (layersHeader) {
                layersHeader.classList.remove('disabled-3d-mode');
            }
            if (featuresList) {
                featuresList.classList.remove('disabled-3d-mode');
            }
            // Reset positions
            if (models3dSection) {
                models3dSection.classList.remove('active-3d-mode');
                // Move back to original position (after catalog section)
                if (catalogSection && catalogSection.nextSibling !== models3dSection) {
                    catalogSection.after(models3dSection);
                }
            }
            if (streetview360Section) {
                streetview360Section.classList.remove('active-360-mode');
                // Move back to original position (after 3D models section)
                if (models3dSection && models3dSection.nextSibling !== streetview360Section) {
                    models3dSection.after(streetview360Section);
                }
            }
        }
    }

    /**
     * @deprecated Use _updateViewerModeUI instead
     * @private
     */
    _update3DViewerModeUI() {
        this._updateViewerModeUI();
    }

    /**
     * Handles source data event.
     * @param {Object} e - Source data event
     */
    _handleSourceData(e) {
        if (!this._isVisible) return;
        if (this._suppressRefresh) return;
        if (!this.FEATURE_SOURCES.includes(e.sourceId)) return;
        this._scheduleRefresh();
    }

    /**
     * Schedules a debounced refresh.
     */
    _scheduleRefresh() {
        if (!this._isVisible) return;
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(async () => {
            // Re-render catalog layers (analysis + data sections)
            await renderCatalogLayers(
                this.container.querySelector('.catalog-layers-section'),
                this.map,
                this._eventBus,
                this.analysisLayersManager,
                this.dataLayersManager
            );
            // Re-render 3D models section
            await renderModels3dSection(
                this.container.querySelector('.models3d-section'),
                this._eventBus
            );
            // Re-render Street View 360 section
            await renderStreetview360Section(
                this.container.querySelector('.streetview360-section'),
                this._eventBus
            );
            // Re-render features
            await this.loadFeatures();
        }, REFRESH_DEBOUNCE_MS);
    }
}
