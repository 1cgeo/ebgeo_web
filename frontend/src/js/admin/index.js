// Path: js/admin/index.js

/**
 * @fileoverview Public barrel for the admin panel. `openAdminPanel()` is the single
 * entry point; it enforces the GLOBAL-admin gate (sessionContext.isAdmin()) before
 * building the panel. The backend independently gates every admin route with
 * requireAdmin, so this gate is a UI affordance, not the security boundary.
 */

import { AdminPanel } from './admin-panel.js';
import { createUsersTab } from './users-tab.js';
import { createConfigTab } from './config-tab.js';
import { createCatalogTab } from './catalog-tab.js';
import { createPersonnelTab } from './personnel-tab.js';
import { sessionContext } from '@store/sync/session-context.js';
import { showError } from '@utils';

/** @type {AdminPanel|null} */
let _panel = null;

/**
 * Opens the admin panel (global system admin only). No-op (with an error toast) for
 * non-admins; idempotent while already open.
 * @returns {AdminPanel|undefined}
 */
export function openAdminPanel() {
    if (!sessionContext.isAdmin()) {
        showError('Acesso restrito a administradores.');
        return undefined;
    }
    if (_panel && _panel.isOpen()) return _panel;
    _panel = new AdminPanel([createUsersTab(), createConfigTab(), createCatalogTab(), createPersonnelTab()]);
    _panel.open();
    return _panel;
}

export { AdminPanel } from './admin-panel.js';
