// Path: js/military_tools/coordination_measure_tool/attributes/text-modifiers.section.js

/**
 * @fileoverview Text modifiers section for coordination measure attributes.
 * Provides form fields for text modifiers based on point type.
 */

import { getAvailableTextFields } from '../coordination_points_catalog.js';
import { UI_DATA, SUPPLY_CLASSES } from '../coordination_measure_constants.js';

/**
 * Creates a text modifier field.
 * @param {string} fieldName - Field name
 * @param {Object} fieldDef - Field definition
 * @param {string|null} currentValue - Current value
 * @param {Function} onChange - Callback when value changes
 * @returns {HTMLElement} Field container
 */
export function createTextModifierField(fieldName, fieldDef, currentValue, onChange) {
    const container = document.createElement('div');
    container.className = 'coord-text-field';

    const label = document.createElement('label');
    label.textContent = fieldDef.label;
    label.className = 'coord-text-field__label';
    container.appendChild(label);

    let inputElement;

    if (fieldDef.type === 'select') {
        inputElement = document.createElement('select');
        inputElement.className = 'coord-text-field__select';

        // Campo que sempre tem valor nao oferece a opcao vazia: escolher o vazio seria
        // devolver o simbolo ao estado sem escolha, que e o que o padrao existe para evitar.
        if (!fieldDef.required) {
            const emptyOption = document.createElement('option');
            emptyOption.value = '';
            emptyOption.textContent = '-- Selecione --';
            inputElement.appendChild(emptyOption);
        }

        fieldDef.options.forEach(optKey => {
            const option = document.createElement('option');
            option.value = optKey;

            if (fieldDef.optionLabels && fieldDef.optionLabels[optKey]) {
                option.textContent = fieldDef.optionLabels[optKey];
            } else if (fieldName === 'classeSuprimento') {
                option.textContent = SUPPLY_CLASSES[optKey] || optKey;
            } else {
                option.textContent = optKey;
            }

            inputElement.appendChild(option);
        });

        inputElement.value = currentValue || '';
        inputElement.onchange = (e) => onChange(e.target.value || null);

    } else {
        inputElement = document.createElement('input');
        inputElement.type = fieldDef.type;
        inputElement.placeholder = fieldDef.placeholder || '';
        inputElement.value = currentValue || '';
        inputElement.className = 'coord-text-field__input';

        inputElement.oninput = (e) => {
            const value = e.target.value.trim();
            onChange(value === '' ? null : value);
        };
    }

    container.appendChild(inputElement);

    if (fieldDef.help) {
        const helpText = document.createElement('div');
        helpText.textContent = fieldDef.help;
        helpText.className = 'coord-text-field__help';
        container.appendChild(helpText);
    }

    return container;
}

/**
 * Creates the text modifiers section.
 * @param {Object} properties - Current properties
 * @param {string} pointCode - Current point code
 * @param {Function} onPropertyChange - Callback when property changes
 * @returns {HTMLElement} Section container
 */
export function createTextModifiersSection(properties, pointCode, onPropertyChange) {
    const section = document.createElement('div');
    section.className = 'coord-text-modifiers';

    const content = document.createElement('div');
    content.className = 'coord-text-modifiers__grid';

    const applicableFields = getAvailableTextFields(pointCode);

    applicableFields.forEach(fieldName => {
        const fieldDef = UI_DATA.textFieldDefinitions[fieldName];
        if (!fieldDef) return;

        const fieldContainer = createTextModifierField(
            fieldName,
            fieldDef,
            properties[fieldName],
            (newValue) => {
                onPropertyChange(fieldName, newValue);
            }
        );

        content.appendChild(fieldContainer);
    });

    section.appendChild(content);
    return section;
}

/**
 * Rebuilds text modifiers section with new point code.
 * @param {HTMLElement} container - Section content container
 * @param {Object} properties - Current properties
 * @param {string} pointCode - New point code
 * @param {Function} onPropertyChange - Callback when property changes
 */
export function rebuildTextModifiersSection(container, properties, pointCode, onPropertyChange) {
    container.innerHTML = '';

    const applicableFields = getAvailableTextFields(pointCode);

    applicableFields.forEach(fieldName => {
        const fieldDef = UI_DATA.textFieldDefinitions[fieldName];
        if (!fieldDef) return;

        const fieldContainer = createTextModifierField(
            fieldName,
            fieldDef,
            properties[fieldName],
            (newValue) => {
                onPropertyChange(fieldName, newValue);
            }
        );

        container.appendChild(fieldContainer);
    });
}
