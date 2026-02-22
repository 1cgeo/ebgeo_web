// Path: js/processing/processing.tab.js

/**
 * @fileoverview Aba de Processamento no sidebar.
 * Lista os algoritmos registrados com botão para abrir cada um.
 * @dependencies processing.constants, event-cleanup, event_types
 */

import { getAllAlgorithms, PROCESSING_ICONS } from './processing.constants.js';
import {
    setupCleanup,
    subscribe,
    cleanup,
    removeElement,
    addDomListener,
} from '../utilities/event-cleanup.js';
import { EventTypes } from '../events/event_types.js';

// ============================================================================
// PROCESSING TAB
// ============================================================================

/**
 * Componente da aba de processamento geoespacial.
 */
export class ProcessingTab {
    /**
     * @param {Object} dependencies
     * @param {Object} dependencies.eventBus - EventBus instance
     * @param {Object} dependencies.stateManager - StateManager instance
     * @param {Function} dependencies.onOpenAlgorithm - Callback(algorithmId) para abrir painel
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
     * Cria a UI da aba.
     * @returns {HTMLElement}
     */
    render() {
        this._container = document.createElement('div');
        this._container.className = 'sidebar-tab-content processing-tab';

        // Cabeçalho da seção
        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'sidebar-section-header';
        sectionHeader.textContent = 'Algoritmos Disponíveis';
        this._container.appendChild(sectionHeader);

        // Lista de algoritmos
        this._algorithmList = document.createElement('div');
        this._algorithmList.className = 'processing-algorithm-list';
        this._container.appendChild(this._algorithmList);

        this._setupEventListeners();
        this._renderAlgorithmList();

        return this._container;
    }

    /**
     * @returns {HTMLElement|null}
     */
    getContainer() {
        return this._container;
    }

    /** Chamado quando a aba é ativada (exibida). */
    onActivate() {
        this._renderAlgorithmList();
    }

    /** Chamado quando a aba é desativada (escondida). */
    onDeactivate() {
        // Nenhum cleanup necessário
    }

    /** Atualiza o conteúdo da aba. */
    refresh() {
        this._renderAlgorithmList();
    }

    /** Limpa recursos. */
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
     * @private
     */
    _setupEventListeners() {
        subscribe(this, this._eventBus, EventTypes.PROCESSING_COMPLETED, () => {
            // Poderia atualizar status na lista
        });
    }

    /**
     * Renderiza a lista de algoritmos registrados.
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

        algorithms.forEach(algorithm => {
            const card = this._createAlgorithmCard(algorithm);
            this._algorithmList.appendChild(card);
        });
    }

    /**
     * Cria um card para um algoritmo.
     * @private
     * @param {import('./algorithms/algorithm.interface.js').AlgorithmDefinition} algorithm
     * @returns {HTMLElement}
     */
    _createAlgorithmCard(algorithm) {
        const card = document.createElement('div');
        card.className = 'processing-card';
        card.dataset.algorithmId = algorithm.id;

        card.innerHTML = `
            <div class="processing-card__icon">${algorithm.icon}</div>
            <div class="processing-card__info">
                <div class="processing-card__name">${algorithm.name}</div>
                <div class="processing-card__description">${algorithm.description}</div>
            </div>
            <button class="processing-card__action" title="Abrir ${algorithm.name}">
                ${PROCESSING_ICONS.play}
                <span>Abrir</span>
            </button>
        `;

        const actionBtn = card.querySelector('.processing-card__action');
        addDomListener(this, actionBtn, 'click', (e) => {
            e.stopPropagation();
            this._handleOpenAlgorithm(algorithm.id);
        });

        addDomListener(this, card, 'click', () => {
            this._handleOpenAlgorithm(algorithm.id);
        });

        return card;
    }

    /**
     * Renderiza estado vazio.
     * @private
     */
    _renderEmptyState() {
        this._algorithmList.innerHTML = `
            <div class="processing-empty-state">
                ${PROCESSING_ICONS.cpu}
                <p>Nenhum algoritmo disponível</p>
            </div>
        `;
    }

    /**
     * Abre o painel de um algoritmo.
     * @private
     * @param {string} algorithmId
     */
    _handleOpenAlgorithm(algorithmId) {
        if (this._onOpenAlgorithm) {
            this._onOpenAlgorithm(algorithmId);
        }
    }
}
