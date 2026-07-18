// Path: js/modals/import-slides.modal.js

/**
 * @fileoverview Import slides modal.
 * Allows users to select briefings to import slides from into a target briefing.
 */

import { ModalBase } from './modal.base.js';
import { addDomListener, cleanup, removeElement } from '@utils/event-cleanup.js';
import { escapeHtml } from '@utils/html-escape.js';

/**
 * Icons used in the modal.
 */
const ICONS = {
    import: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
    </svg>`
};

/**
 * Import slides modal class.
 * @extends ModalBase
 */
export class ImportSlidesModal extends ModalBase {
    /**
     * @param {Object} options - Modal options
     * @param {string} options.targetBriefingName - Target briefing name
     * @param {Array<{id: string, name: string, slideCount: number}>} options.availableBriefings - Briefings to select from
     * @param {Function} options.onImport - Callback when import is confirmed, receives array of selected briefing IDs
     */
    constructor(options = {}) {
        super({
            id: 'import-slides-modal',
            title: 'Importar Slides',
            icon: ICONS.import
        });

        this._targetBriefingName = options.targetBriefingName || '';
        this._availableBriefings = options.availableBriefings || [];
        this._onImport = options.onImport || (() => {});
        this._selectedBriefings = new Set();
    }

    /**
     * Renders the modal content.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._container.classList.add('import-slides-modal-container');

        const body = this.getBody();
        body.innerHTML = this._createBodyContent();

        this._setupListeners();

        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * Creates the body content HTML.
     * @private
     * @returns {string}
     */
    _createBodyContent() {
        return `
            <div class="import-slides-modal-content">
                <div class="import-slides-description">
                    Selecione os briefings de onde deseja importar slides para <strong>"${escapeHtml(this._targetBriefingName)}"</strong>.
                    Os slides serão copiados para o final do briefing de destino.
                </div>

                <div class="import-slides-selection-controls">
                    <button type="button" class="import-slides-select-btn" data-action="select-all">
                        Selecionar todos
                    </button>
                    <button type="button" class="import-slides-select-btn" data-action="select-none">
                        Limpar seleção
                    </button>
                    <span class="import-slides-selection-count">
                        <span class="count-value">0</span> de <span class="count-total">${this._availableBriefings.length}</span> selecionados
                    </span>
                </div>

                <div class="import-slides-list" role="listbox" aria-label="Lista de briefings">
                    ${this._renderBriefingsList()}
                </div>

                <div class="import-slides-modal-actions">
                    <button type="button" class="import-slides-modal-btn import-slides-modal-btn-cancel">
                        Cancelar
                    </button>
                    <button type="button" class="import-slides-modal-btn import-slides-modal-btn-confirm" disabled>
                        ${ICONS.import}
                        <span>Importar</span>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Renders the briefings list HTML.
     * @private
     * @returns {string}
     */
    _renderBriefingsList() {
        if (this._availableBriefings.length === 0) {
            return `
                <div class="import-slides-empty">
                    Não há outros briefings disponíveis para importar
                </div>
            `;
        }

        return this._availableBriefings.map(briefing => {
            const initial = briefing.name.charAt(0).toUpperCase();
            const slideLabel = briefing.slideCount === 1 ? 'slide' : 'slides';
            return `
                <div class="import-slides-item" data-briefing-id="${escapeHtml(briefing.id)}" role="option" tabindex="0">
                    <span class="import-slides-checkbox-custom">
                        ${ICONS.check}
                    </span>
                    <span class="import-slides-badge">${escapeHtml(initial)}</span>
                    <span class="import-slides-name">${escapeHtml(briefing.name)}</span>
                    <span class="import-slides-count">${briefing.slideCount} ${slideLabel}</span>
                </div>
            `;
        }).join('');
    }

    /**
     * Sets up event listeners.
     * @private
     */
    _setupListeners() {
        const body = this.getBody();

        const selectAllBtn = body.querySelector('[data-action="select-all"]');
        addDomListener(this, selectAllBtn, 'click', () => this._selectAll());

        const selectNoneBtn = body.querySelector('[data-action="select-none"]');
        addDomListener(this, selectNoneBtn, 'click', () => this._selectNone());

        const cancelBtn = body.querySelector('.import-slides-modal-btn-cancel');
        addDomListener(this, cancelBtn, 'click', () => this.hide());

        const confirmBtn = body.querySelector('.import-slides-modal-btn-confirm');
        addDomListener(this, confirmBtn, 'click', () => this._handleImport());

        const items = body.querySelectorAll('.import-slides-item');
        items.forEach(item => {
            addDomListener(this, item, 'click', () => {
                const id = item.dataset.briefingId;
                this._handleCheckboxChange(id, !this._selectedBriefings.has(id));
            });

            addDomListener(this, item, 'keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const id = item.dataset.briefingId;
                    this._handleCheckboxChange(id, !this._selectedBriefings.has(id));
                }
            });
        });
    }

    /**
     * Shows the modal.
     */
    show() {
        this._selectedBriefings.clear();
        this._updateUI();
        super.show();
    }

    /**
     * Hides and destroys the modal (fire-and-forget).
     */
    hide() {
        super.hide();
        if (this._overlay) {
            cleanup(this);
            removeElement(this._overlay);
            this._overlay = null;
            this._container = null;
        }
    }

    /**
     * Handles checkbox state change.
     * @private
     * @param {string} briefingId - Briefing ID
     * @param {boolean} checked - Whether checked
     */
    _handleCheckboxChange(briefingId, checked) {
        if (checked) {
            this._selectedBriefings.add(briefingId);
        } else {
            this._selectedBriefings.delete(briefingId);
        }
        this._updateUI();
    }

    /**
     * Selects all briefings.
     * @private
     */
    _selectAll() {
        this._selectedBriefings.clear();
        for (const b of this._availableBriefings) {
            this._selectedBriefings.add(b.id);
        }
        this._updateUI();
    }

    /**
     * Deselects all briefings.
     * @private
     */
    _selectNone() {
        this._selectedBriefings.clear();
        this._updateUI();
    }

    /**
     * Updates UI based on selection state.
     * @private
     */
    _updateUI() {
        const body = this.getBody();

        const countSpan = body.querySelector('.count-value');
        countSpan.textContent = this._selectedBriefings.size;

        const confirmBtn = body.querySelector('.import-slides-modal-btn-confirm');
        const hasSelection = this._selectedBriefings.size > 0;
        confirmBtn.disabled = !hasSelection;

        const btnText = confirmBtn.querySelector('span');
        if (this._selectedBriefings.size === this._availableBriefings.length) {
            btnText.textContent = 'Importar de todos';
        } else if (this._selectedBriefings.size === 1) {
            btnText.textContent = 'Importar de 1 briefing';
        } else if (this._selectedBriefings.size > 1) {
            btnText.textContent = `Importar de ${this._selectedBriefings.size} briefings`;
        } else {
            btnText.textContent = 'Importar';
        }

        const items = body.querySelectorAll('.import-slides-item');
        items.forEach(item => {
            const id = item.dataset.briefingId;
            const isSelected = this._selectedBriefings.has(id);
            item.classList.toggle('selected', isSelected);
            item.setAttribute('aria-selected', String(isSelected));
        });
    }

    /**
     * Handles import confirmation.
     * @private
     */
    _handleImport() {
        if (this._selectedBriefings.size === 0) return;

        const selectedIds = Array.from(this._selectedBriefings);
        this.hide();
        this._onImport(selectedIds);
    }
}

/**
 * Helper function to show import slides modal.
 * @param {string} targetBriefingName - Target briefing name
 * @param {Array<{id: string, name: string, slideCount: number}>} availableBriefings - Available briefings
 * @param {Function} onImport - Callback when import is confirmed
 * @returns {ImportSlidesModal} Modal instance
 */
export function showImportSlidesModal(targetBriefingName, availableBriefings, onImport) {
    const modal = new ImportSlidesModal({
        targetBriefingName,
        availableBriefings,
        onImport
    });
    modal.render();
    modal.show();
    return modal;
}
