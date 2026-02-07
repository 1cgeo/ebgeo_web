// Path: js/processing/algorithms/algorithm.interface.js

/**
 * @fileoverview Definição de tipos para a interface de algoritmos de processamento.
 * Cada algoritmo registrado deve implementar este contrato.
 */

/**
 * Dependências injetadas no createPanel de cada algoritmo.
 * @typedef {Object} AlgorithmPanelDeps
 * @property {import('../../events/event_bus.js').EventBus} eventBus - EventBus
 * @property {Object} stateManager - StateManager (seleção, estado da UI)
 */

/**
 * Resultado retornado por createPanel.
 * @typedef {Object} AlgorithmPanelResult
 * @property {HTMLElement} element - Elemento DOM do formulário
 * @property {Function} getParams - () => Object com parâmetros do formulário
 * @property {Function} validate - () => { valid: boolean, message?: string }
 * @property {Function} cleanup - () => void para limpar event listeners
 */

/**
 * Definição completa de um algoritmo de processamento.
 * @typedef {Object} AlgorithmDefinition
 * @property {string} id - Identificador único (ex: 'buffer')
 * @property {string} name - Nome de exibição em pt-BR (ex: 'Zona de Influência')
 * @property {string} description - Descrição curta do que o algoritmo faz
 * @property {string} icon - Markup SVG do ícone (20x20 viewBox)
 * @property {string} category - Categoria para agrupamento ('geometry', 'analysis', 'spatial')
 * @property {string[]} supportedGeometryTypes - Tipos de geometria aceitos
 *      (ex: ['point', 'line', 'polygon', 'circle', 'rectangle', 'ellipse'])
 * @property {(deps: AlgorithmPanelDeps) => AlgorithmPanelResult} createPanel
 *      Cria o formulário de configuração do algoritmo
 * @property {(features: Object[], params: Object) => Object[]} execute
 *      Função pura: recebe features GeoJSON + parâmetros, retorna features processadas.
 *      NÃO acessa store, NÃO persiste, NÃO emite eventos.
 */
