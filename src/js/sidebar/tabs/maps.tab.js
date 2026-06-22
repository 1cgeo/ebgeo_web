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
    addScopedDomListener,
    clearScopedListeners,
    subscribe,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';
import { escapeHtml } from '@utils/html-escape.js';
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
    isMapTemporalEnabled,
    toggleMapTemporal,
    getControl,
} from '@store/index.js';
import { EventTypes } from '@events/event_types.js';
import { showSuccess, showError, showWarning, IDUtils } from '@utils/index.js';
import { showPrompt, showConfirm, showCombineMapsModal } from '@modals/index.js';
import { mapLockController } from '@js/locking/index.js';
import { mapResolver } from '@store/services/map-resolver.service.js';
import { resolveRedirectTarget } from './remote-map-redirect.js';
import { showSharingModal } from '@modals/sharing.modal.js';
import { getPresenceColor, getInitials } from '@js/presence/presence-colors.js';
import { syncEngine } from '@store/sync/sync-engine.js';
import { sessionContext } from '@store/sync/session-context.js';
import { apiClient } from '@store/sync/api-client.js';

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

    clock: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,

    gear: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,

    cloudDownload: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9"/><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/></svg>`,

    users: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
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
        newMapBtn.setAttribute('data-testid', 'maps-new-map');
        newMapBtn.innerHTML = MAPS_ICONS.plus;
        addDomListener(this, newMapBtn, 'click', () => this._handleNewMap());
        sectionHeader.appendChild(newMapBtn);

        this._container.appendChild(sectionHeader);

        // Maps list
        this._mapsList = document.createElement('div');
        this._mapsList.className = 'maps-list';
        this._container.appendChild(this._mapsList);

        // Settings button
        const settingsBtn = document.createElement('button');
        settingsBtn.className = 'sidebar-settings-btn';
        settingsBtn.title = 'Configurações';
        settingsBtn.innerHTML = `${MAPS_ICONS.gear}<span>Configurações</span>`;
        addDomListener(this, settingsBtn, 'click', () => this._handleOpenSettings());
        this._container.appendChild(settingsBtn);

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
            { id: 'open-backend', icon: MAPS_ICONS.cloudDownload, label: 'Abrir do servidor', handler: () => this._handleOpenBackendProject(), title: 'Abrir projeto do servidor (substitui atual)', testid: 'maps-open-backend' },
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
            if (action.testid) {
                button.setAttribute('data-testid', action.testid);
            }

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
                <button class="current-map-lock-btn" id="current-map-lock-btn" title="Bloquear mapa" data-locked="false" data-testid="map-lock-toggle">
                    ${MAPS_ICONS.lockOpen}
                </button>
                <button class="current-map-temporal-btn" id="current-map-temporal-btn" title="Habilitar controle temporal" data-temporal="false">
                    ${MAPS_ICONS.clock}
                </button>
                <button class="current-map-notes-btn" id="current-map-notes-btn" title="Notas do mapa">
                    ${MAPS_ICONS.fileText}
                </button>
            </div>
            <button class="current-map-share-btn" id="current-map-share-btn" data-testid="maps-share-btn" title="Compartilhar projeto" hidden>
                ${MAPS_ICONS.users}<span>Compartilhar</span>
            </button>
        `;

        // Setup share button handler (atlas-level; visibility gated to the owner
        // of a connected server atlas — toggled in _updateShareButton()).
        const shareBtn = card.querySelector('#current-map-share-btn');
        addDomListener(this, shareBtn, 'click', () => this._handleShareAtlas());

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

        // Setup temporal control button handler
        const temporalBtn = card.querySelector('#current-map-temporal-btn');
        addDomListener(this, temporalBtn, 'click', () => this._handleToggleTemporal());

        // Setup notes button handler
        const notesBtn = card.querySelector('#current-map-notes-btn');
        addDomListener(this, notesBtn, 'click', () => this._handleShowCurrentMapNotes());

        return card;
    }

    /**
     * Handles toggling map lock.
     *
     * Routes through {@link mapLockController} (not the bare store op) so the
     * role gate applies (only OWNER/ADMIN online; offline = full local control)
     * and the change is logged for sync as a `map` update. The controller shows
     * its own pt-BR error when a non-owner attempts the toggle, in which case
     * the returned state is unchanged and we emit nothing further.
     * @private
     */
    async _handleToggleLock() {
        if (!this._currentMapName) return;

        if (!mapLockController.canToggleLock()) {
            showWarning('Apenas o dono pode bloquear o mapa');
            return;
        }

        const wasLocked = mapLockController.isMapLocked();
        const newState = await mapLockController.toggleMapLock(this._currentMapName);

        // Only celebrate an actual flip (a blocked toggle returns the prior state).
        if (newState === wasLocked) return;

        if (newState) {
            showWarning('Mapa bloqueado');
        } else {
            showSuccess('Mapa desbloqueado');
        }
    }

    /**
     * Handles toggling the per-map temporal control.
     * @private
     */
    async _handleToggleTemporal() {
        if (!this._currentMapName) return;

        const newState = await toggleMapTemporal(this._currentMapName);
        if (newState) {
            showSuccess('Controle temporal habilitado');
        } else {
            showSuccess('Controle temporal desabilitado');
        }
    }

    /**
     * Handles showing notes for the current map.
     * @private
     */
    async _handleShowCurrentMapNotes() {
        if (!this._currentMapName) return;

        const locked = await isMapLocked(this._currentMapName);

        // Emit event to show notes in sidebar
        this._eventBus.emit(EventTypes.MAP_NOTES_REQUESTED, {
            mapName: this._currentMapName,
            readOnly: locked
        });
    }

    /**
     * Sets up event listeners for map changes.
     * @private
     */
    _setupEventListeners() {
        subscribe(this, this._eventBus, EventTypes.LAYERS_CHANGED, () => this._loadMaps());
        subscribe(this, this._eventBus, EventTypes.MAP_LOCK_CHANGED, () => this._loadMaps());
        // Remote lock changes arrive as MAP_MODIFIED; re-read so the toggle and
        // indicators reflect a lock flipped by another collaborator.
        subscribe(this, this._eventBus, EventTypes.MAP_MODIFIED, () => this._loadMaps());
        subscribe(this, this._eventBus, EventTypes.MAP_TEMPORAL_CHANGED, () => this._loadMaps());
        // §1.8/§1.9: react to maps created/deleted by OTHER users (remote ops). A
        // remote map-delete of the map currently being viewed redirects elsewhere.
        subscribe(this, this._eventBus, EventTypes.REMOTE_OPERATION_APPLIED, (p) => this._onRemoteOperation(p));
        // Re-evaluate the owner-only "Compartilhar" button when the session
        // (login/role) or the connection (connect/disconnect an atlas) changes.
        subscribe(this, this._eventBus, EventTypes.SESSION_CHANGED, () => this._updateShareButton());
        subscribe(this, this._eventBus, EventTypes.CONNECTION_STATE_CHANGED, () => this._updateShareButton());
    }

    /**
     * Reacts to a remote operation from another collaborator. For a remote MAP delete
     * of the map currently being viewed (§1.9), redirects to another map via the normal
     * selection flow and warns the user; always refreshes the list (§1.8 new/removed maps).
     * @private
     * @param {{ operation?: Object }} [payload]
     */
    async _onRemoteOperation({ operation } = {}) {
        if (!operation || operation.entityType !== 'map') return;

        if (operation.operationType === 'delete') {
            try {
                const target = resolveRedirectTarget(operation, {
                    currentMapName: await getCurrentMapName(),
                    allMapNames: await getAllMapNamesStore(),
                    getNameForId: (id) => mapResolver.getNameForId(id),
                });
                if (target) {
                    await this._handleSelectMap(target);
                    showWarning('O mapa que você estava vendo foi removido por outro usuário.');
                }
            } catch (_error) {
                // best-effort redirect; the list refresh below still runs
            }
        }
        this._loadMaps();
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
            await this._renderMapsList(allMapNames);

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

        // Update badge: stable initials + deterministic hue keyed on the map name
        // (the avatar inline color is the one sanctioned non-token color). The first
        // letter is preserved as textContent so the e2e badge assertion still holds.
        const badgeEl = this._currentMapCard.querySelector('#current-map-badge');
        if (badgeEl && this._currentMapName) {
            badgeEl.textContent = this._currentMapName.charAt(0).toUpperCase();
            badgeEl.style.backgroundColor = getPresenceColor(this._currentMapName);
        }

        // Update lock state
        const locked = await isMapLocked(this._currentMapName);
        const lockBtn = this._currentMapCard.querySelector('#current-map-lock-btn');
        const notesBtn = this._currentMapCard.querySelector('#current-map-notes-btn');

        if (lockBtn) {
            // Only OWNER/ADMIN (or any offline user) may toggle the lock; the
            // backend also enforces OWNER, so a write user is blocked there too.
            const canToggle = mapLockController.canToggleLock();
            lockBtn.dataset.locked = locked.toString();
            lockBtn.innerHTML = locked ? MAPS_ICONS.lock : MAPS_ICONS.lockOpen;
            lockBtn.disabled = !canToggle;
            lockBtn.title = !canToggle
                ? 'Apenas o dono pode bloquear'
                : locked
                    ? 'Desbloquear mapa'
                    : 'Bloquear mapa';
        }

        this._currentMapCard.classList.toggle('current-map-card--locked', locked);

        // Update temporal control state. A locked map is read-only, so the toggle
        // is disabled (mirroring the name input) — existing temporal config still renders.
        const temporalEnabled = await isMapTemporalEnabled(this._currentMapName);
        const temporalBtn = this._currentMapCard.querySelector('#current-map-temporal-btn');
        if (temporalBtn) {
            temporalBtn.dataset.temporal = temporalEnabled.toString();
            temporalBtn.disabled = locked;
            temporalBtn.title = locked
                ? 'Controle temporal (mapa bloqueado)'
                : temporalEnabled
                    ? 'Desabilitar controle temporal'
                    : 'Habilitar controle temporal';
        }

        if (nameInput) {
            nameInput.disabled = locked;
        }

        if (notesBtn) {
            notesBtn.title = locked ? 'Notas do mapa (somente leitura)' : 'Notas do mapa';
        }

        this._updateShareButton();

        await this._updateCurrentMapStats();
    }

    /**
     * Toggles the atlas-level "Compartilhar" button. Shown when a server atlas is
     * connected AND the current user can manage sharing: the atlas OWNER, or a
     * GLOBAL ADMIN (admins manage any atlas to support/debug users). Gating reads
     * the synchronous session/sync singletons: `syncEngine.atlasId` is non-null only
     * while connected, and `sessionContext.role` reflects the PER-ATLAS role from the
     * connect handshake ('owner' for the owner, 'admin' for a global admin — the
     * backend collapses owner+admin to 'admin'). The backend enforces the same
     * owner-or-admin rule on every sharing mutation, so this is purely cosmetic.
     * @private
     */
    _updateShareButton() {
        const shareBtn = this._currentMapCard?.querySelector('#current-map-share-btn');
        if (!shareBtn) return;

        const canShare = !!syncEngine.atlasId
            && (sessionContext.role === 'owner' || sessionContext.role === 'admin');
        shareBtn.hidden = !canShare;
    }

    /**
     * Opens the sharing modal for the connected atlas (owner-only entry point).
     * The atlas display name is resolved lazily from the project list so the modal
     * header can show it; if it can't be resolved the modal still works (it re-reads
     * the canonical sharing config from the server) and just omits the name.
     * @private
     */
    async _handleShareAtlas() {
        const atlasId = syncEngine.atlasId;
        if (!atlasId) return;

        let atlasName;
        try {
            const projects = await apiClient.listAtlas();
            atlasName = projects?.find(p => p.id === atlasId)?.name;
        } catch (_error) {
            // Name is cosmetic; the modal works without it.
        }

        showSharingModal(atlasId, { atlasName });
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
        clearScopedListeners(this, 'rows');
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
        item.setAttribute('data-testid', 'map-list-item');

        // Build position indicator (clickable — restores saved position)
        const positionIndicator = hasSavedPosition
            ? `<span class="map-position-indicator" data-testid="map-position-indicator" title="Ir para posição salva">${MAPS_ICONS.mapPin}</span>`
            : '';

        // Build notes indicator
        const notesIndicator = hasNotes
            ? `<span class="map-notes-indicator" title="Tem notas">${MAPS_ICONS.fileText}</span>`
            : '';

        // Build lock indicator
        const lockIndicator = locked
            ? `<span class="map-lock-indicator" title="Mapa bloqueado">${MAPS_ICONS.lock}</span>`
            : '';

        // Build meta text. NOTE: the .map-list-meta text contract is asserted by e2e
        // ('Mapa atual' when selected, '' otherwise) — keep it exactly as-is.
        const metaText = isSelected ? 'Mapa atual' : '';

        // Stable initials + deterministic hue keyed on the map name (sanctioned
        // non-token inline color). Selected badge falls back to the token --primary
        // via the --selected class, which overrides this inline color in CSS.
        const initials = escapeHtml(getInitials(mapName));
        const badgeColor = getPresenceColor(mapName);

        item.innerHTML = `
            <div class="map-list-drag-handle" title="Arrastar para reordenar">
                ${MAPS_ICONS.grip}
            </div>
            <div class="map-list-badge ${isSelected ? 'map-list-badge--selected' : ''}" style="background-color: ${badgeColor}">
                ${initials}
            </div>
            <div class="map-list-info">
                <div class="map-list-name">
                    ${escapeHtml(mapName)}
                </div>
                <div class="map-list-meta">${metaText}</div>
            </div>
            <div class="map-list-indicators">
                ${lockIndicator}
                ${positionIndicator}
                ${notesIndicator}
            </div>
            <div class="map-list-actions">
                <button class="map-list-action-btn menu-btn" title="Mais opções">
                    ${MAPS_ICONS.moreVertical}
                </button>
            </div>
        `;

        // Position indicator click — restore saved position
        if (hasSavedPosition) {
            const posIndicator = item.querySelector('.map-position-indicator');
            if (posIndicator) {
                addScopedDomListener(this, 'rows',posIndicator, 'click', (e) => {
                    e.stopPropagation();
                    this._handleRestorePosition(mapName);
                });
            }
        }

        // Click to select
        addScopedDomListener(this, 'rows',item, 'click', (e) => {
            if (!e.target.closest('.map-list-action-btn') && !e.target.closest('.map-list-drag-handle') && !e.target.closest('.map-position-indicator')) {
                this._handleSelectMap(mapName);
            }
        });

        // Menu button
        const menuBtn = item.querySelector('.menu-btn');
        addScopedDomListener(this, 'rows',menuBtn, 'click', (e) => {
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
        // Toggle: if clicking the same button, just close
        if (this._contextMenu && this._contextMenuAnchor === anchorEl) {
            this._closeContextMenu();
            return;
        }

        // Close any existing menu
        this._closeContextMenu();

        const [locked, allMapNames] = await Promise.all([
            isMapLocked(mapName),
            getAllMapNamesStore()
        ]);
        const isLastMap = allMapNames.length <= 1;

        const menu = document.createElement('div');
        menu.className = 'map-context-menu';
        this._contextMenu = menu;
        this._contextMenuAnchor = anchorEl;

        // Menu items
        const menuItems = [];

        // Position items only for active map when unlocked
        const isActiveMap = mapName === this._currentMapName;
        if (!locked && isActiveMap) {
            menuItems.push({
                icon: MAPS_ICONS.mapPin,
                label: hasSavedPosition ? 'Atualizar posição' : 'Salvar posição',
                handler: () => this._handleSaveMapPosition(mapName)
            });

            if (hasSavedPosition) {
                menuItems.push({
                    icon: SIDEBAR_ICONS.trash,
                    label: 'Limpar posição salva',
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

            if (!isLastMap) {
                menuItems.push({ separator: true });

                menuItems.push({
                    icon: SIDEBAR_ICONS.trash,
                    label: 'Deletar',
                    handler: () => this._handleDeleteMap(mapName),
                    className: 'menu-item-danger'
                });
            }
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

        // Close on click outside - store reference so _closeContextMenu() can remove it
        this._contextMenuCloseHandler = (e) => {
            if (!menu.contains(e.target) && !anchorEl.contains(e.target)) {
                this._closeContextMenu();
            }
        };
        setTimeout(() => {
            document.addEventListener('click', this._contextMenuCloseHandler);
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
        if (this._contextMenuCloseHandler) {
            document.removeEventListener('click', this._contextMenuCloseHandler);
            this._contextMenuCloseHandler = null;
        }
        if (this._contextMenu) {
            this._contextMenu.remove();
            this._contextMenu = null;
            this._contextMenuAnchor = null;
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
    async _handleOpenProject() {
        if (!this._exportImportService) return;

        // Check if there are existing features that would be lost
        const hasExistingFeatures = await this._checkForExistingFeatures();
        if (hasExistingFeatures) {
            const confirmed = await showConfirm(
                'Ao abrir um novo projeto, todos os dados atuais serão perdidos. Deseja continuar?',
                { destructive: true }
            );
            if (!confirmed) return;
        }

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

    /**
     * Handles opening a project from the backend (replaces current project).
     * Delegates the login → project-picker → connect flow to the AccountControl
     * orchestrator. Mirrors the destructive-confirm guard of _handleOpenProject:
     * opening a backend project wipes the local store via the picker's onPick.
     * @private
     */
    async _handleOpenBackendProject() {
        // Check if there are existing features that would be lost
        const hasExistingFeatures = await this._checkForExistingFeatures();
        if (hasExistingFeatures) {
            const confirmed = await showConfirm(
                'Ao abrir um projeto do servidor, todos os dados atuais serão perdidos. Deseja continuar?',
                { destructive: true }
            );
            if (!confirmed) return;
        }

        const accountControl = getControl('account');
        if (!accountControl || typeof accountControl.openProjectPicker !== 'function') {
            showError('Integração com o servidor indisponível');
            return;
        }

        try {
            await accountControl.openProjectPicker();
        } catch (error) {
            console.error('Failed to open backend project:', error);
            showError('Falha ao abrir o projeto do servidor');
        } finally {
            this._loadMaps();
        }
    }

    /**
     * Checks if any map has existing features in IndexedDB.
     * @returns {Promise<boolean>} True if features exist.
     * @private
     */
    async _checkForExistingFeatures() {
        try {
            // Fast path: check current map first (most common case)
            const currentMap = await getCurrentMapName();
            if (currentMap && this._mapHasFeatures(await getMapDataStore(currentMap))) {
                return true;
            }

            const mapNames = await getAllMapNamesStore();
            for (const mapName of mapNames) {
                if (mapName === currentMap) continue;
                if (this._mapHasFeatures(await getMapDataStore(mapName))) {
                    return true;
                }
            }
        } catch (error) {
            console.error('Failed to check for existing features:', error);
        }
        return false;
    }

    /**
     * Checks if a single map data object contains any features.
     * @param {object} mapData
     * @returns {boolean}
     * @private
     */
    _mapHasFeatures(mapData) {
        if (!mapData?.features) return false;
        return Object.values(mapData.features).some(
            arr => Array.isArray(arr) && arr.length > 0
        );
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
            message: 'Isso apaga TODO o projeto e NÃO pode ser desfeito:\n- Todos os mapas serão deletados\n- Todas as feições serão removidas\n- Posições e notas salvas serão perdidas\n\nEsta ação é irreversível.',
            confirmText: 'Apagar tudo',
            cancelText: 'Cancelar',
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
                this._currentMapName = newName.trim();
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

            // Emit event to update sidebar recent maps display
            // (this also triggers _loadMaps via the LAYERS_CHANGED listener)
            this._eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
        } catch (_error) {
            showError('Erro ao selecionar mapa');
        }
    }

    /**
     * Handles restoring the saved position for a map.
     * If it's the current map, jumps directly. Otherwise switches first.
     * @private
     * @param {string} mapName - Map name
     */
    async _handleRestorePosition(mapName) {
        if (!this._baseLayerControl) return;

        try {
            if (mapName === this._currentMapName) {
                await this._baseLayerControl.applyMapSavedPosition(mapName);
            } else {
                await setCurrentMap(mapName);
                await this._baseLayerControl.switchMap();
                this._eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
            }
        } catch (_error) {
            showError('Erro ao restaurar posição');
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
            showError('Erro ao salvar posição');
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
            showError('Erro ao limpar posição');
        }
    }

    /**
     * Handles showing map notes via event.
     * @private
     * @param {string} mapName - Map to show notes for
     */
    async _handleShowMapNotes(mapName) {
        this._eventBus.emit(EventTypes.MAP_NOTES_REQUESTED, { mapName });
    }

    /**
     * Handles combining maps using the standalone modal.
     * @private
     * @param {string} targetMapName - Target map to combine into
     */
    async _handleCombineMaps(targetMapName) {
        const allMapNames = await getAllMapNamesStore();
        const lockedChecks = await Promise.all(
            allMapNames.map(async name => ({ name, locked: await isMapLocked(name) }))
        );
        const availableMaps = lockedChecks
            .filter(m => m.name !== targetMapName && !m.locked)
            .map(m => m.name);

        if (availableMaps.length === 0) {
            showWarning('Não há outros mapas para combinar');
            return;
        }

        showCombineMapsModal(targetMapName, availableMaps, async (selectedMaps) => {
            try {
                const result = await this._mapManager.combineSelectedMapsIntoTarget(selectedMaps, targetMapName);
                const message = result.totalFeatures > 0
                    ? `${selectedMaps.length} mapa(s) combinado(s): ${result.totalFeatures} feições adicionadas a "${targetMapName}"`
                    : 'Mapas combinados mas nenhuma feição foi encontrada';
                showSuccess(message);
            } catch (error) {
                console.error('Error combining maps:', error);
                showError(error.message || 'Erro ao combinar mapas');
            }
        });
    }

    /**
     * Opens the settings modal with terrain exaggeration control.
     * @private
     */
    async _handleOpenSettings() {
        const terrainControl = getControl('TerrainControl');
        const currentExaggeration = terrainControl?._exaggeration ?? 1.5;

        const { showSettingsModal } = await import('../../modals/settings.modal.js');
        await showSettingsModal({
            currentExaggeration,
            onExaggerationChanged: (value) => {
                if (terrainControl) {
                    terrainControl.setExaggeration(value);
                }
            }
        });
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
        // Row-scoped listeners are flushed by cleanup(this) below.

        if (this._sortableInstance) {
            this._sortableInstance.destroy();
            this._sortableInstance = null;
        }

        cleanup(this);
        removeElement(this._container);
        this._container = null;
    }
}
