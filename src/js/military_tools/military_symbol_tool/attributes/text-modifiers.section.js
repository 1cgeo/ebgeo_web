// Path: js/military_tools/military_symbol_tool/attributes/text-modifiers.section.js

/**
 * @fileoverview Text modifiers section for the military symbol modal.
 * Creates input fields for text amplifiers like designation, formation, etc.
 */

import { getTextModifiersConfig } from '../military_constants.js';

/**
 * @typedef {Object} TextFieldConfig
 * @property {string} id - Field identifier
 * @property {string} label - Field label
 * @property {string} placeholder - Placeholder text
 * @property {string} tooltip - Tooltip text
 */

/**
 * Creates a single text field with label.
 *
 * @param {TextFieldConfig} fieldConfig - Field configuration
 * @param {string} currentValue - Current field value
 * @param {Function} onChange - Callback when value changes
 * @returns {HTMLElement} Field container element
 */
function createTextField(fieldConfig, currentValue, onChange) {
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; flex-direction: column; gap: 8px; margin-bottom: 5px;';

    const label = document.createElement('label');
    label.textContent = fieldConfig.label;
    label.style.cssText = 'font-size: 14px; font-weight: 600; color: #333;';
    label.title = fieldConfig.tooltip;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentValue || '';
    input.placeholder = fieldConfig.placeholder;
    input.style.cssText = `
        padding: 10px 12px;
        border: 2px solid #ddd;
        border-radius: 6px;
        font-size: 14px;
        transition: border-color 0.2s;
        font-family: inherit;
    `;

    input.onfocus = () => {
        input.style.borderColor = '#007bff';
        input.style.boxShadow = '0 0 0 3px rgba(0, 123, 255, 0.1)';
    };
    input.onblur = () => {
        input.style.borderColor = '#ddd';
        input.style.boxShadow = 'none';
    };

    input.oninput = (e) => onChange(e.target.value);

    container.appendChild(label);
    container.appendChild(input);

    container.inputElement = input;

    return container;
}

/**
 * Creates the text fields container for a symbol set.
 *
 * @param {string} symbolSetCode - Symbol set code (e.g., "10", "15")
 * @param {Object} tempProperties - Temporary properties object
 * @param {Function} onUpdate - Callback when any field changes
 * @returns {HTMLElement} Container with all text fields
 */
export function createTextFieldsContainer(symbolSetCode, tempProperties, onUpdate) {
    const container = document.createElement('div');
    container.style.cssText = `
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        padding: 20px;
    `;

    const config = getTextModifiersConfig(symbolSetCode);

    if (!config) {
        const message = document.createElement('div');
        message.style.cssText = `
            grid-column: 1 / -1;
            padding: 30px;
            text-align: center;
            color: #666;
            background: white;
            border-radius: 8px;
        `;

        const icon = document.createElement('div');
        icon.textContent = '\u2139\uFE0F';
        icon.style.cssText = 'font-size: 48px; margin-bottom: 15px;';

        const text = document.createElement('p');
        text.textContent = 'Amplificadores textuais não disponíveis para esta dimensão.';
        text.style.cssText = 'margin: 0; font-size: 16px;';

        const subtext = document.createElement('p');
        subtext.textContent = 'Selecione "Unidades" ou "Equipamentos e Viaturas" na aba Símbolo.';
        subtext.style.cssText = 'margin: 10px 0 0 0; font-size: 14px; color: #999;';

        message.appendChild(icon);
        message.appendChild(text);
        message.appendChild(subtext);
        container.appendChild(message);
        return container;
    }

    config.fields.forEach((field) => {
        const fieldContainer = createTextField(
            field,
            tempProperties[field.id] || '',
            (value) => {
                tempProperties[field.id] = value;
                onUpdate();
            }
        );
        container.appendChild(fieldContainer);
    });

    return container;
}
