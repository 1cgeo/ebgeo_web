// Path: js/sidebar/components/feature-panel.js

/**
 * @fileoverview Feature attributes panel component for sidebar.
 * Displays feature properties, style, images, and location when a feature is selected.
 * Follows the new Google Maps-inspired design with sections:
 * - Header
 * - Identification (icon, name, type, layer)
 * - Photo Gallery
 * - Tabs (Estilo / Atributos)
 * - Location
 * - Delete button
 */

import { SIDEBAR_ICONS } from '../sidebar.constants.js';
import { escapeHtml } from '@utils/html-escape.js';
import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';

/**
 * Feature panel component for displaying selected feature attributes in sidebar.
 */
export class FeaturePanel {
    /**
     * @param {Object} options - Configuration options
     * @param {Function} options.onClose - Callback when panel is closed
     */
    constructor(options) {
        this._onClose = options.onClose;

        this._container = null;
        this._headerTitle = null;
        this._contentContainer = null;
        this._currentContent = null;
        this._cleanupFunctions = [];
        this._hideTimeoutId = null;

        setupCleanup(this);
    }

    /**
     * Creates the panel DOM structure.
     * @returns {HTMLElement} Container element
     */
    render() {
        this._container = document.createElement('div');
        this._container.className = 'sidebar-panel feature-panel';
        this._container.dataset.expanded = 'false';

        // Header
        const header = this._createHeader();
        this._container.appendChild(header);

        // Content container (scrollable)
        this._contentContainer = document.createElement('div');
        this._contentContainer.className = 'feature-panel-content';
        this._container.appendChild(this._contentContainer);

        return this._container;
    }

    /**
     * Creates the panel header following the standard sidebar pattern.
     * @private
     * @returns {HTMLElement}
     */
    _createHeader() {
        const header = document.createElement('div');
        header.className = 'sidebar-panel-header';

        // Title with icon (same pattern as sidebar-panel.js)
        this._headerTitle = document.createElement('div');
        this._headerTitle.className = 'sidebar-panel-title';

        // Feature icon SVG
        const featureIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

        this._headerTitle.innerHTML = `
            ${featureIcon}
            <span>EBGeo - Feição</span>
        `;
        header.appendChild(this._headerTitle);

        // Close button (chevron left, same as sidebar-panel.js)
        const closeBtn = document.createElement('button');
        closeBtn.className = 'sidebar-panel-close';
        closeBtn.setAttribute('aria-label', 'Fechar painel');
        closeBtn.title = 'Fechar';
        closeBtn.innerHTML = SIDEBAR_ICONS.chevronLeft;

        const handleClose = () => {
            if (this._onClose) {
                this._onClose();
            }
        };

        addDomListener(this, closeBtn, 'click', handleClose);
        header.appendChild(closeBtn);

        return header;
    }

    /**
     * Shows the feature panel with content.
     * @param {HTMLElement} contentElement - The panel content
     * @param {string} [title] - Optional title to display in the header
     */
    show(contentElement, title) {
        // Cancel any pending hide timeout to prevent race conditions
        if (this._hideTimeoutId) {
            clearTimeout(this._hideTimeoutId);
            this._hideTimeoutId = null;
        }

        // Clear previous content
        this._clearContent();

        // Update title if provided
        if (title && this._headerTitle) {
            const featureIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
            this._headerTitle.innerHTML = `
                ${featureIcon}
                <span>${escapeHtml(title)}</span>
            `;
        }

        // Set new content
        this._currentContent = contentElement;
        if (contentElement) {
            this._contentContainer.appendChild(contentElement);
        }

        // Expand
        this._container.dataset.expanded = 'true';
    }

    /**
     * Clears current content and runs cleanup functions.
     * @private
     */
    _clearContent() {
        // Run cleanup functions
        this._cleanupFunctions.forEach(fn => {
            try {
                fn();
            } catch (e) {
                console.warn('Error in cleanup function:', e);
            }
        });
        this._cleanupFunctions = [];

        // Remove content
        if (this._currentContent && this._currentContent.parentNode) {
            this._contentContainer.removeChild(this._currentContent);
        }
        this._currentContent = null;
    }

    /**
     * Registers a cleanup function to be called when content is cleared.
     * @param {Function} cleanupFn - Cleanup function
     */
    registerCleanup(cleanupFn) {
        if (typeof cleanupFn === 'function') {
            this._cleanupFunctions.push(cleanupFn);
        }
    }

    /**
     * Hides the feature panel.
     * @param {boolean} [saveChanges=true] - Whether to save changes before hiding
     */
    hide(saveChanges = true) {
        // Save changes by clicking the save button if present
        if (saveChanges) {
            this._triggerSave();
        }

        this._container.dataset.expanded = 'false';

        // Cancel any previous pending clear
        if (this._hideTimeoutId) {
            clearTimeout(this._hideTimeoutId);
        }

        // Clear content after animation
        this._hideTimeoutId = setTimeout(() => {
            this._hideTimeoutId = null;
            if (this._container.dataset.expanded === 'false') {
                this._clearContent();
            }
        }, 300);
    }

    /**
     * Triggers save on the current panel content.
     * Always uses _saveOnly to persist without triggering the click handler's
     * deselectAllFeatures() side-effect (callers manage deselection themselves).
     */
    _triggerSave() {
        if (!this._contentContainer) return;

        const saveButton = this._contentContainer.querySelector('.attr-modern-btn-save');
        if (!saveButton) return;

        // Always use _saveOnly to avoid the click handler's deselectAllFeatures()
        // which would cause duplicate saves and undo entries
        if (saveButton._saveOnly) {
            saveButton._saveOnly();
        }
    }

    /**
     * Updates the content without recreating the panel.
     * @param {HTMLElement} contentElement - New content
     */
    updateContent(contentElement) {
        if (!this.isExpanded()) return;

        this._clearContent();

        this._currentContent = contentElement;
        if (contentElement) {
            this._contentContainer.appendChild(contentElement);
        }
    }

    /**
     * Checks if panel is currently expanded.
     * @returns {boolean}
     */
    isExpanded() {
        return this._container?.dataset.expanded === 'true';
    }

    /**
     * Gets the container element.
     * @returns {HTMLElement|null}
     */
    getContainer() {
        return this._container;
    }

    /**
     * Gets the content container.
     * @returns {HTMLElement|null}
     */
    getContentContainer() {
        return this._contentContainer;
    }

    /**
     * Destroys the component.
     */
    destroy() {
        if (this._hideTimeoutId) {
            clearTimeout(this._hideTimeoutId);
            this._hideTimeoutId = null;
        }
        this._clearContent();
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._contentContainer = null;
        this._currentContent = null;
    }
}
