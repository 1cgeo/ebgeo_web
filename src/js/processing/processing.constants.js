// Path: js/processing/processing.constants.js

/**
 * @fileoverview Registry de algoritmos de processamento e constantes.
 * @dependencies Nenhuma - módulo puro de dados.
 */

// ============================================================================
// ALGORITHM REGISTRY
// ============================================================================

/** @type {Map<string, import('./algorithms/algorithm.interface.js').AlgorithmDefinition>} */
const ALGORITHM_REGISTRY = new Map();

/**
 * Registra um algoritmo de processamento.
 * @param {import('./algorithms/algorithm.interface.js').AlgorithmDefinition} definition
 * @throws {Error} Se o id já estiver registrado
 */
export function registerAlgorithm(definition) {
    if (!definition?.id) {
        throw new Error('Algoritmo deve ter um id');
    }
    if (ALGORITHM_REGISTRY.has(definition.id)) {
        throw new Error(`Algoritmo "${definition.id}" já registrado`);
    }
    ALGORITHM_REGISTRY.set(definition.id, Object.freeze(definition));
}

/**
 * Retorna um algoritmo pelo id.
 * @param {string} id
 * @returns {import('./algorithms/algorithm.interface.js').AlgorithmDefinition|undefined}
 */
export function getAlgorithm(id) {
    return ALGORITHM_REGISTRY.get(id);
}

/**
 * Retorna todos os algoritmos registrados.
 * @returns {import('./algorithms/algorithm.interface.js').AlgorithmDefinition[]}
 */
export function getAllAlgorithms() {
    return Array.from(ALGORITHM_REGISTRY.values());
}

// ============================================================================
// ICONS
// ============================================================================

/**
 * Ícones usados no módulo de processamento.
 * @readonly
 */
export const PROCESSING_ICONS = {
    play: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,

    check: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,

    alertCircle: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,

    cpu: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>`,
};

// ============================================================================
// CATEGORIES
// ============================================================================

/**
 * Categorias de algoritmos para agrupamento na UI.
 * @readonly
 */
export const ALGORITHM_CATEGORIES = {
    GEOMETRY: 'geometry',
    ANALYSIS: 'analysis',
    SPATIAL: 'spatial',
};

/**
 * Labels das categorias em pt-BR.
 * @readonly
 */
export const CATEGORY_LABELS = {
    [ALGORITHM_CATEGORIES.GEOMETRY]: 'Geometria',
    [ALGORITHM_CATEGORIES.ANALYSIS]: 'Análise',
    [ALGORITHM_CATEGORIES.SPATIAL]: 'Espacial',
};
