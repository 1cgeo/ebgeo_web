// Path: js/modals/modal.base.js

/**
 * @fileoverview Base modal class.
 * Provides common functionality for all modals.
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';

/**
 * Base modal class.
 */
export class ModalBase {
    /**
     * @param {Object} config - Modal configuration
     * @param {string} config.id - Modal ID
     * @param {string} config.title - Modal title
     * @param {string} config.icon - Optional header icon SVG
     * @param {boolean} [config.destroyOnHide] - For transient single-use modals:
     *   destroy (cleanup + remove overlay) automatically on hide, so the overlay
     *   and the document keydown listener are not leaked across open/close cycles.
     */
    constructor(config) {
        this._config = config;
        this._overlay = null;
        this._container = null;
        this._isOpen = false;
        this._previousActiveElement = null;
        this._destroyOnHide = config?.destroyOnHide === true;

        setupCleanup(this);
    }

    /**
     * Creates the modal DOM structure.
     * @returns {HTMLElement}
     */
    render() {
        // Overlay
        this._overlay = document.createElement('div');
        this._overlay.className = 'modal-overlay';
        this._overlay.id = `${this._config.id}-overlay`;
        this._overlay.setAttribute('role', 'dialog');
        this._overlay.setAttribute('aria-modal', 'true');
        this._overlay.setAttribute('aria-labelledby', `${this._config.id}-title`);
        this._overlay.setAttribute('aria-hidden', 'true');
        this._overlay.dataset.visible = 'false';

        // Container
        this._container = document.createElement('div');
        this._container.className = 'modal-container';
        this._container.id = this._config.id;

        // Header
        const header = this._createHeader();
        this._container.appendChild(header);

        // Body (to be filled by subclasses)
        const body = document.createElement('div');
        body.className = 'modal-body';
        body.id = `${this._config.id}-body`;
        this._container.appendChild(body);

        this._overlay.appendChild(this._container);

        // Event listeners
        this._setupBaseListeners();

        return this._overlay;
    }

    /**
     * Creates the header element.
     * @private
     * @returns {HTMLElement}
     */
    _createHeader() {
        const header = document.createElement('div');
        header.className = 'modal-header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'modal-title-wrap';

        if (this._config.icon) {
            const icon = document.createElement('span');
            icon.className = 'modal-title-icon';
            icon.innerHTML = this._config.icon;
            titleWrap.appendChild(icon);
        }

        const title = document.createElement('h2');
        title.className = 'modal-title';
        title.id = `${this._config.id}-title`;
        title.textContent = this._config.title;
        titleWrap.appendChild(title);

        header.appendChild(titleWrap);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close-btn';
        closeBtn.setAttribute('aria-label', 'Fechar modal');
        closeBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        `;

        addDomListener(this, closeBtn, 'click', () => this.hide());

        header.appendChild(closeBtn);

        return header;
    }

    /**
     * Sets up base event listeners.
     * @private
     */
    _setupBaseListeners() {
        // Close on overlay click
        addDomListener(this, this._overlay, 'click', (e) => {
            if (e.target === this._overlay) {
                this.hide();
            }
        });

        // Close on escape
        this._escapeHandler = (e) => {
            if (e.key === 'Escape' && this._isOpen) {
                this.hide();
            }
        };
        addDomListener(this, document, 'keydown', this._escapeHandler);
    }

    /**
     * Shows the modal.
     */
    show() {
        if (this._isOpen) return;

        // Save current focus
        this._previousActiveElement = document.activeElement;

        this._isOpen = true;
        this._overlay.dataset.visible = 'true';
        this._overlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';

        // Focus first focusable element
        requestAnimationFrame(() => {
            const focusable = this._container.querySelector('button, [tabindex]:not([tabindex="-1"])');
            if (focusable) {
                focusable.focus();
            }
        });
    }

    /**
     * Hides the modal.
     */
    hide() {
        if (!this._isOpen) return;

        this._isOpen = false;

        // Move focus out BEFORE setting aria-hidden to avoid accessibility warning
        // "Blocked aria-hidden on an element because its descendant retained focus"
        if (this._previousActiveElement) {
            this._previousActiveElement.focus();
            this._previousActiveElement = null;
        } else {
            // Fallback: blur current focus to prevent aria-hidden warning
            const activeElement = document.activeElement;
            if (activeElement && this._overlay.contains(activeElement)) {
                activeElement.blur();
            }
        }

        this._overlay.dataset.visible = 'false';
        this._overlay.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';

        // Transient modals (a fresh instance per open) destroy themselves on close.
        if (this._destroyOnHide) {
            cleanup(this);
            removeElement(this._overlay);
            this._overlay = null;
            this._container = null;
        }
    }

    /**
     * Toggles the modal visibility.
     */
    toggle() {
        if (this._isOpen) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * Gets the body element for content.
     * @returns {HTMLElement|null}
     */
    getBody() {
        return this._container?.querySelector('.modal-body');
    }

    /**
     * Gets the container element.
     * @returns {HTMLElement|null}
     */
    getContainer() {
        return this._container;
    }

    /**
     * Gets the overlay element.
     * @returns {HTMLElement|null}
     */
    getOverlay() {
        return this._overlay;
    }

    /**
     * Checks if modal is open.
     * @returns {boolean}
     */
    isOpen() {
        return this._isOpen;
    }

    /**
     * Destroys the modal.
     */
    destroy() {
        this.hide();
        cleanup(this);
        removeElement(this._overlay);
        this._overlay = null;
        this._container = null;
    }
}
