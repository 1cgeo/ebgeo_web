// Path: js/processing/processing-panel.js

/**
 * @fileoverview Factory do painel de processamento.
 * Envolve o formulário do algoritmo com lógica de execução.
 * @dependencies processing-runner, event_types, event-cleanup
 */

import { runProcessing } from './processing-runner.js';
import { PROCESSING_ICONS } from './processing.constants.js';
import { addDomListener, setupCleanup, cleanup } from '../utilities/event-cleanup.js';
import { isCurrentMapLockedSync } from '../store/map.operations.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Cria o painel completo de um algoritmo de processamento.
 * Retorna { element, cleanup } para uso com showToolPanel().
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

    // Verifica mapa bloqueado
    const mapLocked = isCurrentMapLockedSync();

    // Cria o formulário do algoritmo
    const panelResult = algorithm.createPanel({ stateManager, eventBus });

    const { element, getParams, validate, ui } = panelResult;

    // Desabilita execução se mapa bloqueado
    if (mapLocked && ui?.executeBtn) {
        ui.executeBtn.disabled = true;
        ui.executeBtn.title = 'Mapa bloqueado para edição';
    }

    // Wiring do botão executar
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
 * Executa o algoritmo e atualiza a UI de progresso/resultado.
 * @private
 */
async function _executeAlgorithm(algorithm, params, ui, stateManager, eventBus) {
    const { executeBtn, progressContainer, progressText, progressFill, resultContainer } = ui;

    // Estado: executando
    executeBtn.disabled = true;
    executeBtn.textContent = 'Processando...';
    if (resultContainer) resultContainer.style.display = 'none';

    if (progressContainer) {
        progressContainer.style.display = 'block';
        progressText.textContent = 'Preparando...';
        progressFill.style.width = '0%';
    }

    try {
        const result = await runProcessing({
            algorithm,
            params,
            stateManager,
            eventBus,
            onProgress: (current, total) => {
                if (progressText) {
                    progressText.textContent = `Processando... ${current} de ${total}`;
                }
                if (progressFill) {
                    progressFill.style.width = `${Math.round((current / total) * 100)}%`;
                }
            },
        });

        // Sucesso
        if (progressContainer) progressContainer.style.display = 'none';
        const msg = `${result.featureCount} ${result.featureCount === 1 ? 'feição criada' : 'feições criadas'} na camada "${params.outputLayerName}"`;
        _showResult(ui, msg, true);
        executeBtn.textContent = 'EXECUTAR';
        executeBtn.disabled = false;

    } catch (error) {
        // Erro
        if (progressContainer) progressContainer.style.display = 'none';
        _showResult(ui, error.message || 'Erro ao processar', false);
        executeBtn.textContent = 'EXECUTAR';
        executeBtn.disabled = false;
    }
}

/**
 * Exibe mensagem de resultado.
 * @private
 */
function _showResult(ui, message, success) {
    const { resultContainer } = ui;
    if (!resultContainer) return;

    resultContainer.style.display = 'flex';
    resultContainer.className = `processing-panel__result ${success ? 'processing-panel__result--success' : 'processing-panel__result--error'}`;
    resultContainer.innerHTML = `
        ${success ? PROCESSING_ICONS.check : PROCESSING_ICONS.alertCircle}
        <span>${message}</span>
    `;
}
