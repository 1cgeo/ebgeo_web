// Path: js/calibration/calibracao-page.js

/**
 * @module calibration/calibracao-page
 * @description Ponto de entrada de `calibracao.html` — a area de trabalho autonoma de calibracao
 * 360.
 *
 * O QUE E OBRA NOVA AQUI. A app de calibracao veio do ebgeo_360, onde ela NAO TEM AUTENTICACAO
 * NENHUMA: la ela escreve direto, sem credencial. Neste backend toda escrita do modulo 360 passa
 * por `auth` estrito, e a decisao do chefe e que so o papel `admin` calibra. Este arquivo e o
 * unico lugar onde essa regra existe, e ele nao veio da origem.
 *
 * Boot, na ordem (o mesmo encadeamento de `admin-page.js`):
 *   1. Config — `GET /api/config`, fail-fast com tentativas. E dele que sai o
 *      `streetView360.serviceUrl` que o cliente da calibracao usa como prefixo.
 *   2. Sessao — recupera os tokens persistidos e valida contra o backend.
 *   3. Gate — so admin global; qualquer outro vai para o mapa.
 *   4. Monta — levanta a area de trabalho e liga o ciclo de vida da sessao.
 *
 * Sem `@store` alem do cliente HTTP e do contexto de sessao, e sem `initServices()`: a pagina nao
 * tem mapa, nem store, nem MapLibre do EBGeo. Puxar `@utils` ou `@modals` aqui traria a fundacao
 * do mapa inteira de volta pela porta dos fundos.
 */

import config from '@js/config.js';
import { applyRuntimeConfig, resolveBackendBaseUrl } from '@store/sync/runtime-config.js';
import { apiClient, configureApiClient } from '@store/sync/api-client.js';
import { sessionContext } from '@store/sync/session-context.js';
import { showUnavailableScreen } from '@ui/unavailable-screen.js';
import { startIdleWatch } from '../session/idle-watch.js';
import { mountCalibrationWorkspace, setSessionHandlers } from './app.js';

/** Para onde vai quem nao e admin (ou quem esta deslogado). Relativo: o app pode servir de subpath. */
const MAP_URL = './';
/** "Sair da calibracao" devolve ao seletor de projetos, que e de onde se chega a Administracao. */
const PROJECTS_URL = './projetos.html';

const CONFIG_BOOT_ATTEMPTS = 3;
const CONFIG_BOOT_RETRY_MS = 1000;

/**
 * Busca o config de execucao com algumas tentativas. O deploy SEMPRE traz um backend e ele e a
 * fonte unica do config, entao uma queda de verdade nao tem o que renderizar: mostra a tela
 * "EBGeo indisponivel" em vez de uma pagina vazia.
 * @returns {Promise<boolean>} Se o config foi aplicado.
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
 * Recupera o login persistido e espelha no contexto de sessao. Qualquer falha (sem token, refresh
 * vencido, backend fora) limpa os tokens e deixa a sessao anonima.
 * @returns {Promise<boolean>} Se havia sessao a recuperar.
 */
async function restoreSession() {
    try {
        if (!apiClient.loadStoredTokens()) return false;
        const user = await apiClient.getMe();
        sessionContext.setSession({
            userId: user.id,
            role: user.org_role || 'viewer',
            globalRole: user.role || 'user',
            username: user.username || user.nome,
        });
        return true;
    } catch {
        apiClient.clearTokens();
        return false;
    }
}

/** Remove o splash de boot quando a pagina esta pronta para ser vista. */
function clearSplash() {
    document.getElementById('initial-loader')?.remove();
}

/**
 * Encerra a sessao e volta para o mapa.
 * @param {string} [reason] - Levado ao mapa como `?sessao=<reason>` para ele se explicar.
 * @returns {Promise<void>}
 */
async function endSession(reason) {
    try {
        await apiClient.logout();
    } catch {
        // logout() ja engole erro de rede e limpa localmente; nao sobra o que fazer.
    }
    sessionContext.clearSession();
    window.location.replace(reason ? `${MAP_URL}?sessao=${encodeURIComponent(reason)}` : MAP_URL);
}

/**
 * Levanta a pagina de calibracao.
 * @returns {Promise<void>}
 */
async function initCalibracaoPage() {
    configureApiClient({ baseUrl: resolveBackendBaseUrl() });

    if (!(await bootConfig())) {
        showUnavailableScreen();
        return;
    }
    // NAO `initializeAppConfig()`: ele troca o titulo do documento pelo nome cru da app, e aqui
    // isso apagaria "Calibracao 360 — EBGeo" da aba.
    document.title = `Calibração 360 — ${config?.app?.title || 'EBGeo'}`;

    await restoreSession();
    // Gate: a pagina inteira e para admin global. Qualquer outro — deslogado, ou usuario comum que
    // digitou a URL — vai para o mapa, em vez de olhar uma area de trabalho cuja escrita 403.
    // O gate e do CLIENTE e serve a experiencia; quem de fato recusa a escrita e o `auth` do
    // backend, e e ele que continua valendo se alguem contornar esta pagina.
    if (!sessionContext.isAdmin()) {
        window.location.replace(MAP_URL);
        return;
    }

    clearSplash();

    setSessionHandlers({
        // Um 401 numa escrita significa que a sessao morreu de vez (o refresh tambem falhou).
        onAuthLost: () => { endSession('encerrada'); },
        // O operador perdeu o papel `admin` com a sessao aberta e escolheu sair.
        onLeave: () => { window.location.assign(PROJECTS_URL); },
    });

    mountCalibrationWorkspace();

    // Um refresh que falhou de vez (expirado, senha trocada, papel revogado, reuso de token
    // detectado) nao pode deixar o operador calibrando contra 401.
    apiClient.setAuthLostHandler(() => { endSession('encerrada'); });

    // O timeout de inatividade acompanha o operador ate aqui. Sem isto, uma sessao de admin ficaria
    // aberta indefinidamente numa tela que escreve no acervo.
    startIdleWatch({ onExpire: () => { endSession('inatividade'); } });
}

initCalibracaoPage().catch((error) => {
    console.error('Calibration page initialization failed:', error);
    clearSplash();
    showUnavailableScreen();
});
