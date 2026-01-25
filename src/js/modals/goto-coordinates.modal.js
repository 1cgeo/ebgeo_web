// Path: js/modals/goto-coordinates.modal.js

/**
 * @fileoverview Go to coordinates modal.
 * Allows users to navigate to specific coordinates and create features at those locations.
 */

import { ModalBase } from './modal.base.js';
import { addDomListener } from '../utilities/event-cleanup.js';
import {
    COORDINATE_FORMATS,
    getPlaceholderForFormat,
    parseCoordinates
} from '../utilities';

/**
 * Icons used in the modal.
 */
const ICONS = {
    navigation: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="3 11 22 2 13 21 11 13 3 11"/>
    </svg>`,
    mapPin: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
        <circle cx="12" cy="10" r="3"/>
    </svg>`,
    plus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>`
};

/**
 * Go to coordinates modal class.
 * @extends ModalBase
 */
export class GoToCoordinatesModal extends ModalBase {
    /**
     * @param {Object} options - Modal options
     * @param {Function} options.onFlyTo - Callback when flying to coordinates
     * @param {Function} options.onCreatePoint - Callback to create a point
     * @param {Function} options.onCreateMilitarySymbol - Callback to create a military symbol
     * @param {Function} options.onCreateCoordinationMeasure - Callback to create a coordination measure
     * @param {string} [options.currentFormat='latlong'] - Current coordinate format
     */
    constructor(options = {}) {
        super({
            id: 'goto-coordinates-modal',
            title: 'Ir para Coordenadas',
            icon: ICONS.navigation
        });

        this._onFlyTo = options.onFlyTo || (() => {});
        this._onCreatePoint = options.onCreatePoint || (() => {});
        this._onCreateMilitarySymbol = options.onCreateMilitarySymbol || (() => {});
        this._onCreateCoordinationMeasure = options.onCreateCoordinationMeasure || (() => {});
        this._currentFormat = options.currentFormat || 'latlong';
        this._formatOptions = COORDINATE_FORMATS;

        this._formatSelect = null;
        this._coordinatesInput = null;
        this._validationMessage = null;
        this._createTypeSelect = null;
    }

    /**
     * Renders the modal content.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._container.classList.add('goto-modal-container');

        const body = this.getBody();
        body.innerHTML = this._createBodyContent();

        this._cacheElements();
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
        const formatOptionsHtml = this._formatOptions.map(format => `
            <option value="${format.id}" ${format.id === this._currentFormat ? 'selected' : ''}>
                ${format.label}
            </option>
        `).join('');

        return `
            <div class="goto-modal-content">
                <div class="goto-modal-field">
                    <label class="goto-modal-label" for="goto-format-select">Formato</label>
                    <select id="goto-format-select" class="goto-modal-select">
                        ${formatOptionsHtml}
                    </select>
                </div>

                <div class="goto-modal-field">
                    <label class="goto-modal-label" for="goto-coordinates-input">Coordenadas</label>
                    <div class="goto-modal-input-row">
                        <input
                            type="text"
                            id="goto-coordinates-input"
                            class="goto-modal-input"
                            placeholder="${getPlaceholderForFormat(this._currentFormat)}"
                            autocomplete="off"
                        />
                        <button type="button" class="goto-modal-btn goto-modal-btn-primary" data-action="fly">
                            ${ICONS.mapPin}
                            <span>Ir para</span>
                        </button>
                    </div>
                    <div class="goto-validation-message" id="goto-validation"></div>
                </div>

                <div class="goto-modal-divider">
                    <span>ou criar feição</span>
                </div>

                <div class="goto-modal-create-section">
                    <select id="goto-create-type" class="goto-modal-select">
                        <option value="point">Ponto</option>
                        <option value="military">Simbologia militar</option>
                        <option value="coordination">Medida de coordenação</option>
                    </select>
                    <button type="button" class="goto-modal-btn goto-modal-btn-create" data-action="create">
                        ${ICONS.plus}
                        <span>Criar</span>
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
        this._formatSelect = body.querySelector('#goto-format-select');
        this._coordinatesInput = body.querySelector('#goto-coordinates-input');
        this._validationMessage = body.querySelector('#goto-validation');
        this._createTypeSelect = body.querySelector('#goto-create-type');
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
            this._clearValidation();
        });

        // Fly to button
        const flyBtn = body.querySelector('[data-action="fly"]');
        addDomListener(this, flyBtn, 'click', () => this._handleFlyTo());

        // Create button
        const createBtn = body.querySelector('[data-action="create"]');
        addDomListener(this, createBtn, 'click', () => this._handleCreate());

        // Enter key in input
        addDomListener(this, this._coordinatesInput, 'keydown', (e) => {
            if (e.key === 'Enter') {
                this._handleFlyTo();
            }
        });

        // Clear validation on input
        addDomListener(this, this._coordinatesInput, 'input', () => {
            this._clearValidation();
        });
    }

    /**
     * Shows the modal.
     * @param {string} [format] - Optional format to set
     */
    show(format) {
        if (format) {
            this._currentFormat = format;
            if (this._formatSelect) {
                this._formatSelect.value = format;
                this._coordinatesInput.placeholder = getPlaceholderForFormat(format);
            }
        }

        // Clear previous input
        if (this._coordinatesInput) {
            this._coordinatesInput.value = '';
        }
        this._clearValidation();

        super.show();

        // Focus input
        requestAnimationFrame(() => {
            if (this._coordinatesInput) {
                this._coordinatesInput.focus();
            }
        });
    }

    /**
     * Handles fly to coordinates action.
     * @private
     */
    async _handleFlyTo() {
        const coordinates = await this._parseInput();
        if (!coordinates) return;

        this._onFlyTo(coordinates.lng, coordinates.lat);
        this.hide();
    }

    /**
     * Handles create feature action.
     * @private
     */
    async _handleCreate() {
        const coordinates = await this._parseInput();
        if (!coordinates) return;

        const createType = this._createTypeSelect.value;

        switch (createType) {
            case 'point':
                this._onCreatePoint(coordinates.lng, coordinates.lat);
                break;
            case 'military':
                this._onCreateMilitarySymbol(coordinates.lng, coordinates.lat);
                break;
            case 'coordination':
                this._onCreateCoordinationMeasure(coordinates.lng, coordinates.lat);
                break;
        }

        this.hide();
    }

    /**
     * Parses the coordinates input.
     * @private
     * @returns {Promise<{lng: number, lat: number}|null>}
     */
    async _parseInput() {
        const inputValue = this._coordinatesInput.value.trim();

        if (!inputValue) {
            this._showValidationError('Digite as coordenadas');
            return null;
        }

        const coordinates = await parseCoordinates(inputValue, this._currentFormat);

        if (!coordinates) {
            this._showValidationError('Coordenadas inválidas para o formato selecionado');
            return null;
        }

        return coordinates;
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
        this._validationMessage.textContent = '';
        this._validationMessage.classList.remove('error');
        this._coordinatesInput.classList.remove('input-error');
    }

    /**
     * Gets the current coordinate format.
     * @returns {string}
     */
    getCurrentFormat() {
        return this._currentFormat;
    }

    /**
     * Sets the current coordinate format.
     * @param {string} format - Format ID
     */
    setCurrentFormat(format) {
        this._currentFormat = format;
        if (this._formatSelect) {
            this._formatSelect.value = format;
            this._coordinatesInput.placeholder = getPlaceholderForFormat(format);
        }
    }
}

/**
 * Helper function to show go to coordinates modal.
 * @param {Object} options - Modal options
 * @returns {GoToCoordinatesModal} Modal instance
 */
export function showGoToCoordinatesModal(options) {
    const modal = new GoToCoordinatesModal(options);
    modal.render();
    modal.show(options.currentFormat);
    return modal;
}
