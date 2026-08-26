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
import config from '@js/config.js';
import { showWarning, showError } from '@utils/toast_service.js';
import { controlType, ensureControl } from '@tools/tool-registry.js';

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
     * @param {Object} dependencies.eventBus - EventBus instance
     * @param {Object} dependencies.stateManager - StateManager instance
     * @param {Object} dependencies.map - MapLibre map instance
     */
    constructor(config, dependencies) {
        this._config = config;
        this._toolManager = dependencies.toolManager;
        this._eventBus = dependencies.eventBus;
        this._stateManager = dependencies.stateManager;
        this._map = dependencies.map;

        /** @type {boolean} Tranca do clique enquanto uma ferramenta está a caminho. */
        this._carregandoFerramenta = false;

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
            // O mapa do MapLibre NAO e um EventTarget: ele fala `on`/`off`, e nao
            // addEventListener/removeEventListener. Guardar este par no balde de
            // listeners de DOM fazia o `cleanup` chamar `removeEventListener` num
            // objeto que nao a tem, e o destroy morria com
            // "element?.removeEventListener is not a function", derrubando o
            // desmonte da barra inteira no meio. Guardamos o desinscritor, que e o
            // que o `cleanup` ja sabe executar.
            const terrainHandler = () => this._updateTerrainTools();
            this._map.on('terrain', terrainHandler);
            this._unsubscribers.push(() => this._map.off('terrain', terrainHandler));
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
    async _handleToolClick(toolConfig) {
        // Check terrain requirement
        if (toolConfig.requiresTerrain) {
            if (config.map2d?.terrainSource == null) {
                showWarning('Sem terreno disponível');
                return;
            }
            if (this._map && !this._map.getTerrain()) {
                showWarning('Ative o terreno 3D para usar esta ferramenta');
                return;
            }
        }

        const toolButton = this._toolButtons.get(toolConfig.id);

        // A TRANCA, e ela não é enfeite. A ferramenta agora vem por `await import()`, então o
        // clique retorna ANTES de ela existir. Dois cliques rápidos no mesmo botão entrariam
        // duas vezes em `setActiveTool` — e o segundo desativaria a ferramenta que o primeiro
        // acabou de ligar, deixando o usuário com um botão aceso e nenhum desenho.
        if (this._carregandoFerramenta) return;
        this._carregandoFerramenta = true;
        toolButton?.setLoading(true);

        try {
            const control = await ensureControl(toolConfig.controlKey);
            this._toolManager.setActiveTool(control);
            this._closePopup();
        } catch (erro) {
            console.error(`Falha ao carregar a ferramenta ${toolConfig.controlKey}:`, erro);
            showError('Não foi possível carregar a ferramenta');
        } finally {
            this._carregandoFerramenta = false;
            toolButton?.setLoading(false);
        }
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

            // O tipo vem da TABELA, não da instância. Duas consequências, e as duas importam:
            // o botão sabe se acender antes de a ferramenta existir, e o tipo deixa de depender
            // de `control.constructor.name`, que só funcionava porque o build mantém
            // `keepNames: true`.
            const isActive = controlType(toolConfig.controlKey) === activeToolType;

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
     * Updates terrain-dependent tools.
     * @private
     */
    _updateTerrainTools() {
        const terrainConfigured = config.map2d?.terrainSource != null;
        const hasTerrain = terrainConfigured && this._map?.getTerrain() != null;
        const reason = !terrainConfigured
            ? 'Sem terreno disponível'
            : (hasTerrain ? null : 'Ative o terreno 3D para usar esta ferramenta');

        this._config.tools.forEach(toolConfig => {
            if (toolConfig.requiresTerrain) {
                const button = this._toolButtons.get(toolConfig.id);
                if (button) {
                    button.setDisabled(!hasTerrain, reason);
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
        const terrainConfigured = config.map2d?.terrainSource != null;
        const hasTerrain = terrainConfigured && this._map?.getTerrain() != null;
        const reason = !terrainConfigured
            ? 'Sem terreno disponível'
            : (hasTerrain ? null : 'Ative o terreno 3D para usar esta ferramenta');
        toolButton.setDisabled(!hasTerrain, reason);
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
