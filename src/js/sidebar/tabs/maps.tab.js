// Path: js/sidebar/tabs/maps.tab.js

/**
 * @fileoverview Maps tab component for sidebar.
 * Provides map management functionality: create, open, save, delete, duplicate.
 */

import Sortable from 'sortablejs';
import { SIDEBAR_ICONS } from '../sidebar.constants.js';
import {
    setupCleanup,
    addDomListener,
    subscribe,
    cleanup,
    removeElement
} from '../../utilities/event-cleanup.js';
import {
    getAllMapNamesStore,
    getCurrentMapName,
    setCurrentMap,
    getMapDataStore,
    clearAllDataStore,
    setMapOrder,
    getMapOrder,
    getLayers,
} from '../../store/index.js';
import { EventTypes } from '../../events/event_types.js';
import { showSuccess, showError, showWarning } from '../../utilities/index.js';

/**
 * Icons specific to maps tab.
 */
const MAPS_ICONS = {
    plusCircle: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,

    folderOpen: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,

    save: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,

    trash2: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,

    copy: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,

    mapIcon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`,

    grip: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>`,
};

/**
 * Maps tab component.
 */
export class MapsTab {
    /**
     * @param {Object} dependencies - Required dependencies
     * @param {Object} dependencies.mapManager - MapManager instance
     * @param {Object} dependencies.baseLayerControl - BaseLayerControl instance
     * @param {Object} dependencies.eventBus - EventBus instance
     * @param {Object} dependencies.exportImportService - ExportImportService instance
     */
    constructor(dependencies) {
        this._mapManager = dependencies.mapManager;
        this._baseLayerControl = dependencies.baseLayerControl;
        this._eventBus = dependencies.eventBus;
        this._exportImportService = dependencies.exportImportService;

        this._container = null;
        this._mapsList = null;
        this._currentMapCard = null;
        this._currentMapName = null;
        this._sortableInstance = null;

        setupCleanup(this);
    }

    /**
     * Creates the tab UI.
     * @returns {HTMLElement}
     */
    render() {
        this._container = document.createElement('div');
        this._container.className = 'sidebar-tab-content maps-tab';

        // Actions grid
        const actionsGrid = this._createActionsGrid();
        this._container.appendChild(actionsGrid);

        // Current map card
        this._currentMapCard = this._createCurrentMapCard();
        this._container.appendChild(this._currentMapCard);

        // Section header
        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'sidebar-section-header';
        sectionHeader.textContent = 'Todos os Mapas';
        this._container.appendChild(sectionHeader);

        // Maps list
        this._mapsList = document.createElement('div');
        this._mapsList.className = 'maps-list';
        this._container.appendChild(this._mapsList);

        // Setup event listeners
        this._setupEventListeners();

        // Load initial data
        this._loadMaps();

        return this._container;
    }

    /**
     * Creates the actions grid (Novo, Abrir, Salvar, Limpar).
     * @private
     * @returns {HTMLElement}
     */
    _createActionsGrid() {
        const grid = document.createElement('div');
        grid.className = 'sidebar-actions-grid';

        const actions = [
            { id: 'new', icon: MAPS_ICONS.plusCircle, label: 'Novo', handler: () => this._handleNewMap() },
            { id: 'open', icon: MAPS_ICONS.folderOpen, label: 'Abrir', handler: () => this._handleOpenProject() },
            { id: 'save', icon: MAPS_ICONS.save, label: 'Salvar', handler: () => this._handleSaveProject() },
            { id: 'clear', icon: MAPS_ICONS.trash2, label: 'Limpar Tudo', handler: () => this._handleClearAll() },
        ];

        actions.forEach(action => {
            const button = document.createElement('button');
            button.className = 'sidebar-action-btn';
            button.id = `maps-action-${action.id}`;
            button.innerHTML = `${action.icon}<span>${action.label}</span>`;

            addDomListener(this, button, 'click', action.handler);
            grid.appendChild(button);
        });

        return grid;
    }

    /**
     * Creates the current map card.
     * @private
     * @returns {HTMLElement}
     */
    _createCurrentMapCard() {
        const card = document.createElement('div');
        card.className = 'current-map-card';

        card.innerHTML = `
            <div class="current-map-header">
                <div class="current-map-icon">
                    ${MAPS_ICONS.mapIcon}
                </div>
                <div class="current-map-info">
                    <div class="current-map-name">
                        <input type="text" id="current-map-name-input" value="" placeholder="Nome do mapa">
                    </div>
                    <div class="current-map-stats" id="current-map-stats">
                        0 feicoes - 1 camada
                    </div>
                </div>
            </div>
        `;

        // Setup name input handler
        const nameInput = card.querySelector('#current-map-name-input');
        addDomListener(this, nameInput, 'blur', () => this._handleRenameCurrentMap(nameInput.value));
        addDomListener(this, nameInput, 'keydown', (e) => {
            if (e.key === 'Enter') {
                nameInput.blur();
            }
        });

        return card;
    }

    /**
     * Sets up event listeners for map changes.
     * @private
     */
    _setupEventListeners() {
        subscribe(this, this._eventBus, EventTypes.LAYERS_CHANGED, () => this._loadMaps());
    }

    /**
     * Loads and renders the maps list.
     * @private
     */
    async _loadMaps() {
        try {
            const allMapNames = await getAllMapNamesStore();
            this._currentMapName = await getCurrentMapName();

            // Update current map card
            this._updateCurrentMapCard();

            // Render maps list
            this._renderMapsList(allMapNames);

        } catch (_error) {
            console.error('Error loading maps:', _error);
        }
    }

    /**
     * Updates the current map card.
     * @private
     */
    async _updateCurrentMapCard() {
        const nameInput = this._currentMapCard.querySelector('#current-map-name-input');
        if (nameInput && this._currentMapName) {
            nameInput.value = this._currentMapName;
        }

        await this._updateCurrentMapStats();
    }

    /**
     * Updates the current map statistics.
     * @private
     */
    async _updateCurrentMapStats() {
        const statsEl = this._currentMapCard.querySelector('#current-map-stats');
        if (!statsEl || !this._currentMapName) return;

        try {
            const mapData = await getMapDataStore(this._currentMapName);
            let featureCount = 0;
            let layerCount = 1;

            if (mapData?.features) {
                Object.values(mapData.features).forEach(features => {
                    if (Array.isArray(features)) {
                        featureCount += features.length;
                    }
                });
            }

            // Get layers from store
            const layers = await getLayers();
            layerCount = layers?.length || 1;

            statsEl.textContent = `${featureCount} feicoes - ${layerCount} ${layerCount === 1 ? 'camada' : 'camadas'}`;
        } catch (_error) {
            statsEl.textContent = '0 feicoes - 1 camada';
        }
    }

    /**
     * Renders the maps list.
     * @private
     * @param {string[]} mapNames - Array of map names
     */
    async _renderMapsList(mapNames) {
        this._mapsList.innerHTML = '';

        // Get map order
        const order = await getMapOrder();

        // Sort maps by order if available
        const sortedMaps = order?.length > 0
            ? order.filter(name => mapNames.includes(name))
            : mapNames;

        // Add any maps not in order
        mapNames.forEach(name => {
            if (!sortedMaps.includes(name)) {
                sortedMaps.push(name);
            }
        });

        sortedMaps.forEach(mapName => {
            const item = this._createMapListItem(mapName);
            this._mapsList.appendChild(item);
        });

        // Initialize sortable
        this._initSortable();
    }

    /**
     * Creates a map list item.
     * @private
     * @param {string} mapName - Map name
     * @returns {HTMLElement}
     */
    _createMapListItem(mapName) {
        const isSelected = mapName === this._currentMapName;

        const item = document.createElement('div');
        item.className = 'map-list-item';
        item.dataset.mapName = mapName;
        item.dataset.selected = isSelected.toString();

        item.innerHTML = `
            <div class="map-list-drag-handle" title="Arrastar para reordenar">
                ${MAPS_ICONS.grip}
            </div>
            <div class="map-list-icon">
                ${MAPS_ICONS.mapIcon}
            </div>
            <div class="map-list-info">
                <div class="map-list-name">${this._escapeHtml(mapName)}</div>
                <div class="map-list-meta">${isSelected ? 'Mapa atual' : ''}</div>
            </div>
            <div class="map-list-actions">
                <button class="map-list-action-btn copy-btn" title="Duplicar">
                    ${MAPS_ICONS.copy}
                </button>
                <button class="map-list-action-btn delete delete-btn" title="Deletar">
                    ${SIDEBAR_ICONS.trash}
                </button>
            </div>
        `;

        // Click to select
        addDomListener(this, item, 'click', (e) => {
            if (!e.target.closest('.map-list-action-btn') && !e.target.closest('.map-list-drag-handle')) {
                this._handleSelectMap(mapName);
            }
        });

        // Duplicate button
        const copyBtn = item.querySelector('.copy-btn');
        addDomListener(this, copyBtn, 'click', (e) => {
            e.stopPropagation();
            this._handleDuplicateMap(mapName);
        });

        // Delete button
        const deleteBtn = item.querySelector('.delete-btn');
        addDomListener(this, deleteBtn, 'click', (e) => {
            e.stopPropagation();
            this._handleDeleteMap(mapName);
        });

        return item;
    }

    /**
     * Initializes sortable for drag-and-drop reordering.
     * @private
     */
    _initSortable() {
        if (this._sortableInstance) {
            this._sortableInstance.destroy();
        }

        this._sortableInstance = Sortable.create(this._mapsList, {
            animation: 150,
            handle: '.map-list-drag-handle',
            ghostClass: 'sortable-ghost',
            onEnd: async () => {
                const newOrder = Array.from(this._mapsList.children)
                    .map(el => el.dataset.mapName)
                    .filter(Boolean);

                await setMapOrder(newOrder);

                // Emit event to update recent maps in sidebar
                this._eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
            }
        });
    }

    /**
     * Handles creating a new map.
     * @private
     */
    async _handleNewMap() {
        const mapName = prompt('Nome do novo mapa:');
        if (!mapName || !mapName.trim()) return;

        try {
            const result = await this._mapManager.createMap(mapName.trim());
            if (result.success) {
                showSuccess(result.message);
                this._loadMaps();
                // Emit event to update recent maps in sidebar
                this._eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
            } else {
                showWarning(result.message);
            }
        } catch (_error) {
            showError('Erro ao criar mapa');
        }
    }

    /**
     * Handles opening a project file.
     * @private
     */
    _handleOpenProject() {
        if (this._exportImportService) {
            // Trigger file input
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.ebgeo';
            fileInput.onchange = async (e) => {
                if (e.target.files[0]) {
                    await this._exportImportService.processFileDirectly(e.target.files[0], false);
                    this._loadMaps();
                }
            };
            fileInput.click();
        }
    }

    /**
     * Handles saving the project.
     * @private
     */
    async _handleSaveProject() {
        if (this._exportImportService) {
            await this._exportImportService.handleExport();
        }
    }

    /**
     * Handles clearing all data.
     * @private
     */
    async _handleClearAll() {
        const confirmed = confirm(
            'Tem certeza que deseja limpar TODOS os dados?\n\n' +
            'Esta acao ira:\n' +
            '- Deletar todos os mapas\n' +
            '- Remover todas as feicoes\n' +
            '- Esta acao NAO pode ser desfeita!'
        );

        if (!confirmed) return;

        try {
            await clearAllDataStore();
            showSuccess('Todos os dados foram limpos');

            // Reload map
            if (this._baseLayerControl) {
                await this._baseLayerControl.switchMap();
            }

            this._loadMaps();
        } catch (_error) {
            showError('Erro ao limpar dados');
        }
    }

    /**
     * Handles renaming the current map.
     * @private
     * @param {string} newName - New map name
     */
    async _handleRenameCurrentMap(newName) {
        if (!newName || !newName.trim() || newName.trim() === this._currentMapName) {
            return;
        }

        try {
            const result = await this._mapManager.renameMap(this._currentMapName, newName.trim());
            if (result.success) {
                showSuccess(result.message);
                this._loadMaps();
            } else {
                showWarning(result.message);
                // Revert input
                const nameInput = this._currentMapCard.querySelector('#current-map-name-input');
                if (nameInput) {
                    nameInput.value = this._currentMapName;
                }
            }
        } catch (_error) {
            showError('Erro ao renomear mapa');
        }
    }

    /**
     * Handles selecting a map.
     * @private
     * @param {string} mapName - Map to select
     */
    async _handleSelectMap(mapName) {
        if (mapName === this._currentMapName) return;

        try {
            await setCurrentMap(mapName);

            if (this._baseLayerControl) {
                await this._baseLayerControl.switchMap();
            }

            this._loadMaps();
        } catch (_error) {
            showError('Erro ao selecionar mapa');
        }
    }

    /**
     * Handles duplicating a map.
     * @private
     * @param {string} mapName - Map to duplicate
     */
    async _handleDuplicateMap(mapName) {
        const newName = prompt('Nome para o novo mapa:', `${mapName}_copia`);
        if (!newName || !newName.trim()) return;

        try {
            const result = await this._mapManager.copyMap(mapName, newName.trim());
            if (result.success) {
                showSuccess(result.message);
                this._loadMaps();
            } else {
                showWarning(result.message);
            }
        } catch (_error) {
            showError('Erro ao duplicar mapa');
        }
    }

    /**
     * Handles deleting a map.
     * @private
     * @param {string} mapName - Map to delete
     */
    async _handleDeleteMap(mapName) {
        const confirmed = confirm(`Tem certeza que deseja deletar o mapa "${mapName}"?`);
        if (!confirmed) return;

        try {
            const result = await this._mapManager.deleteMap(mapName);
            if (result.success) {
                showSuccess(result.message);
                this._loadMaps();
            } else {
                showWarning(result.message);
            }
        } catch (_error) {
            showError('Erro ao deletar mapa');
        }
    }

    /**
     * Escapes HTML special characters.
     * @private
     * @param {string} str - String to escape
     * @returns {string}
     */
    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Gets the container element.
     * @returns {HTMLElement|null}
     */
    getContainer() {
        return this._container;
    }

    /**
     * Refreshes the tab content.
     */
    refresh() {
        this._loadMaps();
    }

    /**
     * Destroys the component.
     */
    destroy() {
        if (this._sortableInstance) {
            this._sortableInstance.destroy();
            this._sortableInstance = null;
        }

        cleanup(this);
        removeElement(this._container);
        this._container = null;
    }
}
