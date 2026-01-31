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
    getMapNotes,
    setMapNotes,
    getAllMapNamesStore,
    getMapOrder,
    getAllMapBadgeColors
} from '../store/index.js';
import { showConfirm } from '../modals/index.js';

// New feature panel components
import { createFeatureIdentification, createMultiSelectionHeader } from './components/feature-identification.js';
import { createPhotoGallery } from './components/feature-photo-gallery.js';
import { createFeatureTabs } from './components/feature-tabs.js';
import { createLocationSection } from './components/feature-location-section.js';
import { createGroupTypeSelector } from './components/group-type-selector.js';

// 3D panel modules (lazy imported)
let markerPanel3dModule = null;
let measurementPanel3dModule = null;
let viewshedPanel3dModule = null;

// 360 panel modules (lazy imported)
let markerPanel360Module = null;

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
        const featureType = this._stateManager.get('ui.currentFeatureType');

        // Check if a 3D or 360 panel is open
        const is3dPanel = ['marker3d', 'measurement3d', 'viewshed3d', 'marker360'].includes(featureType);

        if (is3dPanel && this._stateManager.get('ui.featurePanelOpen')) {
            // Close the panel and cleanup
            this._featurePanel.hide(false);
            this._cleanupFeaturePanelContent();

            this._stateManager.set('ui.featurePanelOpen', false);
            this._stateManager.set('ui.currentFeatureType', null);
            this._stateManager.set('sidebar.previousTab', null);

            this._eventBus.emit(EventTypes.FEATURE_PANEL_CLOSED, {});
            this._eventBus.emit(EventTypes.UI_LAYOUT_CHANGED, {
                sidebarExpanded: false,
                featurePanelOpen: false,
                contentLeftOffset: 56
            });
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
        // Check if we're closing the notes panel or 3D feature panels
        const featureType = this._stateManager.get('ui.currentFeatureType');
        const isNotes = featureType === 'notes';
        const isMarker3d = featureType === 'marker3d';
        const isMeasurement3d = featureType === 'measurement3d';
        const isViewshed3d = featureType === 'viewshed3d';
        const is3dFeature = isMarker3d || isMeasurement3d || isViewshed3d;

        // Save changes before closing (this triggers save button click)
        // Must happen BEFORE deselecting features
        this._featurePanel.hide(true);

        // Deselect 3D features if closing their panels
        if (isMarker3d) {
            try {
                const { deselectCurrentMarker } = await import('../3d_models_viewer_tool/tools/marker_tool_3d.js');
                deselectCurrentMarker();
            } catch (error) {
                console.warn('Could not deselect 3D marker:', error);
            }
        }

        if (isMeasurement3d) {
            try {
                const { deselectCurrentMeasurement } = await import('../3d_models_viewer_tool/tools/measurement_tool_3d.js');
                deselectCurrentMeasurement();
            } catch (error) {
                console.warn('Could not deselect 3D measurement:', error);
            }
        }

        if (isViewshed3d) {
            try {
                const { deselectCurrentViewshed } = await import('../3d_models_viewer_tool/tools/viewshed_tool_3d.js');
                deselectCurrentViewshed();
            } catch (error) {
                console.warn('Could not deselect 3D viewshed:', error);
            }
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

        // Show vector info in feature panel
        this._showVectorInfoContent(payload.feature, payload.title);
    }

    /**
     * Shows vector tile info content in the feature panel.
     * @private
     * @param {Object} feature - Vector tile feature
     * @param {string} title - Display title
     */
    _showVectorInfoContent(feature, title) {
        // Cleanup previous content
        this._cleanupFeaturePanelContent();

        // Create content
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'vector-info-panel-content';

        // Build the properties list
        const propertiesList = document.createElement('ul');
        propertiesList.className = 'vector-info-properties';
        propertiesList.style.cssText = `
            list-style: none;
            padding: 0;
            margin: 0;
        `;

        const blacklist = ['fid', 'id', 'vector_type', 'tilequery', 'mapbox_clip_start', 'mapbox_clip_end', 'justificativa_txt_value', 'visivel_value', 'exibir_linha_rotulo_value', 'suprimir_bandeira_value', 'posicao_rotulo_value', 'direcao_fixada_value', 'exibir_ponta_simbologia_value', 'exibir_lado_simbologia_value', 'label_x', 'label_y', 'length_otf', 'texto_edicao', 'simb_rot', 'observacao'];
        const blacklistSuffixes = ['_code'];

        for (const [key, value] of Object.entries(feature.properties)) {
            if (blacklist.includes(key) || blacklistSuffixes.some(suffix => key.endsWith(suffix))) {
                continue;
            }

            let displayKey = key.endsWith('_value') ? key.slice(0, -6) : key;
            displayKey = displayKey.replace(/_/g, ' ');
            if (displayKey.startsWith('identificador')) {
                displayKey = displayKey.substring('identificador'.length);
            }

            let displayValue;
            if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
                const formattedString = value
                    .slice(1, -1)
                    .replace(/"/g, '')
                    .replace(/,/g, ', ');
                displayValue = formattedString || '-';
            } else {
                displayValue = value;
            }

            const listItem = document.createElement('li');
            listItem.style.cssText = `
                padding: var(--space-2) 0;
                border-bottom: 1px solid var(--border-color);
                font-size: var(--font-size-sm);
            `;
            listItem.innerHTML = `<strong style="color: var(--gray-600);">${displayKey}:</strong> <span style="color: var(--gray-800);">${displayValue}</span>`;
            propertiesList.appendChild(listItem);
        }

        if (propertiesList.children.length > 0) {
            contentWrapper.appendChild(propertiesList);
        } else {
            const noPropertiesMsg = document.createElement('p');
            noPropertiesMsg.textContent = 'Feição sem atributos';
            noPropertiesMsg.style.cssText = 'color: var(--gray-500); text-align: center; padding: var(--space-4);';
            contentWrapper.appendChild(noPropertiesMsg);
        }

        // Show in feature panel with title
        this._featurePanel.show(contentWrapper, `Atributos: ${title}`);
    }

    /**
     * Called when a 3D marker is clicked.
     * @private
     * @param {Object} payload - Event payload with marker and tilesetId
     */
    async _onMarker3dClicked(payload) {
        const { marker, tilesetId } = payload;
        if (!marker) return;

        // Use StateManager's openFeaturePanel to properly save previous sidebar state
        this._stateManager.openFeaturePanel(marker.id, 'marker3d');

        // Load marker panel module lazily
        if (!markerPanel3dModule) {
            markerPanel3dModule = await import('../3d_models_viewer_tool/components/marker-panel-3d.js');
            markerPanel3dModule.injectMarkerPanelStyles();
        }

        // Cleanup previous content
        this._cleanupFeaturePanelContent();

        // Create marker panel content
        const { element, cleanup } = markerPanel3dModule.createMarkerPanelContent(
            marker,
            tilesetId,
            () => this._handleFeaturePanelClose()
        );

        // Register cleanup
        this._currentFeaturePanelCleanup = cleanup;

        // Show in feature panel
        const markerName = marker.properties?.nome || 'Marcador 3D';
        this._featurePanel.show(element, markerName);
    }

    /**
     * Called when a 3D marker is deselected.
     * @private
     */
    _onMarker3dDeselected() {
        // Only close if the feature panel is currently showing a 3D marker
        const featureType = this._stateManager.get('ui.currentFeatureType');
        const isPanelOpen = this._stateManager.get('ui.featurePanelOpen');

        if (featureType === 'marker3d' && isPanelOpen) {
            // Hide panel UI without triggering save
            this._featurePanel.hide(false);
            this._cleanupFeaturePanelContent();

            // Use StateManager's closeFeaturePanel to properly restore previous state
            this._stateManager.closeFeaturePanel();
        }
    }

    /**
     * Called when a 3D measurement is clicked.
     * @private
     * @param {Object} payload - Event payload with measurement and tilesetId
     */
    async _onMeasurement3dClicked(payload) {
        const { measurement, tilesetId } = payload;
        if (!measurement) return;

        // Use StateManager's openFeaturePanel to properly save previous sidebar state
        this._stateManager.openFeaturePanel(measurement.id, 'measurement3d');

        // Load measurement panel module lazily
        if (!measurementPanel3dModule) {
            measurementPanel3dModule = await import('../3d_models_viewer_tool/components/measurement-panel-3d.js');
            measurementPanel3dModule.injectMeasurementPanelStyles();
        }

        // Cleanup previous content
        this._cleanupFeaturePanelContent();

        // Create measurement panel content
        const { element, cleanup } = measurementPanel3dModule.createMeasurementPanelContent(
            measurement,
            tilesetId,
            () => this._handleFeaturePanelClose()
        );

        // Register cleanup
        this._currentFeaturePanelCleanup = cleanup;

        // Show in feature panel
        const measurementName = measurement.properties?.nome || (measurement.type === 'area' ? 'Medição de Área' : 'Medição de Distância');
        this._featurePanel.show(element, measurementName);
    }

    /**
     * Called when a 3D measurement is deselected.
     * @private
     */
    _onMeasurement3dDeselected() {
        // Only close if the feature panel is currently showing a 3D measurement
        const featureType = this._stateManager.get('ui.currentFeatureType');
        const isPanelOpen = this._stateManager.get('ui.featurePanelOpen');

        if (featureType === 'measurement3d' && isPanelOpen) {
            // Hide panel UI without triggering save
            this._featurePanel.hide(false);
            this._cleanupFeaturePanelContent();

            // Use StateManager's closeFeaturePanel to properly restore previous state
            this._stateManager.closeFeaturePanel();
        }
    }

    /**
     * Called when a 3D viewshed is clicked.
     * @private
     * @param {Object} payload - Event payload with viewshed and tilesetId
     */
    async _onViewshed3dClicked(payload) {
        const { viewshed, tilesetId } = payload;
        if (!viewshed) return;

        // Use StateManager's openFeaturePanel to properly save previous sidebar state
        this._stateManager.openFeaturePanel(viewshed.id, 'viewshed3d');

        // Load viewshed panel module lazily
        if (!viewshedPanel3dModule) {
            viewshedPanel3dModule = await import('../3d_models_viewer_tool/components/viewshed-panel-3d.js');
            viewshedPanel3dModule.injectViewshedPanelStyles();
        }

        // Cleanup previous content
        this._cleanupFeaturePanelContent();

        // Create viewshed panel content
        const { element, cleanup } = viewshedPanel3dModule.createViewshedPanelContent(
            viewshed,
            tilesetId,
            () => this._handleFeaturePanelClose()
        );

        // Register cleanup
        this._currentFeaturePanelCleanup = cleanup;

        // Show in feature panel
        const viewshedName = viewshed.properties?.nome || 'Análise de Visibilidade';
        this._featurePanel.show(element, viewshedName);
    }

    /**
     * Called when a 3D viewshed is deselected.
     * @private
     */
    _onViewshed3dDeselected() {
        // Only close if the feature panel is currently showing a 3D viewshed
        const featureType = this._stateManager.get('ui.currentFeatureType');
        const isPanelOpen = this._stateManager.get('ui.featurePanelOpen');

        if (featureType === 'viewshed3d' && isPanelOpen) {
            // Hide panel UI without triggering save
            this._featurePanel.hide(false);
            this._cleanupFeaturePanelContent();

            // Use StateManager's closeFeaturePanel to properly restore previous state
            this._stateManager.closeFeaturePanel();
        }
    }

    /**
     * Called when a 360 marker is clicked.
     * @private
     * @param {Object} payload - Event payload with marker and photoName
     */
    async _onMarker360Clicked(payload) {
        const { marker, photoName } = payload;
        if (!marker) return;

        // Use StateManager's openFeaturePanel to properly save previous sidebar state
        this._stateManager.openFeaturePanel(marker.id, 'marker360');

        // Load marker panel module lazily
        if (!markerPanel360Module) {
            markerPanel360Module = await import('../street_view_tool/components/marker-panel-360.js');
            markerPanel360Module.injectMarkerPanel360Styles();
        }

        // Cleanup previous content
        this._cleanupFeaturePanelContent();

        // Create marker panel content
        const { element, cleanup } = markerPanel360Module.createMarkerPanel360Content(
            marker,
            photoName,
            () => this._handleFeaturePanelClose()
        );

        // Register cleanup
        this._currentFeaturePanelCleanup = cleanup;

        // Show in feature panel
        const markerName = marker.properties?.nome || 'Marcador 360';
        this._featurePanel.show(element, markerName);
    }

    /**
     * Called when a 360 marker is deselected.
     * @private
     */
    _onMarker360Deselected() {
        // Only close if the feature panel is currently showing a 360 marker
        const featureType = this._stateManager.get('ui.currentFeatureType');
        const isPanelOpen = this._stateManager.get('ui.featurePanelOpen');

        if (featureType === 'marker360' && isPanelOpen) {
            // Hide panel UI without triggering save
            this._featurePanel.hide(false);
            this._cleanupFeaturePanelContent();

            // Use StateManager's closeFeaturePanel to properly restore previous state
            this._stateManager.closeFeaturePanel();
        }
    }

    /**
     * Called when the 360 viewer is closed.
     * @private
     */
    _onStreetview360Closed() {
        // Close any open 360 marker panel when the viewer closes
        const featureType = this._stateManager.get('ui.currentFeatureType');
        const isPanelOpen = this._stateManager.get('ui.featurePanelOpen');

        if (featureType === 'marker360' && isPanelOpen) {
            // Hide panel UI without triggering save
            this._featurePanel.hide(false);
            this._cleanupFeaturePanelContent();

            // Use StateManager's closeFeaturePanel to properly restore previous state
            this._stateManager.closeFeaturePanel();
        }
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

        // Show notes in feature panel
        await this._showMapNotesContent(mapName);
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
     * Shows map notes content in the feature panel.
     * Starts in view mode (read-only) with an edit button.
     * Uses Quill.js for rich text editing.
     * @private
     * @param {string} mapName - Map name to show notes for
     */
    async _showMapNotesContent(mapName) {
        // Cleanup previous content
        this._cleanupFeaturePanelContent();

        // Load notes
        let notesData;
        try {
            const notes = await getMapNotes(mapName);
            notesData = {
                title: notes?.title || '',
                description: notes?.description || ''
            };
        } catch (error) {
            console.error('Error loading notes:', error);
            notesData = { title: '', description: '' };
        }

        // Create content wrapper
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'map-notes-sidebar-content';

        // Track Quill instance
        let quillInstance = null;

        // --- VIEW MODE ELEMENTS ---
        const viewContainer = document.createElement('div');
        viewContainer.className = 'map-notes-view-container';

        // Edit button (shown in view mode)
        const editBtn = document.createElement('button');
        editBtn.className = 'map-notes-sidebar-edit-btn';
        editBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Editar
        `;

        // Title display (view mode)
        const titleDisplay = document.createElement('div');
        titleDisplay.className = 'map-notes-sidebar-title-display';
        titleDisplay.textContent = notesData.title || 'Sem título';
        if (!notesData.title) {
            titleDisplay.classList.add('map-notes-sidebar-placeholder');
        }

        // Description display (view mode) - renders HTML from Quill
        const descDisplay = document.createElement('div');
        descDisplay.className = 'map-notes-sidebar-desc-display map-notes-quill-content';
        if (notesData.description) {
            descDisplay.innerHTML = notesData.description;
        } else {
            descDisplay.innerHTML = '<p class="map-notes-sidebar-placeholder">Clique em editar para adicionar uma descrição...</p>';
        }

        viewContainer.appendChild(editBtn);
        viewContainer.appendChild(titleDisplay);
        viewContainer.appendChild(descDisplay);

        // --- EDIT MODE ELEMENTS ---
        const editContainer = document.createElement('div');
        editContainer.className = 'map-notes-edit-container';
        editContainer.style.display = 'none';

        // Title section
        const titleSection = document.createElement('div');
        titleSection.className = 'map-notes-sidebar-title-section';

        const titleLabel = document.createElement('label');
        titleLabel.textContent = 'Título';
        titleLabel.className = 'map-notes-sidebar-label';

        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'map-notes-sidebar-title-input';
        titleInput.placeholder = 'Título da nota...';
        titleInput.value = notesData.title;
        titleInput.maxLength = 100;

        titleSection.appendChild(titleLabel);
        titleSection.appendChild(titleInput);

        // Description section with Quill editor
        const descSection = document.createElement('div');
        descSection.className = 'map-notes-sidebar-desc-section';

        const descLabel = document.createElement('label');
        descLabel.textContent = 'Descrição';
        descLabel.className = 'map-notes-sidebar-label';

        // Quill editor container
        const quillContainer = document.createElement('div');
        quillContainer.className = 'map-notes-quill-container';

        const quillEditor = document.createElement('div');
        quillEditor.className = 'map-notes-quill-editor';

        quillContainer.appendChild(quillEditor);
        descSection.appendChild(descLabel);
        descSection.appendChild(quillContainer);

        // Buttons container
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'map-notes-sidebar-buttons';

        // Cancel button
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'map-notes-sidebar-cancel-btn';
        cancelBtn.textContent = 'Cancelar';

        // Save button
        const saveBtn = document.createElement('button');
        saveBtn.className = 'map-notes-sidebar-save-btn';
        saveBtn.textContent = 'Salvar';

        buttonsContainer.appendChild(cancelBtn);
        buttonsContainer.appendChild(saveBtn);

        editContainer.appendChild(titleSection);
        editContainer.appendChild(descSection);
        editContainer.appendChild(buttonsContainer);

        // --- QUILL INITIALIZATION ---
        const initQuill = async () => {
            if (quillInstance) return;

            // Dynamic import Quill and its CSS
            const [{ default: Quill }] = await Promise.all([
                import('quill'),
                import('quill/dist/quill.snow.css')
            ]);

            quillInstance = new Quill(quillEditor, {
                theme: 'snow',
                placeholder: 'Digite a descrição...',
                modules: {
                    toolbar: [
                        [{ 'header': [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline', 'strike'],
                        [{ 'color': [] }, { 'background': [] }],
                        [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                        [{ 'indent': '-1' }, { 'indent': '+1' }],
                        [{ 'align': [] }],
                        ['link', 'image'],
                        ['clean']
                    ]
                }
            });

            // Set initial content
            if (notesData.description) {
                quillInstance.root.innerHTML = notesData.description;
            }

            // Setup image handler for compression
            const toolbar = quillInstance.getModule('toolbar');
            toolbar.addHandler('image', () => this._handleQuillImageUpload(quillInstance));
        };

        // --- MODE SWITCHING ---
        const switchToEditMode = async () => {
            viewContainer.style.display = 'none';
            editContainer.style.display = 'flex';

            // Initialize Quill on first edit
            await initQuill();

            // Reset content to current stored data
            if (quillInstance) {
                quillInstance.root.innerHTML = notesData.description || '';
            }

            titleInput.focus();
        };

        const switchToViewMode = (updatedData = null) => {
            editContainer.style.display = 'none';
            viewContainer.style.display = 'flex';

            if (updatedData) {
                // Update view with new data
                titleDisplay.textContent = updatedData.title || 'Sem título';
                titleDisplay.classList.toggle('map-notes-sidebar-placeholder', !updatedData.title);

                if (updatedData.description) {
                    descDisplay.innerHTML = updatedData.description;
                    descDisplay.classList.remove('map-notes-sidebar-placeholder');
                } else {
                    descDisplay.innerHTML = '<p class="map-notes-sidebar-placeholder">Clique em editar para adicionar uma descrição...</p>';
                }
            }
        };

        // Edit button click
        editBtn.onclick = switchToEditMode;

        // Cancel button click
        cancelBtn.onclick = () => {
            // Reset inputs to original values
            titleInput.value = notesData.title;
            if (quillInstance) {
                quillInstance.root.innerHTML = notesData.description || '';
            }
            switchToViewMode();
        };

        // Save button click
        saveBtn.onclick = async () => {
            try {
                const description = quillInstance ? this._cleanQuillContent(quillInstance.root.innerHTML) : '';
                const notes = {
                    title: titleInput.value.trim(),
                    description: description
                };
                await setMapNotes(mapName, notes);

                // Update stored data
                notesData.title = notes.title;
                notesData.description = notes.description;

                // Switch back to view mode with updated data
                switchToViewMode(notes);

                // Dynamic import for showSuccess
                const { showSuccess } = await import('../utilities/index.js');
                showSuccess('Notas salvas com sucesso!');
            } catch (error) {
                console.error('Error saving notes:', error);
                const { showError } = await import('../utilities/index.js');
                showError('Erro ao salvar notas');
            }
        };

        contentWrapper.appendChild(viewContainer);
        contentWrapper.appendChild(editContainer);

        // Store quill cleanup function
        this._notesQuillCleanup = () => {
            if (quillInstance) {
                quillInstance = null;
            }
        };

        // Show in feature panel
        this._featurePanel.show(contentWrapper, `Notas: ${mapName}`);
    }

    /**
     * Handles image upload for Quill editor with compression.
     * @private
     * @param {Object} quillInstance - Quill editor instance
     */
    _handleQuillImageUpload(quillInstance) {
        const input = document.createElement('input');
        input.setAttribute('type', 'file');
        input.setAttribute('accept', 'image/png, image/gif, image/jpeg, image/webp');
        input.click();

        input.onchange = async () => {
            const file = input.files[0];
            if (file) {
                try {
                    const compressedBase64 = await this._compressImage(file);
                    const range = quillInstance.getSelection(true);
                    quillInstance.insertEmbed(range.index, 'image', compressedBase64);
                    quillInstance.setSelection(range.index + 1);
                } catch (error) {
                    console.error('Error processing image:', error);
                    const { showError } = await import('../utilities/index.js');
                    showError('Erro ao adicionar imagem');
                }
            }
        };
    }

    /**
     * Compresses image before embedding in Quill.
     * @private
     * @param {File} file - Image file to compress
     * @returns {Promise<string>} Base64 encoded compressed image
     */
    _compressImage(file) {
        return new Promise((resolve, reject) => {
            if (file.size > 5 * 1024 * 1024) {
                reject(new Error('Image too large (max 5MB)'));
                return;
            }

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();

            img.onload = () => {
                const MAX_WIDTH = 800;
                const MAX_HEIGHT = 600;

                let { width, height } = img;

                if (width > MAX_WIDTH) {
                    height = (height * MAX_WIDTH) / width;
                    width = MAX_WIDTH;
                }

                if (height > MAX_HEIGHT) {
                    width = (width * MAX_HEIGHT) / height;
                    height = MAX_HEIGHT;
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);

                const quality = 0.8;
                const base64 = canvas.toDataURL('image/jpeg', quality);
                URL.revokeObjectURL(img.src);
                resolve(base64);
            };

            img.onerror = () => {
                URL.revokeObjectURL(img.src);
                reject(new Error('Error loading image'));
            };
            img.src = URL.createObjectURL(file);
        });
    }

    /**
     * Cleans Quill HTML content to avoid empty paragraphs.
     * @private
     * @param {string} html - HTML content from Quill editor
     * @returns {string} Cleaned HTML content
     */
    _cleanQuillContent(html) {
        if (!html || html.trim() === '') return '';

        let cleaned = html.replace(/<p><br><\/p>/g, '');
        cleaned = cleaned.replace(/<p>\s*<\/p>/g, '');

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cleaned;
        const textContent = tempDiv.textContent || tempDiv.innerText || '';

        if (textContent.trim() === '') {
            return '';
        }

        return cleaned;
    }

    /**
     * Strips HTML tags from content for simple text display.
     * @private
     * @param {string} html - HTML string
     * @returns {string} Plain text
     */
    _stripHtml(html) {
        if (!html) return '';
        const temp = document.createElement('div');
        temp.innerHTML = html;
        return temp.textContent || temp.innerText || '';
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

        // Create attribute content using the new system
        if (this._uiManager && this._selectionManager) {
            const selectedFeatures = this._selectionManager.getAllSelectedFeatures();

            if (selectedFeatures.length > 0) {
                const content = await this._createFeaturePanelContent(selectedFeatures, featureType);
                if (content) {
                    contentWrapper.appendChild(content);
                }
            }
        }

        // Show in feature panel with fixed title
        this._featurePanel.show(contentWrapper, 'Detalhes da Feição');
    }

    /**
     * Creates feature panel content for selected features.
     * Uses the new component-based structure:
     * - Identification section
     * - Photo gallery
     * - Tabs (Estilo / Atributos)
     * - Location section
     * - Delete button
     * @private
     * @param {Array<Object>} selectedFeatures - Selected features
     * @param {string} featureType - Feature type
     * @returns {Promise<HTMLElement|null>}
     */
    async _createFeaturePanelContent(selectedFeatures, featureType) {
        if (!selectedFeatures || selectedFeatures.length === 0) return null;

        const control = this._selectionManager?.controls.get(featureType);
        const feature = selectedFeatures[0];
        const featureId = feature?.properties?.id;
        const isSingleSelection = selectedFeatures.length === 1;

        // Check if all selected features are the same type
        const types = new Set(selectedFeatures.map(f => f.properties?.source));
        const isMixedTypes = types.size > 1;

        // Main container
        const container = document.createElement('div');
        container.className = 'feature-panel-sections';

        // Array to store cleanup functions
        const cleanupFunctions = [];

        // 1. Identification section
        let identificationSection;
        if (isSingleSelection) {
            if (!control) {
                console.warn(`Control not found for type: ${featureType}`);
                return null;
            }
            identificationSection = await createFeatureIdentification({
                feature,
                featureType,
                selectedFeatures,
                selectionManager: this._selectionManager,
                uiManager: this._uiManager,
                onNameChange: (newName) => {
                    control.updateFeaturesProperty(selectedFeatures, 'nome', newName);
                    this._uiManager?.updateSelectionHighlight();
                }
            });
        } else {
            identificationSection = createMultiSelectionHeader({
                selectedFeatures,
                featureType,
                selectionManager: this._selectionManager,
                uiManager: this._uiManager
            });
        }
        container.appendChild(identificationSection);

        // 2. Photo gallery (only for single selection)
        if (isSingleSelection) {
            const photoGallery = await createPhotoGallery({
                featureId,
                featureType,
                compact: true
            });
            container.appendChild(photoGallery.element);
            cleanupFunctions.push(photoGallery.cleanup);
        }

        // 3. Info section before tabs (for LOS and similar analysis tools)
        if (isSingleSelection && control && typeof control.createInfoSection === 'function') {
            try {
                const infoSection = control.createInfoSection(selectedFeatures[0]);
                if (infoSection) {
                    container.appendChild(infoSection);
                }
            } catch (error) {
                console.error(`Error creating info section for ${featureType}:`, error);
            }
        }

        // 4. Tabs (Estilo / Parâmetros / Atributos) - only show for single selection or multiple same-type
        // For mixed types, show group type selector to edit by type
        if (!isMixedTypes) {
            const featureTabs = createFeatureTabs({
                featureId,
                featureType,
                singleSelection: isSingleSelection
            });
            container.appendChild(featureTabs.container);
            cleanupFunctions.push(featureTabs.cleanup);

            // Inject tool-specific style controls into the Style tab
            if (control && control.hasAttributePanel && control.hasAttributePanel()) {
                try {
                    control.createAttributePanel(
                        featureTabs.styleTab,
                        selectedFeatures,
                        this._selectionManager,
                        this._uiManager,
                        { hideHeader: true }
                    );
                } catch (error) {
                    console.error(`Error creating attribute panel for ${featureType}:`, error);
                }
            }

            // Inject parameters controls into Parameters tab (for LOS and similar tools)
            if (featureTabs.parametersTab && control && typeof control.createParametersPanel === 'function') {
                try {
                    control.createParametersPanel(
                        featureTabs.parametersTab,
                        selectedFeatures,
                        this._selectionManager,
                        this._uiManager
                    );
                } catch (error) {
                    console.error(`Error creating parameters panel for ${featureType}:`, error);
                }
            }
        } else {
            // Mixed types: show group type selector
            const typeTabsContainer = document.createElement('div');
            typeTabsContainer.className = 'group-type-tabs-container';

            // Track state for each type that was edited
            // Key: type, Value: { control, features, initialPropertiesMap }
            const editedTypesState = new Map();

            const typeSelector = createGroupTypeSelector({
                selectedFeatures,
                onTypeSelect: (selectedType, featuresOfType) => {
                    // Clear previous tabs content
                    typeTabsContainer.innerHTML = '';

                    // Get control for this type
                    const typeControl = this._selectionManager?.controls.get(selectedType);

                    // Store initial properties for this type if not already stored
                    if (!editedTypesState.has(selectedType)) {
                        editedTypesState.set(selectedType, {
                            control: typeControl,
                            features: featuresOfType,
                            initialPropertiesMap: new Map(
                                featuresOfType.map(f => [f.properties.id, { ...f.properties }])
                            )
                        });
                    }

                    // Create tabs for this type (multi-selection mode)
                    const typeTabs = createFeatureTabs({
                        featureId: featuresOfType[0]?.properties?.id,
                        featureType: selectedType,
                        singleSelection: false
                    });
                    typeTabsContainer.appendChild(typeTabs.container);

                    // Inject style controls for this type (hide buttons, we'll add global ones)
                    if (typeControl && typeControl.hasAttributePanel && typeControl.hasAttributePanel()) {
                        try {
                            typeControl.createAttributePanel(
                                typeTabs.styleTab,
                                featuresOfType,
                                this._selectionManager,
                                this._uiManager,
                                { hideHeader: true, hideButtons: true }
                            );
                        } catch (error) {
                            console.error(`Error creating attribute panel for ${selectedType}:`, error);
                        }
                    }
                }
            });

            container.appendChild(typeSelector.element);
            container.appendChild(typeTabsContainer);

            // Save all edited types function
            const saveAllEditedTypes = async () => {
                for (const [_type, state] of editedTypesState) {
                    const { control, features, initialPropertiesMap } = state;
                    if (control && typeof control.saveFeatures === 'function') {
                        await control.saveFeatures(features, initialPropertiesMap);
                    }
                }
            };

            // Discard all edited types function
            const discardAllEditedTypes = async () => {
                for (const [_type, state] of editedTypesState) {
                    const { control, features, initialPropertiesMap } = state;
                    if (control && typeof control.discardChangeFeatures === 'function') {
                        await control.discardChangeFeatures(features, initialPropertiesMap);
                    }
                }
            };

            // Create global Save/Discard buttons for all types
            const globalButtonsContainer = document.createElement('div');
            globalButtonsContainer.className = 'group-type-global-buttons';

            const globalButtonsRow = document.createElement('div');
            globalButtonsRow.className = 'attr-modern-buttons-row';

            const globalSaveButton = document.createElement('button');
            globalSaveButton.textContent = 'Salvar';
            globalSaveButton.className = 'group-type-btn-save';
            globalSaveButton.type = 'button';
            globalSaveButton.addEventListener('click', async () => {
                await saveAllEditedTypes();
                this._selectionManager?.deselectAllFeatures();
            });
            globalButtonsRow.appendChild(globalSaveButton);

            const globalDiscardButton = document.createElement('button');
            globalDiscardButton.textContent = 'Descartar';
            globalDiscardButton.className = 'group-type-btn-discard';
            globalDiscardButton.type = 'button';
            globalDiscardButton.addEventListener('click', async () => {
                await discardAllEditedTypes();
                this._selectionManager?.deselectAllFeatures();
            });
            globalButtonsRow.appendChild(globalDiscardButton);

            globalButtonsContainer.appendChild(globalButtonsRow);
            container.appendChild(globalButtonsContainer);

            // Cleanup: save all edited types before destroying
            cleanupFunctions.push(() => {
                // Save synchronously to avoid race conditions
                // Note: saveAllEditedTypes is async but we call it without await
                // since cleanup functions are called synchronously
                saveAllEditedTypes();
                typeSelector.cleanup();
            });
        }

        // 4. Location section (only for single selection)
        if (isSingleSelection && this._mapManager?.map) {
            const locationSection = await createLocationSection({
                feature,
                featureType,
                map: this._mapManager.map,
                control,
                uiManager: this._uiManager
            });
            container.appendChild(locationSection);
        }

        // 5. Delete button
        const deleteSection = document.createElement('div');
        deleteSection.className = 'feature-panel-delete-section';

        const deleteButton = document.createElement('button');
        deleteButton.className = 'feature-panel-delete-btn';
        const deleteLabel = isSingleSelection ? 'Deletar' : `Deletar ${selectedFeatures.length} feições`;
        deleteButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            ${deleteLabel}
        `;
        const confirmTitle = isSingleSelection
            ? 'Deletar esta feição?'
            : `Deletar ${selectedFeatures.length} feições?`;
        deleteButton.onclick = async () => {
            const confirmed = await showConfirm(confirmTitle, { destructive: true });
            if (confirmed) {
                this._selectionManager?.deleteSelectedFeatures();
            }
        };
        deleteSection.appendChild(deleteButton);
        container.appendChild(deleteSection);

        // Store cleanup function
        this._currentFeaturePanelCleanup = () => {
            cleanupFunctions.forEach(fn => {
                try {
                    fn();
                } catch (e) {
                    console.warn('Cleanup error:', e);
                }
            });
        };

        return container;
    }

    /**
     * Gets a display name for the feature.
     * @private
     * @param {string} featureId - Feature ID
     * @param {string} featureType - Feature type
     * @returns {string}
     */
    _getFeatureName(featureId, featureType) {
        // Try to get a meaningful name
        const typeNames = {
            'point': 'Ponto',
            'line': 'Linha',
            'polygon': 'Polígono',
            'circle': 'Círculo',
            'ellipse': 'Elipse',
            'rectangle': 'Retângulo',
            'text': 'Texto',
            'image': 'Imagem',
            'brush': 'Pincel',
            'arrow': 'Seta',
            'boundary': 'Limite',
            'occupied_front': 'Frente Ocupada',
            'military_symbol': 'Símbolo Militar',
            'coordination_measure': 'Medida de Coordenação',
            'los': 'Linha de Visada',
            'visibility': 'Visibilidade',
        };

        return typeNames[featureType] || 'Feição';
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
