// Path: js/tool_manager/helpers/buttons.helpers.js

/**
 * @fileoverview Button components for attribute panels.
 */

import { startBatchUndo, commitBatchUndo, discardBatchUndo } from '../../store';

/**
 * @typedef {Object} StandardButtonsConfig
 * @property {Array} selectedFeatures - Selected features
 * @property {Object} control - Feature control instance
 * @property {Object} selectionManager - Selection manager instance
 * @property {Map} initialPropertiesMap - Initial properties for comparison
 * @property {boolean} [hasSetDefault=false] - Show "set as default" button
 * @property {Function} [onSetDefault] - Callback for set default
 * @property {boolean} [hidden=false] - If true, return empty container (for group type editing)
 */

/**
 * Creates modern standardized Save/Discard/Set Default buttons.
 *
 * @param {StandardButtonsConfig} config - Button configuration
 * @returns {HTMLElement} Buttons container element
 */
export function createModernButtons(config) {
    const {
        selectedFeatures,
        control,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault = false,
        onSetDefault = null,
        hidden = false
    } = config;

    // Return empty container if hidden (used for group type editing)
    if (hidden) {
        const emptyContainer = document.createElement('div');
        emptyContainer.className = 'attr-modern-buttons attr-modern-buttons-hidden';
        return emptyContainer;
    }

    const container = document.createElement('div');
    container.className = 'attr-modern-buttons';

    // First row: Save + Discard
    const row = document.createElement('div');
    row.className = 'attr-modern-buttons-row';

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.className = 'attr-modern-btn-save';
    saveButton.type = 'submit';

    /**
     * Save features logic (reusable without deselect).
     * Exposed as saveButton._saveOnly for programmatic save-without-deselect.
     *
     * ONE SAVE AT A TIME PER PANEL. The same content is asked to save twice in a row when it is
     * replaced (the rebuild saves the outgoing content when it starts and again at the swap,
     * `sidebar/panels/feature-panel-flush.js`), and a multi-selection save opens the GLOBAL undo
     * batch collector: a second `startBatchUndo` while the first save is still writing resets the
     * collector and drops what the first had recorded. Chained, the second save starts after the
     * first committed its batch, and finds nothing left to write (`updateFeature` returns early
     * on an equal feature).
     */
    let saveChain = Promise.resolve();
    const doSave = () => {
        const run = saveChain.then(async () => {
            const needsBatch = selectedFeatures.length > 1;
            if (needsBatch) startBatchUndo();
            try {
                await control.saveFeatures(selectedFeatures, initialPropertiesMap);
                if (needsBatch) commitBatchUndo();
            } catch (error) {
                if (needsBatch) discardBatchUndo();
                console.error('Error during batch save:', error);
            }
        });
        saveChain = run.catch(() => {});
        return run;
    };

    // Expose save-only function for programmatic use (feature switching)
    saveButton._saveOnly = doSave;

    saveButton.addEventListener('click', async () => {
        await doSave();
        // skipSave: doSave() already persisted — avoid double undo entry
        selectionManager.deselectAllFeatures({ skipSave: true });
    });
    row.appendChild(saveButton);

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.className = 'attr-modern-btn-discard';
    discardButton.type = 'button';
    discardButton.addEventListener('click', async () => {
        await control.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        // skipSave: discard reverted changes — nothing to save
        selectionManager.deselectAllFeatures({ skipSave: true });
    });
    row.appendChild(discardButton);

    container.appendChild(row);

    // Second row: Set as default (optional)
    if (hasSetDefault && onSetDefault) {
        const defaultButton = document.createElement('button');
        defaultButton.textContent = 'Definir como padrão';
        defaultButton.className = 'attr-modern-btn-default';
        defaultButton.type = 'button';
        defaultButton.addEventListener('click', () => {
            onSetDefault();
            // skipSave: setting defaults doesn't need to save pending changes
            selectionManager.deselectAllFeatures({ skipSave: true });
        });
        container.appendChild(defaultButton);
    }

    return container;
}

