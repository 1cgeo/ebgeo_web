// Path: js/tool_manager/tool_manager.js

/**
 * @fileoverview Tool manager for activating/deactivating drawing tools.
 * Maintains local reference to active tool while syncing state to StateManager.
 */

import { getStateManager } from '../store';
// Por ARQUIVO, de dois modulos folha: contar uma ativacao nao pode participar dela.
import { registrarUso } from '@js/session/uso-lote.js';
import { EventoDeUso } from '@js/session/eventos-de-uso.js';

class ToolManager {
    constructor() {
        /** @type {Object|null} Currently active tool */
        this.activeTool = null;
        this.selectionManager = null;
        this.uiManager = null;

        /** @type {Set<Object>} Active viewer tools (3D, Street View) - can be multiple */
        this.activeViewers = new Set();

        /** @type {Map<string, Set<Function>>} Event listeners */
        this._listeners = new Map();
    }

    /**
     * Register an event listener.
     * @param {string} event - Event name ('toolActivated' | 'toolDeactivated')
     * @param {Function} callback - Callback function
     */
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(callback);
    }

    /**
     * Remove an event listener.
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     */
    off(event, callback) {
        if (this._listeners.has(event)) {
            this._listeners.get(event).delete(callback);
        }
    }

    /**
     * Emit an event to all listeners.
     * @private
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    _emit(event, data) {
        if (this._listeners.has(event)) {
            this._listeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (e) {
                    console.error(`Error in ToolManager event listener for '${event}':`, e);
                }
            });
        }
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
            const previousTool = this.activeTool;
            this.activeTool.deactivate();
            this._emit('toolDeactivated', previousTool);
        }

        // Clear selection BEFORE activating a tool
        // This must happen before activate() because some tools (like azimuth_distance)
        // open panels in their activate() method, and deselectAllFeatures() closes panels
        this.selectionManager.deselectAllFeatures();

        // Activate new tool
        this.activeTool = tool;
        tool.activate();

        // Emit activation event
        this._emit('toolActivated', tool);

        // Sync to StateManager for reactive UI updates, and COUNT with the same derived type.
        //
        // A CONTAGEM VEM DEPOIS DA ATIVACAO, e o ramo de TOGGLE acima ja saiu com `return`: clicar
        // no mesmo botao para DESLIGAR nao e uma ativacao, e conta-la dobraria o numero de quem
        // liga e desliga.
        //
        // O TIPO E O QUE `_syncToStateManager` JA COMPUTOU, e nao uma segunda chamada de
        // `_inferToolType` aqui fora. Duas razoes: duas derivacoes do mesmo nome divergem no
        // primeiro controle novo, e `_inferToolType` le `tool.constructor.name`, que LANCA para um
        // `tool` sem prototipo. Uma excecao aqui derrubaria a ativacao que ela so deveria contar,
        // e este metodo nao tem `try` nenhum em volta.
        this._syncToStateManager(tool);
    }

    /**
     * Deactivate the currently active tool.
     */
    deactivateCurrentTool() {
        if (this.activeTool) {
            const previousTool = this.activeTool;
            this.activeTool.deactivate();
            this.activeTool = null;

            // Emit deactivation event
            this._emit('toolDeactivated', previousTool);

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
     * Toggle a viewer tool (3D, Street View).
     * Viewers can be active simultaneously and don't compete with drawing tools.
     * @param {Object} viewer - Viewer instance to toggle
     */
    toggleViewer(viewer) {
        if (!viewer) {
            return;
        }

        if (this.activeViewers.has(viewer)) {
            // Deactivate viewer
            viewer.deactivate();
            this.activeViewers.delete(viewer);
            this._emit('viewerDeactivated', viewer);
        } else {
            // Activate viewer
            viewer.activate();
            this.activeViewers.add(viewer);
            this._emit('viewerActivated', viewer);
        }
    }

    /**
     * Check if a specific viewer is active.
     * @param {Object} viewer - Viewer instance to check
     * @returns {boolean}
     */
    isViewerActive(viewer) {
        return this.activeViewers.has(viewer);
    }

    /**
     * Check if any viewer is currently active.
     * @returns {boolean}
     */
    hasActiveViewer() {
        return this.activeViewers.size > 0;
    }

    /**
     * Sync active tool state to StateManager.
     * @private
     * @param {Object|null} tool - Active tool or null
     */
    _syncToStateManager(tool) {
        // O TIPO E A CONTAGEM VEM PRIMEIRO, e num `try` PROPRIO, por duas razoes que se somam. A
        // derivacao le `tool.constructor.name` e LANCA para um `tool` sem prototipo, e este metodo
        // e chamado de `setActiveTool`, que nao tem `try` nenhum: uma excecao aqui derrubaria a
        // ativacao que ela so deveria contar. E o bloco e separado do de baixo para que uma pagina
        // sem StateManager (teste, headless) nao perca a contagem por causa dele: sao dois
        // efeitos independentes, e um nao pode custar o outro.
        let toolType = null;
        try {
            if (tool) {
                toolType = this._inferToolType(tool);
                registrarUso(EventoDeUso.FERRAMENTA_ATIVADA, toolType);
            }
        } catch (_e) {
            // Tool sem prototipo, ou derivacao impossivel: nao se conta, e nao se lanca.
        }

        try {
            const stateManager = getStateManager();

            if (tool) {
                stateManager.setActiveTool(toolType ?? this._inferToolType(tool), {});
            } else {
                stateManager.setActiveTool(null);
            }
        } catch (_e) {
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
