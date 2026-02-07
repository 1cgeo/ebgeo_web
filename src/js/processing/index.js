// Path: js/processing/index.js

/**
 * @fileoverview Módulo de processamento geoespacial.
 * Exporta a aba, o registry de algoritmos, e o runner.
 */

// Registry
export {
    registerAlgorithm,
    getAlgorithm,
    getAllAlgorithms,
    PROCESSING_ICONS,
    ALGORITHM_CATEGORIES,
    CATEGORY_LABELS,
} from './processing.constants.js';

// Tab component
export { ProcessingTab } from './processing.tab.js';

// Panel factory
export { createProcessingPanel } from './processing-panel.js';

// Runner
export { runProcessing } from './processing-runner.js';

// Registra todos os algoritmos disponíveis (side-effect import)
import './algorithms/index.js';
