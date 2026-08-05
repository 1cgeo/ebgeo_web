// Path: js/admin/index.js

/**
 * @fileoverview Public barrel for the admin page. `mountAdminPage()` assembles the shell with every
 * tab and renders it into the host element.
 *
 * The GLOBAL-admin gate lives in the page entry (`admin-page.js`), which redirects a non-admin to
 * the map instead of rendering an empty shell. The backend independently gates every admin route
 * with requireAdmin, so neither gate is the security boundary.
 */

import { AdminPanel } from './admin-panel.js';
import { createUsersTab } from './users-tab.js';
import { createConfigTab } from './config-tab.js';
import { createCatalogTab } from './catalog-tab.js';
import { createPersonnelTab } from './personnel-tab.js';

/**
 * Builds and mounts the admin page shell (users, config, catalog, personnel).
 * @param {Object} [options]
 * @param {{ id?: string, name?: string }} [options.user] - Identity shown in the top bar.
 * @param {function(): void} [options.onBack] - "Voltar" (the page above this one).
 * @param {function(): void} [options.onLogout] - "Sair".
 * @param {HTMLElement} [host] - Where to render (defaults to `document.body`).
 * @returns {AdminPanel}
 */
export function mountAdminPage({ user, onBack, onLogout } = {}, host = document.body) {
    const panel = new AdminPanel(
        [createUsersTab(), createConfigTab(), createCatalogTab(), createPersonnelTab()],
        { user, onBack, onLogout },
    );
    panel.mount(host);
    return panel;
}

export { AdminPanel } from './admin-panel.js';
