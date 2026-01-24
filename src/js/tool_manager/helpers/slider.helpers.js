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

// ============================================================================
// LEGACY API - Maintain backward compatibility
// ============================================================================

/**
 * Creates a simple numeric input with validation.
 * @deprecated Use createModernNumericInput instead
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
 * @deprecated Use createModernSlider instead
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
