// Path: js/toolbar/components/active-tool-chip.js

/**
 * @fileoverview Active tool indicator chip component.
 * Shows current active tool with option to deactivate.
 */

import { EventTypes } from '../../events/event_types.js';
import {
    setupCleanup,
    subscribe,
    addDomListener,
    cleanup,
    removeElement
} from '../../utilities/event-cleanup.js';

/**
 * Tool display names (Portuguese).
 * Only toolbar-related tools should be shown in the chip.
 */
const TOOL_NAMES = {
    // Draw tools
    point: 'Ponto',
    line: 'Linha',
    polygon: 'Polígono',
    rectangle: 'Retângulo',
    circle: 'Círculo',
    ellipse: 'Elipse',
    text: 'Texto',
    image: 'Imagem',
    brush: 'Pincel',

    // Military tools
    military_symbol: 'Símbolo Militar',
    militarysymbol: 'Símbolo Militar',
    coordination_measure: 'Medida de Coordenação',
    coordinationmeasure: 'Medida de Coordenação',
    arrow: 'Seta',
    boundary: 'Linha de Limite',
    occupied_front: 'Frente Ocupada',
    occupiedfront: 'Frente Ocupada',
    azimuth_distance: 'Azimute e Distância',
    azimuthdistance: 'Azimute e Distância',

    // Analysis tools
    los: 'Linha de Visada',
    visibility: 'Análise de Visibilidade',

    // Measurement tools
    measurementdistance: 'Medir Distância',
    measurementarea: 'Medir Área',
    measurementangle: 'Medir Ângulo',

    // Standalone tools
    vectortileinfo: 'Informações da Carta',
    rectangleselection: 'Selecionar',
};

/**
 * Set of toolbar tool types (normalized).
 * Only these tools will show the active chip indicator.
 */
const TOOLBAR_TOOLS = new Set([
    // Draw tools
    'point', 'line', 'polygon', 'rectangle', 'circle', 'ellipse', 'text', 'image', 'brush',
    // Military tools
    'military_symbol', 'militarysymbol', 'coordination_measure', 'coordinationmeasure',
    'arrow', 'boundary', 'occupied_front', 'occupiedfront',
    // Analysis tools
    'los', 'visibility',
    // Measurement tools
    'measurementdistance', 'measurementarea', 'measurementangle',
    // Utility tools
    'vectortileinfo', 'rectangleselection',
    'azimuth_distance', 'azimuthdistance',
]);

/**
 * SVG close icon.
 */
const CLOSE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

/**
 * Active tool chip component.
 */
export class ActiveToolChip {
    /**
     * @param {Object} dependencies - Required dependencies
     * @param {Object} dependencies.stateManager - StateManager instance
     * @param {Object} dependencies.eventBus - EventBus instance
     * @param {Object} dependencies.toolManager - ToolManager instance
     */
    constructor(dependencies) {
        this._stateManager = dependencies.stateManager;
        this._eventBus = dependencies.eventBus;
        this._toolManager = dependencies.toolManager;

        this._container = null;
        this._labelSpan = null;
        this._currentTool = null;

        setupCleanup(this);
    }

    /**
     * Initializes and attaches the chip to DOM.
     * @param {HTMLElement} parentElement - Parent element
     */
    init(parentElement) {
        this._createElements();
        this._setupEventListeners();
        parentElement.appendChild(this._container);

        // Check initial state
        this._updateFromState();
    }

    /**
     * Creates DOM elements.
     * @private
     */
    _createElements() {
        // Main container
        this._container = document.createElement('div');
        this._container.className = 'active-tool-chip';
        this._container.id = 'active-tool-chip';
        this._container.style.display = 'none'; // Hidden by default

        // Chip inner wrapper
        const chipWrapper = document.createElement('div');
        chipWrapper.className = 'active-tool-chip-inner';

        // Static label
        const staticLabel = document.createElement('span');
        staticLabel.className = 'active-tool-chip-label';
        staticLabel.textContent = 'Ferramenta ativa:';

        // Tool name (dynamic)
        this._labelSpan = document.createElement('span');
        this._labelSpan.className = 'active-tool-chip-name';

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'active-tool-chip-close';
        closeBtn.innerHTML = CLOSE_ICON;
        closeBtn.title = 'Desativar ferramenta (ESC)';
        closeBtn.setAttribute('aria-label', 'Desativar ferramenta');

        addDomListener(this, closeBtn, 'click', () => this._deactivateTool());

        // Assemble
        chipWrapper.appendChild(staticLabel);
        chipWrapper.appendChild(this._labelSpan);
        chipWrapper.appendChild(closeBtn);
        this._container.appendChild(chipWrapper);
    }

    /**
     * Sets up event listeners.
     * @private
     */
    _setupEventListeners() {
        // Subscribe to active tool changes via StateManager
        const unsubscribe = this._stateManager.subscribe('activeTool.type', (toolType) => {
            this._onToolChange(toolType);
        });

        // Store for cleanup
        if (!this._unsubscribers) this._unsubscribers = [];
        this._unsubscribers.push(unsubscribe);

        // UI_LAYOUT_CHANGED covers all sidebar/panel state changes
        subscribe(this, this._eventBus, EventTypes.UI_LAYOUT_CHANGED, () => this._updatePosition());
    }

    /**
     * Updates chip from current state.
     * @private
     */
    _updateFromState() {
        const toolType = this._stateManager.get('activeTool.type');
        this._onToolChange(toolType);
        this._updatePosition();
    }

    /**
     * Checks if tool type is a toolbar tool.
     * @private
     * @param {string} toolType - Tool type identifier
     * @returns {boolean} True if toolbar tool
     */
    _isToolbarTool(toolType) {
        if (!toolType) return false;
        const normalized = toolType.toLowerCase().replace(/_/g, '');
        return TOOLBAR_TOOLS.has(toolType) || TOOLBAR_TOOLS.has(normalized);
    }

    /**
     * Handles tool change.
     * @private
     * @param {string|null} toolType - New tool type
     */
    _onToolChange(toolType) {
        this._currentTool = toolType;

        // Only show chip for toolbar-related tools
        if (toolType && this._isToolbarTool(toolType)) {
            // Show chip with tool name
            const displayName = this._getToolDisplayName(toolType);
            this._labelSpan.textContent = displayName;
            this._container.style.display = 'block';

            // Animate in
            this._container.classList.remove('hiding');
            this._container.classList.add('visible');
        } else {
            // Hide chip with animation
            this._container.classList.remove('visible');
            this._container.classList.add('hiding');

            // Remove from DOM after animation
            setTimeout(() => {
                if (!this._currentTool || !this._isToolbarTool(this._currentTool)) {
                    this._container.style.display = 'none';
                    this._container.classList.remove('hiding');
                }
            }, 200);
        }
    }

    /**
     * Gets display name for tool type.
     * @private
     * @param {string} toolType - Tool type identifier
     * @returns {string} Display name
     */
    _getToolDisplayName(toolType) {
        if (!toolType) return '';

        // Normalize tool type (remove underscores, lowercase)
        const normalized = toolType.toLowerCase().replace(/_/g, '');

        // Check direct match first
        if (TOOL_NAMES[toolType]) {
            return TOOL_NAMES[toolType];
        }

        // Check normalized match
        if (TOOL_NAMES[normalized]) {
            return TOOL_NAMES[normalized];
        }

        // Fallback: capitalize first letter
        return toolType.charAt(0).toUpperCase() + toolType.slice(1).replace(/_/g, ' ');
    }

    /**
     * Updates position based on sidebar/panel state.
     * @private
     */
    _updatePosition() {
        if (!this._container) return;

        const sidebarExpanded = this._stateManager?.getUnsafe('sidebar.expanded') || false;
        const featurePanelOpen = this._stateManager?.getUnsafe('ui.featurePanelOpen') || false;

        this._container.dataset.sidebarState =
            (sidebarExpanded || featurePanelOpen) ? 'expanded' : 'collapsed';
    }

    /**
     * Deactivates the current tool.
     * @private
     */
    _deactivateTool() {
        if (this._toolManager) {
            this._toolManager.deactivateCurrentTool();
        }
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
        cleanup(this);
        removeElement(this._container);
        this._container = null;
    }
}
