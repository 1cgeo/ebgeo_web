// Path: js/modals/coordinate-edit.modal.js

/**
 * @fileoverview Coordinate edit modal.
 * Allows users to edit coordinates of point-based features.
 */

import { ModalBase } from './modal.base.js';
import { addDomListener } from '@utils/event-cleanup.js';
import {
    COORDINATE_FORMATS,
    getPlaceholderForFormat,
    parseCoordinates,
    formatCoordinates
} from '@utils';

/**
 * Icons used in the modal.
 */
const ICONS = {
    edit: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>`
};

/**
 * Coordinate edit modal class.
 * @extends ModalBase
 */
export class CoordinateEditModal extends ModalBase {
    /**
     * @param {Object} options - Modal options
     * @param {number} options.lat - Current latitude
     * @param {number} options.lng - Current longitude
     * @param {string} [options.currentFormat='latlong'] - Current coordinate format
     * @param {Function} [options.onConfirm] - Callback when coordinates are confirmed (lat, lng)
     */
    constructor(options = {}) {
        super({
            id: 'coordinate-edit-modal',
            title: 'Editar Coordenadas',
            icon: ICONS.edit
        });

        this._lat = options.lat ?? 0;
        this._lng = options.lng ?? 0;
        this._currentFormat = options.currentFormat || 'latlong';
        this._onConfirm = options.onConfirm || (() => {});
        this._formatOptions = COORDINATE_FORMATS;

        this._formatSelect = null;
        this._coordinatesInput = null;
        this._validationMessage = null;
    }

    /**
     * Renders the modal content.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._container.classList.add('coordinate-edit-modal-container');

        const body = this.getBody();
        body.innerHTML = this._createBodyContent();

        this._cacheElements();
        this._setupListeners();
        this._loadInitialValue();

        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * Creates the body content HTML.
     * @private
     * @returns {string}
     */
    _createBodyContent() {
        const formatOptionsHtml = this._formatOptions.map(format => `
            <option value="${format.id}" ${format.id === this._currentFormat ? 'selected' : ''}>
                ${format.label}
            </option>
        `).join('');

        return `
            <div class="coordinate-edit-modal-content">
                <div class="coordinate-edit-modal-field">
                    <label class="coordinate-edit-modal-label" for="coord-edit-format-select">Formato</label>
                    <select id="coord-edit-format-select" class="coordinate-edit-modal-select">
                        ${formatOptionsHtml}
                    </select>
                </div>

                <div class="coordinate-edit-modal-field">
                    <label class="coordinate-edit-modal-label" for="coord-edit-input">Coordenadas</label>
                    <input
                        type="text"
                        id="coord-edit-input"
                        class="coordinate-edit-modal-input"
                        placeholder="${getPlaceholderForFormat(this._currentFormat)}"
                        autocomplete="off"
                    />
                    <div class="coordinate-edit-validation-message" id="coord-edit-validation"></div>
                </div>

                <div class="coordinate-edit-modal-actions">
                    <button type="button" class="coordinate-edit-modal-btn coordinate-edit-modal-btn-cancel" data-action="cancel">
                        Cancelar
                    </button>
                    <button type="button" class="coordinate-edit-modal-btn coordinate-edit-modal-btn-confirm" data-action="confirm">
                        Confirmar
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Caches DOM element references.
     * @private
     */
    _cacheElements() {
        const body = this.getBody();
        this._formatSelect = body.querySelector('#coord-edit-format-select');
        this._coordinatesInput = body.querySelector('#coord-edit-input');
        this._validationMessage = body.querySelector('#coord-edit-validation');
    }

    /**
     * Sets up event listeners.
     * @private
     */
    _setupListeners() {
        const body = this.getBody();

        // Format change
        addDomListener(this, this._formatSelect, 'change', () => {
            this._currentFormat = this._formatSelect.value;
            this._coordinatesInput.placeholder = getPlaceholderForFormat(this._currentFormat);
            this._loadInitialValue();
            this._clearValidation();
        });

        // Cancel button
        const cancelBtn = body.querySelector('[data-action="cancel"]');
        addDomListener(this, cancelBtn, 'click', () => this.hide());

        // Confirm button
        const confirmBtn = body.querySelector('[data-action="confirm"]');
        addDomListener(this, confirmBtn, 'click', () => this._handleConfirm());

        // Enter key in input
        addDomListener(this, this._coordinatesInput, 'keydown', (e) => {
            if (e.key === 'Enter') {
                this._handleConfirm();
            }
        });

        // Clear validation on input
        addDomListener(this, this._coordinatesInput, 'input', () => {
            this._clearValidation();
        });
    }

    /**
     * Loads the initial formatted value into the input.
     * @private
     */
    async _loadInitialValue() {
        if (this._coordinatesInput) {
            this._coordinatesInput.value = 'Carregando...';
            const formatted = await formatCoordinates(this._lat, this._lng, this._currentFormat);
            this._coordinatesInput.value = formatted;
        }
    }

    /**
     * Shows the modal.
     * @param {Object} [options] - Optional parameters to update
     * @param {number} [options.lat] - New latitude
     * @param {number} [options.lng] - New longitude
     * @param {string} [options.format] - New format
     */
    show(options = {}) {
        if (options.lat !== undefined) this._lat = options.lat;
        if (options.lng !== undefined) this._lng = options.lng;
        if (options.format) {
            this._currentFormat = options.format;
            if (this._formatSelect) {
                this._formatSelect.value = options.format;
                this._coordinatesInput.placeholder = getPlaceholderForFormat(options.format);
            }
        }

        this._clearValidation();
        this._loadInitialValue();

        super.show();

        // Focus input
        requestAnimationFrame(() => {
            if (this._coordinatesInput) {
                this._coordinatesInput.focus();
                this._coordinatesInput.select();
            }
        });
    }

    /**
     * Handles confirm action.
     * @private
     */
    async _handleConfirm() {
        const inputValue = this._coordinatesInput.value.trim();

        if (!inputValue || inputValue === 'Carregando...') {
            this._showValidationError('Digite as coordenadas');
            return;
        }

        const coordinates = await parseCoordinates(inputValue, this._currentFormat);

        if (!coordinates) {
            this._showValidationError('Coordenadas inválidas para o formato selecionado');
            return;
        }

        this._onConfirm(coordinates.lat, coordinates.lng);
        this.hide();
    }

    /**
     * Shows a validation error message.
     * @private
     * @param {string} message - Error message
     */
    _showValidationError(message) {
        this._validationMessage.textContent = message;
        this._validationMessage.classList.add('error');
        this._coordinatesInput.classList.add('input-error');
    }

    /**
     * Clears the validation message.
     * @private
     */
    _clearValidation() {
        if (this._validationMessage) {
            this._validationMessage.textContent = '';
            this._validationMessage.classList.remove('error');
        }
        if (this._coordinatesInput) {
            this._coordinatesInput.classList.remove('input-error');
        }
    }

    /**
     * Gets the current coordinate format.
     * @returns {string}
     */
    getCurrentFormat() {
        return this._currentFormat;
    }

    /**
     * Sets the confirm callback.
     * @param {Function} callback - Callback function (lat, lng)
     */
    setOnConfirm(callback) {
        this._onConfirm = callback;
    }
}

/**
 * Helper function to show coordinate edit modal.
 * Creates and shows a modal for editing coordinates.
 *
 * @param {Object} options - Modal options
 * @param {number} options.lat - Current latitude
 * @param {number} options.lng - Current longitude
 * @param {string} [options.currentFormat='latlong'] - Current coordinate format
 * @param {Function} [options.onConfirm] - Callback when coordinates are confirmed (lat, lng)
 * @returns {CoordinateEditModal} Modal instance
 *
 * @example
 * showCoordinateEditModal({
 *     lat: -23.5505,
 *     lng: -46.6333,
 *     currentFormat: 'latlong',
 *     onConfirm: (lat, lng) => {
 *         console.log('New coordinates:', lat, lng);
 *     }
 * });
 */
export function showCoordinateEditModal(options) {
    const modal = new CoordinateEditModal(options);
    modal.render();
    modal.show();
    return modal;
}
