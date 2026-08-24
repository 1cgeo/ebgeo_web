// Path: js/sidebar/tabs/briefings.tab.js

/**
 * @fileoverview Briefings tab component for sidebar.
 * Provides briefing management functionality: create, open (present), edit, delete.
 */

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
    getAllBriefings,
    deleteBriefing,
    createBriefing,
    generateUniqueBriefingName,
    createEmptySlide,
    addSlide
} from '@store/index.js';
import { EventTypes } from '@events/event_types.js';
import { showSuccess, showError, showWarning } from '@utils/index.js';
import { showConfirm } from '@modals/index.js';
import { checkPermission } from '@store/sync/permission-guard.js';
import { denialNotice } from '@store/denial-phrases.js';

/**
 * Icons specific to briefings tab.
 */
const BRIEFINGS_ICONS = {
    plusCircle: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,

    play: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,

    edit: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,

    trash: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,

    presentation: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,

    slides: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,

    pdf: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
};

/**
 * Briefings tab component.
 */
export class BriefingsTab {
    /**
     * @param {Object} dependencies - Required dependencies
     * @param {Object} dependencies.eventBus - EventBus instance
     * @param {Object} [dependencies.stateManager] - StateManager instance (optional)
     */
    constructor(dependencies) {
        this._eventBus = dependencies.eventBus;
        this._stateManager = dependencies.stateManager;

        this._container = null;
        this._briefingsList = null;
        this._isLoadingBriefings = false;

        // Callbacks for editor, presenter, and PDF export (to be set externally)
        this._onEditBriefing = null;
        this._onPresentBriefing = null;
        this._onExportPdf = null;

        setupCleanup(this);
    }

    /**
     * Sets the callback for editing a briefing.
     * @param {Function} callback - Callback function(briefingId)
     */
    setOnEditBriefing(callback) {
        this._onEditBriefing = callback;
    }

    /**
     * Sets the callback for presenting a briefing.
     * @param {Function} callback - Callback function(briefingId)
     */
    setOnPresentBriefing(callback) {
        this._onPresentBriefing = callback;
    }

    /**
     * Sets the callback for exporting a briefing as PDF.
     * @param {Function} callback - Callback function(briefingId)
     */
    setOnExportPdf(callback) {
        this._onExportPdf = callback;
    }

    /**
     * Creates the tab UI.
     * @returns {HTMLElement}
     */
    render() {
        this._container = document.createElement('div');
        this._container.className = 'sidebar-tab-content briefings-tab';

        // Create button
        const createBtn = this._createCreateButton();
        this._container.appendChild(createBtn);

        // Section header
        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'sidebar-section-header';
        sectionHeader.textContent = 'Seus Briefings';
        this._container.appendChild(sectionHeader);

        // Briefings list
        this._briefingsList = document.createElement('div');
        this._briefingsList.className = 'briefings-list';
        this._container.appendChild(this._briefingsList);

        // Setup event listeners
        this._setupEventListeners();

        // Load initial data
        this._loadBriefings();

        return this._container;
    }

    /**
     * Creates the main "Create Briefing" button.
     * @private
     * @returns {HTMLElement}
     */
    _createCreateButton() {
        const wrapper = document.createElement('div');
        wrapper.className = 'briefings-create-wrapper';

        const button = document.createElement('button');
        // `edit-affordance` põe este botão sob o mesmo regime das outras afordâncias de escrita:
        // `body.is-view-only` o esconde (`css/view-mode.css`), e quem liga essa classe é
        // `view-mode.controller.js`, pela MESMA capacidade que a criação de briefing exige
        // (`GuardAction.CREATE_BRIEFING` resolve para `canEdit`). Sem isso, um Leitor recebia o
        // botão, o briefing era batizado, e a recusa vinha da store depois.
        button.className = 'briefings-create-btn edit-affordance';
        button.innerHTML = `
            ${BRIEFINGS_ICONS.plusCircle}
            <span>CRIAR BRIEFING</span>
        `;

        addDomListener(this, button, 'click', () => this._handleCreateBriefing());
        wrapper.appendChild(button);

        const description = document.createElement('p');
        description.className = 'briefings-create-description';
        description.textContent = 'Briefings s\u00E3o apresenta\u00E7\u00F5es interativas que combinam slides narrativos com navega\u00E7\u00E3o no mapa 2D, visualizador 3D e fotos 360\u00B0.';
        wrapper.appendChild(description);

        return wrapper;
    }

    /**
     * Sets up event listeners for briefing changes.
     * @private
     */
    _setupEventListeners() {
        subscribe(this, this._eventBus, EventTypes.BRIEFING_CREATED, () => this._loadBriefings());
        subscribe(this, this._eventBus, EventTypes.BRIEFING_UPDATED, () => this._loadBriefings());
        subscribe(this, this._eventBus, EventTypes.BRIEFING_DELETED, () => this._loadBriefings());
    }

    /**
     * Loads and renders the briefings list.
     * @private
     */
    async _loadBriefings() {
        if (this._isLoadingBriefings) {
            return;
        }

        this._isLoadingBriefings = true;

        try {
            const briefings = await getAllBriefings();
            this._renderBriefingsList(briefings);
        } catch (error) {
            console.error('Error loading briefings:', error);
            this._renderEmptyState('Erro ao carregar briefings');
        } finally {
            this._isLoadingBriefings = false;
        }
    }

    /**
     * Renders the briefings list.
     * @private
     * @param {Array} briefings - Array of briefing objects
     */
    _renderBriefingsList(briefings) {
        clearScopedListeners(this, 'rows');
        this._briefingsList.innerHTML = '';

        if (!briefings || briefings.length === 0) {
            this._renderEmptyState();
            return;
        }

        briefings.forEach(briefing => {
            const card = this._createBriefingCard(briefing);
            this._briefingsList.appendChild(card);
        });
    }

    /**
     * Renders the empty state message.
     * @private
     * @param {string} [message] - Custom message
     */
    _renderEmptyState(message) {
        this._briefingsList.innerHTML = `
            <div class="briefings-empty-state">
                ${BRIEFINGS_ICONS.presentation}
                <p>${message || 'Nenhum briefing criado'}</p>
                <p class="briefings-empty-hint">Clique em "CRIAR BRIEFING" para começar</p>
            </div>
        `;
    }

    /**
     * Creates a briefing card element.
     * @private
     * @param {Object} briefing - Briefing data
     * @returns {HTMLElement}
     */
    _createBriefingCard(briefing) {
        const card = document.createElement('div');
        card.className = 'briefing-card';
        card.dataset.briefingId = briefing.id;

        const slideCount = briefing.slides?.length || 0;
        const updatedAt = this._formatDate(briefing.updatedAt);
        const initial = briefing.name.charAt(0).toUpperCase();

        card.innerHTML = `
            <div class="briefing-card-badge">${initial}</div>
            <div class="briefing-card-info">
                <div class="briefing-card-name">${escapeHtml(briefing.name)}</div>
                <div class="briefing-card-meta">
                    ${BRIEFINGS_ICONS.slides}
                    <span>${slideCount} ${slideCount === 1 ? 'slide' : 'slides'}</span>
                    <span class="briefing-card-separator">•</span>
                    <span>${updatedAt}</span>
                </div>
                ${briefing.description ? `<div class="briefing-card-description">${escapeHtml(this._truncateText(briefing.description, 60))}</div>` : ''}
            </div>
            <div class="briefing-card-actions">
                <button class="briefing-action-btn pdf-btn" title="Exportar PDF" data-action="pdf">
                    ${BRIEFINGS_ICONS.pdf}
                </button>
                <button class="briefing-action-btn edit-btn" title="Editar" data-action="edit">
                    ${BRIEFINGS_ICONS.edit}
                </button>
                <button class="briefing-action-btn delete-btn" title="Excluir" data-action="delete">
                    ${BRIEFINGS_ICONS.trash}
                </button>
            </div>
        `;

        // Action button handlers
        const pdfBtn = card.querySelector('.pdf-btn');
        const editBtn = card.querySelector('.edit-btn');
        const deleteBtn = card.querySelector('.delete-btn');

        addScopedDomListener(this, 'rows',pdfBtn, 'click', (e) => {
            e.stopPropagation();
            this._handleExportPdf(briefing.id);
        });

        addScopedDomListener(this, 'rows',editBtn, 'click', (e) => {
            e.stopPropagation();
            this._handleEditBriefing(briefing.id);
        });

        addScopedDomListener(this, 'rows',deleteBtn, 'click', (e) => {
            e.stopPropagation();
            this._handleDeleteBriefing(briefing.id, briefing.name);
        });

        // Card click opens presentation mode
        addScopedDomListener(this, 'rows',card, 'click', () => {
            this._handlePresentBriefing(briefing.id);
        });

        return card;
    }

    /**
     * Handles creating a new briefing.
     * @private
     */
    async _handleCreateBriefing() {
        // Segunda linha, atrás do `is-view-only` que esconde o botão: a despromoção que chega
        // entre o repintar e o clique, e o DOM velho. Recusa a ENTRADA e nomeia o motivo, como
        // `CommentOverlay.togglePlacement` já faz, em vez de deixar a store recusar depois de o
        // briefing ter sido nomeado.
        const perm = checkPermission('CREATE_BRIEFING');
        if (!perm.allowed) {
            showWarning(denialNotice(perm.required));
            return;
        }

        try {
            const name = await generateUniqueBriefingName();
            const briefing = await createBriefing({ name });

            // Add an empty slide
            await addSlide(briefing.id, createEmptySlide(0));

            showSuccess(`Briefing "${name}" criado`);

            // Emit event
            this._eventBus.emit(EventTypes.BRIEFING_CREATED, {
                briefingId: briefing.id,
                briefing
            });

            // Open editor for the new briefing
            if (this._onEditBriefing) {
                this._onEditBriefing(briefing.id);
            }
        } catch (error) {
            console.error('Error creating briefing:', error);
            showError('Erro ao criar briefing');
        }
    }

    /**
     * Handles editing a briefing.
     * @private
     * @param {string} briefingId - Briefing ID
     */
    _handleEditBriefing(briefingId) {
        if (this._onEditBriefing) {
            this._onEditBriefing(briefingId);
        } else {
            console.warn('No edit callback set for BriefingsTab');
        }
    }

    /**
     * Handles presenting a briefing.
     * @private
     * @param {string} briefingId - Briefing ID
     */
    _handlePresentBriefing(briefingId) {
        if (this._onPresentBriefing) {
            this._onPresentBriefing(briefingId);
        } else {
            console.warn('No present callback set for BriefingsTab');
        }
    }

    /**
     * Handles exporting a briefing as PDF.
     * @private
     * @param {string} briefingId - Briefing ID
     */
    _handleExportPdf(briefingId) {
        if (this._onExportPdf) {
            this._onExportPdf(briefingId);
        } else {
            console.warn('No PDF export callback set for BriefingsTab');
        }
    }

    /**
     * Handles deleting a briefing.
     * @private
     * @param {string} briefingId - Briefing ID
     * @param {string} briefingName - Briefing name for confirmation
     */
    async _handleDeleteBriefing(briefingId, briefingName) {
        const confirmed = await showConfirm(
            `Excluir o briefing "${briefingName}"?`,
            {
                message: 'Esta ação não pode ser desfeita.',
                destructive: true
            }
        );

        if (!confirmed) return;

        try {
            await deleteBriefing(briefingId);
            showSuccess(`Briefing "${briefingName}" excluido`);

            // Emit event
            this._eventBus.emit(EventTypes.BRIEFING_DELETED, { briefingId });
        } catch (error) {
            console.error('Error deleting briefing:', error);
            showError('Erro ao excluir briefing');
        }
    }

    /**
     * Formats a timestamp for display.
     * @private
     * @param {number} timestamp - Unix timestamp in milliseconds
     * @returns {string} Formatted date string
     */
    _formatDate(timestamp) {
        if (!timestamp) return '';

        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return 'Hoje';
        } else if (diffDays === 1) {
            return 'Ontem';
        } else if (diffDays < 7) {
            return `${diffDays} dias atrás`;
        } else {
            return date.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit'
            });
        }
    }

    /**
     * Truncates text to a maximum length.
     * @private
     * @param {string} text - Text to truncate
     * @param {number} maxLength - Maximum length
     * @returns {string} Truncated text
     */
    _truncateText(text, maxLength) {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength - 1) + '…';
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
        this._loadBriefings();
    }

    /**
     * Called when the tab is activated (shown).
     */
    onActivate() {
        this._loadBriefings();
    }

    /**
     * Called when the tab is deactivated (hidden).
     */
    onDeactivate() {
        // No cleanup needed
    }

    /**
     * Destroys the component.
     */
    destroy() {
        // Row-scoped listeners are flushed by cleanup(this).
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._briefingsList = null;
    }
}
