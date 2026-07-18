// Path: js/phone/phone-feature-editor.js

/**
 * @fileoverview Feature detail/edit view component for phone layout (<=480px).
 * Renders feature information inside the bottom sheet with read-only,
 * edit, and move modes. Pure UI component — no store imports.
 */

import { setupCleanup, addDomListener, cleanup, removeElement } from '@utils/event-cleanup.js';
import { getFeatureIcon16 } from './phone-icons.constants.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** @enum {string} Component view modes */
const Mode = Object.freeze({
    READ: 'read',
    EDIT: 'edit',
    MOVE: 'move',
});

/**
 * Property names that indicate a color value.
 * @type {Set<string>}
 */
const COLOR_PROPERTY_NAMES = new Set(['cor', 'color', 'cor_preenchimento', 'cor_borda']);

/** SVG icon for the edit button */
const EDIT_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

/** SVG icon for the move button */
const MOVE_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Detect the appropriate input type for a property.
 * @param {string} name - Property name
 * @param {*} value - Property value
 * @returns {'color'|'number'|'checkbox'|'text'} Input type
 */
function detectPropertyInputType(name, value) {
    const lowerName = name.toLowerCase();
    if (COLOR_PROPERTY_NAMES.has(lowerName) || lowerName.includes('cor') || lowerName.includes('color')) {
        return 'color';
    }
    if (typeof value === 'number') {
        return 'number';
    }
    if (typeof value === 'boolean') {
        return 'checkbox';
    }
    return 'text';
}

/**
 * Format a property value for display.
 * @param {*} value - The property value
 * @returns {string} Display string
 */
function formatPropertyValue(value) {
    if (value === null || value === undefined) {
        return '\u2014';
    }
    if (typeof value === 'boolean') {
        return value ? 'Sim' : 'N\u00e3o';
    }
    return String(value);
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Phone feature editor component.
 * Shows feature detail view with read-only, edit, and move modes.
 */
export class PhoneFeatureEditor {
    constructor() {
        setupCleanup(this);

        /** @private */
        this._container = null;
        /** @private */
        this._mode = Mode.READ;
        /** @private */
        this._featureData = null;
        /** @private */
        this._editValues = null;

        // Callbacks
        /** @private */
        this._saveCallback = null;
        /** @private */
        this._moveStartCallback = null;

        // DOM references (set during render)
        /** @private */
        this._headerEl = null;
        /** @private */
        this._actionsEl = null;
        /** @private */
        this._propertiesEl = null;
        /** @private */
        this._editActionsEl = null;
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    /**
     * Append container to parent element.
     * @param {HTMLElement} parent
     */
    mount(parent) {
        this._container = document.createElement('div');
        this._container.className = 'phone-feature-detail';
        parent.appendChild(this._container);
        this._renderEmpty();
    }

    /**
     * Remove from DOM and clean up all listeners.
     */
    destroy() {
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._featureData = null;
        this._editValues = null;
        this._saveCallback = null;
        this._moveStartCallback = null;
        this._headerEl = null;
        this._actionsEl = null;
        this._propertiesEl = null;
        this._editActionsEl = null;
    }

    /**
     * Render a feature detail view.
     * @param {Object} featureData
     * @param {string} featureData.id - Feature UUID
     * @param {string} featureData.type - Feature type (point, polygon, etc.)
     * @param {string} featureData.name - Display name
     * @param {string} featureData.layerName - Parent layer name
     * @param {string} featureData.color - Feature color hex
     * @param {Object} featureData.properties - Key-value display properties
     */
    showFeature(featureData) {
        this._featureData = featureData;
        this._mode = Mode.READ;
        this._editValues = null;
        this._renderFeature();
    }

    /**
     * Clear feature content and return to empty state.
     */
    clear() {
        this._featureData = null;
        this._mode = Mode.READ;
        this._editValues = null;
        this._renderEmpty();
    }

    /**
     * Check if currently in edit mode.
     * @returns {boolean}
     */
    isEditing() {
        return this._mode === Mode.EDIT;
    }

    /**
     * Check if currently in move mode.
     * @returns {boolean}
     */
    isMoving() {
        return this._mode === Mode.MOVE;
    }

    /**
     * Exit move mode and return to read-only view.
     */
    exitMoveMode() {
        if (this._mode !== Mode.MOVE) return;
        this._mode = Mode.READ;
        if (this._featureData) {
            this._renderFeature();
        }
    }

    /**
     * Register a callback for feature save.
     * @param {function(string, Object): void} callback - Called with (featureId, updatedProperties)
     */
    onSave(callback) {
        if (typeof callback === 'function') {
            this._saveCallback = callback;
        }
    }

    /**
     * Register a callback for move mode start.
     * @param {function(string): void} callback - Called with featureId
     */
    onMoveStart(callback) {
        if (typeof callback === 'function') {
            this._moveStartCallback = callback;
        }
    }

    /**
     * Return the container element (for bottom sheet to mount).
     * @returns {HTMLElement|null}
     */
    getElement() {
        return this._container;
    }

    /**
     * Return the current feature data (read-only access for the orchestrator).
     * @returns {Object|null}
     */
    getFeatureData() {
        return this._featureData;
    }

    // ========================================================================
    // RENDERING
    // ========================================================================

    /**
     * Render the empty state (no feature selected).
     * @private
     */
    _renderEmpty() {
        if (!this._container) return;
        this._clearContainer();

        const emptyEl = document.createElement('div');
        emptyEl.className = 'phone-feature-detail__empty';
        emptyEl.textContent = 'Nenhuma fei\u00e7\u00e3o selecionada';
        this._container.appendChild(emptyEl);
    }

    /**
     * Render the feature detail view in read-only mode.
     * @private
     */
    _renderFeature() {
        if (!this._container || !this._featureData) return;
        this._clearContainer();

        this._renderHeader();
        this._renderActions();
        this._renderProperties();
    }

    /**
     * Clear all container content and tracked DOM listeners.
     * @private
     */
    _clearContainer() {
        // Clean up existing DOM listeners before clearing
        cleanup(this);
        setupCleanup(this);

        if (this._container) {
            this._container.textContent = '';
        }
        this._headerEl = null;
        this._actionsEl = null;
        this._propertiesEl = null;
        this._editActionsEl = null;
    }

    /**
     * Render the feature header (icon + title + subtitle).
     * @private
     */
    _renderHeader() {
        const data = this._featureData;

        this._headerEl = document.createElement('div');
        this._headerEl.className = 'phone-feature-detail__header';

        // Icon
        const iconEl = document.createElement('div');
        iconEl.className = 'phone-feature-detail__icon';
        if (data.color) {
            iconEl.style.background = data.color;
            iconEl.style.color = 'white';
        }
        iconEl.innerHTML = getFeatureIcon16(data.type);

        // Title / subtitle wrapper
        const textWrapper = document.createElement('div');

        const titleEl = document.createElement('div');
        titleEl.className = 'phone-feature-detail__title';
        titleEl.textContent = data.name || 'Sem nome';

        const subtitleEl = document.createElement('div');
        subtitleEl.className = 'phone-feature-detail__subtitle';
        subtitleEl.textContent = `Camada: ${data.layerName || '\u2014'}`;

        textWrapper.appendChild(titleEl);
        textWrapper.appendChild(subtitleEl);

        this._headerEl.appendChild(iconEl);
        this._headerEl.appendChild(textWrapper);
        this._container.appendChild(this._headerEl);
    }

    /**
     * Render action buttons (Editar, Mover) in read mode.
     * @private
     */
    _renderActions() {
        this._actionsEl = document.createElement('div');
        this._actionsEl.className = 'phone-feature-detail__actions';

        // Edit button
        const editBtn = document.createElement('button');
        editBtn.className = 'phone-feature-detail__action-btn phone-feature-detail__action-btn--primary';
        editBtn.title = 'Editar';
        editBtn.innerHTML = EDIT_ICON;
        addDomListener(this, editBtn, 'click', this._onEditClick.bind(this));

        // Move button
        const moveBtn = document.createElement('button');
        moveBtn.className = 'phone-feature-detail__action-btn';
        moveBtn.title = 'Mover';
        moveBtn.innerHTML = MOVE_ICON;
        addDomListener(this, moveBtn, 'click', this._onMoveClick.bind(this));

        this._actionsEl.appendChild(editBtn);
        this._actionsEl.appendChild(moveBtn);
        this._container.appendChild(this._actionsEl);
    }

    /**
     * Render properties list in read-only mode.
     * @private
     */
    _renderProperties() {
        const properties = this._featureData.properties;
        if (!properties || Object.keys(properties).length === 0) return;

        this._propertiesEl = document.createElement('div');
        this._propertiesEl.className = 'phone-feature-detail__properties';

        for (const [key, value] of Object.entries(properties)) {
            const row = document.createElement('div');
            row.className = 'phone-feature-detail__property';

            const labelEl = document.createElement('span');
            labelEl.className = 'phone-feature-detail__property-label';
            labelEl.textContent = key;

            const valueEl = document.createElement('span');
            valueEl.className = 'phone-feature-detail__property-value';
            valueEl.textContent = formatPropertyValue(value);

            row.appendChild(labelEl);
            row.appendChild(valueEl);
            this._propertiesEl.appendChild(row);
        }

        this._container.appendChild(this._propertiesEl);
    }

    /**
     * Render properties list in edit mode with input fields.
     * @private
     */
    _renderEditMode() {
        if (!this._container || !this._featureData) return;
        this._clearContainer();

        // Re-render header (non-editable)
        this._renderHeader();

        const properties = this._featureData.properties || {};
        this._editValues = { ...properties };

        // Editable properties
        this._propertiesEl = document.createElement('div');
        this._propertiesEl.className = 'phone-feature-detail__properties';

        for (const [key, value] of Object.entries(properties)) {
            const inputType = detectPropertyInputType(key, value);
            const row = document.createElement('div');
            row.className = 'phone-feature-detail__property';

            const labelEl = document.createElement('span');
            labelEl.className = 'phone-feature-detail__property-label';
            labelEl.textContent = key;

            const input = document.createElement('input');
            input.className = 'phone-feature-detail__property-input';
            input.dataset.key = key;

            switch (inputType) {
            case 'color':
                input.type = 'color';
                input.value = typeof value === 'string' ? value : '#000000';
                break;
            case 'number':
                input.type = 'number';
                input.value = value;
                input.step = 'any';
                break;
            case 'checkbox':
                input.type = 'checkbox';
                input.checked = Boolean(value);
                break;
            case 'text':
            default:
                input.type = 'text';
                input.value = value != null ? String(value) : '';
                break;
            }

            addDomListener(this, input, 'input', this._onPropertyInput.bind(this));

            row.appendChild(labelEl);
            row.appendChild(input);
            this._propertiesEl.appendChild(row);
        }

        this._container.appendChild(this._propertiesEl);

        // Sticky save/cancel actions
        this._editActionsEl = document.createElement('div');
        this._editActionsEl.className = 'phone-feature-detail__edit-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'phone-feature-detail__edit-btn phone-feature-detail__edit-btn--cancel';
        cancelBtn.textContent = 'Cancelar';
        addDomListener(this, cancelBtn, 'click', this._onCancelEdit.bind(this));

        const saveBtn = document.createElement('button');
        saveBtn.className = 'phone-feature-detail__edit-btn phone-feature-detail__edit-btn--save';
        saveBtn.textContent = 'Salvar';
        addDomListener(this, saveBtn, 'click', this._onSaveEdit.bind(this));

        this._editActionsEl.appendChild(cancelBtn);
        this._editActionsEl.appendChild(saveBtn);
        this._container.appendChild(this._editActionsEl);
    }

    // ========================================================================
    // EVENT HANDLERS
    // ========================================================================

    /**
     * Handle edit button click — switch to edit mode.
     * @private
     */
    _onEditClick() {
        if (!this._featureData) return;
        this._mode = Mode.EDIT;
        this._renderEditMode();
    }

    /**
     * Handle move button click — fire move callback.
     * @private
     */
    _onMoveClick() {
        if (!this._featureData) return;
        this._mode = Mode.MOVE;

        if (typeof this._moveStartCallback === 'function') {
            this._moveStartCallback(this._featureData.id);
        }
    }

    /**
     * Handle property input changes during edit mode.
     * @param {Event} e
     * @private
     */
    _onPropertyInput(e) {
        const input = e.target;
        const key = input.dataset.key;
        if (!key || !this._editValues) return;

        if (input.type === 'checkbox') {
            this._editValues[key] = input.checked;
        } else if (input.type === 'number') {
            this._editValues[key] = input.value === '' ? 0 : Number(input.value);
        } else {
            this._editValues[key] = input.value;
        }
    }

    /**
     * Handle save button click — fire save callback and return to read mode.
     * @private
     */
    _onSaveEdit() {
        if (!this._featureData || !this._editValues) return;

        if (typeof this._saveCallback === 'function') {
            this._saveCallback(this._featureData.id, { ...this._editValues });
        }

        // Update local feature data with saved values
        this._featureData.properties = { ...this._editValues };
        this._mode = Mode.READ;
        this._editValues = null;
        this._renderFeature();
    }

    /**
     * Handle cancel button click — revert to read-only view.
     * @private
     */
    _onCancelEdit() {
        this._mode = Mode.READ;
        this._editValues = null;
        if (this._featureData) {
            this._renderFeature();
        }
    }
}
