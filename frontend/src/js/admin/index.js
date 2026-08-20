// Path: js/admin/index.js

/**
 * @fileoverview Public barrel for the admin page. `mountAdminPage()` assembles the shell with the
 * tabs the signed-in user may actually use and renders it into the host element.
 *
 * THREE AUDIENCES, and each one gets exactly the tabs its role can actually use:
 *   - global admin  → the five tabs;
 *   - credenciado   → Grupos and nothing else (he reads every private resource and writes
 *                     nothing, but he does administer WHO is in an access group);
 *   - producer      → Catálogo and nothing else.
 * The filtering is not decoration — Usuários, Configurações and Pessoal each hit a `requireAdmin`
 * route on their FIRST request, so offering them to a producer or a credenciado would deny by 403
 * on mount, which is the worst way to say no.
 *
 * The order of the two tests matters: `hasGlobalDataAccess()` is TRUE for the admin as well, so it
 * can only be asked after `isAdmin()` has already claimed him. Reading it as an else-if is the
 * whole reason it is written as one.
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
import { createGroupsTab } from './groups-tab.js';

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
    let tabs;
    let title;
    if (sessionContext.isAdmin()) {
        tabs = [createUsersTab(), createGroupsTab(), createConfigTab(), createCatalogTab(), createPersonnelTab()];
        title = 'Administração';
    } else if (sessionContext.hasGlobalDataAccess()) {
        tabs = [createGroupsTab()];
        title = 'Grupos';
    } else {
        tabs = [createCatalogTab()];
        title = 'Catálogo';
    }
    const panel = new AdminPanel(tabs, {
        user,
        onBack,
        onLogout,
        title,
    });
    panel.mount(host);
    return panel;
}

export { AdminPanel } from './admin-panel.js';
