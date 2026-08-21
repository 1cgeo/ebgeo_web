// Path: js/admin/admin-dom.js

/**
 * @fileoverview Shared DOM builders for the admin panel tabs — section headers, cards, avatars,
 * and empty states — plus the rail icons. Keeps the three tabs visually consistent and dedupes the
 * small builders they used to each carry. All text is set via textContent; icons are static SVG.
 */

import { getPresenceColor, getInitials } from '@js/presence/presence-colors.js';

/** Rail icons (static SVG, no user data). */
export const ICON_USERS = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
export const ICON_CONFIG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
export const ICON_CATALOG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`;
export const ICON_GROUPS = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.2"/><path d="M3 20v-1.5A4.5 4.5 0 0 1 7.5 14h3A4.5 4.5 0 0 1 15 18.5V20"/><path d="M17 14.5h.5a3.5 3.5 0 0 1 3.5 3.5V20"/></svg>`;
export const ICON_AUDIT = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h5"/><path d="M8 17h8"/></svg>`;
export const ICON_PERSONNEL = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8z"/></svg>`;

/**
 * A section header: a title (+ optional subtitle) with optional action elements on the right.
 * @param {string} title
 * @param {{ subtitle?: string, actions?: HTMLElement[] }} [opts]
 * @returns {HTMLElement}
 */
export function sectionHeader(title, { subtitle, actions = [] } = {}) {
    const header = document.createElement('div');
    header.className = 'admin-section__header';

    const titles = document.createElement('div');
    const h = document.createElement('h3');
    h.className = 'admin-section__title';
    h.textContent = title;
    titles.appendChild(h);
    if (subtitle) {
        const s = document.createElement('p');
        s.className = 'admin-section__subtitle';
        s.textContent = subtitle;
        titles.appendChild(s);
    }
    header.appendChild(titles);

    if (actions.length) {
        const actionWrap = document.createElement('div');
        actionWrap.className = 'admin-section__actions';
        actionWrap.append(...actions);
        header.appendChild(actionWrap);
    }
    return header;
}

/**
 * A surface card.
 * @param {{ testid?: string, padded?: boolean }} [opts]
 * @returns {HTMLElement}
 */
export function card({ testid, padded = true } = {}) {
    const el = document.createElement('div');
    el.className = padded ? 'admin-card admin-card--padded' : 'admin-card';
    if (testid) el.dataset.testid = testid;
    return el;
}

/**
 * A circular initials avatar tinted with a stable per-key color (matches presence/account avatars).
 * @param {string} name - Display name (initials source).
 * @param {string} [key] - Stable color key (user id / username); defaults to the name.
 * @returns {HTMLElement}
 */
export function avatar(name, key) {
    const el = document.createElement('span');
    el.className = 'admin-avatar';
    el.textContent = getInitials(name || '?');
    el.style.backgroundColor = getPresenceColor(String(key || name || ''));
    return el;
}

/**
 * An empty-state block (icon + message + optional hint).
 * @param {string} message
 * @param {{ hint?: string }} [opts]
 * @returns {HTMLElement}
 */
export function emptyState(message, { hint } = {}) {
    const el = document.createElement('div');
    el.className = 'admin-empty';
    const msg = document.createElement('p');
    msg.className = 'admin-empty__message';
    msg.textContent = message;
    el.appendChild(msg);
    if (hint) {
        const h = document.createElement('p');
        h.className = 'admin-empty__hint';
        h.textContent = hint;
        el.appendChild(h);
    }
    return el;
}
