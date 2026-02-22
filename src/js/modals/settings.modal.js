// Path: js/modals/settings.modal.js

/**
 * @module modals/settings-modal
 * @description Atlas settings modal with terrain exaggeration control.
 * @dependencies utilities/event-cleanup, store/repositories/index, store/atlas/atlas.entity
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement
} from '../utilities/event-cleanup.js';
import { getRepository } from '../store/repositories/index.js';
import { DEFAULT_TERRAIN_EXAGGERATION } from '../store/atlas/atlas.entity.js';

const MIN_EXAGGERATION = 1;
const MAX_EXAGGERATION = 3;
const STEP_EXAGGERATION = 0.1;
const PERSIST_DEBOUNCE_MS = 300;

/**
 * Settings modal for atlas-wide configuration.
 */
export class SettingsModal {
    /**
     * @param {Object} config
     * @param {number} [config.currentExaggeration] - Current terrain exaggeration value
     * @param {function(number): void} [config.onExaggerationChanged] - Live update callback
     */
    constructor(config = {}) {
        this._onExaggerationChanged = config.onExaggerationChanged || null;
        this._currentExaggeration = config.currentExaggeration ?? DEFAULT_TERRAIN_EXAGGERATION;
        this._overlay = null;
        this._container = null;
        this._resolvePromise = null;
        this._previousActiveElement = null;
        this._persistTimer = null;

        setupCleanup(this);
    }

    /**
     * Shows the settings modal.
     * @returns {Promise<number>} Final exaggeration value when modal is closed
     */
    show() {
        return new Promise((resolve) => {
            this._resolvePromise = resolve;
            this._previousActiveElement = document.activeElement;
            this._render();
            document.body.appendChild(this._overlay);

            requestAnimationFrame(() => {
                this._overlay.dataset.visible = 'true';
            });
        });
    }

    /**
     * Builds the modal DOM.
     * @private
     */
    _render() {
        this._overlay = document.createElement('div');
        this._overlay.className = 'modal-overlay settings-modal-overlay';
        this._overlay.setAttribute('role', 'dialog');
        this._overlay.setAttribute('aria-modal', 'true');
        this._overlay.dataset.visible = 'false';

        this._container = document.createElement('div');
        this._container.className = 'modal-container settings-modal-container';

        // Header
        const header = document.createElement('div');
        header.className = 'modal-header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'modal-title-wrap';

        const titleIcon = document.createElement('span');
        titleIcon.className = 'modal-title-icon';
        titleIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
        titleWrap.appendChild(titleIcon);

        const title = document.createElement('h2');
        title.className = 'modal-title';
        title.textContent = 'Configurações';
        titleWrap.appendChild(title);

        header.appendChild(titleWrap);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close-btn';
        closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        addDomListener(this, closeBtn, 'click', () => this._close());
        header.appendChild(closeBtn);

        this._container.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.className = 'modal-body';

        // Terrain section
        const section = document.createElement('div');
        section.className = 'settings-section';

        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'settings-section__header';
        sectionHeader.textContent = 'Terreno';
        section.appendChild(sectionHeader);

        const field = document.createElement('div');
        field.className = 'settings-field';

        const label = document.createElement('div');
        label.className = 'settings-field__label';
        label.textContent = 'Exagero vertical';
        field.appendChild(label);

        const description = document.createElement('div');
        description.className = 'settings-field__description';
        description.textContent = 'Multiplica a altura do terreno para melhor visualização do relevo';
        field.appendChild(description);

        const sliderRow = document.createElement('div');
        sliderRow.className = 'settings-slider-row';

        const rangeMin = document.createElement('span');
        rangeMin.className = 'settings-slider-row__bound';
        rangeMin.textContent = `${MIN_EXAGGERATION}x`;
        sliderRow.appendChild(rangeMin);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'settings-slider';
        slider.min = String(MIN_EXAGGERATION);
        slider.max = String(MAX_EXAGGERATION);
        slider.step = String(STEP_EXAGGERATION);
        slider.value = String(this._currentExaggeration);
        sliderRow.appendChild(slider);

        const rangeMax = document.createElement('span');
        rangeMax.className = 'settings-slider-row__bound';
        rangeMax.textContent = `${MAX_EXAGGERATION}x`;
        sliderRow.appendChild(rangeMax);

        const numberInput = document.createElement('input');
        numberInput.type = 'number';
        numberInput.className = 'settings-slider__input';
        numberInput.min = String(MIN_EXAGGERATION);
        numberInput.max = String(MAX_EXAGGERATION);
        numberInput.step = String(STEP_EXAGGERATION);
        numberInput.value = String(this._currentExaggeration);
        sliderRow.appendChild(numberInput);

        field.appendChild(sliderRow);
        section.appendChild(field);
        body.appendChild(section);

        this._container.appendChild(body);
        this._overlay.appendChild(this._container);

        // Wire slider ↔ input sync
        addDomListener(this, slider, 'input', () => {
            const val = parseFloat(slider.value);
            numberInput.value = String(val);
            this._handleExaggerationChange(val);
        });

        addDomListener(this, numberInput, 'input', () => {
            let val = parseFloat(numberInput.value);
            if (isNaN(val)) return;
            val = Math.max(MIN_EXAGGERATION, Math.min(MAX_EXAGGERATION, val));
            slider.value = String(val);
            this._handleExaggerationChange(val);
        });

        // Keyboard
        addDomListener(this, this._overlay, 'click', (e) => {
            if (e.target === this._overlay) this._close();
        });
        addDomListener(this, document, 'keydown', (e) => {
            if (e.key === 'Escape') this._close();
        });
    }

    /**
     * Handles exaggeration value change from slider or input.
     * @private
     * @param {number} value
     */
    _handleExaggerationChange(value) {
        this._currentExaggeration = value;

        // Live update on the map
        if (this._onExaggerationChanged) {
            this._onExaggerationChanged(value);
        }

        // Debounced persist to Atlas
        if (this._persistTimer) clearTimeout(this._persistTimer);
        this._persistTimer = setTimeout(() => this._persistExaggeration(value), PERSIST_DEBOUNCE_MS);
    }

    /**
     * Persists exaggeration value to Atlas in IndexedDB.
     * @private
     * @param {number} value
     */
    async _persistExaggeration(value) {
        try {
            const repo = getRepository();
            const atlas = await repo.getAtlas();
            if (!atlas) return;

            if (!atlas.settings) atlas.settings = {};
            atlas.settings.terrainExaggeration = value;
            await repo.saveAtlas(atlas);
        } catch (error) {
            console.warn('Failed to persist terrain exaggeration:', error);
        }
    }

    /**
     * Closes the modal.
     * @private
     */
    _close() {
        // Flush any pending persist
        if (this._persistTimer) {
            clearTimeout(this._persistTimer);
            this._persistTimer = null;
            this._persistExaggeration(this._currentExaggeration);
        }

        this._overlay.dataset.visible = 'false';

        setTimeout(() => {
            this._destroy();
            if (this._previousActiveElement) {
                this._previousActiveElement.focus();
            }
            if (this._resolvePromise) {
                this._resolvePromise(this._currentExaggeration);
            }
        }, 200);
    }

    /**
     * @private
     */
    _destroy() {
        cleanup(this);
        removeElement(this._overlay);
        this._overlay = null;
        this._container = null;
    }
}

/**
 * Shows the settings modal.
 * @param {Object} config
 * @param {number} [config.currentExaggeration] - Current value
 * @param {function(number): void} [config.onExaggerationChanged] - Live update callback
 * @returns {Promise<number>} Final exaggeration value
 */
export async function showSettingsModal(config = {}) {
    const modal = new SettingsModal(config);
    return modal.show();
}
