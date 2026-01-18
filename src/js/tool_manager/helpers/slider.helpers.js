// Path: js/tool_manager/helpers/slider.helpers.js

/**
 * @fileoverview Slider and numeric input components for attribute panels.
 */

import { DEFAULT_SLIDER_CONFIG } from './common-config.helpers.js';

/**
 * Creates a simple numeric input with validation.
 *
 * @param {Object} config - Configuration object
 * @param {number} config.min - Minimum value
 * @param {number} config.max - Maximum value
 * @param {number} [config.step=1] - Step value
 * @param {number} config.value - Initial value
 * @param {Function} config.onChange - Callback when value changes
 * @param {string} [config.suffix] - Optional suffix to display (e.g., " m")
 * @param {number} [config.debounceMs] - Debounce delay in ms
 * @returns {HTMLElement} Input container element
 */
export function createNumericInput(config) {
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; align-items: center; gap: 4px;';

    const input = document.createElement('input');
    input.type = 'number';
    input.min = config.min;
    input.max = config.max;
    input.step = config.step || 1;
    input.value = config.value;
    input.style.cssText = `
        width: 100px;
        padding: 6px 8px;
        border: 1px solid #ccc;
        border-radius: 3px;
        font-size: 13px;
        text-align: right;
        box-sizing: border-box;
    `;

    if (config.suffix) {
        const suffix = document.createElement('span');
        suffix.textContent = config.suffix;
        suffix.style.cssText = 'font-size: 13px; color: #666;';
        container.appendChild(input);
        container.appendChild(suffix);
    } else {
        container.appendChild(input);
    }

    const clampValue = (value) => Math.max(config.min, Math.min(config.max, value));
    const roundToStep = (value, step) => Math.round(value / step) * step;

    let debounceTimer = null;

    input.oninput = (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            let value = parseInt(e.target.value, 10);

            if (isNaN(value)) {
                value = config.value;
            } else {
                value = roundToStep(clampValue(value), config.step || 1);
            }

            input.value = value;
            config.onChange(value);
        }, config.debounceMs || DEFAULT_SLIDER_CONFIG.debounceMs);
    };

    input.onblur = (e) => {
        clearTimeout(debounceTimer);
        let value = parseInt(e.target.value, 10);

        if (isNaN(value)) {
            value = config.value;
        } else {
            value = roundToStep(clampValue(value), config.step || 1);
        }

        input.value = value;
        config.onChange(value);
    };

    return container;
}

/**
 * Creates a robust slider with synchronized numeric input.
 *
 * @param {Object} config - Configuration object
 * @param {number} config.min - Minimum value
 * @param {number} config.max - Maximum value
 * @param {number} [config.step=1] - Step value
 * @param {number} config.value - Initial value
 * @param {Function} config.onChange - Callback when value changes
 * @param {number} [config.width] - Width of numeric input
 * @param {number} [config.debounceMs] - Debounce delay in ms
 * @returns {HTMLElement} Container with slider and numeric input
 */
export function createSliderWithInput(config) {
    const container = document.createElement('div');
    container.className = 'slider-numeric-container';
    container.style.cssText = `display: flex; gap: ${DEFAULT_SLIDER_CONFIG.gap}px; align-items: center; width: 100%;`;

    const slider = document.createElement('input');
    slider.classList.add("slider");
    slider.type = 'range';
    slider.min = config.min;
    slider.max = config.max;
    slider.step = config.step || 1;
    slider.value = config.value;
    slider.style.cssText = 'flex-grow: 1;';

    const numericInput = document.createElement('input');
    numericInput.type = 'number';
    numericInput.min = config.min;
    numericInput.max = config.max;
    numericInput.step = config.step || 1;
    numericInput.value = config.value;
    numericInput.style.cssText = `
        width: ${config.width || DEFAULT_SLIDER_CONFIG.width}px;
        min-width: ${config.width || DEFAULT_SLIDER_CONFIG.width}px;
        max-width: ${config.width || DEFAULT_SLIDER_CONFIG.width}px;
        flex-shrink: 0;
        padding: ${DEFAULT_SLIDER_CONFIG.padding};
        min-height: ${DEFAULT_SLIDER_CONFIG.minHeight}px;
        box-sizing: border-box;
        border: 1px solid #ccc;
        border-radius: 3px;
        font-size: ${DEFAULT_SLIDER_CONFIG.fontSize}px;
        text-align: center;
    `;

    const roundToStep = (value, step) => {
        return Math.round(value / step) * step;
    };

    const clampValue = (value) => Math.max(config.min, Math.min(config.max, value));

    let debounceTimer = null;

    slider.oninput = (e) => {
        const rawValue = config.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
        const value = roundToStep(rawValue, config.step || 1);
        numericInput.value = value;
        config.onChange(value);
    };

    numericInput.oninput = (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            let value = config.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);

            if (isNaN(value)) {
                value = config.value;
            } else {
                value = roundToStep(clampValue(value), config.step || 1);
            }

            slider.value = value;
            numericInput.value = value;
            config.onChange(value);
        }, config.debounceMs || DEFAULT_SLIDER_CONFIG.debounceMs);
    };

    numericInput.onblur = (e) => {
        clearTimeout(debounceTimer);
        let value = config.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);

        if (isNaN(value)) {
            value = config.value;
        } else {
            value = roundToStep(clampValue(value), config.step || 1);
        }

        numericInput.value = value;
        slider.value = value;
        config.onChange(value);
    };

    container.appendChild(slider);
    container.appendChild(numericInput);

    return container;
}
