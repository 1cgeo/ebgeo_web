// Path: js/tool_manager/helpers/color-picker.helpers.js

/**
 * @fileoverview Modern color picker components for attribute panels.
 */

import { getFrequentColors } from '../../store';

/**
 * Preset colors palette for quick selection.
 */
const PRESET_COLORS = [
    '#FF0000', '#FF5722', '#FF9800', '#FFC107', '#FFEB3B',
    '#4CAF50', '#2196F3', '#3F51B5', '#9C27B0', '#E91E63',
    '#000000', '#424242', '#757575', '#9E9E9E', '#FFFFFF',
    '#8B0000', '#006400', '#00008B', '#4B0082', '#8B4513',
];

/**
 * SVG icons used in the color picker.
 */
const ICONS = {
    chevronDown: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>',
    check: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
};

/**
 * Creates a modern color picker with dropdown palette.
 *
 * @param {Object} config - Configuration object
 * @param {string} config.label - Label text for the color picker
 * @param {string} config.value - Initial color value (hex)
 * @param {Function} config.onChange - Callback when color changes (receives color string)
 * @param {string} [config.scope='current'] - Color scope for frequent colors
 * @returns {HTMLElement} Color picker container element
 */
export function createModernColorPicker(config) {
    const { label, value, onChange, scope = 'current' } = config;
    let currentColor = value || '#000000';
    let isOpen = false;
    let dropdown = null;

    const container = document.createElement('div');
    container.className = 'attr-modern-color-picker';

    const labelEl = document.createElement('label');
    labelEl.className = 'attr-modern-color-picker-label';
    labelEl.textContent = label;

    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'attr-modern-color-picker-trigger';

    const preview = document.createElement('div');
    preview.className = 'attr-modern-color-preview';
    preview.style.backgroundColor = currentColor;

    const hexText = document.createElement('span');
    hexText.className = 'attr-modern-color-hex';
    hexText.textContent = currentColor.toUpperCase();

    const chevron = document.createElement('span');
    chevron.className = 'attr-modern-color-chevron';
    chevron.innerHTML = ICONS.chevronDown;

    trigger.appendChild(preview);
    trigger.appendChild(hexText);
    trigger.appendChild(chevron);

    const updateColor = (color) => {
        currentColor = color;
        preview.style.backgroundColor = color;
        hexText.textContent = color.toUpperCase();
        onChange(color);
    };

    const closeDropdown = () => {
        if (dropdown && dropdown.parentNode) {
            dropdown.remove();
            dropdown = null;
        }
        isOpen = false;
    };

    const openDropdown = () => {
        if (isOpen) {
            closeDropdown();
            return;
        }

        isOpen = true;
        dropdown = createColorDropdown(currentColor, updateColor, closeDropdown, scope);
        wrapper.appendChild(dropdown);

        // Close on click outside
        const handleClickOutside = (e) => {
            if (!wrapper.contains(e.target)) {
                closeDropdown();
                document.removeEventListener('mousedown', handleClickOutside);
            }
        };
        setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 0);
    };

    trigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDropdown();
    });

    wrapper.appendChild(trigger);
    container.appendChild(labelEl);
    container.appendChild(wrapper);

    return container;
}

/**
 * Creates the color dropdown panel.
 *
 * @param {string} currentColor - Currently selected color
 * @param {Function} onSelect - Callback when color is selected
 * @param {Function} onClose - Callback to close dropdown
 * @param {string} scope - Color scope for frequent colors
 * @returns {HTMLElement} Dropdown element
 */
function createColorDropdown(currentColor, onSelect, onClose, scope) {
    const dropdown = document.createElement('div');
    dropdown.className = 'attr-modern-color-dropdown';

    // Frequent colors section
    const frequentSection = document.createElement('div');
    frequentSection.style.marginBottom = '12px';

    const frequentTitle = document.createElement('div');
    frequentTitle.className = 'attr-modern-color-section-title';
    frequentTitle.textContent = 'Cores Frequentes';
    frequentSection.appendChild(frequentTitle);

    const frequentGrid = document.createElement('div');
    frequentGrid.className = 'attr-modern-color-grid';

    // Get frequent colors or use presets
    const frequentColors = getFrequentColors(20, scope);
    const colorsToShow = frequentColors.length > 0
        ? frequentColors.map(c => c.color)
        : PRESET_COLORS;

    colorsToShow.forEach((color) => {
        const swatch = createColorSwatch(color, currentColor, (selectedColor) => {
            onSelect(selectedColor);
            onClose();
        });
        frequentGrid.appendChild(swatch);
    });

    frequentSection.appendChild(frequentGrid);
    dropdown.appendChild(frequentSection);

    // Custom color section
    const customSection = document.createElement('div');
    customSection.className = 'attr-modern-color-custom';

    const customTitle = document.createElement('div');
    customTitle.className = 'attr-modern-color-section-title';
    customTitle.textContent = 'Cor Personalizada';
    customTitle.style.marginBottom = '8px';

    const customRow = document.createElement('div');
    customRow.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const nativeInput = document.createElement('input');
    nativeInput.type = 'color';
    nativeInput.value = currentColor;
    nativeInput.className = 'attr-modern-color-native';

    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = currentColor.toUpperCase();
    textInput.className = 'attr-modern-color-text-input';
    textInput.placeholder = '#000000';

    nativeInput.addEventListener('input', (e) => {
        const color = e.target.value;
        textInput.value = color.toUpperCase();
        onSelect(color);
        updateSwatchSelection(frequentGrid, color);
    });

    textInput.addEventListener('input', (e) => {
        let val = e.target.value;
        if (!val.startsWith('#')) {
            val = '#' + val;
        }
        if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
            nativeInput.value = val;
            onSelect(val);
            updateSwatchSelection(frequentGrid, val);
        }
    });

    textInput.addEventListener('blur', (e) => {
        const val = e.target.value;
        if (!/^#[0-9A-Fa-f]{6}$/.test(val)) {
            textInput.value = currentColor.toUpperCase();
        }
    });

    customRow.appendChild(nativeInput);
    customRow.appendChild(textInput);

    const customWrapper = document.createElement('div');
    customWrapper.style.cssText = 'padding-top: 12px; border-top: 1px solid #f3f4f6;';
    customWrapper.appendChild(customTitle);
    customWrapper.appendChild(customRow);

    dropdown.appendChild(customWrapper);

    return dropdown;
}

/**
 * Creates a single color swatch button.
 *
 * @param {string} color - Swatch color
 * @param {string} currentColor - Currently selected color
 * @param {Function} onSelect - Callback when swatch is clicked
 * @returns {HTMLElement} Swatch button element
 */
function createColorSwatch(color, currentColor, onSelect) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'attr-modern-color-swatch';
    swatch.style.backgroundColor = color;
    swatch.dataset.color = color;
    swatch.title = color;

    if (color.toUpperCase() === currentColor.toUpperCase()) {
        swatch.classList.add('selected');
    }

    // Check icon for selected state
    if (swatch.classList.contains('selected')) {
        const checkIcon = document.createElement('span');
        checkIcon.innerHTML = ICONS.check;
        checkIcon.style.color = isLightColor(color) ? '#333' : '#fff';
        swatch.appendChild(checkIcon);
    }

    swatch.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect(color);
    });

    return swatch;
}

/**
 * Updates swatch selection in grid.
 *
 * @param {HTMLElement} grid - Grid container
 * @param {string} selectedColor - Selected color
 */
function updateSwatchSelection(grid, selectedColor) {
    const swatches = grid.querySelectorAll('.attr-modern-color-swatch');
    swatches.forEach(swatch => {
        const swatchColor = swatch.dataset.color;
        const isSelected = swatchColor.toUpperCase() === selectedColor.toUpperCase();
        swatch.classList.toggle('selected', isSelected);

        // Update check icon
        const existingCheck = swatch.querySelector('span');
        if (existingCheck) {
            existingCheck.remove();
        }
        if (isSelected) {
            const checkIcon = document.createElement('span');
            checkIcon.innerHTML = ICONS.check;
            checkIcon.style.color = isLightColor(swatchColor) ? '#333' : '#fff';
            swatch.appendChild(checkIcon);
        }
    });
}

/**
 * Determines if a color is light (for contrast purposes).
 *
 * @param {string} color - Hex color
 * @returns {boolean} True if color is light
 */
function isLightColor(color) {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5;
}
