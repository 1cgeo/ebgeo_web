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
import { EventTypes } from '../events/event_types.js';
import {
    setupCleanup,
    subscribe,
    addDomListener as _addDomListener,
    cleanup,
    removeElement
} from '../utilities/event-cleanup.js';
import { injectTabbedPanelStyles } from '../tool_manager/tabbed_attribute_panel.js';
import { renderAttributesContent as _renderAttributesContent } from '../user_data/attributes_tab_renderer.js';
import {
    setCurrentMap,
    getCurrentMapName,
    getAllMapNamesStore,
    getMapOrder,
    getAllMapBadgeColors,
    getControl
} from '../store/index.js';
// Extracted panel modules
import { createNotesPanelContent } from './panels/notes-panel.js';
import { createVectorInfoPanelContent } from './panels/vector-info-panel.js';
import { createFeaturePanelContent } from './panels/feature-panel-content.js';

// Extracted 3D/360 handlers
import {
    handleMarker3dClick,
    handleMarker3dDeselect,
    handleMeasurement3dClick,
    handleMeasurement3dDeselect,
    handleViewshed3dClick,
    handleViewshed3dDeselect,
    handleMarker360Click,
    handleMarker360Deselect,
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

        // Tab content components (created lazily)
        this._tabComponents = {
            [SIDEBAR_TABS.MAPAS]: null,
            [SIDEBAR_TABS.CAMADAS]: null,
            [SIDEBAR_TABS.BRIEFINGS]: null,
            [SIDEBAR_TABS.IMPORTAR]: null,
            [SIDEBAR_TABS.EXPORTAR]: null,
        };

        // Track the currently active tab locally (needed for deactivation on close)
        this._activeTab = null;

        // Current feature panel content cleanup
        this._currentFeaturePanelCleanup = null;

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

        // Listen for 360 viewer closed to close any open 360 panels
        subscribe(this, this._eventBus, EventTypes.STREETVIEW_360_CLOSED,
            () => this._onStreetview360Closed());

        // Listen for base layer changes (map switch) to close 3D panels
        subscribe(this, this._eventBus, EventTypes.BASE_LAYER_CHANGED,
            () => this._onBaseLayerChanged());
    }

    /**
     * Called when base layer changes (usually during map switch).
     * Closes any open 3D feature panels to prevent stale data.
     * @private
     */
    _onBaseLayerChanged() {
        closeAny3dPanel({
            stateManager: this._stateManager,
            hidePanel: (save) => this._featurePanel.hide(save),
            cleanupContent: () => this._cleanupFeaturePanelContent(),
            eventBus: this._eventBus,
            EventTypes
        });
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
        // Check if we're closing the notes panel or 3D feature panels
        const featureType = this._stateManager.get('ui.currentFeatureType');
        const isNotes = featureType === 'notes';
        const is3dFeature = ['marker3d', 'measurement3d', 'viewshed3d'].includes(featureType);

        // Save changes before closing (this triggers save button click)
        // Must happen BEFORE deselecting features
        this._featurePanel.hide(true);

        // Deselect 3D features if closing their panels
        if (is3dFeature) {
            await deselect3dFeature(featureType);
        }

        // Only clear selection if we're not showing notes or 3D features
        if (!isNotes && !is3dFeature && this._selectionManager) {
            this._selectionManager.deselectAllFeatures();
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
    }

    /**
     * Called when sidebar is collapsed (from event).
     * @private
     */
    _onSidebarCollapsed() {
        this._collapsePanel();
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
        // Collapse sidebar panel first
        this._collapsePanel();

        // Show feature panel with content
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
            contentLeftOffset: 376
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
        const { mapName } = payload;
        if (!mapName) return;

        // Collapse sidebar panel first
        this._collapsePanel();

        // Use StateManager to properly handle feature panel state
        this._stateManager.openFeaturePanel(mapName, 'notes');

        // Cleanup previous content
        this._cleanupFeaturePanelContent();

        // Create notes panel content using extracted module
        const { element, cleanup, title } = await createNotesPanelContent({ mapName });

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
            contentLeftOffset: 376
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
                    map: this._mapManager?.map
                });

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
                break;

            case SIDEBAR_TABS.IMPORTAR:
                component = new ImportTab({
                    importControl: this._importControl,
                    exportImportService: this._exportImportService,
                    eventBus: this._eventBus,
                });
                break;

            case SIDEBAR_TABS.EXPORTAR:
                component = new ExportTab({
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
            <div style="padding: 20px; text-align: center; color: #666;">
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

        // Cleanup events and remove container
        cleanup(this);
        removeElement(this._container);
        this._container = null;
    }
}
