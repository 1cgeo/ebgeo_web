// Path: js/military_tools/military_symbol_tool/attributes/symbol-form.section.js

/**
 * @fileoverview Symbol form section for the military symbol modal.
 * Contains the comboboxes for configuring symbol properties.
 */

import {
    MILITARY_DATA,
    getMainIcons,
    getModifier1,
    getModifier2,
    getEchelonData,
    getSpecialModifierData,
    isCommandApplicable,
    isModifier1Applicable,
    isModifier2Applicable
} from '../military_constants.js';

import { createModernToggle } from '../../../tool_manager';

import {
    createDigitalComboBox,
    createColorControl,
    createDropdownState,
    closeAllDropdowns as _closeAllDropdowns
} from './ui-components.helpers.js';

/**
 * @typedef {Object} SymbolFormConfig
 * @property {Object} tempProperties - Temporary properties object
 * @property {Function} updatePreview - Callback to update preview
 * @property {boolean} isUpdatingFromSIDC - Flag indicating SIDC update in progress
 */

/**
 * @typedef {Object} SymbolFormColumns
 * @property {HTMLElement} column1 - First column element
 * @property {HTMLElement} column2 - Second column element
 * @property {Object} comboboxes - References to all comboboxes
 * @property {Function} reloadDependentComboboxes - Function to reload dependent combos
 * @property {Function} updateAllComboboxValues - Function to update all combo values
 * @property {Object} dropdownState - Shared dropdown state
 */

/**
 * Creates a direction input control.
 *
 * @param {Object} tempProperties - Temporary properties
 * @param {Function} updatePreview - Update preview callback
 * @param {Object} flags - Update flags
 * @returns {HTMLElement} Direction input container
 */
function createDirectionInput(tempProperties, updatePreview, flags) {
    const directionContainer = document.createElement('div');
    directionContainer.style.cssText = 'margin-bottom: 20px;';

    const directionLabel = document.createElement('label');
    directionLabel.textContent = 'Direcao:';
    directionLabel.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold; font-size: 15px; color: #333;';

    const directionInput = document.createElement('input');
    directionInput.type = 'text';
    directionInput.placeholder = 'Azimute em graus';
    directionInput.value = tempProperties.direction || '';
    directionInput.style.cssText = `
        width: 100%;
        padding: 8px 12px;
        border: 2px solid #ddd;
        border-radius: 6px;
        font-size: 14px;
        transition: border-color 0.2s;
        box-sizing: border-box;
    `;

    directionInput.addEventListener('input', (e) => {
        let value = e.target.value;
        value = value.replace(/[^0-9.]/g, '');
        e.target.value = value;

        const numValue = parseFloat(value);
        if (!isNaN(numValue)) {
            if (numValue < 0 || numValue > 360) {
                e.target.style.borderColor = '#dc3545';
            } else {
                e.target.style.borderColor = '#28a745';
                if (!flags.isUpdatingFromSIDC) {
                    tempProperties.direction = value;
                    updatePreview();
                }
            }
        } else if (value === '') {
            e.target.style.borderColor = '#ddd';
            if (!flags.isUpdatingFromSIDC) {
                tempProperties.direction = '';
                updatePreview();
            }
        }
    });

    directionContainer.appendChild(directionLabel);
    directionContainer.appendChild(directionInput);

    return directionContainer;
}

/**
 * Creates a command checkbox control.
 *
 * @param {Object} tempProperties - Temporary properties
 * @param {Function} updatePreview - Update preview callback
 * @param {Object} flags - Update flags
 * @returns {Object} Container and update function
 */
function createCommandCheckbox(tempProperties, updatePreview, flags) {
    const commandCheckboxContainer = document.createElement('div');
    commandCheckboxContainer.style.cssText = 'margin-bottom: 20px;';

    const commandLabel = document.createElement('label');
    commandLabel.textContent = 'Elemento de Comando:';
    commandLabel.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold; font-size: 15px; color: #333;';

    let toggleElement = null;

    const toggle = createModernToggle({
        label: 'Esta unidade é um elemento de Comando',
        checked: tempProperties.isCommand || false,
        onChange: (checked) => {
            if (!flags.isUpdatingFromSIDC) {
                tempProperties.isCommand = checked;
                updatePreview();
            }
        }
    });

    toggleElement = toggle;

    commandCheckboxContainer.appendChild(commandLabel);
    commandCheckboxContainer.appendChild(toggle);

    return {
        container: commandCheckboxContainer,
        updateValue: (newValue) => {
            const checkbox = toggleElement?.querySelector('input[type="checkbox"]');
            if (checkbox) {
                checkbox.checked = !!newValue;
            }
        }
    };
}

/**
 * Creates the symbol form columns with all comboboxes.
 *
 * @param {SymbolFormConfig} config - Form configuration
 * @returns {SymbolFormColumns} Columns and control references
 */
export function createSymbolFormColumns(config) {
    const { tempProperties, updatePreview } = config;
    const flags = { isUpdatingFromSIDC: false };

    const dropdownState = createDropdownState();

    const column1 = document.createElement('div');
    column1.style.cssText = 'display: flex; flex-direction: column; gap: 0;';

    const column2 = document.createElement('div');
    column2.style.cssText = 'display: flex; flex-direction: column; gap: 0;';

    const comboboxes = {};

    const commandControl = createCommandCheckbox(tempProperties, updatePreview, flags);
    const commandCheckboxContainer = commandControl.container;
    comboboxes.isCommand = commandControl;

    /**
     * Reloads dependent comboboxes when symbol set changes.
     * @param {string} symbolSetCode - New symbol set code
     */
    function reloadDependentComboboxes(symbolSetCode) {
        if (comboboxes.echelon && comboboxes.echelon.parentNode) {
            comboboxes.echelon.remove();
            comboboxes.echelon = null;
        }

        if (comboboxes.directionContainer && comboboxes.directionContainer.parentNode) {
            comboboxes.directionContainer.remove();
            comboboxes.directionContainer = null;
        }

        if (comboboxes.specialModifier && comboboxes.specialModifier.parentNode) {
            comboboxes.specialModifier.remove();
            comboboxes.specialModifier = null;
        }
        if (commandCheckboxContainer && commandCheckboxContainer.parentNode) {
            commandCheckboxContainer.remove();
        }
        if (comboboxes.mainIcon && comboboxes.mainIcon.parentNode) {
            comboboxes.mainIcon.remove();
            comboboxes.mainIcon = null;
        }
        if (comboboxes.modifier1 && comboboxes.modifier1.parentNode) {
            comboboxes.modifier1.remove();
            comboboxes.modifier1 = null;
        }
        if (comboboxes.modifier2 && comboboxes.modifier2.parentNode) {
            comboboxes.modifier2.remove();
            comboboxes.modifier2 = null;
        }
        if (comboboxes.colorControl && comboboxes.colorControl.parentNode) {
            comboboxes.colorControl.remove();
            comboboxes.colorControl = null;
        }

        const echelonData = getEchelonData(symbolSetCode);
        if (echelonData.applicable) {
            comboboxes.echelon = createDigitalComboBox(
                echelonData.data,
                tempProperties.echelon || "00",
                (value) => {
                    if (!flags.isUpdatingFromSIDC) {
                        tempProperties.echelon = value;
                        updatePreview();
                    }
                },
                echelonData.label,
                false,
                'modifier',
                false,
                dropdownState
            );
            column1.appendChild(comboboxes.echelon);
        }

        const directionApplicable = !['20', '40'].includes(symbolSetCode);
        if (directionApplicable) {
            const directionContainer = createDirectionInput(tempProperties, updatePreview, flags);
            column1.appendChild(directionContainer);
            comboboxes.directionContainer = directionContainer;
        }

        const specialModData = getSpecialModifierData(symbolSetCode);
        if (specialModData.applicable) {
            comboboxes.specialModifier = createDigitalComboBox(
                specialModData.data,
                tempProperties.specialModifier || "0",
                (value) => {
                    if (!flags.isUpdatingFromSIDC) {
                        tempProperties.specialModifier = value;
                        updatePreview();
                    }
                },
                'Modificador Transversal',
                false,
                'modifier',
                false,
                dropdownState
            );
            column2.appendChild(comboboxes.specialModifier);
        }

        if (isCommandApplicable(symbolSetCode)) {
            column2.appendChild(commandCheckboxContainer);
        }

        const mainIconsData = getMainIcons(symbolSetCode);
        comboboxes.mainIcon = createDigitalComboBox(
            mainIconsData,
            tempProperties.mainIcon || "000000",
            (value, selectedOption) => {
                if (!flags.isUpdatingFromSIDC) {
                    tempProperties.mainIcon = value;
                    tempProperties.mainIconExtension = selectedOption?.extension || 0;
                    updatePreview();
                }
            },
            'Icone Principal',
            false,
            'mainIcon',
            false,
            dropdownState
        );
        column2.appendChild(comboboxes.mainIcon);

        if (isModifier1Applicable(symbolSetCode)) {
            const modifier1Data = getModifier1(symbolSetCode);
            comboboxes.modifier1 = createDigitalComboBox(
                modifier1Data,
                tempProperties.modifier1 || "00",
                (value, selectedOption) => {
                    if (!flags.isUpdatingFromSIDC) {
                        tempProperties.modifier1 = value;
                        tempProperties.modifier1Extension = selectedOption?.extension || 0;
                        updatePreview();
                    }
                },
                'Modificador 1',
                true,
                'modifier',
                false,
                dropdownState
            );
            column2.appendChild(comboboxes.modifier1);
        }

        if (isModifier2Applicable(symbolSetCode)) {
            const modifier2Data = getModifier2(symbolSetCode);
            comboboxes.modifier2 = createDigitalComboBox(
                modifier2Data,
                tempProperties.modifier2 || "00",
                (value, selectedOption) => {
                    if (!flags.isUpdatingFromSIDC) {
                        tempProperties.modifier2 = value;
                        tempProperties.modifier2Extension = selectedOption?.extension || 0;
                        updatePreview();
                    }
                },
                'Modificador 2',
                true,
                'modifier',
                false,
                dropdownState
            );
            column2.appendChild(comboboxes.modifier2);
        }

        comboboxes.colorControl = createColorControl(
            tempProperties.fillColor,
            (color) => {
                tempProperties.fillColor = color;
                updatePreview();
            },
            'Cor do Simbolo'
        );
        column2.appendChild(comboboxes.colorControl);
    }

    comboboxes.symbolSet = createDigitalComboBox(
        MILITARY_DATA.symbolSets,
        tempProperties.symbolSet || "10",
        (value) => {
            if (!flags.isUpdatingFromSIDC) {
                tempProperties.symbolSet = value;

                tempProperties.mainIcon = "000000";
                tempProperties.modifier1 = "00";
                tempProperties.modifier2 = "00";
                tempProperties.echelon = "00";
                tempProperties.specialModifier = "0";

                tempProperties.mainIconExtension = null;
                tempProperties.modifier1Extension = null;
                tempProperties.modifier2Extension = null;

                tempProperties.uniqueDesignation = '';
                tempProperties.higherFormation = '';
                tempProperties.reinforcedReduced = '';
                tempProperties.additionalInformation = '';
                tempProperties.credibility = '';
                tempProperties.location = '';
                tempProperties.dateTimeGroup = '';
                tempProperties.altitudeDepth = '';
                tempProperties.speed = '';
                tempProperties.specialHeadquarters = '';
                tempProperties.type = '';
                tempProperties.iffSif = '';
                tempProperties.equipmentTeardownTime = '';
                tempProperties.quantity = '';
                tempProperties.direction = '';

                reloadDependentComboboxes(value);
                updatePreview();
            }
        },
        'Dimensao',
        false,
        'modifier',
        true,
        dropdownState
    );
    column1.appendChild(comboboxes.symbolSet);

    comboboxes.standardIdentity = createDigitalComboBox(
        MILITARY_DATA.standardIdentity,
        tempProperties.standardIdentity || "3",
        (value) => {
            if (!flags.isUpdatingFromSIDC) {
                tempProperties.standardIdentity = value;
                updatePreview();
            }
        },
        'Hostilidade',
        false,
        'modifier',
        false,
        dropdownState
    );
    column1.appendChild(comboboxes.standardIdentity);

    comboboxes.status = createDigitalComboBox(
        MILITARY_DATA.status,
        tempProperties.status || "0",
        (value) => {
            if (!flags.isUpdatingFromSIDC) {
                tempProperties.status = value;
                updatePreview();
            }
        },
        'Situacao e Condicao Operacional',
        false,
        'modifier',
        false,
        dropdownState
    );
    column1.appendChild(comboboxes.status);

    comboboxes.hqTfDummy = createDigitalComboBox(
        MILITARY_DATA.hqTfDummy,
        tempProperties.hqTfDummy || "0",
        (value) => {
            if (!flags.isUpdatingFromSIDC) {
                tempProperties.hqTfDummy = value;
                updatePreview();
            }
        },
        'Forca-Tarefa/Posto de Comando',
        false,
        'modifier',
        false,
        dropdownState
    );
    column1.appendChild(comboboxes.hqTfDummy);

    const initialSymbolSet = tempProperties.symbolSet || "10";
    const initialEchelonData = getEchelonData(initialSymbolSet);

    if (initialEchelonData.applicable) {
        comboboxes.echelon = createDigitalComboBox(
            initialEchelonData.data,
            tempProperties.echelon || "00",
            (value) => {
                if (!flags.isUpdatingFromSIDC) {
                    tempProperties.echelon = value;
                    updatePreview();
                }
            },
            initialEchelonData.label,
            false,
            'modifier',
            false,
            dropdownState
        );
        column1.appendChild(comboboxes.echelon);
    }

    const initialDirectionApplicable = !['20', '40'].includes(initialSymbolSet);
    if (initialDirectionApplicable) {
        const directionContainer = createDirectionInput(tempProperties, updatePreview, flags);
        column1.appendChild(directionContainer);
        comboboxes.directionContainer = directionContainer;
    }

    const initialSpecialModData = getSpecialModifierData(initialSymbolSet);

    if (initialSpecialModData.applicable) {
        comboboxes.specialModifier = createDigitalComboBox(
            initialSpecialModData.data,
            tempProperties.specialModifier || "0",
            (value) => {
                if (!flags.isUpdatingFromSIDC) {
                    tempProperties.specialModifier = value;
                    updatePreview();
                }
            },
            'Modificador Transversal',
            false,
            'modifier',
            false,
            dropdownState
        );
        column2.appendChild(comboboxes.specialModifier);
    }

    if (isCommandApplicable(initialSymbolSet)) {
        column2.appendChild(commandCheckboxContainer);
    }

    comboboxes.mainIcon = createDigitalComboBox(
        getMainIcons(initialSymbolSet),
        tempProperties.mainIcon || "000000",
        (value, selectedOption) => {
            if (!flags.isUpdatingFromSIDC) {
                tempProperties.mainIcon = value;
                tempProperties.mainIconExtension = selectedOption?.extension || null;
                updatePreview();
            }
        },
        'Icone Principal',
        false,
        'mainIcon',
        false,
        dropdownState
    );
    column2.appendChild(comboboxes.mainIcon);

    if (isModifier1Applicable(initialSymbolSet)) {
        comboboxes.modifier1 = createDigitalComboBox(
            getModifier1(initialSymbolSet),
            tempProperties.modifier1 || "00",
            (value, selectedOption) => {
                if (!flags.isUpdatingFromSIDC) {
                    tempProperties.modifier1 = value;
                    tempProperties.modifier1Extension = selectedOption?.extension || null;
                    updatePreview();
                }
            },
            'Modificador 1',
            true,
            'modifier',
            false,
            dropdownState
        );
        column2.appendChild(comboboxes.modifier1);
    }

    if (isModifier2Applicable(initialSymbolSet)) {
        comboboxes.modifier2 = createDigitalComboBox(
            getModifier2(initialSymbolSet),
            tempProperties.modifier2 || "00",
            (value, selectedOption) => {
                if (!flags.isUpdatingFromSIDC) {
                    tempProperties.modifier2 = value;
                    tempProperties.modifier2Extension = selectedOption?.extension || null;
                    updatePreview();
                }
            },
            'Modificador 2',
            true,
            'modifier',
            false,
            dropdownState
        );
        column2.appendChild(comboboxes.modifier2);
    }

    comboboxes.colorControl = createColorControl(
        tempProperties.fillColor,
        (color) => {
            tempProperties.fillColor = color;
            updatePreview();
        },
        'Cor do Simbolo'
    );
    column2.appendChild(comboboxes.colorControl);

    /**
     * Updates all combobox visual values.
     */
    function updateAllComboboxValues() {
        if (comboboxes.symbolSet && comboboxes.symbolSet.updateValue) {
            comboboxes.symbolSet.updateValue(tempProperties.symbolSet);
        }

        if (comboboxes.standardIdentity && comboboxes.standardIdentity.updateValue) {
            comboboxes.standardIdentity.updateValue(tempProperties.standardIdentity);
        }

        if (comboboxes.status && comboboxes.status.updateValue) {
            comboboxes.status.updateValue(tempProperties.status);
        }

        if (comboboxes.hqTfDummy && comboboxes.hqTfDummy.updateValue) {
            comboboxes.hqTfDummy.updateValue(tempProperties.hqTfDummy);
        }

        if (comboboxes.echelon && comboboxes.echelon.updateValue) {
            comboboxes.echelon.updateValue(tempProperties.echelon);
        }

        if (comboboxes.specialModifier && comboboxes.specialModifier.updateValue) {
            comboboxes.specialModifier.updateValue(tempProperties.specialModifier);
        }

        if (comboboxes.isCommand && comboboxes.isCommand.updateValue) {
            comboboxes.isCommand.updateValue(tempProperties.isCommand);
        }

        if (comboboxes.mainIcon && comboboxes.mainIcon.updateValue) {
            comboboxes.mainIcon.updateValue(tempProperties.mainIcon);
        }

        if (comboboxes.modifier1 && comboboxes.modifier1.updateValue) {
            comboboxes.modifier1.updateValue(tempProperties.modifier1);
        }

        if (comboboxes.modifier2 && comboboxes.modifier2.updateValue) {
            comboboxes.modifier2.updateValue(tempProperties.modifier2);
        }

        if (comboboxes.colorControl && comboboxes.colorControl.updateValue) {
            comboboxes.colorControl.updateValue(tempProperties.fillColor);
        }
    }

    /**
     * Sets the isUpdatingFromSIDC flag.
     * @param {boolean} value - Flag value
     */
    function setUpdatingFromSIDC(value) {
        flags.isUpdatingFromSIDC = value;
    }

    return {
        column1,
        column2,
        comboboxes,
        reloadDependentComboboxes,
        updateAllComboboxValues,
        dropdownState,
        setUpdatingFromSIDC
    };
}
