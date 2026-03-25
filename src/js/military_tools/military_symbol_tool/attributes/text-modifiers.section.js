// Path: js/military_tools/military_symbol_tool/attributes/text-modifiers.section.js

/**
 * @fileoverview Text modifiers section for the military symbol modal.
 * Creates input fields for text amplifiers like designation, formation, etc.
 */

import { getTextModifiersConfig } from '../military_constants.js';

/**
 * Creates a single text field with label.
 *
 * @param {Object} fieldConfig - Field configuration
 * @param {string} fieldConfig.label - Field label
 * @param {string} fieldConfig.placeholder - Placeholder text
 * @param {string} fieldConfig.tooltip - Tooltip text
 * @param {string} currentValue - Current field value
 * @param {Function} onChange - Callback when value changes
 * @returns {HTMLElement} Field container element
 */
function createTextField(fieldConfig, currentValue, onChange) {
    const container = document.createElement('div');
    container.className = 'text-modifiers__field';

    const label = document.createElement('label');
    label.className = 'text-modifiers__label';
    label.textContent = fieldConfig.label;
    label.title = fieldConfig.tooltip;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text-modifiers__input';
    input.value = currentValue || '';
    input.placeholder = fieldConfig.placeholder;
    input.oninput = (e) => onChange(e.target.value);

    container.appendChild(label);
    container.appendChild(input);

    container.inputElement = input;

    return container;
}

/**
 * Creates the "not available" empty state message.
 *
 * @returns {HTMLElement} Empty state container
 */
function createEmptyState() {
    const message = document.createElement('div');
    message.className = 'text-modifiers__empty';

    const icon = document.createElement('div');
    icon.className = 'text-modifiers__empty-icon';
    icon.textContent = '\u2139\uFE0F';

    const text = document.createElement('p');
    text.className = 'text-modifiers__empty-text';
    text.textContent = 'Amplificadores textuais não disponíveis para esta dimensão.';

    const subtext = document.createElement('p');
    subtext.className = 'text-modifiers__empty-subtext';
    subtext.textContent = 'Selecione "Unidades" ou "Equipamentos e Viaturas" na aba Símbolo.';

    message.appendChild(icon);
    message.appendChild(text);
    message.appendChild(subtext);

    return message;
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
    container.className = 'text-modifiers-grid';

    const config = getTextModifiersConfig(symbolSetCode);

    if (!config) {
        container.appendChild(createEmptyState());
        return container;
    }

    for (const field of config.fields) {
        container.appendChild(createTextField(
            field,
            tempProperties[field.id] || '',
            (value) => {
                tempProperties[field.id] = value;
                onUpdate();
            }
        ));
    }

    return container;
}
