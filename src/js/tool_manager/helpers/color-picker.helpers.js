// Path: js/tool_manager/helpers/color-picker.helpers.js

/**
 * @fileoverview Color picker components for attribute panels.
 */

import { getFrequentColors } from '../../store';

/**
 * Creates a color picker that opens enhanced modal on click.
 *
 * @param {string} value - Initial color value (hex)
 * @param {Function} onChange - Callback when color changes
 * @param {string} [title] - Tooltip title
 * @param {string} [scope='current'] - Color scope ('current' or 'project')
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
 * Opens advanced color picker modal.
 *
 * @param {HTMLElement} triggerElement - Element that triggered the modal
 * @param {Function} onChange - Callback when color changes
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
 * Creates color palette for modal.
 *
 * @param {string} currentValue - Currently selected color
 * @param {Function} onChange - Callback when color changes
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
 * Creates individual color button for modal.
 *
 * @param {string} color - Button color
 * @param {number} count - Usage count
 * @param {string} currentValue - Currently selected color
 * @param {Function} onChange - Callback when clicked
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
 * Updates active button in palette.
 *
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
 * Positions modal near trigger element.
 *
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
 * Closes existing color modal.
 */
function closeExistingColorModal() {
    const existingModal = document.getElementById('color-picker-modal');
    if (existingModal) {
        closeColorModal(existingModal);
    }
}

/**
 * Closes specific color modal.
 *
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

/**
 * Injects required CSS for color picker modal.
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

// Inject styles on module load
injectColorPickerModalStyles();
