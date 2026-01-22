// Path: js/catalog/components/catalog-header.js

/**
 * @fileoverview Catalog header component with search bar.
 */

import { CATALOG_UI_ICONS } from '../catalog.constants.js';

/**
 * Creates the catalog header with search bar.
 * @param {Object} options
 * @param {Function} options.onSearch - Search callback
 * @returns {HTMLElement}
 */
export function createCatalogHeader({ onSearch }) {
    const header = document.createElement('div');
    header.className = 'catalog-header';

    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'catalog-search-wrapper';

    const searchIcon = document.createElement('span');
    searchIcon.className = 'catalog-search-icon';
    searchIcon.innerHTML = CATALOG_UI_ICONS.SEARCH;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'catalog-search-input';
    input.placeholder = 'Buscar por nome ou descricao...';

    let debounceTimer;
    input.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            onSearch(e.target.value);
        }, 200);
    });

    searchWrapper.appendChild(searchIcon);
    searchWrapper.appendChild(input);
    header.appendChild(searchWrapper);

    return header;
}
