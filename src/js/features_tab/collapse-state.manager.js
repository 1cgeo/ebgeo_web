// Path: js/features_tab/collapse-state.manager.js

/**
 * @fileoverview Wrapper for StateManager collapse functionality.
 * Provides a simplified interface for managing layer and group collapse states.
 */

import { getStateManager } from '../store';

/**
 * Class that wraps StateManager collapse functionality.
 * Falls back gracefully when StateManager is not available.
 */
export class CollapseStateManager {
    constructor() {
        this._stateManager = null;
    }

    /**
     * Gets StateManager instance lazily.
     * @returns {Object|null} StateManager instance or null
     * @private
     */
    _getStateManager() {
        if (!this._stateManager) {
            try {
                this._stateManager = getStateManager();
            } catch (_e) {
                // StateManager not available
            }
        }
        return this._stateManager;
    }

    // =========================================================================
    // LAYER COLLAPSE STATE
    // =========================================================================

    /**
     * Checks if a layer is collapsed.
     * @param {string} layerId - Layer ID
     * @returns {boolean} Whether layer is collapsed
     */
    isLayerCollapsed(layerId) {
        const sm = this._getStateManager();
        if (!sm) return false;
        try {
            return sm.isLayerCollapsed(layerId);
        } catch (_e) {
            return false;
        }
    }

    /**
     * Sets layer collapse state.
     * @param {string} layerId - Layer ID
     * @param {boolean} collapsed - Collapsed state
     */
    setLayerCollapsed(layerId, collapsed) {
        const sm = this._getStateManager();
        if (!sm) return;
        try {
            sm.toggleLayerCollapsed(layerId, collapsed);
        } catch (_e) {
            // StateManager not available
        }
    }

    /**
     * Toggles layer collapse state.
     * @param {string} layerId - Layer ID
     * @returns {boolean} New collapsed state
     */
    toggleLayerCollapsed(layerId) {
        const currentState = this.isLayerCollapsed(layerId);
        const newState = !currentState;
        this.setLayerCollapsed(layerId, newState);
        return newState;
    }

    /**
     * Gets all collapsed layer IDs.
     * @returns {string[]} Array of collapsed layer IDs
     */
    getCollapsedLayers() {
        const sm = this._getStateManager();
        if (!sm) return [];
        try {
            return sm.get('sidebar.collapsedLayers') || [];
        } catch (_e) {
            return [];
        }
    }

    // =========================================================================
    // GROUP COLLAPSE STATE
    // =========================================================================

    /**
     * Checks if a group is collapsed.
     * @param {string} groupId - Group ID
     * @returns {boolean} Whether group is collapsed
     */
    isGroupCollapsed(groupId) {
        const sm = this._getStateManager();
        if (!sm) return false;
        try {
            return sm.isGroupCollapsed(groupId);
        } catch (_e) {
            return false;
        }
    }

    /**
     * Sets group collapse state.
     * @param {string} groupId - Group ID
     * @param {boolean} collapsed - Collapsed state
     */
    setGroupCollapsed(groupId, collapsed) {
        const sm = this._getStateManager();
        if (!sm) return;
        try {
            sm.toggleGroupCollapsed(groupId, collapsed);
        } catch (_e) {
            // StateManager not available
        }
    }

    /**
     * Toggles group collapse state.
     * @param {string} groupId - Group ID
     * @returns {boolean} New collapsed state
     */
    toggleGroupCollapsed(groupId) {
        const currentState = this.isGroupCollapsed(groupId);
        const newState = !currentState;
        this.setGroupCollapsed(groupId, newState);
        return newState;
    }

    /**
     * Gets all collapsed group IDs.
     * @returns {string[]} Array of collapsed group IDs
     */
    getCollapsedGroups() {
        const sm = this._getStateManager();
        if (!sm) return [];
        try {
            return sm.get('sidebar.collapsedGroups') || [];
        } catch (_e) {
            return [];
        }
    }
}

// Singleton instance
let instance = null;

/**
 * Gets the CollapseStateManager singleton instance.
 * @returns {CollapseStateManager} Singleton instance
 */
export function getCollapseStateManager() {
    if (!instance) {
        instance = new CollapseStateManager();
    }
    return instance;
}
