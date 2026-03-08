// Path: js/tool_manager/helpers/marker-symbol-picker.helpers.js

/**
 * @fileoverview Grid-based symbol picker for point markers.
 */

import {
    getAllSymbols,
    renderSymbolPreview,
} from '../../draw_tools/point_tool/point-marker-symbols.js';

/**
 * Create a marker symbol picker grid.
 * @param {Object} options
 * @param {string} options.value - Current symbol ID
 * @param {Function} options.onChange - Called with new symbol ID
 * @returns {HTMLElement} Picker container
 */
export function createMarkerSymbolPicker({ value, onChange }) {
    const container = document.createElement('div');
    container.className = 'marker-symbol-picker';

    const header = document.createElement('div');
    header.className = 'color-picker-circles-header';
    header.textContent = 'Ícone';
    container.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'marker-symbol-picker__grid';

    const symbols = getAllSymbols();
    let activeItem = null;

    for (const symbol of symbols) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'marker-symbol-picker__item';
        if (symbol.id === value) {
            item.classList.add('active');
            activeItem = item;
        }
        item.title = symbol.label;
        item.dataset.symbolId = symbol.id;

        const canvas = renderSymbolPreview(symbol.id, 32);
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

    return container;
}
