// Path: js/tool_manager/helpers/marker-symbol-picker.helpers.js

/**
 * @fileoverview Grid-based symbol picker for point markers.
 */

import {
    getSymbolCategories,
    renderSymbolPreview,
} from '../../draw_tools/point_tool/point-marker-symbols.js';

/**
 * Create a marker symbol picker grid.
 * @param {Object} options
 * @param {string} options.value - Current symbol ID
 * @param {string} [options.color='#3f4fb5'] - Fill color for previews
 * @param {Function} options.onChange - Called with new symbol ID
 * @returns {HTMLElement} Picker container
 */
export function createMarkerSymbolPicker({ value, color = '#3f4fb5', onChange }) {
    const container = document.createElement('div');
    container.className = 'marker-symbol-picker';

    const label = document.createElement('div');
    label.className = 'marker-symbol-picker__label';
    label.textContent = 'Símbolo';
    container.appendChild(label);

    const categories = getSymbolCategories();
    let activeItem = null;

    for (const category of categories) {
        const catLabel = document.createElement('div');
        catLabel.className = 'marker-symbol-picker__cat-label';
        catLabel.textContent = category.label;
        container.appendChild(catLabel);

        const grid = document.createElement('div');
        grid.className = 'marker-symbol-picker__grid';

        for (const symbol of category.symbols) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'marker-symbol-picker__item';
            if (symbol.id === value) {
                item.classList.add('active');
                activeItem = item;
            }
            item.title = symbol.label;
            item.dataset.symbolId = symbol.id;

            const canvas = renderSymbolPreview(symbol.id, 24, color);
            item.appendChild(canvas);

            item.addEventListener('click', () => {
                if (activeItem) activeItem.classList.remove('active');
                item.classList.add('active');
                activeItem = item;
                onChange(symbol.id);
            });

            grid.appendChild(item);
        }

        container.appendChild(grid);
    }

    return container;
}
