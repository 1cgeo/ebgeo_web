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
 *
 * THERE IS NO INHERITANCE. This comment used to promise "elements not listed inherit from
 * the 'normal' profile", and `applyProfile` never implemented it: an element a profile omits
 * simply KEEPS whatever state it had, which is the previous profile's state, not the normal
 * one. The promise is harmless today only because every built-in table below is exhaustive
 * over `UIElement`, so nothing is ever omitted. The prose was corrected rather than the code
 * because the code is the one the seven tables were written against, and a late-added
 * inheritance step would silently re-show elements that a partial profile meant to leave
 * alone. `defineProfile` DOES merge over normal, and that is a property of that function, not
 * of the table format.
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

/**
 * Names `defineProfile` refuses to redefine. Derived from the enum so a profile added there
 * is protected without a second edit.
 * @type {Set<string>}
 */
const BUILT_IN_PROFILES = new Set(Object.values(VisibilityProfile));

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
        // Test the OBJECT before reading through it: `callbacks.show` on a null/undefined
        // argument throws a TypeError out of a method whose whole job is to refuse bad input,
        // so a single mis-wired control took down the caller instead of logging a warning.
        if (!callbacks || !callbacks.show || !callbacks.hide) {
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
        // `Object.hasOwn`, NEVER the bare lookup: `PROFILES` is an object literal, so its
        // prototype chain is live and `PROFILES['constructor']` (or 'toString', 'valueOf',
        // 'hasOwnProperty') answers with a FUNCTION, which is truthy. The guard below then
        // passed, the method reported success, stamped `_currentProfile` with the bogus name
        // and emitted PROFILE_CHANGED, all without applying a single visibility. Same shape as
        // `arrivalNotice` in `projects/atlas-drive.js`; freezing the literal would not help,
        // because the chain stays reachable.
        const profile = Object.hasOwn(PROFILES, profileName) ? PROFILES[profileName] : null;
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
     * Defines a custom visibility profile, merged over the NORMAL baseline.
     *
     * A BUILT-IN profile (any value of `VisibilityProfile`) is refused, not overwritten.
     * Overwriting used to be allowed with only a warning, and the damage outlived the call:
     * `PROFILES` is a module-level mutable object, so poisoning NORMAL once meant every later
     * "back to normal" in that page load restored the POISONED table (a sidebar that stayed
     * hidden for the rest of the session, with nothing on screen explaining why). Redefining
     * a CUSTOM profile stays allowed, and still warns, because a caller that owns the name
     * owns the table.
     *
     * @param {string} profileName - Unique profile name
     * @param {Object} visibility - Map of elementId to boolean
     * @returns {boolean} True if the profile was defined
     */
    defineProfile(profileName, visibility) {
        if (BUILT_IN_PROFILES.has(profileName)) {
            console.warn(`UIVisibilityController: Refusing to redefine built-in profile ${profileName}`);
            return false;
        }
        if (Object.hasOwn(PROFILES, profileName)) {
            console.warn(`UIVisibilityController: Overwriting existing profile ${profileName}`);
        }
        PROFILES[profileName] = { ...PROFILES[VisibilityProfile.NORMAL], ...visibility };
        return true;
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

