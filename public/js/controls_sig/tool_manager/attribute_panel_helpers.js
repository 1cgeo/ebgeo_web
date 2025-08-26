// Path: js\controls_sig\tool_manager\attribute_panel_helpers.js

/**
 * Centralized helper functions for attribute panels
 * Reduces code duplication and ensures consistency across all panels
 */

// ===== DEFAULT CONFIGURATIONS =====

export const DEFAULT_SLIDER_CONFIG = {
    width: 70,      // Reduced from 60-80px
    fontSize: 11,   // Reduced from 12px
    padding: '6px 4px',  // ✅ Increased vertical padding
    gap: 6,         // Reduced from 8px
    debounceMs: 300,
    minHeight: 28   // ✅ Minimum height for inputs
};

export const COMPACT_STYLES = {
    containerGap: '6px',     // Reduced from 8px
    marginBottom: '10px',    // Reduced from 12px
    fontSize: '13px',        // Reduced from 14px
    minHeight: '28px'        // Reduced from 32px
};

// ===== ENHANCED SLIDER WITH NUMERIC INPUT =====

/**
 * Creates a robust slider with numeric input (based on arrow_attributes_panel.js implementation)
 * Features: debounce, validation, auto-clamping, step rounding
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

    // Enhanced functions from arrow implementation
    const roundToStep = (value, step) => {
        return Math.round(value / step) * step;
    };

    const clampValue = (value) => Math.max(config.min, Math.min(config.max, value));

    // Debounce timer for manual input
    let debounceTimer = null;

    // Sync slider -> input (with rounding)
    slider.oninput = (e) => {
        const rawValue = config.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
        const value = roundToStep(rawValue, config.step || 1);
        numericInput.value = value;
        config.onChange(value);
    };

    // Sync input -> slider (with debounce)
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

    // Robust validation on blur
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

// ===== STANDARDIZED COLOR PICKER =====

/**
 * Creates a standardized color picker
 */
export function createColorPicker(value, onChange, title) {
    const input = document.createElement('input');
    input.classList.add("picker-color");
    input.type = 'color';
    input.value = value || '#000000';
    input.title = title || '';
    input.style.cssText = 'width: 40px; height: 30px; border: none; border-radius: 4px; cursor: pointer;';
    input.oninput = onChange;
    return input;
}

// ===== STANDARDIZED CHECKBOX =====

/**
 * Creates a standardized toggle checkbox (following existing pattern)
 */
export function createCheckbox(checked, onChange) {
    const label = $("<label>", { class: "switch" });
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.classList.add("slider-check-input");
    label.append(input);
    label.append($("<div>", { class: "slider-check round" }));
    input.onchange = onChange;
    return label;
}

// ===== LINE STYLE SELECT WITH VISUAL PREVIEW =====

/**
 * Creates a line style select with visual preview patterns
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
        { value: 'solid', label: 'Contínuo', pattern: '───────────' },
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
 */
export function createAttributeRow(labelText, inputElement) {
    const container = $("<div>", { class: "attr-container-row" });
    const label = document.createElement('label');
    label.textContent = labelText;

    container.append($("<div>", { class: "attr-name" }).append(label));
    container.append($("<div>", { class: "attr-input" }).append(inputElement));

    return container;
}

// ===== EDITABLE FEATURE NAME COMPONENT =====

/**
 * Creates an editable feature name component
 * Shows feature name in bold, larger text, becomes editable on click
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

    // Switch to edit mode
    nameDisplay.onclick = () => {
        nameDisplay.style.display = 'none';
        nameInput.style.display = 'block';
        nameInput.focus();
        nameInput.select();
    };

    // Save on Enter or blur
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

    // Cancel on Escape
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
 */
export function createStandardButtons(config) {
    const {
        selectedFeatures,
        control,
        selectionManager,
        initialPropertiesMap, // ✅ REQUIRED PARAMETER - captured at panel opening
        hasSetDefault = false,
        onSetDefault = null
    } = config;

    const buttonContainer = $("<div>", { class: "attr-container-row" });

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar';
    saveButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    saveButton.type = 'submit';
    saveButton.onclick = () => {
        control.saveFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    discardButton.onclick = () => {
        control.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };

    // Set Default Button (conditional)
    if (hasSetDefault && onSetDefault) {
        const setDefaultButton = document.createElement('button');
        setDefaultButton.textContent = 'Definir padrão';
        setDefaultButton.classList.add('tool-button', 'pure-material-tool-button-contained');
        setDefaultButton.onclick = () => {
            onSetDefault();
            selectionManager.deselectAllFeatures();
        };
        buttonContainer.append(setDefaultButton);
    }

    buttonContainer.append(saveButton).append(discardButton);
    return buttonContainer;
}

// ===== UTILITY FUNCTIONS =====

/**
 * Common configurations for different property types
 */
export const COMMON_CONFIGS = {
    opacity: {
        min: 0,
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
 */
export function getCommonConfig(type, defaultValue, overrides = {}) {
    const baseConfig = COMMON_CONFIGS[type] || {};
    return {
        ...baseConfig,
        value: defaultValue,
        ...overrides
    };
}