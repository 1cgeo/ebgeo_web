// Path: js/sidebar/components/feature-panel.js

/**
 * @fileoverview Feature attributes panel component for sidebar.
 * Displays feature properties, style, and images when a feature is selected.
 */

import { SIDEBAR_ICONS } from '../sidebar.constants.js';
import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement
} from '../../utilities/event-cleanup.js';

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

        // Content container
        this._contentContainer = document.createElement('div');
        this._contentContainer.className = 'sidebar-panel-content feature-panel-content';
        this._container.appendChild(this._contentContainer);

        return this._container;
    }

    /**
     * Creates the panel header.
     * @private
     * @returns {HTMLElement}
     */
    _createHeader() {
        const header = document.createElement('div');
        header.className = 'sidebar-panel-header';

        // Title
        this._headerTitle = document.createElement('div');
        this._headerTitle.className = 'sidebar-panel-title';
        this._headerTitle.innerHTML = `
            ${SIDEBAR_ICONS.map}
            <span>Detalhes da Feição</span>
        `;
        header.appendChild(this._headerTitle);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'sidebar-panel-close';
        closeBtn.setAttribute('aria-label', 'Fechar painel');
        closeBtn.title = 'Fechar';
        closeBtn.innerHTML = SIDEBAR_ICONS.close;

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
     * @param {HTMLElement} contentElement - The attribute panel content
     * @param {string} featureName - Name of the feature for the title
     */
    show(contentElement, featureName) {
        // Update header title
        if (this._headerTitle) {
            const displayName = featureName || 'Feição';
            this._headerTitle.innerHTML = `
                ${SIDEBAR_ICONS.map}
                <span>${displayName}</span>
            `;
        }

        // Clear previous content
        if (this._currentContent && this._currentContent.parentNode) {
            this._contentContainer.removeChild(this._currentContent);
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
     * Hides the feature panel.
     */
    hide() {
        this._container.dataset.expanded = 'false';

        // Clear content after animation
        setTimeout(() => {
            if (this._container.dataset.expanded === 'false' && this._currentContent) {
                if (this._currentContent.parentNode === this._contentContainer) {
                    this._contentContainer.removeChild(this._currentContent);
                }
                this._currentContent = null;
            }
        }, 300);
    }

    /**
     * Updates the content without recreating the panel.
     * @param {HTMLElement} contentElement - New content
     */
    updateContent(contentElement) {
        if (!this.isExpanded()) return;

        // Clear previous content
        if (this._currentContent && this._currentContent.parentNode) {
            this._contentContainer.removeChild(this._currentContent);
        }

        // Set new content
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
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._contentContainer = null;
        this._currentContent = null;
    }
}
