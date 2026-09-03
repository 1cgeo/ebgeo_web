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

    // Esta lista define ORDEM, nunca pertinencia. Ela ja foi escrita SEM acento enquanto
    // as categorias do catalogo tinham acento, e o casamento exato descartava 61 dos 77
    // pontos em silencio: o combobox mostrava 16. Por isso categoria que nao esteja aqui
    // vai para o fim, em ordem alfabetica, e nunca some.
    const categoryOrder = [
        'Gerais',
        'Movimento e Manobra',
        'Passagens',
        'Fogos',
        'Proteção - Obstáculos',
        'Proteção - Fortificação',
        'Proteção - Minas',
        'Proteção - QBRN',
        'Logística',
        'Controle Aéreo',
        'Controle Marítimo'
    ];

    const categorias = [
        ...categoryOrder.filter(c => grouped[c]),
        ...Object.keys(grouped).filter(c => !categoryOrder.includes(c)).sort()
    ];

    categorias.forEach(category => {
        grouped[category].forEach(point => {
            options.push({
                value: point.code,
                label: `${point.label} (${category})`,
                iconCode: point.code,
                isEchelon: false
            });
        });
    });

    options.push({
        value: 'ECHELON',
        label: 'Escalão (requer subtipo)',
        iconCode: null,
        isEchelon: true,
        defaultEchelonCode: 'ECHELON_16'
    });
    options.push({
        value: 'ECHELON_FT',
        label: 'Escalão Força-Tarefa (requer subtipo)',
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
 * Positions dropdown relative to its trigger element.
 * @param {HTMLElement} dropdown - Dropdown element
 * @param {HTMLElement} trigger - Trigger element
 */
function positionDropdown(dropdown, trigger) {
    const rect = trigger.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + 5) + 'px';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.width = rect.width + 'px';
}

/**
 * Creates cleanup function for a combo box.
 * @param {HTMLElement} dropdown - Dropdown element
 * @param {Function} closeHandler - Document click handler
 * @param {DropdownState} dropdownState - Dropdown state manager
 * @returns {Function} Cleanup function
 */
function createComboCleanup(dropdown, closeHandler, dropdownState) {
    return () => {
        document.removeEventListener('click', closeHandler);
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
export function createDigitalComboBoxWithThumbnails(options, currentValue, onChange, label, generateThumbnail, dropdownState, onPreview) {
    const container = document.createElement('div');
    container.className = 'coord-combo';

    const labelElement = document.createElement('label');
    labelElement.textContent = label + ':';
    labelElement.className = 'coord-combo__label';

    const selectContainer = document.createElement('div');
    selectContainer.className = 'coord-combo__select-wrapper';

    const selectDisplay = document.createElement('div');
    selectDisplay.className = 'coord-combo__display';

    const displayContent = document.createElement('div');
    displayContent.className = 'coord-combo__display-content';

    const displayThumbnail = document.createElement('img');
    displayThumbnail.className = 'coord-combo__display-thumbnail';

    const displayText = document.createElement('span');
    displayText.className = 'coord-combo__display-text';

    displayContent.appendChild(displayThumbnail);
    displayContent.appendChild(displayText);
    selectDisplay.appendChild(displayContent);

    const dropdownIcon = document.createElement('span');
    dropdownIcon.textContent = '\u25BC';
    dropdownIcon.className = 'coord-combo__arrow';
    selectDisplay.appendChild(dropdownIcon);

    const dropdown = document.createElement('div');
    dropdown.className = 'coord-combo__dropdown';

    if (dropdownState) {
        registerDropdown(dropdownState, dropdown);
    }

    // Busca. So aparece quando a lista e longa o bastante para justificar: o seletor de
    // ponto tem 80 opcoes, o de subtipo de escalao tem 13, e um campo de busca sobre treze
    // itens e ruido. O mesmo gesto ja existe no military_symbol_tool.
    const LIMIAR_BUSCA = 20;
    const temBusca = options.length > LIMIAR_BUSCA;

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'coord-combo__search';
    searchInput.placeholder = '\uD83D\uDD0D Digite para buscar...';
    // Sem isto o ouvinte de clique no document fecharia o dropdown ao clicar no campo.
    searchInput.onclick = (e) => e.stopPropagation();

    const optionsWrap = document.createElement('div');
    optionsWrap.className = 'coord-combo__options';

    const semResultado = document.createElement('div');
    semResultado.className = 'coord-combo__no-results';
    semResultado.textContent = 'Nenhuma opção encontrada';
    semResultado.style.display = 'none';

    if (temBusca) {
        dropdown.appendChild(searchInput);
    }
    dropdown.appendChild(optionsWrap);
    dropdown.appendChild(semResultado);

    const itens = [];

    // Sair do dropdown desfaz a previa e devolve o desenho do valor realmente escolhido.
    dropdown.onmouseleave = () => {
        if (onPreview) onPreview(null);
    };

    /**
     * Normaliza para busca: caixa baixa e SEM acento, para "protecao" achar "Proteção".
     * @param {string} t - Texto
     * @returns {string} Texto normalizado
     */
    function normalizar(t) {
        return String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    /**
     * Mostra so os itens que casam com o termo. Filtra ESCONDENDO, nunca recriando, para
     * as miniaturas ja carregadas nao serem perdidas a cada tecla.
     * @param {string} termo - Termo de busca
     */
    function aplicarFiltro(termo) {
        const t = normalizar(termo).trim();
        let visiveis = 0;
        for (const it of itens) {
            const casa = !t || normalizar(it.option.label).includes(t);
            it.el.style.display = casa ? '' : 'none';
            if (casa) visiveis++;
        }
        semResultado.style.display = visiveis === 0 ? 'block' : 'none';
    }

    let internalCurrentValue = currentValue;

    function closeDropdown() {
        dropdown.style.display = 'none';
        selectDisplay.classList.remove('coord-combo__display--open');
        if (onPreview) onPreview(null);
    }

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
        optionElement.className = 'coord-combo__option';
        if (option.value === currentValue) {
            optionElement.classList.add('coord-combo__option--selected');
        }

        const optionThumbnail = document.createElement('img');
        optionThumbnail.className = 'coord-combo__option-thumbnail';

        const optionText = document.createElement('span');
        optionText.textContent = option.label;
        optionText.className = 'coord-combo__option-text';

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

        optionElement.onmouseenter = () => {
            optionElement.style.backgroundColor = '#f8f9fa';
            // Passar o mouse MOSTRA, so o clique escolhe: onPreview nao toca no estado.
            if (onPreview) onPreview(option.value);
        };
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

            dropdown.querySelectorAll('.coord-combo__option').forEach(div => {
                div.classList.remove('coord-combo__option--selected');
                div.style.backgroundColor = 'transparent';
            });
            optionElement.classList.add('coord-combo__option--selected');
            optionElement.style.backgroundColor = '#e9ecef';
        };

        optionsWrap.appendChild(optionElement);
        itens.push({ option, el: optionElement });
    });

    /**
     * Teclado sobre a lista visivel: Enter escolhe a primeira, Escape fecha.
     * @param {KeyboardEvent} e - Evento
     */
    searchInput.onkeydown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeDropdown();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            const primeiro = itens.find(it => it.el.style.display !== 'none');
            if (primeiro) primeiro.el.click();
        }
    };

    searchInput.oninput = (e) => aplicarFiltro(e.target.value);

    selectDisplay.onclick = (e) => {
        e.stopPropagation();
        const isOpen = dropdown.style.display === 'block';
        if (dropdownState) {
            closeAllDropdowns(dropdownState);
        }

        if (!isOpen) {
            positionDropdown(dropdown, selectDisplay);
            dropdown.style.display = 'block';
            selectDisplay.classList.add('coord-combo__display--open');
            if (temBusca) {
                searchInput.value = '';
                aplicarFiltro('');
                setTimeout(() => searchInput.focus(), 50);
            }
        } else {
            dropdown.style.display = 'none';
            selectDisplay.classList.remove('coord-combo__display--open');
        }
    };

    container._cleanup = createComboCleanup(dropdown, closeDropdown, dropdownState);

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
    container.className = 'coord-combo';

    const labelElement = document.createElement('label');
    labelElement.textContent = label + ':';
    labelElement.className = 'coord-combo__label';

    const selectContainer = document.createElement('div');
    selectContainer.className = 'coord-combo__select-wrapper';

    const selectDisplay = document.createElement('div');
    selectDisplay.className = 'coord-combo__display';

    const textContainer = document.createElement('div');
    textContainer.className = 'coord-combo__display-text--simple';
    selectDisplay.appendChild(textContainer);

    const dropdownIcon = document.createElement('span');
    dropdownIcon.textContent = '\u25BC';
    dropdownIcon.className = 'coord-combo__arrow';
    selectDisplay.appendChild(dropdownIcon);

    const dropdown = document.createElement('div');
    dropdown.className = 'coord-combo__dropdown coord-combo__dropdown--simple';

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
        item.className = 'coord-combo__option';
        if (option.value === currentValue) {
            item.classList.add('coord-combo__option--selected');
        }

        item.textContent = option.label;

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
            positionDropdown(dropdown, selectDisplay);
            dropdown.style.display = 'block';
            selectDisplay.classList.add('coord-combo__display--open');
        } else {
            dropdown.style.display = 'none';
            selectDisplay.classList.remove('coord-combo__display--open');
        }
    };

    const closeDropdown = () => {
        dropdown.style.display = 'none';
        selectDisplay.classList.remove('coord-combo__display--open');
    };

    container._cleanup = createComboCleanup(dropdown, closeDropdown, dropdownState);

    document.addEventListener('click', closeDropdown);

    updateDisplay();

    container.appendChild(labelElement);
    selectContainer.appendChild(selectDisplay);
    document.body.appendChild(dropdown);
    container.appendChild(selectContainer);

    return container;
}
