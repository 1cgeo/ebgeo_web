// Path: js/catalog/components/catalog-filters.js

/**
 * @fileoverview Catalog filters sidebar component.
 */

import { CATALOG_MODAL_FILTERS } from '../catalog.constants.js';

/**
 * Creates the filters sidebar with toggle buttons.
 * Only shows filters defined in CATALOG_MODAL_FILTERS.
 * @param {Object} options
 * @param {Object} options.types - Type configurations
 * @param {Set} options.activeFilters - Active filters
 * @param {Function} options.onFilterChange - Filter change callback
 * @returns {HTMLElement}
 */
export function createCatalogFilters({ types, activeFilters, onFilterChange }) {
    const sidebar = document.createElement('aside');
    sidebar.className = 'catalog-filters';

    const title = document.createElement('h3');
    title.className = 'catalog-filters-title';
    title.textContent = 'Filtrar por tipo';
    sidebar.appendChild(title);

    const filtersList = document.createElement('div');
    filtersList.className = 'catalog-filters-list';

    // Only show filters defined in CATALOG_MODAL_FILTERS
    CATALOG_MODAL_FILTERS.forEach(type => {
        const config = types[type];
        if (!config) return;

        const button = document.createElement('button');
        button.className = 'catalog-filter-btn';
        button.dataset.type = type;
        button.dataset.active = activeFilters.has(type) ? 'true' : 'false';
        button.style.setProperty('--filter-color', config.color);

        button.innerHTML = `
            <span class="filter-indicator"></span>
            <span class="filter-icon">${config.icon}</span>
            <span class="filter-label">${config.label}</span>
            <span class="filter-count" data-filter-count="${type}"></span>
        `;

        button.addEventListener('click', () => {
            const isActive = button.dataset.active === 'true';
            button.dataset.active = (!isActive).toString();
            onFilterChange(type, !isActive);
        });

        filtersList.appendChild(button);
    });

    sidebar.appendChild(filtersList);

    return sidebar;
}

/**
 * Updates the count badges on filter buttons.
 * @param {HTMLElement} filtersContainer - The filters sidebar element
 * @param {Object<string, number>} counts - Map of type to item count
 */
export function updateFilterCounts(filtersContainer, counts) {
    if (!filtersContainer) return;

    Object.entries(counts).forEach(([type, count]) => {
        const badge = filtersContainer.querySelector(`[data-filter-count="${type}"]`);
        if (badge) {
            badge.textContent = count;
        }
    });
}
