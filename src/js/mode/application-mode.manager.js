// Path: js/mode/application-mode.manager.js

/**
 * @fileoverview Application Mode Manager - central state for application modes.
 * Manages both application modes (Normal, Briefing Edit, Briefing Present)
 * and viewer modes (2D Map, 3D Viewer, 360 Viewer).
 *
 * @module mode/application-mode.manager
 */

import { getEventBus } from '@store/services.js';

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Application mode enumeration.
 * Defines the high-level operational mode of the application.
 * @readonly
 * @enum {string}
 */
export const ApplicationMode = Object.freeze({
    /** Normal mode - standard map editing */
    NORMAL: 'normal',
    /** Briefing edit mode - creating/editing a briefing */
    BRIEFING_EDIT: 'briefing:edit',
    /** Briefing present mode - presenting a briefing */
    BRIEFING_PRESENT: 'briefing:present'
});

/**
 * Viewer mode enumeration.
 * Defines which viewer is currently active.
 * @readonly
 * @enum {string}
 */
export const ViewerMode = Object.freeze({
    /** 2D MapLibre map viewer */
    MAP_2D: '2d',
    /** 3D Cesium viewer */
    VIEWER_3D: '3d',
    /** 360 panorama viewer */
    VIEWER_360: '360'
});

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Event types emitted by ApplicationModeManager.
 * @readonly
 * @enum {string}
 */
export const ApplicationModeEvents = Object.freeze({
    /** Emitted when application mode changes */
    MODE_CHANGED: 'application:modeChanged',
    /** Emitted when viewer mode changes */
    VIEWER_MODE_CHANGED: 'application:viewerModeChanged'
});

// ============================================================================
// MANAGER CLASS
// ============================================================================

/**
 * Application Mode Manager - single source of truth for application state.
 *
 * Manages:
 * - Current application mode (Normal, Briefing Edit, Briefing Present)
 * - Current viewer mode (2D, 3D, 360)
 * - Mode context (briefing ID, slide index, etc.)
 * - Previous state for restoration
 */
class ApplicationModeManager {
    constructor() {
        /** @type {ApplicationMode} Current application mode */
        this._currentMode = ApplicationMode.NORMAL;

        /** @type {ViewerMode} Current viewer mode */
        this._currentViewerMode = ViewerMode.MAP_2D;

        /** @type {Object|null} Context data for current mode */
        this._modeContext = null;

        /** @type {Array<Object>} State stack for multi-level restoration */
        this._stateStack = [];
    }

    // =========================================================================
    // GETTERS
    // =========================================================================

    /**
     * Gets the current application mode.
     * @returns {ApplicationMode}
     */
    getMode() {
        return this._currentMode;
    }

    /**
     * Gets the current viewer mode.
     * @returns {ViewerMode}
     */
    getViewerMode() {
        return this._currentViewerMode;
    }

    /**
     * Gets the current mode context.
     * @returns {Object|null}
     */
    getModeContext() {
        return this._modeContext;
    }

    // =========================================================================
    // MODE CHECKS
    // =========================================================================

    /**
     * Checks if currently in normal mode.
     * @returns {boolean}
     */
    isNormalMode() {
        return this._currentMode === ApplicationMode.NORMAL;
    }

    /**
     * Checks if currently in briefing edit mode.
     * @returns {boolean}
     */
    isBriefingEditMode() {
        return this._currentMode === ApplicationMode.BRIEFING_EDIT;
    }

    /**
     * Checks if currently in briefing present mode.
     * @returns {boolean}
     */
    isBriefingPresentMode() {
        return this._currentMode === ApplicationMode.BRIEFING_PRESENT;
    }

    /**
     * Checks if currently in any briefing mode (edit or present).
     * @returns {boolean}
     */
    isBriefingMode() {
        return this.isBriefingEditMode() || this.isBriefingPresentMode();
    }

    // =========================================================================
    // VIEWER MODE CHECKS
    // =========================================================================

    /**
     * Checks if 2D map viewer is active.
     * @returns {boolean}
     */
    is2DMapActive() {
        return this._currentViewerMode === ViewerMode.MAP_2D;
    }

    /**
     * Checks if 3D viewer is active.
     * @returns {boolean}
     */
    is3DViewerActive() {
        return this._currentViewerMode === ViewerMode.VIEWER_3D;
    }

    /**
     * Checks if 360 viewer is active.
     * @returns {boolean}
     */
    is360ViewerActive() {
        return this._currentViewerMode === ViewerMode.VIEWER_360;
    }

    // =========================================================================
    // MODE TRANSITIONS
    // =========================================================================

    /**
     * Enters a new application mode.
     * Automatically saves current state for later restoration.
     *
     * @param {ApplicationMode} mode - Mode to enter
     * @param {Object} [context=null] - Context data for the mode
     * @returns {boolean} True if mode changed
     */
    enterMode(mode, context = null) {
        if (!Object.values(ApplicationMode).includes(mode)) {
            console.warn(`Invalid application mode: ${mode}`);
            return false;
        }

        if (this._currentMode === mode) {
            // Just update context if already in the mode
            this._modeContext = context;
            return false;
        }

        // Push current state onto stack for restoration
        this._stateStack.push({
            mode: this._currentMode,
            viewerMode: this._currentViewerMode,
            context: this._modeContext
        });

        const previousMode = this._currentMode;
        this._currentMode = mode;
        this._modeContext = context;

        // Emit event
        this._emitModeChanged(previousMode, mode, context);

        return true;
    }

    /**
     * Sets the viewer mode.
     *
     * @param {ViewerMode} viewerMode - Viewer mode to set
     * @returns {boolean} True if viewer mode changed
     */
    setViewerMode(viewerMode) {
        if (!Object.values(ViewerMode).includes(viewerMode)) {
            console.warn(`Invalid viewer mode: ${viewerMode}`);
            return false;
        }

        if (this._currentViewerMode === viewerMode) {
            return false;
        }

        const previousMode = this._currentViewerMode;
        this._currentViewerMode = viewerMode;

        // Emit event
        this._emitViewerModeChanged(previousMode, viewerMode);

        return true;
    }

    /**
     * Exits current mode and restores previous state.
     *
     * @returns {boolean} True if state was restored
     */
    exitMode() {
        if (this._stateStack.length === 0) {
            // No previous state, reset to normal
            if (this._currentMode !== ApplicationMode.NORMAL) {
                const previousMode = this._currentMode;
                this._currentMode = ApplicationMode.NORMAL;
                this._modeContext = null;
                this._emitModeChanged(previousMode, ApplicationMode.NORMAL, null);
                return true;
            }
            return false;
        }

        const { mode, viewerMode, context } = this._stateStack.pop();
        const previousMode = this._currentMode;
        const previousViewerMode = this._currentViewerMode;

        this._currentMode = mode;
        this._modeContext = context;

        // Emit mode change event
        if (previousMode !== mode) {
            this._emitModeChanged(previousMode, mode, context);
        }

        // Emit viewer mode change event if needed
        if (previousViewerMode !== viewerMode) {
            this._currentViewerMode = viewerMode;
            this._emitViewerModeChanged(previousViewerMode, viewerMode);
        }

        return true;
    }

    /**
     * Resets to normal mode and 2D viewer.
     * Clears all state including previous state.
     */
    reset() {
        const previousMode = this._currentMode;
        const previousViewerMode = this._currentViewerMode;

        this._currentMode = ApplicationMode.NORMAL;
        this._currentViewerMode = ViewerMode.MAP_2D;
        this._modeContext = null;
        this._stateStack = [];

        if (previousMode !== ApplicationMode.NORMAL) {
            this._emitModeChanged(previousMode, ApplicationMode.NORMAL, null);
        }

        if (previousViewerMode !== ViewerMode.MAP_2D) {
            this._emitViewerModeChanged(previousViewerMode, ViewerMode.MAP_2D);
        }
    }

    // =========================================================================
    // EVENT EMISSION
    // =========================================================================

    /**
     * Emits mode changed event.
     * @private
     */
    _emitModeChanged(previousMode, currentMode, context) {
        const eventBus = getEventBus();
        if (eventBus) {
            eventBus.emit(ApplicationModeEvents.MODE_CHANGED, {
                previousMode,
                currentMode,
                context
            });
        }
    }

    /**
     * Emits viewer mode changed event.
     * @private
     */
    _emitViewerModeChanged(previousMode, currentMode) {
        const eventBus = getEventBus();
        if (eventBus) {
            eventBus.emit(ApplicationModeEvents.VIEWER_MODE_CHANGED, {
                previousMode,
                currentMode
            });
        }
    }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance = null;

/**
 * Gets the singleton ApplicationModeManager instance.
 * @returns {ApplicationModeManager}
 */
export function getApplicationModeManager() {
    if (!instance) {
        instance = new ApplicationModeManager();
    }
    return instance;
}

/**
 * Creates the ApplicationModeManager instance.
 * Should be called once during service initialization.
 * Throws if already created to prevent accidental double-init.
 * @returns {ApplicationModeManager}
 */
export function createApplicationModeManager() {
    if (instance) {
        console.warn('ApplicationModeManager already created, returning existing instance');
        return instance;
    }
    instance = new ApplicationModeManager();
    return instance;
}

export default ApplicationModeManager;
