// Path: js/sidebar/components/chips.component.js

/**
 * @fileoverview Chips component - Quick action buttons below search bar.
 * Provides access to Tutorial, Info modal, and Shortcuts modal.
 */

import { EventTypes } from '../../events/event_types.js';
import config from '../../config.js';
import {
    setupCleanup,
    subscribe,
    addDomListener,
    cleanup,
    removeElement
} from '../../utilities/event-cleanup.js';
import { ShortcutsModal, InfoModal } from '../../modals/index.js';

/**
 * Chip button configurations.
 */
const CHIP_CONFIG = {
    tutorial: {
        id: 'tutorial',
        label: 'Tutorial',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    },
    info: {
        id: 'info',
        label: 'Informações',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    },
    shortcuts: {
        id: 'shortcuts',
        label: 'Atalhos',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><path d="M6 8h.001"/><path d="M10 8h.001"/><path d="M14 8h.001"/><path d="M18 8h.001"/><path d="M8 12h.001"/><path d="M12 12h.001"/><path d="M16 12h.001"/><path d="M7 16h10"/></svg>`,
    },
};

/**
 * Chips component for quick actions.
 */
export class ChipsComponent {
    /**
     * @param {Object} dependencies - Required dependencies
     * @param {Object} dependencies.stateManager - StateManager instance
     * @param {Object} dependencies.eventBus - EventBus instance
     * @param {Object} [dependencies.keyboardShortcuts] - KeyboardShortcuts instance (for modal) - legacy
     * @param {Object} [dependencies.suggestionsModal] - SuggestionsModal instance (for info modal) - legacy
     */
    constructor(dependencies) {
        this._stateManager = dependencies.stateManager;
        this._eventBus = dependencies.eventBus;
        this._keyboardShortcuts = dependencies.keyboardShortcuts || null;
        this._suggestionsModal = dependencies.suggestionsModal || null;

        this._container = null;

        // New modal instances
        this._shortcutsModal = null;
        this._infoModal = null;

        setupCleanup(this);
    }

    /**
     * Creates the chips UI and attaches to DOM.
     * @param {HTMLElement} parentElement - Parent to attach to
     */
    init(parentElement) {
        this._container = document.createElement('div');
        this._container.className = 'chips-container';
        this._container.id = 'chips-container';

        // Set initial position state
        this._updatePosition();

        // Create chip buttons
        Object.values(CHIP_CONFIG).forEach(chipConfig => {
            const chip = this._createChip(chipConfig);
            this._container.appendChild(chip);
        });

        parentElement.appendChild(this._container);

        // Initialize new modals
        this._initModals();

        // Setup event listeners
        this._setupEventListeners();
    }

    /**
     * Initializes the new modal instances.
     * @private
     */
    _initModals() {
        // Create shortcuts modal
        this._shortcutsModal = new ShortcutsModal();
        document.body.appendChild(this._shortcutsModal.render());

        // Create info modal
        this._infoModal = new InfoModal();
        document.body.appendChild(this._infoModal.render());
    }

    /**
     * Creates a single chip button.
     * @private
     * @param {Object} chipConfig - Chip configuration
     * @returns {HTMLButtonElement}
     */
    _createChip(chipConfig) {
        const button = document.createElement('button');
        button.className = 'chip-btn';
        button.id = `chip-${chipConfig.id}`;
        button.setAttribute('aria-label', chipConfig.label);
        button.title = chipConfig.label;

        button.innerHTML = `
            ${chipConfig.icon}
            <span>${chipConfig.label}</span>
        `;

        // Bind click handler based on chip type
        const handler = this._getClickHandler(chipConfig.id);
        addDomListener(this, button, 'click', handler);

        return button;
    }

    /**
     * Gets the click handler for a specific chip.
     * @private
     * @param {string} chipId - Chip identifier
     * @returns {Function}
     */
    _getClickHandler(chipId) {
        switch (chipId) {
            case 'tutorial':
                return () => this._handleTutorialClick();
            case 'info':
                return () => this._handleInfoClick();
            case 'shortcuts':
                return () => this._handleShortcutsClick();
            default:
                return () => {};
        }
    }

    /**
     * Handles Tutorial chip click - opens in new window.
     * @private
     */
    _handleTutorialClick() {
        // Get tutorial URL from config or use default
        const tutorialUrl = config.app?.tutorialUrl || config.tutorialUrl || './docs/doc.html';

        // Open in new window (current behavior preserved)
        window.open(tutorialUrl, '_blank', 'noopener,noreferrer');
    }

    /**
     * Handles Info chip click - opens suggestions/info modal.
     * @private
     */
    _handleInfoClick() {
        // Use new modal if available
        if (this._infoModal) {
            this._infoModal.show();
        } else if (this._suggestionsModal) {
            // Legacy fallback
            this._suggestionsModal.show();
        } else {
            // Last resort fallback: try to find and show modal directly
            const modal = document.getElementById('suggestions-modal');
            if (modal) {
                modal.style.display = 'block';
                modal.setAttribute('aria-hidden', 'false');
                document.body.style.overflow = 'hidden';
            } else {
                console.warn('Info modal not found');
            }
        }
    }

    /**
     * Handles Shortcuts chip click - opens shortcuts modal.
     * @private
     */
    _handleShortcutsClick() {
        // Use new modal if available
        if (this._shortcutsModal) {
            this._shortcutsModal.show();
        } else if (this._keyboardShortcuts) {
            // Legacy fallback
            this._keyboardShortcuts.showModal();
        } else {
            // Last resort fallback: try to find and show modal directly
            const modal = document.getElementById('shortcuts-modal');
            if (modal) {
                modal.style.display = 'block';
                modal.setAttribute('aria-hidden', 'false');
                document.body.style.overflow = 'hidden';
            } else {
                console.warn('Shortcuts modal not found');
            }
        }
    }

    /**
     * Sets up event listeners for layout changes.
     * @private
     */
    _setupEventListeners() {
        subscribe(this, this._eventBus, EventTypes.UI_LAYOUT_CHANGED,
            () => this._updatePosition());

        subscribe(this, this._eventBus, EventTypes.SIDEBAR_EXPANDED,
            () => this._updatePosition());

        subscribe(this, this._eventBus, EventTypes.SIDEBAR_COLLAPSED,
            () => this._updatePosition());
    }

    /**
     * Updates chip container position based on sidebar state.
     * @private
     */
    _updatePosition() {
        if (!this._container) return;

        const sidebarExpanded = this._stateManager?.get('sidebar.expanded') || false;
        const featurePanelOpen = this._stateManager?.get('ui.featurePanelOpen') || false;

        this._container.dataset.sidebarState =
            (sidebarExpanded || featurePanelOpen) ? 'expanded' : 'collapsed';
    }

    /**
     * Sets keyboard shortcuts instance for modal integration.
     * @param {Object} keyboardShortcuts - KeyboardShortcuts instance
     */
    setKeyboardShortcuts(keyboardShortcuts) {
        this._keyboardShortcuts = keyboardShortcuts;
    }

    /**
     * Sets suggestions modal instance for modal integration.
     * @param {Object} suggestionsModal - SuggestionsModal instance
     */
    setSuggestionsModal(suggestionsModal) {
        this._suggestionsModal = suggestionsModal;
    }

    /**
     * Gets the container element.
     * @returns {HTMLElement|null}
     */
    getContainer() {
        return this._container;
    }

    /**
     * Gets the shortcuts modal instance.
     * @returns {ShortcutsModal|null}
     */
    getShortcutsModal() {
        return this._shortcutsModal;
    }

    /**
     * Gets the info modal instance.
     * @returns {InfoModal|null}
     */
    getInfoModal() {
        return this._infoModal;
    }

    /**
     * Destroys the component.
     */
    destroy() {
        // Destroy new modals
        if (this._shortcutsModal) {
            this._shortcutsModal.destroy();
            this._shortcutsModal = null;
        }
        if (this._infoModal) {
            this._infoModal.destroy();
            this._infoModal = null;
        }

        cleanup(this);
        removeElement(this._container);
        this._container = null;
    }
}

export default ChipsComponent;
