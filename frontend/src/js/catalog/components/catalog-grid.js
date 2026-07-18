// Path: js/catalog/components/catalog-grid.js

/**
 * @fileoverview Catalog grid component.
 */

import { createCatalogCard } from './catalog-card.js';
import { CATALOG_UI_ICONS } from '../catalog.constants.js';

/**
 * Creates the catalog cards grid.
 * @param {Object} options
 * @param {CatalogItem[]} options.items - Items to display
 * @param {Function} options.onItemClick - Item click callback
 * @returns {HTMLElement}
 */
export function createCatalogGrid({ items, onItemClick, mapLocked = false, selectable = false, allowedIds, onToggle }) {
    const grid = document.createElement('div');
    grid.className = 'catalog-grid';

    if (items.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'catalog-empty';
        emptyState.innerHTML = `
            ${CATALOG_UI_ICONS.EMPTY}
            <p>Nenhum item encontrado</p>
        `;
        grid.appendChild(emptyState);
        return grid;
    }

    items.forEach(item => {
        const card = createCatalogCard({
            item,
            onClick: () => onItemClick?.(item),
            mapLocked,
            selectable,
            // allowedIds is a Set of the RAW (originalData) ids currently allowed in the atlas.
            selected: selectable ? !!allowedIds?.has(item.originalData?.id ?? item.id) : false,
            onToggle,
        });
        grid.appendChild(card);
    });

    return grid;
}
