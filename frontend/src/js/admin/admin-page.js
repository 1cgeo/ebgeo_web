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
 *      administrador global (todas as abas), o produtor (Catálogo mais os grupos, as concessões
 *      e a trilha da OM dele) e qualquer outra sessão AUTENTICADA (os grupos dela e as
 *      concessões dela, sob o rótulo "Acessos"). Desde 2026-08-20 o grupo de acesso
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
import { showUnavailableScreen, BlockingCause } from '@ui/unavailable-screen.js';
// From the FILE, never from the `@utils` barrel: the barrel reaches `@store` transitively.
import { initTabLock, noneKey } from '@utils/tab-lock.js';
// A classificação de falha de pedido, de um módulo folha e SEM imports: a MESMA definição que
// `index.js` e `projects/projects-page.js` consomem.
import { classifyRequestFailure, RequestFailure } from '@utils/request-failure.js';
import { startIdleWatch } from '../session/idle-watch.js';
// Por ARQUIVO, nunca por barrel: este modulo alcanca o store por folhas, e e isso que o torna
// importavel de uma pagina que boota sem `initServices()`.
import {
    preserveUnsyncedWorkOnLostSession,
    ExitOutcome,
} from '../session/unsynced-work-exit.js';
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
 * Restores the persisted login and mirrors it into the session context.
 *
 * ONLY A CREDENTIAL FAILURE (401/403) CLEARS THE TOKENS. Until 2026-08-23 this was a bare
 * `catch { apiClient.clearTokens(); }`, byte for byte the same as `projects/projects-page.js`, so
 * a 502 from the proxy, a latency spike or a 429 signed the user out FOR GOOD — and the outcome
 * is terminal, because the product has no self-service password reset (`POST
 * /users/:userId/reset-password` is `requireAdmin`). The shared predicate now lives in
 * `@utils/request-failure.js`.
 *
 * IT REPORTS THE CLASS INSTEAD OF A BOOLEAN, because the caller has to tell two failures apart
 * that a boolean makes identical: "you are not signed in" and "I could not ask who you are".
 *
 * @returns {Promise<{ok: boolean, failure: string|null}>} `failure` is a {@link RequestFailure}
 *   value, or null when there was nothing stored to restore.
 */
async function restoreSession() {
    try {
        if (!apiClient.loadStoredTokens()) return { ok: false, failure: null };
        const user = await apiClient.getMe();
        sessionContext.setSession(sessionUserInfoFromMe(user));
        return { ok: true, failure: null };
    } catch (error) {
        const kind = classifyRequestFailure(error);
        if (kind === RequestFailure.CREDENTIAL) apiClient.clearTokens();
        else console.warn('[admin] session restore deferred (server unreachable):', error);
        return { ok: false, failure: kind };
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
    // O TRABALHO NÃO ENVIADO É RESGATADO ANTES, e este era o buraco: até 2026-08-23 a função era
    // logout mais navegação, e a destruição ficava para a varredura de deslogado do boot seguinte,
    // que é exatamente quem apaga o namespace com a fila dentro. O JSDoc acima ainda diz que esta
    // página "must NOT reach into the store", e essa linha vale para os DADOS do atlas; o resgate
    // alcança o store por módulos FOLHA (`unsynced-work-exit.js` importa por arquivo, nunca por
    // barrel), que é o que o mantém carregável numa página sem `initServices()`.
    //
    // UM CAMINHO SÓ: aqui não há gesto a distinguir. Esta página só encerra sessão por acidente
    // (inatividade, token perdido) ou por clique na barra, e a decisão do dono é a mesma para os
    // dois, porque o sincronismo ocorre sempre e a fila pendente nunca é uma escolha.
    const guarda = await preserveUnsyncedWorkOnLostSession();

    try {
        await apiClient.logout();
    } catch {
        // logout() already swallows network errors and clears locally; nothing left to do.
    }
    sessionContext.clearSession();

    // O CÓDIGO, E NÃO A FRASE. `window.location.replace` mata qualquer toast levantado logo antes,
    // então o desfecho viaja como valor na URL e o mapa remonta a sentença a partir do mesmo
    // módulo de frases puras. Pôr a prosa aqui a deixaria repetível por F5 e ecoável à mão.
    const params = new URLSearchParams();
    if (reason) params.set('sessao', reason);
    if (guarda.outcome && guarda.outcome !== ExitOutcome.NADA) {
        params.set('trabalho', guarda.outcome);
        if (guarda.pendingOps) params.set('pendentes', String(guarda.pendingOps));
    }
    const qs = params.toString();
    window.location.replace(qs ? `${MAP_URL}?${qs}` : MAP_URL);
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
    // (Administração, Catálogo, Acessos) are all panels, and none of them is a claim of authority.
    document.title = `Painel — ${config?.app?.title || 'EBGeo'}`;

    const restored = await restoreSession();
    // A SESSÃO QUE NÃO PÔDE SER CONFIRMADA NÃO CAI NO GATE ABAIXO, e este é o desfecho escolhido
    // para a falha que NÃO é de credencial nesta página. Mandar para o mapa aqui diria à pessoa,
    // pela única linguagem que a página tem (a porta fechada), que ela não é administradora, o que
    // é uma afirmação sobre a AUTORIDADE dela que a página não mediu: o servidor não respondeu.
    //
    // Diferente de `atlas.html` de propósito: lá existe uma metade local que vale por si, e negá-la
    // seria a perda maior. Aqui não existe metade nenhuma sem servidor, então a tela de
    // indisponível é a resposta inteira, e ela já traz o "Tentar novamente" que recarrega, que é
    // exatamente o que resolve quando o servidor voltar. Os tokens continuam no disco.
    if (restored.failure && restored.failure !== RequestFailure.CREDENTIAL) {
        showUnavailableScreen();   // remove o splash sozinho
        return;
    }
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
    startIdleWatch({
        onExpire: () => { endSession('inatividade'); },
        // "Sair agora" nao e expiracao: motivo proprio, e o mapa nao pede login de volta.
        onLeaveNow: () => { endSession('saida'); },
    });
}

initAdminPage().catch((error) => {
    console.error('Admin page initialization failed:', error);
    clearSplash();
    // ERRO DE APLICACAO, nao de rede: o servidor JA respondeu (o `bootConfig` acima passou).
    // Anunciar falha de conexao aqui manda a pessoa depurar a internet dela por um defeito do
    // programa, que era exatamente o que esta tela fazia.
    showUnavailableScreen(BlockingCause.APP_ERROR);
});
