// Path: js/military_tools/military_symbol_tool/attributes/symbol-form.section.js

/**
 * @fileoverview Symbol form section for the military symbol modal.
 * Contains the comboboxes for configuring symbol properties.
 */

import {
    MILITARY_DATA,
    getEchelonData,
    getSpecialModifierData,
    isCommandApplicable,
    isModifier1Applicable,
    isModifier2Applicable
} from '../military_constants.js';

// The three table readers below are the heavy half: they only answer after
// `loadSymbolSets()` resolved, which `openSymbolModal` awaits before rendering.
// Keep this import separate from the constants one, so the boundary between what
// is always in memory and what arrives on demand stays visible at the call site.
import {
    getMainIcons,
    getModifier1,
    getModifier2
} from '../symbol_sets.registry.js';

import { createModernToggle } from '@tools';

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
 */

/**
 * @typedef {Object} SymbolFormColumns
 * @property {HTMLElement} column1 - First column element
 * @property {HTMLElement} column2 - Second column element
 * @property {Object} comboboxes - References to all comboboxes
 * @property {Function} reloadDependentComboboxes - Function to reload dependent combos
 * @property {Function} updateAllComboboxValues - Function to update all combo values
 * @property {Object} dropdownState - Shared dropdown state
 * @property {Function} setUpdatingFromSIDC - Sets the SIDC update flag
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
    const container = document.createElement('div');
    container.className = 'symbol-form__field';

    const label = document.createElement('label');
    label.className = 'symbol-form__label';
    label.textContent = 'Direção:';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'symbol-form__input';
    input.placeholder = 'Azimute em graus';
    input.value = tempProperties.direction || '';

    input.addEventListener('input', (e) => {
        const value = e.target.value.replace(/[^0-9.]/g, '');
        e.target.value = value;

        const numValue = parseFloat(value);
        input.classList.remove('symbol-form__input--valid', 'symbol-form__input--invalid');

        if (!isNaN(numValue)) {
            if (numValue < 0 || numValue > 360) {
                input.classList.add('symbol-form__input--invalid');
            } else {
                input.classList.add('symbol-form__input--valid');
                if (!flags.isUpdatingFromSIDC) {
                    tempProperties.direction = value;
                    updatePreview();
                }
            }
        } else if (value === '' && !flags.isUpdatingFromSIDC) {
            tempProperties.direction = '';
            updatePreview();
        }
    });

    container.appendChild(label);
    container.appendChild(input);

    return container;
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
    const container = document.createElement('div');
    container.className = 'symbol-form__field';

    const label = document.createElement('label');
    label.className = 'symbol-form__label';
    label.textContent = 'Elemento de Comando:';

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

    container.appendChild(label);
    container.appendChild(toggle);

    return {
        container,
        updateValue: (newValue) => {
            const checkbox = toggle.querySelector('input[type="checkbox"]');
            if (checkbox) {
                checkbox.checked = !!newValue;
            }
        }
    };
}

/**
 * Resets all text modifier properties on tempProperties.
 * @param {Object} tempProperties - Temporary properties
 */
function resetTextModifiers(tempProperties) {
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
}

/**
 * Removes a combobox element from DOM and nulls it.
 * Runs `_cleanup()` first: a combobox created by `createDigitalComboBox` owns a
 * document click listener and a dropdown appended to `document.body`, neither of
 * which goes away when the container leaves the form.
 * @param {Object} comboboxes - Comboboxes object
 * @param {string} key - Combobox key
 */
function removeCombobox(comboboxes, key) {
    const element = comboboxes[key];
    if (!element) return;

    element._cleanup?.();
    if (element.parentNode) {
        element.remove();
    }
    comboboxes[key] = null;
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
    column1.className = 'symbol-selector-form-column';

    const column2 = document.createElement('div');
    column2.className = 'symbol-selector-form-column';

    const comboboxes = {};

    const commandControl = createCommandCheckbox(tempProperties, updatePreview, flags);
    const commandCheckboxContainer = commandControl.container;
    comboboxes.isCommand = commandControl;

    /**
     * Wraps an onChange callback to guard against SIDC updates.
     * @param {Function} handler - Change handler
     * @returns {Function} Guarded handler
     */
    function guardedChange(handler) {
        return (...args) => {
            if (!flags.isUpdatingFromSIDC) {
                handler(...args);
            }
        };
    }

    /**
     * Reloads dependent comboboxes when symbol set changes.
     * @param {string} symbolSetCode - New symbol set code
     */
    function reloadDependentComboboxes(symbolSetCode) {
        const dependentKeys = ['echelon', 'directionContainer', 'specialModifier', 'mainIcon', 'modifier1', 'modifier2', 'colorControl'];
        for (const key of dependentKeys) {
            removeCombobox(comboboxes, key);
        }
        if (commandCheckboxContainer.parentNode) {
            commandCheckboxContainer.remove();
        }

        const echelonData = getEchelonData(symbolSetCode);
        if (echelonData.applicable) {
            comboboxes.echelon = createDigitalComboBox(
                echelonData.data, tempProperties.echelon || "00",
                guardedChange((value) => { tempProperties.echelon = value; updatePreview(); }),
                echelonData.label, false, 'modifier', false, dropdownState
            );
            column1.appendChild(comboboxes.echelon);
        }

        if (!['20', '40'].includes(symbolSetCode)) {
            const directionContainer = createDirectionInput(tempProperties, updatePreview, flags);
            column1.appendChild(directionContainer);
            comboboxes.directionContainer = directionContainer;
        }

        const specialModData = getSpecialModifierData(symbolSetCode);
        if (specialModData.applicable) {
            comboboxes.specialModifier = createDigitalComboBox(
                specialModData.data, tempProperties.specialModifier || "0",
                guardedChange((value) => { tempProperties.specialModifier = value; updatePreview(); }),
                'Modificador Transversal', false, 'modifier', false, dropdownState
            );
            column2.appendChild(comboboxes.specialModifier);
        }

        if (isCommandApplicable(symbolSetCode)) {
            column2.appendChild(commandCheckboxContainer);
        }

        comboboxes.mainIcon = createDigitalComboBox(
            getMainIcons(symbolSetCode), tempProperties.mainIcon || "000000",
            guardedChange((value, selectedOption) => {
                tempProperties.mainIcon = value;
                tempProperties.mainIconExtension = selectedOption?.extension || 0;
                updatePreview();
            }),
            'Ícone Principal', false, 'mainIcon', false, dropdownState
        );
        column2.appendChild(comboboxes.mainIcon);

        if (isModifier1Applicable(symbolSetCode)) {
            comboboxes.modifier1 = createDigitalComboBox(
                getModifier1(symbolSetCode), tempProperties.modifier1 || "00",
                guardedChange((value, selectedOption) => {
                    tempProperties.modifier1 = value;
                    tempProperties.modifier1Extension = selectedOption?.extension || 0;
                    updatePreview();
                }),
                'Modificador 1', true, 'modifier', false, dropdownState
            );
            column2.appendChild(comboboxes.modifier1);
        }

        if (isModifier2Applicable(symbolSetCode)) {
            comboboxes.modifier2 = createDigitalComboBox(
                getModifier2(symbolSetCode), tempProperties.modifier2 || "00",
                guardedChange((value, selectedOption) => {
                    tempProperties.modifier2 = value;
                    tempProperties.modifier2Extension = selectedOption?.extension || 0;
                    updatePreview();
                }),
                'Modificador 2', true, 'modifier', false, dropdownState
            );
            column2.appendChild(comboboxes.modifier2);
        }

        comboboxes.colorControl = createColorControl(
            tempProperties.fillColor,
            (color) => { tempProperties.fillColor = color; updatePreview(); },
            'Cor do Símbolo'
        );
        column2.appendChild(comboboxes.colorControl);
    }

    // --- Build initial column1 controls ---

    comboboxes.symbolSet = createDigitalComboBox(
        MILITARY_DATA.symbolSets, tempProperties.symbolSet || "10",
        guardedChange((value) => {
            tempProperties.symbolSet = value;
            resetTextModifiers(tempProperties);
            reloadDependentComboboxes(value);
            updatePreview();
        }),
        'Dimensão', false, 'modifier', true, dropdownState
    );
    column1.appendChild(comboboxes.symbolSet);

    comboboxes.standardIdentity = createDigitalComboBox(
        MILITARY_DATA.standardIdentity, tempProperties.standardIdentity || "3",
        guardedChange((value) => { tempProperties.standardIdentity = value; updatePreview(); }),
        'Hostilidade', false, 'modifier', false, dropdownState
    );
    column1.appendChild(comboboxes.standardIdentity);

    comboboxes.status = createDigitalComboBox(
        MILITARY_DATA.status, tempProperties.status || "0",
        guardedChange((value) => { tempProperties.status = value; updatePreview(); }),
        'Situação e Condição Operacional', false, 'modifier', false, dropdownState
    );
    column1.appendChild(comboboxes.status);

    comboboxes.hqTfDummy = createDigitalComboBox(
        MILITARY_DATA.hqTfDummy, tempProperties.hqTfDummy || "0",
        guardedChange((value) => { tempProperties.hqTfDummy = value; updatePreview(); }),
        'Forca-Tarefa/Posto de Comando', false, 'modifier', false, dropdownState
    );
    column1.appendChild(comboboxes.hqTfDummy);

    // --- Build initial dependent controls ---

    const initialSymbolSet = tempProperties.symbolSet || "10";

    const initialEchelonData = getEchelonData(initialSymbolSet);
    if (initialEchelonData.applicable) {
        comboboxes.echelon = createDigitalComboBox(
            initialEchelonData.data, tempProperties.echelon || "00",
            guardedChange((value) => { tempProperties.echelon = value; updatePreview(); }),
            initialEchelonData.label, false, 'modifier', false, dropdownState
        );
        column1.appendChild(comboboxes.echelon);
    }

    if (!['20', '40'].includes(initialSymbolSet)) {
        const directionContainer = createDirectionInput(tempProperties, updatePreview, flags);
        column1.appendChild(directionContainer);
        comboboxes.directionContainer = directionContainer;
    }

    const initialSpecialModData = getSpecialModifierData(initialSymbolSet);
    if (initialSpecialModData.applicable) {
        comboboxes.specialModifier = createDigitalComboBox(
            initialSpecialModData.data, tempProperties.specialModifier || "0",
            guardedChange((value) => { tempProperties.specialModifier = value; updatePreview(); }),
            'Modificador Transversal', false, 'modifier', false, dropdownState
        );
        column2.appendChild(comboboxes.specialModifier);
    }

    if (isCommandApplicable(initialSymbolSet)) {
        column2.appendChild(commandCheckboxContainer);
    }

    comboboxes.mainIcon = createDigitalComboBox(
        getMainIcons(initialSymbolSet), tempProperties.mainIcon || "000000",
        guardedChange((value, selectedOption) => {
            tempProperties.mainIcon = value;
            tempProperties.mainIconExtension = selectedOption?.extension || null;
            updatePreview();
        }),
        'Ícone Principal', false, 'mainIcon', false, dropdownState
    );
    column2.appendChild(comboboxes.mainIcon);

    if (isModifier1Applicable(initialSymbolSet)) {
        comboboxes.modifier1 = createDigitalComboBox(
            getModifier1(initialSymbolSet), tempProperties.modifier1 || "00",
            guardedChange((value, selectedOption) => {
                tempProperties.modifier1 = value;
                tempProperties.modifier1Extension = selectedOption?.extension || null;
                updatePreview();
            }),
            'Modificador 1', true, 'modifier', false, dropdownState
        );
        column2.appendChild(comboboxes.modifier1);
    }

    if (isModifier2Applicable(initialSymbolSet)) {
        comboboxes.modifier2 = createDigitalComboBox(
            getModifier2(initialSymbolSet), tempProperties.modifier2 || "00",
            guardedChange((value, selectedOption) => {
                tempProperties.modifier2 = value;
                tempProperties.modifier2Extension = selectedOption?.extension || null;
                updatePreview();
            }),
            'Modificador 2', true, 'modifier', false, dropdownState
        );
        column2.appendChild(comboboxes.modifier2);
    }

    comboboxes.colorControl = createColorControl(
        tempProperties.fillColor,
        (color) => { tempProperties.fillColor = color; updatePreview(); },
        'Cor do Símbolo'
    );
    column2.appendChild(comboboxes.colorControl);

    /**
     * Updates all combobox visual values.
     */
    function updateAllComboboxValues() {
        const valueMap = {
            symbolSet: tempProperties.symbolSet,
            standardIdentity: tempProperties.standardIdentity,
            status: tempProperties.status,
            hqTfDummy: tempProperties.hqTfDummy,
            echelon: tempProperties.echelon,
            specialModifier: tempProperties.specialModifier,
            mainIcon: tempProperties.mainIcon,
            modifier1: tempProperties.modifier1,
            modifier2: tempProperties.modifier2
        };

        for (const [key, value] of Object.entries(valueMap)) {
            comboboxes[key]?.updateValue?.(value);
        }

        comboboxes.isCommand?.updateValue?.(tempProperties.isCommand);
        comboboxes.colorControl?.updateValue?.(tempProperties.fillColor);
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
