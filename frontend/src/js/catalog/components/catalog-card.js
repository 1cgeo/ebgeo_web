// Path: js/catalog/components/catalog-card.js

/**
 * @fileoverview Individual catalog card component.
 */

import { escapeHtml } from '@utils/html-escape.js';
import {
    CATALOG_ITEM_TYPES,
    CATALOG_TYPE_CONFIG,
    DEFAULT_THUMBNAILS,
    CATALOG_UI_ICONS
} from '../catalog.constants.js';

/** Icons used in catalog card */
const { CALENDAR, MAP_PIN, CHEVRON_RIGHT } = CATALOG_UI_ICONS;

/**
 * Creates an individual catalog card.
 * @param {Object} options
 * @param {CatalogItem} options.item - Catalog item
 * @param {Function} options.onClick - Click callback
 * @returns {HTMLElement}
 */
export function createCatalogCard({ item, onClick, mapLocked = false, selectable = false, selected = false, onToggle }) {
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

    // Metadata (date and/or local)
    if (item.date || item.local) {
        const meta = document.createElement('div');
        meta.className = 'catalog-card-meta';

        if (item.local) {
            const localSpan = document.createElement('span');
            localSpan.className = 'catalog-card-meta-item';
            localSpan.innerHTML = `${MAP_PIN}<span>${escapeHtml(item.local)}</span>`;
            meta.appendChild(localSpan);
        }

        if (item.date) {
            const dateSpan = document.createElement('span');
            dateSpan.className = 'catalog-card-meta-item';
            dateSpan.innerHTML = `${CALENDAR}<span>${escapeHtml(item.date)}</span>`;
            meta.appendChild(dateSpan);
        }

        content.appendChild(meta);
    }

    card.appendChild(content);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'catalog-card-footer';

    if (selectable) {
        // Allow/restrict toggle for the atlas-config "Catálogo" tab — no open action, no map-lock.
        card.dataset.catalogId = item.originalData?.id ?? item.id;
        const label = document.createElement('label');
        label.className = 'atlas-config__switch';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!selected;
        const track = document.createElement('span');
        track.className = 'atlas-config__switch-track';
        label.append(input, track);
        input.addEventListener('change', () => onToggle?.(item, input.checked));
        footer.appendChild(label);
        card.appendChild(footer);
        return card;
    }

    const openBtn = document.createElement('button');
    openBtn.className = 'catalog-card-btn';

    // Only block data/analysis/hillshade types when locked; 3D and 360 remain accessible
    const isBlockedByLock = mapLocked &&
        item.type !== CATALOG_ITEM_TYPES.MODEL_3D &&
        item.type !== CATALOG_ITEM_TYPES.PANORAMIC_360;

    if (isBlockedByLock) {
        openBtn.innerHTML = `<span>Mapa Bloqueado</span>`;
        openBtn.disabled = true;
        card.classList.add('catalog-card--locked');
    } else {
        openBtn.innerHTML = `
            <span>Abrir</span>
            ${CHEVRON_RIGHT}
        `;
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
    }

    footer.appendChild(openBtn);
    card.appendChild(footer);

    // Click on card also opens (only when not blocked by lock)
    if (!isBlockedByLock) {
        card.addEventListener('click', onClick);
    }

    return card;
}
