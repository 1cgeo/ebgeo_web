// Path: js\controls_sig\tool_manager\attribute_panel_helpers.js

// Import para acessar cores frequentes
import { getFrequentColors } from '../store/store.js';

/**
 * Centralized helper functions for attribute panels
 * Reduces code duplication and ensures consistency across all panels
 */

// ===== DEFAULT CONFIGURATIONS =====

export const DEFAULT_SLIDER_CONFIG = {
    width: 70,      // Reduced from 60-80px
    fontSize: 11,   // Reduced from 12px
    padding: '6px 4px',  // Increased vertical padding
    gap: 6,         // Reduced from 8px
    debounceMs: 300,
    minHeight: 28   // Minimum height for inputs
};

export const COMPACT_STYLES = {
    containerGap: '6px',     // Reduced from 8px
    marginBottom: '10px',    // Reduced from 12px
    fontSize: '13px',        // Reduced from 14px
    minHeight: '28px'        // Reduced from 32px
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

    // Suffix label if provided
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

    // Debounced input handler
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

    // Immediate validation on blur
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

// ===== COLOR PICKER WITH MODAL =====

/**
 * Creates a color picker that opens enhanced modal on click
 */
export function createColorPicker(value, onChange, title, scope = 'current', allowNoFill = false) {
    const colorInput = document.createElement('input');
    colorInput.classList.add("picker-color");
    colorInput.type = 'color';
    
    const realValue = value;
    colorInput.dataset.realValue = realValue || '';
    
    // Se for "none", usar cor padrão para visual do input
    colorInput.value = (realValue === 'none') ? '#FFFFFF' : (realValue || '#000000');
    
    colorInput.title = title || 'Clique para escolher cor';
    colorInput.style.cssText = 'width: 40px; height: 30px; border: none; border-radius: 4px; cursor: pointer;';
    
    // Substituir comportamento padrão do click
    colorInput.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openColorPickerModal(colorInput, onChange, scope, allowNoFill);
    });

    // Manter funcionalidade de change para compatibilidade
    colorInput.oninput = onChange;

    return colorInput;
}

/**
 * Abre modal do color picker avançado
 */
function openColorPickerModal(triggerElement, onChange, scope, allowNoFill = false) {
    // Fechar modal existente se houver
    closeExistingColorModal();

    const realValue = triggerElement.dataset.realValue || triggerElement.value;

    const modal = document.createElement('div');
    modal.className = 'color-picker-modal';
    modal.id = 'color-picker-modal';

    // Container do conteúdo
    const content = document.createElement('div');
    content.className = 'color-picker-modal-content';

    // Header
    const header = document.createElement('div');
    header.className = 'color-picker-header';
    header.innerHTML = `
        <span>Escolher Cor</span>
        <button class="color-picker-close" aria-label="Fechar">&times;</button>
    `;

    // Color picker nativo
    const nativePickerContainer = document.createElement('div');
    nativePickerContainer.className = 'color-picker-native-container';

    const nativeColorPicker = document.createElement('input');
    nativeColorPicker.type = 'color';
    nativeColorPicker.value = (realValue === 'none') ? '#FFFFFF' : triggerElement.value;
    nativeColorPicker.className = 'color-picker-native';

    nativePickerContainer.appendChild(nativeColorPicker);

    const paletteContainer = createColorPaletteModal(realValue, onChange, scope, triggerElement, allowNoFill);

    // Montar conteúdo
    content.appendChild(header);
    content.appendChild(nativePickerContainer);
    content.appendChild(paletteContainer);
    modal.appendChild(content);

    // Event listeners
    nativeColorPicker.oninput = (e) => {
        const color = e.target.value;
        // CORRIGIDO: Usar referência direta
        triggerElement.value = color;
        triggerElement.dataset.realValue = color;
        updateActivePaletteButton(paletteContainer, color);
        
        // Disparar onChange original
        const fakeEvent = { target: { value: color } };
        onChange(fakeEvent);
    };

    // Fechar modal
    const closeButton = header.querySelector('.color-picker-close');
    closeButton.onclick = () => closeColorModal(modal);

    // Fechar ao clicar fora
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeColorModal(modal);
        }
    };

    // Fechar com ESC
    const escListener = (e) => {
        if (e.key === 'Escape') {
            closeColorModal(modal);
            document.removeEventListener('keydown', escListener);
        }
    };
    document.addEventListener('keydown', escListener);

    // Adicionar ao DOM
    document.body.appendChild(modal);

    // Posicionar próximo ao trigger
    positionModal(modal, triggerElement);
}

/**
 * Cria palette de cores para o modal
 * CORRIGIDO: Recebe triggerElement como parâmetro
 */
function createColorPaletteModal(currentValue, onChange, scope, triggerElement, allowNoFill = false) {
    const paletteContainer = document.createElement('div');
    paletteContainer.className = 'color-palette-modal-container';

    // Label da palette
    const paletteLabel = document.createElement('div');
    paletteLabel.className = 'color-palette-label';
    paletteLabel.textContent = scope === 'project' ? 'Cores do projeto:' : 'Cores frequentes:';
    paletteContainer.appendChild(paletteLabel);

    // Grid de cores
    const paletteGrid = document.createElement('div');
    paletteGrid.className = 'color-palette-modal-grid';

    // Buscar cores frequentes
    const frequentColors = getFrequentColors(10, scope);

    if (frequentColors.length > 0) {
        frequentColors.forEach(({ color, count }) => {
            // CORRIGIDO: Passar triggerElement e onChange para button
            const colorButton = createModalColorButton(color, count, currentValue, onChange, triggerElement);
            paletteGrid.appendChild(colorButton);
        });
    } else {
        // Mensagem quando não há cores
        const noColorsMessage = document.createElement('div');
        noColorsMessage.className = 'color-palette-empty';
        noColorsMessage.textContent = 'Nenhuma cor usada ainda';
        paletteGrid.appendChild(noColorsMessage);
    }


    // Adicionar botão "Sem preenchimento" se allowNoFill for true
    if (allowNoFill) {
        const noFillButton = document.createElement('button');
        noFillButton.className = 'color-button-modal no-fill-button';
        noFillButton.title = 'Sem preenchimento';
        noFillButton.textContent = '∅';
        noFillButton.dataset.color = 'none';
        noFillButton.style.cssText = 'background: repeating-linear-gradient(45deg, #f0f0f0, #f0f0f0 10px, #e0e0e0 10px, #e0e0e0 20px); color: #999; font-weight: bold; font-size: 18px;';
        
        if (currentValue === 'none') {
            noFillButton.classList.add('active');
        }
        
        noFillButton.onclick = (e) => {
            e.preventDefault();
            triggerElement.value = '#000000'; // Valor dummy para o input color
            triggerElement.dataset.realValue = 'none';
            
            const paletteContainer = noFillButton.closest('.color-palette-modal-container');
            if (paletteContainer) {
                updateActivePaletteButton(paletteContainer, 'none');
            }
            
            const fakeEvent = { target: { value: 'none' } };
            onChange(fakeEvent);
            
            closeExistingColorModal();
        };
        
        paletteGrid.appendChild(noFillButton);
    }
    paletteContainer.appendChild(paletteGrid);
    return paletteContainer;
}

/**
 * Cria botão individual de cor para o modal
 * CORRIGIDO: Recebe triggerElement e onChange como parâmetros
 */
function createModalColorButton(color, count, currentValue, onChange, triggerElement) {
    const button = document.createElement('button');
    button.className = 'color-button-modal';
    button.style.backgroundColor = color;
    button.title = `${color} (usado ${count}x)`;
    button.dataset.color = color;

    // Estado ativo
    if (currentValue === color) {
        button.classList.add('active');
    }

    // CORRIGIDO: Click handler usa referência direta
    button.onclick = (e) => {
        e.preventDefault();
        
        // Atualizar trigger element diretamente
        triggerElement.value = color;
        triggerElement.dataset.realValue = color;

        // Atualizar native picker no modal
        const nativePicker = document.querySelector('.color-picker-native');
        if (nativePicker) {
            nativePicker.value = color;
        }

        // Atualizar palette visual
        const paletteContainer = button.closest('.color-palette-modal-container');
        if (paletteContainer) {
            updateActivePaletteButton(paletteContainer, color);
        }

        // Disparar onChange original
        const fakeEvent = { target: { value: color } };
        onChange(fakeEvent);

        // Fechar modal
        closeExistingColorModal();
    };

    return button;
}

/**
 * Atualiza botão ativo na palette
 */
function updateActivePaletteButton(container, selectedColor) {
    const buttons = container.querySelectorAll('.color-button-modal');
    buttons.forEach(button => {
        const buttonColor = button.dataset.color;
        button.classList.toggle('active', buttonColor === selectedColor);
    });
}

/**
 * Posiciona modal próximo ao elemento trigger
 */
function positionModal(modal, triggerElement) {
    const rect = triggerElement.getBoundingClientRect();
    const modalContent = modal.querySelector('.color-picker-modal-content');
    
    // PosiÃ§Ã£o inicial: abaixo do trigger, centralizado
    let top = rect.bottom + window.scrollY + 8;
    let left = rect.left + window.scrollX + (rect.width / 2);

    // Ajustar se sair da tela
    const modalRect = modalContent.getBoundingClientRect();
    
    // Ajustar horizontalmente
    if (left + modalRect.width > window.innerWidth) {
        left = window.innerWidth - modalRect.width - 20;
    }
    if (left < 20) {
        left = 20;
    }

    // Ajustar verticalmente (mostrar acima se não couber embaixo)
    if (top + modalRect.height > window.innerHeight + window.scrollY) {
        top = rect.top + window.scrollY - modalRect.height - 8;
    }

    modalContent.style.left = `${left}px`;
    modalContent.style.top = `${top}px`;
}

/**
 * Fecha modal de cor existente
 */
function closeExistingColorModal() {
    const existingModal = document.getElementById('color-picker-modal');
    if (existingModal) {
        closeColorModal(existingModal);
    }
}

/**
 * Fecha modal de cor específico
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
        initialPropertiesMap, // REQUIRED PARAMETER - captured at panel opening
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
    buttonContainer.append(saveButton)

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

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Descartar';
    discardButton.classList.add('tool-button', 'pure-material-tool-button-contained');
    discardButton.onclick = () => {
        control.discardChangeFeatures(selectedFeatures, initialPropertiesMap);
        selectionManager.deselectAllFeatures();
    };
    buttonContainer.append(discardButton);

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
 * Injeta CSS necessário para o color picker modal
 */
function injectColorPickerModalStyles() {
    if (document.getElementById('color-picker-modal-styles')) {
        return; // Já injetado
    }

    const style = document.createElement('style');
    style.id = 'color-picker-modal-styles';
    style.textContent = `
        /* Modal overlay */
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

        /* Modal content */
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

        /* Header */
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

        /* Native color picker */
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

        /* Palette container */
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

// Injetar estilos quando o módulo carrega
injectColorPickerModalStyles();