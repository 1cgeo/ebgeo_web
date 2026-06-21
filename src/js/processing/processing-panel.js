// Path: js/processing/processing-panel.js

/**
 * @fileoverview Factory for the processing panel.
 * Wraps the algorithm form with execution logic.
 */

import { isCurrentMapLockedSync } from '@store/map.operations.js';
import { addDomListener, setupCleanup, cleanup } from '@utils/event-cleanup.js';
import { escapeHtml } from '@utils/html-escape.js';
import { runProcessing } from './processing-runner.js';
import { PROCESSING_ICONS } from './processing.constants.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Creates the complete panel for a processing algorithm.
 * Returns { element, cleanup } for use with showToolPanel().
 *
 * @param {Object} options
 * @param {import('./algorithms/algorithm.interface.js').AlgorithmDefinition} options.algorithm
 * @param {Object} options.stateManager
 * @param {Object} options.eventBus
 * @returns {{ element: HTMLElement, cleanup: Function }}
 */
export function createProcessingPanel(options) {
    const { algorithm, stateManager, eventBus } = options;

    const panelCleanup = {};
    setupCleanup(panelCleanup);

    const mapLocked = isCurrentMapLockedSync();

    const panelResult = algorithm.createPanel({ stateManager, eventBus });
    const { element, getParams, validate, ui } = panelResult;

    // Tag the mounted panel with the selected algorithm so the active choice is
    // observable in the DOM (used by e2e specs and as a stable hook).
    if (element) {
        element.dataset.algorithmId = algorithm.id;
        element.dataset.testid = 'processing-panel';
    }

    if (mapLocked && ui?.executeBtn) {
        ui.executeBtn.disabled = true;
        ui.executeBtn.title = 'Mapa bloqueado para edição';
    }

    if (ui?.executeBtn) {
        addDomListener(panelCleanup, ui.executeBtn, 'click', async () => {
            const validation = validate();
            if (!validation.valid) {
                _showResult(ui, validation.message, false);
                return;
            }

            await _executeAlgorithm(algorithm, getParams(), ui, stateManager, eventBus);
        });
    }

    return {
        element,
        cleanup() {
            if (panelResult.cleanup) panelResult.cleanup();
            cleanup(panelCleanup);
        },
    };
}

// ============================================================================
// PRIVATE
// ============================================================================

/**
 * Executes the algorithm and updates the progress/result UI.
 * @private
 */
async function _executeAlgorithm(algorithm, params, ui, stateManager, eventBus) {
    const { executeBtn, progressContainer, progressText, progressFill, resultContainer } = ui;

    executeBtn.disabled = true;
    executeBtn.textContent = 'Analisando...';
    resultContainer?.classList.add('processing-panel__result--hidden');

    if (progressContainer) {
        progressContainer.classList.remove('processing-panel__progress--hidden');
        progressText.textContent = 'Preparando...';
        progressFill.classList.remove('processing-panel__progress-fill--active');
    }

    try {
        const result = await runProcessing({
            algorithm,
            params,
            stateManager,
            eventBus,
            onProgress: (current, total) => {
                if (progressText) {
                    progressText.textContent = `Analisando... ${current} de ${total}`;
                }
                if (progressFill) {
                    const pct = Math.round((current / total) * 100);
                    progressFill.style.width = `${pct}%`;
                }
            },
        });

        if (progressContainer) progressContainer.classList.add('processing-panel__progress--hidden');
        const msg = `${result.featureCount} ${result.featureCount === 1 ? 'feição criada' : 'feições criadas'} na camada "${escapeHtml(params.outputLayerName)}"`;
        _showResult(ui, msg, true);
        executeBtn.textContent = 'EXECUTAR';
        executeBtn.disabled = false;

    } catch (error) {
        if (progressContainer) progressContainer.classList.add('processing-panel__progress--hidden');
        _showResult(ui, error.message || 'Erro na análise', false);
        executeBtn.textContent = 'EXECUTAR';
        executeBtn.disabled = false;
    }
}

/**
 * Displays a result message.
 * @private
 */
function _showResult(ui, message, success) {
    const { resultContainer } = ui;
    if (!resultContainer) return;

    resultContainer.classList.remove('processing-panel__result--hidden');
    resultContainer.className = `processing-panel__result ${success ? 'processing-panel__result--success' : 'processing-panel__result--error'}`;
    resultContainer.innerHTML = `
        ${success ? PROCESSING_ICONS.check : PROCESSING_ICONS.alertCircle}
        <span>${escapeHtml(message)}</span>
    `;
}
