// Path: src/js/controls_sig/tool_manager/attribute_panel_helpers.js

import { getFrequentColors, getLayers, getActiveLayerIdSync, isFeatureEffectivelyLocked } from '../store/store.js';
import { COORDINATE_FORMATS, getPlaceholderForFormat, parseCoordinates, formatCoordinates } from '../utilities/coordinate_converter.js';

/**
 * Centralized helper functions for attribute panels
 * Reduces code duplication and ensures consistency across all panels
 */

// ===== DEFAULT CONFIGURATIONS =====

export const DEFAULT_SLIDER_CONFIG = {
    width: 70,
    fontSize: 11,
    padding: '6px 4px',
    gap: 6,
    debounceMs: 300,
    minHeight: 28
};

export const COMPACT_STYLES = {
    containerGap: '6px',
    marginBottom: '10px',
    fontSize: '13px',
    minHeight: '28px'
};

// ===== NUMERIC INPUT =====

/**
 * Creates a simple numeric input with validation
 * @param {Object} config - Configuration object
 * @param {number} config.min - Minimum value
 * @param {number} config.max - Maximum value
 * @param {number} config.step - Step value (default: 1)
 * @param {number} config.value - Initial value
 * @param {function} config.onChange - Callback when value changes
 * @param {string} config.suffix - Optional suffix to display (e.g., " m")
 * @returns {HTMLElement} Input element
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

// ===== ENHANCED SLIDER WITH NUMERIC INPUT =====

/**
 * Creates a robust slider with numeric input
 * @param {Object} config - Configuration object with min, max, step, value, onChange
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

// ===== COLOR PICKER WITH MODAL =====

/**
 * Creates a color picker that opens enhanced modal on click
 * @param {string} value - Initial color value
 * @param {function} onChange - Callback when color changes
 * @param {string} title - Tooltip title
 * @param {string} scope - Color scope ('current' or 'project')
 * @returns {HTMLElement} Color input element
 */
export function createColorPicker(value, onChange, title, scope = 'current') {
    const colorInput = document.createElement('input');
    colorInput.classList.add("picker-color");
    colorInput.type = 'color';

    const realValue = value;
    colorInput.dataset.realValue = realValue || '';

    colorInput.value = realValue || '#000000';

    colorInput.title = title || 'Clique para escolher cor';
    colorInput.style.cssText = 'width: 40px; height: 30px; border: none; border-radius: 4px; cursor: pointer;';

    colorInput.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openColorPickerModal(colorInput, onChange, scope);
    });

    colorInput.oninput = onChange;

    return colorInput;
}

/**
 * Opens advanced color picker modal
 * @param {HTMLElement} triggerElement - Element that triggered the modal
 * @param {function} onChange - Callback when color changes
 * @param {string} scope - Color scope
 */
function openColorPickerModal(triggerElement, onChange, scope) {
    closeExistingColorModal();

    const realValue = triggerElement.dataset.realValue || triggerElement.value;

    const modal = document.createElement('div');
    modal.className = 'color-picker-modal';
    modal.id = 'color-picker-modal';

    const content = document.createElement('div');
    content.className = 'color-picker-modal-content';

    const header = document.createElement('div');
    header.className = 'color-picker-header';
    header.innerHTML = `
        <span>Escolher Cor</span>
        <button class="color-picker-close" aria-label="Fechar">&times;</button>
    `;

    const nativePickerContainer = document.createElement('div');
    nativePickerContainer.className = 'color-picker-native-container';

    const nativeColorPicker = document.createElement('input');
    nativeColorPicker.type = 'color';
    nativeColorPicker.value = triggerElement.value;
    nativeColorPicker.className = 'color-picker-native';

    nativePickerContainer.appendChild(nativeColorPicker);

    const paletteContainer = createColorPaletteModal(realValue, onChange, scope, triggerElement);

    content.appendChild(header);
    content.appendChild(nativePickerContainer);
    content.appendChild(paletteContainer);
    modal.appendChild(content);

    nativeColorPicker.oninput = (e) => {
        const color = e.target.value;
        triggerElement.value = color;
        triggerElement.dataset.realValue = color;
        updateActivePaletteButton(paletteContainer, color);

        const fakeEvent = { target: { value: color } };
        onChange(fakeEvent);
    };

    const closeButton = header.querySelector('.color-picker-close');
    closeButton.onclick = () => closeColorModal(modal);

    modal.onclick = (e) => {
        if (e.target === modal) {
            closeColorModal(modal);
        }
    };

    const escListener = (e) => {
        if (e.key === 'Escape') {
            closeColorModal(modal);
            document.removeEventListener('keydown', escListener);
        }
    };
    document.addEventListener('keydown', escListener);

    document.body.appendChild(modal);

    positionModal(modal, triggerElement);
}

/**
 * Creates color palette for modal
 * @param {string} currentValue - Currently selected color
 * @param {function} onChange - Callback when color changes
 * @param {string} scope - Color scope
 * @param {HTMLElement} triggerElement - Element that triggered modal
 * @returns {HTMLElement} Palette container
 */
function createColorPaletteModal(currentValue, onChange, scope, triggerElement) {
    const paletteContainer = document.createElement('div');
    paletteContainer.className = 'color-palette-modal-container';

    const paletteLabel = document.createElement('div');
    paletteLabel.className = 'color-palette-label';
    paletteLabel.textContent = scope === 'project' ? 'Cores do projeto:' : 'Cores frequentes:';
    paletteContainer.appendChild(paletteLabel);

    const paletteGrid = document.createElement('div');
    paletteGrid.className = 'color-palette-modal-grid';

    const frequentColors = getFrequentColors(10, scope);

    if (frequentColors.length > 0) {
        frequentColors.forEach(({ color, count }) => {
            const colorButton = createModalColorButton(color, count, currentValue, onChange, triggerElement);
            paletteGrid.appendChild(colorButton);
        });
    } else {
        const noColorsMessage = document.createElement('div');
        noColorsMessage.className = 'color-palette-empty';
        noColorsMessage.textContent = 'Nenhuma cor usada ainda';
        paletteGrid.appendChild(noColorsMessage);
    }

    paletteContainer.appendChild(paletteGrid);
    return paletteContainer;
}

/**
 * Creates individual color button for modal
 * @param {string} color - Button color
 * @param {number} count - Usage count
 * @param {string} currentValue - Currently selected color
 * @param {function} onChange - Callback when clicked
 * @param {HTMLElement} triggerElement - Element that triggered modal
 * @returns {HTMLElement} Color button
 */
function createModalColorButton(color, count, currentValue, onChange, triggerElement) {
    const button = document.createElement('button');
    button.className = 'color-button-modal';
    button.style.backgroundColor = color;
    button.title = `${color} (usado ${count}x)`;
    button.dataset.color = color;

    if (currentValue === color) {
        button.classList.add('active');
    }

    button.onclick = (e) => {
        e.preventDefault();

        triggerElement.value = color;
        triggerElement.dataset.realValue = color;

        const nativePicker = document.querySelector('.color-picker-native');
        if (nativePicker) {
            nativePicker.value = color;
        }

        const paletteContainer = button.closest('.color-palette-modal-container');
        if (paletteContainer) {
            updateActivePaletteButton(paletteContainer, color);
        }

        const fakeEvent = { target: { value: color } };
        onChange(fakeEvent);

        closeExistingColorModal();
    };

    return button;
}

/**
 * Updates active button in palette
 * @param {HTMLElement} container - Palette container
 * @param {string} selectedColor - Selected color
 */
function updateActivePaletteButton(container, selectedColor) {
    const buttons = container.querySelectorAll('.color-button-modal');
    buttons.forEach(button => {
        const buttonColor = button.dataset.color;
        button.classList.toggle('active', buttonColor === selectedColor);
    });
}

/**
 * Positions modal near trigger element
 * @param {HTMLElement} modal - Modal element
 * @param {HTMLElement} triggerElement - Element that triggered modal
 */
function positionModal(modal, triggerElement) {
    const rect = triggerElement.getBoundingClientRect();
    const modalContent = modal.querySelector('.color-picker-modal-content');

    let top = rect.bottom + window.scrollY + 8;
    let left = rect.left + window.scrollX + (rect.width / 2);

    const modalRect = modalContent.getBoundingClientRect();

    if (left + modalRect.width > window.innerWidth) {
        left = window.innerWidth - modalRect.width - 20;
    }
    if (left < 20) {
        left = 20;
    }

    if (top + modalRect.height > window.innerHeight + window.scrollY) {
        top = rect.top + window.scrollY - modalRect.height - 8;
    }

    modalContent.style.left = `${left}px`;
    modalContent.style.top = `${top}px`;
}

/**
 * Closes existing color modal
 */
function closeExistingColorModal() {
    const existingModal = document.getElementById('color-picker-modal');
    if (existingModal) {
        closeColorModal(existingModal);
    }
}

/**
 * Closes specific color modal
 * @param {HTMLElement} modal - Modal to close
 */
function closeColorModal(modal) {
    modal.classList.add('closing');
    setTimeout(() => {
        if (modal.parentNode) {
            modal.parentNode.removeChild(modal);
        }
    }, 200);
}

// ===== STANDARDIZED CHECKBOX =====

/**
 * Creates a standardized toggle checkbox
 * @param {boolean} checked - Initial checked state
 * @param {function} onChange - Callback when checkbox changes
 * @returns {HTMLElement} Checkbox label element
 */
export function createCheckbox(checked, onChange) {
    const label = document.createElement('label');
    label.className = 'switch';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.classList.add('slider-check-input');

    const slider = document.createElement('div');
    slider.className = 'slider-check round';

    label.appendChild(input);
    label.appendChild(slider);
    input.onchange = onChange;
    return label;
}

// ===== LINE STYLE SELECT WITH VISUAL PREVIEW =====

/**
 * Creates a line style select with visual preview patterns
 * @param {string} currentValue - Currently selected line style
 * @param {function} onChange - Callback when selection changes
 * @returns {HTMLElement} Container with select element
 */
export function createLineStyleSelect(currentValue, onChange) {
    const container = document.createElement('div');
    container.style.cssText = 'position: relative; width: 100%;';

    const select = document.createElement('select');
    select.className = 'form-select line-style-select';
    select.style.cssText = `
        width: 100%;
        padding: 8px 12px;
        border-radius: 4px;
        border: 1px solid #ccc;
        background: white;
        font-size: 18px;
        appearance: none;
        background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><path d="M0 0l6 6 6-6z" fill="%23999"/></svg>');
        background-repeat: no-repeat;
        background-position: right 8px center;
        padding-right: 28px;
        font-family: 'Courier New', monospace;
        text-align: center
    `;

    const options = [
        { value: 'solid', label: 'Contínuo', pattern: '────────────' },
        { value: 'dashed', label: 'Tracejado', pattern: '── ── ── ──' },
        { value: 'dotted', label: 'Pontilhado', pattern: ' - - - - - -' },
        { value: 'dash-dot', label: 'Traço-Ponto', pattern: '── - ── - ──' },
    ];

    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = `${opt.pattern}`;
        option.selected = opt.value === currentValue;
        select.appendChild(option);
    });

    select.onchange = (e) => onChange(e.target.value);
    container.appendChild(select);

    return container;
}

// ===== ATTRIBUTE ROW HELPER =====

/**
 * Creates a standardized attribute row with label and input
 * @param {string} labelText - Label text
 * @param {HTMLElement} inputElement - Input element
 * @returns {HTMLElement} Attribute row container
 */
export function createAttributeRow(labelText, inputElement) {
    const container = document.createElement('div');
    container.className = 'attr-container-row';

    const label = document.createElement('label');
    label.textContent = labelText;

    const attrName = document.createElement('div');
    attrName.className = 'attr-name';
    attrName.appendChild(label);

    const attrInput = document.createElement('div');
    attrInput.className = 'attr-input';
    attrInput.appendChild(inputElement);

    container.appendChild(attrName);
    container.appendChild(attrInput);

    return container;
}

// ===== EDITABLE FEATURE NAME COMPONENT =====

/**
 * Creates an editable feature name component
 * @param {string} initialName - Initial feature name
 * @param {function} onNameChange - Callback when name changes
 * @returns {HTMLElement} Editable name container
 */
export function createEditableFeatureName(initialName, onNameChange) {
    const container = document.createElement('div');
    container.className = 'feature-name-container';

    const nameDisplay = document.createElement('div');
    nameDisplay.className = 'feature-name-editable';
    nameDisplay.textContent = initialName || 'Sem nome';
    nameDisplay.title = 'Clique para editar o nome';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'feature-name-input';
    nameInput.value = initialName || '';
    nameInput.style.cssText = 'display: none; width: 100%; font-size: 16px; font-weight: bold; padding: 6px; border: 1px solid #007bff; border-radius: 4px;';

    nameDisplay.onclick = () => {
        nameDisplay.style.display = 'none';
        nameInput.style.display = 'block';
        nameInput.focus();
        nameInput.select();
    };

    const saveEdit = () => {
        const newName = nameInput.value.trim();
        if (newName === '') {
            nameInput.value = initialName || 'Sem nome';
            return;
        }

        nameDisplay.textContent = newName;
        nameDisplay.style.display = 'block';
        nameInput.style.display = 'none';

        if (newName !== initialName) {
            onNameChange(newName);
        }
    };

    const cancelEdit = () => {
        nameInput.value = initialName || '';
        nameDisplay.style.display = 'block';
        nameInput.style.display = 'none';
    };

    nameInput.onblur = saveEdit;
    nameInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveEdit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
        }
    };

    container.appendChild(nameDisplay);
    container.appendChild(nameInput);

    return container;
}

// ===== STANDARD BUTTONS =====

/**
 * Creates standardized Save/Discard/Set Default buttons
 * @param {Object} config - Button configuration
 * @returns {HTMLElement} Button container
 */
export function createStandardButtons(config) {
    const {
        selectedFeatures,
        control,
        selectionManager,
        initialPropertiesMap,
        hasSetDefault = false,
        onSetDefault = null
    } = config;

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'attr-container-row';

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        control.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };
    buttonContainer.appendChild(saveButton);

    if (hasSetDefault && onSetDefault) {
        const setDefaultButton = document.createElement('button');
        setDefaultButton.textContent = 'Definir padrão';
        setDefaultButton.classList.add('tool-button', 'pure-material-tool-button-contained');
        setDefaultButton.onclick = () => {
            onSetDefault();
            selectionManager.deselectAllFeatures();
        };
        buttonContainer.appendChild(setDefaultButton);
    }

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    discardButton.onclick = () => {
        control.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };
    buttonContainer.appendChild(discardButton);

    return buttonContainer;
}

// ===== UTILITY FUNCTIONS =====

/**
 * Common configurations for different property types
 */
export const COMMON_CONFIGS = {
    complete_opacity: {
        min: 0,
        max: 100,
        step: 1
    },
    opacity: {
        min: 10,
        max: 100,
        step: 1
    },
    lineWidth: {
        min: 1,
        max: 10,
        step: 1
    },
    size: {
        min: 0.1,
        max: 10,
        step: 0.1
    },
    rotation: {
        min: -180,
        max: 180,
        step: 1
    }
};

/**
 * Helper to get common config with default value
 * @param {string} type - Config type
 * @param {*} defaultValue - Default value
 * @param {Object} overrides - Override values
 * @returns {Object} Merged configuration
 */
export function getCommonConfig(type, defaultValue, overrides = {}) {
    const baseConfig = COMMON_CONFIGS[type] || {};
    return {
        ...baseConfig,
        value: defaultValue,
        ...overrides
    };
}

// ===== CSS INJECTION =====

/**
 * Injects required CSS for color picker modal
 */
function injectColorPickerModalStyles() {
    if (document.getElementById('color-picker-modal-styles')) {
        return;
    }

    const style = document.createElement('style');
    style.id = 'color-picker-modal-styles';
    style.textContent = `
        .color-picker-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.3);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            animation: colorModalFadeIn 0.2s ease-out forwards;
        }

        .color-picker-modal.closing {
            animation: colorModalFadeOut 0.2s ease-out forwards;
        }

        @keyframes colorModalFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        @keyframes colorModalFadeOut {
            from { opacity: 1; }
            to { opacity: 0; }
        }

        .color-picker-modal-content {
            position: absolute;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            padding: 0;
            min-width: 280px;
            max-width: 320px;
            transform: translateY(-10px);
            animation: colorModalSlideIn 0.2s ease-out forwards;
        }

        .color-picker-modal.closing .color-picker-modal-content {
            animation: colorModalSlideOut 0.2s ease-out forwards;
        }

        @keyframes colorModalSlideIn {
            from {
                opacity: 0;
                transform: translateY(-20px) scale(0.95);
            }
            to {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }

        @keyframes colorModalSlideOut {
            from {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
            to {
                opacity: 0;
                transform: translateY(-10px) scale(0.95);
            }
        }

        .color-picker-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            border-bottom: 1px solid #eee;
            font-weight: 600;
            font-size: 14px;
            color: #333;
        }

        .color-picker-close {
            background: none;
            border: none;
            font-size: 20px;
            cursor: pointer;
            padding: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #999;
            border-radius: 4px;
            transition: all 0.2s;
        }

        .color-picker-close:hover {
            background: #f5f5f5;
            color: #666;
        }

        .color-picker-native-container {
            padding: 20px;
            text-align: center;
            border-bottom: 1px solid #eee;
        }

        .color-picker-native {
            width: 100%;
            height: 40px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            transition: transform 0.1s;
        }

        .color-picker-native:hover {
            transform: scale(1.05);
        }

        .color-palette-modal-container {
            padding: 20px;
        }

        .color-palette-label {
            font-size: 12px;
            font-weight: 500;
            color: #666;
            margin-bottom: 12px;
            text-align: center;
        }

        .color-palette-modal-grid {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 8px;
            justify-items: center;
        }

        .color-button-modal {
            width: 32px;
            height: 32px;
            border: 2px solid #ddd;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s ease;
            position: relative;
            padding: 0;
            margin: 0;
        }

        .color-button-modal:hover {
            transform: scale(1.1);
            border-color: #007bff;
            box-shadow: 0 2px 8px rgba(0, 123, 255, 0.3);
        }

        .color-button-modal.active {
            border-color: #007bff;
            border-width: 3px;
            transform: scale(1.05);
        }

        .color-button-modal.active::after {
            content: '✓';
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: white;
            font-weight: bold;
            font-size: 14px;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
        }

        .color-palette-empty {
            grid-column: 1 / -1;
            text-align: center;
            font-size: 11px;
            color: #999;
            font-style: italic;
            padding: 20px 0;
        }
    `;

    document.head.appendChild(style);
}

injectColorPickerModalStyles();

// ===== COORDINATE EDITOR =====

/**
 * Creates coordinate editor for Point geometries
 * @param {Object} feature - Feature with Point geometry
 * @param {Object} uiManager - UIManager instance
 * @param {Function} onCoordinateChange - Callback(lat, lng)
 * @param {boolean} disabled - Disable editing for multiple selections
 * @returns {HTMLElement} Coordinate editor container
 */
export function createCoordinateEditor(feature, uiManager, onCoordinateChange, disabled = false) {
    if (!feature || feature.geometry.type !== 'Point') {
        return document.createElement('div');
    }

    const mouseCoordinatesControl = uiManager?.mouseCoordinatesControl;
    if (!mouseCoordinatesControl) {
        console.warn('MouseCoordinatesControl not available in UIManager');
        return document.createElement('div');
    }

    const [lng, lat] = feature.geometry.coordinates;
    const currentFormat = mouseCoordinatesControl.getCurrentFormat();

    const container = document.createElement('div');
    container.className = 'coordinate-editor-container';
    container.style.cssText = 'margin-bottom: 10px;';

    const label = document.createElement('label');
    label.textContent = 'Coordenadas:';
    label.style.cssText = 'display: block; font-weight: 500; color: #333; font-size: 13px; margin-bottom: 4px;';
    container.appendChild(label);

    const displayRow = document.createElement('div');
    displayRow.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const coordsText = document.createElement('input');
    coordsText.type = 'text';
    coordsText.readOnly = true;
    coordsText.style.cssText = `
        flex-grow: 1;
        padding: 6px 8px;
        border: 1px solid #ccc;
        border-radius: 3px;
        font-size: 12px;
        background: #f9f9f9;
        font-family: monospace;
        cursor: text;
    `;
    coordsText.value = formatCoordinates(lat, lng, currentFormat);

    const editButton = document.createElement('button');
    editButton.className = 'tool-button';
    editButton.innerHTML = `<img src="./images/gear_icon.svg" alt="Editar" width="16" height="16" />`;
    editButton.title = 'Editar coordenadas';
    editButton.style.cssText = 'padding: 6px 8px; min-width: auto;';
    editButton.disabled = disabled;

    displayRow.appendChild(coordsText);
    displayRow.appendChild(editButton);
    container.appendChild(displayRow);

    editButton.onclick = () => {
        openCoordinateEditModal(lat, lng, currentFormat, (newLat, newLng) => {
            onCoordinateChange(newLat, newLng);
        });
    };

    container.updateCoordinates = (newLat, newLng) => {
        coordsText.value = formatCoordinates(newLat, newLng, currentFormat);
    };
    return container;
}

/**
 * Opens coordinate edit modal
 * @param {number} currentLat - Current latitude
 * @param {number} currentLng - Current longitude
 * @param {string} currentFormat - Current coordinate format
 * @param {Function} onConfirm - Callback when confirmed
 */
function openCoordinateEditModal(currentLat, currentLng, currentFormat, onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'coordinate-edit-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.3);
        z-index: 10001;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    const content = document.createElement('div');
    content.className = 'coordinate-edit-modal-content';
    content.style.cssText = `
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        padding: 20px;
        min-width: 320px;
        max-width: 400px;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom: 20px; font-weight: 600; font-size: 16px; color: #333;';
    header.textContent = 'Editar Coordenadas';
    content.appendChild(header);

    const formatContainer = document.createElement('div');
    formatContainer.style.cssText = 'margin-bottom: 15px;';

    const formatLabel = document.createElement('label');
    formatLabel.textContent = 'Formato:';
    formatLabel.style.cssText = 'display: block; font-weight: 500; margin-bottom: 5px; font-size: 13px;';
    formatContainer.appendChild(formatLabel);

    const formatSelect = document.createElement('select');
    formatSelect.style.cssText = `
        width: 100%;
        padding: 8px;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 13px;
    `;

    COORDINATE_FORMATS.forEach(format => {
        const option = document.createElement('option');
        option.value = format.id;
        option.textContent = format.label;
        if (format.id === currentFormat) {
            option.selected = true;
        }
        formatSelect.appendChild(option);
    });

    formatContainer.appendChild(formatSelect);
    content.appendChild(formatContainer);

    const inputContainer = document.createElement('div');
    inputContainer.style.cssText = 'margin-bottom: 15px;';

    const inputLabel = document.createElement('label');
    inputLabel.textContent = 'Coordenadas:';
    inputLabel.style.cssText = 'display: block; font-weight: 500; margin-bottom: 5px; font-size: 13px;';
    inputContainer.appendChild(inputLabel);

    const input = document.createElement('input');
    input.type = 'text';
    input.value = formatCoordinates(currentLat, currentLng, currentFormat);
    input.placeholder = getPlaceholderForFormat(currentFormat);
    input.style.cssText = `
        width: 100%;
        padding: 8px;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 13px;
        box-sizing: border-box;
    `;
    inputContainer.appendChild(input);

    const validationMsg = document.createElement('div');
    validationMsg.style.cssText = 'color: #dc3545; font-size: 12px; margin-top: 5px; min-height: 18px;';
    inputContainer.appendChild(validationMsg);

    content.appendChild(inputContainer);

    formatSelect.onchange = () => {
        const newFormat = formatSelect.value;
        input.placeholder = getPlaceholderForFormat(newFormat);
        input.value = formatCoordinates(currentLat, currentLng, newFormat);
        validationMsg.textContent = '';
    };

    const closeModal = () => {
        if (modal && modal.parentNode) {
            document.removeEventListener('keydown', escapeHandler);
            modal.parentNode.removeChild(modal);
        }
    };

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancelar';
    cancelButton.className = 'tool-button pure-material-tool-button-contained';
    cancelButton.style.cssText = `
        padding: 8px 16px;
        min-height: 32px;
        font-size: 13px;
        font-weight: 500;
    `;
    cancelButton.onclick = () => {
        closeModal();
    };

    const confirmButton = document.createElement('button');
    confirmButton.textContent = 'Confirmar';
    confirmButton.className = 'tool-button pure-material-button-contained';
    confirmButton.style.cssText = `
        padding: 8px 16px;
        min-height: 32px;
        font-size: 13px;
        font-weight: 500;
    `;
    confirmButton.onclick = () => {
        const coords = parseCoordinates(input.value.trim(), formatSelect.value);
        if (coords) {
            onConfirm(coords.lat, coords.lng);
            closeModal();
        } else {
            validationMsg.textContent = 'Coordenadas inválidas para o formato selecionado';
        }
    };

    buttonContainer.appendChild(cancelButton);
    buttonContainer.appendChild(confirmButton);
    content.appendChild(buttonContainer);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    };
    document.addEventListener('keydown', escapeHandler);

    modal.appendChild(content);
    document.body.appendChild(modal);

    setTimeout(() => input.focus(), 100);
}

// ===== FEATURE HEADER WITH OPTIONS =====

/**
 * Creates feature header with editable name and options button
 * @param {string} initialName - Initial feature name
 * @param {Function} onNameChange - Callback when name changes
 * @param {Array} selectedFeatures - Selected features
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 * @returns {HTMLElement} Header container
 */
export function createFeatureHeaderWithOptions(
    initialName,
    onNameChange,
    selectedFeatures,
    selectionManager,
    uiManager
) {
    const container = document.createElement('div');
    container.className = 'feature-header-with-options';

    const nameWrapper = document.createElement('div');
    nameWrapper.className = 'feature-name-wrapper';

    const nameComponent = createEditableFeatureName(initialName, onNameChange);
    nameWrapper.appendChild(nameComponent);

    const optionsButton = createFeatureOptionsButton(
        selectedFeatures,
        selectionManager,
        uiManager
    );

    container.appendChild(nameWrapper);
    container.appendChild(optionsButton);

    return container;
}

/**
 * Creates feature options button (three vertical dots)
 * @param {Array} selectedFeatures - Selected features
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 * @returns {HTMLElement} Options button
 */
export function createFeatureOptionsButton(selectedFeatures, selectionManager, uiManager) {
    const button = document.createElement('button');
    button.className = 'feature-options-button';
    button.title = 'Opções';

    button.innerHTML = `<img src="./images/icon_more_info.svg" alt="Opções" />`;

    const shouldDisable = shouldDisableOptionsButton(selectedFeatures);
    button.disabled = shouldDisable;

    if (shouldDisable) {
        button.title = 'Disponível apenas para seleção de features do mesmo tipo';
    }

    button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const isOpen = button.dataset.dropdownOpen === 'true';

        if (isOpen) {
            closeAllFeatureDropdowns(true);
        } else {
            closeAllFeatureDropdowns(false);
            openFeatureDropdown(button, selectedFeatures, selectionManager, uiManager);
        }
    });

    initializeFeatureDropdownListeners();

    return button;
}

/**
 * Checks if options button should be disabled
 * @param {Array} selectedFeatures - Selected features
 * @returns {boolean} True if should disable
 */
function shouldDisableOptionsButton(selectedFeatures) {
    if (selectedFeatures.length <= 1) {
        return false;
    }

    const firstType = selectedFeatures[0].properties.source;
    const allSameType = selectedFeatures.every(f =>
        f.properties.source === firstType
    );

    return !allSameType;
}

/**
 * Opens feature options dropdown
 * @param {HTMLElement} button - Button that triggered dropdown
 * @param {Array} selectedFeatures - Selected features
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 */
async function openFeatureDropdown(button, selectedFeatures, selectionManager, uiManager) {
    const dropdown = document.createElement('div');
    dropdown.className = 'feature-dropdown-content';
    dropdown.dataset.buttonId = `feature-options-${Date.now()}`;

    const selectAllButton = document.createElement('button');
    selectAllButton.className = 'feature-menu-button';
    selectAllButton.textContent = 'Selecionar todos com mesmo tipo';

    selectAllButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        await selectAllFeaturesOfSameType(selectedFeatures, selectionManager, uiManager);
        closeAllFeatureDropdowns(true);
    });

    dropdown.appendChild(selectAllButton);

    const currentFeature = selectedFeatures[0];
    const currentLayerId = currentFeature?.properties?.layerId || 'default';
    const layers = await getLayers();
    const currentLayer = layers.find(l => l.id === currentLayerId);

    if (currentLayer) {
        const separator1 = document.createElement('div');
        separator1.style.cssText = 'height: 1px; background: #e0e0e0; margin: 4px 0;';
        dropdown.appendChild(separator1);

        const selectAllLayerButton = document.createElement('button');
        selectAllLayerButton.className = 'feature-menu-button';
        selectAllLayerButton.textContent = `Selecionar todos da camada "${currentLayer.name}"`;

        selectAllLayerButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await selectAllInLayer(currentLayerId, selectionManager, uiManager);
            closeAllFeatureDropdowns(true);
        });
        dropdown.appendChild(selectAllLayerButton);

        const featureType = currentFeature?.properties?.source;
        if (featureType) {
            const selectTypeInLayerButton = document.createElement('button');
            selectTypeInLayerButton.className = 'feature-menu-button';
            const typeName = getFeatureTypeName(featureType);
            selectTypeInLayerButton.textContent = `Selecionar todos "${typeName}" da camada`;

            selectTypeInLayerButton.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await selectAllOfTypeInLayer(featureType, currentLayerId, selectionManager, uiManager);
                closeAllFeatureDropdowns(true);
            });
            dropdown.appendChild(selectTypeInLayerButton);
        }
    }

    document.body.appendChild(dropdown);

    positionFeatureDropdown(dropdown, button);

    button.classList.add('dropdown-active');
    button.dataset.dropdownOpen = 'true';
}

/**
 * Returns readable feature type name
 * @param {string} featureType - Feature type code
 * @returns {string} Readable name
 */
function getFeatureTypeName(featureType) {
    const names = {
        'point': 'Pontos',
        'line': 'Linhas',
        'polygon': 'Poligonos',
        'text': 'Textos',
        'image': 'Imagens',
        'circle': 'Circulos',
        'rectangle': 'Retangulos',
        'ellipse': 'Elipses',
        'brush': 'Pinceis',
        'arrow': 'Setas',
        'boundary': 'Limites',
        'occupied_front': 'Frentes Ocupadas',
        'military_symbol': 'Simbolos Militares',
        'coordination_measure': 'Medidas de Coordenacao'
    };
    return names[featureType] || featureType;
}

/**
 * Selects all features in a layer
 * @param {string} layerId - Layer ID
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 */
async function selectAllInLayer(layerId, selectionManager, uiManager) {
    try {
        const allFeatures = [];

        for (const [featureType, control] of selectionManager.controls) {
            const sourceNames = control.getSourceNames();
            if (!sourceNames || sourceNames.length === 0) continue;

            for (const sourceName of sourceNames) {
                const source = selectionManager.map.getSource(sourceName);
                if (!source) continue;

                try {
                    const data = await source.getData();
                    if (data && data.features) {
                        const layerFeatures = data.features.filter(f => {
                            const featureLayerId = f.properties?.layerId || 'default';
                            return featureLayerId === layerId;
                        });
                        allFeatures.push(...layerFeatures);
                    }
                } catch (e) {
                    console.debug(`Error getting data from source ${sourceName}:`, e);
                }
            }
        }

        const selectableFeatures = allFeatures.filter(f => !isFeatureEffectivelyLocked(f));

        if (selectableFeatures.length === 0) {
            return;
        }

        selectionManager.deselectAllFeatures();

        for (const feature of selectableFeatures) {
            const featureType = feature.properties?.source;
            const featureId = feature.properties?.id;
            if (featureType && featureId) {
                if (!selectionManager.isFeatureSelected(featureType, featureId)) {
                    await selectionManager.toggleFeatureSelection(featureType, featureId, feature, false);
                }
            }
        }

        uiManager.updateSelectionHighlight();
        uiManager.updatePanels();
    } catch (error) {
        console.error('Error selecting all features in layer:', error);
    }
}

/**
 * Selects all features of a type in a specific layer
 * @param {string} featureType - Feature type
 * @param {string} layerId - Layer ID
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 */
async function selectAllOfTypeInLayer(featureType, layerId, selectionManager, uiManager) {
    try {
        const control = selectionManager.controls.get(featureType);
        if (!control) {
            console.warn(`Control not found for type: ${featureType}`);
            return;
        }

        const sourceNames = control.getSourceNames();
        if (!sourceNames || sourceNames.length === 0) {
            console.warn(`Source names not found for type: ${featureType}`);
            return;
        }

        const filteredFeatures = [];

        for (const sourceName of sourceNames) {
            const source = selectionManager.map.getSource(sourceName);
            if (!source) continue;

            try {
                const data = await source.getData();
                if (data && data.features) {
                    const layerFeatures = data.features.filter(f => {
                        const featureLayerId = f.properties?.layerId || 'default';
                        return featureLayerId === layerId && !isFeatureEffectivelyLocked(f);
                    });
                    filteredFeatures.push(...layerFeatures);
                }
            } catch (e) {
                console.debug(`Error getting data from source ${sourceName}:`, e);
            }
        }

        if (filteredFeatures.length === 0) {
            return;
        }

        selectionManager.deselectAllFeatures();

        for (const feature of filteredFeatures) {
            const featureId = feature.properties?.id;
            if (featureId) {
                if (!selectionManager.isFeatureSelected(featureType, featureId)) {
                    await selectionManager.toggleFeatureSelection(featureType, featureId, feature, false);
                }
            }
        }

        uiManager.updateSelectionHighlight();
        uiManager.updatePanels();
    } catch (error) {
        console.error('Error selecting features of type in layer:', error);
    }
}

/**
 * Positions dropdown near button
 * @param {HTMLElement} dropdown - Dropdown element
 * @param {HTMLElement} button - Button element
 */
function positionFeatureDropdown(dropdown, button) {
    requestAnimationFrame(() => {
        const rect = button.getBoundingClientRect();
        const dropdownRect = dropdown.getBoundingClientRect();
        const dropdownWidth = dropdownRect.width || 220;
        const dropdownHeight = dropdownRect.height || 100;

        let top = rect.bottom + 4;
        let left = rect.right - dropdownWidth;

        const viewport = {
            width: window.innerWidth,
            height: window.innerHeight
        };

        const padding = 10;

        if (left < padding) {
            left = rect.left;
        }
        if (left + dropdownWidth > viewport.width - padding) {
            left = Math.max(padding, viewport.width - dropdownWidth - padding);
        }

        if (top + dropdownHeight > viewport.height - padding) {
            const topAbove = rect.top - dropdownHeight - 4;
            if (topAbove >= padding) {
                top = topAbove;
            } else {
                top = Math.max(padding, Math.min(top, viewport.height - dropdownHeight - padding));
            }
        }

        dropdown.style.top = `${top}px`;
        dropdown.style.left = `${left}px`;
    });
}

/**
 * Closes all feature dropdowns
 * @param {boolean} animated - Whether to use animation
 */
function closeAllFeatureDropdowns(animated = false) {
    const dropdowns = document.querySelectorAll('.feature-dropdown-content');

    if (animated && dropdowns.length > 0) {
        dropdowns.forEach(dropdown => {
            if (dropdown.parentElement === document.body) {
                dropdown.classList.add('closing');
                setTimeout(() => {
                    if (dropdown.parentNode) {
                        dropdown.remove();
                    }
                }, 150);
            }
        });
    } else {
        dropdowns.forEach(dropdown => {
            if (dropdown.parentElement === document.body) {
                dropdown.remove();
            }
        });
    }

    const activeButtons = document.querySelectorAll('.feature-options-button.dropdown-active');
    activeButtons.forEach(button => {
        button.classList.remove('dropdown-active');
        delete button.dataset.dropdownOpen;
    });
}

/**
 * Selects all features of same type as current selection
 * @param {Array} selectedFeatures - Currently selected features
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 */
async function selectAllFeaturesOfSameType(selectedFeatures, selectionManager, uiManager) {
    if (selectedFeatures.length === 0) return;

    const firstFeature = selectedFeatures[0];
    const targetType = firstFeature.properties.source;

    const control = selectionManager.controls.get(targetType);
    if (!control) {
        console.warn(`Control not found for type: ${targetType}`);
        return;
    }

    const sourceNames = control.getSourceNames();
    if (!sourceNames || sourceNames.length === 0) {
        console.warn(`Source names not found for type: ${targetType}`);
        return;
    }

    const allFeaturesOfType = [];

    for (const sourceName of sourceNames) {
        const source = selectionManager.map.getSource(sourceName);
        if (source) {
            const data = await source.getData();
            if (data && data.features) {
                allFeaturesOfType.push(...data.features);
            }
        }
    }

    if (allFeaturesOfType.length === 0) {
        console.warn(`No features found for type: ${targetType}`);
        return;
    }

    selectionManager.deselectAllFeatures();

    for (const feature of allFeaturesOfType) {
        const featureId = feature.properties.id;
        if (!selectionManager.isFeatureSelected(targetType, featureId)) {
            await selectionManager.toggleFeatureSelection(targetType, featureId, feature, false);
        }
    }

    uiManager.updateSelectionHighlight();
    uiManager.updatePanels();
}

/**
 * Initializes global event listeners for feature dropdowns
 */
let featureDropdownListenersInitialized = false;

let dropdownClickHandler = null;
let dropdownKeydownHandler = null;
let dropdownScrollHandler = null;
let dropdownResizeHandler = null;

function initializeFeatureDropdownListeners() {
    if (featureDropdownListenersInitialized) return;

    dropdownClickHandler = (e) => {
        if (!e.target.closest('.feature-dropdown-content') &&
            !e.target.closest('.feature-options-button')) {
            closeAllFeatureDropdowns(false);
        }
    };

    dropdownKeydownHandler = (e) => {
        if (e.key === 'Escape') {
            closeAllFeatureDropdowns(true);
        }
    };

    dropdownScrollHandler = () => {
        closeAllFeatureDropdowns(false);
    };

    dropdownResizeHandler = () => {
        closeAllFeatureDropdowns(false);
    };

    document.addEventListener('click', dropdownClickHandler);
    document.addEventListener('keydown', dropdownKeydownHandler);
    document.addEventListener('scroll', dropdownScrollHandler, true);
    window.addEventListener('resize', dropdownResizeHandler);

    featureDropdownListenersInitialized = true;
}

/**
 * Removes global event listeners to prevent memory leaks
 */
export function cleanupFeatureDropdownListeners() {
    if (!featureDropdownListenersInitialized) return;

    if (dropdownClickHandler) {
        document.removeEventListener('click', dropdownClickHandler);
    }
    if (dropdownKeydownHandler) {
        document.removeEventListener('keydown', dropdownKeydownHandler);
    }
    if (dropdownScrollHandler) {
        document.removeEventListener('scroll', dropdownScrollHandler, true);
    }
    if (dropdownResizeHandler) {
        window.removeEventListener('resize', dropdownResizeHandler);
    }

    closeAllFeatureDropdowns(false);

    dropdownClickHandler = null;
    dropdownKeydownHandler = null;
    dropdownScrollHandler = null;
    dropdownResizeHandler = null;
    featureDropdownListenersInitialized = false;
}
