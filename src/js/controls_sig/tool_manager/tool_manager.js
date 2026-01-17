// Path: js/controls_sig/tool_manager/tool_manager.js

/**
 * @fileoverview Tool manager for activating/deactivating drawing tools.
 * Maintains local reference to active tool while syncing state to StateManager.
 */

import { getStateManager } from '../services.js';

class ToolManager {
    constructor() {
        /** @type {Object|null} Currently active tool */
        this.activeTool = null;
        this.selectionManager = null;
        this.uiManager = null;
    }

    /**
     * Set selection manager reference.
     * @param {Object} selectionManager
     */
    setSelectionManager(selectionManager) {
        this.selectionManager = selectionManager;
    }

    /**
     * Set UI manager reference.
     * @param {Object} uiManager
     */
    setUiManager(uiManager) {
        this.uiManager = uiManager;
    }

    /**
     * Activate a tool.
     * If the same tool is already active, deactivates it instead (toggle behavior).
     * @param {Object} tool - Tool instance to activate
     */
    setActiveTool(tool) {
        if (!tool) {
            return;
        }

        // Toggle behavior: clicking same tool deactivates it
        if (this.activeTool && this.activeTool === tool) {
            this.deactivateCurrentTool();
            return;
        }

        // Deactivate previous tool
        if (this.activeTool) {
            this.activeTool.deactivate();
        }

        // Activate new tool
        this.activeTool = tool;
        tool.activate();

        // Sync to StateManager for reactive UI updates
        this._syncToStateManager(tool);

        // Clear selection when activating a tool
        this.selectionManager.deselectAllFeatures();
    }

    /**
     * Deactivate the currently active tool.
     */
    deactivateCurrentTool() {
        if (this.activeTool) {
            this.activeTool.deactivate();
            this.activeTool = null;

            // Sync to StateManager
            this._syncToStateManager(null);
        }
    }

    /**
     * Check if any tool is currently active.
     * @returns {boolean}
     */
    hasActiveTool() {
        return this.activeTool !== null;
    }

    /**
     * Sync active tool state to StateManager.
     * @private
     * @param {Object|null} tool - Active tool or null
     */
    _syncToStateManager(tool) {
        try {
            const stateManager = getStateManager();

            if (tool) {
                const toolType = this._inferToolType(tool);
                stateManager.setActiveTool(toolType, {});
            } else {
                stateManager.setActiveTool(null);
            }
        } catch (e) {
            // StateManager not available - continue without sync
        }
    }

    /**
     * Infer tool type string from tool instance.
     * @private
     * @param {Object} tool - Tool instance
     * @returns {string}
     */
    _inferToolType(tool) {
        // First, check if tool has explicit type property
        if (tool.type) {
            return tool.type;
        }

        // Fallback: derive from constructor name
        // e.g., "AddPointControl" -> "point"
        const className = tool.constructor.name;
        return className
            .replace('Add', '')
            .replace('Control', '')
            .toLowerCase();
    }
}

export default ToolManager;
