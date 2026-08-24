// Path: js/catalog/catalog.modal.js

/**
 * @fileoverview Main catalog modal.
 * Extends ModalBase with catalog-specific functionality.
 */

import { getControl, isCurrentMapLockedSync } from '@store';
import { EventTypes } from '@events/event_types.js';
import { subscribe } from '@utils/event-cleanup.js';
import { ModalBase } from '@modals/modal.base.js';
import { CatalogService, sortByDateDesc } from './catalog.service.js';
import {
    CATALOG_ITEM_TYPES,
    CATALOG_TYPE_CONFIG,
    CATALOG_MODAL_FILTERS,
    CATALOG_MODAL_ICON
} from './catalog.constants.js';
import { createCatalogHeader } from './components/catalog-header.js';
import { createCatalogFilters, updateFilterCounts } from './components/catalog-filters.js';
import { createCatalogGrid } from './components/catalog-grid.js';
import { resourceAccessRefOf } from './components/catalog-card.js';
import { showResourceShareModal } from './resource-share.modal.js';
// Pelo ARQUIVO: a definicao unica da porta de administracao, para o rotulo nao divergir do que
// a barra da conta usa. Ambos sao folhas de zero imports.
import { adminAudience } from '@js/admin/admin-audience.js';
import { sessionContext } from '@store/sync/session-context.js';

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
        // Start with no filters active — show all items by default
        this._activeFilters = new Set();
        this._searchQuery = '';

        // DOM references
        this._searchInput = null;
        this._filtersContainer = null;
        this._gridContainer = null;

        // Re-load when a Gestor restricts availability for the connected atlas (basemaps / data /
        // analysis / features): the catalog reads the now-filtered config and hides what the atlas
        // no longer allows. Guarded on _gridContainer so it's a no-op before the modal is rendered.
        // Tracked via subscribe (setupCleanup ran in ModalBase) so destroy() removes the listener.
        subscribe(this, this._eventBus, EventTypes.ATLAS_SETTINGS_CHANGED, () => {
            if (this._gridContainer) this._loadItems();
        });
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

        // A PORTA PARA MANTER O ACERVO, para quem tem uma.
        //
        // O produtor encontra aqui o recurso que ele MANTÉM e não tem como ir editá-lo: a aba
        // Catálogo vive na outra ponta do aplicativo, e ele reencontra o item pelo nome. O cartão
        // não pode dizer QUAL é da OM dele (o documento de `/api/config` é público, e carregar a
        // OM dona nele exporia a estrutura de manutenção do acervo a qualquer visitante), então o
        // que se conserta é a NAVEGAÇÃO, não o payload.
        //
        // O rótulo vem de `adminAudience`, e não de uma string escrita aqui, para não divergir do
        // que a barra da conta chama a mesma porta.
        const porta = adminAudience({
            isAuthenticated: sessionContext.isAuthenticated(),
            isAdmin: sessionContext.isAdmin(),
            isProducer: sessionContext.isProducer(),
        }).label;
        if (porta) {
            const rodape = document.createElement('div');
            rodape.className = 'catalog-footer';
            const link = document.createElement('a');
            link.className = 'catalog-footer__link';
            link.href = './admin.html';
            link.dataset.testid = 'catalog-manage-link';
            link.textContent = `Manter o acervo em ${porta}`;
            rodape.appendChild(link);
            body.appendChild(rodape);
        }

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
    async _loadItems() {
        this._allItems = await CatalogService.getAllItems();
        updateFilterCounts(this._filtersContainer, this._computeFilterCounts());
        this._applyFilters();
    }

    /**
     * Computes item counts per filter type.
     * Includes hillshade count in the analysis filter and first-person scenes in
     * the 3D models filter, matching what each filter actually shows.
     * @private
     * @returns {Object<string, number>}
     */
    _computeFilterCounts() {
        const counts = {};

        CATALOG_MODAL_FILTERS.forEach(type => {
            let count = this._allItems.filter(item => item.type === type).length;

            // Include hillshade in analysis count
            if (CATALOG_TYPE_CONFIG[type]?.includesHillshade) {
                count += this._allItems.filter(item => item.type === CATALOG_ITEM_TYPES.HILLSHADE).length;
            }

            // Include first-person scenes in the 3D models count
            if (CATALOG_TYPE_CONFIG[type]?.includesFirstPerson) {
                count += this._allItems.filter(
                    item => item.type === CATALOG_ITEM_TYPES.FIRST_PERSON_SCENE
                ).length;
            }

            counts[type] = count;
        });

        return counts;
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
        // No filters active → show all items; active filters → show only matching types
        let items = this._activeFilters.size === 0
            ? this._allItems
            : this._allItems.filter(item => {
                if (this._activeFilters.has(item.type)) {
                    return true;
                }
                // Include hillshade when analysis filter is active
                if (item.type === CATALOG_ITEM_TYPES.HILLSHADE &&
                    this._activeFilters.has(CATALOG_ITEM_TYPES.ANALYSIS_LAYER)) {
                    return true;
                }
                // Include first-person scenes when the 3D models filter is active
                if (item.type === CATALOG_ITEM_TYPES.FIRST_PERSON_SCENE &&
                    this._activeFilters.has(CATALOG_ITEM_TYPES.MODEL_3D)) {
                    return true;
                }
                return false;
            });

        // Filter by search
        if (this._searchQuery) {
            items = CatalogService.searchItems(this._searchQuery, items);
        }

        // Guarantee the grid is ALWAYS date-descending, with or without type
        // filters or search, so opening the catalog shows the newest products
        // first. Filtering preserves order, but re-applying the authoritative
        // sort here keeps the guarantee even if the filter logic changes later.
        this._filteredItems = sortByDateDesc(items);
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
            onItemClick: (item) => this._handleItemClick(item),
            mapLocked: isCurrentMapLockedSync(),
            onShare: (item) => this._handleShare(item)
        });

        this._gridContainer.appendChild(grid);
    }

    /**
     * Abre o modal de compartilhamento de um recurso privado.
     *
     * O CATÁLOGO NÃO FECHA, ao contrário do clique que abre o item: compartilhar
     * não leva a lugar nenhum, e fechar a grade obrigaria a reabri-la e a refiltrar
     * para ceder o próximo. Quem decide se a ação existe é o cartão
     * (`canShareResource`); quem decide se ela vale é o servidor.
     * @private
     * @param {CatalogItem} item
     */
    _handleShare(item) {
        const acesso = resourceAccessRefOf(item);
        if (!acesso) return;
        showResourceShareModal({
            resourceType: acesso.tipo,
            resourceId: acesso.id,
            resourceName: item.name,
        });
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
            case CATALOG_ITEM_TYPES.FIRST_PERSON_SCENE:
                await this._openFirstPersonScene(item);
                break;
            case CATALOG_ITEM_TYPES.PANORAMIC_360:
                await this._openPanoramic360(item);
                break;
            case CATALOG_ITEM_TYPES.HILLSHADE:
            case CATALOG_ITEM_TYPES.ANALYSIS_LAYER:
            case CATALOG_ITEM_TYPES.DATA_LAYER:
                await this._addCatalogLayer(item);
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
     * Opens a first-person scene in the walk-through viewer.
     *
     * The viewer module carries the Gaussian-splatting runtime, so it is only
     * pulled in on demand, the same lazy pattern the 360 viewer uses here. It
     * needs no map control and no tool toggle: the scene replaces the map view
     * and persists nothing.
     * @private
     * @param {CatalogItem} item
     */
    async _openFirstPersonScene(item) {
        this.hide();

        try {
            const { openFirstPersonViewer } = await import(
                '@js/first_person_3d_tool/first_person_viewer.js'
            );
            await openFirstPersonViewer(item.originalData.id);
        } catch (error) {
            console.error('Error opening first-person viewer from catalog:', error);
        }
    }

    /**
     * Opens a 360 panoramic image directly with the project's entry photo.
     * Opens the viewer without requiring the street view tool to be active
     * (the tool toggle controls 2D map overlays, not the 360 viewer).
     * @private
     * @param {CatalogItem} item
     */
    async _openPanoramic360(item) {
        const project = item.originalData;
        const photoId = project.entryPhotoId;
        if (!photoId) {
            console.warn('Project has no entry photo:', project.id);
            return;
        }

        this.hide();

        try {
            const { openViewer360WithPhoto } = await import(
                '../street_view_tool/street_view_viewer.js'
            );
            const streetViewControl = getControl('streetView');

            await openViewer360WithPhoto(photoId, {
                miniMap: streetViewControl?.miniMap,
                controlInstance: streetViewControl
            });

            if (streetViewControl) {
                streetViewControl.isOpen = true;
            }
        } catch (error) {
            console.error('Error opening 360 viewer from catalog:', error);
        }
    }

    /**
     * Adds a catalog layer (hillshade, analysis, or data) and opens the layers tab.
     * @private
     * @param {CatalogItem} item
     */
    async _addCatalogLayer(item) {
        this._eventBus.emit(EventTypes.CATALOG_ADD_LAYER, {
            type: item.type,
            item
        });

        if (this._stateManager) {
            this._stateManager.expandSidebar('camadas');
        }

        if (item.location?.bounds) {
            const [west, south, east, north] = item.location.bounds;
            this._map.fitBounds([[west, south], [east, north]], {
                padding: 50,
                duration: 1000
            });
        }
    }
}
