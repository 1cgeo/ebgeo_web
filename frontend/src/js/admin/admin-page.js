// Path: js/admin/admin-page.js

/**
 * @module admin/admin-page
 * @description Entry point of `admin.html` — the standalone Administração page.
 *
 * Administration used to be a full-screen overlay stacked on the booted map. It is a page of its
 * own now, so it boots WITHOUT MapLibre, without the store and without `initServices()`: the whole
 * dependency surface here is the API client, the session context, the runtime config and the
 * confirm/toast primitives. That is what keeps the page cheap; adding a `@store` import (or the
 * `@utils` / `@modals` barrels, which reach the store transitively) would silently drag the entire
 * map foundation back in.
 *
 * Boot phases, in order:
 *   1. Config — `GET /api/config`, fail-fast with retries (same contract as the map boot).
 *   2. Session — restore the persisted tokens and validate them against the backend.
 *   3. Gate — THREE audiences, not two: the global system admin (all five tabs), the credenciado
 *      (only Grupos, because since 2026-08-19 he administers access groups) and the producer
 *      (only Catálogo). Each of the two narrow audiences gets its own tab set and its own page
 *      title, because every other tab is `requireAdmin` on its first request and a tab that 403s
 *      on mount is the worst way to deny. Anyone else is sent to the map.
 *   4. Mount — build the shell and wire the session lifecycle (auth lost + idle timeout).
 */

import config from '@js/config.js';
import { applyRuntimeConfig, resolveBackendBaseUrl } from '@store/sync/runtime-config.js';
import { apiClient, configureApiClient } from '@store/sync/api-client.js';
import { sessionContext, sessionUserInfoFromMe } from '@store/sync/session-context.js';
import { showUnavailableScreen } from '@ui/unavailable-screen.js';
// From the FILE, never from the `@utils` barrel: the barrel reaches `@store` transitively.
import { initTabLock, noneKey } from '@utils/tab-lock.js';
import { startIdleWatch } from '../session/idle-watch.js';
import { mountAdminPage } from './index.js';

/** Where a non-admin (or a signed-out visitor) is sent. Relative — the app may be served from a subpath. */
const MAP_URL = './';
/** Where "Voltar" goes. Administração is reached FROM the chooser, so back means back to it — not
 *  to the map, which would skip the level the user came from. */
const PROJECTS_URL = './atlas.html';

const CONFIG_BOOT_ATTEMPTS = 3;
const CONFIG_BOOT_RETRY_MS = 1000;

/**
 * Fetches the runtime config with a few retries. The deploy ALWAYS ships a backend and it is the
 * single source of config, so a real outage has nothing to render — it shows the branded
 * "EBGeo indisponível" screen instead of an empty page.
 * @returns {Promise<boolean>} Whether the config was applied.
 */
async function bootConfig() {
    for (let attempt = 1; attempt <= CONFIG_BOOT_ATTEMPTS; attempt++) {
        const result = await applyRuntimeConfig({ apiClient });
        if (result.applied) return true;
        if (attempt < CONFIG_BOOT_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, CONFIG_BOOT_RETRY_MS));
        }
    }
    return false;
}

/**
 * Restores the persisted login and mirrors it into the session context. Any failure (no token,
 * expired refresh, backend down) clears the tokens and leaves the session anonymous.
 * @returns {Promise<boolean>} Whether a session was restored.
 */
async function restoreSession() {
    try {
        if (!apiClient.loadStoredTokens()) return false;
        const user = await apiClient.getMe();
        sessionContext.setSession(sessionUserInfoFromMe(user));
        return true;
    } catch {
        apiClient.clearTokens();
        return false;
    }
}

/** Removes the boot splash once the page is ready to be seen. */
function clearSplash() {
    document.getElementById('initial-loader')?.remove();
}

/**
 * Ends the session and returns to the map. The map boot discards any orphaned remote data on its
 * own (`enforceLocalStoreWhenLoggedOut`), so this page must NOT reach into the store to do it —
 * revoking the token and navigating is the whole job.
 * @param {string} [reason] - Carried to the map page as `?sessao=<reason>` so it can explain itself.
 */
async function endSession(reason) {
    try {
        await apiClient.logout();
    } catch {
        // logout() already swallows network errors and clears locally; nothing left to do.
    }
    sessionContext.clearSession();
    window.location.replace(reason ? `${MAP_URL}?sessao=${encodeURIComponent(reason)}` : MAP_URL);
}

/**
 * Boots the Administração page.
 * @returns {Promise<void>}
 */
async function initAdminPage() {
    configureApiClient({ baseUrl: resolveBackendBaseUrl() });

    if (!(await bootConfig())) {
        showUnavailableScreen();
        return;
    }
    // NOT `initializeAppConfig()`: that sets the document title to the bare app name, which on this
    // page would replace "Administração — EBGeo" with "EBGeo" and lose the tab's identity. The
    // session is not restored yet here, so the title is refined below once the role is known.
    document.title = `Administração — ${config?.app?.title || 'EBGeo'}`;

    await restoreSession();
    // Gate: GLOBAL system admins, plus a CREDENCIADO (Grupos only) and a PRODUCER (Catálogo only)
    // — see `mountAdminPage` for which tabs each one gets. Anyone else — signed out, or a regular
    // user who typed the URL — goes to the map rather than staring at a shell whose every request
    // 403s. `hasGlobalDataAccess()` also covers the admin, which is harmless here: the three tests
    // are an OR, and only the title below needs them apart.
    if (!sessionContext.isAdmin() && !sessionContext.hasGlobalDataAccess() && !sessionContext.isProducer()) {
        window.location.replace(MAP_URL);
        return;
    }

    // Joins the multi-tab channel holding NOTHING (`tab-lock.js`, section 1: the arbitration is
    // over which tab may hold which ATLAS, and this page holds none). So it never blocks and is
    // never blocked, which is what keeps "map in one tab, Administração in another" working; it
    // stays visible in every peer's roster, which is the whole point of announcing. No overlay: a
    // page that cannot be blocked has nothing to render, and it does not load `tab-lock.css`.
    // Announced only past the gate, so a tab that is about to redirect does not join and leave.
    initTabLock({ key: noneKey(), overlayHost: null });

    // The narrow audiences get the title of the ONE thing they can do here. Same order as
    // `mountAdminPage`: `hasGlobalDataAccess()` is true for the admin too, so it is only asked
    // after `isAdmin()` has already returned.
    if (!sessionContext.isAdmin()) {
        const escopo = sessionContext.hasGlobalDataAccess() ? 'Grupos' : 'Catálogo';
        document.title = `${escopo} — ${config?.app?.title || 'EBGeo'}`;
    }

    clearSplash();

    mountAdminPage({
        user: { id: sessionContext.userId, name: sessionContext.username },
        onBack: () => window.location.assign(PROJECTS_URL),
        onLogout: () => { endSession(); },
    });

    // A refresh that finally failed (expired, password changed, admin reset, token reuse detected)
    // must not leave an admin clicking into 401s.
    apiClient.setAuthLostHandler(() => { endSession('encerrada'); });

    // The idle timeout follows the user here: as an overlay on the map this page was covered by the
    // map's own watch, and moving it out would otherwise have dropped the protection silently.
    startIdleWatch({ onExpire: () => { endSession('inatividade'); } });
}

initAdminPage().catch((error) => {
    console.error('Admin page initialization failed:', error);
    clearSplash();
    showUnavailableScreen();
});
