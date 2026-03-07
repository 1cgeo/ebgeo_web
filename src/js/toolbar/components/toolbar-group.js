// Path: js/toolbar/components/toolbar-group.js

/**
 * @fileoverview Toolbar group component with collapsible popup.
 */

import { ToolButton } from './tool-button.js';
import {
    setupCleanup,
    addDomListener,
    subscribe,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';
import { EventTypes } from '@events/event_types.js';

/**
 * Toolbar group component.
 */
export class ToolbarGroup {
    /**
     * @param {Object} config - Group configuration
     * @param {string} config.id - Group identifier
     * @param {string} config.label - Display label
     * @param {string} config.icon - SVG icon HTML
     * @param {string} config.layout - 'grid' or 'list'
     * @param {Array} config.tools - Array of tool configurations
     * @param {Object} dependencies - Dependencies
     * @param {Object} dependencies.toolManager - ToolManager instance
     * @param {Object} dependencies.controls - Tool controls map
     * @param {Object} dependencies.eventBus - EventBus instance
     * @param {Object} dependencies.stateManager - StateManager instance
     * @param {Object} dependencies.map - MapLibre map instance
     */
    constructor(config, dependencies) {
        this._config = config;
        this._toolManager = dependencies.toolManager;
        this._controls = dependencies.controls;
        this._eventBus = dependencies.eventBus;
        this._stateManager = dependencies.stateManager;
        this._map = dependencies.map;

        this._container = null;
        this._button = null;
        this._popup = null;
        this._toolButtons = new Map();
        this._isOpen = false;

        setupCleanup(this);
    }

    /**
     * Renders the toolbar group.
     * @returns {HTMLElement}
     */
    render() {
        this._container = document.createElement('div');
        this._container.className = 'toolbar-group';
        this._container.dataset.groupId = this._config.id;

        // Group button (uses native title tooltip)
        this._button = this._createGroupButton();
        this._container.appendChild(this._button);

        // Popup
        this._popup = this._createPopup();
        this._container.appendChild(this._popup);

        // Setup listeners
        this._setupEventListeners();

        return this._container;
    }

    /**
     * Creates the group button.
     * @private
     * @returns {HTMLButtonElement}
     */
    _createGroupButton() {
        const button = document.createElement('button');
        button.className = 'toolbar-group-btn';
        button.dataset.active = 'false';
        button.title = this._config.label;
        button.setAttribute('aria-label', this._config.label);
        button.setAttribute('aria-expanded', 'false');
        button.innerHTML = this._config.icon;

        addDomListener(this, button, 'click', (e) => {
            e.stopPropagation();
            this._togglePopup();
        });

        return button;
    }

    /**
     * Creates the popup container with tools.
     * @private
     * @returns {HTMLElement}
     */
    _createPopup() {
        const popup = document.createElement('div');
        popup.className = 'toolbar-popup';
        popup.dataset.visible = 'false';

        // Create content based on layout
        const content = document.createElement('div');
        content.className = this._config.layout === 'grid'
            ? 'toolbar-popup-grid'
            : 'toolbar-popup-list';

        // Add tool buttons
        this._config.tools.forEach(toolConfig => {
            const toolButton = new ToolButton(
                toolConfig,
                (config) => this._handleToolClick(config),
                this._config.layout
            );

            const buttonEl = toolButton.render();
            content.appendChild(buttonEl);
            this._toolButtons.set(toolConfig.id, toolButton);

            // Check if tool requires terrain
            if (toolConfig.requiresTerrain) {
                this._updateToolTerrainState(toolButton);
            }
        });

        popup.appendChild(content);
        return popup;
    }

    /**
     * Sets up event listeners.
     * @private
     */
    _setupEventListeners() {
        // Close popup when clicking outside
        addDomListener(this, document, 'click', (e) => {
            if (!this._container.contains(e.target)) {
                this._closePopup();
            }
        });

        // Close popup on escape
        addDomListener(this, document, 'keydown', (e) => {
            if (e.key === 'Escape' && this._isOpen) {
                this._closePopup();
            }
        });

        // Listen for toolbar group state changes from StateManager
        if (this._stateManager) {
            const unsubscribe = this._stateManager.subscribe('ui.activeToolbarGroup', (activeGroup) => {
                if (activeGroup === this._config.id) {
                    this._openPopupInternal();
                } else {
                    this._closePopupInternal();
                }
            });
            this._unsubscribers.push(unsubscribe);
        }

        // Listen for tool activation to update active states
        if (this._eventBus) {
            subscribe(this, this._eventBus, EventTypes.TOOLBAR_GROUP_OPENED,
                (payload) => this._onToolbarGroupOpened(payload));
        }

        // Listen for terrain changes
        if (this._map) {
            const terrainHandler = () => this._updateTerrainTools();
            this._map.on('terrain', terrainHandler);
            // Track for cleanup
            this._domListeners.push({
                element: this._map,
                event: 'terrain',
                handler: terrainHandler,
                options: {}
            });
        }

        // Listen for active tool changes
        if (this._stateManager) {
            const unsubscribe = this._stateManager.subscribe('activeTool.type', (activeToolType) => {
                this._updateActiveToolState(activeToolType);
            });
            this._unsubscribers.push(unsubscribe);
        }
    }

    /**
     * Toggles the popup visibility.
     * @private
     */
    _togglePopup() {
        if (this._stateManager) {
            this._stateManager.toggleToolbarGroup(this._config.id);
        } else {
            // Fallback without state manager
            if (this._isOpen) {
                this._closePopup();
            } else {
                this._openPopup();
            }
        }
    }

    /**
     * Opens the popup (via StateManager).
     * @private
     */
    _openPopup() {
        if (this._stateManager) {
            this._stateManager.openToolbarGroup(this._config.id);
        } else {
            this._openPopupInternal();
        }
    }

    /**
     * Opens the popup internally (DOM update).
     * @private
     */
    _openPopupInternal() {
        this._isOpen = true;
        this._popup.dataset.visible = 'true';
        this._button.setAttribute('aria-expanded', 'true');

        // Update terrain-dependent tools
        this._updateTerrainTools();
    }

    /**
     * Closes the popup (via StateManager).
     * @private
     */
    _closePopup() {
        if (this._stateManager) {
            this._stateManager.closeToolbarGroup();
        } else {
            this._closePopupInternal();
        }
    }

    /**
     * Closes the popup internally (DOM update).
     * @private
     */
    _closePopupInternal() {
        this._isOpen = false;
        this._popup.dataset.visible = 'false';
        this._button.setAttribute('aria-expanded', 'false');
    }

    /**
     * Handles toolbar group opened event.
     * @private
     * @param {Object} payload - Event payload
     */
    _onToolbarGroupOpened(payload) {
        // If another group opened, close this one
        if (payload.group !== this._config.id && this._isOpen) {
            this._closePopupInternal();
        }
    }

    /**
     * Handles tool click.
     * @private
     * @param {Object} toolConfig - Tool configuration
     */
    _handleToolClick(toolConfig) {
        const control = this._controls[toolConfig.controlKey];
        if (!control) {
            console.warn(`Control not found: ${toolConfig.controlKey}`);
            return;
        }

        // Check terrain requirement
        if (toolConfig.requiresTerrain && this._map && !this._map.getTerrain()) {
            console.warn(`Tool ${toolConfig.id} requires terrain`);
            return;
        }

        // Activate tool
        this._toolManager.setActiveTool(control);

        // Close popup after selection
        this._closePopup();
    }

    /**
     * Updates active state based on active tool.
     * @private
     * @param {string|null} activeToolType - Active tool type from StateManager
     */
    _updateActiveToolState(activeToolType) {
        let hasActiveTool = false;

        this._toolButtons.forEach((button, toolId) => {
            const toolConfig = this._config.tools.find(t => t.id === toolId);
            if (!toolConfig) return;

            // Check if this tool's control matches the active tool
            const control = this._controls[toolConfig.controlKey];
            const controlType = this._inferControlType(control);
            const isActive = controlType === activeToolType;

            button.setActive(isActive);

            if (isActive) {
                hasActiveTool = true;
            }
        });

        // Highlight group button if any tool in group is active
        if (this._button) {
            this._button.dataset.active = hasActiveTool.toString();
        }
    }

    /**
     * Infers tool type from control instance.
     * @private
     * @param {Object} control - Tool control instance
     * @returns {string|null}
     */
    _inferControlType(control) {
        if (!control) return null;

        // First check for explicit type property
        if (control.type) {
            return control.type;
        }

        // Fallback: derive from constructor name
        const className = control.constructor.name;
        return className
            .replace('Add', '')
            .replace('Control', '')
            .toLowerCase();
    }

    /**
     * Updates terrain-dependent tools.
     * @private
     */
    _updateTerrainTools() {
        const hasTerrain = this._map?.getTerrain() != null;

        this._config.tools.forEach(toolConfig => {
            if (toolConfig.requiresTerrain) {
                const button = this._toolButtons.get(toolConfig.id);
                if (button) {
                    button.setDisabled(!hasTerrain);
                }
            }
        });
    }

    /**
     * Updates a single tool's terrain state.
     * @private
     * @param {ToolButton} toolButton - Tool button to update
     */
    _updateToolTerrainState(toolButton) {
        const hasTerrain = this._map?.getTerrain() != null;
        toolButton.setDisabled(!hasTerrain);
    }

    /**
     * Gets the group ID.
     * @returns {string}
     */
    getId() {
        return this._config.id;
    }

    /**
     * Gets the container element.
     * @returns {HTMLElement|null}
     */
    getContainer() {
        return this._container;
    }

    /**
     * Destroys the component.
     */
    destroy() {
        this._toolButtons.forEach(button => button.destroy());
        this._toolButtons.clear();

        cleanup(this);
        removeElement(this._container);
        this._container = null;
    }
}
