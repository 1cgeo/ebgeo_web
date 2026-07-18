// Path: js/tool_manager/helpers/slider.helpers.js

/**
 * @fileoverview Modern slider and numeric input components for attribute panels.
 */

import { DEFAULT_SLIDER_CONFIG } from './common-config.helpers.js';

/**
 * Returns the number of decimal places in a number.
 * @param {number} num
 * @returns {number}
 */
function getDecimalPlaces(num) {
    const str = String(num);
    const decimalIndex = str.indexOf('.');
    return decimalIndex === -1 ? 0 : str.length - decimalIndex - 1;
}

/**
 * Creates value-processing helpers scoped to a slider/input configuration.
 *
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value
 * @param {number} step - Step increment
 * @returns {{ roundToStep: Function, clampValue: Function, parseValue: Function }}
 */
function createValueHelpers(min, max, step) {
    const decimalPlaces = getDecimalPlaces(step);

    const roundToStep = (val) => {
        const result = Math.round(val / step) * step;
        return Number(result.toFixed(decimalPlaces));
    };
    const clampValue = (val) => Math.max(min, Math.min(max, val));
    const parseValue = (val) => step < 1 ? parseFloat(val) : parseInt(val, 10);

    return { roundToStep, clampValue, parseValue };
}

/**
 * Validates and normalizes a raw input value, applying clamping and rounding.
 *
 * @param {string} rawValue - Raw string value from the input element
 * @param {number} fallback - Fallback value when input is NaN
 * @param {{ roundToStep: Function, clampValue: Function, parseValue: Function }} helpers
 * @returns {number} Validated and normalized value
 */
function normalizeInputValue(rawValue, fallback, helpers) {
    const val = helpers.parseValue(rawValue);
    if (isNaN(val)) return fallback;
    return helpers.roundToStep(helpers.clampValue(val));
}

/**
 * Attaches debounced input + blur handlers to a numeric input element.
 *
 * @param {HTMLInputElement} input - The numeric input element
 * @param {Object} options
 * @param {number} options.fallback - Fallback value when input is NaN
 * @param {number} [options.debounceMs] - Debounce delay in ms
 * @param {Function} options.onChange - Callback with the validated value
 * @param {{ roundToStep: Function, clampValue: Function, parseValue: Function }} options.helpers
 * @param {HTMLInputElement} [options.syncSlider] - Optional slider element to keep in sync
 */
function attachNumericInputHandlers(input, { fallback, debounceMs, onChange, helpers, syncSlider }) {
    let debounceTimer = null;

    input.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const val = normalizeInputValue(e.target.value, fallback, helpers);
            input.value = val;
            if (syncSlider) syncSlider.value = val;
            onChange(val);
        }, debounceMs || DEFAULT_SLIDER_CONFIG.debounceMs);
    });

    input.addEventListener('blur', (e) => {
        clearTimeout(debounceTimer);
        const val = normalizeInputValue(e.target.value, fallback, helpers);
        input.value = val;
        if (syncSlider) syncSlider.value = val;
        onChange(val);
    });
}

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
 * @param {boolean} [config.disabled=false] - Whether the slider is disabled
 * @param {string} [config.disabledMessage] - Tooltip message when disabled
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
        debounceMs,
        disabled = false,
        disabledMessage
    } = config;

    const helpers = createValueHelpers(min, max, step);

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

    // Apply disabled state
    if (disabled) {
        container.classList.add('attr-modern-slider-disabled');
        slider.disabled = true;
        if (numericInput) {
            numericInput.disabled = true;
        }
        if (disabledMessage) {
            container.title = disabledMessage;
        }
    }

    // Slider input handler
    slider.addEventListener('input', (e) => {
        const newValue = helpers.roundToStep(helpers.parseValue(e.target.value));
        if (numericInput) {
            numericInput.value = newValue;
        }
        onChange(newValue);
    });

    // Numeric input handlers
    if (numericInput) {
        attachNumericInputHandlers(numericInput, {
            fallback: value,
            debounceMs,
            onChange,
            helpers,
            syncSlider: slider
        });
    }

    /**
     * Programmatically toggle the disabled state of this slider.
     * @param {boolean} isDisabled - Whether the slider should be disabled
     * @param {string} [message] - Optional tooltip message when disabled
     */
    container.setDisabled = (isDisabled, message) => {
        if (isDisabled) {
            container.classList.add('attr-modern-slider-disabled');
            slider.disabled = true;
            if (numericInput) numericInput.disabled = true;
            if (message) container.title = message;
        } else {
            container.classList.remove('attr-modern-slider-disabled');
            slider.disabled = false;
            if (numericInput) numericInput.disabled = false;
            container.title = '';
        }
    };

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

    const helpers = createValueHelpers(min, max, step);

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

    attachNumericInputHandlers(input, {
        fallback: value,
        debounceMs,
        onChange,
        helpers
    });

    return container;
}
