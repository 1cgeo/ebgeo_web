// Path: js/sidebar/components/sidebar-panel.js

/**
 * @fileoverview Expanded sidebar panel component (320px).
 * Slides in from left when a tab is selected.
 */

import { TAB_CONFIG, SIDEBAR_ICONS } from '../sidebar.constants.js';
import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement,
    trackTimer
} from '../../utilities/event-cleanup.js';

/**
 * Creates and manages the expanded sidebar panel.
 */
export class SidebarPanel {
    /**
     * @param {Object} options - Configuration options
     * @param {Function} options.onClose - Callback when panel is closed
     */
    constructor(options) {
        this._onClose = options.onClose;

        this._container = null;
        this._headerTitle = null;
        this._contentContainer = null;
        this._currentTabContent = null;

        setupCleanup(this);
    }

    /**
     * Creates the panel DOM structure.
     * @returns {HTMLElement} Container element
     */
    render() {
        this._container = document.createElement('div');
        this._container.className = 'sidebar-panel';
        this._container.dataset.expanded = 'false';

        // Header
        const header = this._createHeader();
        this._container.appendChild(header);

        // Content container
        this._contentContainer = document.createElement('div');
        this._contentContainer.className = 'sidebar-panel-content';
        this._container.appendChild(this._contentContainer);

        return this._container;
    }

    /**
     * Creates the panel header with title and close button.
     * @private
     * @returns {HTMLElement}
     */
    _createHeader() {
        const header = document.createElement('div');
        header.className = 'sidebar-panel-header';

        // Title with icon
        this._headerTitle = document.createElement('div');
        this._headerTitle.className = 'sidebar-panel-title';
        this._headerTitle.innerHTML = `
            ${SIDEBAR_ICONS.map}
            <span>EBGeo</span>
        `;
        header.appendChild(this._headerTitle);

        // Close button
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
     * Expands the panel with the specified tab content.
     * @param {string} tabId - Tab identifier
     * @param {HTMLElement} contentElement - Tab content element
     */
    expand(tabId, contentElement) {
        const config = TAB_CONFIG[tabId];

        // Update header title
        if (this._headerTitle && config) {
            const icon = this._getIconForTab(tabId);
            this._headerTitle.innerHTML = `
                ${icon}
                <span>${config.title}</span>
            `;
        }

        // Clear previous content
        if (this._currentTabContent && this._currentTabContent.parentNode) {
            this._contentContainer.removeChild(this._currentTabContent);
        }

        // Set new content
        this._currentTabContent = contentElement;
        if (contentElement) {
            this._contentContainer.appendChild(contentElement);
        }

        // Expand
        this._container.dataset.expanded = 'true';
    }

    /**
     * Collapses the panel.
     */
    collapse() {
        this._container.dataset.expanded = 'false';

        // Remove content after animation
        const timerId = setTimeout(() => {
            if (this._container.dataset.expanded === 'false' && this._currentTabContent) {
                if (this._currentTabContent.parentNode === this._contentContainer) {
                    this._contentContainer.removeChild(this._currentTabContent);
                }
                this._currentTabContent = null;
            }
        }, 300); // Match CSS transition duration

        trackTimer(this, timerId);
    }

    /**
     * Gets the icon for a specific tab.
     * @private
     * @param {string} tabId - Tab identifier
     * @returns {string} SVG icon markup
     */
    _getIconForTab(tabId) {
        const iconMap = {
            mapas: SIDEBAR_ICONS.map,
            camadas: SIDEBAR_ICONS.layers,
            importar: SIDEBAR_ICONS.upload,
            exportar: SIDEBAR_ICONS.download,
        };
        return iconMap[tabId] || SIDEBAR_ICONS.map;
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
     * Gets the content container for direct manipulation.
     * @returns {HTMLElement|null}
     */
    getContentContainer() {
        return this._contentContainer;
    }

    /**
     * Destroys the component and cleans up resources.
     */
    destroy() {
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._contentContainer = null;
        this._currentTabContent = null;
    }
}
