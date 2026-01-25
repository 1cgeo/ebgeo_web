// Path: js/modals/combine-maps.modal.js

/**
 * @fileoverview Combine maps modal.
 * Allows users to select maps to combine/merge into a target map.
 */

import { ModalBase } from './modal.base.js';
import { addDomListener } from '../utilities/event-cleanup.js';

/**
 * Icons used in the modal.
 */
const ICONS = {
    merge: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/>
        <path d="M16 6h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3"/>
        <line x1="12" y1="2" x2="12" y2="22"/>
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
 * Combine maps modal class.
 * @extends ModalBase
 */
export class CombineMapsModal extends ModalBase {
    /**
     * @param {Object} options - Modal options
     * @param {string} options.targetMapName - Target map name to combine into
     * @param {string[]} options.availableMaps - Array of available map names to select from
     * @param {Function} options.onCombine - Callback when combine is confirmed, receives array of selected map names
     */
    constructor(options = {}) {
        super({
            id: 'combine-maps-modal',
            title: 'Puxar Mapas',
            icon: ICONS.merge
        });

        this._targetMapName = options.targetMapName || '';
        this._availableMaps = options.availableMaps || [];
        this._onCombine = options.onCombine || (() => {});
        this._selectedMaps = new Set();
    }

    /**
     * Renders the modal content.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._container.classList.add('combine-maps-modal-container');

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
            <div class="combine-maps-modal-content">
                <div class="combine-maps-description">
                    Selecione os mapas que deseja puxar para <strong>"${this._escapeHtml(this._targetMapName)}"</strong>.
                    As feições serão copiadas para o mapa de destino.
                </div>

                <div class="combine-maps-selection-controls">
                    <button type="button" class="combine-maps-select-btn" data-action="select-all">
                        Selecionar todos
                    </button>
                    <button type="button" class="combine-maps-select-btn" data-action="select-none">
                        Limpar seleção
                    </button>
                    <span class="combine-maps-selection-count">
                        <span class="count-value">0</span> de <span class="count-total">${this._availableMaps.length}</span> selecionados
                    </span>
                </div>

                <div class="combine-maps-list" role="listbox" aria-label="Lista de mapas">
                    ${this._renderMapsList()}
                </div>

                <div class="combine-maps-modal-actions">
                    <button type="button" class="combine-maps-modal-btn combine-maps-modal-btn-cancel">
                        Cancelar
                    </button>
                    <button type="button" class="combine-maps-modal-btn combine-maps-modal-btn-confirm" disabled>
                        ${ICONS.merge}
                        <span>Combinar</span>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Renders the maps list HTML.
     * @private
     * @returns {string}
     */
    _renderMapsList() {
        if (this._availableMaps.length === 0) {
            return `
                <div class="combine-maps-empty">
                    Não há outros mapas disponíveis para combinar
                </div>
            `;
        }

        return this._availableMaps.map(mapName => {
            const initial = mapName.charAt(0).toUpperCase();
            return `
                <div class="combine-map-item" data-map="${this._escapeHtml(mapName)}" role="option" tabindex="0">
                    <span class="combine-map-checkbox-custom">
                        ${ICONS.check}
                    </span>
                    <span class="combine-map-badge">${initial}</span>
                    <span class="combine-map-name">${this._escapeHtml(mapName)}</span>
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

        // Select all button
        const selectAllBtn = body.querySelector('[data-action="select-all"]');
        addDomListener(this, selectAllBtn, 'click', () => this._selectAll());

        // Select none button
        const selectNoneBtn = body.querySelector('[data-action="select-none"]');
        addDomListener(this, selectNoneBtn, 'click', () => this._selectNone());

        // Cancel button
        const cancelBtn = body.querySelector('.combine-maps-modal-btn-cancel');
        addDomListener(this, cancelBtn, 'click', () => this.hide());

        // Confirm button
        const confirmBtn = body.querySelector('.combine-maps-modal-btn-confirm');
        addDomListener(this, confirmBtn, 'click', () => this._handleCombine());

        // Click on item row to toggle selection
        const items = body.querySelectorAll('.combine-map-item');
        items.forEach(item => {
            addDomListener(this, item, 'click', () => {
                const mapName = item.dataset.map;
                const isSelected = this._selectedMaps.has(mapName);
                this._handleCheckboxChange(mapName, !isSelected);
            });

            // Keyboard support
            addDomListener(this, item, 'keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const mapName = item.dataset.map;
                    const isSelected = this._selectedMaps.has(mapName);
                    this._handleCheckboxChange(mapName, !isSelected);
                }
            });
        });
    }

    /**
     * Shows the modal.
     */
    show() {
        // Reset selection
        this._selectedMaps.clear();
        this._updateUI();

        super.show();
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
        this._selectedMaps = new Set(this._availableMaps);
        this._updateUI();
    }

    /**
     * Deselects all maps.
     * @private
     */
    _selectNone() {
        this._selectedMaps.clear();
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
        const confirmBtn = body.querySelector('.combine-maps-modal-btn-confirm');
        const hasSelection = this._selectedMaps.size > 0;
        confirmBtn.disabled = !hasSelection;

        // Update button text
        const btnText = confirmBtn.querySelector('span');
        if (this._selectedMaps.size === this._availableMaps.length) {
            btnText.textContent = 'Combinar todos';
        } else if (this._selectedMaps.size === 1) {
            btnText.textContent = 'Combinar 1 mapa';
        } else {
            btnText.textContent = `Combinar ${this._selectedMaps.size} mapas`;
        }

        // Update visual state of items
        const items = body.querySelectorAll('.combine-map-item');
        items.forEach(item => {
            const mapName = item.dataset.map;
            item.classList.toggle('selected', this._selectedMaps.has(mapName));
        });
    }

    /**
     * Handles combine confirmation.
     * @private
     */
    _handleCombine() {
        if (this._selectedMaps.size === 0) return;

        const selectedMapsArray = Array.from(this._selectedMaps);
        this.hide();
        this._onCombine(selectedMapsArray);
    }

    /**
     * Gets the currently selected maps.
     * @returns {string[]} Array of selected map names
     */
    getSelectedMaps() {
        return Array.from(this._selectedMaps);
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
}

/**
 * Helper function to show combine maps modal.
 * @param {string} targetMapName - Target map name
 * @param {string[]} availableMaps - Available maps to select from
 * @param {Function} onCombine - Callback when combine is confirmed
 * @returns {CombineMapsModal} Modal instance
 */
export function showCombineMapsModal(targetMapName, availableMaps, onCombine) {
    const modal = new CombineMapsModal({
        targetMapName,
        availableMaps,
        onCombine
    });
    modal.render();
    modal.show();
    return modal;
}
