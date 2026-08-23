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
 *   3. Gate — QUATRO audiências, e a tabela delas é `admin-audience.js`, não este arquivo: o
 *      administrador global (todas as abas), o produtor (Catálogo mais os grupos dele) e
 *      qualquer outra sessão AUTENTICADA (Grupos, os dela). Desde 2026-08-20 o grupo de acesso
 *      é entidade de usuário, então a página deixou de ser privilégio: quem entra na conta tem
 *      o que fazer aqui. Cada audiência estreita recebe o título do que ela de fato recebe,
 *      porque toda outra aba é `requireAdmin` na primeira requisição e uma aba que 403 na
 *      montagem é a pior forma de negar. Sem sessão (anônimo ou visitante de link público),
 *      vai para o mapa.
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
import { adminAudience } from './admin-audience.js';
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
    // page would lose the tab's identity. The session is not restored yet here, so the title is
    // refined below once the role is known.
    //
    // AND THE PROVISIONAL TITLE IS NOT "Administração". It used to be, on both the static tag and
    // this line, so a producer read the administrator's word on the tab for the whole boot and
    // again on any path that returns before the refinement below. The provisional word has to be
    // one that is true for EVERY audience this page admits, and "Painel" is: the three audiences
    // (Administração, Catálogo, Grupos) are all panels, and none of them is a claim of authority.
    document.title = `Painel — ${config?.app?.title || 'EBGeo'}`;

    await restoreSession();
    // Gate: a audiência decide, e ela é UMA função (`admin-audience.js`), a mesma que a barra do
    // mapa e o seletor de atlas consultam para desenhar a entrada. Quem não recebe rótulo não
    // recebe aba nenhuma e vai para o mapa, em vez de encarar uma casca cujo primeiro pedido
    // 403.
    //
    // `isAuthenticated()` e não `userId`: o VISITANTE de link público tem sessão online SEM
    // conta, e ele não cria grupo nenhum.
    const audiencia = adminAudience({
        isAuthenticated: sessionContext.isAuthenticated(),
        isAdmin: sessionContext.isAdmin(),
        isProducer: sessionContext.isProducer(),
    });
    if (audiencia.label === null) {
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

    // O título da aba do navegador é o rótulo da audiência, pelo mesmo motivo do rótulo da
    // porta: "Administração" numa página de uma aba prometeria o que ela não entrega.
    document.title = `${audiencia.label} — ${config?.app?.title || 'EBGeo'}`;

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
