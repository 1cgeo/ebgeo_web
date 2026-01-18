// Path: js/military_tools/coordination_measure_tool/attributes/color-control.section.js

/**
 * @fileoverview Color control section for coordination measure attributes.
 * Provides a color picker with enable/disable toggle.
 */

import { createColorPicker, createCheckbox } from '../../../tool_manager';

/**
 * Creates a color control with checkbox toggle.
 * @param {string|null} currentValue - Current color value
 * @param {Function} onChange - Callback when color changes
 * @param {string} label - Label text
 * @returns {HTMLElement} Color control container
 */
export function createColorControlSection(currentValue, onChange, label) {
    const container = document.createElement('div');
    container.className = 'color-control-container';

    const labelElement = document.createElement('label');
    labelElement.textContent = label + ':';
    labelElement.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold; font-size: 15px; color: #333;';

    const checkboxContainer = document.createElement('div');
    checkboxContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 12px;';

    const checkbox = createCheckbox(
        !!currentValue,
        (e) => {
            const isEnabled = e.target.checked;
            if (isEnabled) {
                const color = currentValue || '#11FF00';
                onChange(color);
                updateColorControlState(color);
            } else {
                onChange(null);
                updateColorControlState(null);
            }
        }
    );

    const checkboxLabel = document.createElement('span');
    checkboxLabel.textContent = 'Usar cor personalizada';
    checkboxLabel.style.cssText = 'font-size: 14px; color: #333; cursor: pointer;';

    checkboxLabel.onclick = () => {
        const checkboxInput = checkbox.querySelector('input');
        checkboxInput.click();
    };

    checkboxContainer.appendChild(checkbox);
    checkboxContainer.appendChild(checkboxLabel);

    const controlsContainer = document.createElement('div');
    controlsContainer.style.cssText = 'display: flex; align-items: center; gap: 12px;';

    const colorPicker = createColorPicker(
        currentValue || '#11FF00',
        (e) => {
            const color = e.target.value;
            onChange(color);
            updateColorControlState(color);
        },
        'Escolher cor personalizada',
        'current'
    );

    /**
     * Updates color control state.
     * @param {string|null} color - Color value
     */
    function updateColorControlState(color) {
        const isCustomColor = !!color;
        const checkboxInput = checkbox.querySelector('input');

        checkboxInput.checked = isCustomColor;

        colorPicker.disabled = !isCustomColor;
        colorPicker.style.opacity = isCustomColor ? '1' : '0.5';
        colorPicker.style.cursor = isCustomColor ? 'pointer' : 'not-allowed';

        if (isCustomColor) {
            colorPicker.value = color;
        }
    }

    updateColorControlState(currentValue);

    controlsContainer.appendChild(colorPicker);

    container.appendChild(labelElement);
    container.appendChild(checkboxContainer);
    container.appendChild(controlsContainer);

    return container;
}
