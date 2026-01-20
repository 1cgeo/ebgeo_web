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
    cleanup,
    removeElement
} from '../utilities/event-cleanup.js';
import { createTabbedAttributePanel, injectTabbedPanelStyles } from '../tool_manager/tabbed_attribute_panel.js';
import { renderAttributesContent } from '../user_data/attributes_tab_renderer.js';
import { renderImagesContent } from '../user_data/images_tab_renderer.js';

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
     * @private
     */
    _handleFeaturePanelClose() {
        // Clear selection when closing feature panel
        if (this._selectionManager) {
            this._selectionManager.deselectAllFeatures();
        }
        this._stateManager.closeFeaturePanel();
    }

    /**
     * Handles recent map shortcut click.
     * @private
     * @param {string} mapName - Map name to switch to
     */
    async _handleRecentMapClick(mapName) {
        try {
            // Dynamic import to avoid circular dependencies
            const { setCurrentMap, getCurrentMapName } = await import('../store/index.js');

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
        // Hide feature panel when sidebar expands
        this._featurePanel.hide();
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
        this._featurePanel.hide();
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
     * Shows feature content in the feature panel.
     * @private
     * @param {string} featureId - Feature ID
     * @param {string} featureType - Feature type (source)
     */
    _showFeatureContent(featureId, featureType) {
        // Cleanup previous content
        this._cleanupFeaturePanelContent();

        // Get the feature panel content from UIManager
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'feature-panel-wrapper';

        // Create attribute content using the existing system
        if (this._uiManager && this._selectionManager) {
            const selectedFeatures = this._selectionManager.getAllSelectedFeatures();

            if (selectedFeatures.length > 0) {
                const content = this._createFeaturePanelContent(selectedFeatures, featureType);
                if (content) {
                    contentWrapper.appendChild(content);
                }
            }
        }

        // Get feature name for title
        const featureName = this._getFeatureName(featureId, featureType);

        // Show in feature panel
        this._featurePanel.show(contentWrapper, featureName);
    }

    /**
     * Creates feature panel content for selected features.
     * @private
     * @param {Array<Object>} selectedFeatures - Selected features
     * @param {string} featureType - Feature type
     * @returns {HTMLElement|null}
     */
    _createFeaturePanelContent(selectedFeatures, featureType) {
        if (!selectedFeatures || selectedFeatures.length === 0) return null;

        const control = this._selectionManager?.controls.get(featureType);
        if (!control) {
            console.warn(`Control not found for type: ${featureType}`);
            return null;
        }

        const featureId = selectedFeatures[0]?.properties?.id;
        const isSingleSelection = selectedFeatures.length === 1;

        // Create tabbed panel with all three tabs
        const tabbedPanel = createTabbedAttributePanel(
            {
                featureId,
                featureType,
                control,
                singleSelection: isSingleSelection
            },
            renderAttributesContent,
            renderImagesContent
        );

        // Create the attribute panel content using the control in the properties tab
        if (control.hasAttributePanel && control.hasAttributePanel()) {
            try {
                control.createAttributePanel(
                    tabbedPanel.propertiesTab,
                    selectedFeatures,
                    this._selectionManager,
                    this._uiManager
                );
            } catch (error) {
                console.error(`Error creating attribute panel for ${featureType}:`, error);
            }
        }

        // Create wrapper with tabbed panel and delete button
        const container = document.createElement('div');
        container.className = 'sidebar-feature-content';
        container.appendChild(tabbedPanel.container);

        // Add delete button
        const deleteButton = document.createElement('button');
        deleteButton.className = 'sidebar-delete-button';
        deleteButton.textContent = 'Deletar';
        deleteButton.onclick = () => {
            this._selectionManager?.deleteSelectedFeatures();
        };
        container.appendChild(deleteButton);

        // Store cleanup function
        this._currentFeaturePanelCleanup = () => {
            tabbedPanel.cleanup();
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
    }

    /**
     * Expands the panel to show the specified tab.
     * @private
     * @param {string} tabId - Tab to show
     */
    _expandToTab(tabId) {
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
        this._collapsedSidebar.setActiveTab(null);
        this._panel.collapse();
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
            // Dynamic import to avoid circular dependencies
            const { getAllMapNamesStore, getCurrentMapName, getMapOrder } = await import('../store/index.js');
            const allMaps = await getAllMapNamesStore();
            const currentMap = await getCurrentMapName();
            const savedOrder = await getMapOrder();

            // Sort maps: use saved order if available, otherwise current map first then alphabetically
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
                // Fallback: current map first, then alphabetically
                sortedMaps = [...allMaps].sort((a, b) => {
                    if (a === currentMap) return -1;
                    if (b === currentMap) return 1;
                    return a.localeCompare(b);
                });
            }

            // Create map objects with isActive flag
            const recentMaps = sortedMaps.map(name => ({
                name,
                thumbnail: null,
                isActive: name === currentMap,
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
