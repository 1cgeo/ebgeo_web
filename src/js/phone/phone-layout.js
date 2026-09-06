// Path: js/phone/phone-layout.js

/**
 * @fileoverview Phone layout orchestrator for EBGeo (<=480px).
 * Detects phone viewport via matchMedia, creates/destroys all phone-specific
 * components, and wires inter-component communication and store integration.
 *
 * Lifecycle:
 * - init()                 — check media query, activate if phone, listen for changes
 * - _activatePhoneMode()   — create all components, mount to body, wire events
 * - _deactivatePhoneMode() — destroy all components, unwire events
 * - destroy()              — full cleanup
 */

import { PhoneBottomSheet } from './phone-bottom-sheet.js';
import { PhoneSearchOverlay } from './phone-search-overlay.js';
import { PhoneDrawer } from './phone-drawer.js';
import { PhoneFabs } from './phone-fabs.js';
import { PhoneMoveActions } from './phone-move-actions.js';
import { PhoneFeatureEditor } from './phone-feature-editor.js';
import { PhoneBaseLayerModal } from './phone-baselayer-modal.js';
import { getEventBus, getStateManager } from '@store/services.js';
import {
    getControl,
    getFeatureById,
    updateFeature,
    addMap,
    renameMap,
    removeMap,
    getCurrentMapNameSync,
    getLayers,
    getCurrentMapFeatures,
    getAllStorageTypes,
    getAllMapNamesStore,
    setCurrentMap,
    setLayerVisibility,
} from '@store';
import { EventTypes } from '@events/event_types.js';
import { queryFeaturesAtPoint } from '@tools/helpers/feature-hit-test.helpers.js';
import { showToast } from '@utils';
import config from '@js/config.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const PHONE_QUERY = '(max-width: 480px), (max-height: 440px) and (pointer: coarse)';

/**
 * Maps toolbar controlKey values to the registered control names in the
 * global control registry (map_sig.js). The toolbar constants use camelCase
 * variable names while the registry uses PascalCase class-style names.
 * @type {Object<string, string>}
 */
const CONTROL_KEY_TO_REGISTRY = {
    pointControl: 'AddPointControl',
    lineControl: 'AddLineControl',
    polygonControl: 'AddPolygonControl',
    rectangleControl: 'AddRectangleControl',
    circleControl: 'AddCircleControl',
    ellipseControl: 'AddEllipseControl',
    textControl: 'AddTextControl',
    imageControl: 'AddImageControl',
    brushControl: 'AddBrushControl',
    sectorControl: 'AddSectorControl',
    azimuthDistanceControl: 'AddAzimuthDistanceControl',
    militarySymbolControl: 'AddMilitarySymbolControl',
    coordinationMeasureControl: 'AddCoordinationMeasureControl',
    arrowControl: 'AddArrowControl',
    boundaryControl: 'AddBoundaryControl',
    occupiedFrontControl: 'AddOccupiedFrontControl',
    coordinationLineControl: 'AddCoordinationLineControl',
    declinationControl: 'AddDeclinationControl',
    losControl: 'AddLOSControl',
    visibilityControl: 'AddVisibilityControl',
    measureDistanceControl: 'MeasurementDistanceControl',
    measureAreaControl: 'MeasurementAreaControl',
    measureAngleControl: 'MeasurementAngleControl',
    vectorTileInfoControl: 'VectorTileInfoControl',
    rectangleSelectionControl: 'RectangleSelectionControl',
};

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Phone layout orchestrator.
 * Creates, mounts, wires, and destroys all phone-specific UI components.
 */
export class PhoneLayout {
    /**
     * @param {Object} options
     * @param {import('maplibre-gl').Map} options.map - MapLibre GL map instance
     */
    constructor({ map }) {
        /** @private */
        this._map = map;
        /** @private */
        this._active = false;
        /** @private */
        this._mediaQuery = null;
        /** @private */
        this._mediaHandler = null;

        // Component references (set in _activatePhoneMode)
        /** @private */
        this._bottomSheet = null;
        /** @private */
        this._searchOverlay = null;
        /** @private */
        this._drawer = null;
        /** @private */
        this._fabs = null;
        /** @private */
        this._moveActions = null;
        /** @private */
        this._featureEditor = null;
        /** @private */
        this._baseLayerModal = null;

        // Event subscriptions to clean up
        /** @private */
        this._eventUnsubscribers = [];
        /** @private */
        this._mapClickHandler = null;
        /** @private - guard to prevent double-fire when tree triggers selection */
        this._treeInitiatedSelection = false;
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    /**
     * Initialize the phone layout.
     * Checks media query and activates if viewport matches.
     * Listens for viewport changes to activate/deactivate dynamically.
     */
    init() {
        this._mediaQuery = window.matchMedia(PHONE_QUERY);
        this._mediaHandler = (e) => {
            if (e.matches) {
                this._activatePhoneMode();
            } else {
                this._deactivatePhoneMode();
            }
        };

        // Listen for future changes
        this._mediaQuery.addEventListener('change', this._mediaHandler);

        // Activate immediately if already in phone viewport
        if (this._mediaQuery.matches) {
            this._activatePhoneMode();
        }
    }

    /**
     * Full cleanup — remove media listener and deactivate phone mode.
     */
    destroy() {
        if (this._mediaQuery && this._mediaHandler) {
            this._mediaQuery.removeEventListener('change', this._mediaHandler);
        }
        this._deactivatePhoneMode();
        this._mediaQuery = null;
        this._mediaHandler = null;
    }

    // ========================================================================
    // LIFECYCLE
    // ========================================================================

    /**
     * Activate phone mode: create all components, mount to body, wire events.
     * @private
     */
    _activatePhoneMode() {
        if (this._active) return;
        this._active = true;

        const map = this._map;
        const body = document.body;

        // Create components
        this._bottomSheet = new PhoneBottomSheet({ map });
        this._searchOverlay = new PhoneSearchOverlay();
        this._drawer = new PhoneDrawer({ map });
        this._fabs = new PhoneFabs({ map });
        this._moveActions = new PhoneMoveActions();
        this._featureEditor = new PhoneFeatureEditor();
        this._baseLayerModal = new PhoneBaseLayerModal();

        // Mount components to DOM
        this._bottomSheet.mount(body);
        this._searchOverlay.mount(body);
        this._drawer.mount(body);
        this._fabs.mount(body);
        this._moveActions.mount(body);
        this._featureEditor.mount(body);
        this._baseLayerModal.mount(body);

        // Wire inter-component communication
        this._wireBottomSheetToFabs();
        this._wireFeatureSelection();
        this._wireFeatureEditorCallbacks();
        this._wireSearch();
        this._wireDrawer();
        this._wireFeatureTree();
        this._wireLayerUpdates();
        this._wireMapInfo();
        this._wireMapList();
        this._wireBaseLayerPicker();
        this._wireMapTapDeselect();

        // Add phone mode class to body for CSS targeting
        body.classList.add('phone-mode');
    }

    /**
     * Deactivate phone mode: destroy all components, unwire events.
     * @private
     */
    _deactivatePhoneMode() {
        if (!this._active) return;
        this._active = false;

        this._unwireEvents();

        // Destroy all phone components
        const components = [
            '_bottomSheet', '_searchOverlay', '_drawer', '_fabs',
            '_moveActions', '_featureEditor', '_baseLayerModal',
        ];
        for (const key of components) {
            this[key]?.destroy();
            this[key] = null;
        }

        document.body.classList.remove('phone-mode');
    }

    // ========================================================================
    // WIRING
    // ========================================================================

    /**
     * Wire bottom sheet state changes to FABs repositioning.
     * @private
     */
    _wireBottomSheetToFabs() {
        this._bottomSheet.onStateChange((state) => {
            this._fabs.onSheetStateChange(state);
        });
    }

    /**
     * Wire feature selection events to bottom sheet and feature editor.
     * @private
     */
    _wireFeatureSelection() {
        const eventBus = getEventBus();

        const onFeaturePanelOpened = async ({ featureId, featureType }) => {
            try {
                // Skip if already handled by tree click
                if (this._treeInitiatedSelection) return;
                if (!featureId || !featureType) return;
                const feature = await getFeatureById(featureType, featureId);
                if (feature) {
                    const featureData = this._buildFeatureData(feature, featureType);
                    this._featureEditor.showFeature(featureData);
                    this._bottomSheet.setFeatureContent(this._featureEditor.getElement());
                    this._bottomSheet.snapTo('half');
                }
            } catch {
                // Feature may not be accessible in current map state
            }
        };

        const onFeaturePanelClosed = () => {
            this._featureEditor.clear();
            this._bottomSheet.clearFeatureContent();
        };

        this._subscribeEvent(eventBus, EventTypes.FEATURE_PANEL_OPENED, onFeaturePanelOpened);
        this._subscribeEvent(eventBus, EventTypes.FEATURE_PANEL_CLOSED, onFeaturePanelClosed);
    }

    /**
     * Wire feature editor save and move callbacks.
     * @private
     */
    _wireFeatureEditorCallbacks() {
        // Save callback
        this._featureEditor.onSave(async (featureId, properties) => {
            try {
                // Find the feature type from the current feature data
                const featureData = this._featureEditor.getFeatureData();
                if (!featureData) return;

                await updateFeature(featureData.type, featureId, { properties });
                showToast('Feição atualizada', 'success');
            } catch (err) {
                console.error('PhoneLayout: error saving feature:', err);
                showToast('Erro ao atualizar feição', 'error');
            }
        });

        // Move start callback
        this._featureEditor.onMoveStart((_featureId) => {
            this._bottomSheet.snapTo('peek');
            this._fabs.hide();

            const restoreUI = () => {
                this._moveActions.hide();
                this._fabs.show();
                this._bottomSheet.snapTo('half');
                this._featureEditor.exitMoveMode();
            };

            this._moveActions.show(
                () => { restoreUI(); showToast('Posição atualizada', 'success'); },
                () => { restoreUI(); },
            );
        });
    }

    /**
     * Wire search overlay callbacks.
     * @private
     */
    _wireSearch() {
        this._searchOverlay.onSearch(async (query) => {
            if (!query) {
                this._searchOverlay.clearResults();
                return;
            }
            const results = await this._searchFeatures(query);
            this._searchOverlay.setResults(results);
        });

        this._searchOverlay.onResultSelect((result) => {
            if (result.coordinates) {
                this._map.flyTo({ center: result.coordinates, zoom: 14 });
            }
            this._searchOverlay.close();

            // Open the feature in the editor via the shared FEATURE_PANEL_OPENED
            // handler (onFeaturePanelOpened) rather than duplicating showFeature here
            // — also covers Multi* features that have no centroid for flyTo.
            if (result.id && result.featureType) {
                getEventBus().emit(EventTypes.FEATURE_PANEL_OPENED, {
                    featureId: result.id,
                    featureType: result.featureType,
                });
            }
        });
    }

    /**
     * Wire drawer open/close and action callbacks.
     * @private
     */
    _wireDrawer() {
        // Open drawer when hamburger tapped
        this._searchOverlay.onHamburgerTap(() => {
            this._drawer.open();
        });

        // Tool selection — map toolbar controlKey to registered name
        this._drawer.onToolSelect((controlKey) => {
            const registryName = CONTROL_KEY_TO_REGISTRY[controlKey];
            const control = registryName ? getControl(registryName) : null;
            if (control && typeof control.activate === 'function') {
                control.activate();
            }
        });

        // Map creation
        this._drawer.onMapCreate(async () => {
            try {
                await addMap('Novo Mapa');
                showToast('Mapa criado', 'success');
                await this._refreshMapList();
            } catch (_e) {
                showToast('Erro ao criar mapa', 'error');
            }
        });

        // Map import — open sidebar import tab
        this._drawer.onMapImport(() => {
            try {
                const eventBus = getEventBus();
                eventBus.emit(EventTypes.UI_CLOSE_ALL_POPUPS);
                const stateManager = getStateManager();
                if (stateManager) {
                    stateManager.batchUpdate(() => {
                        stateManager.set('sidebar.expanded', true);
                        stateManager.set('sidebar.activeTab', 'import');
                    });
                }
            } catch (_e) {
                showToast('Erro ao abrir importação', 'error');
            }
        });

        // Map rename
        this._drawer.onMapRename(async (_mapId) => {
            try {
                const currentName = getCurrentMapNameSync() || '';
                const newName = await this._showPrompt('Novo nome do mapa:', currentName);
                if (newName && newName !== currentName) {
                    await renameMap(currentName, newName);
                    showToast('Mapa renomeado', 'success');
                    await this._refreshMapList();
                    this._bottomSheet.updateMapInfo(this._getMapInfo());
                }
            } catch (_e) {
                showToast('Erro ao renomear mapa', 'error');
            }
        });

        // Map delete
        this._drawer.onMapDelete(async (_mapId) => {
            try {
                const currentName = getCurrentMapNameSync() || '';
                const confirmed = await this._showConfirm(
                    `Excluir o mapa "${currentName}"?`,
                    'Excluir',
                    true,
                );
                if (confirmed) {
                    await removeMap(currentName);
                    showToast('Mapa excluído', 'success');
                    await this._refreshMapList();
                    this._bottomSheet.updateMapInfo(this._getMapInfo());
                    const layers = this._getLayerData();
                    this._bottomSheet.updateLayers(layers);
                    this._loadFeatureTree();
                }
            } catch (_e) {
                showToast('Erro ao excluir mapa', 'error');
            }
        });

        // Layer visibility toggle
        this._drawer.onLayerToggle((layerId, visible) => {
            setLayerVisibility(layerId, visible);
        });

        // Chip selection
        this._drawer.onChipSelect((chipId) => {
            this._handleChipAction(chipId);
        });
    }

    /**
     * Refresh the maps list in the drawer from the store.
     * @private
     */
    async _refreshMapList() {
        try {
            const mapNames = await getAllMapNamesStore();
            const currentName = getCurrentMapNameSync();
            const maps = mapNames.map(name => ({
                id: name,
                nome: name,
            }));
            if (this._drawer) {
                this._drawer.updateMaps(maps, currentName);
            }
        } catch (_e) {
            // Maps loading is non-critical
        }
    }

    /**
     * Wire maps list to the drawer: initial load + live updates on map events.
     * @private
     */
    _wireMapList() {
        const eventBus = getEventBus();

        // Wire map selection → switch active map
        this._drawer.onMapSelect(async (mapId) => {
            try {
                await setCurrentMap(mapId);
                showToast('Mapa alterado', 'success');
                await this._refreshMapList();

                // Refresh map info + layers + feature tree
                const info = this._getMapInfo();
                this._bottomSheet.updateMapInfo(info);
                const layers = this._getLayerData();
                this._bottomSheet.updateLayers(layers);
                this._loadFeatureTree();
            } catch (_e) {
                showToast('Erro ao trocar de mapa', 'error');
            }
        });

        // Subscribe to map lifecycle events
        const onMapChanged = () => this._refreshMapList();

        this._subscribeEvent(eventBus, EventTypes.MAP_CREATED, onMapChanged);
        this._subscribeEvent(eventBus, EventTypes.MAP_DELETED, onMapChanged);
        this._subscribeEvent(eventBus, EventTypes.MAP_MODIFIED, onMapChanged);

        // Initial load
        this._refreshMapList();
    }

    /**
     * Wire layer change events to bottom sheet and feature tree.
     * @private
     */
    _wireLayerUpdates() {
        const eventBus = getEventBus();

        const onLayersChanged = () => {
            const layers = this._getLayerData();
            this._bottomSheet.updateLayers(layers);
            if (this._drawer) {
                this._drawer.updateLayers(layers);
            }
            this._loadFeatureTree();
            this._updateMapInfoFeatureCount();
        };

        // Also refresh feature tree on feature lifecycle events
        const onFeatureChanged = () => {
            this._loadFeatureTree();
        };

        this._subscribeEvent(eventBus, EventTypes.LAYERS_CHANGED, onLayersChanged);
        this._subscribeEvent(eventBus, EventTypes.FEATURE_CREATED, onFeatureChanged);
        this._subscribeEvent(eventBus, EventTypes.FEATURE_MODIFIED, onFeatureChanged);
        this._subscribeEvent(eventBus, EventTypes.FEATURE_DELETED, onFeatureChanged);

        // Initial load
        const layers = this._getLayerData();
        this._bottomSheet.updateLayers(layers);
        if (this._drawer) {
            this._drawer.updateLayers(layers);
        }
        this._loadFeatureTree();
    }

    /**
     * Wire map info updates to bottom sheet.
     * @private
     */
    _wireMapInfo() {
        const info = this._getMapInfo();
        this._bottomSheet.updateMapInfo(info);

        // Update on map lock change (which fires on map switch)
        const eventBus = getEventBus();
        const onMapLockChanged = () => {
            const updatedInfo = this._getMapInfo();
            this._bottomSheet.updateMapInfo(updatedInfo);

            // Also refresh layers
            const layers = this._getLayerData();
            this._bottomSheet.updateLayers(layers);
        };

        this._subscribeEvent(eventBus, EventTypes.MAP_LOCK_CHANGED, onMapLockChanged);
    }

    /**
     * Wire base layer picker via PhoneBaseLayerModal.
     * @private
     */
    _wireBaseLayerPicker() {
        try {
            const enabledBasemaps = config.getEnabledBasemaps();
            this._baseLayerModal.setBasemaps(enabledBasemaps);

            if (enabledBasemaps.length > 0) {
                this._baseLayerModal.setActiveLayer(enabledBasemaps[0][0]);
            }

            this._fabs.onBaseLayerTap(() => {
                this._baseLayerModal.open();
            });

            this._baseLayerModal.onSelect((id) => {
                const baseLayerControl = getControl('BaseLayerControl');
                if (baseLayerControl) {
                    baseLayerControl.executeLayerChange(id);
                }
                this._baseLayerModal.setActiveLayer(id);
            });
        } catch (_e) {
            // Config may not have basemaps configured
        }
    }

    /**
     * Handle chip actions from the drawer (catalog, tutorial, info, shortcuts).
     * @param {string} chipId - Chip identifier
     * @private
     */
    _handleChipAction(chipId) {
        // Access modal instances via the desktop ChipsComponent
        const chipsComponent = getControl('chipsComponent');

        switch (chipId) {
        case 'catalog': {
            const modal = chipsComponent?.getCatalogModal?.();
            if (modal) {
                modal.show();
            }
            break;
        }
        case 'tutorial': {
            const tutorialUrl = config.app?.tutorialUrl || config.tutorialUrl || './docs/doc.html';
            window.open(tutorialUrl, '_blank', 'noopener,noreferrer');
            break;
        }
        case 'info': {
            const modal = chipsComponent?.getInfoModal?.();
            if (modal) {
                modal.show();
            }
            break;
        }
        case 'shortcuts': {
            const modal = chipsComponent?.getShortcutsModal?.();
            if (modal) {
                modal.show();
            }
            break;
        }
        }
    }

    /**
     * Wire feature tree in bottom sheet to feature selection/deselection.
     * @private
     */
    _wireFeatureTree() {
        // Feature selection from tree
        this._bottomSheet.onFeatureSelect(async (featureId, featureType) => {
            try {
                const feature = await getFeatureById(featureType, featureId);
                if (feature) {
                    const featureData = this._buildFeatureData(feature, featureType);
                    this._featureEditor.showFeature(featureData);
                    this._bottomSheet.setFeatureContent(this._featureEditor.getElement());
                    this._bottomSheet.snapTo('half');

                    // Emit event for other components (e.g. highlight on map)
                    // Guard prevents _wireFeatureSelection from re-processing
                    this._treeInitiatedSelection = true;
                    const eventBus = getEventBus();
                    eventBus.emit(EventTypes.FEATURE_PANEL_OPENED, { featureId, featureType });
                    this._treeInitiatedSelection = false;
                }
            } catch (_e) {
                // Feature may not be accessible in current map state
            }
        });

        // Feature deselection from X close button
        this._bottomSheet.onFeatureDeselect(() => {
            this._featureEditor.clear();
            this._bottomSheet.snapTo('peek');

            const eventBus = getEventBus();
            eventBus.emit(EventTypes.FEATURE_PANEL_CLOSED);
        });
    }

    /**
     * Load features grouped by layer and push to the bottom sheet tree.
     * @private
     */
    async _loadFeatureTree() {
        try {
            const features = await getCurrentMapFeatures();
            const featuresByLayer = {};

            for (const storageType of getAllStorageTypes()) {
                const typeFeatures = features[storageType] || [];
                for (const feature of typeFeatures) {
                    const props = feature.properties || {};
                    const layerId = props.layerId;
                    if (!layerId) continue;

                    if (!featuresByLayer[layerId]) {
                        featuresByLayer[layerId] = [];
                    }

                    featuresByLayer[layerId].push({
                        id: props.id,
                        type: storageType,
                        name: props.nome || props.name || props.descricao || 'Sem nome',
                    });
                }
            }

            this._bottomSheet.updateFeatures(featuresByLayer);
        } catch (_e) {
            // Feature loading is non-critical
        }
    }

    /**
     * Wire map tap on empty area to deselect and collapse sheet.
     * @private
     */
    _wireMapTapDeselect() {
        this._mapClickHandler = (e) => {
            // Only deselect if no feature was tapped. Same hit-test as the
            // selection manager (touch tolerance included), or a tap that
            // selects a thin line here would collapse the sheet at once.
            const features = queryFeaturesAtPoint(this._map, e.point);
            if (!features || features.length === 0) {
                this._featureEditor.clear();
                this._bottomSheet.clearFeatureContent();
                this._bottomSheet.snapTo('peek');
            }
        };

        this._map.on('click', this._mapClickHandler);
    }

    /**
     * Subscribe to an event bus event with automatic cleanup on unwire.
     * @param {Object} eventBus - Event bus instance
     * @param {string} eventType - Event type constant
     * @param {Function} handler - Event handler
     * @private
     */
    _subscribeEvent(eventBus, eventType, handler) {
        eventBus.on(eventType, handler);
        this._eventUnsubscribers.push(() => eventBus.off(eventType, handler));
    }

    /**
     * Remove all event subscriptions and map handlers.
     * @private
     */
    _unwireEvents() {
        for (const unsub of this._eventUnsubscribers) {
            try {
                unsub();
            } catch (_e) {
                // Ignore cleanup errors
            }
        }
        this._eventUnsubscribers = [];

        if (this._mapClickHandler && this._map) {
            this._map.off('click', this._mapClickHandler);
            this._mapClickHandler = null;
        }
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    /**
     * Build feature data in the shape PhoneFeatureEditor expects.
     * @param {Object} feature - GeoJSON feature from store
     * @param {string} featureType - Storage type (e.g. 'point', 'polygon')
     * @returns {Object} Feature data for PhoneFeatureEditor
     * @private
     */
    _buildFeatureData(feature, featureType) {
        const props = feature.properties || {};

        // Find the layer name for this feature
        let layerName = '';
        try {
            const layers = getLayers();
            const layer = layers.find(l => l.id === props.layerId);
            layerName = layer ? (layer.nome || layer.name || '') : '';
        } catch (_e) {
            // Layer lookup failed
        }

        // Build display properties (filter out internal ones)
        const displayProperties = {};
        const internalKeys = new Set([
            'id', 'layerId', 'type', 'createdAt', 'updatedAt',
            'version', 'ownerId', 'dirty', 'deleted', 'color',
        ]);

        for (const [key, value] of Object.entries(props)) {
            if (!internalKeys.has(key) && !key.startsWith('_')) {
                displayProperties[key] = value;
            }
        }

        return {
            id: props.id,
            type: featureType,
            name: props.nome || props.name || props.descricao || 'Sem nome',
            layerName,
            color: props.color || props.cor || '',
            properties: displayProperties,
        };
    }

    /**
     * Get layer data in the shape PhoneBottomSheet expects.
     * @returns {Array<Object>} Layers array
     * @private
     */
    _getLayerData() {
        try {
            const layers = getLayers();
            return layers.map(layer => ({
                id: layer.id,
                nome: layer.nome || layer.name || '',
                visivel: layer.visivel !== false,
                featureCount: layer.featureCount || 0,
                color: layer.color || '',
            }));
        } catch (_e) {
            return [];
        }
    }

    /**
     * Get atlas/map info for the bottom sheet.
     * @returns {Object} Map info with atlasName, mapName, layerCount, featureCount
     * @private
     */
    _getMapInfo() {
        try {
            const mapName = getCurrentMapNameSync();
            const layers = getLayers();
            return {
                atlasName: 'Atlas',
                mapName: mapName || '',
                layerCount: layers.length,
                featureCount: 0, // Updated async via _updateMapInfoFeatureCount
            };
        } catch (_e) {
            return {
                atlasName: 'Atlas',
                mapName: '',
                layerCount: 0,
                featureCount: 0,
            };
        }
    }

    /**
     * Update feature count in map info asynchronously.
     * @private
     */
    async _updateMapInfoFeatureCount() {
        try {
            const features = await getCurrentMapFeatures();
            let count = 0;
            for (const storageType of getAllStorageTypes()) {
                const typeFeatures = features[storageType] || [];
                count += typeFeatures.length;
            }
            this._bottomSheet.updateMapInfo({ featureCount: count });
        } catch (_e) {
            // Feature count update is non-critical
        }
    }

    /**
     * Search features across all layers by name/description.
     * @param {string} query - Search query
     * @returns {Promise<Array<Object>>} Search results
     * @private
     */
    async _searchFeatures(query) {
        const results = [];
        const lowerQuery = query.toLowerCase();

        try {
            const features = await getCurrentMapFeatures();
            const layers = getLayers();
            const layerMap = new Map(layers.map(l => [l.id, l]));

            for (const storageType of getAllStorageTypes()) {
                const typeFeatures = features[storageType] || [];
                for (const feature of typeFeatures) {
                    const props = feature.properties || {};
                    const nome = props.nome || props.name || '';
                    const descricao = props.descricao || '';

                    if (
                        nome.toLowerCase().includes(lowerQuery) ||
                        descricao.toLowerCase().includes(lowerQuery)
                    ) {
                        // Get coordinates from geometry
                        let coordinates = null;
                        if (feature.geometry) {
                            coordinates = this._getFeatureCentroid(feature.geometry);
                        }

                        const layer = layerMap.get(props.layerId);
                        const layerName = layer ? (layer.nome || layer.name || '') : '';

                        results.push({
                            id: props.id,
                            // Plural storage-type key (getFeatureById indexes features[type]);
                            // props.source is singular and would miss the collection.
                            featureType: storageType,
                            text: nome || 'Sem nome',
                            subtitle: layerName,
                            coordinates,
                        });
                    }

                    // Limit results to avoid performance issues
                    if (results.length >= 50) break;
                }
                if (results.length >= 50) break;
            }
        } catch (err) {
            console.error('PhoneLayout: search error:', err);
        }

        return results;
    }

    /**
     * Get centroid coordinates from a GeoJSON geometry.
     * @param {Object} geometry - GeoJSON geometry
     * @returns {[number, number]|null} [lng, lat] or null
     * @private
     */
    _getFeatureCentroid(geometry) {
        if (!geometry || !geometry.type) return null;

        switch (geometry.type) {
        case 'Point':
            return geometry.coordinates ? [...geometry.coordinates].slice(0, 2) : null;
        case 'LineString':
            if (geometry.coordinates && geometry.coordinates.length > 0) {
                // Use midpoint of line
                const mid = Math.floor(geometry.coordinates.length / 2);
                return [...geometry.coordinates[mid]].slice(0, 2);
            }
            return null;
        case 'Polygon':
            if (geometry.coordinates && geometry.coordinates[0] && geometry.coordinates[0].length > 0) {
                // Simple centroid: average of exterior ring vertices
                const ring = geometry.coordinates[0];
                let sumLng = 0;
                let sumLat = 0;
                for (const coord of ring) {
                    sumLng += coord[0];
                    sumLat += coord[1];
                }
                return [sumLng / ring.length, sumLat / ring.length];
            }
            return null;
        case 'MultiPoint':
            return geometry.coordinates?.length
                ? [...geometry.coordinates[0]].slice(0, 2)
                : null;
        case 'MultiLineString':
            // Delegate to the first sub-line (e.g. boundary features are MultiLineString).
            return geometry.coordinates?.length
                ? this._getFeatureCentroid({ type: 'LineString', coordinates: geometry.coordinates[0] })
                : null;
        case 'MultiPolygon':
            return geometry.coordinates?.length
                ? this._getFeatureCentroid({ type: 'Polygon', coordinates: geometry.coordinates[0] })
                : null;
        default:
            return null;
        }
    }

    // ========================================================================
    // PHONE DIALOGS
    // ========================================================================

    /**
     * Show a phone-friendly prompt dialog (replaces browser prompt()).
     * Returns a Promise that resolves with the input value or null if cancelled.
     * @param {string} title - Dialog title
     * @param {string} [defaultValue=''] - Pre-filled value
     * @returns {Promise<string|null>}
     * @private
     */
    _showPrompt(title, defaultValue = '') {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'phone-dialog-overlay';

            const card = document.createElement('div');
            card.className = 'phone-dialog';

            const titleEl = document.createElement('div');
            titleEl.className = 'phone-dialog__title';
            titleEl.textContent = title;

            const input = document.createElement('input');
            input.className = 'phone-dialog__input';
            input.type = 'text';
            input.value = defaultValue;
            input.setAttribute('autocomplete', 'off');

            const actions = document.createElement('div');
            actions.className = 'phone-dialog__actions';

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'phone-dialog__btn';
            cancelBtn.textContent = 'Cancelar';

            const confirmBtn = document.createElement('button');
            confirmBtn.className = 'phone-dialog__btn phone-dialog__btn--primary';
            confirmBtn.textContent = 'OK';

            actions.appendChild(cancelBtn);
            actions.appendChild(confirmBtn);

            card.appendChild(titleEl);
            card.appendChild(input);
            card.appendChild(actions);
            overlay.appendChild(card);
            document.body.appendChild(overlay);

            // Animate in
            requestAnimationFrame(() => {
                overlay.classList.add('phone-dialog-overlay--open');
                input.focus();
                input.select();
            });

            const cleanup = (result) => {
                overlay.classList.remove('phone-dialog-overlay--open');
                // Wait for CSS transition before removing
                setTimeout(() => overlay.remove(), 200);
                resolve(result);
            };

            cancelBtn.addEventListener('click', () => cleanup(null));
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) cleanup(null);
            });
            confirmBtn.addEventListener('click', () => {
                const val = input.value.trim();
                cleanup(val || null);
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = input.value.trim();
                    cleanup(val || null);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cleanup(null);
                }
            });
        });
    }

    /**
     * Show a phone-friendly confirm dialog (replaces browser confirm()).
     * Returns a Promise that resolves with true/false.
     * @param {string} title - Dialog title/message
     * @param {string} [confirmLabel='Excluir'] - Confirm button label
     * @param {boolean} [danger=false] - Whether the confirm action is destructive
     * @returns {Promise<boolean>}
     * @private
     */
    _showConfirm(title, confirmLabel = 'Excluir', danger = false) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'phone-dialog-overlay';

            const card = document.createElement('div');
            card.className = 'phone-dialog';

            const titleEl = document.createElement('div');
            titleEl.className = 'phone-dialog__title';
            titleEl.textContent = title;

            const actions = document.createElement('div');
            actions.className = 'phone-dialog__actions';

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'phone-dialog__btn';
            cancelBtn.textContent = 'Cancelar';

            const confirmBtn = document.createElement('button');
            confirmBtn.className = danger
                ? 'phone-dialog__btn phone-dialog__btn--danger'
                : 'phone-dialog__btn phone-dialog__btn--primary';
            confirmBtn.textContent = confirmLabel;

            actions.appendChild(cancelBtn);
            actions.appendChild(confirmBtn);

            card.appendChild(titleEl);
            card.appendChild(actions);
            overlay.appendChild(card);
            document.body.appendChild(overlay);

            // Animate in
            requestAnimationFrame(() => {
                overlay.classList.add('phone-dialog-overlay--open');
            });

            const cleanup = (result) => {
                overlay.classList.remove('phone-dialog-overlay--open');
                setTimeout(() => overlay.remove(), 200);
                resolve(result);
            };

            cancelBtn.addEventListener('click', () => cleanup(false));
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) cleanup(false);
            });
            confirmBtn.addEventListener('click', () => cleanup(true));
        });
    }
}
