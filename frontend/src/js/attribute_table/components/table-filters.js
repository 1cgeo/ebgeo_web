// Path: js/attribute_table/components/table-filters.js

/**
 * @fileoverview Filter bar component for the attribute table.
 */

import { ATTRIBUTE_TABLE, ATTRIBUTE_TABLE_ICONS } from '../attribute-table.constants.js';
import { FEATURE_DISPLAY_NAMES } from '@store';

/**
 * @typedef {Object} FilterState
 * @property {string} search - Search query
 * @property {Set<string>} types - Active type filters
 * @property {boolean} selectedOnly - Show selected only toggle
 */

/**
 * Creates the filter bar element.
 * @param {Object} options - Filter options
 * @param {string[]} options.availableTypes - Feature types available in the layer
 * @param {FilterState} options.initialState - Initial filter state
 * @param {Function} options.onFilterChange - Callback when filters change
 * @returns {HTMLElement} Filters container element (should replace existing)
 */
export function createFiltersBar(options) {
    const { availableTypes = [], initialState = {}, onFilterChange } = options;

    const filters = document.createElement('div');
    filters.className = ATTRIBUTE_TABLE.CSS_CLASSES.FILTERS;

    // Search input
    const searchContainer = createSearchInput(initialState.search || '', (value) => {
        if (onFilterChange) {
            onFilterChange({ search: value });
        }
    });
    filters.appendChild(searchContainer);

    // Type chips
    if (availableTypes.length > 0) {
        const typeChips = createTypeChips(
            availableTypes,
            initialState.types || new Set(),
            (types) => {
                if (onFilterChange) {
                    onFilterChange({ types });
                }
            }
        );
        filters.appendChild(typeChips);
    }

    // Selected only toggle
    const selectedToggle = createSelectedToggle(initialState.selectedOnly || false, (value) => {
        if (onFilterChange) {
            onFilterChange({ selectedOnly: value });
        }
    });
    filters.appendChild(selectedToggle);

    return filters;
}

/**
 * Creates the search input component.
 * @param {string} initialValue - Initial search value
 * @param {Function} onChange - Change callback (debounced)
 * @returns {HTMLElement} Search container element
 */
function createSearchInput(initialValue, onChange) {
    const container = document.createElement('div');
    container.className = 'attribute-table-search';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'attribute-table-search-input';
    input.placeholder = 'Buscar...';
    input.value = initialValue;

    // Clear button
    const clearBtn = document.createElement('button');
    clearBtn.className = 'attribute-table-search-clear';
    clearBtn.innerHTML = ATTRIBUTE_TABLE_ICONS.CLEAR;
    clearBtn.title = 'Limpar busca';
    clearBtn.classList.toggle('attribute-table-search-clear--hidden', !initialValue);

    // Debounce timer
    let debounceTimer = null;

    input.addEventListener('input', () => {
        clearBtn.classList.toggle('attribute-table-search-clear--hidden', !input.value);

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            onChange(input.value);
        }, ATTRIBUTE_TABLE.DEBOUNCE_MS);
    });

    clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        input.value = '';
        clearBtn.classList.add('attribute-table-search-clear--hidden');
        clearTimeout(debounceTimer);
        onChange('');
        input.focus();
    });

    container.appendChild(input);
    container.appendChild(clearBtn);

    return container;
}

/**
 * Creates the type filter chips.
 * @param {string[]} types - Available feature types
 * @param {Set<string>} activeTypes - Currently active types
 * @param {Function} onChange - Change callback
 * @returns {HTMLElement} Type chips container
 */
function createTypeChips(types, activeTypes, onChange) {
    const container = document.createElement('div');
    container.className = 'attribute-table-type-chips';

    // If no active types, all are shown (active)
    const allActive = activeTypes.size === 0;

    types.forEach((type) => {
        const chip = document.createElement('button');
        chip.className = 'attribute-table-type-chip';
        chip.dataset.type = type;

        const isActive = allActive || activeTypes.has(type);
        if (isActive) {
            chip.classList.add('active');
        }

        // Get display name
        const displayName = FEATURE_DISPLAY_NAMES[type] || type;
        chip.textContent = displayName;
        chip.title = displayName;

        chip.addEventListener('click', (e) => {
            e.stopPropagation();

            // Get current state of all chips
            const chips = container.querySelectorAll('.attribute-table-type-chip');
            const currentActive = new Set();

            chips.forEach((c) => {
                if (c.classList.contains('active')) {
                    currentActive.add(c.dataset.type);
                }
            });

            // If all are active and we click one, make only that one active
            const allCurrentlyActive = currentActive.size === types.length;

            if (allCurrentlyActive) {
                // Switch to only this type
                chips.forEach((c) => c.classList.remove('active'));
                chip.classList.add('active');
                onChange(new Set([type]));
            } else if (currentActive.has(type)) {
                // Toggle off this type
                chip.classList.remove('active');
                currentActive.delete(type);

                // If none left, activate all
                if (currentActive.size === 0) {
                    chips.forEach((c) => c.classList.add('active'));
                    onChange(new Set()); // Empty means all
                } else {
                    onChange(currentActive);
                }
            } else {
                // Toggle on this type
                chip.classList.add('active');
                currentActive.add(type);

                // If all now active, treat as "all"
                if (currentActive.size === types.length) {
                    onChange(new Set()); // Empty means all
                } else {
                    onChange(currentActive);
                }
            }
        });

        container.appendChild(chip);
    });

    return container;
}

/**
 * Creates the "selected only" toggle.
 * @param {boolean} initialValue - Initial toggle value
 * @param {Function} onChange - Change callback
 * @returns {HTMLElement} Toggle container
 */
function createSelectedToggle(initialValue, onChange) {
    const label = document.createElement('label');
    label.className = 'attribute-table-selected-toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = initialValue;

    const text = document.createElement('span');
    text.textContent = 'Apenas selecionadas';

    checkbox.addEventListener('change', () => {
        onChange(checkbox.checked);
    });

    label.appendChild(checkbox);
    label.appendChild(text);

    return label;
}

