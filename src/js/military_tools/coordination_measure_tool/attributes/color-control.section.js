// Path: js/military_tools/coordination_measure_tool/attributes/color-control.section.js

/**
 * @fileoverview Color control section for coordination measure attributes.
 * Provides a color picker with enable/disable toggle.
 */

import { createModernColorPicker, createModernToggle } from '@tools';

/**
 * Creates a color control with checkbox toggle.
 * @param {string|null} currentValue - Current color value
 * @param {Function} onChange - Callback when color changes
 * @param {string} label - Label text
 * @returns {HTMLElement} Color control container
 */
export function createColorControlSection(currentValue, onChange, label) {
    const container = document.createElement('div');
    container.className = 'coord-color-control';

    const labelElement = document.createElement('label');
    labelElement.textContent = label + ':';
    labelElement.className = 'coord-color-control__label';

    const colorPickerContainer = createModernColorPicker({
        label: 'Cor',
        value: currentValue || '#11FF00',
        onChange: (color) => {
            onChange(color);
        }
    });

    /**
     * Updates color control visual state.
     * @param {string|null} color - Color value
     */
    function updateColorControlState(color) {
        if (color) {
            colorPickerContainer.classList.remove('coord-color-control__picker--disabled');
        } else {
            colorPickerContainer.classList.add('coord-color-control__picker--disabled');
        }
    }

    const toggle = createModernToggle({
        label: 'Usar cor personalizada',
        checked: !!currentValue,
        onChange: (isEnabled) => {
            if (isEnabled) {
                const color = currentValue || '#11FF00';
                onChange(color);
                updateColorControlState(color);
            } else {
                onChange(null);
                updateColorControlState(null);
            }
        }
    });

    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'coord-color-control__picker-wrapper';

    updateColorControlState(currentValue);

    controlsContainer.appendChild(colorPickerContainer);

    container.appendChild(labelElement);
    container.appendChild(toggle);
    container.appendChild(controlsContainer);

    return container;
}
