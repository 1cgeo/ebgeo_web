// Path: js/military_tools/military_symbol_tool/attributes/ui-components.helpers.js

/**
 * @fileoverview UI components for military symbol attributes modal.
 * Contains reusable components like digital combobox, color control and tabs.
 */

import { createModernToggle, createModernColorPicker } from '../../../tool_manager';

/**
 * @typedef {Object} ComboBoxOption
 * @property {string} [value] - Option value
 * @property {string} [code] - Option code (alternative to value)
 * @property {string} [label] - Option label
 * @property {string} [entity_portugues] - Portuguese entity name
 * @property {string} [entity_type_portugues] - Portuguese entity type
 * @property {string} [entity_subtype_portugues] - Portuguese entity subtype
 * @property {number} [extension] - Extension value
 */

/**
 * @typedef {Object} DropdownState
 * @property {HTMLElement[]} openDropdowns - Array of open dropdown elements
 */

/**
 * Creates the dropdown state manager.
 * @returns {DropdownState} Dropdown state object
 */
export function createDropdownState() {
    return {
        openDropdowns: []
    };
}

/**
 * Closes all open dropdowns.
 * @param {DropdownState} state - Dropdown state
 */
export function closeAllDropdowns(state) {
    state.openDropdowns.forEach(dropdown => {
        if (dropdown.style.display === 'block') {
            dropdown.style.display = 'none';
        }
    });
}

/**
 * Creates a digital combo box with search functionality.
 *
 * @param {ComboBoxOption[]} options - Available options
 * @param {string} currentValue - Current selected value
 * @param {Function} onChange - Callback when value changes
 * @param {string} label - Label text
 * @param {boolean} [simplifiedDisplay=false] - Whether to use simplified display
 * @param {string} [displayMode='modifier'] - Display mode ('modifier' or 'mainIcon')
 * @param {boolean} [disableHoverPreview=false] - Whether to disable hover preview
 * @param {DropdownState} dropdownState - Shared dropdown state
 * @returns {HTMLElement} Container element with combobox
 */
export function createDigitalComboBox(options, currentValue, onChange, label, _simplifiedDisplay = false, displayMode = 'modifier', disableHoverPreview = false, dropdownState) {
    const container = document.createElement('div');
    container.className = 'digital-combo-container';
    container.style.cssText = 'margin-bottom: 12px; position: relative;';

    const labelElement = document.createElement('label');
    labelElement.textContent = label + ':';
    labelElement.style.cssText = 'display: block; margin-bottom: 6px; font-weight: 600; font-size: 14px; color: #333;';

    const selectContainer = document.createElement('div');
    selectContainer.style.cssText = 'position: relative;';

    const selectDisplay = document.createElement('div');
    selectDisplay.style.cssText = `
        width: 100%;
        padding: 10px 36px 10px 12px;
        border: 2px solid #ddd;
        border-radius: 6px;
        font-size: 14px;
        background: #fff;
        cursor: pointer;
        transition: border-color 0.2s;
        box-sizing: border-box;
        position: relative;
    `;

    const textContainer = document.createElement('div');
    textContainer.style.cssText = `
        flex: 1;
        overflow: hidden;
        word-wrap: break-word;
        hyphens: auto;
        pointer-events: none;
    `;
    selectDisplay.appendChild(textContainer);

    const dropdownIcon = document.createElement('span');
    dropdownIcon.innerHTML = '\u25BC';
    dropdownIcon.style.cssText = `
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 12px;
        pointer-events: none;
        color: #000;
    `;
    selectDisplay.appendChild(dropdownIcon);

    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
        position: fixed;
        background: white;
        border: 2px solid #007bff;
        border-radius: 8px;
        max-height: 250px;
        overflow: hidden;
        z-index: 20000;
        display: none;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    `;

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '\uD83D\uDD0D Digite para buscar...';
    searchInput.style.cssText = `
        width: 100%;
        padding: 10px 15px;
        border: none;
        border-bottom: 2px solid #e9ecef;
        font-size: 14px;
        outline: none;
        box-sizing: border-box;
        background: #f8f9fa;
    `;

    const optionsList = document.createElement('div');
    optionsList.style.cssText = 'max-height: 200px; overflow-y: auto;';

    dropdown.appendChild(searchInput);
    dropdown.appendChild(optionsList);

    if (dropdownState) {
        dropdownState.openDropdowns.push(dropdown);
    }

    let filteredOptions = [...options];
    let highlightedIndex = -1;
    let optionElements = [];
    let internalCurrentValue = currentValue;

    /**
     * Gets option display text based on mode.
     * @param {ComboBoxOption} option - Option object
     * @returns {string} Display text
     */
    function getOptionDisplayText(option) {
        if (option.entity_portugues) {
            if (displayMode === 'mainIcon') {
                if (option.entity_subtype_portugues) {
                    return option.entity_subtype_portugues;
                } else if (option.entity_type_portugues) {
                    return option.entity_type_portugues;
                } else {
                    return option.entity_portugues;
                }
            } else {
                return option.entity_portugues;
            }
        }
        return option.label;
    }

    /**
     * Gets option tooltip text.
     * @param {ComboBoxOption} option - Option object
     * @returns {string} Tooltip text
     */
    function getOptionTooltipText(option) {
        if (option.entity_portugues) {
            if (option.entity_subtype_portugues) {
                return option.entity_subtype_portugues;
            } else if (option.entity_type_portugues) {
                return option.entity_type_portugues;
            } else {
                return option.entity_portugues;
            }
        }
        return option.label;
    }

    const currentOption = options.find(opt => opt.value === internalCurrentValue || opt.code === internalCurrentValue);
    if (currentOption) {
        const displayText = getOptionDisplayText(currentOption);
        const tooltipText = getOptionTooltipText(currentOption);

        textContainer.textContent = displayText;
        textContainer.title = tooltipText;

        highlightedIndex = options.findIndex(opt => opt.value === internalCurrentValue || opt.code === internalCurrentValue);
    }

    /**
     * Searches options by term.
     * @param {string} searchTerm - Search term
     * @returns {ComboBoxOption[]} Filtered options
     */
    function searchOptions(searchTerm) {
        if (!searchTerm.trim()) {
            return options;
        }

        const term = searchTerm.toLowerCase();
        return options.filter(option => {
            if (option.entity_portugues) {
                const searchText = [
                    option.entity_portugues,
                    option.entity_type_portugues,
                    option.entity_subtype_portugues
                ].filter(Boolean).join(' ').toLowerCase();
                return searchText.includes(term);
            } else {
                return option.label.toLowerCase().includes(term);
            }
        });
    }

    /**
     * Updates highlight on option.
     * @param {number} index - Option index
     */
    function updateHighlight(index) {
        optionElements.forEach(el => {
            el.style.backgroundColor = '';
            el.style.fontWeight = '';
            el.classList.remove('highlighted');
        });

        if (index >= 0 && index < optionElements.length) {
            highlightedIndex = index;
            const highlightedElement = optionElements[index];

            highlightedElement.style.backgroundColor = '#e3f2fd';
            highlightedElement.style.fontWeight = '600';
            highlightedElement.classList.add('highlighted');

            highlightedElement.scrollIntoView({
                behavior: 'auto',
                block: 'nearest'
            });

            const highlightedOption = filteredOptions[index];
            if (highlightedOption) {
                const value = highlightedOption.value || highlightedOption.code;

                const displayText = getOptionDisplayText(highlightedOption);
                const tooltipText = getOptionTooltipText(highlightedOption);
                textContainer.textContent = displayText;
                textContainer.title = tooltipText;

                if (!disableHoverPreview) {
                    onChange(value, highlightedOption);
                }
            }
        }
    }

    /**
     * Selects an option.
     * @param {ComboBoxOption} option - Selected option
     */
    function selectOption(option) {
        const value = option.value || option.code;
        const displayText = getOptionDisplayText(option);
        const tooltipText = getOptionTooltipText(option);

        textContainer.textContent = displayText;
        textContainer.title = tooltipText;
        internalCurrentValue = value;
        closeDropdown();

        onChange(value, option);
    }

    /**
     * Renders options list.
     */
    function renderOptions() {
        optionsList.innerHTML = '';
        optionElements = [];

        filteredOptions.forEach((option, index) => {
            const optionElement = document.createElement('div');
            optionElement.style.cssText = `
                padding: 12px 15px;
                cursor: pointer;
                font-size: 14px;
                transition: background-color 0.1s;
                color: #333;
                user-select: none;
            `;

            const displayText = getOptionDisplayText(option);
            optionElement.textContent = displayText;

            const value = option.value || option.code;
            if (value === internalCurrentValue) {
                optionElement.style.backgroundColor = '#e3f2fd';
                optionElement.style.fontWeight = '600';
            }

            optionElement.onmouseenter = () => {
                updateHighlight(index);
            };

            optionElement.onclick = (e) => {
                e.stopPropagation();
                selectOption(option);
            };

            optionsList.appendChild(optionElement);
            optionElements.push(optionElement);
        });

        if (filteredOptions.length === 0) {
            const noResultElement = document.createElement('div');
            noResultElement.textContent = 'Nenhuma opção encontrada';
            noResultElement.style.cssText = `
                padding: 12px 15px;
                font-size: 14px;
                color: #999;
                font-style: italic;
                text-align: center;
            `;
            optionsList.appendChild(noResultElement);
        }
    }

    /**
     * Opens the dropdown.
     */
    function openDropdown() {
        if (dropdownState) {
            closeAllDropdowns(dropdownState);
        }

        const rect = selectDisplay.getBoundingClientRect();
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.top = `${rect.bottom + 5}px`;
        dropdown.style.width = `${rect.width}px`;
        dropdown.style.display = 'block';

        searchInput.value = '';
        filteredOptions = [...options];
        renderOptions();

        setTimeout(() => searchInput.focus(), 50);

        highlightedIndex = filteredOptions.findIndex(opt =>
            (opt.value || opt.code) === internalCurrentValue
        );
    }

    /**
     * Closes the dropdown.
     */
    function closeDropdown() {
        dropdown.style.display = 'none';
    }

    /**
     * Handles keyboard navigation.
     * @param {KeyboardEvent} e - Keyboard event
     */
    function handleKeyDown(e) {
        if (dropdown.style.display !== 'block') return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                e.stopPropagation();
                if (highlightedIndex < filteredOptions.length - 1) {
                    updateHighlight(highlightedIndex + 1);
                }
                break;

            case 'ArrowUp':
                e.preventDefault();
                e.stopPropagation();
                if (highlightedIndex > 0) {
                    updateHighlight(highlightedIndex - 1);
                }
                break;

            case 'Enter':
                e.preventDefault();
                e.stopPropagation();
                if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
                    selectOption(filteredOptions[highlightedIndex]);
                }
                break;

            case 'Escape':
                e.preventDefault();
                e.stopPropagation();
                closeDropdown();
                break;

            case 'Tab':
                closeDropdown();
                break;
        }
    }

    selectDisplay.onclick = (e) => {
        e.stopPropagation();
        if (dropdown.style.display === 'block') {
            closeDropdown();
        } else {
            openDropdown();
        }
    };

    searchInput.oninput = (e) => {
        const searchTerm = e.target.value;
        filteredOptions = searchOptions(searchTerm);
        renderOptions();
        highlightedIndex = -1;
    };

    searchInput.onkeydown = handleKeyDown;

    document.addEventListener('click', (e) => {
        if (!container.contains(e.target) && !dropdown.contains(e.target)) {
            closeDropdown();
        }
    });

    selectContainer.appendChild(selectDisplay);
    container.appendChild(labelElement);
    container.appendChild(selectContainer);

    document.body.appendChild(dropdown);

    container._cleanup = () => {
        if (dropdown.parentNode) {
            dropdown.parentNode.removeChild(dropdown);
        }
    };

    container.updateValue = (newValue) => {
        internalCurrentValue = newValue;
        const option = options.find(opt => (opt.value || opt.code) === newValue);
        if (option) {
            const displayText = getOptionDisplayText(option);
            const tooltipText = getOptionTooltipText(option);
            textContainer.textContent = displayText;
            textContainer.title = tooltipText;
        }
    };

    return container;
}

/**
 * Creates a color control with enable/disable toggle.
 *
 * @param {string|null} currentValue - Current color value or null for default
 * @param {Function} onChange - Callback when color changes
 * @param {string} label - Label text
 * @returns {HTMLElement} Container element with color control
 */
export function createColorControl(currentValue, onChange, label) {
    const container = document.createElement('div');
    container.className = 'color-control-container';

    const labelElement = document.createElement('label');
    labelElement.textContent = label + ':';
    labelElement.style.cssText = 'display: block; margin-bottom: 6px; font-weight: 600; font-size: 14px; color: #333;';

    let colorPickerContainer = null;
    let currentColorValue = currentValue;

    const toggle = createModernToggle({
        label: 'Usar cor personalizada',
        checked: !!currentValue,
        onChange: (isEnabled) => {
            if (isEnabled) {
                const color = currentColorValue || '#11FF00';
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
            currentColorValue = color;
            onChange(color);
        }
    });

    /**
     * Updates color control state.
     * @param {string|null} color - Color value
     */
    function updateColorControlState(color) {
        const isCustomColor = !!color;
        currentColorValue = color;
        colorPickerContainer.style.opacity = isCustomColor ? '1' : '0.5';
        colorPickerContainer.style.pointerEvents = isCustomColor ? 'auto' : 'none';
    }

    updateColorControlState(currentValue);

    controlsContainer.appendChild(colorPickerContainer);

    container.appendChild(labelElement);
    container.appendChild(toggle);
    container.appendChild(controlsContainer);

    container.updateValue = (newValue) => {
        updateColorControlState(newValue);
    };

    return container;
}

/**
 * Creates a tab button element.
 *
 * @param {string} text - Button text
 * @param {boolean} [active=false] - Whether button is active
 * @returns {HTMLElement} Button element
 */
export function createTabButton(text, active = false) {
    const button = document.createElement('button');
    button.textContent = text;
    button.style.cssText = `
        flex: 1;
        padding: 12px 20px;
        border: none;
        border-radius: 8px 8px 0 0;
        font-size: 15px;
        font-weight: ${active ? 'bold' : 'normal'};
        cursor: pointer;
        transition: all 0.2s;
        background: ${active ? '#508d4e' : '#f5f5f5'};
        color: ${active ? 'white' : '#333'};
    `;

    if (active) {
        button.classList.add('active');
    }

    return button;
}

/**
 * @typedef {Object} TabsContainerResult
 * @property {HTMLElement} container - Main container element
 * @property {HTMLElement} simboloTab - Symbol tab content element
 * @property {HTMLElement} textoTab - Text tab content element
 * @property {HTMLElement} engajamentoTab - Engagement bar tab content element
 * @property {Object} tabButtons - Tab button elements
 * @property {Object} tabs - Tab content elements reference
 */

/**
 * Creates tabs container with Symbol, Text and Engagement tabs.
 *
 * @returns {TabsContainerResult} Container with tab elements
 */
export function createTabsContainer() {
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; flex-direction: column; height: 100%;';

    const tabButtonsContainer = document.createElement('div');
    tabButtonsContainer.style.cssText = 'display: flex; gap: 5px; flex-shrink: 0;';

    const simboloButton = createTabButton('Símbolo', true);
    const textoButton = createTabButton('Texto', false);
    const engajamentoButton = createTabButton('Barra de Engajamento', false);

    tabButtonsContainer.appendChild(simboloButton);
    tabButtonsContainer.appendChild(textoButton);
    tabButtonsContainer.appendChild(engajamentoButton);

    // Scrollable content wrapper
    const tabContentWrapper = document.createElement('div');
    tabContentWrapper.style.cssText = 'flex: 1; overflow-y: auto; overflow-x: hidden;';

    const simboloTab = document.createElement('div');
    simboloTab.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 30px; width: 100%; padding: 16px 0;';

    const textoTab = document.createElement('div');
    textoTab.style.cssText = 'display: none;';

    const engajamentoTab = document.createElement('div');
    engajamentoTab.style.cssText = 'display: none; padding: 16px 0;';

    tabContentWrapper.appendChild(simboloTab);
    tabContentWrapper.appendChild(textoTab);
    tabContentWrapper.appendChild(engajamentoTab);

    container.appendChild(tabButtonsContainer);
    container.appendChild(tabContentWrapper);

    // Store tab references in the buttons object for switchTab to use
    const tabButtons = {
        simbolo: simboloButton,
        texto: textoButton,
        engajamento: engajamentoButton
    };

    // Store tab content references
    const tabs = {
        simbolo: simboloTab,
        texto: textoTab,
        engajamento: engajamentoTab
    };

    // Attach tabs reference to tabButtons for switchTab function
    tabButtons._tabs = tabs;

    return {
        container,
        simboloTab,
        textoTab,
        engajamentoTab,
        tabButtons,
        tabs
    };
}

/**
 * Switches between tabs.
 *
 * @param {string} tabName - Tab name ('simbolo', 'texto' or 'engajamento')
 * @param {Object} tabButtons - Tab button elements (with _tabs reference)
 */
export function switchTab(tabName, tabButtons) {
    const tabs = tabButtons._tabs;
    if (!tabs) {
        console.warn('switchTab: tabs reference not found in tabButtons');
        return;
    }

    const { simbolo: simboloTab, texto: textoTab, engajamento: engajamentoTab } = tabs;
    const { simbolo: simboloButton, texto: textoButton, engajamento: engajamentoButton } = tabButtons;

    // Hide all tabs
    simboloTab.style.display = 'none';
    textoTab.style.display = 'none';
    engajamentoTab.style.display = 'none';

    // Reset all buttons
    simboloButton.style.background = '#f5f5f5';
    simboloButton.style.color = '#333';
    simboloButton.style.fontWeight = 'normal';
    simboloButton.classList.remove('active');

    textoButton.style.background = '#f5f5f5';
    textoButton.style.color = '#333';
    textoButton.style.fontWeight = 'normal';
    textoButton.classList.remove('active');

    engajamentoButton.style.background = '#f5f5f5';
    engajamentoButton.style.color = '#333';
    engajamentoButton.style.fontWeight = 'normal';
    engajamentoButton.classList.remove('active');

    // Show selected tab and activate button
    if (tabName === 'simbolo') {
        simboloTab.style.display = 'grid';
        simboloButton.style.background = '#508d4e';
        simboloButton.style.color = 'white';
        simboloButton.style.fontWeight = 'bold';
        simboloButton.classList.add('active');
    } else if (tabName === 'texto') {
        textoTab.style.display = 'block';
        textoButton.style.background = '#508d4e';
        textoButton.style.color = 'white';
        textoButton.style.fontWeight = 'bold';
        textoButton.classList.add('active');
    } else if (tabName === 'engajamento') {
        engajamentoTab.style.display = 'block';
        engajamentoButton.style.background = '#508d4e';
        engajamentoButton.style.color = 'white';
        engajamentoButton.style.fontWeight = 'bold';
        engajamentoButton.classList.add('active');
    }
}
