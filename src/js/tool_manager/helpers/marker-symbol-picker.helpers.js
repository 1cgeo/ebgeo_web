// Path: js/tool_manager/helpers/marker-symbol-picker.helpers.js

/**
 * @fileoverview Grid-based symbol picker for point markers, including a
 * "Personalizados" section for user-uploaded custom icons.
 */

import {
    getAllSymbols,
    renderSymbolPreview,
} from '../../draw_tools/point_tool/point-marker-symbols.js';
import {
    normalizeIconFile,
    customMarkerSymbol,
    parseCustomMarker,
} from '../../draw_tools/point_tool/point-custom-icons.js';
import { getCustomIcons, addCustomIcon } from '../../store';

/** File types accepted by the custom-icon upload input. */
const UPLOAD_ACCEPT = 'image/png,image/webp,image/gif,image/jpeg,image/svg+xml';

/**
 * Create a marker symbol picker grid.
 * @param {Object} options
 * @param {string} options.value - Current symbol ID (built-in id or 'custom:<id>')
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

    let activeItem = null;
    const setActive = (item) => {
        if (activeItem) activeItem.classList.remove('active');
        item.classList.add('active');
        activeItem = item;
    };

    // ----- Built-in symbols -----
    const grid = document.createElement('div');
    grid.className = 'marker-symbol-picker__grid';

    for (const symbol of getAllSymbols()) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'marker-symbol-picker__item';
        if (symbol.id === value) {
            item.classList.add('active');
            activeItem = item;
        }
        item.title = symbol.label;
        item.dataset.symbolId = symbol.id;
        item.appendChild(renderSymbolPreview(symbol.id, 32));

        item.addEventListener('click', () => {
            setActive(item);
            onChange(symbol.id);
        });

        grid.appendChild(item);
    }
    container.appendChild(grid);

    // ----- Custom (uploaded) icons -----
    const customHeader = document.createElement('div');
    customHeader.className = 'color-picker-circles-header';
    customHeader.textContent = 'Personalizados';
    container.appendChild(customHeader);

    const customGrid = document.createElement('div');
    customGrid.className = 'marker-symbol-picker__grid';
    container.appendChild(customGrid);

    // Insert a custom tile before the upload tile, tolerating the picker having
    // been detached/rebuilt during an async upload (avoids insertBefore throwing).
    const insertCustomTile = (tile) => {
        if (uploadTile.parentNode === customGrid) {
            customGrid.insertBefore(tile, uploadTile);
        } else {
            customGrid.appendChild(tile);
        }
    };

    const selectedIconId = parseCustomMarker(value);

    /**
     * Build a selectable tile for a stored custom icon.
     * @param {{id: string, name: string, thumbnail: string}} entry
     * @returns {HTMLElement}
     */
    const buildCustomTile = (entry) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'marker-symbol-picker__item';
        item.title = entry.name;
        item.dataset.symbolId = customMarkerSymbol(entry.id);

        const img = document.createElement('img');
        img.className = 'marker-symbol-picker__img';
        img.src = entry.thumbnail;
        img.alt = entry.name;
        item.appendChild(img);

        item.addEventListener('click', () => {
            setActive(item);
            onChange(customMarkerSymbol(entry.id));
        });

        if (entry.id === selectedIconId) {
            item.classList.add('active');
            activeItem = item;
        }
        return item;
    };

    // Upload tile ("+") — opens a hidden file input.
    const uploadTile = document.createElement('button');
    uploadTile.type = 'button';
    uploadTile.className = 'marker-symbol-picker__item marker-symbol-picker__item--upload';
    uploadTile.title = 'Carregar ícone personalizado';
    uploadTile.textContent = '+';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = UPLOAD_ACCEPT;
    fileInput.className = 'marker-symbol-picker__file-input';
    uploadTile.appendChild(fileInput);

    uploadTile.addEventListener('click', (e) => {
        if (e.target !== fileInput) fileInput.click();
    });

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;

        const normalized = await normalizeIconFile(file);
        if (!normalized) return;

        const entry = await addCustomIcon({
            name: file.name.replace(/\.[^.]+$/, ''),
            blob: normalized.blob,
            thumbnail: normalized.thumbnail,
            type: normalized.type,
        });

        const tile = buildCustomTile(entry);
        insertCustomTile(tile);
        setActive(tile);
        onChange(customMarkerSymbol(entry.id));
    });

    customGrid.appendChild(uploadTile);

    // Load existing custom icons asynchronously and prepend their tiles.
    getCustomIcons()
        .then((icons) => {
            for (const entry of icons) {
                insertCustomTile(buildCustomTile(entry));
            }
        })
        .catch((error) => console.warn('Failed to load custom icons:', error));

    return container;
}
