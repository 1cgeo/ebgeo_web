// Path: js/tool_manager/helpers/buttons.helpers.js

/**
 * @fileoverview Button components for attribute panels.
 */

/**
 * @typedef {Object} StandardButtonsConfig
 * @property {Array} selectedFeatures - Selected features
 * @property {Object} control - Feature control instance
 * @property {Object} selectionManager - Selection manager instance
 * @property {Map} initialPropertiesMap - Initial properties for comparison
 * @property {boolean} [hasSetDefault=false] - Show "set as default" button
 * @property {Function} [onSetDefault] - Callback for set default
 */

/**
 * Creates standardized Save/Discard/Set Default buttons.
 *
 * @param {StandardButtonsConfig} config - Button configuration
 * @returns {HTMLElement} Buttons container element
 */
export function createStandardButtons(config) {
    const {
        selectedFeatures,
        control,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault = false,
        onSetDefault = null
    } = config;

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'attr-container-row';

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        control.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };
    buttonContainer.appendChild(saveButton);

    if (hasSetDefault && onSetDefault) {
        const setDefaultButton = document.createElement('button');
        setDefaultButton.textContent = 'Definir padrão';
        setDefaultButton.classList.add('tool-button', 'pure-material-tool-button-contained');
        setDefaultButton.onclick = () => {
            onSetDefault();
            selectionManager.deselectAllFeatures();
        };
        buttonContainer.appendChild(setDefaultButton);
    }

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    discardButton.onclick = () => {
        control.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };
    buttonContainer.appendChild(discardButton);

    return buttonContainer;
}
