// Path: js/catalog/components/catalog-card.js

/**
 * @fileoverview Individual catalog card component.
 */

import {
    CATALOG_TYPE_CONFIG,
    DEFAULT_THUMBNAILS,
    CATALOG_UI_ICONS
} from '../catalog.constants.js';

/**
 * Creates an individual catalog card.
 * @param {Object} options
 * @param {CatalogItem} options.item - Catalog item
 * @param {Function} options.onClick - Click callback
 * @returns {HTMLElement}
 */
export function createCatalogCard({ item, onClick }) {
    const typeConfig = CATALOG_TYPE_CONFIG[item.type];

    const card = document.createElement('article');
    card.className = 'catalog-card';
    card.dataset.type = item.type;
    card.style.setProperty('--card-accent', typeConfig.color);

    // Thumbnail
    const thumbnailWrapper = document.createElement('div');
    thumbnailWrapper.className = 'catalog-card-thumbnail';

    const img = document.createElement('img');
    img.src = item.thumbnail;
    img.alt = item.name;
    img.loading = 'lazy';
    img.onerror = () => {
        img.src = DEFAULT_THUMBNAILS[item.type];
    };
    thumbnailWrapper.appendChild(img);

    // Type badge
    const badge = document.createElement('span');
    badge.className = 'catalog-card-badge';
    badge.innerHTML = `${typeConfig.icon}<span>${typeConfig.label}</span>`;
    thumbnailWrapper.appendChild(badge);

    card.appendChild(thumbnailWrapper);

    // Content
    const content = document.createElement('div');
    content.className = 'catalog-card-content';

    const name = document.createElement('h4');
    name.className = 'catalog-card-name';
    name.textContent = item.name;
    name.title = item.name;
    content.appendChild(name);

    if (item.description) {
        const desc = document.createElement('p');
        desc.className = 'catalog-card-description';
        desc.textContent = item.description;
        desc.title = item.description;
        content.appendChild(desc);
    }

    // Metadata (date)
    if (item.date) {
        const meta = document.createElement('div');
        meta.className = 'catalog-card-meta';
        meta.innerHTML = `
            ${CATALOG_UI_ICONS.CALENDAR}
            <span>${item.date}</span>
        `;
        content.appendChild(meta);
    }

    card.appendChild(content);

    // Footer with button
    const footer = document.createElement('div');
    footer.className = 'catalog-card-footer';

    const openBtn = document.createElement('button');
    openBtn.className = 'catalog-card-btn';
    openBtn.innerHTML = `
        <span>Abrir</span>
        ${CATALOG_UI_ICONS.CHEVRON_RIGHT}
    `;
    openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });

    footer.appendChild(openBtn);
    card.appendChild(footer);

    // Click on card also opens
    card.addEventListener('click', onClick);

    return card;
}
