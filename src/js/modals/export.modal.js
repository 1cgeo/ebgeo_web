// Path: js/modals/export.modal.js

/**
 * @fileoverview Export modal for selecting maps to export.
 * Allows users to export all maps or a subset to .ebgeo file.
 */

import { ModalBase } from './modal.base.js';
import { addDomListener } from '../utilities/event-cleanup.js';
import { escapeHtml } from '../utilities/html-escape.js';
import { getAllMapNamesStore, getCurrentMapName } from '../store';

/**
 * Icons used in the modal
 */
const ICONS = {
    download: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>`,
    map: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
        <line x1="8" y1="2" x2="8" y2="18"/>
        <line x1="16" y1="6" x2="16" y2="22"/>
    </svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
    </svg>`
};

/**
 * Export modal for map selection.
 * @extends ModalBase
 */
export class ExportModal extends ModalBase {
    /**
     * @param {Object} options - Modal options
     * @param {Function} options.onExport - Callback when export is confirmed, receives array of map names
     */
    constructor(options = {}) {
        super({
            id: 'export-modal',
            title: 'Exportar Projeto',
            icon: ICONS.download
        });

        this._onExport = options.onExport || (() => {});
        this._maps = [];
        this._selectedMaps = new Set();
        this._currentMapName = null;
    }

    /**
     * Renders the modal content.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._container.classList.add('export-modal-container');

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
            <div class="export-modal-content">
                <div class="export-modal-description">
                    Selecione os mapas que deseja exportar para o arquivo .ebgeo
                </div>

                <div class="export-selection-controls">
                    <button type="button" class="export-select-btn" data-action="select-all">
                        Selecionar todos
                    </button>
                    <button type="button" class="export-select-btn" data-action="select-none">
                        Limpar seleção
                    </button>
                    <span class="export-selection-count">
                        <span class="count-value">0</span> de <span class="count-total">0</span> selecionados
                    </span>
                </div>

                <div class="export-maps-list" role="listbox" aria-label="Lista de mapas">
                    <!-- Maps will be rendered here -->
                </div>

                <div class="export-modal-actions">
                    <button type="button" class="export-modal-btn export-modal-btn-cancel">
                        Cancelar
                    </button>
                    <button type="button" class="export-modal-btn export-modal-btn-confirm" disabled>
                        ${ICONS.download}
                        <span>Exportar</span>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Sets up event listeners.
     * @private
     */
    _setupListeners() {
        const body = this.getBody();

        // Select all button
        const selectAllBtn = body.querySelector('[data-action="select-all"]');
        addDomListener(this, selectAllBtn, 'click', () => this._selectAll());

        // Select none button
        const selectNoneBtn = body.querySelector('[data-action="select-none"]');
        addDomListener(this, selectNoneBtn, 'click', () => this._selectNone());

        // Cancel button
        const cancelBtn = body.querySelector('.export-modal-btn-cancel');
        addDomListener(this, cancelBtn, 'click', () => this.hide());

        // Confirm button
        const confirmBtn = body.querySelector('.export-modal-btn-confirm');
        addDomListener(this, confirmBtn, 'click', () => this._handleExport());
    }

    /**
     * Shows the modal and loads available maps.
     */
    async show() {
        // Load maps before showing
        await this._loadMaps();
        this._renderMapsList();
        this._selectAll(); // Default to all selected

        super.show();
    }

    /**
     * Loads available maps from store.
     * @private
     */
    async _loadMaps() {
        this._maps = await getAllMapNamesStore();
        this._currentMapName = await getCurrentMapName();
    }

    /**
     * Renders the maps list.
     * @private
     */
    _renderMapsList() {
        const listContainer = this.getBody().querySelector('.export-maps-list');

        if (this._maps.length === 0) {
            listContainer.innerHTML = `
                <div class="export-maps-empty">
                    Nenhum mapa disponível para exportar
                </div>
            `;
            return;
        }

        listContainer.innerHTML = this._maps.map((mapName) => {
            const isCurrent = mapName === this._currentMapName;
            return `
                <label class="export-map-item ${isCurrent ? 'current-map' : ''}" data-map="${escapeHtml(mapName)}">
                    <input type="checkbox"
                           value="${escapeHtml(mapName)}"
                           class="export-map-checkbox"
                           aria-label="Selecionar ${escapeHtml(mapName)}">
                    <span class="export-map-checkbox-custom">
                        ${ICONS.check}
                    </span>
                    <span class="export-map-icon">${ICONS.map}</span>
                    <span class="export-map-name">${escapeHtml(mapName)}</span>
                    ${isCurrent ? '<span class="export-map-badge">Atual</span>' : ''}
                </label>
            `;
        }).join('');

        // Update total count
        const totalSpan = this.getBody().querySelector('.count-total');
        totalSpan.textContent = this._maps.length;

        // Add checkbox listeners
        const checkboxes = listContainer.querySelectorAll('.export-map-checkbox');
        checkboxes.forEach(checkbox => {
            addDomListener(this, checkbox, 'change', (e) => {
                this._handleCheckboxChange(e.target.value, e.target.checked);
            });
        });
    }

    /**
     * Handles checkbox state change.
     * @private
     * @param {string} mapName - Map name
     * @param {boolean} checked - Whether checked
     */
    _handleCheckboxChange(mapName, checked) {
        if (checked) {
            this._selectedMaps.add(mapName);
        } else {
            this._selectedMaps.delete(mapName);
        }

        this._updateUI();
    }

    /**
     * Selects all maps.
     * @private
     */
    _selectAll() {
        this._selectedMaps = new Set(this._maps);

        const checkboxes = this.getBody().querySelectorAll('.export-map-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = true;
        });

        this._updateUI();
    }

    /**
     * Deselects all maps.
     * @private
     */
    _selectNone() {
        this._selectedMaps.clear();

        const checkboxes = this.getBody().querySelectorAll('.export-map-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
        });

        this._updateUI();
    }

    /**
     * Updates UI based on selection state.
     * @private
     */
    _updateUI() {
        const body = this.getBody();

        // Update count
        const countSpan = body.querySelector('.count-value');
        countSpan.textContent = this._selectedMaps.size;

        // Update confirm button state
        const confirmBtn = body.querySelector('.export-modal-btn-confirm');
        const hasSelection = this._selectedMaps.size > 0;
        confirmBtn.disabled = !hasSelection;

        // Update button text
        const btnText = confirmBtn.querySelector('span');
        if (this._selectedMaps.size === this._maps.length) {
            btnText.textContent = 'Exportar todos';
        } else if (this._selectedMaps.size === 1) {
            btnText.textContent = 'Exportar 1 mapa';
        } else {
            btnText.textContent = `Exportar ${this._selectedMaps.size} mapas`;
        }

        // Update visual state of items
        const items = body.querySelectorAll('.export-map-item');
        items.forEach(item => {
            const mapName = item.dataset.map;
            item.classList.toggle('selected', this._selectedMaps.has(mapName));
        });
    }

    /**
     * Handles export confirmation.
     * @private
     */
    _handleExport() {
        if (this._selectedMaps.size === 0) return;

        const selectedMapsArray = Array.from(this._selectedMaps);
        this.hide();
        this._onExport(selectedMapsArray);
    }

    /**
     * Gets the currently selected maps.
     * @returns {string[]} Array of selected map names
     */
    getSelectedMaps() {
        return Array.from(this._selectedMaps);
    }
}

/**
 * Helper function to show export modal and get selected maps.
 * @param {Function} onExport - Callback when export is confirmed
 * @returns {ExportModal} Modal instance
 */
export function showExportModal(onExport) {
    const modal = new ExportModal({ onExport });
    modal.render();
    modal.show();
    return modal;
}
