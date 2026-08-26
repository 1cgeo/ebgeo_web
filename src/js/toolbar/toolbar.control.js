// Path: js/toolbar/toolbar.control.js

/**
 * @fileoverview Main toolbar controller.
 * Manages toolbar groups and standalone buttons.
 */

import { ToolbarGroup } from './components/toolbar-group.js';
import { TOOL_GROUPS, STANDALONE_TOOLS, TOGGLE_TOOLS, ACTION_TOOLS } from './toolbar.constants.js';
import {
    setupCleanup,
    addDomListener,
    subscribe,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';
import { EventTypes } from '@events/event_types.js';
import { isCurrentMapLockedSync } from '@store/index.js';

/**
 * Main toolbar controller.
 */
export class ToolbarControl {
    /**
     * @param {Object} dependencies - Required dependencies
     * @param {Object} dependencies.toolManager - ToolManager instance
     * @param {Object} dependencies.controls - Map of tool controls
     * @param {Object} dependencies.eventBus - EventBus instance
     * @param {Object} dependencies.stateManager - StateManager instance
     * @param {Object} dependencies.map - MapLibre map instance
     */
    constructor(dependencies) {
        this._toolManager = dependencies.toolManager;
        this._controls = dependencies.controls;
        this._eventBus = dependencies.eventBus;
        this._stateManager = dependencies.stateManager;
        this._map = dependencies.map;

        this._container = null;
        this._groups = new Map();
        this._standaloneButtons = new Map();

        setupCleanup(this);
    }

    /**
     * Initializes the toolbar and attaches to DOM.
     * @param {HTMLElement} parentElement - Parent to attach to
     */
    init(parentElement) {
        this._container = document.createElement('div');
        this._container.className = 'toolbar-container';
        this._container.id = 'toolbar-container';

        // Create tool groups
        Object.values(TOOL_GROUPS).forEach(groupConfig => {
            const group = new ToolbarGroup(groupConfig, {
                toolManager: this._toolManager,
                controls: this._controls,
                eventBus: this._eventBus,
                stateManager: this._stateManager,
                map: this._map,
            });

            this._container.appendChild(group.render());
            this._groups.set(groupConfig.id, group);
        });

        // Create standalone buttons
        STANDALONE_TOOLS.forEach(toolConfig => {
            const button = this._createStandaloneButton(toolConfig);
            this._container.appendChild(button);
        });

        // Create toggle buttons (state-driven, not tool-driven)
        TOGGLE_TOOLS.forEach(toolConfig => {
            const button = this._createToggleButton(toolConfig);
            this._container.appendChild(button);
        });

        // Create action buttons — appended LAST, so they sit below the snapping
        // toggle. Order here is the order on screen, and the actions belong at the
        // bottom: they are not part of the draw/edit flow the rest of the bar is.
        ACTION_TOOLS.forEach(toolConfig => {
            const button = this._createActionButton(toolConfig);
            this._container.appendChild(button);
        });

        parentElement.appendChild(this._container);

        // Setup event listeners
        this._setupEventListeners();

        // Apply initial lock state
        this._applyMapLockState();
    }

    /**
     * Creates a standalone tool button.
     * @private
     * @param {Object} toolConfig - Tool configuration
     * @returns {HTMLButtonElement}
     */
    _createStandaloneButton(toolConfig) {
        const button = document.createElement('button');
        button.className = 'toolbar-standalone-btn';
        button.dataset.toolId = toolConfig.id;
        button.dataset.active = 'false';
        button.title = `${toolConfig.label} (${toolConfig.shortcut})`;
        button.setAttribute('aria-label', toolConfig.label);
        button.innerHTML = toolConfig.icon;

        addDomListener(this, button, 'click', () => {
            const control = this._controls[toolConfig.controlKey];
            if (control) {
                this._toolManager.setActiveTool(control);
            }
        });

        this._standaloneButtons.set(toolConfig.id, button);
        return button;
    }

    /**
     * Creates a toggle button driven by a StateManager path.
     * Unlike standalone buttons, toggle buttons don't activate a tool —
     * they flip a boolean state and visually reflect it.
     * @private
     * @param {Object} toolConfig - { id, label, icon, shortcut, statePath }
     * @returns {HTMLButtonElement}
     */
    _createToggleButton(toolConfig) {
        const button = document.createElement('button');
        button.className = 'toolbar-standalone-btn';
        button.dataset.toolId = toolConfig.id;
        button.dataset.active = 'false';
        button.title = `${toolConfig.label} (${toolConfig.shortcut})`;
        button.setAttribute('aria-label', toolConfig.label);
        button.innerHTML = toolConfig.icon;

        addDomListener(this, button, 'click', () => {
            const current = this._stateManager.getUnsafe(toolConfig.statePath);
            this._stateManager.set(toolConfig.statePath, !current);
        });

        // Subscribe to state changes to keep button visual in sync
        const unsubscribe = this._stateManager.subscribe(toolConfig.statePath, (enabled) => {
            button.dataset.active = String(!!enabled);
        });
        this._unsubscribers.push(unsubscribe);

        this._standaloneButtons.set(toolConfig.id, button);
        return button;
    }

    /**
     * Creates a button that runs a one-shot action.
     *
     * It never sets `data-active` and subscribes to nothing: there is no lasting
     * state for it to reflect, which is exactly what separates it from the other
     * two kinds. It is also kept OUT of `_standaloneButtons`, because that map is
     * what the lock and active-state passes iterate over, and an action has no
     * business in either.
     * @private
     * @param {Object} toolConfig - { id, label, icon, action, shortcut? }
     * @returns {HTMLButtonElement}
     */
    _createActionButton(toolConfig) {
        const button = document.createElement('button');
        button.className = 'toolbar-standalone-btn';
        button.dataset.toolId = toolConfig.id;
        button.title = toolConfig.shortcut
            ? `${toolConfig.label} (${toolConfig.shortcut})`
            : toolConfig.label;
        button.setAttribute('aria-label', toolConfig.label);
        button.innerHTML = toolConfig.icon;

        addDomListener(this, button, 'click', () => {
            const run = this._actions[toolConfig.action];
            if (!run) {
                console.warn(`[toolbar] no handler for action "${toolConfig.action}"`);
                return;
            }
            // The click handler stays synchronous: a rejected promise from an async
            // listener is an unhandled rejection nobody sees, and the actions report
            // their own outcome to the user anyway.
            run().catch(error => console.error(`[toolbar] action "${toolConfig.action}" failed:`, error));
        });

        return button;
    }

    /**
     * Handlers for `ACTION_TOOLS`, keyed by the `action` name in the config.
     *
     * Declared here and not in the constants file on purpose: the constants stay
     * declarative (id, label, icon) and importable by anything, while the behaviour
     * lives where the map and the controls already are.
     * @private
     */
    _actions = {
        /**
         * Copies a link to the current 2D view: base layer plus camera.
         *
         * The deep-link module is imported lazily because it is only ever needed
         * when someone presses this, and it drags the store barrel with it.
         */
        shareView: async () => {
            const [{ buildShareUrlBasemap, copyShareUrl }, { getCurrentBaseLayer }] = await Promise.all([
                import('@js/deep-link/deep-link.js'),
                import('@store/map.operations.js'),
            ]);

            const center = this._map.getCenter();
            // The base layer is read from the STORE, not from the control's own
            // field: the store is what `switchMap` reconciles on boot, so it is the
            // one that still agrees with the screen after a fallback took over.
            const basemap = await getCurrentBaseLayer().catch(() => null);

            await copyShareUrl(buildShareUrlBasemap(
                basemap,
                center.lng,
                center.lat,
                this._map.getZoom(),
                this._map.getBearing(),
                this._map.getPitch(),
            ));
        },
    };

    /**
     * Sets up event listeners.
     * @private
     */
    _setupEventListeners() {
        // Listen for active tool changes via StateManager
        const unsubscribe = this._stateManager.subscribe('activeTool.type', (activeToolType) => {
            this._updateStandaloneButtonStates(activeToolType);
        });
        this._unsubscribers.push(unsubscribe);

        // Listen for map lock changes
        subscribe(this, this._eventBus, EventTypes.MAP_LOCK_CHANGED,
            () => this._applyMapLockState());
    }

    /**
     * Shows or hides toolbar groups based on map lock state.
     * When locked: hide draw, military, analysis groups and snapping toggle.
     * Utility group remains visible.
     * @private
     */
    _applyMapLockState() {
        const locked = isCurrentMapLockedSync();
        const hiddenGroups = ['draw', 'military', 'analysis'];

        hiddenGroups.forEach(groupId => {
            const group = this._groups.get(groupId);
            if (group) {
                const el = group.getContainer();
                if (el) {
                    el.style.display = locked ? 'none' : '';
                }
            }
        });

        // Hide toggle buttons (snapping) when locked
        TOGGLE_TOOLS.forEach(toolConfig => {
            const button = this._standaloneButtons.get(toolConfig.id);
            if (button) {
                button.style.display = locked ? 'none' : '';
            }
        });

        // Deactivate current tool when locking
        if (locked && this._toolManager) {
            this._toolManager.deactivateCurrentTool();
        }
    }

    /**
     * Updates standalone button active states.
     * @private
     * @param {string|null} activeToolType - Active tool type from StateManager
     */
    _updateStandaloneButtonStates(activeToolType) {
        STANDALONE_TOOLS.forEach(toolConfig => {
            const button = this._standaloneButtons.get(toolConfig.id);
            if (!button) return;

            const control = this._controls[toolConfig.controlKey];
            const controlType = this._inferControlType(control);
            const isActive = controlType === activeToolType;

            button.dataset.active = isActive.toString();
        });
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
     * Gets a tool group by ID.
     * @param {string} groupId - Group ID
     * @returns {ToolbarGroup|undefined}
     */
    getGroup(groupId) {
        return this._groups.get(groupId);
    }

    /**
     * Gets the container element.
     * @returns {HTMLElement|null}
     */
    getContainer() {
        return this._container;
    }

    /**
     * Destroys the toolbar.
     */
    destroy() {
        this._groups.forEach(group => group.destroy());
        this._groups.clear();

        this._standaloneButtons.clear();

        cleanup(this);
        removeElement(this._container);
        this._container = null;
    }
}
