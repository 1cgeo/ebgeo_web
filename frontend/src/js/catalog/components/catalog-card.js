// Path: js/catalog/components/catalog-card.js

/**
 * @fileoverview Individual catalog card component.
 *
 * O EIXO PRIVADO NÃO VEM DO ITEM, e é o que surpreende quem lê este arquivo: um
 * item de `config` não carrega `access_level`, porque `/api/config` é o documento
 * PÚBLICO e igual para todo chamador. O que o cartão sabe é que aquele id chegou
 * pelo payload aditivo (`GET /resource-access/visible`), que devolve só o privado
 * visível — daí `isPrivateResource`, que é uma consulta ao que o servidor entregou,
 * nunca uma leitura de propriedade.
 */

import { escapeHtml } from '@utils/html-escape.js';
import {
    CATALOG_ITEM_TYPES,
    CATALOG_TYPE_CONFIG,
    DEFAULT_THUMBNAILS,
    CATALOG_UI_ICONS,
    RESOURCE_ACCESS_BY_CATALOG_TYPE
} from '../catalog.constants.js';
import { formatCatalogDate } from '../catalog.service.js';
import { isPrivateResource, canShareResource } from '@store/sync/resource-access.service.js';

/** Icons used in catalog card */
const { CALENDAR, MAP_PIN, CHEVRON_RIGHT, LOCK, SHARE } = CATALOG_UI_ICONS;

/**
 * O par (grupo, tipo) do eixo de acesso e o id CRU deste item, ou null quando o
 * item não é uma linha de catálogo (sombreamento).
 * @param {CatalogItem} item
 * @returns {{grupo: string, tipo: string, id: string}|null}
 */
export function resourceAccessRefOf(item) {
    const mapa = RESOURCE_ACCESS_BY_CATALOG_TYPE[item?.type];
    const id = item?.originalData?.id;
    if (!mapa || id == null) return null;
    return { ...mapa, id: String(id) };
}

/**
 * Creates an individual catalog card.
 * @param {Object} options
 * @param {CatalogItem} options.item - Catalog item
 * @param {Function} options.onClick - Click callback
 * @param {Function} [options.onShare] - Abre o modal de compartilhar deste recurso.
 * @returns {HTMLElement}
 */
export function createCatalogCard({ item, onClick, mapLocked = false, selectable = false, selected = false, onToggle, onShare }) {
    const typeConfig = CATALOG_TYPE_CONFIG[item.type];
    const acesso = resourceAccessRefOf(item);
    const privado = !!acesso && isPrivateResource(acesso.grupo, acesso.id);

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

    // Selo de recurso PRIVADO. Ele aparece também na aba "Catálogo" da configuração
    // do atlas (modo `selectable`), de propósito: é lá que o Gestor decide o que
    // restringir, e é lá que ele mais precisa saber que um item não é público.
    if (privado) {
        const selo = document.createElement('span');
        selo.className = 'catalog-card-badge catalog-card-badge--private';
        selo.dataset.testid = 'catalog-card-private';
        selo.title = 'Recurso privado: só quem recebeu acesso enxerga este item.';
        selo.innerHTML = `${LOCK}<span>Privado</span>`;
        thumbnailWrapper.appendChild(selo);
    }

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
            dateSpan.innerHTML = `${CALENDAR}<span>${escapeHtml(formatCatalogDate(item.date))}</span>`;
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

    // "Compartilhar": só em recurso PRIVADO e só para quem pode repassar
    // (papel global, ou concessão de nível `view_share`). Quem só recebeu `view`
    // não vê o botão — oferecê-lo seria oferecer um formulário que o servidor
    // recusa. O mapa bloqueado NÃO o esconde: compartilhar não mexe no mapa.
    if (privado && acesso && onShare && canShareResource(acesso.grupo, acesso.id)) {
        footer.classList.add('catalog-card-footer--split');
        const shareBtn = document.createElement('button');
        shareBtn.className = 'catalog-card-btn catalog-card-btn--share';
        shareBtn.dataset.testid = 'catalog-card-share';
        shareBtn.title = `Compartilhar ${item.name}`;
        shareBtn.setAttribute('aria-label', `Compartilhar ${item.name}`);
        shareBtn.innerHTML = `${SHARE}<span>Compartilhar</span>`;
        shareBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onShare(item);
        });
        footer.appendChild(shareBtn);
    }

    card.appendChild(footer);

    // Click on card also opens (only when not blocked by lock)
    if (!isBlockedByLock) {
        card.addEventListener('click', onClick);
    }

    return card;
}
