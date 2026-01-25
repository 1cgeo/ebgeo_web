// Path: js/military_tools/coordination_measure_tool/attributes/color-control.section.js

/**
 * @fileoverview Color control section for coordination measure attributes.
 * Provides a color picker with enable/disable toggle.
 */

import { createModernColorPicker, createModernToggle } from '../../../tool_manager';

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
    container.style.cssText = 'margin-bottom: 16px;';

    const labelElement = document.createElement('label');
    labelElement.textContent = label + ':';
    labelElement.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold; font-size: 15px; color: #333;';

    let colorPickerContainer = null;

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
    controlsContainer.style.cssText = 'margin-top: 12px;';

    colorPickerContainer = createModernColorPicker({
        label: 'Cor',
        value: currentValue || '#11FF00',
        onChange: (color) => {
            onChange(color);
        }
    });

    /**
     * Updates color control state.
     * @param {string|null} color - Color value
     */
    function updateColorControlState(color) {
        const isCustomColor = !!color;
        colorPickerContainer.style.opacity = isCustomColor ? '1' : '0.5';
        colorPickerContainer.style.pointerEvents = isCustomColor ? 'auto' : 'none';
    }

    updateColorControlState(currentValue);

    controlsContainer.appendChild(colorPickerContainer);

    container.appendChild(labelElement);
    container.appendChild(toggle);
    container.appendChild(controlsContainer);

    return container;
}
