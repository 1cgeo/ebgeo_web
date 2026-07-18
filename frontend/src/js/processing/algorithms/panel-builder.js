// Path: js/processing/algorithms/panel-builder.js

/**
 * @fileoverview Shared panel builder for processing algorithms.
 * Extracts the duplicated UI boilerplate (layer selector, selection toggle,
 * output name, execute button, progress bar, result container) common to
 * all algorithm panels.
 */

import { getLayers, getActiveLayerIdSync } from '@store/layer.operations.js';
import {
    createModernSelect,
    createModernToggle,
    createSectionDivider,
} from '@tools/helpers/index.js';
import { setupCleanup, cleanup } from '@utils/event-cleanup.js';

/**
 * Builds the shared panel scaffold used by all processing algorithms.
 *
 * Returns DOM elements and accessor functions that the algorithm-specific
 * panel can extend with its own parameter inputs (e.g., distance, bbox).
 *
 * @param {Object} options
 * @param {Object} options.stateManager - StateManager instance
 * @param {string} options.defaultOutputPrefix - Prefix for default output layer name (e.g. 'Zona de Influência')
 * @returns {Object} Panel scaffold with element, state accessors, and UI references
 */
export function buildAlgorithmPanelScaffold({ stateManager, defaultOutputPrefix }) {
    const cleanupContext = {};
    setupCleanup(cleanupContext);

    const container = document.createElement('div');
    container.className = 'processing-panel';

    // -- Layer selector --
    const layers = getLayers();
    const activeLayerId = getActiveLayerIdSync();
    const layerOptions = layers.map(l => ({
        value: l.id,
        label: l.name,
    }));

    let selectedLayerId = activeLayerId;
    let useSelectedOnly = false;

    /** @type {Function[]} Callbacks triggered when the layer selection changes */
    const onLayerChangeCallbacks = [];

    const layerSelect = createModernSelect({
        label: 'Camada de origem',
        value: activeLayerId,
        options: layerOptions,
        onChange: (value) => {
            selectedLayerId = value;
            updateSelectionHint();
            updateOutputName();
            for (const cb of onLayerChangeCallbacks) cb();
        },
    });

    // -- Selection toggle --
    const toggleContainer = document.createElement('div');
    toggleContainer.className = 'processing-panel__toggle-section';

    const toggle = createModernToggle({
        label: 'Apenas feições selecionadas',
        checked: false,
        onChange: (checked) => {
            useSelectedOnly = checked;
            for (const cb of onLayerChangeCallbacks) cb();
        },
    });
    toggleContainer.appendChild(toggle);

    const selectionHint = document.createElement('div');
    selectionHint.className = 'processing-panel__hint';
    toggleContainer.appendChild(selectionHint);

    /**
     * Returns the count of selected features in the given layer.
     * @param {string} layerId
     * @returns {number}
     */
    function getSelectedCountForLayer(layerId) {
        const allSelected = stateManager ? stateManager.getSelectedFeatures() : [];
        return allSelected.filter(item => {
            const fLayerId = item.feature?.properties?.layerId || 'default';
            return fLayerId === layerId;
        }).length;
    }

    function updateSelectionHint() {
        const count = getSelectedCountForLayer(selectedLayerId);
        selectionHint.textContent = count > 0
            ? `${count} ${count === 1 ? 'feição selecionada' : 'feições selecionadas'} na camada`
            : 'Nenhuma feição selecionada na camada';

        if (count === 0) {
            toggle.classList.add('processing-panel__toggle--disabled');
            if (useSelectedOnly) {
                useSelectedOnly = false;
                const switchEl = toggle.querySelector('.attr-modern-toggle-switch');
                if (switchEl) switchEl.classList.remove('active');
            }
        } else {
            toggle.classList.remove('processing-panel__toggle--disabled');
        }
    }

    updateSelectionHint();

    // -- Output name --
    const outputNameContainer = document.createElement('div');
    outputNameContainer.className = 'attr-modern-textarea';

    const outputNameLabel = document.createElement('label');
    outputNameLabel.className = 'attr-modern-textarea-label';
    outputNameLabel.textContent = 'Nome da nova camada';
    outputNameContainer.appendChild(outputNameLabel);

    const outputNameInput = document.createElement('input');
    outputNameInput.type = 'text';
    outputNameInput.className = 'attr-modern-textarea-input processing-panel__output-name';
    outputNameContainer.appendChild(outputNameInput);

    function getDefaultOutputName() {
        const layer = layers.find(l => l.id === selectedLayerId);
        return `${defaultOutputPrefix} - ${layer ? layer.name : 'Camada'}`;
    }

    function updateOutputName() {
        outputNameInput.value = getDefaultOutputName();
    }

    outputNameInput.value = getDefaultOutputName();

    // -- Execute button --
    const executeBtn = document.createElement('button');
    executeBtn.className = 'processing-panel__execute-btn';
    executeBtn.textContent = 'EXECUTAR';

    // -- Progress --
    const progressContainer = document.createElement('div');
    progressContainer.className = 'processing-panel__progress processing-panel__progress--hidden';

    const progressText = document.createElement('div');
    progressText.className = 'processing-panel__progress-text';
    progressContainer.appendChild(progressText);

    const progressBar = document.createElement('div');
    progressBar.className = 'processing-panel__progress-bar';
    const progressFill = document.createElement('div');
    progressFill.className = 'processing-panel__progress-fill';
    progressBar.appendChild(progressFill);
    progressContainer.appendChild(progressBar);

    // -- Result --
    const resultContainer = document.createElement('div');
    resultContainer.className = 'processing-panel__result processing-panel__result--hidden';

    // ========================================================================
    // ASSEMBLY HELPERS
    // ========================================================================

    /**
     * Appends the input section (divider + layer select + toggle).
     */
    function appendInputSection() {
        container.appendChild(createSectionDivider('Dados de Entrada'));
        container.appendChild(layerSelect);
        container.appendChild(toggleContainer);
    }

    /**
     * Appends the output section (divider + output name + execute + progress + result).
     */
    function appendOutputSection() {
        container.appendChild(createSectionDivider('Resultado'));
        container.appendChild(outputNameContainer);
        container.appendChild(executeBtn);
        container.appendChild(progressContainer);
        container.appendChild(resultContainer);
    }

    /**
     * Base validation for layer selection.
     * @returns {{ valid: boolean, message?: string }}
     */
    function validateBase() {
        if (!selectedLayerId) {
            return { valid: false, message: 'Selecione uma camada' };
        }
        if (useSelectedOnly && getSelectedCountForLayer(selectedLayerId) === 0) {
            return { valid: false, message: 'Nenhuma feição selecionada na camada' };
        }
        return { valid: true };
    }

    return {
        container,
        cleanupContext,

        // State accessors
        getSelectedLayerId: () => selectedLayerId,
        getUseSelectedOnly: () => useSelectedOnly,
        getOutputLayerName: () => outputNameInput.value.trim() || getDefaultOutputName(),

        // Validation
        validateBase,
        getSelectedCountForLayer,

        // UI mutation
        appendInputSection,
        appendOutputSection,
        onLayerChangeCallbacks,

        // Execute button reference (for disabling during validation)
        executeBtn,

        /** UI references consumed by processing-panel.js */
        ui: {
            executeBtn,
            progressContainer,
            progressText,
            progressFill,
            resultContainer,
        },

        /** Cleanup function */
        cleanupFn() {
            cleanup(cleanupContext);
        },
    };
}
