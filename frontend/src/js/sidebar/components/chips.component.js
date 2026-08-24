// Path: js/sidebar/components/chips.component.js

/**
 * @fileoverview Chips component - Quick action buttons below search bar.
 * Provides access to Tutorial, Info modal, and Shortcuts modal.
 */

import { EventTypes } from '@events/event_types.js';
import config from '@js/config.js';
import {
    setupCleanup,
    subscribe,
    addDomListener,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';
import { ShortcutsModal, InfoModal } from '@modals/index.js';
import { CatalogModal } from '@catalog/catalog.modal.js';
import { CatalogService } from '@catalog/catalog.service.js';
import { CATALOG_CHIP_CONFIG } from '@catalog/catalog.constants.js';

/**
 * Chip button configurations.
 * Catalog is added first if there are catalog items available.
 */
const CHIP_CONFIG = {
    catalog: CATALOG_CHIP_CONFIG,
    tutorial: {
        id: 'tutorial',
        label: 'Tutorial',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    },
    info: {
        id: 'info',
        label: 'Informações',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    },
    shortcuts: {
        id: 'shortcuts',
        label: 'Atalhos',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><path d="M6 8h.001"/><path d="M10 8h.001"/><path d="M14 8h.001"/><path d="M18 8h.001"/><path d="M8 12h.001"/><path d="M12 12h.001"/><path d="M16 12h.001"/><path d="M7 16h10"/></svg>`,
    },
};

/**
 * Chips component for quick actions.
 */
export class ChipsComponent {
    /**
     * @param {Object} dependencies - Required dependencies
     * @param {Object} dependencies.stateManager - StateManager instance
     * @param {Object} dependencies.eventBus - EventBus instance
     * @param {Object} [dependencies.toolManager] - ToolManager instance (for catalog)
     * @param {Object} [dependencies.map] - MapLibre map instance (for catalog)
     */
    constructor(dependencies) {
        this._stateManager = dependencies.stateManager;
        this._eventBus = dependencies.eventBus;
        this._toolManager = dependencies.toolManager || null;
        this._map = dependencies.map || null;

        this._container = null;

        // Modal instances
        this._shortcutsModal = null;
        this._infoModal = null;
        this._catalogModal = null;

        setupCleanup(this);
    }

    /**
     * Creates the chips UI and attaches to DOM.
     * @param {HTMLElement} parentElement - Parent to attach to
     */
    async init(parentElement) {
        this._container = document.createElement('div');
        this._container.className = 'chips-container';
        this._container.id = 'chips-container';

        // Set initial position state
        this._updatePosition();

        // Pre-load catalog availability (async)
        const hasCatalogItems = await CatalogService.hasItems();

        // Create chip buttons (filter out catalog if no items available)
        Object.entries(CHIP_CONFIG).forEach(([key, chipConfig]) => {
            // Only show catalog chip if there are catalog items
            if (key === 'catalog' && !hasCatalogItems) {
                return;
            }
            const chip = this._createChip(chipConfig);
            this._container.appendChild(chip);
        });

        parentElement.appendChild(this._container);

        // Initialize new modals
        await this._initModals(hasCatalogItems);

        // Setup event listeners
        this._setupEventListeners();
    }

    /**
     * Initializes the modal instances.
     * @private
     * @param {boolean} hasCatalogItems - Whether catalog items are available
     */
    _initModals(hasCatalogItems) {
        // Create shortcuts modal
        this._shortcutsModal = new ShortcutsModal();
        document.body.appendChild(this._shortcutsModal.render());

        // Create info modal
        this._infoModal = new InfoModal();
        document.body.appendChild(this._infoModal.render());

        // Create catalog modal if there are catalog items
        if (hasCatalogItems) {
            this._catalogModal = new CatalogModal({
                toolManager: this._toolManager,
                map: this._map,
                eventBus: this._eventBus,
                stateManager: this._stateManager
            });
            document.body.appendChild(this._catalogModal.render());
        }
    }

    /**
     * Creates a single chip button.
     * @private
     * @param {Object} chipConfig - Chip configuration
     * @returns {HTMLButtonElement}
     */
    _createChip(chipConfig) {
        const button = document.createElement('button');
        button.className = 'chip-btn';
        button.id = `chip-${chipConfig.id}`;
        button.setAttribute('aria-label', chipConfig.label);
        button.title = chipConfig.label;

        button.innerHTML = `
            ${chipConfig.icon}
            <span>${chipConfig.label}</span>
        `;

        // Bind click handler based on chip type
        const handler = this._getClickHandler(chipConfig.id);
        addDomListener(this, button, 'click', handler);

        return button;
    }

    /**
     * Gets the click handler for a specific chip.
     * @private
     * @param {string} chipId - Chip identifier
     * @returns {Function}
     */
    _getClickHandler(chipId) {
        switch (chipId) {
            case 'catalog':
                return () => this._handleCatalogClick();
            case 'tutorial':
                return () => this._handleTutorialClick();
            case 'info':
                return () => this._handleInfoClick();
            case 'shortcuts':
                return () => this._handleShortcutsClick();
            default:
                return () => {};
        }
    }

    /**
     * Handles Catalog chip click - opens catalog modal.
     * @private
     */
    _handleCatalogClick() {
        if (this._catalogModal) {
            this._catalogModal.show();
        } else {
            console.warn('Catalog modal not initialized');
        }
    }

    /**
     * Handles Tutorial chip click - opens in new window.
     * @private
     */
    _handleTutorialClick() {
        // Get tutorial URL from config or use default
        const tutorialUrl = config.app?.tutorialUrl || config.tutorialUrl || './docs/doc.html';

        // Open in new window (current behavior preserved)
        window.open(tutorialUrl, '_blank', 'noopener,noreferrer');
    }

    /**
     * Handles Info chip click - opens info modal.
     * @private
     */
    _handleInfoClick() {
        if (this._infoModal) {
            this._infoModal.show();
        } else {
            console.warn('Info modal not found');
        }
    }

    /**
     * Handles Shortcuts chip click - opens shortcuts modal.
     * @private
     */
    _handleShortcutsClick() {
        if (this._shortcutsModal) {
            this._shortcutsModal.show();
        } else {
            console.warn('Shortcuts modal not found');
        }
    }

    /**
     * Sets up event listeners for layout changes.
     * @private
     */
    _setupEventListeners() {
        // UI_LAYOUT_CHANGED covers all sidebar/panel state changes
        subscribe(this, this._eventBus, EventTypes.UI_LAYOUT_CHANGED,
            () => this._updatePosition());

        // O CHIP DO CATALOGO ERA DECIDIDO UMA VEZ, NO BOOT, e isso deixava sem porta nenhuma
        // justamente quem mais precisa dela. `CatalogService.hasItems()` mede o que a sessao
        // ATUAL enxerga, e o acervo privado so entra depois do login (a soma aditiva de
        // `refreshVisibleResources`). Numa instalacao de catalogo publico vazio, o produtor que
        // entra depois do boot ficava sem chip e sem caminho ate recarregar a pagina.
        //
        // SESSION_CHANGED cobre os dois sentidos: entrar faz o chip nascer, sair o faz sumir se o
        // que restou for vazio. E o reexame e assincrono e idempotente, entao um evento repetido
        // nao duplica chip.
        subscribe(this, this._eventBus, EventTypes.SESSION_CHANGED,
            () => { this._refreshCatalogChip(); });
    }

    /**
     * Reexamina a disponibilidade do catalogo e cria ou remove o chip correspondente.
     *
     * Mantem a POSICAO do chip na ordem declarada em `CHIP_CONFIG`, em vez de anexar no fim: um
     * chip que muda de lugar conforme a hora do login e pior que um chip ausente.
     * @private
     * @returns {Promise<void>}
     */
    async _refreshCatalogChip() {
        if (!this._container) return;
        let disponivel = false;
        try {
            disponivel = await CatalogService.hasItems();
        } catch {
            // Falha de rede nao pode APAGAR um chip que ja funciona: o pior caso e manter uma
            // porta que abre uma lista vazia, e o melhor caso de remover e nao ter porta nenhuma.
            return;
        }
        if (!this._container) return;

        // Pelo id que `_createChip` ja escreve (`chip-<id>`), sem inventar atributo novo.
        const existente = this._container.querySelector('#chip-catalog');
        if (disponivel === !!existente) return;

        if (!disponivel) {
            existente?.remove();
            return;
        }

        // O MODAL TAMBEM NASCE AQUI, e esquece-lo seria trocar um defeito por outro: o chip
        // aparecia e o clique nao abria nada, porque `_initModals` so o constroi quando o
        // catalogo ja existia NO BOOT. Idempotente pela guarda.
        if (!this._catalogModal) {
            this._catalogModal = new CatalogModal({
                toolManager: this._toolManager,
                map: this._map,
                eventBus: this._eventBus,
                stateManager: this._stateManager,
            });
            document.body.appendChild(this._catalogModal.render());
        }

        const chip = this._createChip(CHIP_CONFIG.catalog);
        const ordem = Object.keys(CHIP_CONFIG);
        const seguinte = ordem.slice(ordem.indexOf('catalog') + 1)
            .map((k) => this._container.querySelector(`#chip-${k}`))
            .find(Boolean);
        this._container.insertBefore(chip, seguinte ?? null);
    }

    /**
     * Updates chip container position based on sidebar state.
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
     * Gets the container element.
     * @returns {HTMLElement|null}
     */
    getContainer() {
        return this._container;
    }

    /**
     * Gets the shortcuts modal instance.
     * @returns {ShortcutsModal|null}
     */
    getShortcutsModal() {
        return this._shortcutsModal;
    }

    /**
     * Gets the info modal instance.
     * @returns {InfoModal|null}
     */
    getInfoModal() {
        return this._infoModal;
    }

    /**
     * Gets the catalog modal instance.
     * @returns {CatalogModal|null}
     */
    getCatalogModal() {
        return this._catalogModal;
    }

    /**
     * Sets tool manager instance for catalog modal.
     * @param {Object} toolManager - ToolManager instance
     */
    setToolManager(toolManager) {
        this._toolManager = toolManager;
        if (this._catalogModal) {
            this._catalogModal._toolManager = toolManager;
        }
    }

    /**
     * Sets map instance for catalog modal.
     * @param {Object} map - MapLibre map instance
     */
    setMap(map) {
        this._map = map;
        if (this._catalogModal) {
            this._catalogModal._map = map;
        }
    }

    /**
     * Destroys the component.
     */
    destroy() {
        // Destroy modals
        if (this._shortcutsModal) {
            this._shortcutsModal.destroy();
            this._shortcutsModal = null;
        }
        if (this._infoModal) {
            this._infoModal.destroy();
            this._infoModal = null;
        }
        if (this._catalogModal) {
            this._catalogModal.destroy();
            this._catalogModal = null;
        }

        cleanup(this);
        removeElement(this._container);
        this._container = null;
    }
}
