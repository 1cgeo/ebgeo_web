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
    getOrderedMapBadgeColors,
    isRemoteStoreSync,
} from '@store/index.js';
import config from '@js/config.js';
import { EventTypes } from '@events/event_types.js';
import { showSuccess, showError, showWarning, IDUtils } from '@utils/index.js';
import { showPrompt, showConfirm, showCombineMapsModal } from '@modals/index.js';
import { mapLockController } from '@js/locking/index.js';
import { mapResolver } from '@store/services/map-resolver.service.js';
import { resolveRedirectTarget } from './remote-map-redirect.js';
// A grade de ações mora FORA daqui de propósito: ela é uma decisão pura sobre três valores
// (origem da store, sessão e posto na escada), e este arquivo não carrega em node.
import { AtlasTabState, visibleAtlasActions } from './atlas-actions.js';
import { sessionContext } from '@store/sync/session-context.js';
import { checkPermission } from '@store/sync/permission-guard.js';
// A ÚNICA implementação da escada por atlas. `_canRenameAtlas` já gateia por capacidade
// (`checkPermission`); `_handleOpenSettings` precisa do POSTO, e posto se compara por hierarquia.
import { atlasRoleHasAtLeast } from '@js/projects/permission-levels.js';
import { syncEngine } from '@store/sync/sync-engine.js';
import { apiClient } from '@store/sync/api-client.js';
// DIRECT import, not the `@store` barrel: the barrel re-exports only `adoptRemoteAtlasAsLocal`
// from this module, so the three readers below are simply not reachable through it.
import {
    getCurrentLocalAtlasId,
    getLocalAtlas,
    renameLocalAtlas
} from '@store/local-atlas.api.js';
import { CommentsPanel } from '@js/comment_tool/comments-panel.js';

/**
 * Defensive fallback when a map has no persisted badge color yet (first palette hue).
 * getAllMapBadgeColors() normally assigns every existing map a color, so this is rarely hit.
 */
const MAP_BADGE_FALLBACK = '#2563eb';

/**
 * Icons specific to maps tab.
 */
const MAPS_ICONS = {
    plusCircle: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,

    folderOpen: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,

    folderPlus: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>`,

    save: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,

    trash2: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,

    share: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,

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

    cloudUpload: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9"/><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/></svg>`,

    cloudDownload: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9"/><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/></svg>`,

    // 18px, e não 16, porque este é ícone de BOTÃO DA GRADE: os sete vizinhos dela são 18 e um
    // menor no meio da fileira desalinha a linha de base dos rótulos.
    users: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
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
        // Um pedido de refresh que chegou DURANTE um carregamento, honrado depois dele.
        this._loadMapsPendente = false;

        // Atlas header (name + origin chip) and the action buttons, keyed by action id so the
        // per-state visibility table can be applied by name instead of by hand-held references.
        this._atlasHeader = null;
        this._atlasNameInput = null;
        this._atlasOriginChip = null;
        /** @type {string|null} Name of the mounted atlas, as last resolved. */
        this._atlasName = null;
        this._actionButtons = new Map();
        /** @type {{ id: string, name: string|null }|null} Cached server-atlas name, by atlas id. */
        this._remoteAtlasNameCache = null;

        setupCleanup(this);
    }

    /**
     * Creates the tab UI.
     * @returns {HTMLElement}
     */
    render() {
        this._container = document.createElement('div');
        this._container.className = 'sidebar-tab-content maps-tab';

        // Atlas header — WHICH atlas you are working in, and its origin.
        this._atlasHeader = this._createAtlasHeader();
        this._container.appendChild(this._atlasHeader);

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

        // Comments section — the current map's spatial comments (open + resolved), where a
        // resolved comment can still be reviewed, plus the show/hide-all toggle and "new" button.
        this._commentsPanel = new CommentsPanel();
        // Quem esconde a secao num atlas local e o PROPRIO painel (`comments-panel.js`), que ja e
        // o dono do `hidden` daquele elemento e o reescreve a cada refresh. Um segundo escritor
        // aqui era apagado no primeiro evento de comentario.
        this._container.appendChild(this._commentsPanel.render());

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
     * Creates the actions grid.
     *
     * WHAT THIS GRID IS FOR, and what it deliberately no longer holds: "what I do WITH this
     * atlas". Choosing WHERE to work (which atlas) is the project screen's job, and the grid
     * keeps exactly one way back to it ("Abrir"). The list used to mix both natures and grew by
     * accretion to six buttons.
     * @private
     * @returns {HTMLElement}
     */
    _createActionsGrid() {
        const grid = document.createElement('div');
        grid.className = 'sidebar-actions-grid';

        const actions = [
            { id: 'open', icon: MAPS_ICONS.folderOpen, label: 'Abrir', handler: () => this._handleOpenProject(), title: 'Escolher outro atlas' },
            // Label is "Enviar", not "Salvar": this PROMOTES the local atlas to a server project
            // and leaves you connected to it. It is not a "save as", and while it sat next to
            // another button starting with "Salvar" the two were indistinguishable by name.
            { id: 'save-server', icon: MAPS_ICONS.cloudUpload, label: 'Enviar ao servidor', handler: () => this._handleSaveToServer(), title: 'Enviar este atlas local para o servidor', testid: 'maps-save-server' },
            { id: 'import', icon: MAPS_ICONS.folderPlus, label: 'Importar', handler: () => this._handleImportAdditive(), title: 'Importar e adicionar ao atlas atual' },
            // "Exportar", not "Salvar": it saves nothing, it generates a `.ebgeo` for download.
            { id: 'save', icon: MAPS_ICONS.save, label: 'Exportar', handler: () => this._handleSaveProject(), title: 'Exportar este atlas como arquivo .ebgeo' },
            { id: 'save-local', icon: MAPS_ICONS.cloudDownload, label: 'Salvar como local', handler: () => this._handleSaveAsLocal(), title: 'Guardar uma cópia deste atlas neste computador', testid: 'maps-save-local' },
            { id: 'share', icon: MAPS_ICONS.share, label: 'Compartilhar', handler: () => this._handleShare(), title: 'Escolher quem pode ver e editar este atlas', testid: 'maps-share' },
            // O IRMÃO SOMENTE-LEITURA de "Compartilhar", e nunca os dois na mesma tela: quem
            // gere vê o de cima, quem participa vê este. Ele responde a cláusula 5.7 (todo
            // participante vê quem mais participa e com que nível) dentro do mapa, que era o
            // único lugar do produto onde essa pergunta não tinha porta nenhuma.
            { id: 'participants', icon: MAPS_ICONS.users, label: 'Participantes', handler: () => this._handleParticipants(), title: 'Ver quem participa deste atlas e com que nível', testid: 'maps-participants' },
            { id: 'clear', icon: MAPS_ICONS.trash2, label: 'Limpar tudo', handler: () => this._handleClearAll(), title: 'Apagar todo o conteúdo deste atlas' },
        ];

        this._actionButtons.clear();
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
            this._actionButtons.set(action.id, button);
        });

        this._updateActionsVisibility();
        return grid;
    }

    /**
     * The three live readings the pure decision needs, gathered in ONE place so no caller has to
     * remember which singleton answers which half.
     * @private
     * @returns {{remote: boolean, authenticated: boolean, role: *}}
     */
    _atlasContext() {
        return {
            remote: isRemoteStoreSync(),
            authenticated: sessionContext.isAuthenticated(),
            role: sessionContext.role,
        };
    }

    /**
     * WHICH of the three states the tab is in. Kept as a method because the current-map card and
     * the header still ask the question by name; the table itself lives in `atlas-actions.js`.
     * @private
     * @returns {string} A key of `ACTIONS_BY_STATE`.
     */
    _atlasState() {
        const { remote, authenticated } = this._atlasContext();
        if (remote) return AtlasTabState.REMOTE;
        return authenticated ? AtlasTabState.LOCAL_SIGNED_IN : AtlasTabState.LOCAL_ANON;
    }

    /**
     * Applies `visibleAtlasActions`. Every button is set on every pass (never only the ones that
     * disappear), so a state change can only ever produce the row the decision declares.
     *
     * THIS IS THE REPAINT A LIVE DEMOTION RIDES ON. `SESSION_CHANGED` and
     * `CONNECTION_STATE_CHANGED` both call it (see `_setupEventListeners`), so a Gestor demoted
     * mid-session loses "Compartilhar" and gains "Participantes" on the same pass that relocks
     * the padlock and re-reads the atlas header, instead of under a click.
     * @private
     */
    _updateActionsVisibility() {
        const visible = visibleAtlasActions(this._atlasContext());
        for (const [id, button] of this._actionButtons) {
            button.hidden = !visible.includes(id);
        }
    }

    /**
     * Builds the atlas header: the NAME of the mounted atlas plus an origin chip.
     *
     * WHY IT EXISTS. Until now the atlas name appeared only inside the account menu, and only for
     * a SERVER atlas (`account.control.js`, `_renderAtlasName`, gated on `syncEngine.atlasId`).
     * Working locally you could not see which atlas you were in, and with several named local
     * atlases that stopped being acceptable.
     *
     * The name is EDITABLE, which is how an atlas is renamed: no button spent on it. Same commit
     * shape as the current-map name right below it (blur + Enter), so the two read as one idiom.
     * @private
     * @returns {HTMLElement}
     */
    _createAtlasHeader() {
        const header = document.createElement('div');
        header.className = 'atlas-header';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'atlas-header__name';
        input.id = 'current-atlas-name-input';
        input.placeholder = 'Nome do atlas';
        input.setAttribute('data-testid', 'atlas-name-input');
        input.setAttribute('aria-label', 'Nome do atlas');
        header.appendChild(input);

        const chip = document.createElement('span');
        chip.className = 'atlas-header__chip';
        chip.setAttribute('data-testid', 'atlas-origin-chip');
        header.appendChild(chip);

        this._atlasNameInput = input;
        this._atlasOriginChip = chip;

        addDomListener(this, input, 'blur', () => this._handleRenameAtlas(input.value));
        addDomListener(this, input, 'keydown', (e) => {
            if (e.key === 'Enter') input.blur();
            // Escape abandons the edit; without it the only way out of a typo is to retype the
            // old name exactly, because blur commits.
            if (e.key === 'Escape') {
                input.value = this._atlasName ?? '';
                input.blur();
            }
        });

        this._refreshAtlasHeader();
        return header;
    }

    /**
     * May the user rename the atlas that is mounted?
     *
     * A LOCAL atlas is the user's own workspace: always. On a SERVER atlas the gate is the
     * HIERARCHY, never a closed list of role names — `role === 'owner' || role === 'write'`
     * silently drops `manage`, and that exact bug shipped twice in this repository. The manage
     * rung of the ladder is expressed on the client as the `canManageUsers` capability, which
     * `ROLE_PERMISSIONS` (`session-context.js`) derives for every role at once, so a role added
     * above editor inherits this gate without anybody editing this line.
     *
     * Deliberately STRICTER than the server, which accepts `write` on `PUT /atlas/:atlasId`: an
     * Editor sees the real name, read-only. Offering less than the server allows is safe; the
     * reverse (a button the server refuses) is what freezes the outbound queue.
     * @private
     * @returns {boolean}
     */
    _canRenameAtlas() {
        if (!isRemoteStoreSync()) return true;
        return checkPermission('MANAGE_USERS').allowed;
    }

    /**
     * Resolves the mounted atlas's name and repaints the header.
     *
     * The LOCAL name comes from the local registry (its single source of truth) and the id is
     * read FIRST because `getCurrentLocalAtlasId()` is the one reader that cannot throw before
     * `initLocalAtlases()`; `getLocalAtlas` can, so it stays inside the try.
     * @private
     * @returns {Promise<void>}
     */
    async _refreshAtlasHeader() {
        if (!this._atlasNameInput || !this._atlasOriginChip) return;

        const onRemote = isRemoteStoreSync();
        this._atlasOriginChip.textContent = onRemote ? 'Servidor' : 'Local';
        this._atlasOriginChip.classList.toggle('atlas-header__chip--remote', onRemote);
        this._atlasOriginChip.title = onRemote
            ? 'Atlas do servidor, compartilhado e sincronizado'
            : 'Atlas local, só neste navegador';

        const name = onRemote ? await this._resolveRemoteAtlasName() : this._resolveLocalAtlasName();
        this._atlasName = name;
        // O TITULO DA JANELA leva o nome do atlas, e e daqui porque esta funcao ja resolve o nome
        // nos DOIS casos (local pelo registro, remoto pela lista) e ja roda em toda troca que
        // muda a resposta: conectar, desconectar, limpar, renomear. Um modulo proprio para isso
        // repetiria a resolucao e as quatro assinaturas.
        //
        // Serve para escolher a aba certa entre varias abertas, que e onde o nome do arquivo
        // sozinho nao ajuda ninguem.
        const appTitle = config?.app?.title || 'EBGeo';
        document.title = name ? `${appTitle} - ${name}` : appTitle;

        // Do not stomp on what the user is typing: a refresh triggered by a background event
        // (a peer connecting, a session refresh) would otherwise discard the edit in progress.
        if (document.activeElement !== this._atlasNameInput) {
            this._atlasNameInput.value = name ?? '';
        }

        const canRename = this._canRenameAtlas();
        this._atlasNameInput.readOnly = !canRename;
        this._atlasNameInput.classList.toggle('atlas-header__name--readonly', !canRename);
        this._atlasNameInput.title = canRename
            ? 'Renomear este atlas'
            : 'Você não tem permissão para renomear este atlas';
    }

    /**
     * @private
     * @returns {string|null} Name of the mounted LOCAL atlas, or null when unknown.
     */
    _resolveLocalAtlasName() {
        const id = getCurrentLocalAtlasId();
        if (!id) return null;
        try {
            return getLocalAtlas(id)?.name ?? null;
        } catch (_error) {
            // The registry was never loaded (no boot ran). Nameless header, not a broken tab.
            return null;
        }
    }

    /**
     * Name of the connected SERVER atlas, from the project list, cached by atlas id — the same
     * lazy resolution the account menu uses, for the same reason: the snapshot the sync engine
     * holds does not carry the atlas name.
     * @private
     * @returns {Promise<string|null>}
     */
    async _resolveRemoteAtlasName() {
        const atlasId = syncEngine.atlasId;
        if (!atlasId) return null;
        if (this._remoteAtlasNameCache?.id === atlasId) return this._remoteAtlasNameCache.name;

        try {
            const projects = await apiClient.listAtlas();
            const name = Array.isArray(projects)
                ? (projects.find(p => p && p.id === atlasId)?.name ?? null)
                : null;
            this._remoteAtlasNameCache = { id: atlasId, name };
            return name;
        } catch (_error) {
            return null;
        }
    }

    /**
     * Commits a rename of the mounted atlas, routed by origin: the local registry, or the server.
     *
     * A refused local rename (a stale id) already carries its own pt-BR message; a rejected
     * server call does not, so it gets one here. Either way the input is put back to the name
     * that is actually stored, never left showing a name nothing agrees with.
     * @private
     * @param {string} newName - Raw input value.
     * @returns {Promise<void>}
     */
    async _handleRenameAtlas(newName) {
        const input = this._atlasNameInput;
        if (!input) return;

        const trimmed = (newName ?? '').trim();
        if (!trimmed || trimmed === this._atlasName || !this._canRenameAtlas()) {
            input.value = this._atlasName ?? '';
            return;
        }

        if (isRemoteStoreSync()) {
            await this._renameRemoteAtlas(trimmed);
        } else {
            await this._renameLocalAtlas(trimmed);
        }
    }

    /**
     * @private
     * @param {string} name - Trimmed, non-empty.
     * @returns {Promise<void>}
     */
    async _renameLocalAtlas(name) {
        const id = getCurrentLocalAtlasId();
        if (!id) {
            this._atlasNameInput.value = this._atlasName ?? '';
            return;
        }
        try {
            const result = await renameLocalAtlas(id, name);
            if (!result.ok) {
                showWarning(result.message);
                this._atlasNameInput.value = this._atlasName ?? '';
                return;
            }
            // The stored name may differ from what was typed: duplicates are SUFFIXED, not
            // refused, so show what was actually written.
            this._atlasName = result.atlas.name;
            this._atlasNameInput.value = result.atlas.name;
            showSuccess('Atlas renomeado');
        } catch (_error) {
            showError('Erro ao renomear o atlas');
            this._atlasNameInput.value = this._atlasName ?? '';
        }
    }

    /**
     * @private
     * @param {string} name - Trimmed, non-empty.
     * @returns {Promise<void>}
     */
    async _renameRemoteAtlas(name) {
        const atlasId = syncEngine.atlasId;
        if (!atlasId) {
            this._atlasNameInput.value = this._atlasName ?? '';
            return;
        }
        try {
            await apiClient.updateAtlas(atlasId, { name });
            this._atlasName = name;
            this._remoteAtlasNameCache = { id: atlasId, name };
            this._atlasNameInput.value = name;
            showSuccess('Atlas renomeado');
        } catch (error) {
            console.error('Failed to rename the server atlas:', error);
            showError('Falha ao renomear o atlas no servidor');
            this._atlasNameInput.value = this._atlasName ?? '';
        }
    }

    /**
     * "Enviar ao servidor" — delegates to the AccountControl orchestrator, which owns the whole
     * flow (name + sharing dialog, upload, swap the store for the new remote atlas). Same
     * delegation shape as `_handleOpenProject`; the logic must not exist twice.
     * @private
     */
    async _handleSaveToServer() {
        const accountControl = getControl('account');
        if (!accountControl || typeof accountControl.saveLocalToServer !== 'function') {
            showError('Integração com o servidor indisponível');
            return;
        }
        try {
            await accountControl.saveLocalToServer();
        } catch (error) {
            console.error('Failed to save local project to the server:', error);
        } finally {
            this._loadMaps();
        }
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
        // Re-evaluate the gated pair "Compartilhar"/"Participantes" AND the read-only padlock state
        // when the session (login/role) or the connection (connect/disconnect an atlas) changes —
        // becoming a viewer/commenter/visitor must immediately lock the padlock, forbid toggling it,
        // and swap the sharing command for its read-only twin. These two events ARE the live
        // demotion path: without them the swap would happen under the user's next click.
        // The atlas header rides along with these three for the same reason the grid does: the
        // atlas you are IN, its origin and your permission on it all change here and nowhere else.
        subscribe(this, this._eventBus, EventTypes.SESSION_CHANGED, () => {
            this._updateActionsVisibility();
            this._refreshAtlasHeader();
            if (this._currentMapCard) this._updateCurrentMapCard();
        });
        subscribe(this, this._eventBus, EventTypes.CONNECTION_STATE_CHANGED, () => {
            this._updateActionsVisibility();
            this._refreshAtlasHeader();
            if (this._currentMapCard) this._updateCurrentMapCard();
        });
        // A full wipe re-marks the store LOCAL, which changes what the origin-gated actions should
        // show. Connection events do NOT cover this: clearing while already disconnected (logout,
        // "Mapa local") flips the origin without any connection transition.
        subscribe(this, this._eventBus, EventTypes.ALL_DATA_CLEARED, () => {
            this._updateActionsVisibility();
            this._refreshAtlasHeader();
        });
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
        // COALESCE, NAO DESCARTE. O guarda existe para nao rodar duas passadas ao mesmo tempo,
        // o que e correto; o errado era JOGAR FORA o pedido chegado durante uma passada, porque
        // ele costuma ser o unico aviso de que algo mudou.
        //
        // MEDIDO em 2026-08-22, com um contador no proprio guarda e a suite sob carga: o botao
        // do relogio (`data-temporal`) so e escrito por `_updateCurrentMapCard`, que so roda
        // aqui dentro. Um clique enquanto a lista ainda carregava trocava o estado no store,
        // mostrava o toast de sucesso, e o botao seguia dizendo desligado. O diagnostico da
        // falha trouxe `temporalNoStore: true` com o atributo em "false" e EXATAMENTE UM
        // descarte contado. Nao era lentidao (nada estava a caminho), entao prazo maior nao
        // consertava; a UI mentia sobre o estado ate que outro evento recarregasse.
        //
        // Isolado o defeito nao aparece: a janela so abre quando a maquina divide CPU. Treze
        // rodadas limpas em sequencia nao o mostraram, e duas rodadas com quatro arquivos de
        // colaboracao juntos o mostraram duas vezes.
        //
        // A marcacao e UM bit, nao uma fila: N pedidos durante a mesma passada valem UMA
        // repeticao, que e o que "recarregar a lista" significa. O bit e limpo ANTES da
        // rechamada, entao um pedido que chegue durante a repeticao marca de novo em vez de se
        // perder, e a cadeia termina quando ninguem mais pede.
        if (this._isLoadingMaps) {
            this._loadMapsPendente = true;
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

        // Fora do `finally` porque a repeticao e trabalho novo, nao limpeza. Ela roda tambem
        // depois de uma passada que falhou, ja que o `catch` acima registra e NAO relanca: isso
        // e desejado, porque o pedido pendente veio de uma mudanca real e uma passada que
        // quebrou no meio e justamente a que deixou a tela desatualizada. Nao ha laco: o bit so
        // e marcado por chamada externa, e e limpo antes da rechamada.
        if (this._loadMapsPendente) {
            this._loadMapsPendente = false;
            await this._loadMaps();
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

        // Update badge: single uppercase initial + the map's STABLE name-based palette color (kept on
        // reorder; the avatar inline color is the one sanctioned non-token color). getOrderedMapBadgeColors
        // is the SAME name-keyed source the maps-list and recent-map badges read, so all three match.
        // The first letter is preserved as textContent so the e2e badge assertion still holds.
        const badgeEl = this._currentMapCard.querySelector('#current-map-badge');
        if (badgeEl && this._currentMapName) {
            const badgeColors = await getOrderedMapBadgeColors();
            badgeEl.textContent = this._currentMapName.charAt(0).toUpperCase();
            badgeEl.style.backgroundColor = badgeColors[this._currentMapName] || MAP_BADGE_FALLBACK;
        }

        // Update lock state. A read-only remote session (viewer/commenter, or an anonymous
        // public-link visitor) ALWAYS presents as locked and can NEVER toggle the padlock.
        const readOnly = mapLockController.isReadOnly();
        const locked = readOnly || await isMapLocked(this._currentMapName);
        const lockBtn = this._currentMapCard.querySelector('#current-map-lock-btn');
        const notesBtn = this._currentMapCard.querySelector('#current-map-notes-btn');

        if (lockBtn) {
            // Only OWNER/ADMIN (or any offline user) may toggle the lock; the backend also enforces
            // OWNER, so a write user is blocked there too. A read-only session can never toggle it.
            const canToggle = !readOnly && mapLockController.canToggleLock();
            lockBtn.dataset.locked = locked.toString();
            lockBtn.innerHTML = locked ? MAPS_ICONS.lock : MAPS_ICONS.lockOpen;
            lockBtn.disabled = !canToggle;
            lockBtn.title = readOnly
                ? 'Somente leitura'
                : !canToggle
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

        // Resolve every map's position-based badge color once (same name-keyed source the
        // current-map card and recent-map shortcuts read, so a map's color matches everywhere).
        const badgeColors = await getOrderedMapBadgeColors();

        // Build map data with saved position, notes, and lock info
        for (const mapName of sortedMaps) {
            const [hasSavedPosition, hasNotes, locked] = await Promise.all([
                hasMapSavedPosition(mapName),
                hasMapNotes(mapName),
                isMapLocked(mapName)
            ]);
            const badgeColor = badgeColors[mapName] || MAP_BADGE_FALLBACK;
            const item = this._createMapListItem(mapName, hasSavedPosition, hasNotes, locked, badgeColor);
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
     * @param {boolean} locked - Whether the map is locked
     * @param {string} badgeColor - The map's persistent badge color
     * @returns {HTMLElement}
     */
    _createMapListItem(mapName, hasSavedPosition = false, hasNotes = false, locked = false, badgeColor = MAP_BADGE_FALLBACK) {
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

        // Single uppercase initial + the map's persistent palette color (passed in;
        // sanctioned non-token inline color) — kept consistent across the current-map
        // card, this list badge, and the collapsed-sidebar recent-map badge. Selection
        // is shown by the ring on --selected, NOT by recoloring the badge.
        const initials = escapeHtml(mapName.charAt(0).toUpperCase());

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
     * "Abrir" — leaves for the atlas screen, which is now the ONE place where you choose where to
     * work (local atlases and server projects side by side, plus opening a `.ebgeo`).
     *
     * It used to be a `.ebgeo` file picker that replaced the current project, guarded by a
     * destructive confirm. Both are gone: navigating loses nothing, and confirming a harmless
     * action is how a user is trained to click through the confirms that do matter.
     *
     * Delegated to AccountControl rather than a fresh `location.assign` — that path already
     * clears the local-map intent, and a second copy would drift from it.
     * @private
     */
    async _handleOpenProject() {
        const accountControl = getControl('account');
        if (!accountControl || typeof accountControl.openProjectPicker !== 'function') {
            showError('Tela de atlas indisponível');
            return;
        }

        try {
            await accountControl.openProjectPicker();
        } catch (error) {
            console.error('Failed to open the atlas screen:', error);
            showError('Falha ao abrir a tela de atlas');
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
     * "Salvar como local" — guarda uma cópia deste atlas de servidor neste computador.
     *
     * A ORDEM DO DIÁLOGO É DELIBERADA: primeiro a confirmação com as PERDAS, depois o nome.
     * Quem vai perder metade do acervo do atlas precisa poder desistir sem ter escolhido nome
     * nenhum — perguntar o nome antes transforma a desistência em trabalho jogado fora.
     *
     * A MEDIÇÃO DAS PERDAS É FEITA EM MEMÓRIA, sobre o documento de exportação, ANTES de
     * qualquer escrita: é a única forma de o aviso ser sobre o que vai acontecer e não sobre o
     * que já aconteceu. A cópia real é feita banco a banco (`saveActiveRemoteAtlasAsLocal`), com
     * o MESMO resolver.
     *
     * As duas contagens não são idênticas, e a direção da diferença é a que interessa: o
     * documento de exportação já filtrou lápides de sync e o podador de escopo atravessa o
     * documento CRU do disco, então o aviso pode contar de MENOS — nunca de mais, e só por
     * entradas que o usuário não vê de qualquer forma.
     * @private
     */
    async _handleSaveAsLocal() {
        if (!this._exportImportService) {
            showError('Serviço de exportação indisponível');
            return;
        }
        try {
            const { construirResolverDeSaida, descreverPerdas } =
                await import('@catalog/resource-reference.resolver.js');
            const { saveActiveRemoteAtlasAsLocal } = await import('@store/local-atlas.api.js');

            let resolver;
            try {
                resolver = await construirResolverDeSaida();
            } catch (error) {
                if (error?.name === 'ResourceSumMissingError') {
                    showError(error.message);
                    return;
                }
                throw error;
            }

            const mapNames = await getAllMapNamesStore();
            const { relatorio } = await this._exportImportService.buildPrunedExportData(mapNames);
            const perdas = descreverPerdas(relatorio);

            const seguir = await showConfirm('Guardar uma cópia deste atlas neste computador?', {
                message: perdas
                    ? 'A cópia sai do servidor, então ela nunca leva recurso de catálogo '
                        + 'restrito. Sai desta cópia:\n\n' + perdas
                        + '\n\nO conteúdo desenhado por você (feições, camadas, textos) vai inteiro.'
                    : 'A cópia fica só neste computador e deixa de receber as alterações dos '
                        + 'outros participantes.',
                confirmText: 'Salvar como local',
                cancelText: 'Cancelar',
            });
            if (!seguir) return;

            const nome = await showPrompt('Nome do atlas local:', `${this._atlasName || 'Atlas'} (local)`);
            if (!nome) return;

            const resultado = await saveActiveRemoteAtlasAsLocal(nome.trim(), resolver);
            if (!resultado.ok) return;
            showSuccess(`Cópia local "${resultado.atlas.name}" criada`);
        } catch (error) {
            console.error('Failed to save the remote atlas as local:', error);
            showError('Não foi possível salvar a cópia local');
        }
    }

    /**
     * Handles clearing all data.
     *
     * BEHAVIOUR IS UNCHANGED (`clearAllDataStore` empties the MOUNTED atlas and only it); the
     * TEXT is what changed. "TODO o atlas" dates from when local and remote shared one set of
     * databases, and with several named local atlases it reads as "everything on this machine".
     * Naming the atlas is the whole fix. The button is hidden on a server atlas, so the name
     * shown is always a local slot's; with no name available the wording degrades to the generic
     * sentence, never to "undefined".
     * @private
     */
    async _handleClearAll() {
        const name = this._resolveLocalAtlasName();
        const title = name ? `Limpar o atlas "${name}"?` : 'Limpar TODOS os dados deste atlas?';
        const scope = name
            ? `Isso apaga TODO o conteúdo do atlas "${name}" e NÃO pode ser desfeito:`
            : 'Isso apaga TODO o conteúdo deste atlas e NÃO pode ser desfeito:';

        const confirmed = await showConfirm(title, {
            message: `${scope}\n- Todos os mapas serão deletados\n- Todas as feições serão removidas\n- Posições e notas salvas serão perdidas\n\nOs seus outros atlas não são afetados. Esta ação é irreversível.`,
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
     * Abre as configurações DO PROJETO.
     *
     * Uma tela só, para qualquer atlas. Até 2026-08-16 este botão abria um modal exclusivo do
     * exagero vertical, enquanto "Configurar atlas" (recursos, mapas base, catálogo) vivia
     * escondido no menu da conta e só existia para o Gestor de um atlas de servidor. Eram duas
     * telas chamadas "Configurações", e a que o usuário local alcançava tinha um controle.
     *
     * O que o modal mostra ele decide sozinho a partir do que pode ser salvo: aparência sempre,
     * restrições de projeto só num atlas de servidor administrado por quem abriu.
     * @private
     */
    async _handleOpenSettings() {
        const { showAtlasSettingsModal } = await import('@modals/atlas-settings.modal.js');
        // POR HIERARQUIA, e não pela lista fechada que morava aqui. A ironia estava medida: o
        // `fileoverview` de `_canRenameAtlas`, oito linhas acima, explica em nove linhas por que
        // não se usa lista fechada, e esta linha escrevia uma. O posto do servidor é `manage`
        // (`PATCH /atlas/:atlasId/settings`), e `atlasRoleHasAtLeast` traduz o `UserRole` do
        // cliente para a escada antes de comparar.
        showAtlasSettingsModal(syncEngine.atlasId || null, {
            atlasName: this._atlasName || '',
            canManage: atlasRoleHasAtLeast(sessionContext.role, 'manage'),
        });
    }

    /**
     * "Compartilhar" — quem pode ver e editar este projeto do servidor.
     *
     * Fica ao lado de "Exportar" porque as duas respondem à mesma pergunta ("como isto sai
     * daqui"), e porque o único caminho até o compartilhamento era o menu da conta, que é onde
     * se procura por identidade, não por projeto.
     * @private
     */
    async _handleShare() {
        const atlasId = syncEngine.atlasId;
        if (!atlasId) return;
        const { showSharingModal } = await import('@modals/sharing.modal.js');
        showSharingModal(atlasId, { atlasName: this._atlasName || '' });
    }

    /**
     * Opens the SAME modal in read-only mode: who takes part in this atlas and at which level.
     *
     * WHY IT IS THE SAME MODAL. The screen is the answer to one question ("quem alcança este
     * atlas"), asked by two audiences with different authority. A second component would be a
     * second place to fix a row that renders a person's name.
     *
     * WHY IT IS A SEPARATE BUTTON, and not "Compartilhar" changing behaviour: a command whose
     * name promises writing and then shows a wall of text explaining you cannot write is worse
     * than a command named after what it actually does. `visibleAtlasActions` guarantees the two
     * are never on screen together.
     *
     * The presence source rides along (the live "Vendo agora" block) because it is display, not
     * authority: a Leitor already sees the online roster in the map.
     * @private
     * @returns {Promise<void>}
     */
    async _handleParticipants() {
        const atlasId = syncEngine.atlasId;
        if (!atlasId) return;
        const { showSharingModal } = await import('@modals/sharing.modal.js');
        showSharingModal(atlasId, { atlasName: this._atlasName || '', readOnly: true });
    }

    /**
     * Gets the container element.
     * @returns {HTMLElement|null}
     */
    getContainer() {
        return this._container;
    }

    /**
     * Refreshes the tab content. The atlas header is re-read too: the atlas may have been
     * renamed from the project screen in another tab while this one sat on a different tab.
     */
    refresh() {
        this._refreshAtlasHeader();
        this._loadMaps();
    }

    /**
     * Destroys the component.
     */
    destroy() {
        this._closeContextMenu();
        this._commentsPanel?.destroy();
        // Row-scoped listeners are flushed by cleanup(this) below.

        if (this._sortableInstance) {
            this._sortableInstance.destroy();
            this._sortableInstance = null;
        }

        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._actionButtons.clear();
        this._atlasHeader = null;
        this._atlasNameInput = null;
        this._atlasOriginChip = null;
    }
}
