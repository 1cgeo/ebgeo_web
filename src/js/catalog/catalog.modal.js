// Path: js/catalog/catalog.modal.js

/**
 * @fileoverview Main catalog modal.
 * Extends ModalBase with catalog-specific functionality.
 */

import { ModalBase } from '../modals/modal.base.js';
import { CatalogService } from './catalog.service.js';
import {
    CATALOG_ITEM_TYPES,
    CATALOG_TYPE_CONFIG,
    CATALOG_MODAL_ICON,
    CATALOG_MODAL_FILTERS
} from './catalog.constants.js';
import { createCatalogHeader } from './components/catalog-header.js';
import { createCatalogFilters } from './components/catalog-filters.js';
import { createCatalogGrid } from './components/catalog-grid.js';
import { getControl } from '../store';
// Note: Using literal 'camadas' to avoid circular dependency with sidebar/sidebar.constants.js
// SIDEBAR_TABS.CAMADAS === 'camadas'

/**
 * Catalog modal class.
 */
export class CatalogModal extends ModalBase {
    /**
     * @param {Object} dependencies
     * @param {Object} dependencies.toolManager - ToolManager instance
     * @param {Object} dependencies.map - MapLibre map instance
     * @param {Object} dependencies.eventBus - EventBus instance
     * @param {Object} [dependencies.stateManager] - StateManager instance
     */
    constructor(dependencies) {
        super({
            id: 'catalog-modal',
            title: 'Catálogo',
            icon: CATALOG_MODAL_ICON
        });

        this._toolManager = dependencies.toolManager;
        this._map = dependencies.map;
        this._eventBus = dependencies.eventBus;
        this._stateManager = dependencies.stateManager;

        // Internal state
        this._allItems = [];
        this._filteredItems = [];
        // Only include modal filters (analysis includes hillshade)
        this._activeFilters = new Set(CATALOG_MODAL_FILTERS);
        this._searchQuery = '';

        // DOM references
        this._searchInput = null;
        this._filtersContainer = null;
        this._gridContainer = null;
    }

    /**
     * Override render to add catalog-specific content.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();

        // Add specific class for wider modal
        this._container.classList.add('catalog-modal-container');

        const body = this.getBody();
        body.innerHTML = '';
        body.className = 'modal-body catalog-modal-body';

        // Layout: filters sidebar + main area
        const layout = document.createElement('div');
        layout.className = 'catalog-layout';

        // Filters sidebar
        this._filtersContainer = createCatalogFilters({
            types: CATALOG_TYPE_CONFIG,
            activeFilters: this._activeFilters,
            onFilterChange: (type, active) => this._handleFilterChange(type, active)
        });
        layout.appendChild(this._filtersContainer);

        // Main area
        const mainArea = document.createElement('div');
        mainArea.className = 'catalog-main';

        // Header with search
        const header = createCatalogHeader({
            onSearch: (query) => this._handleSearch(query)
        });
        this._searchInput = header.querySelector('input');
        mainArea.appendChild(header);

        // Cards grid
        this._gridContainer = document.createElement('div');
        this._gridContainer.className = 'catalog-grid-wrapper';
        mainArea.appendChild(this._gridContainer);

        layout.appendChild(mainArea);
        body.appendChild(layout);

        return overlay;
    }

    /**
     * Override show to load data.
     */
    show() {
        super.show();
        this._loadItems();

        // Focus search input
        requestAnimationFrame(() => {
            this._searchInput?.focus();
        });
    }

    /**
     * Override hide to clear state.
     */
    hide() {
        super.hide();
        this._searchQuery = '';
        if (this._searchInput) {
            this._searchInput.value = '';
        }
    }

    // === Private Methods ===

    /**
     * Loads catalog items.
     * @private
     */
    _loadItems() {
        this._allItems = CatalogService.getAllItems();
        this._applyFilters();
    }

    /**
     * Handles filter change.
     * @private
     * @param {string} type - Item type
     * @param {boolean} active - Active state
     */
    _handleFilterChange(type, active) {
        if (active) {
            this._activeFilters.add(type);
        } else {
            this._activeFilters.delete(type);
        }
        this._applyFilters();
    }

    /**
     * Handles search.
     * @private
     * @param {string} query - Search query
     */
    _handleSearch(query) {
        this._searchQuery = query;
        this._applyFilters();
    }

    /**
     * Applies filters and renders grid.
     * @private
     */
    _applyFilters() {
        // Filter by type
        // When ANALYSIS_LAYER filter is active, also include HILLSHADE
        let items = this._allItems.filter(item => {
            if (this._activeFilters.has(item.type)) {
                return true;
            }
            // Include hillshade when analysis filter is active
            if (item.type === CATALOG_ITEM_TYPES.HILLSHADE &&
                this._activeFilters.has(CATALOG_ITEM_TYPES.ANALYSIS_LAYER)) {
                return true;
            }
            return false;
        });

        // Filter by search
        if (this._searchQuery) {
            items = CatalogService.searchItems(this._searchQuery, items);
        }

        this._filteredItems = items;
        this._renderGrid();
    }

    /**
     * Renders the items grid.
     * @private
     */
    _renderGrid() {
        if (!this._gridContainer) return;

        this._gridContainer.innerHTML = '';

        const grid = createCatalogGrid({
            items: this._filteredItems,
            onItemClick: (item) => this._handleItemClick(item)
        });

        this._gridContainer.appendChild(grid);
    }

    /**
     * Handles item click.
     * @private
     * @param {CatalogItem} item
     */
    async _handleItemClick(item) {
        switch (item.type) {
            case CATALOG_ITEM_TYPES.MODEL_3D:
                await this._openModel3D(item);
                break;
            case CATALOG_ITEM_TYPES.PANORAMIC_360:
                await this._openPanoramic360(item);
                break;
            case CATALOG_ITEM_TYPES.HILLSHADE:
                await this._addHillshade(item);
                break;
            case CATALOG_ITEM_TYPES.ANALYSIS_LAYER:
                await this._addAnalysisLayer(item);
                break;
            case CATALOG_ITEM_TYPES.DATA_LAYER:
                await this._addDataLayer(item);
                break;
        }

        this.hide();
    }

    /**
     * Opens a 3D model directly in the 3D viewer.
     * Activates the viewer tool (enabling markers) and opens the 3D viewer immediately.
     * @private
     * @param {CatalogItem} item
     */
    async _openModel3D(item) {
        const modelsViewerControl = getControl('modelsViewer');
        if (modelsViewerControl) {
            // Activate the tool to enable markers if not already active
            if (!modelsViewerControl.isActive && this._toolManager?.toggleViewer) {
                this._toolManager.toggleViewer(modelsViewerControl);
            }

            // Open the 3D viewer directly
            if (modelsViewerControl.openViewer) {
                await modelsViewerControl.openViewer(item.originalData.id);
            }
        }
    }

    /**
     * Opens a 360 panoramic image.
     * Uses the navigateToStreetViewMarker method which:
     * 1. Activates the street view tool if not active
     * 2. Flies to the location
     * 3. Opens the preview popup
     * @private
     * @param {CatalogItem} item
     */
    async _openPanoramic360(item) {
        const streetViewControl = getControl('streetView');
        if (streetViewControl?.navigateToStreetViewMarker) {
            await streetViewControl.navigateToStreetViewMarker(item.originalData.id);
        }
    }

    /**
     * Adds hillshade layer.
     * @private
     * @param {CatalogItem} item
     */
    async _addHillshade(item) {
        // Emit event to add hillshade
        this._eventBus.emit('CATALOG_ADD_LAYER', {
            type: CATALOG_ITEM_TYPES.HILLSHADE,
            item: item
        });

        // Open the layers sidebar tab to show the added layer
        if (this._stateManager) {
            this._stateManager.expandSidebar('camadas');
        }
    }

    /**
     * Adds analysis layer.
     * @private
     * @param {CatalogItem} item
     */
    async _addAnalysisLayer(item) {
        // Emit event to add analysis layer
        this._eventBus.emit('CATALOG_ADD_LAYER', {
            type: CATALOG_ITEM_TYPES.ANALYSIS_LAYER,
            item: item
        });

        // Open the layers sidebar tab to show the added layer
        if (this._stateManager) {
            this._stateManager.expandSidebar('camadas');
        }

        // Zoom to bounds if available
        if (item.location?.bounds) {
            const [west, south, east, north] = item.location.bounds;
            this._map.fitBounds([[west, south], [east, north]], {
                padding: 50,
                duration: 1000
            });
        }
    }

    /**
     * Adds data layer (molduras, etc.).
     * @private
     * @param {CatalogItem} item
     */
    async _addDataLayer(item) {
        // Emit event to add data layer
        this._eventBus.emit('CATALOG_ADD_LAYER', {
            type: CATALOG_ITEM_TYPES.DATA_LAYER,
            item: item
        });

        // Open the layers sidebar tab to show the added layer
        if (this._stateManager) {
            this._stateManager.expandSidebar('camadas');
        }
    }
}
