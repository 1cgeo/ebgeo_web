// Path: js/admin/index.js

/**
 * @fileoverview Public barrel for the admin page. `mountAdminPage()` assembles the shell with the
 * tabs the signed-in user may actually use and renders it into the host element.
 *
 * TWO AUDIENCES SINCE THE PRODUCTION AXIS: the global admin gets the four tabs, and a producer
 * gets Catálogo and nothing else. The filtering is not decoration — Usuários, Configurações and
 * Pessoal each hit a `requireAdmin` route on their FIRST request, so offering them to a producer
 * would deny by 403 on mount, which is the worst way to say no.
 *
 * The gate itself lives in the page entry (`admin-page.js`), which redirects anyone else to the
 * map instead of rendering an empty shell. The backend independently gates every admin route, so
 * neither of these is the security boundary.
 */

import { sessionContext } from '@store/sync/session-context.js';
import { AdminPanel } from './admin-panel.js';
import { createUsersTab } from './users-tab.js';
import { createConfigTab } from './config-tab.js';
import { createCatalogTab } from './catalog-tab.js';
import { createPersonnelTab } from './personnel-tab.js';

/**
 * Builds and mounts the admin page shell.
 * @param {Object} [options]
 * @param {{ id?: string, name?: string }} [options.user] - Identity shown in the top bar.
 * @param {function(): void} [options.onBack] - "Voltar" (the page above this one).
 * @param {function(): void} [options.onLogout] - "Sair".
 * @param {HTMLElement} [host] - Where to render (defaults to `document.body`).
 * @returns {AdminPanel}
 */
export function mountAdminPage({ user, onBack, onLogout } = {}, host = document.body) {
    const isAdmin = sessionContext.isAdmin();
    const tabs = isAdmin
        ? [createUsersTab(), createConfigTab(), createCatalogTab(), createPersonnelTab()]
        : [createCatalogTab()];
    const panel = new AdminPanel(tabs, {
        user,
        onBack,
        onLogout,
        title: isAdmin ? 'Administração' : 'Catálogo',
    });
    panel.mount(host);
    return panel;
}

export { AdminPanel } from './admin-panel.js';
