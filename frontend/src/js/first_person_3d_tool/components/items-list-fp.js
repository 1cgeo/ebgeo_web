// Path: js/first_person_3d_tool/components/items-list-fp.js

/**
 * @fileoverview The item LIST of a first-person scene, as feature-panel content.
 *
 * IT IS THE ANSWER TO A NAVIGATION DEAD END. Until 2026-08-17 an item could only
 * be reached by walking up to its label and clicking it, which made two ordinary
 * wishes impossible: seeing what else the room holds without touring it, and
 * reaching the pieces whose labels the layer had to hide. The layer hides a lot,
 * on purpose — in the display cases the pieces sit centimeters apart, so the
 * nearest label wins and the others collapse into a "+N" suffix
 * (`markers-layer-fp.js`). That "+N" announced there was more and then offered
 * no way in.
 *
 * SO THE LIST HAS TWO ENTRANCES AND ONE BODY. Clicking a "+N" label opens it
 * SCOPED to that pile; the "Ver todos os itens" button of an open item opens it
 * whole. Same component, same rows, and the scoped view carries a button to
 * widen — which is why the header is a parameter and not a constant.
 *
 * It is CONTENT, not a panel: like `marker-panel-fp.js`, it builds what goes
 * inside the application's one feature panel, and it reaches it through the same
 * route (an event → `sidebar.control.js`). Picking a row does not open the card
 * from here either; it emits MARKER_FP_PICKED and the marker layer opens it, so
 * "which item is open" stays a question with one owner.
 *
 * Every field comes from the scene's marcadores.json and is written with
 * textContent — never innerHTML. The only innerHTML is static inline SVG.
 */

import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';

/**
 * @typedef {import('./marker-panel-fp.js').FpMarker} FpMarker
 */

/**
 * @typedef {Object} FpListItem
 * @property {FpMarker} marker - Marker data.
 * @property {string|null} photoUrl - Photo URL already resolved, or null.
 */

/** Magnifier, at the weight the sidebar search inputs use. */
const ICON_SEARCH = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;

/** Placeholder for a row whose item has no photo. */
const ICON_ITEM_SMALL = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;

/**
 * Builds the feature-panel content listing the items of a scene.
 *
 * @param {Object} options
 * @param {ReadonlyArray<FpListItem>} options.items - Items to list, in the order they are shown.
 * @param {string} [options.sceneName] - Scene display name, for the header line.
 * @param {string} [options.title] - Header title. Says what this list IS (all the
 *   items, or the pile behind one label), so the scoped view is not mistaken for the whole.
 * @param {boolean} [options.scoped] - True when this is a subset, which is what
 *   earns the "Ver todos os itens" button.
 * @param {string|null} [options.openId] - Id of the item whose card was open, marked in the list.
 * @returns {{element: HTMLElement, cleanup: Function}} Content and its teardown.
 */
export function createItemsListFpContent({
    items,
    sceneName = '',
    title = 'Itens do acervo',
    scoped = false,
    openId = null
}) {
    const list = Array.isArray(items) ? items.filter((entry) => entry?.marker) : [];

    const container = document.createElement('div');
    container.className = 'marker-fp-panel-content fp3d-list';

    /** Teardowns of every listener attached below, run in reverse on cleanup. */
    const teardowns = [];

    buildHeader(container, { title, sceneName, count: list.length });

    if (scoped) {
        buildWidenButton(container, teardowns);
    }

    const rows = document.createElement('div');
    rows.className = 'fp3d-list__rows';

    const empty = document.createElement('div');
    empty.className = 'fp3d-list__empty';
    empty.textContent = 'Nenhum item com esse nome.';
    empty.hidden = true;

    // The search box earns its place at 78 rows; below a dozen it would be
    // chrome over a list you can already read. It filters what is ALREADY here
    // and never refetches, so the rows are built once.
    const searchInput = list.length > 12
        ? buildSearch(container, teardowns, (term) => applyFilter(rows, empty, term))
        : null;

    for (const entry of list) {
        rows.appendChild(buildRow(entry, openId, teardowns));
    }

    container.appendChild(rows);
    container.appendChild(empty);

    // Focus last, and only after the panel has the element: focusing a node that
    // is not in the document yet is a no-op, and the caller mounts us.
    const focus = () => searchInput?.focus();
    requestAnimationFrame(focus);

    const cleanup = () => {
        while (teardowns.length) {
            teardowns.pop()();
        }
    };

    return { element: container, cleanup };
}

/**
 * Title, scene and count.
 * @param {HTMLElement} container - Parent container.
 * @param {{title: string, sceneName: string, count: number}} info - Header fields.
 */
function buildHeader(container, { title, sceneName, count }) {
    const section = document.createElement('div');
    section.className = 'feature-identification';

    const info = document.createElement('div');
    info.className = 'feature-identification-info';

    const name = document.createElement('div');
    name.className = 'feature-identification-name marker-fp-name';
    name.textContent = title;
    info.appendChild(name);

    const type = document.createElement('div');
    type.className = 'feature-identification-type';
    // Singular and plural spelled out: "1 itens" is the kind of detail that makes
    // a careful panel look automated.
    type.textContent = count === 1 ? '1 item' : `${count} itens`;
    info.appendChild(type);

    if (sceneName) {
        const scene = document.createElement('div');
        scene.className = 'feature-identification-layer';
        scene.textContent = `Cena: ${sceneName}`;
        info.appendChild(scene);
    }

    section.appendChild(info);
    container.appendChild(section);
}

/**
 * "Ver todos os itens", shown only on a scoped list.
 * @param {HTMLElement} container - Parent container.
 * @param {Array<Function>} teardowns - Collector for the listener teardown.
 */
function buildWidenButton(container, teardowns) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fp3d-list__widen';
    button.textContent = 'Ver todos os itens da cena';

    const onClick = () => getEventBus().emit(EventTypes.MARKER_FP_LIST_REQUESTED, {});
    button.addEventListener('click', onClick);
    teardowns.push(() => button.removeEventListener('click', onClick));

    container.appendChild(button);
}

/**
 * The filter box.
 * @param {HTMLElement} container - Parent container.
 * @param {Array<Function>} teardowns - Collector for the listener teardown.
 * @param {(term: string) => void} onTerm - Called with the typed term.
 * @returns {HTMLInputElement} The input, for focusing.
 */
function buildSearch(container, teardowns, onTerm) {
    const wrap = document.createElement('div');
    wrap.className = 'fp3d-list__search';

    const icon = document.createElement('span');
    icon.className = 'fp3d-list__search-icon';
    icon.innerHTML = ICON_SEARCH;

    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'fp3d-list__search-input';
    input.placeholder = 'Buscar item';
    input.autocomplete = 'off';

    const onInput = () => onTerm(input.value);
    input.addEventListener('input', onInput);
    teardowns.push(() => input.removeEventListener('input', onInput));

    wrap.appendChild(icon);
    wrap.appendChild(input);
    container.appendChild(wrap);
    return input;
}

/**
 * One row: thumbnail, title, and the click that opens the item.
 * @param {FpListItem} entry - Item to draw.
 * @param {string|null} openId - Id of the open item.
 * @param {Array<Function>} teardowns - Collector for the listener teardown.
 * @returns {HTMLButtonElement} The row.
 */
function buildRow(entry, openId, teardowns) {
    const { marker, photoUrl } = entry;
    const title = marker.titulo || 'Sem nome';

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'fp3d-list__row';
    row.dataset.id = marker.id ?? '';
    // The haystack is built ONCE and stored folded, so filtering 78 rows on every
    // keystroke is a substring test and not 78 normalizations.
    row.dataset.search = fold(title);
    if (openId && marker.id === openId) {
        row.classList.add('fp3d-list__row--current');
        row.setAttribute('aria-current', 'true');
    }

    const thumb = document.createElement('span');
    thumb.className = 'fp3d-list__thumb';
    if (photoUrl) {
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        // A photo named in the JSON and absent from itens/ is an ordinary
        // authoring slip: fall back to the icon instead of a broken frame.
        const onError = () => {
            img.remove();
            thumb.innerHTML = ICON_ITEM_SMALL;
        };
        img.addEventListener('error', onError);
        teardowns.push(() => img.removeEventListener('error', onError));
        img.src = photoUrl;
        thumb.appendChild(img);
    } else {
        thumb.innerHTML = ICON_ITEM_SMALL;
    }

    const label = document.createElement('span');
    label.className = 'fp3d-list__label';
    label.textContent = title;

    row.appendChild(thumb);
    row.appendChild(label);

    const onClick = () => {
        if (!marker.id) return;
        getEventBus().emit(EventTypes.MARKER_FP_PICKED, { id: marker.id });
    };
    row.addEventListener('click', onClick);
    teardowns.push(() => row.removeEventListener('click', onClick));

    return row;
}

/**
 * Hides the rows that do not match, and shows the empty state when none does.
 * @param {HTMLElement} rows - Row container.
 * @param {HTMLElement} empty - Empty-state element.
 * @param {string} term - Typed term.
 */
function applyFilter(rows, empty, term) {
    const needle = fold(term);
    let visible = 0;
    for (const row of rows.children) {
        const match = !needle || (row.dataset.search ?? '').includes(needle);
        row.hidden = !match;
        if (match) visible++;
    }
    empty.hidden = visible > 0;
}

/**
 * Lowercases and strips accents, so "estereoscopio" finds "Estereoscópio".
 *
 * Typing the accents of a museum catalog is exactly what a visitor will not do,
 * and half these titles carry one.
 * @param {string} value - Raw text.
 * @returns {string} Folded text.
 */
function fold(value) {
    // Same two steps `CatalogService._normalizeText` takes, in the same order.
    return String(value ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}
