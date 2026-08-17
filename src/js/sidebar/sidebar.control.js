// Path: js/sidebar/sidebar.control.js

/**
 * @fileoverview Main sidebar controller.
 * Orchestrates collapsed sidebar, expanded panel, and feature panel.
 * Manages tab switching and feature selection display.
 */

import { SidebarCollapsed } from './components/sidebar-collapsed.js';
import { SidebarPanel } from './components/sidebar-panel.js';
import { FeaturePanel } from './components/feature-panel.js';
import { SIDEBAR_TABS, SIDEBAR_DIMENSIONS } from './sidebar.constants.js';
import { MapsTab } from './tabs/maps.tab.js';
import { LayersTab } from './tabs/layers.tab.js';
import { BriefingsTab } from './tabs/briefings.tab.js';
import { ImportTab } from './tabs/import.tab.js';
import { ExportTab } from './tabs/export.tab.js';
import { ProcessingTab, createProcessingPanel, getAlgorithm } from '@js/processing/index.js';
import { EventTypes } from '@events/event_types.js';
import {
    setupCleanup,
    subscribe,
    addDomListener,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';
import { isTouchDevice } from '@utils/pointer-utils.js';
import { injectTabbedPanelStyles } from '@tools/tabbed_attribute_panel.js';
import {
    setCurrentMap,
    getCurrentMapName,
    getAllMapNamesStore,
    getMapOrder,
    getAllMapBadgeColors,
    getControl
} from '@store/index.js';
import { createNotesPanelContent } from './panels/notes-panel.js';
import { createVectorInfoPanelContent } from './panels/vector-info-panel.js';
import { createFeaturePanelContent } from './panels/feature-panel-content.js';
import {
    handleMarker3dClick,
    handleMarker3dDeselect,
    handleMeasurement3dClick,
    handleMeasurement3dDeselect,
    handleViewshed3dClick,
    handleViewshed3dDeselect,
    handleMarker360Click,
    handleMarker360Deselect,
    handleMarkerFpClick,
    handleMarkerFpListClick,
    handleMarkerFpDeselect,
    closeAny3dPanel,
    deselect3dFeature
} from './handlers/feature-3d-handlers.js';

/**
 * Main sidebar controller class.
 * Manages the sidebar UI and coordinates between collapsed, expanded, and feature panel states.
 */
export class SidebarControl {
    /**
     * @param {Object} dependencies - Required dependencies
     * @param {Object} dependencies.stateManager - StateManager instance
     * @param {Object} dependencies.eventBus - EventBus instance
     * @param {Object} [dependencies.mapManager] - MapManager instance
     * @param {Object} [dependencies.featuresTab] - FeaturesTab instance
     * @param {Object} [dependencies.exportImportService] - ExportImportService instance
     * @param {Object} [dependencies.baseLayerControl] - BaseLayerControl instance
     * @param {Object} [dependencies.importControl] - AddImportControl instance
     * @param {Object} [dependencies.pdfExportTab] - PDFExportTab instance
     * @param {Object} [dependencies.screenshotControl] - ScreenshotControl instance
     * @param {Object} [dependencies.selectionManager] - SelectionManager instance
     * @param {Object} [dependencies.uiManager] - UIManager instance
     */
    constructor(dependencies) {
        this._stateManager = dependencies.stateManager;
        this._eventBus = dependencies.eventBus;
        this._mapManager = dependencies.mapManager;
        this._featuresTab = dependencies.featuresTab;
        this._exportImportService = dependencies.exportImportService;
        this._baseLayerControl = dependencies.baseLayerControl;
        this._importControl = dependencies.importControl;
        this._pdfExportTab = dependencies.pdfExportTab;
        this._screenshotControl = dependencies.screenshotControl;
        this._selectionManager = dependencies.selectionManager;
        this._uiManager = dependencies.uiManager;

        this._container = null;
        this._collapsedSidebar = null;
        this._panelsWrapper = null;
        this._panel = null;
        this._featurePanel = null;
        this._backdrop = null;

        // Tab content components (created lazily)
        this._tabComponents = {
            [SIDEBAR_TABS.MAPAS]: null,
            [SIDEBAR_TABS.CAMADAS]: null,
            [SIDEBAR_TABS.BRIEFINGS]: null,
            [SIDEBAR_TABS.PROCESSAMENTO]: null,
            [SIDEBAR_TABS.IMPORTAR]: null,
            [SIDEBAR_TABS.EXPORTAR]: null,
        };

        // Track the currently active tab locally (needed for deactivation on close)
        this._activeTab = null;

        // Current feature panel content cleanup
        this._currentFeaturePanelCleanup = null;

        // Version counter to cancel stale async panel renders
        this._featureContentVersion = 0;

        setupCleanup(this);
    }

    /**
     * Initializes the sidebar and adds it to the DOM.
     * @param {HTMLElement} parentElement - Parent element to attach sidebar to
     */
    init(parentElement) {
        // Inject tabbed panel styles
        injectTabbedPanelStyles();

        this._createContainer();
        this._createComponents();
        this._setupEventListeners();

        parentElement.appendChild(this._container);

        // Sync initial state
        this._syncStateFromManager();
    }

    /**
     * Creates the main container element.
     * @private
     */
    _createContainer() {
        this._container = document.createElement('div');
        this._container.className = 'sidebar-container';
        this._container.id = 'sidebar-container';
    }

    /**
     * Creates the collapsed sidebar, panel, and feature panel components.
     * @private
     */
    _createComponents() {
        // Collapsed sidebar (always visible)
        this._collapsedSidebar = new SidebarCollapsed({
            onTabClick: (tabId) => this._handleTabClick(tabId),
            onRecentMapClick: (mapName) => this._handleRecentMapClick(mapName),
            logoSrc: './images/logo_ebgeo.webp',
        });

        this._container.appendChild(this._collapsedSidebar.render());

        // Panels wrapper - contains both panels for proper positioning
        this._panelsWrapper = document.createElement('div');
        this._panelsWrapper.className = 'sidebar-panels-wrapper';
        this._container.appendChild(this._panelsWrapper);

        // Expanded panel (for tabs)
        this._panel = new SidebarPanel({
            onClose: () => this._handlePanelClose(),
        });

        this._panelsWrapper.appendChild(this._panel.render());

        // Feature panel (for selected features)
        this._featurePanel = new FeaturePanel({
            onClose: () => this._handleFeaturePanelClose(),
        });

        this._panelsWrapper.appendChild(this._featurePanel.render());

        // Backdrop for tablet overlay mode
        this._backdrop = document.createElement('div');
        this._backdrop.className = 'sidebar-backdrop';
        document.body.appendChild(this._backdrop);
        addDomListener(this, this._backdrop, 'click', () => {
            this._stateManager.collapseSidebar();
        });

        // Swipe-to-dismiss on touch devices
        if (isTouchDevice()) {
            this._setupSwipeDismiss();
        }
    }

    /**
     * Sets up swipe-left gesture to dismiss expanded sidebar on touch devices.
     * @private
     */
    _setupSwipeDismiss() {
        const panel = this._panelsWrapper;
        let startX = null;
        let startY = null;
        let isDragging = false;

        const onTouchStart = (e) => {
            if (e.touches.length !== 1) return;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            isDragging = false;
        };

        const onTouchMove = (e) => {
            if (startX === null) return;
            const dx = e.touches[0].clientX - startX;
            const dy = e.touches[0].clientY - startY;
            // Track horizontal swipes (more horizontal than vertical)
            if (!isDragging && Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy)) {
                isDragging = true;
            }
        };

        const onTouchEnd = (e) => {
            if (!isDragging || startX === null) {
                startX = null;
                return;
            }
            const dx = e.changedTouches[0].clientX - startX;
            // Swipe left to close (negative dx, at least 60px)
            if (dx < -60) {
                this._stateManager.collapseSidebar();
            }
            startX = null;
            isDragging = false;
        };

        addDomListener(this, panel, 'touchstart', onTouchStart, { passive: true });
        addDomListener(this, panel, 'touchmove', onTouchMove, { passive: true });
        addDomListener(this, panel, 'touchend', onTouchEnd);
    }

    /**
     * Shows or hides the backdrop overlay.
     * @private
     * @param {boolean} show - Whether to show the backdrop
     */
    _setBackdropVisible(show) {
        if (!this._backdrop) return;
        if (show) {
            this._backdrop.classList.add('visible');
        } else {
            this._backdrop.classList.remove('visible');
        }
    }

    /**
     * Sets up event listeners for state changes.
     * @private
     */
    _setupEventListeners() {
        // Listen for sidebar state changes (from external sources)
        subscribe(this, this._eventBus, EventTypes.SIDEBAR_EXPANDED,
            (payload) => this._onSidebarExpanded(payload));

        subscribe(this, this._eventBus, EventTypes.SIDEBAR_COLLAPSED,
            () => this._onSidebarCollapsed());

        subscribe(this, this._eventBus, EventTypes.SIDEBAR_TAB_CHANGED,
            (payload) => this._onTabChanged(payload));

        // Listen for feature panel events
        subscribe(this, this._eventBus, EventTypes.FEATURE_PANEL_OPENED,
            (payload) => this._onFeaturePanelOpened(payload));

        subscribe(this, this._eventBus, EventTypes.FEATURE_PANEL_CLOSED,
            () => this._onFeaturePanelClosed());

        // Listen for vector tile info panel events
        subscribe(this, this._eventBus, EventTypes.VECTOR_INFO_PANEL_OPENED,
            (payload) => this._onVectorInfoPanelOpened(payload));

        // Listen for layer changes to update recent maps
        subscribe(this, this._eventBus, EventTypes.LAYERS_CHANGED,
            () => this._updateRecentMaps());

        // Listen for map notes requests
        subscribe(this, this._eventBus, EventTypes.MAP_NOTES_REQUESTED,
            (payload) => this._onMapNotesRequested(payload));

        // Listen for search result panel requests
        subscribe(this, this._eventBus, EventTypes.SEARCH_RESULT_PANEL_REQUESTED,
            (payload) => this._onSearchResultPanelRequested(payload));

        // Listen for 3D marker clicks
        subscribe(this, this._eventBus, EventTypes.MARKER_3D_CLICKED,
            (payload) => this._onMarker3dClicked(payload));

        // Listen for 3D marker deselection
        subscribe(this, this._eventBus, EventTypes.MARKER_3D_DESELECTED,
            () => this._onMarker3dDeselected());

        // Listen for 3D measurement clicks
        subscribe(this, this._eventBus, EventTypes.MEASUREMENT_3D_CLICKED,
            (payload) => this._onMeasurement3dClicked(payload));

        // Listen for 3D measurement deselection
        subscribe(this, this._eventBus, EventTypes.MEASUREMENT_3D_DESELECTED,
            () => this._onMeasurement3dDeselected());

        // Listen for 3D viewshed clicks
        subscribe(this, this._eventBus, EventTypes.VIEWSHED_3D_CLICKED,
            (payload) => this._onViewshed3dClicked(payload));

        // Listen for 3D viewshed deselection
        subscribe(this, this._eventBus, EventTypes.VIEWSHED_3D_DESELECTED,
            () => this._onViewshed3dDeselected());

        // Listen for 360 marker clicks
        subscribe(this, this._eventBus, EventTypes.MARKER_360_CLICKED,
            (payload) => this._onMarker360Clicked(payload));

        // Listen for 360 marker deselection
        subscribe(this, this._eventBus, EventTypes.MARKER_360_DESELECTED,
            () => this._onMarker360Deselected());

        // Listen for first-person scene marker clicks
        subscribe(this, this._eventBus, EventTypes.MARKER_FP_CLICKED,
            (payload) => this._onMarkerFpClicked(payload));

        // Listen for the first-person item list (all items, or one pile of labels)
        subscribe(this, this._eventBus, EventTypes.MARKER_FP_LIST_CLICKED,
            (payload) => this._onMarkerFpListClicked(payload));

        // Listen for first-person marker deselection
        subscribe(this, this._eventBus, EventTypes.MARKER_FP_DESELECTED,
            () => this._onMarkerFpDeselected());

        // Closing the first-person viewer must not leave its card behind
        subscribe(this, this._eventBus, EventTypes.FIRST_PERSON_CLOSED,
            () => this._onMarkerFpDeselected());

        // Listen for 360 viewer closed to close any open 360 panels
        subscribe(this, this._eventBus, EventTypes.STREETVIEW_360_CLOSED,
            () => this._onStreetview360Closed());

        // Listen for base layer changes (map switch) to close 3D panels
        subscribe(this, this._eventBus, EventTypes.BASE_LAYER_CHANGED,
            () => this._onBaseLayerChanged());
    }

    /**
     * Called when base layer changes (usually during map switch).
     * Closes any open feature panels (3D, vector info, etc.) to prevent stale data.
     * @private
     */
    _onBaseLayerChanged() {
        const closed3d = closeAny3dPanel({
            stateManager: this._stateManager,
            hidePanel: (save) => this._featurePanel.hide(save),
            cleanupContent: () => this._cleanupFeaturePanelContent(),
            eventBus: this._eventBus,
            EventTypes
        });

        // If no 3D panel was closed, check for other panels (e.g. vector info)
        if (!closed3d && this._stateManager.get('ui.featurePanelOpen')) {
            this._featurePanel.hide(false);
            this._cleanupFeaturePanelContent();
            this._stateManager.closeFeaturePanel();
        }
    }

    /**
     * Syncs UI state from StateManager.
     * @private
     */
    _syncStateFromManager() {
        const expanded = this._stateManager.get('sidebar.expanded');
        const activeTab = this._stateManager.get('sidebar.activeTab');

        if (expanded && activeTab) {
            this._expandToTab(activeTab);
        }

        this._updateRecentMaps();
    }

    /**
     * Handles tab button click.
     * @private
     * @param {string} tabId - Clicked tab ID
     */
    _handleTabClick(tabId) {
        const currentTab = this._stateManager.get('sidebar.activeTab');
        const isExpanded = this._stateManager.get('sidebar.expanded');

        if (isExpanded && currentTab === tabId) {
            // Clicking active tab collapses the panel
            this._stateManager.collapseSidebar();
        } else {
            // Expand to the clicked tab
            this._stateManager.expandSidebar(tabId);
        }
    }

    /**
     * Handles panel close button click.
     * @private
     */
    _handlePanelClose() {
        this._stateManager.collapseSidebar();
    }

    /**
     * Handles feature panel close button click.
     * Saves changes before closing the panel.
     * @private
     */
    async _handleFeaturePanelClose() {
        // Check if we're closing the notes panel, 3D feature panels, or tool panels
        const featureType = this._stateManager.get('ui.currentFeatureType');
        const isNotes = featureType === 'notes';
        const is3dFeature = ['marker3d', 'measurement3d', 'viewshed3d'].includes(featureType);
        const isToolPanel = featureType === 'tool_panel';

        // Handle tool panel close - trigger onClose callback to deactivate the tool
        if (isToolPanel && this._toolPanelOnClose) {
            this._toolPanelOnClose();
            this._toolPanelOnClose = null;
        }

        // Save changes before closing (this triggers save button click)
        // Must happen BEFORE deselecting features
        // Don't save for tool panels (they handle their own state)
        this._featurePanel.hide(!isToolPanel);

        // Deselect 3D features if closing their panels
        if (is3dFeature) {
            await deselect3dFeature(featureType);
        }

        // Only clear selection if we're not showing notes, 3D features, or tool panels
        // skipSave: hide() already saved via _triggerSave above
        if (!isNotes && !is3dFeature && !isToolPanel && this._selectionManager) {
            this._selectionManager.deselectAllFeatures({ skipSave: true });
        }

        this._stateManager.closeFeaturePanel();

        // If closing notes, return to Maps tab
        if (isNotes) {
            this._stateManager.expandSidebar(SIDEBAR_TABS.MAPAS);
        }
    }

    /**
     * Handles recent map shortcut click.
     * @private
     * @param {string} mapName - Map name to switch to
     */
    async _handleRecentMapClick(mapName) {
        try {
            // Check if already on this map
            const currentMap = await getCurrentMapName();
            if (currentMap === mapName) return;

            // Set the current map in store
            await setCurrentMap(mapName);

            // Switch the map view using baseLayerControl
            if (this._baseLayerControl) {
                await this._baseLayerControl.switchMap();
            }

            // Immediately update recent maps display to reflect selection
            await this._updateRecentMaps();

            // Refresh maps tab if it's currently open
            if (this._tabComponents[SIDEBAR_TABS.MAPAS]?.refresh) {
                this._tabComponents[SIDEBAR_TABS.MAPAS].refresh();
            }

            // Emit LAYERS_CHANGED to refresh FeaturesTab (camadas) if open
            this._eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
        } catch (error) {
            console.warn('Failed to switch map:', error);
        }
    }

    /**
     * Called when sidebar is expanded (from event).
     * @private
     * @param {Object} payload - Event payload
     * @param {string} payload.tab - Tab being expanded
     */
    _onSidebarExpanded(payload) {
        // Hide feature panel when sidebar expands, saving any pending changes
        this._featurePanel.hide(true);
        this._cleanupFeaturePanelContent();

        this._expandToTab(payload.tab);
        this._setBackdropVisible(true);
    }

    /**
     * Called when sidebar is collapsed (from event).
     * @private
     */
    _onSidebarCollapsed() {
        this._collapsePanel();
        this._setBackdropVisible(false);
    }

    /**
     * Called when active tab changes (from event).
     * @private
     * @param {Object} payload - Event payload
     */
    _onTabChanged(payload) {
        this._collapsedSidebar.setActiveTab(payload.currentTab);
    }

    /**
     * Called when feature panel opens (from event).
     * @private
     * @param {Object} payload - Event payload with featureId and featureType
     */
    _onFeaturePanelOpened(payload) {
        // Ignore special panel types that manage their own content
        // (tool_panel, searchResult, vectorInfo are handled by their respective methods)
        const specialTypes = ['tool_panel', 'searchResult', 'vectorInfo'];
        if (specialTypes.includes(payload.featureType)) {
            return;
        }

        // Collapse sidebar panel first
        this._collapsePanel();

        // Show feature panel with content (no backdrop — map must remain interactive for editing)
        this._showFeatureContent(payload.featureId, payload.featureType);
    }

    /**
     * Called when feature panel closes (from event).
     * @private
     */
    _onFeaturePanelClosed() {
        // Hide without saving (save already triggered in _handleFeaturePanelClose)
        this._featurePanel.hide(false);
        this._cleanupFeaturePanelContent();
    }

    /**
     * Called when vector tile info panel opens (from event).
     * @private
     * @param {Object} payload - Event payload with feature and title
     */
    _onVectorInfoPanelOpened(payload) {
        // Collapse sidebar panel first
        this._collapsePanel();

        // Update state to reflect feature panel is open (for layout updates)
        this._stateManager.set('ui.featurePanelOpen', true);

        // Emit layout changed to move search bar, chips, etc.
        this._eventBus.emit(EventTypes.UI_LAYOUT_CHANGED, {
            sidebarExpanded: false,
            featurePanelOpen: true,
            contentLeftOffset: SIDEBAR_DIMENSIONS.TOTAL_EXPANDED_WIDTH
        });

        // Cleanup previous content
        this._cleanupFeaturePanelContent();

        // Create and show vector info content
        const { element, title } = createVectorInfoPanelContent({
            feature: payload.feature,
            title: payload.title
        });

        this._featurePanel.show(element, title);
    }

    /**
     * Called when a 3D marker is clicked.
     * @private
     * @param {Object} payload - Event payload with marker and tilesetId
     */
    async _onMarker3dClicked(payload) {
        const result = await handleMarker3dClick({
            marker: payload.marker,
            tilesetId: payload.tilesetId,
            stateManager: this._stateManager,
            cleanupPrevious: () => this._cleanupFeaturePanelContent(),
            onPanelClose: () => this._handleFeaturePanelClose()
        });

        if (result) {
            this._currentFeaturePanelCleanup = result.cleanup;
            this._featurePanel.show(result.element, result.title);
        }
    }

    /**
     * Called when a 3D marker is deselected.
     * @private
     */
    _onMarker3dDeselected() {
        handleMarker3dDeselect({
            stateManager: this._stateManager,
            hidePanel: (save) => this._featurePanel.hide(save),
            cleanupContent: () => this._cleanupFeaturePanelContent()
        });
    }

    /**
     * Called when a 3D measurement is clicked.
     * @private
     * @param {Object} payload - Event payload with measurement and tilesetId
     */
    async _onMeasurement3dClicked(payload) {
        const result = await handleMeasurement3dClick({
            measurement: payload.measurement,
            tilesetId: payload.tilesetId,
            stateManager: this._stateManager,
            cleanupPrevious: () => this._cleanupFeaturePanelContent(),
            onPanelClose: () => this._handleFeaturePanelClose()
        });

        if (result) {
            this._currentFeaturePanelCleanup = result.cleanup;
            this._featurePanel.show(result.element, result.title);
        }
    }

    /**
     * Called when a 3D measurement is deselected.
     * @private
     */
    _onMeasurement3dDeselected() {
        handleMeasurement3dDeselect({
            stateManager: this._stateManager,
            hidePanel: (save) => this._featurePanel.hide(save),
            cleanupContent: () => this._cleanupFeaturePanelContent()
        });
    }

    /**
     * Called when a 3D viewshed is clicked.
     * @private
     * @param {Object} payload - Event payload with viewshed and tilesetId
     */
    async _onViewshed3dClicked(payload) {
        const result = await handleViewshed3dClick({
            viewshed: payload.viewshed,
            tilesetId: payload.tilesetId,
            stateManager: this._stateManager,
            cleanupPrevious: () => this._cleanupFeaturePanelContent(),
            onPanelClose: () => this._handleFeaturePanelClose()
        });

        if (result) {
            this._currentFeaturePanelCleanup = result.cleanup;
            this._featurePanel.show(result.element, result.title);
        }
    }

    /**
     * Called when a 3D viewshed is deselected.
     * @private
     */
    _onViewshed3dDeselected() {
        handleViewshed3dDeselect({
            stateManager: this._stateManager,
            hidePanel: (save) => this._featurePanel.hide(save),
            cleanupContent: () => this._cleanupFeaturePanelContent()
        });
    }

    /**
     * Called when a 360 marker is clicked.
     * @private
     * @param {Object} payload - Event payload with marker and photoName
     */
    async _onMarker360Clicked(payload) {
        const result = await handleMarker360Click({
            marker: payload.marker,
            photoName: payload.photoName,
            stateManager: this._stateManager,
            cleanupPrevious: () => this._cleanupFeaturePanelContent(),
            onPanelClose: () => this._handleFeaturePanelClose()
        });

        if (result) {
            this._currentFeaturePanelCleanup = result.cleanup;
            this._featurePanel.show(result.element, result.title);
        }
    }

    /**
     * Called when a first-person scene marker is clicked.
     * @private
     * @param {Object} payload - Event payload with marker, sceneName and photoUrl
     */
    async _onMarkerFpClicked(payload) {
        const result = await handleMarkerFpClick({
            marker: payload.marker,
            sceneName: payload.sceneName,
            photoUrl: payload.photoUrl,
            stateManager: this._stateManager,
            cleanupPrevious: () => this._cleanupFeaturePanelContent()
        });

        if (result) {
            this._currentFeaturePanelCleanup = result.cleanup;
            this._featurePanel.show(result.element, result.title);
        }
    }

    /**
     * Called when the first-person item list is opened: from the "Ver todos os
     * itens" button of an open item, or from a label that is covering others.
     * @private
     * @param {Object} payload - Event payload with the resolved items and the header
     */
    async _onMarkerFpListClicked(payload) {
        const result = await handleMarkerFpListClick({
            items: payload.items,
            sceneName: payload.sceneName,
            title: payload.title,
            scoped: payload.scoped,
            openId: payload.openId,
            stateManager: this._stateManager,
            cleanupPrevious: () => this._cleanupFeaturePanelContent()
        });

        if (result) {
            this._currentFeaturePanelCleanup = result.cleanup;
            this._featurePanel.show(result.element, result.title);
        }
    }

    /**
     * Called when a first-person scene marker is deselected, and when the
     * first-person viewer closes with a card still open.
     * @private
     */
    _onMarkerFpDeselected() {
        handleMarkerFpDeselect({
            stateManager: this._stateManager,
            hidePanel: (save) => this._featurePanel.hide(save),
            cleanupContent: () => this._cleanupFeaturePanelContent()
        });
    }

    /**
     * Called when a 360 marker is deselected.
     * @private
     */
    _onMarker360Deselected() {
        handleMarker360Deselect({
            stateManager: this._stateManager,
            hidePanel: (save) => this._featurePanel.hide(save),
            cleanupContent: () => this._cleanupFeaturePanelContent()
        });
    }

    /**
     * Called when the 360 viewer is closed.
     * @private
     */
    _onStreetview360Closed() {
        // Close any open 360 marker panel when the viewer closes
        handleMarker360Deselect({
            stateManager: this._stateManager,
            hidePanel: (save) => this._featurePanel.hide(save),
            cleanupContent: () => this._cleanupFeaturePanelContent()
        });
    }

    /**
     * Called when map notes are requested.
     * @private
     * @param {Object} payload - Event payload with mapName
     */
    async _onMapNotesRequested(payload) {
        const { mapName, readOnly } = payload;
        if (!mapName) return;

        // Collapse sidebar panel first
        this._collapsePanel();

        // Use StateManager to properly handle feature panel state
        this._stateManager.openFeaturePanel(mapName, 'notes');

        // Cleanup previous content
        this._cleanupFeaturePanelContent();

        // Create notes panel content using extracted module
        const { element, cleanup, title } = await createNotesPanelContent({ mapName, readOnly });

        // Store cleanup
        this._notesQuillCleanup = cleanup;

        // Show in feature panel
        this._featurePanel.show(element, title);
    }

    /**
     * Called when a search result should be shown in the feature panel.
     * @private
     * @param {Object} payload - Event payload with result and content
     */
    _onSearchResultPanelRequested(payload) {
        const { result, content } = payload;
        if (!result || !content) return;

        // Collapse sidebar panel first
        this._collapsePanel();

        // Update state to reflect feature panel is open (for layout updates)
        this._stateManager.set('ui.featurePanelOpen', true);
        this._stateManager.set('ui.currentFeatureType', 'searchResult');

        // Emit FEATURE_PANEL_OPENED event for consistency
        this._eventBus.emit(EventTypes.FEATURE_PANEL_OPENED, {
            featureId: 'searchResult',
            featureType: 'searchResult'
        });

        // Emit layout changed to move search bar, chips, etc.
        this._eventBus.emit(EventTypes.UI_LAYOUT_CHANGED, {
            sidebarExpanded: false,
            featurePanelOpen: true,
            contentLeftOffset: SIDEBAR_DIMENSIONS.TOTAL_EXPANDED_WIDTH
        });

        // Cleanup previous content
        this._cleanupFeaturePanelContent();

        // Show the content in feature panel
        this._featurePanel.show(content, result.name || 'Resultado da Busca');
    }

    /**
     * Shows feature content in the feature panel.
     * @private
     * @param {string} featureId - Feature ID
     * @param {string} featureType - Feature type (source)
     */
    async _showFeatureContent(featureId, featureType) {
        // Increment version to invalidate any in-flight async render
        const version = ++this._featureContentVersion;

        // Preserve the currently active tab so we can restore it after rebuild
        const previousActiveTab = this._featurePanel.getContentContainer()
            ?.querySelector('.feature-tab-btn.active')?.dataset?.tabId || null;

        // Save pending changes from previous feature before replacing content
        this._featurePanel._triggerSave();

        // Cleanup previous content
        this._cleanupFeaturePanelContent();

        // Get the feature panel content from UIManager
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'feature-panel-wrapper';

        // Create attribute content using the extracted module
        if (this._uiManager && this._selectionManager) {
            const selectedFeatures = this._selectionManager.getAllSelectedFeatures();

            if (selectedFeatures.length > 0) {
                const result = await createFeaturePanelContent({
                    selectedFeatures,
                    featureType,
                    selectionManager: this._selectionManager,
                    uiManager: this._uiManager,
                    map: this._mapManager?.map,
                    activeTab: previousActiveTab
                });

                // Discard if a newer selection happened while awaiting
                if (version !== this._featureContentVersion) {
                    if (result?.cleanup) result.cleanup();
                    return;
                }

                if (result) {
                    contentWrapper.appendChild(result.element);
                    this._currentFeaturePanelCleanup = result.cleanup;
                }
            }
        }

        // Show in feature panel with fixed title
        this._featurePanel.show(contentWrapper, 'Detalhes da Feição');
    }

    /**
     * Cleans up feature panel content.
     * @private
     */
    _cleanupFeaturePanelContent() {
        if (this._currentFeaturePanelCleanup) {
            this._currentFeaturePanelCleanup();
            this._currentFeaturePanelCleanup = null;
        }
        // Cleanup Quill instance for notes panel
        if (this._notesQuillCleanup) {
            this._notesQuillCleanup();
            this._notesQuillCleanup = null;
        }
    }

    /**
     * Expands the panel to show the specified tab.
     * @private
     * @param {string} tabId - Tab to show
     */
    _expandToTab(tabId) {
        // Deactivate the previous tab if switching to a different one
        if (this._activeTab && this._activeTab !== tabId) {
            this._deactivateTab(this._activeTab);
        }

        // Track the active tab locally
        this._activeTab = tabId;

        // Update collapsed sidebar active state
        this._collapsedSidebar.setActiveTab(tabId);

        // Get or create tab content
        const tabContent = this._getTabContent(tabId);

        // Expand panel with content
        this._panel.expand(tabId, tabContent);
    }

    /**
     * Collapses the panel.
     * Ensures StateManager state is consistent with the visual collapse.
     * Safe to call even when state is already collapsed (set() is a no-op for equal values).
     * @private
     */
    _collapsePanel() {
        // Deactivate the current tab before collapsing
        // Use local tracking since stateManager may have already cleared activeTab
        if (this._activeTab) {
            this._deactivateTab(this._activeTab);
            this._activeTab = null;
        }

        this._collapsedSidebar.setActiveTab(null);
        this._panel.collapse();

        // Sync StateManager to prevent sidebar.expanded from staying true
        // when the panel is visually collapsed by non-collapseSidebar paths
        // (e.g. vector info panel, search result panel, tool panel).
        // set() uses deepEqual and is a no-op when the value hasn't changed,
        // so this is safe to call from any code path.
        this._stateManager.set('sidebar.expanded', false);
        this._stateManager.set('sidebar.activeTab', null);
    }

    /**
     * Deactivates a tab component if it has an onDeactivate method.
     * @private
     * @param {string} tabId - Tab identifier
     */
    _deactivateTab(tabId) {
        const component = this._tabComponents[tabId];
        if (component && typeof component.onDeactivate === 'function') {
            component.onDeactivate();
        }
    }

    /**
     * Gets or creates tab content for the specified tab.
     * Tab content components are created lazily on first access.
     * @private
     * @param {string} tabId - Tab identifier
     * @returns {HTMLElement} Tab content element
     */
    _getTabContent(tabId) {
        // Check if already created
        if (this._tabComponents[tabId]) {
            // Refresh if needed
            if (this._tabComponents[tabId].refresh) {
                this._tabComponents[tabId].refresh();
            }
            return this._tabComponents[tabId].getContainer();
        }

        // Create based on tab type
        let component = null;

        switch (tabId) {
            case SIDEBAR_TABS.MAPAS:
                component = new MapsTab({
                    mapManager: this._mapManager,
                    baseLayerControl: this._baseLayerControl,
                    eventBus: this._eventBus,
                    exportImportService: this._exportImportService,
                });
                break;

            case SIDEBAR_TABS.CAMADAS:
                component = new LayersTab({
                    featuresTab: this._featuresTab,
                    eventBus: this._eventBus,
                });
                break;

            case SIDEBAR_TABS.BRIEFINGS:
                component = new BriefingsTab({
                    eventBus: this._eventBus,
                    stateManager: this._stateManager,
                });
                // Wire up edit callback to open the briefing editor
                component.setOnEditBriefing((briefingId) => {
                    const briefingEditor = getControl('briefingEditor');
                    if (briefingEditor) {
                        // Collapse sidebar before opening editor
                        this._stateManager.collapseSidebar();
                        // Set onClose to return to briefings tab
                        briefingEditor.setOnClose(() => {
                            this._stateManager.expandSidebar(SIDEBAR_TABS.BRIEFINGS);
                        });
                        briefingEditor.open(briefingId);
                    } else {
                        console.warn('Briefing editor control not found');
                    }
                });
                // Wire up present callback to start presentation
                component.setOnPresentBriefing((briefingId) => {
                    const briefingPresenter = getControl('briefingPresenter');
                    if (briefingPresenter) {
                        // Collapse sidebar before starting presentation
                        this._stateManager.collapseSidebar();
                        // Set onExit to return to briefings tab
                        briefingPresenter.setOnExit(() => {
                            this._stateManager.expandSidebar(SIDEBAR_TABS.BRIEFINGS);
                        });
                        briefingPresenter.start(briefingId);
                    } else {
                        console.warn('Briefing presenter control not found');
                    }
                });
                // Wire up PDF export callback
                component.setOnExportPdf(async (briefingId) => {
                    const map = this._mapManager?.map;
                    if (!map) {
                        console.warn('Map not available for PDF export');
                        return;
                    }
                    // Collapse sidebar before export (modal covers screen)
                    this._stateManager.collapseSidebar();
                    const { exportBriefingToPdf } = await import(
                        '../briefing/export/briefing-pdf-export.js'
                    );
                    await exportBriefingToPdf(briefingId, map);
                });
                break;

            case SIDEBAR_TABS.PROCESSAMENTO:
                component = new ProcessingTab({
                    eventBus: this._eventBus,
                    stateManager: this._stateManager,
                    onOpenAlgorithm: (algorithmId) => this._handleOpenProcessingAlgorithm(algorithmId),
                });
                break;

            case SIDEBAR_TABS.IMPORTAR:
                component = new ImportTab({
                    importControl: this._importControl,
                    exportImportService: this._exportImportService,
                    eventBus: this._eventBus,
                    onShowToolPanel: (element, title, cleanupFn, onCloseFn) =>
                        this.showToolPanel(element, title, cleanupFn, onCloseFn),
                    onHideToolPanel: () =>
                        this.hideToolPanel(false, false),
                });
                break;

            case SIDEBAR_TABS.EXPORTAR:
                component = new ExportTab({
                    map: this._mapManager?.map,
                    pdfExportTab: this._pdfExportTab,
                    screenshotControl: this._screenshotControl,
                    exportImportService: this._exportImportService,
                    eventBus: this._eventBus,
                });
                break;

            default:
                component = this._createPlaceholderTab(tabId);
        }

        if (component) {
            const container = component.render ? component.render() : component.getContainer();
            this._tabComponents[tabId] = component;
            return container;
        }

        return document.createElement('div');
    }

    /**
     * Creates a placeholder tab for unimplemented tabs.
     * @private
     * @param {string} tabId - Tab identifier
     * @returns {Object} Placeholder component
     */
    _createPlaceholderTab(tabId) {
        const tabNames = {
            [SIDEBAR_TABS.MAPAS]: 'Mapas',
            [SIDEBAR_TABS.CAMADAS]: 'Camadas',
            [SIDEBAR_TABS.BRIEFINGS]: 'Briefings',
            [SIDEBAR_TABS.IMPORTAR]: 'Importar',
            [SIDEBAR_TABS.EXPORTAR]: 'Exportar',
        };

        const container = document.createElement('div');
        container.className = 'sidebar-tab-content';
        container.innerHTML = `
            <div class="sidebar-tab-placeholder">
                <p>Tab "${tabNames[tabId] || tabId}" será implementado na próxima fase</p>
            </div>
        `;

        return {
            getContainer: () => container,
            refresh: () => {},
            destroy: () => {},
        };
    }

    /**
     * Registers a tab content component.
     * @param {string} tabId - Tab identifier
     * @param {Object} component - Tab component with getContainer() and destroy() methods
     */
    registerTabComponent(tabId, component) {
        if (this._tabComponents[tabId] && this._tabComponents[tabId].destroy) {
            this._tabComponents[tabId].destroy();
        }
        this._tabComponents[tabId] = component;

        // If this tab is currently active, refresh the panel content
        const activeTab = this._stateManager.get('sidebar.activeTab');
        const isExpanded = this._stateManager.get('sidebar.expanded');
        if (isExpanded && activeTab === tabId) {
            this._panel.expand(tabId, component.getContainer());
        }
    }

    /**
     * Updates the recent maps display.
     * @private
     */
    async _updateRecentMaps() {
        try {
            const allMaps = await getAllMapNamesStore();
            const currentMap = await getCurrentMapName();
            const savedOrder = await getMapOrder();
            const mapColors = await getAllMapBadgeColors();

            // Sort maps: use saved order if available, otherwise maintain existing order
            let sortedMaps;
            if (savedOrder && savedOrder.length > 0) {
                // Use saved order, filtering only existing maps
                sortedMaps = savedOrder.filter(name => allMaps.includes(name));
                // Add any maps not in saved order
                allMaps.forEach(name => {
                    if (!sortedMaps.includes(name)) {
                        sortedMaps.push(name);
                    }
                });
            } else {
                // No saved order - use existing order from store (do not reorder)
                sortedMaps = allMaps;
            }

            // Create map objects with isActive flag and persistent color
            const recentMaps = sortedMaps.map(name => ({
                name,
                thumbnail: null,
                isActive: name === currentMap,
                color: mapColors[name]
            }));

            this._collapsedSidebar.updateRecentMaps(recentMaps);
        } catch (error) {
            console.warn('Failed to update recent maps:', error);
        }
    }

    /**
     * Handles opening a processing algorithm panel.
     * @private
     * @param {string} algorithmId - Algorithm ID to open
     */
    _handleOpenProcessingAlgorithm(algorithmId) {
        const algorithm = getAlgorithm(algorithmId);
        if (!algorithm) return;

        const panelResult = createProcessingPanel({
            algorithm,
            stateManager: this._stateManager,
            eventBus: this._eventBus,
        });

        this.showToolPanel(
            panelResult.element,
            algorithm.name,
            panelResult.cleanup,
            () => panelResult.cleanup()
        );
    }

    /**
     * Shows custom content in the feature panel.
     * Used by tools that need to show their own panel UI during creation.
     * @param {HTMLElement} contentElement - The content to show
     * @param {string} title - Panel title
     * @param {Function} [cleanupFn] - Optional cleanup function
     * @param {Function} [onCloseFn] - Optional callback when panel is closed by user
     */
    showToolPanel(contentElement, title, cleanupFn, onCloseFn) {
        if (!contentElement || !this._featurePanel) return;

        // Save current tab so closeFeaturePanel() can restore it
        if (this._activeTab) {
            this._stateManager.set('sidebar.previousTab', this._activeTab);
        }

        // Collapse sidebar panel first
        this._collapsePanel();

        // Update state to reflect feature panel is open (for layout updates)
        this._stateManager.set('ui.featurePanelOpen', true);
        this._stateManager.set('ui.currentFeatureType', 'tool_panel');

        // Emit FEATURE_PANEL_OPENED event for consistency
        this._eventBus.emit(EventTypes.FEATURE_PANEL_OPENED, {
            featureId: 'tool_panel',
            featureType: 'tool_panel'
        });

        // Emit layout changed to move search bar, chips, etc.
        this._eventBus.emit(EventTypes.UI_LAYOUT_CHANGED, {
            sidebarExpanded: false,
            featurePanelOpen: true,
            contentLeftOffset: SIDEBAR_DIMENSIONS.TOTAL_EXPANDED_WIDTH
        });

        // Cleanup previous content
        this._cleanupFeaturePanelContent();

        // Store cleanup function if provided
        if (cleanupFn) {
            this._currentFeaturePanelCleanup = cleanupFn;
        }

        // Store onClose callback
        this._toolPanelOnClose = onCloseFn;

        // Show in feature panel
        this._featurePanel.show(contentElement, title);
    }

    /**
     * Hides the feature panel (for tools).
     * @param {boolean} [saveChanges=false] - Whether to save changes
     * @param {boolean} [triggerOnClose=true] - Whether to trigger onClose callback
     */
    hideToolPanel(saveChanges = false, triggerOnClose = true) {
        if (!this._featurePanel) return;

        // Trigger onClose callback if set
        if (triggerOnClose && this._toolPanelOnClose) {
            this._toolPanelOnClose();
            this._toolPanelOnClose = null;
        }

        this._featurePanel.hide(saveChanges);
        this._cleanupFeaturePanelContent();

        // Update state
        this._stateManager.set('ui.featurePanelOpen', false);
        this._stateManager.set('ui.currentFeatureType', null);

        // Emit layout changed
        this._eventBus.emit(EventTypes.UI_LAYOUT_CHANGED, {
            sidebarExpanded: false,
            featurePanelOpen: false,
            contentLeftOffset: 56
        });

        // Emit FEATURE_PANEL_CLOSED event
        this._eventBus.emit(EventTypes.FEATURE_PANEL_CLOSED, {});
    }

    /**
     * Gets the current expanded state.
     * @returns {boolean}
     */
    isExpanded() {
        return this._panel?.isExpanded() || false;
    }

    /**
     * Checks if feature panel is open.
     * @returns {boolean}
     */
    isFeaturePanelOpen() {
        return this._featurePanel?.isExpanded() || false;
    }

    /**
     * Gets the current content left offset (for positioning other elements).
     * @returns {number} Offset in pixels
     */
    getContentOffset() {
        if (this.isExpanded() || this.isFeaturePanelOpen()) {
            return SIDEBAR_DIMENSIONS.TOTAL_EXPANDED_WIDTH;
        }
        return SIDEBAR_DIMENSIONS.COLLAPSED_WIDTH;
    }

    /**
     * Gets the container element.
     * @returns {HTMLElement|null}
     */
    getContainer() {
        return this._container;
    }

    /**
     * Destroys the sidebar and all its components.
     */
    destroy() {
        // Cleanup feature panel content
        this._cleanupFeaturePanelContent();

        // Destroy tab components
        Object.values(this._tabComponents).forEach(component => {
            if (component && component.destroy) {
                component.destroy();
            }
        });
        this._tabComponents = {};

        // Destroy main components
        if (this._collapsedSidebar) {
            this._collapsedSidebar.destroy();
            this._collapsedSidebar = null;
        }

        if (this._panel) {
            this._panel.destroy();
            this._panel = null;
        }

        if (this._featurePanel) {
            this._featurePanel.destroy();
            this._featurePanel = null;
        }

        // Remove panels wrapper
        if (this._panelsWrapper) {
            removeElement(this._panelsWrapper);
            this._panelsWrapper = null;
        }

        // Remove backdrop
        if (this._backdrop) {
            removeElement(this._backdrop);
            this._backdrop = null;
        }

        // Cleanup events and remove container
        cleanup(this);
        removeElement(this._container);
        this._container = null;
    }
}
