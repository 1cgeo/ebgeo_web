// Path: js/military_tools/military_symbol_tool/attributes/ui-components.helpers.js

/**
 * @fileoverview UI components for military symbol attributes modal.
 * Contains reusable components like digital combobox, color control and tabs.
 */

import { createModernToggle, createModernColorPicker } from '@tools';

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
    return { openDropdowns: [] };
}

/**
 * Closes all open dropdowns.
 * @param {DropdownState} state - Dropdown state
 */
export function closeAllDropdowns(state) {
    for (const dropdown of state.openDropdowns) {
        if (dropdown.style.display === 'block') {
            dropdown.style.display = 'none';
        }
    }
}

/**
 * Gets the best display text for an option.
 * @param {ComboBoxOption} option - Option object
 * @param {string} displayMode - Display mode ('modifier' or 'mainIcon')
 * @returns {string} Display text
 */
function getOptionDisplayText(option, displayMode) {
    if (option.entity_portugues) {
        if (displayMode === 'mainIcon') {
            return option.entity_subtype_portugues
                || option.entity_type_portugues
                || option.entity_portugues;
        }
        return option.entity_portugues;
    }
    return option.label;
}

/**
 * Gets the tooltip text for an option.
 * @param {ComboBoxOption} option - Option object
 * @returns {string} Tooltip text
 */
function getOptionTooltipText(option) {
    if (option.entity_portugues) {
        return option.entity_subtype_portugues
            || option.entity_type_portugues
            || option.entity_portugues;
    }
    return option.label;
}

/**
 * Gets the value for an option (normalizes value/code).
 * @param {ComboBoxOption} option - Option object
 * @returns {string} Option value
 */
function getOptionValue(option) {
    return option.value || option.code;
}

/**
 * Creates a digital combo box with search functionality.
 *
 * @param {ComboBoxOption[]} options - Available options
 * @param {string} currentValue - Current selected value
 * @param {Function} onChange - Callback when value changes
 * @param {string} label - Label text
 * @param {boolean} [_simplifiedDisplay=false] - Whether to use simplified display
 * @param {string} [displayMode='modifier'] - Display mode ('modifier' or 'mainIcon')
 * @param {boolean} [disableHoverPreview=false] - Whether to disable hover preview
 * @param {DropdownState} dropdownState - Shared dropdown state
 * @returns {HTMLElement} Container element with combobox
 */
export function createDigitalComboBox(options, currentValue, onChange, label, _simplifiedDisplay = false, displayMode = 'modifier', disableHoverPreview = false, dropdownState) {
    const container = document.createElement('div');
    container.className = 'digital-combo';

    const labelElement = document.createElement('label');
    labelElement.className = 'digital-combo__label';
    labelElement.textContent = label + ':';

    const selectContainer = document.createElement('div');
    selectContainer.className = 'digital-combo__select';

    const selectDisplay = document.createElement('div');
    selectDisplay.className = 'digital-combo__display';

    const textContainer = document.createElement('div');
    textContainer.className = 'digital-combo__display-text';
    selectDisplay.appendChild(textContainer);

    const dropdownIcon = document.createElement('span');
    dropdownIcon.className = 'digital-combo__arrow';
    dropdownIcon.textContent = '\u25BC';
    selectDisplay.appendChild(dropdownIcon);

    const dropdown = document.createElement('div');
    dropdown.className = 'digital-combo__dropdown';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'digital-combo__search';
    searchInput.placeholder = '\uD83D\uDD0D Digite para buscar...';

    const optionsList = document.createElement('div');
    optionsList.className = 'digital-combo__options';

    dropdown.appendChild(searchInput);
    dropdown.appendChild(optionsList);

    if (dropdownState) {
        dropdownState.openDropdowns.push(dropdown);
    }

    let filteredOptions = [...options];
    let highlightedIndex = -1;
    let optionElements = [];
    let internalCurrentValue = currentValue;

    // Set initial display
    const currentOption = options.find(opt => getOptionValue(opt) === internalCurrentValue);
    if (currentOption) {
        textContainer.textContent = getOptionDisplayText(currentOption, displayMode);
        textContainer.title = getOptionTooltipText(currentOption);
        highlightedIndex = options.indexOf(currentOption);
    }

    /**
     * Searches options by term.
     * @param {string} searchTerm - Search term
     * @returns {ComboBoxOption[]} Filtered options
     */
    function searchOptions(searchTerm) {
        if (!searchTerm.trim()) return options;

        const term = searchTerm.toLowerCase();
        return options.filter(option => {
            if (option.entity_portugues) {
                const searchText = [
                    option.entity_portugues,
                    option.entity_type_portugues,
                    option.entity_subtype_portugues
                ].filter(Boolean).join(' ').toLowerCase();
                return searchText.includes(term);
            }
            return option.label.toLowerCase().includes(term);
        });
    }

    /**
     * Updates highlight on option.
     * @param {number} index - Option index
     */
    function updateHighlight(index) {
        for (const el of optionElements) {
            el.classList.remove('digital-combo__option--highlighted');
        }

        if (index >= 0 && index < optionElements.length) {
            highlightedIndex = index;
            const highlightedElement = optionElements[index];
            highlightedElement.classList.add('digital-combo__option--highlighted');
            highlightedElement.scrollIntoView({ behavior: 'auto', block: 'nearest' });

            const highlightedOption = filteredOptions[index];
            if (highlightedOption) {
                textContainer.textContent = getOptionDisplayText(highlightedOption, displayMode);
                textContainer.title = getOptionTooltipText(highlightedOption);

                if (!disableHoverPreview) {
                    onChange(getOptionValue(highlightedOption), highlightedOption);
                }
            }
        }
    }

    /**
     * Selects an option.
     * @param {ComboBoxOption} option - Selected option
     */
    function selectOption(option) {
        const value = getOptionValue(option);
        textContainer.textContent = getOptionDisplayText(option, displayMode);
        textContainer.title = getOptionTooltipText(option);
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

        for (let index = 0; index < filteredOptions.length; index++) {
            const option = filteredOptions[index];
            const optionElement = document.createElement('div');
            optionElement.className = 'digital-combo__option';

            if (getOptionValue(option) === internalCurrentValue) {
                optionElement.classList.add('digital-combo__option--selected');
            }

            optionElement.textContent = getOptionDisplayText(option, displayMode);

            optionElement.onmouseenter = () => updateHighlight(index);
            optionElement.onclick = (e) => {
                e.stopPropagation();
                selectOption(option);
            };

            optionsList.appendChild(optionElement);
            optionElements.push(optionElement);
        }

        if (filteredOptions.length === 0) {
            const noResultElement = document.createElement('div');
            noResultElement.className = 'digital-combo__no-results';
            noResultElement.textContent = 'Nenhuma opção encontrada';
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
            getOptionValue(opt) === internalCurrentValue
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
        filteredOptions = searchOptions(e.target.value);
        renderOptions();
        highlightedIndex = -1;
    };

    searchInput.onkeydown = handleKeyDown;

    // Named handler so it can be removed in _cleanup
    function handleDocumentClick(e) {
        if (!container.contains(e.target) && !dropdown.contains(e.target)) {
            closeDropdown();
        }
    }
    document.addEventListener('click', handleDocumentClick);

    selectContainer.appendChild(selectDisplay);
    container.appendChild(labelElement);
    container.appendChild(selectContainer);

    document.body.appendChild(dropdown);

    // The dropdown lives on document.body (not inside `container`), so dropping the
    // container alone leaks both the node and the document listener. Every caller
    // that discards a combobox must call `_cleanup()`.
    container._cleanup = () => {
        document.removeEventListener('click', handleDocumentClick);
        dropdown.remove();
        if (dropdownState) {
            const index = dropdownState.openDropdowns.indexOf(dropdown);
            if (index !== -1) {
                dropdownState.openDropdowns.splice(index, 1);
            }
        }
    };

    container.updateValue = (newValue) => {
        internalCurrentValue = newValue;
        const option = options.find(opt => getOptionValue(opt) === newValue);
        if (option) {
            textContainer.textContent = getOptionDisplayText(option, displayMode);
            textContainer.title = getOptionTooltipText(option);
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
    labelElement.className = 'color-control__label';
    labelElement.textContent = label + ':';

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
    controlsContainer.className = 'color-control__picker-wrapper';

    const colorPickerContainer = createModernColorPicker({
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
        currentColorValue = color;
        if (color) {
            colorPickerContainer.classList.remove('color-control__picker--disabled');
        } else {
            colorPickerContainer.classList.add('color-control__picker--disabled');
        }
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
    button.className = 'symbol-selector-tabs__btn';
    button.textContent = text;

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
    container.className = 'symbol-selector-tabs';

    const tabButtonsContainer = document.createElement('div');
    tabButtonsContainer.className = 'symbol-selector-tabs__buttons';

    const simboloButton = createTabButton('Símbolo', true);
    const textoButton = createTabButton('Texto', false);
    const engajamentoButton = createTabButton('Barra de Engajamento', false);

    tabButtonsContainer.appendChild(simboloButton);
    tabButtonsContainer.appendChild(textoButton);
    tabButtonsContainer.appendChild(engajamentoButton);

    const tabContentWrapper = document.createElement('div');
    tabContentWrapper.className = 'symbol-selector-tabs__content';

    const simboloTab = document.createElement('div');
    simboloTab.className = 'symbol-selector-tabs__panel--simbolo';

    const textoTab = document.createElement('div');
    textoTab.className = 'symbol-selector-tabs__panel--texto';

    const engajamentoTab = document.createElement('div');
    engajamentoTab.className = 'symbol-selector-tabs__panel--engajamento';

    tabContentWrapper.appendChild(simboloTab);
    tabContentWrapper.appendChild(textoTab);
    tabContentWrapper.appendChild(engajamentoTab);

    container.appendChild(tabButtonsContainer);
    container.appendChild(tabContentWrapper);

    const tabButtons = {
        simbolo: simboloButton,
        texto: textoButton,
        engajamento: engajamentoButton
    };

    const tabs = {
        simbolo: simboloTab,
        texto: textoTab,
        engajamento: engajamentoTab
    };

    // Attach tabs reference to tabButtons for switchTab function
    tabButtons._tabs = tabs;

    return { container, simboloTab, textoTab, engajamentoTab, tabButtons, tabs };
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

    const TAB_NAMES = ['simbolo', 'texto', 'engajamento'];
    const DISPLAY_MODES = { simbolo: 'grid', texto: 'block', engajamento: 'block' };

    // Hide all tabs and deactivate all buttons
    for (const name of TAB_NAMES) {
        tabs[name].style.display = 'none';
        tabButtons[name].classList.remove('active');
    }

    // Show selected tab and activate button
    tabs[tabName].style.display = DISPLAY_MODES[tabName];
    tabButtons[tabName].classList.add('active');
}
