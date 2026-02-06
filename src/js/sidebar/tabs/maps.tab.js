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
    hasMapSavedPosition,
    hasMapNotes,
    isMapLocked,
    toggleMapLock,
} from '../../store/index.js';
import { EventTypes } from '../../events/event_types.js';
import { showSuccess, showError, showWarning, IDUtils } from '../../utilities/index.js';
import { showPrompt, showConfirm } from '../../modals/index.js';

/**
 * Icons specific to maps tab.
 */
const MAPS_ICONS = {
    plusCircle: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,

    folderOpen: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,

    folderPlus: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>`,

    save: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,

    trash2: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,

    copy: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,

    mapIcon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`,

    grip: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>`,

    moreVertical: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>`,

    mapPin: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,

    fileText: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,

    merge: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/><path d="M16 6h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`,

    move: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`,

    edit: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,

    plus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,

    lock: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,

    lockOpen: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`,
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
        this._isLoadingMaps = false;

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

        // Section header with new map button
        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'sidebar-section-header sidebar-section-header-with-action';

        const headerText = document.createElement('span');
        headerText.textContent = 'Todos os Mapas';
        sectionHeader.appendChild(headerText);

        const newMapBtn = document.createElement('button');
        newMapBtn.className = 'sidebar-section-header-btn';
        newMapBtn.title = 'Novo mapa';
        newMapBtn.innerHTML = MAPS_ICONS.plus;
        addDomListener(this, newMapBtn, 'click', () => this._handleNewMap());
        sectionHeader.appendChild(newMapBtn);

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
     * Creates the actions grid (Abrir, Importar, Salvar, Limpar Tudo).
     * @private
     * @returns {HTMLElement}
     */
    _createActionsGrid() {
        const grid = document.createElement('div');
        grid.className = 'sidebar-actions-grid';

        const actions = [
            { id: 'open', icon: MAPS_ICONS.folderOpen, label: 'Abrir', handler: () => this._handleOpenProject(), title: 'Abrir projeto (substitui atual)' },
            { id: 'import', icon: MAPS_ICONS.folderPlus, label: 'Importar', handler: () => this._handleImportAdditive(), title: 'Importar e adicionar ao projeto atual' },
            { id: 'save', icon: MAPS_ICONS.save, label: 'Salvar', handler: () => this._handleSaveProject(), title: 'Salvar projeto' },
            { id: 'clear', icon: MAPS_ICONS.trash2, label: 'Limpar Tudo', handler: () => this._handleClearAll(), title: 'Limpar todos os dados' },
        ];

        actions.forEach(action => {
            const button = document.createElement('button');
            button.className = 'sidebar-action-btn';
            button.id = `maps-action-${action.id}`;
            button.innerHTML = `${action.icon}<span>${action.label}</span>`;
            button.title = action.title;

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
                <div class="current-map-badge" id="current-map-badge">
                    M
                </div>
                <div class="current-map-info">
                    <div class="current-map-name">
                        <input type="text" id="current-map-name-input" value="" placeholder="Nome do mapa">
                    </div>
                    <div class="current-map-stats" id="current-map-stats">
                        0 feições - 1 camada
                    </div>
                </div>
                <button class="current-map-lock-btn" id="current-map-lock-btn" title="Bloquear mapa" data-locked="false">
                    ${MAPS_ICONS.lockOpen}
                </button>
                <button class="current-map-notes-btn" id="current-map-notes-btn" title="Notas do mapa">
                    ${MAPS_ICONS.fileText}
                </button>
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

        // Setup lock button handler
        const lockBtn = card.querySelector('#current-map-lock-btn');
        addDomListener(this, lockBtn, 'click', () => this._handleToggleLock());

        // Setup notes button handler
        const notesBtn = card.querySelector('#current-map-notes-btn');
        addDomListener(this, notesBtn, 'click', () => this._handleShowCurrentMapNotes());

        return card;
    }

    /**
     * Handles toggling map lock.
     * @private
     */
    async _handleToggleLock() {
        if (!this._currentMapName) return;

        const newState = await toggleMapLock(this._currentMapName);
        if (newState) {
            showWarning('Mapa bloqueado');
        } else {
            showSuccess('Mapa desbloqueado');
        }
    }

    /**
     * Handles showing notes for the current map.
     * @private
     */
    async _handleShowCurrentMapNotes() {
        if (!this._currentMapName) return;

        // Emit event to show notes in sidebar
        this._eventBus.emit(EventTypes.MAP_NOTES_REQUESTED, {
            mapName: this._currentMapName
        });
    }

    /**
     * Sets up event listeners for map changes.
     * @private
     */
    _setupEventListeners() {
        subscribe(this, this._eventBus, EventTypes.LAYERS_CHANGED, () => this._loadMaps());
        subscribe(this, this._eventBus, EventTypes.MAP_LOCK_CHANGED, () => this._loadMaps());
    }

    /**
     * Loads and renders the maps list.
     * @private
     */
    async _loadMaps() {
        // Guard against concurrent calls
        if (this._isLoadingMaps) {
            return;
        }

        this._isLoadingMaps = true;

        try {
            const allMapNames = await getAllMapNamesStore();
            this._currentMapName = await getCurrentMapName();

            // Update current map card
            this._updateCurrentMapCard();

            // Render maps list
            this._renderMapsList(allMapNames);

        } catch (_error) {
            console.error('Error loading maps:', _error);
        } finally {
            this._isLoadingMaps = false;
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

        // Update badge letter
        const badgeEl = this._currentMapCard.querySelector('#current-map-badge');
        if (badgeEl && this._currentMapName) {
            badgeEl.textContent = this._currentMapName.charAt(0).toUpperCase();
        }

        // Update lock state
        const locked = await isMapLocked(this._currentMapName);
        const lockBtn = this._currentMapCard.querySelector('#current-map-lock-btn');
        const notesBtn = this._currentMapCard.querySelector('#current-map-notes-btn');

        if (lockBtn) {
            lockBtn.dataset.locked = locked.toString();
            lockBtn.innerHTML = locked ? MAPS_ICONS.lock : MAPS_ICONS.lockOpen;
            lockBtn.title = locked ? 'Desbloquear mapa' : 'Bloquear mapa';
        }

        this._currentMapCard.classList.toggle('current-map-card--locked', locked);

        if (nameInput) {
            nameInput.disabled = locked;
        }

        if (notesBtn) {
            notesBtn.style.display = locked ? 'none' : '';
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

            statsEl.textContent = `${featureCount} feições - ${layerCount} ${layerCount === 1 ? 'camada' : 'camadas'}`;
        } catch (_error) {
            statsEl.textContent = '0 feições - 1 camada';
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

        // Build map data with saved position, notes, and lock info
        for (const mapName of sortedMaps) {
            const [hasSavedPosition, hasNotes, locked] = await Promise.all([
                hasMapSavedPosition(mapName),
                hasMapNotes(mapName),
                isMapLocked(mapName)
            ]);
            const item = this._createMapListItem(mapName, hasSavedPosition, hasNotes, locked);
            this._mapsList.appendChild(item);
        }

        // Initialize sortable
        this._initSortable();
    }

    /**
     * Creates a map list item.
     * @private
     * @param {string} mapName - Map name
     * @param {boolean} hasSavedPosition - Whether the map has a saved position
     * @param {boolean} hasNotes - Whether the map has notes
     * @returns {HTMLElement}
     */
    _createMapListItem(mapName, hasSavedPosition = false, hasNotes = false, locked = false) {
        const isSelected = mapName === this._currentMapName;

        const item = document.createElement('div');
        item.className = `map-list-item${locked ? ' map-list-item--locked' : ''}`;
        item.dataset.mapName = mapName;
        item.dataset.selected = isSelected.toString();

        // Build position indicator
        const positionIndicator = hasSavedPosition
            ? `<span class="map-position-indicator" title="Posicao salva">${MAPS_ICONS.mapPin}</span>`
            : '';

        // Build notes indicator
        const notesIndicator = hasNotes
            ? `<span class="map-notes-indicator" title="Tem notas">${MAPS_ICONS.fileText}</span>`
            : '';

        // Build lock indicator
        const lockIndicator = locked
            ? `<span class="map-lock-indicator" title="Mapa bloqueado">${MAPS_ICONS.lock}</span>`
            : '';

        // Build meta text
        const metaText = isSelected ? 'Mapa atual' : '';

        // Get first letter for badge
        const initial = mapName.charAt(0).toUpperCase();

        item.innerHTML = `
            <div class="map-list-drag-handle" title="Arrastar para reordenar">
                ${MAPS_ICONS.grip}
            </div>
            <div class="map-list-badge ${isSelected ? 'map-list-badge--selected' : ''}">
                ${initial}
            </div>
            <div class="map-list-info">
                <div class="map-list-name">
                    ${this._escapeHtml(mapName)}
                    ${lockIndicator}
                    ${positionIndicator}
                    ${notesIndicator}
                </div>
                <div class="map-list-meta">${metaText}</div>
            </div>
            <div class="map-list-actions">
                <button class="map-list-action-btn menu-btn" title="Mais opções">
                    ${MAPS_ICONS.moreVertical}
                </button>
            </div>
        `;

        // Click to select
        addDomListener(this, item, 'click', (e) => {
            if (!e.target.closest('.map-list-action-btn') && !e.target.closest('.map-list-drag-handle')) {
                this._handleSelectMap(mapName);
            }
        });

        // Menu button
        const menuBtn = item.querySelector('.menu-btn');
        addDomListener(this, menuBtn, 'click', (e) => {
            e.stopPropagation();
            this._showMapContextMenu(mapName, menuBtn, hasSavedPosition);
        });

        return item;
    }

    /**
     * Shows the context menu for a map.
     * @private
     * @param {string} mapName - Map name
     * @param {HTMLElement} anchorEl - Element to anchor the menu to
     * @param {boolean} hasSavedPosition - Whether the map has a saved position
     */
    async _showMapContextMenu(mapName, anchorEl, hasSavedPosition) {
        // Close any existing menu
        this._closeContextMenu();

        const locked = await isMapLocked(mapName);

        const menu = document.createElement('div');
        menu.className = 'map-context-menu';
        this._contextMenu = menu;

        // Menu items
        const menuItems = [];

        // Position items only when unlocked
        if (!locked) {
            menuItems.push({
                icon: MAPS_ICONS.mapPin,
                label: hasSavedPosition ? 'Atualizar posicao' : 'Salvar posicao',
                handler: () => this._handleSaveMapPosition(mapName)
            });

            if (hasSavedPosition) {
                menuItems.push({
                    icon: SIDEBAR_ICONS.trash,
                    label: 'Limpar posicao salva',
                    handler: () => this._handleClearMapPosition(mapName),
                    className: 'menu-item-danger'
                });
            }

            menuItems.push({ separator: true });
        }

        // Duplicate (always available - read-only operation)
        menuItems.push({
            icon: MAPS_ICONS.copy,
            label: 'Duplicar',
            handler: () => this._handleDuplicateMap(mapName)
        });

        // Rename, Combine, Delete only when unlocked
        if (!locked) {
            menuItems.push({
                icon: MAPS_ICONS.edit,
                label: 'Renomear',
                handler: () => this._handleRenameMap(mapName)
            });

            menuItems.push({
                icon: MAPS_ICONS.merge,
                label: 'Puxar outros mapas',
                handler: () => this._handleCombineMaps(mapName)
            });

            menuItems.push({ separator: true });

            menuItems.push({
                icon: SIDEBAR_ICONS.trash,
                label: 'Deletar',
                handler: () => this._handleDeleteMap(mapName),
                className: 'menu-item-danger'
            });
        }

        // Build menu items
        menuItems.forEach(item => {
            if (item.separator) {
                const sep = document.createElement('div');
                sep.className = 'map-context-menu-separator';
                menu.appendChild(sep);
            } else {
                const menuItem = document.createElement('button');
                menuItem.className = `map-context-menu-item ${item.className || ''}`;
                menuItem.innerHTML = `${item.icon}<span>${item.label}</span>`;
                addDomListener(this, menuItem, 'click', (e) => {
                    e.stopPropagation();
                    this._closeContextMenu();
                    item.handler();
                });
                menu.appendChild(menuItem);
            }
        });

        // Position the menu
        document.body.appendChild(menu);
        this._positionContextMenu(menu, anchorEl);

        // Close on click outside
        const closeHandler = (e) => {
            if (!menu.contains(e.target) && !anchorEl.contains(e.target)) {
                this._closeContextMenu();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeHandler);
        }, 0);
    }

    /**
     * Positions the context menu relative to the anchor element.
     * @private
     * @param {HTMLElement} menu - Menu element
     * @param {HTMLElement} anchorEl - Anchor element
     */
    _positionContextMenu(menu, anchorEl) {
        const rect = anchorEl.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const padding = 8;

        let top = rect.bottom + 4;
        let left = rect.right - menuRect.width;

        // Adjust if menu goes off screen
        if (left < padding) {
            left = rect.left;
        }
        if (left + menuRect.width > window.innerWidth - padding) {
            left = window.innerWidth - menuRect.width - padding;
        }
        if (top + menuRect.height > window.innerHeight - padding) {
            top = rect.top - menuRect.height - 4;
        }

        menu.style.position = 'fixed';
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
    }

    /**
     * Closes the context menu.
     * @private
     */
    _closeContextMenu() {
        if (this._contextMenu) {
            this._contextMenu.remove();
            this._contextMenu = null;
        }
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
        const existingMaps = await getAllMapNamesStore();
        const defaultName = IDUtils.generateUniqueMapName(existingMaps, 'Novo Mapa');
        const mapName = await showPrompt('Nome do novo mapa:', defaultName);
        if (!mapName || !mapName.trim()) return;

        try {
            const result = await this._mapManager.createMap(mapName.trim());
            if (result.success) {
                showSuccess(result.message);
                // Emit event to update recent maps in sidebar (this also triggers _loadMaps via listener)
                this._eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
            } else {
                showWarning(result.message);
            }
        } catch (_error) {
            showError('Erro ao criar mapa');
        }
    }

    /**
     * Handles opening a project file (replaces current project).
     * @private
     */
    _handleOpenProject() {
        if (this._exportImportService) {
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
     * Handles importing a project file additively (adds to current project).
     * @private
     */
    _handleImportAdditive() {
        if (this._exportImportService) {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.ebgeo';
            fileInput.onchange = async (e) => {
                if (e.target.files[0]) {
                    await this._exportImportService.processFileDirectly(e.target.files[0], true);
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
    _handleSaveProject() {
        if (this._exportImportService) {
            this._exportImportService.showExportModal();
        }
    }

    /**
     * Handles clearing all data.
     * @private
     */
    async _handleClearAll() {
        const confirmed = await showConfirm('Limpar TODOS os dados?', {
            message: 'Esta ação irá:\n- Deletar todos os mapas\n- Remover todas as feições\n\nEsta ação NÃO pode ser desfeita!',
            destructive: true
        });

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
                // Emit event to update sidebar shortcuts and maps list
                this._eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
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

            // Emit event to update sidebar recent maps display
            this._eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
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
        const existingMaps = await getAllMapNamesStore();
        const defaultName = IDUtils.generateUniqueMapName(existingMaps, `${mapName} (cópia)`);
        const newName = await showPrompt('Nome para o novo mapa:', defaultName);
        if (!newName || !newName.trim()) return;

        try {
            const result = await this._mapManager.copyMap(mapName, newName.trim());
            if (result.success) {
                showSuccess(result.message);
                // Emit event to update sidebar shortcuts and maps list
                this._eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
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
        const confirmed = await showConfirm(`Deletar o mapa "${mapName}"?`, { destructive: true });
        if (!confirmed) return;

        try {
            const result = await this._mapManager.deleteMap(mapName);
            if (result.success) {
                showSuccess(result.message);
                // Emit event to update sidebar shortcuts and maps list
                this._eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
            } else {
                showWarning(result.message);
            }
        } catch (_error) {
            showError('Erro ao deletar mapa');
        }
    }

    /**
     * Handles renaming a map via prompt.
     * @private
     * @param {string} mapName - Map to rename
     */
    async _handleRenameMap(mapName) {
        const newName = await showPrompt('Novo nome do mapa:', mapName);
        if (!newName || !newName.trim() || newName.trim() === mapName) return;

        try {
            const result = await this._mapManager.renameMap(mapName, newName.trim());
            if (result.success) {
                showSuccess(result.message);
                // Emit event to update sidebar shortcuts and maps list
                this._eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
            } else {
                showWarning(result.message);
            }
        } catch (_error) {
            showError('Erro ao renomear mapa');
        }
    }

    /**
     * Handles saving the current map position.
     * @private
     * @param {string} mapName - Map to save position for
     */
    async _handleSaveMapPosition(mapName) {
        try {
            const result = await this._mapManager.saveMapPosition(mapName);
            if (result.success) {
                showSuccess(result.message);
                this._loadMaps();
            } else {
                showWarning(result.message);
            }
        } catch (_error) {
            showError('Erro ao salvar posicao');
        }
    }

    /**
     * Handles clearing the saved map position.
     * @private
     * @param {string} mapName - Map to clear position for
     */
    async _handleClearMapPosition(mapName) {
        const confirmed = await showConfirm(`Limpar a posição salva do mapa "${mapName}"?`);
        if (!confirmed) return;

        try {
            const result = await this._mapManager.clearMapPosition(mapName);
            if (result.success) {
                showSuccess(result.message);
                this._loadMaps();
            } else {
                showWarning(result.message);
            }
        } catch (_error) {
            showError('Erro ao limpar posicao');
        }
    }

    /**
     * Handles showing map notes.
     * @private
     * @param {string} mapName - Map to show notes for
     */
    async _handleShowMapNotes(mapName) {
        // Access the map notes manager through the mapManager's mapControl reference
        if (this._mapManager?.mapControl?.mapNotesManager) {
            await this._mapManager.mapControl.mapNotesManager.showViewPanel(mapName);
        } else {
            showWarning('Notas nao disponiveis');
        }
    }

    /**
     * Handles combining maps.
     * @private
     * @param {string} targetMapName - Target map to combine into
     */
    async _handleCombineMaps(targetMapName) {
        // Use the modal from map control if available
        if (this._mapManager?.mapControl?.showCombineMapsModal) {
            await this._mapManager.mapControl.showCombineMapsModal(targetMapName);
        } else {
            showWarning('Funcao de combinar mapas nao disponivel');
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
        this._closeContextMenu();

        if (this._sortableInstance) {
            this._sortableInstance.destroy();
            this._sortableInstance = null;
        }

        cleanup(this);
        removeElement(this._container);
        this._container = null;
    }
}
