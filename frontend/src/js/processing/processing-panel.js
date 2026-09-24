// Path: js/processing/processing-panel.js

/**
 * @fileoverview Factory for the processing panel.
 * Wraps the algorithm form with execution logic.
 */

import { assinarEdicaoIndisponivel, edicaoIndisponivelSync } from '@store/edicao-indisponivel.js';
import { unavailableEditNotice } from '@store/denial-phrases.js';
import { addDomListener, setupCleanup, cleanup } from '@utils/event-cleanup.js';
import { escapeHtml } from '@utils/html-escape.js';
import { runProcessing } from './processing-runner.js';
import { PROCESSING_ICONS } from './processing.constants.js';

/** What running an algorithm exercises: it creates a layer and features in the current map. */
const PROCESSING_ACTION = 'CREATE_FEATURE';

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

    const panelResult = algorithm.createPanel({ stateManager, eventBus });
    const { element, getParams, validate, ui } = panelResult;

    // Tag the mounted panel with the selected algorithm so the active choice is
    // observable in the DOM (used by e2e specs and as a stable hook).
    if (element) {
        element.dataset.algorithmId = algorithm.id;
        element.dataset.testid = 'processing-panel';
    }

    // THE POSTO HIDES THE COMMAND, THE STATE REFUSES THE CLICK (CLAUDE.md), and both follow the
    // answer LIVE. The panel used to read the lock once, at birth, and set `disabled`: opened on a
    // locked map the button stayed dead after the owner unlocked it, a lock arriving later never
    // reached it, and a Leitor clicked it and read "Falha ao criar camada de saída" about a
    // refusal of his level (`processamento-trava-e-posto.repro.spec.js`).
    let stopFollowing = null;
    if (ui?.executeBtn) {
        const postoNote = document.createElement('p');
        postoNote.className = 'processing-panel__posto';
        postoNote.hidden = true;
        ui.executeBtn.before(postoNote);
        stopFollowing = assinarEdicaoIndisponivel(() => _applyEditAvailability(ui.executeBtn, postoNote));

        addDomListener(panelCleanup, ui.executeBtn, 'click', async () => {
            const refusal = unavailableEditNotice(edicaoIndisponivelSync(PROCESSING_ACTION));
            if (refusal) {
                _showResult(ui, refusal, false);
                return;
            }
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
            stopFollowing?.();
            if (panelResult.cleanup) panelResult.cleanup();
            cleanup(panelCleanup);
        },
    };
}

// ============================================================================
// PRIVATE
// ============================================================================

/**
 * Draws the execute button for the answer of `edicaoIndisponivelSync` right now.
 *
 * A refusal of the POSTO is permanent from this screen: the button is not drawn and one sentence
 * says why, since an empty panel reads as a broken one. A refusal of STATE (the map locked) is
 * reversible, possibly by whoever reads it: the button stays drawn with `aria-disabled`, never the
 * `disabled` property, because a disabled button fires no click and the click is how the reason
 * reaches the person.
 * @private
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} postoNote
 */
function _applyEditAvailability(button, postoNote) {
    const edicao = edicaoIndisponivelSync(PROCESSING_ACTION);
    const byPosto = edicao.motivo === 'permissao';
    const byState = edicao.bloqueado && !byPosto;
    button.hidden = byPosto;
    postoNote.hidden = !byPosto;
    postoNote.textContent = byPosto ? unavailableEditNotice(edicao) : '';
    button.setAttribute('aria-disabled', byState ? 'true' : 'false');
    button.title = byState ? unavailableEditNotice(edicao) : '';
}

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
        // Plain text: `_showResult` escapes it, and escaping here too showed "Zona &amp; Norte".
        const msg = `${result.featureCount} ${result.featureCount === 1 ? 'feição criada' : 'feições criadas'} na camada "${params.outputLayerName}"`;
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
