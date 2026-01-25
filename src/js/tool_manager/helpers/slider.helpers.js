// Path: js/tool_manager/helpers/slider.helpers.js

/**
 * @fileoverview Modern slider and numeric input components for attribute panels.
 */

import { DEFAULT_SLIDER_CONFIG } from './common-config.helpers.js';

/**
 * Creates a modern slider with label above and input to the right.
 *
 * @param {Object} config - Configuration object
 * @param {string} config.label - Label text
 * @param {number} config.min - Minimum value
 * @param {number} config.max - Maximum value
 * @param {number} [config.step=1] - Step value
 * @param {number} config.value - Initial value
 * @param {Function} config.onChange - Callback when value changes
 * @param {string} [config.unit=''] - Unit suffix (e.g., 'px', '%', '°', 'm')
 * @param {boolean} [config.showInput=true] - Whether to show numeric input
 * @param {number} [config.debounceMs] - Debounce delay in ms
 * @returns {HTMLElement} Slider container element
 */
export function createModernSlider(config) {
    const {
        label,
        min,
        max,
        step = 1,
        value,
        onChange,
        unit = '',
        showInput = true,
        debounceMs
    } = config;

    const container = document.createElement('div');
    container.className = 'attr-modern-slider';

    // Header row with label and input
    const header = document.createElement('div');
    header.className = 'attr-modern-slider-header';

    const labelEl = document.createElement('label');
    labelEl.className = 'attr-modern-slider-label';
    labelEl.textContent = label;
    header.appendChild(labelEl);

    let numericInput = null;

    if (showInput) {
        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'attr-modern-slider-input-wrapper';

        numericInput = document.createElement('input');
        numericInput.type = 'number';
        numericInput.className = 'attr-modern-slider-input';
        numericInput.min = min;
        numericInput.max = max;
        numericInput.step = step;
        numericInput.value = value;

        inputWrapper.appendChild(numericInput);

        if (unit) {
            const unitEl = document.createElement('span');
            unitEl.className = 'attr-modern-slider-unit';
            unitEl.textContent = unit;
            inputWrapper.appendChild(unitEl);
        }

        header.appendChild(inputWrapper);
    }

    container.appendChild(header);

    // Slider track
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'attr-modern-slider-track';
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = value;

    container.appendChild(slider);

    // Helper functions
    const getDecimalPlaces = (num) => {
        const str = String(num);
        const decimalIndex = str.indexOf('.');
        return decimalIndex === -1 ? 0 : str.length - decimalIndex - 1;
    };
    const decimalPlaces = getDecimalPlaces(step);
    const roundToStep = (val, s) => {
        const result = Math.round(val / s) * s;
        return Number(result.toFixed(decimalPlaces));
    };
    const clampValue = (val) => Math.max(min, Math.min(max, val));
    const parseValue = (val) => step < 1 ? parseFloat(val) : parseInt(val, 10);

    let debounceTimer = null;

    // Slider input handler
    slider.addEventListener('input', (e) => {
        const rawValue = parseValue(e.target.value);
        const newValue = roundToStep(rawValue, step);
        if (numericInput) {
            numericInput.value = newValue;
        }
        onChange(newValue);
    });

    // Numeric input handlers
    if (numericInput) {
        numericInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                let val = parseValue(e.target.value);
                if (isNaN(val)) {
                    val = value;
                } else {
                    val = roundToStep(clampValue(val), step);
                }
                slider.value = val;
                numericInput.value = val;
                onChange(val);
            }, debounceMs || DEFAULT_SLIDER_CONFIG.debounceMs);
        });

        numericInput.addEventListener('blur', (e) => {
            clearTimeout(debounceTimer);
            let val = parseValue(e.target.value);
            if (isNaN(val)) {
                val = value;
            } else {
                val = roundToStep(clampValue(val), step);
            }
            numericInput.value = val;
            slider.value = val;
            onChange(val);
        });
    }

    return container;
}

/**
 * Creates a modern numeric input without slider.
 *
 * @param {Object} config - Configuration object
 * @param {string} config.label - Label text
 * @param {number} config.min - Minimum value
 * @param {number} config.max - Maximum value
 * @param {number} [config.step=1] - Step value
 * @param {number} config.value - Initial value
 * @param {Function} config.onChange - Callback when value changes
 * @param {string} [config.unit=''] - Unit suffix
 * @param {number} [config.debounceMs] - Debounce delay in ms
 * @returns {HTMLElement} Numeric input container element
 */
export function createModernNumericInput(config) {
    const {
        label,
        min,
        max,
        step = 1,
        value,
        onChange,
        unit = '',
        debounceMs
    } = config;

    const container = document.createElement('div');
    container.className = 'attr-modern-numeric';

    const labelEl = document.createElement('label');
    labelEl.className = 'attr-modern-numeric-label';
    labelEl.textContent = label;
    container.appendChild(labelEl);

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'attr-modern-numeric-input-wrapper';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'attr-modern-numeric-input';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;

    inputWrapper.appendChild(input);

    if (unit) {
        const unitEl = document.createElement('span');
        unitEl.className = 'attr-modern-numeric-unit';
        unitEl.textContent = unit;
        inputWrapper.appendChild(unitEl);
    }

    container.appendChild(inputWrapper);

    // Helper functions
    const getDecimalPlaces = (num) => {
        const str = String(num);
        const decimalIndex = str.indexOf('.');
        return decimalIndex === -1 ? 0 : str.length - decimalIndex - 1;
    };
    const decimalPlaces = getDecimalPlaces(step);
    const roundToStep = (val, s) => {
        const result = Math.round(val / s) * s;
        return Number(result.toFixed(decimalPlaces));
    };
    const clampValue = (val) => Math.max(min, Math.min(max, val));
    const parseValue = (val) => step < 1 ? parseFloat(val) : parseInt(val, 10);

    let debounceTimer = null;

    input.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            let val = parseValue(e.target.value);
            if (isNaN(val)) {
                val = value;
            } else {
                val = roundToStep(clampValue(val), step);
            }
            input.value = val;
            onChange(val);
        }, debounceMs || DEFAULT_SLIDER_CONFIG.debounceMs);
    });

    input.addEventListener('blur', (e) => {
        clearTimeout(debounceTimer);
        let val = parseValue(e.target.value);
        if (isNaN(val)) {
            val = value;
        } else {
            val = roundToStep(clampValue(val), step);
        }
        input.value = val;
        onChange(val);
    });

    return container;
}

