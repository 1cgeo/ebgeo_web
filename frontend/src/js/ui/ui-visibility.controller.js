// Path: js/ui/ui-visibility.controller.js

/**
 * @fileoverview UI Visibility Controller - manages visibility of UI elements.
 * Provides centralized control over UI element visibility with profile support.
 *
 * Components register themselves with show/hide callbacks.
 * Profiles define which elements should be visible in different modes.
 *
 * @module ui/ui-visibility.controller
 */

import { getEventBus } from '@store/services.js';

// ============================================================================
// ENUMS
// ============================================================================

/**
 * UI element identifiers.
 * Components register using these IDs.
 * @readonly
 * @enum {string}
 */
export const UIElement = Object.freeze({
    // Toolbars
    TOOLBAR_DRAW: 'toolbar:draw',
    TOOLBAR_MILITARY: 'toolbar:military',
    TOOLBAR_ANALYSIS: 'toolbar:analysis',
    TOOLBAR_MAIN: 'toolbar:main',

    // Search
    SEARCH_BAR: 'search:bar',
    SEARCH_CHIPS: 'search:chips',

    // Sidebar
    SIDEBAR: 'sidebar:main',
    SIDEBAR_COLLAPSED: 'sidebar:collapsed',

    // Map controls
    BASE_LAYER_SELECTOR: 'baseLayer:selector',
    COORDINATES_PANEL: 'coordinates:panel',
    TERRAIN_BUTTON: 'terrain:button',
    GRID_BUTTON: 'grid:button',

    // Bottom controls
    BOTTOM_CONTROLS: 'bottom:controls',
    VIEWER_3D_BUTTON: 'viewer:3d:button',
    VIEWER_360_BUTTON: 'viewer:360:button',

    // Attribute table
    ATTRIBUTE_TABLE: 'attribute:table',

    // Context menu
    CONTEXT_MENU: 'context:menu'
});

/**
 * Visibility profile names.
 * @readonly
 * @enum {string}
 */
export const VisibilityProfile = Object.freeze({
    /** All elements visible (default) */
    NORMAL: 'normal',
    /** Briefing presentation mode - 2D map */
    BRIEFING_PRESENT_2D: 'briefing:present:2d',
    /** Briefing presentation mode - 3D viewer */
    BRIEFING_PRESENT_3D: 'briefing:present:3d',
    /** Briefing presentation mode - 360 viewer */
    BRIEFING_PRESENT_360: 'briefing:present:360',
    /** Briefing locked mode - 2D map (editor/presenter with sidebar available) */
    BRIEFING_LOCKED_2D: 'briefing:locked:2d',
    /** Briefing locked mode - 3D viewer */
    BRIEFING_LOCKED_3D: 'briefing:locked:3d',
    /** Briefing locked mode - 360 viewer */
    BRIEFING_LOCKED_360: 'briefing:locked:360'
});

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Event types emitted by UIVisibilityController.
 * @readonly
 * @enum {string}
 */
export const UIVisibilityEvents = Object.freeze({
    /** Emitted when visibility profile changes */
    PROFILE_CHANGED: 'ui:visibilityProfileChanged'
});

// ============================================================================
// PROFILE DEFINITIONS
// ============================================================================

/**
 * Profile definitions - maps profile names to element visibility.
 * true = visible, false = hidden
 * Elements not listed inherit from 'normal' profile.
 */
const PROFILES = {
    [VisibilityProfile.NORMAL]: {
        // All visible by default - this is the base profile
        [UIElement.TOOLBAR_DRAW]: true,
        [UIElement.TOOLBAR_MILITARY]: true,
        [UIElement.TOOLBAR_ANALYSIS]: true,
        [UIElement.TOOLBAR_MAIN]: true,
        [UIElement.SEARCH_BAR]: true,
        [UIElement.SEARCH_CHIPS]: true,
        [UIElement.SIDEBAR]: true,
        [UIElement.SIDEBAR_COLLAPSED]: true,
        [UIElement.BASE_LAYER_SELECTOR]: true,
        [UIElement.COORDINATES_PANEL]: true,
        [UIElement.TERRAIN_BUTTON]: true,
        [UIElement.GRID_BUTTON]: true,
        [UIElement.BOTTOM_CONTROLS]: true,
        [UIElement.VIEWER_3D_BUTTON]: true,
        [UIElement.VIEWER_360_BUTTON]: true,
        [UIElement.ATTRIBUTE_TABLE]: true,
        [UIElement.CONTEXT_MENU]: true
    },

    [VisibilityProfile.BRIEFING_PRESENT_2D]: {
        // Hide most UI elements for clean presentation
        [UIElement.TOOLBAR_DRAW]: false,
        [UIElement.TOOLBAR_MILITARY]: false,
        [UIElement.TOOLBAR_ANALYSIS]: false,
        [UIElement.TOOLBAR_MAIN]: false,
        [UIElement.SEARCH_CHIPS]: false,
        [UIElement.SIDEBAR]: false,
        [UIElement.SIDEBAR_COLLAPSED]: false,
        [UIElement.BASE_LAYER_SELECTOR]: false,
        [UIElement.GRID_BUTTON]: false,
        [UIElement.BOTTOM_CONTROLS]: false,
        [UIElement.VIEWER_3D_BUTTON]: false,
        [UIElement.VIEWER_360_BUTTON]: false,
        [UIElement.ATTRIBUTE_TABLE]: false,
        [UIElement.CONTEXT_MENU]: false,
        // Keep visible: search bar (for feature selection) and coordinates
        [UIElement.SEARCH_BAR]: true,
        [UIElement.COORDINATES_PANEL]: true,
        [UIElement.TERRAIN_BUTTON]: true
    },

    [VisibilityProfile.BRIEFING_PRESENT_3D]: {
        // Similar to 2D but for 3D viewer context
        [UIElement.TOOLBAR_DRAW]: false,
        [UIElement.TOOLBAR_MILITARY]: false,
        [UIElement.TOOLBAR_ANALYSIS]: false,
        [UIElement.TOOLBAR_MAIN]: false,
        [UIElement.SEARCH_CHIPS]: false,
        [UIElement.SIDEBAR]: false,
        [UIElement.SIDEBAR_COLLAPSED]: false,
        [UIElement.BASE_LAYER_SELECTOR]: false,
        [UIElement.GRID_BUTTON]: false,
        [UIElement.BOTTOM_CONTROLS]: false,
        [UIElement.VIEWER_3D_BUTTON]: false,
        [UIElement.VIEWER_360_BUTTON]: false,
        [UIElement.ATTRIBUTE_TABLE]: false,
        [UIElement.CONTEXT_MENU]: false,
        [UIElement.SEARCH_BAR]: true,
        [UIElement.COORDINATES_PANEL]: true,
        [UIElement.TERRAIN_BUTTON]: false
    },

    [VisibilityProfile.BRIEFING_PRESENT_360]: {
        // Similar to 2D but for 360 viewer context
        [UIElement.TOOLBAR_DRAW]: false,
        [UIElement.TOOLBAR_MILITARY]: false,
        [UIElement.TOOLBAR_ANALYSIS]: false,
        [UIElement.TOOLBAR_MAIN]: false,
        [UIElement.SEARCH_CHIPS]: false,
        [UIElement.SIDEBAR]: false,
        [UIElement.SIDEBAR_COLLAPSED]: false,
        [UIElement.BASE_LAYER_SELECTOR]: false,
        [UIElement.GRID_BUTTON]: false,
        [UIElement.BOTTOM_CONTROLS]: false,
        [UIElement.VIEWER_3D_BUTTON]: false,
        [UIElement.VIEWER_360_BUTTON]: false,
        [UIElement.ATTRIBUTE_TABLE]: false,
        [UIElement.CONTEXT_MENU]: false,
        [UIElement.SEARCH_BAR]: true,
        [UIElement.COORDINATES_PANEL]: false,
        [UIElement.TERRAIN_BUTTON]: false
    },

    [VisibilityProfile.BRIEFING_LOCKED_2D]: {
        // Briefing locked mode: sidebar hidden, toolbars hidden, search bar visible
        [UIElement.TOOLBAR_DRAW]: false,
        [UIElement.TOOLBAR_MILITARY]: false,
        [UIElement.TOOLBAR_ANALYSIS]: false,
        [UIElement.TOOLBAR_MAIN]: false,
        [UIElement.SEARCH_CHIPS]: false,
        [UIElement.SIDEBAR]: false,
        [UIElement.SIDEBAR_COLLAPSED]: false,
        [UIElement.BASE_LAYER_SELECTOR]: false,
        [UIElement.GRID_BUTTON]: false,
        [UIElement.BOTTOM_CONTROLS]: false,
        [UIElement.VIEWER_3D_BUTTON]: false,
        [UIElement.VIEWER_360_BUTTON]: false,
        [UIElement.ATTRIBUTE_TABLE]: false,
        [UIElement.CONTEXT_MENU]: false,
        [UIElement.SEARCH_BAR]: true,
        [UIElement.COORDINATES_PANEL]: true,
        [UIElement.TERRAIN_BUTTON]: true
    },

    [VisibilityProfile.BRIEFING_LOCKED_3D]: {
        [UIElement.TOOLBAR_DRAW]: false,
        [UIElement.TOOLBAR_MILITARY]: false,
        [UIElement.TOOLBAR_ANALYSIS]: false,
        [UIElement.TOOLBAR_MAIN]: false,
        [UIElement.SEARCH_CHIPS]: false,
        [UIElement.SIDEBAR]: false,
        [UIElement.SIDEBAR_COLLAPSED]: false,
        [UIElement.BASE_LAYER_SELECTOR]: false,
        [UIElement.GRID_BUTTON]: false,
        [UIElement.BOTTOM_CONTROLS]: false,
        [UIElement.VIEWER_3D_BUTTON]: false,
        [UIElement.VIEWER_360_BUTTON]: false,
        [UIElement.ATTRIBUTE_TABLE]: false,
        [UIElement.CONTEXT_MENU]: false,
        [UIElement.SEARCH_BAR]: true,
        [UIElement.COORDINATES_PANEL]: true,
        [UIElement.TERRAIN_BUTTON]: false
    },

    [VisibilityProfile.BRIEFING_LOCKED_360]: {
        [UIElement.TOOLBAR_DRAW]: false,
        [UIElement.TOOLBAR_MILITARY]: false,
        [UIElement.TOOLBAR_ANALYSIS]: false,
        [UIElement.TOOLBAR_MAIN]: false,
        [UIElement.SEARCH_CHIPS]: false,
        [UIElement.SIDEBAR]: false,
        [UIElement.SIDEBAR_COLLAPSED]: false,
        [UIElement.BASE_LAYER_SELECTOR]: false,
        [UIElement.GRID_BUTTON]: false,
        [UIElement.BOTTOM_CONTROLS]: false,
        [UIElement.VIEWER_3D_BUTTON]: false,
        [UIElement.VIEWER_360_BUTTON]: false,
        [UIElement.ATTRIBUTE_TABLE]: false,
        [UIElement.CONTEXT_MENU]: false,
        [UIElement.SEARCH_BAR]: true,
        [UIElement.COORDINATES_PANEL]: false,
        [UIElement.TERRAIN_BUTTON]: false
    }
};

// ============================================================================
// CONTROLLER CLASS
// ============================================================================

/**
 * UI Visibility Controller.
 * Manages visibility of UI elements through profiles.
 */
class UIVisibilityController {
    constructor() {
        /**
         * Registered components with their callbacks.
         * @type {Map<string, {show: Function, hide: Function}>}
         */
        this._registry = new Map();

        /**
         * Current visibility profile.
         * @type {string}
         */
        this._currentProfile = VisibilityProfile.NORMAL;

        /**
         * Current visibility state for each element.
         * @type {Map<string, boolean>}
         */
        this._visibilityState = new Map();

        // Initialize visibility state from normal profile
        for (const [elementId, visible] of Object.entries(PROFILES[VisibilityProfile.NORMAL])) {
            this._visibilityState.set(elementId, visible);
        }
    }

    // =========================================================================
    // REGISTRATION
    // =========================================================================

    /**
     * Registers a UI component with show/hide callbacks.
     *
     * @param {string} elementId - Element identifier from UIElement enum
     * @param {Object} callbacks - Callback functions
     * @param {Function} callbacks.show - Called to show the element
     * @param {Function} callbacks.hide - Called to hide the element
     */
    register(elementId, callbacks) {
        if (!callbacks.show || !callbacks.hide) {
            console.warn(`UIVisibilityController: Invalid callbacks for ${elementId}`);
            return;
        }

        this._registry.set(elementId, callbacks);

        // Apply current visibility state to newly registered element
        const shouldBeVisible = this._visibilityState.get(elementId);
        if (shouldBeVisible === false) {
            callbacks.hide();
        }
    }

    /**
     * Unregisters a UI component.
     *
     * @param {string} elementId - Element identifier
     */
    unregister(elementId) {
        this._registry.delete(elementId);
    }

    // =========================================================================
    // PROFILE MANAGEMENT
    // =========================================================================

    /**
     * Applies a visibility profile.
     *
     * @param {string} profileName - Profile name from VisibilityProfile enum
     * @returns {boolean} True if profile was applied
     */
    applyProfile(profileName) {
        const profile = PROFILES[profileName];
        if (!profile) {
            console.warn(`UIVisibilityController: Unknown profile ${profileName}`);
            return false;
        }

        const previousProfile = this._currentProfile;
        this._currentProfile = profileName;

        // Apply visibility changes
        for (const [elementId, shouldBeVisible] of Object.entries(profile)) {
            const currentlyVisible = this._visibilityState.get(elementId);

            if (currentlyVisible !== shouldBeVisible) {
                this._visibilityState.set(elementId, shouldBeVisible);

                const callbacks = this._registry.get(elementId);
                if (callbacks) {
                    if (shouldBeVisible) {
                        callbacks.show();
                    } else {
                        callbacks.hide();
                    }
                }
            }
        }

        // Emit event
        this._emitProfileChanged(previousProfile, profileName);

        return true;
    }

    /**
     * Gets the current profile name.
     *
     * @returns {string}
     */
    getCurrentProfile() {
        return this._currentProfile;
    }

    /**
     * Checks if an element is currently visible.
     *
     * @param {string} elementId - Element identifier
     * @returns {boolean}
     */
    isElementVisible(elementId) {
        return this._visibilityState.get(elementId) ?? true;
    }

    // =========================================================================
    // INDIVIDUAL ELEMENT CONTROL
    // =========================================================================

    /**
     * Shows a specific element (independent of profile).
     *
     * @param {string} elementId - Element identifier
     */
    showElement(elementId) {
        this._visibilityState.set(elementId, true);
        const callbacks = this._registry.get(elementId);
        if (callbacks) {
            callbacks.show();
        }
    }

    /**
     * Hides a specific element (independent of profile).
     *
     * @param {string} elementId - Element identifier
     */
    hideElement(elementId) {
        this._visibilityState.set(elementId, false);
        const callbacks = this._registry.get(elementId);
        if (callbacks) {
            callbacks.hide();
        }
    }

    /**
     * Toggles a specific element's visibility.
     *
     * @param {string} elementId - Element identifier
     * @returns {boolean} New visibility state
     */
    toggleElement(elementId) {
        const currentlyVisible = this._visibilityState.get(elementId) ?? true;
        if (currentlyVisible) {
            this.hideElement(elementId);
        } else {
            this.showElement(elementId);
        }
        return !currentlyVisible;
    }

    // =========================================================================
    // CUSTOM PROFILES
    // =========================================================================

    /**
     * Defines a custom visibility profile.
     *
     * @param {string} profileName - Unique profile name
     * @param {Object} visibility - Map of elementId to boolean
     */
    defineProfile(profileName, visibility) {
        if (PROFILES[profileName]) {
            console.warn(`UIVisibilityController: Overwriting existing profile ${profileName}`);
        }
        PROFILES[profileName] = { ...PROFILES[VisibilityProfile.NORMAL], ...visibility };
    }

    // =========================================================================
    // EVENT EMISSION
    // =========================================================================

    /**
     * Emits profile changed event.
     * @private
     */
    _emitProfileChanged(previousProfile, currentProfile) {
        const eventBus = getEventBus();
        if (eventBus) {
            eventBus.emit(UIVisibilityEvents.PROFILE_CHANGED, {
                previousProfile,
                currentProfile
            });
        }
    }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance = null;

/**
 * Gets the singleton UIVisibilityController instance.
 * Creates it on first access (lazy initialization).
 * @returns {UIVisibilityController}
 */
export function getUIVisibilityController() {
    if (!instance) {
        instance = new UIVisibilityController();
    }
    return instance;
}

/**
 * Alias for getUIVisibilityController.
 * Kept for backward compatibility with service initialization code.
 * @returns {UIVisibilityController}
 */
export const createUIVisibilityController = getUIVisibilityController;

export default UIVisibilityController;
