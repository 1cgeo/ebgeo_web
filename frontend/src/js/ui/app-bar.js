// Path: js/ui/app-bar.js

/**
 * @fileoverview The top bar shared by the app's map-less PAGES (`admin.html`, `projetos.html`):
 * brand on the left, then page actions, the signed-in identity, and "Sair".
 *
 * It exists because those pages cannot reuse `AccountControl` — that one is a MapLibre `IControl`
 * and only exists inside a map. Rather than each page growing its own header (and drifting), the
 * chrome lives here once. Deliberately dependency-light (event-cleanup + presence colors only): the
 * pages that use it boot without the store, and an import that reaches `@store` would undo that.
 */

import { setupCleanup, addDomListener, cleanup } from '@utils/event-cleanup.js';
import { getPresenceColor, getInitials } from '@js/presence/presence-colors.js';

const LOGOUT_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>`;

/**
 * @typedef {Object} AppBarAction
 * @property {string} label - pt-BR button label.
 * @property {string} [icon] - Static SVG markup (no user data).
 * @property {string} [testid] - data-testid for the button.
 * @property {string} [title] - Tooltip / accessible hint.
 * @property {function(): void} onClick
 */

/**
 * Builds the shared page top bar.
 *
 * @param {Object} options
 * @param {string} options.title - Page title (pt-BR).
 * @param {string} [options.subtitle] - Small caption under the title.
 * @param {string} [options.icon] - Static SVG for the brand mark.
 * @param {string} [options.logo] - URL of a brand IMAGE, used instead of `icon` when both are
 *   given. Root-relative (`/images/…`), never a data URI: the same asset the boot splash already
 *   fetched, so it comes from the HTTP cache.
 * @param {{ id?: string, name?: string }} [options.user] - Signed-in identity; omitted when unknown.
 * @param {AppBarAction[]} [options.actions] - Page actions, rendered left to right before the identity.
 * @param {function(): void} [options.onLogout] - Renders "Sair" when provided.
 * @returns {{ element: HTMLElement, destroy: function(): void }}
 */
export function createAppBar({
    title, subtitle, icon, logo = null, user = null, actions = [], onLogout = null,
}) {
    /** Cleanup host — `addDomListener` tracks against any object. */
    const scope = {};
    setupCleanup(scope);

    const header = document.createElement('header');
    header.className = 'app-bar';

    // ----- Brand -----
    const brand = document.createElement('div');
    brand.className = 'app-bar__brand';
    if (logo) {
        // An <img>, not the SVG mark: the logo is a raster asset, and the page's own boot splash
        // already loaded it, so this costs no request.
        const mark = document.createElement('img');
        mark.className = 'app-bar__brand-logo';
        mark.src = logo;
        mark.alt = title;
        brand.appendChild(mark);
    } else if (icon) {
        const mark = document.createElement('span');
        mark.className = 'app-bar__brand-mark';
        mark.innerHTML = icon; // static icon, no user data
        brand.appendChild(mark);
    }
    const titles = document.createElement('div');
    const h = document.createElement('h1');
    h.className = 'app-bar__title';
    h.textContent = title;
    titles.appendChild(h);
    if (subtitle) {
        const sub = document.createElement('p');
        sub.className = 'app-bar__subtitle';
        sub.textContent = subtitle;
        titles.appendChild(sub);
    }
    brand.appendChild(titles);
    header.appendChild(brand);

    // ----- Actions + identity + logout -----
    const bar = document.createElement('div');
    bar.className = 'app-bar__actions';

    for (const action of actions) {
        bar.appendChild(buildAction(scope, action));
    }

    const name = (user?.name || '').trim();
    if (name) {
        const identity = document.createElement('div');
        identity.className = 'app-bar__identity';
        identity.dataset.testid = 'app-bar-user';

        const avatar = document.createElement('span');
        avatar.className = 'app-bar__avatar';
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = getInitials(name);
        // Same deterministic hue as this user's cursor/roster entry elsewhere in the app.
        avatar.style.backgroundColor = getPresenceColor(String(user?.id || name));

        const label = document.createElement('span');
        label.className = 'app-bar__username';
        label.textContent = name;
        label.title = name;

        identity.append(avatar, label);
        bar.appendChild(identity);
    }

    if (onLogout) {
        bar.appendChild(buildAction(scope, {
            label: 'Sair',
            icon: LOGOUT_ICON,
            testid: 'app-bar-logout',
            onClick: onLogout,
        }));
    }

    header.appendChild(bar);

    return {
        element: header,
        destroy: () => cleanup(scope),
    };
}

/**
 * @param {Object} scope - Cleanup host.
 * @param {AppBarAction} action
 * @returns {HTMLButtonElement}
 */
function buildAction(scope, action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-bar__action';
    if (action.testid) btn.dataset.testid = action.testid;
    if (action.title) btn.title = action.title;

    if (action.icon) {
        const ic = document.createElement('span');
        ic.className = 'app-bar__action-icon';
        ic.setAttribute('aria-hidden', 'true');
        ic.innerHTML = action.icon; // static icon, no user data
        btn.appendChild(ic);
    }
    const text = document.createElement('span');
    text.className = 'app-bar__action-label';
    text.textContent = action.label;
    btn.appendChild(text);

    addDomListener(scope, btn, 'click', () => action.onClick?.());
    return btn;
}
