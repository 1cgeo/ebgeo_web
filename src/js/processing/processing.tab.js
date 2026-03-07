// Path: js/processing/processing.tab.js

/**
 * @fileoverview Processing tab in the sidebar.
 * Lists registered algorithms with a button to open each one.
 */

import {
    setupCleanup,
    cleanup,
    removeElement,
    addDomListener,
} from '@utils/event-cleanup.js';
import { escapeHtml } from '@utils/html-escape.js';
import { getAllAlgorithms, PROCESSING_ICONS } from './processing.constants.js';

// ============================================================================
// PROCESSING TAB
// ============================================================================

/**
 * Processing tab component for the sidebar.
 */
export class ProcessingTab {
    /**
     * @param {Object} dependencies
     * @param {Object} dependencies.eventBus - EventBus instance
     * @param {Object} dependencies.stateManager - StateManager instance
     * @param {Function} dependencies.onOpenAlgorithm - Callback(algorithmId) to open panel
     */
    constructor(dependencies) {
        this._eventBus = dependencies.eventBus;
        this._stateManager = dependencies.stateManager;
        this._onOpenAlgorithm = dependencies.onOpenAlgorithm;

        this._container = null;
        this._algorithmList = null;

        setupCleanup(this);
    }

    /**
     * Creates the tab UI.
     * @returns {HTMLElement}
     */
    render() {
        this._container = document.createElement('div');
        this._container.className = 'sidebar-tab-content processing-tab';

        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'sidebar-section-header';
        sectionHeader.textContent = 'Algoritmos Disponíveis';
        this._container.appendChild(sectionHeader);

        this._algorithmList = document.createElement('div');
        this._algorithmList.className = 'processing-algorithm-list';
        this._container.appendChild(this._algorithmList);

        this._renderAlgorithmList();

        return this._container;
    }

    /**
     * @returns {HTMLElement|null}
     */
    getContainer() {
        return this._container;
    }

    /** Called when the tab is activated (shown). */
    onActivate() {
        this._renderAlgorithmList();
    }

    /** Called when the tab is deactivated (hidden). */
    onDeactivate() {
        // No cleanup needed
    }

    /** Refreshes the tab content. */
    refresh() {
        this._renderAlgorithmList();
    }

    /** Cleans up resources. */
    destroy() {
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._algorithmList = null;
    }

    // ========================================================================
    // PRIVATE
    // ========================================================================

    /**
     * Renders the list of registered algorithms.
     * @private
     */
    _renderAlgorithmList() {
        if (!this._algorithmList) return;
        this._algorithmList.innerHTML = '';

        const algorithms = getAllAlgorithms();

        if (algorithms.length === 0) {
            this._renderEmptyState();
            return;
        }

        for (const algorithm of algorithms) {
            const card = this._createAlgorithmCard(algorithm);
            this._algorithmList.appendChild(card);
        }
    }

    /**
     * Creates a card for an algorithm.
     * @private
     * @param {import('./algorithms/algorithm.interface.js').AlgorithmDefinition} algorithm
     * @returns {HTMLElement}
     */
    _createAlgorithmCard(algorithm) {
        const card = document.createElement('div');
        card.className = 'processing-card';
        card.dataset.algorithmId = algorithm.id;

        // Icon (static SVG from algorithm definition)
        const iconEl = document.createElement('div');
        iconEl.className = 'processing-card__icon';
        iconEl.innerHTML = algorithm.icon;
        card.appendChild(iconEl);

        // Info section
        const infoEl = document.createElement('div');
        infoEl.className = 'processing-card__info';

        const nameEl = document.createElement('div');
        nameEl.className = 'processing-card__name';
        nameEl.textContent = algorithm.name;
        infoEl.appendChild(nameEl);

        const descEl = document.createElement('div');
        descEl.className = 'processing-card__description';
        descEl.textContent = algorithm.description;
        infoEl.appendChild(descEl);

        card.appendChild(infoEl);

        // Action button
        const actionBtn = document.createElement('button');
        actionBtn.className = 'processing-card__action';
        actionBtn.title = `Abrir ${escapeHtml(algorithm.name)}`;
        actionBtn.innerHTML = `${PROCESSING_ICONS.play}<span>Abrir</span>`;

        addDomListener(this, actionBtn, 'click', (e) => {
            e.stopPropagation();
            this._onOpenAlgorithm?.(algorithm.id);
        });

        card.appendChild(actionBtn);

        addDomListener(this, card, 'click', () => {
            this._onOpenAlgorithm?.(algorithm.id);
        });

        return card;
    }

    /**
     * Renders the empty state.
     * @private
     */
    _renderEmptyState() {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'processing-empty-state';
        emptyEl.innerHTML = PROCESSING_ICONS.cpu;

        const textEl = document.createElement('p');
        textEl.textContent = 'Nenhum algoritmo disponível';
        emptyEl.appendChild(textEl);

        this._algorithmList.appendChild(emptyEl);
    }
}
