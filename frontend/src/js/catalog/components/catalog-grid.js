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
export function createCatalogGrid({ items, onItemClick, mapLocked = false, selectable = false, allowedIds, onToggle, onShare, emptyNotice }) {
    const grid = document.createElement('div');
    grid.className = 'catalog-grid';

    if (items.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'catalog-empty';
        emptyState.dataset.testid = 'catalog-empty';
        // O ícone é SVG estático; a frase vem por `textContent` porque quem a compõe é
        // `catalogEmptyNotice`, e ela interpola rótulo de filtro. O default preserva o texto
        // de antes para os chamadores que não passam frase nenhuma (a aba de configuração do
        // atlas, que não tem filtro de acesso).
        emptyState.innerHTML = CATALOG_UI_ICONS.EMPTY;
        const frase = document.createElement('p');
        frase.textContent = String(emptyNotice ?? '').trim() || 'Nenhum item encontrado';
        emptyState.appendChild(frase);
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
            // Sem `onShare` o cartão não desenha a ação, então o modo de seleção
            // (aba "Catálogo" da configuração do atlas) fica sem ela por omissão:
            // lá o cartão é um interruptor, não um item que se abre ou se cede.
            onShare: selectable ? undefined : onShare,
        });
        grid.appendChild(card);
    });

    return grid;
}
