// Path: js/military_tools/coordination_measure_tool/attributes/ui-components.helpers.js

/**
 * @fileoverview UI components helpers for coordination measure attributes.
 * Contains reusable components like digital combobox with thumbnails and utilities.
 */

import { COORDINATION_POINTS_CATALOG } from '../coordination_points_catalog.js';
import { UI_DATA } from '../coordination_measure_constants.js';

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
 * Registers a dropdown for management.
 * @param {DropdownState} state - Dropdown state
 * @param {HTMLElement} dropdown - Dropdown element
 */
export function registerDropdown(state, dropdown) {
    state.openDropdowns.push(dropdown);
}

/**
 * Checks if point code is an echelon type.
 * @param {string} pointCode - Point code to check
 * @returns {boolean}
 */
export function isEchelonPointCode(pointCode) {
    if (!pointCode) return false;
    return pointCode === 'ECHELON' ||
        pointCode === 'ECHELON_FT' ||
        pointCode.startsWith('ECHELON_');
}

/**
 * Gets point label from code.
 * @param {string} pointCode - Point code
 * @returns {string} Point label
 */
export function getPointLabel(pointCode) {
    if (!pointCode) return 'Nao definido';

    const pointData = COORDINATION_POINTS_CATALOG[pointCode];
    if (pointData) {
        return pointData.name || pointData.label || pointCode;
    }

    const uiPoint = UI_DATA.pointsList.find(p => p.code === pointCode);
    if (uiPoint) {
        return uiPoint.label;
    }

    const echelon = UI_DATA.echelonSubtypes.find(e => e.code === pointCode);
    if (echelon) {
        return echelon.label;
    }

    const echelonFT = UI_DATA.echelonFTSubtypes.find(e => e.code === pointCode);
    if (echelonFT) {
        return echelonFT.label;
    }

    return pointCode;
}

/**
 * Clears all text modifiers from properties.
 * @param {Object} properties - Properties object to clear
 */
export function clearAllTextModifiers(properties) {
    const modifiers = [
        'tipo', 'identificacao', 'gdhIni', 'gdhFim', 'numero',
        'classeSuprimento', 'status', 'numeroConcentracao', 'altitude'
    ];
    modifiers.forEach(mod => {
        properties[mod] = null;
    });
}

/**
 * Gets grouped options for point type combo box.
 * @returns {Array} Grouped options array
 */
export function getPointsGroupedOptions() {
    const options = [];

    const grouped = {};
    UI_DATA.pointsList.forEach(point => {
        const category = point.category || 'Outros';
        if (!grouped[category]) grouped[category] = [];
        grouped[category].push(point);
    });

    const categoryOrder = [
        'Gerais',
        'Movimento e Manobra',
        'Passagens',
        'Fogos',
        'Protecao - Obstaculos',
        'Protecao - Fortificacao',
        'Protecao - Minas',
        'Protecao - QBRN',
        'Logistica',
        'Controle Aereo',
        'Controle Maritimo'
    ];

    categoryOrder.forEach(category => {
        if (grouped[category]) {
            grouped[category].forEach(point => {
                options.push({
                    value: point.code,
                    label: `${point.label} (${category})`,
                    iconCode: point.code,
                    isEchelon: false
                });
            });
        }
    });

    options.push({
        value: 'ECHELON',
        label: 'Escalao (requer subtipo)',
        iconCode: null,
        isEchelon: true,
        defaultEchelonCode: 'ECHELON_16'
    });
    options.push({
        value: 'ECHELON_FT',
        label: 'Escalao Forca-Tarefa (requer subtipo)',
        iconCode: null,
        isEchelon: true,
        defaultEchelonCode: 'ECHELON_FT_16'
    });

    return options;
}

/**
 * Gets echelon subtype options.
 * @param {string} echelonType - Echelon type (ECHELON or ECHELON_FT)
 * @returns {Array} Subtype options array
 */
export function getEchelonSubtypeOptions(echelonType) {
    const subtypes = echelonType === 'ECHELON_FT'
        ? UI_DATA.echelonFTSubtypes
        : UI_DATA.echelonSubtypes;

    return subtypes.map(st => ({
        value: st.code,
        label: st.label,
        iconCode: st.code
    }));
}

/**
 * Creates a digital combo box with thumbnail previews.
 * @param {Array} options - Array of option objects
 * @param {string} currentValue - Current selected value
 * @param {Function} onChange - Callback when value changes
 * @param {string} label - Label text
 * @param {Function} generateThumbnail - Function to generate thumbnails
 * @param {DropdownState} dropdownState - Dropdown state manager
 * @returns {HTMLElement} Combo box container
 */
export function createDigitalComboBoxWithThumbnails(options, currentValue, onChange, label, generateThumbnail, dropdownState) {
    const container = document.createElement('div');
    container.style.cssText = 'margin-bottom: 20px; position: relative;';

    const labelElement = document.createElement('label');
    labelElement.textContent = label + ':';
    labelElement.style.cssText = `
        display: block;
        margin-bottom: 8px;
        font-weight: bold;
        font-size: 15px;
        color: #333;
    `;

    const selectContainer = document.createElement('div');
    selectContainer.style.cssText = 'position: relative;';

    const selectDisplay = document.createElement('div');
    selectDisplay.style.cssText = `
        width: 100%;
        padding: 15px 40px 15px 15px;
        border: 2px solid #ddd;
        border-radius: 8px;
        font-size: 15px;
        background: #fff;
        cursor: pointer;
        transition: border-color 0.2s;
        box-sizing: border-box;
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 50px;
    `;

    const displayContent = document.createElement('div');
    displayContent.style.cssText = 'display: flex; align-items: center; gap: 10px; flex: 1;';

    const displayThumbnail = document.createElement('img');
    displayThumbnail.style.cssText = `
        width: 30px;
        height: 30px;
        object-fit: contain;
        flex-shrink: 0;
    `;

    const displayText = document.createElement('span');
    displayText.style.cssText = 'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

    displayContent.appendChild(displayThumbnail);
    displayContent.appendChild(displayText);
    selectDisplay.appendChild(displayContent);

    const dropdownIcon = document.createElement('span');
    dropdownIcon.innerHTML = '\u25BC';
    dropdownIcon.style.cssText = `
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 15px;
        pointer-events: none;
        color: #000;
    `;
    selectDisplay.appendChild(dropdownIcon);

    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
        position: fixed;
        max-height: 400px;
        overflow-y: auto;
        background: white;
        border: 2px solid #ddd;
        border-radius: 8px;
        z-index: 10001;
        display: none;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        min-width: 300px;
    `;

    if (dropdownState) {
        registerDropdown(dropdownState, dropdown);
    }

    let internalCurrentValue = currentValue;

    async function updateDisplay(value) {
        const selected = options.find(opt => opt.value === value);
        if (selected) {
            displayText.textContent = selected.label;

            if (selected.iconCode && generateThumbnail) {
                const thumbnailUrl = await generateThumbnail(
                    selected.iconCode,
                    selected.defaultEchelonCode
                );

                if (thumbnailUrl) {
                    displayThumbnail.src = thumbnailUrl;
                    displayThumbnail.style.display = 'block';
                } else {
                    displayThumbnail.style.display = 'none';
                }
            } else {
                displayThumbnail.style.display = 'none';
            }
        } else {
            displayText.textContent = 'Selecione...';
            displayThumbnail.style.display = 'none';
        }
    }

    options.forEach(option => {
        const optionElement = document.createElement('div');
        optionElement.style.cssText = `
            padding: 12px 15px;
            cursor: pointer;
            font-size: 14px;
            transition: background-color 0.2s;
            border-bottom: 1px solid #f0f0f0;
            display: flex;
            align-items: center;
            gap: 10px;
        `;

        const optionThumbnail = document.createElement('img');
        optionThumbnail.style.cssText = `
            width: 25px;
            height: 25px;
            object-fit: contain;
            flex-shrink: 0;
        `;

        const optionText = document.createElement('span');
        optionText.textContent = option.label;
        optionText.style.cssText = 'flex: 1;';

        if (option.iconCode && generateThumbnail) {
            generateThumbnail(option.iconCode, option.defaultEchelonCode)
                .then(thumbnailUrl => {
                    if (thumbnailUrl) {
                        optionThumbnail.src = thumbnailUrl;
                        optionElement.insertBefore(optionThumbnail, optionText);
                    }
                });
        }

        optionElement.appendChild(optionText);

        if (option.value === currentValue) {
            optionElement.style.backgroundColor = '#e9ecef';
        }

        optionElement.onmouseenter = () => { optionElement.style.backgroundColor = '#f8f9fa'; };
        optionElement.onmouseleave = () => {
            optionElement.style.backgroundColor = option.value === internalCurrentValue ? '#e9ecef' : 'transparent';
        };

        optionElement.onclick = () => {
            internalCurrentValue = option.value;
            updateDisplay(option.value);
            onChange(option.value);
            if (dropdownState) {
                closeAllDropdowns(dropdownState);
            }

            dropdown.querySelectorAll('div').forEach(div => {
                div.style.backgroundColor = 'transparent';
            });
            optionElement.style.backgroundColor = '#e9ecef';
        };

        dropdown.appendChild(optionElement);
    });

    selectDisplay.onclick = (e) => {
        e.stopPropagation();
        const isOpen = dropdown.style.display === 'block';
        if (dropdownState) {
            closeAllDropdowns(dropdownState);
        }

        if (!isOpen) {
            const rect = selectDisplay.getBoundingClientRect();
            dropdown.style.top = (rect.bottom + 5) + 'px';
            dropdown.style.left = rect.left + 'px';
            dropdown.style.width = rect.width + 'px';
            dropdown.style.display = 'block';
            selectDisplay.style.borderColor = '#007bff';
        } else {
            dropdown.style.display = 'none';
            selectDisplay.style.borderColor = '#ddd';
        }
    };

    const closeDropdown = () => {
        dropdown.style.display = 'none';
        selectDisplay.style.borderColor = '#ddd';
    };

    container._cleanup = () => {
        document.removeEventListener('click', closeDropdown);
        if (dropdownState) {
            const index = dropdownState.openDropdowns.indexOf(dropdown);
            if (index > -1) {
                dropdownState.openDropdowns.splice(index, 1);
            }
        }
        if (dropdown.parentNode) {
            dropdown.parentNode.removeChild(dropdown);
        }
    };

    document.addEventListener('click', closeDropdown);

    selectContainer.appendChild(selectDisplay);
    document.body.appendChild(dropdown);
    container.appendChild(labelElement);
    container.appendChild(selectContainer);

    updateDisplay(currentValue);

    return container;
}

/**
 * Creates a digital combo box (simple version without thumbnails).
 * @param {Array} options - Array of option objects
 * @param {string} currentValue - Current selected value
 * @param {Function} onChange - Callback when value changes
 * @param {string} label - Label text
 * @param {DropdownState} dropdownState - Dropdown state manager
 * @returns {HTMLElement} Combo box container
 */
export function createDigitalComboBox(options, currentValue, onChange, label, dropdownState) {
    const container = document.createElement('div');
    container.style.cssText = 'margin-bottom: 20px; position: relative;';

    const labelElement = document.createElement('label');
    labelElement.textContent = label + ':';
    labelElement.style.cssText = `
        display: block;
        margin-bottom: 8px;
        font-weight: bold;
        font-size: 15px;
        color: #333;
    `;

    const selectContainer = document.createElement('div');
    selectContainer.style.cssText = 'position: relative;';

    const selectDisplay = document.createElement('div');
    selectDisplay.style.cssText = `
        width: 100%;
        padding: 15px 40px 15px 15px;
        border: 2px solid #ddd;
        border-radius: 8px;
        font-size: 15px;
        background: #fff;
        cursor: pointer;
        transition: border-color 0.2s;
        box-sizing: border-box;
        position: relative;
        min-height: 50px;
        display: flex;
        align-items: center;
    `;

    const textContainer = document.createElement('div');
    textContainer.style.cssText = `
        flex: 1;
        overflow: hidden;
        word-wrap: break-word;
        pointer-events: none;
    `;
    selectDisplay.appendChild(textContainer);

    const dropdownIcon = document.createElement('span');
    dropdownIcon.innerHTML = '\u25BC';
    dropdownIcon.style.cssText = `
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 15px;
        pointer-events: none;
        color: #000;
    `;
    selectDisplay.appendChild(dropdownIcon);

    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
        position: fixed;
        max-height: 300px;
        overflow-y: auto;
        background: white;
        border: 2px solid #ddd;
        border-radius: 8px;
        z-index: 10001;
        display: none;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        min-width: 200px;
    `;

    if (dropdownState) {
        registerDropdown(dropdownState, dropdown);
    }

    let internalCurrentValue = currentValue;

    function updateDisplay() {
        const selected = options.find(opt => opt.value === internalCurrentValue);
        textContainer.textContent = selected ? selected.label : 'Selecione...';
    }

    options.forEach(option => {
        const item = document.createElement('div');
        item.style.cssText = `
            padding: 12px 15px;
            cursor: pointer;
            font-size: 14px;
            transition: background-color 0.2s;
            border-bottom: 1px solid #f0f0f0;
        `;

        item.textContent = option.label;

        if (option.value === currentValue) {
            item.style.backgroundColor = '#e9ecef';
        }

        item.onmouseenter = () => { item.style.backgroundColor = '#f8f9fa'; };
        item.onmouseleave = () => {
            item.style.backgroundColor = option.value === internalCurrentValue ? '#e9ecef' : 'white';
        };

        item.onclick = () => {
            internalCurrentValue = option.value;
            updateDisplay();
            if (dropdownState) {
                closeAllDropdowns(dropdownState);
            }
            onChange(option.value);
        };

        dropdown.appendChild(item);
    });

    selectDisplay.onclick = (e) => {
        e.stopPropagation();
        const isOpen = dropdown.style.display === 'block';
        if (dropdownState) {
            closeAllDropdowns(dropdownState);
        }

        if (!isOpen) {
            const rect = selectDisplay.getBoundingClientRect();
            dropdown.style.top = (rect.bottom + 5) + 'px';
            dropdown.style.left = rect.left + 'px';
            dropdown.style.width = rect.width + 'px';
            dropdown.style.display = 'block';
            selectDisplay.style.borderColor = '#007bff';
        } else {
            dropdown.style.display = 'none';
            selectDisplay.style.borderColor = '#ddd';
        }
    };

    const closeDropdown = () => {
        dropdown.style.display = 'none';
        selectDisplay.style.borderColor = '#ddd';
    };

    container._cleanup = () => {
        document.removeEventListener('click', closeDropdown);
        if (dropdownState) {
            const index = dropdownState.openDropdowns.indexOf(dropdown);
            if (index > -1) {
                dropdownState.openDropdowns.splice(index, 1);
            }
        }
        if (dropdown.parentNode) {
            dropdown.parentNode.removeChild(dropdown);
        }
    };

    document.addEventListener('click', closeDropdown);

    updateDisplay();

    container.appendChild(labelElement);
    selectContainer.appendChild(selectDisplay);
    document.body.appendChild(dropdown);
    container.appendChild(selectContainer);

    return container;
}
