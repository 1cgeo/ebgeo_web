// Path: js/calibration/calibracao-page.js

/**
 * @module calibration/calibracao-page
 * @description Ponto de entrada de `calibracao.html` — a area de trabalho autonoma de calibracao
 * 360.
 *
 * O QUE E OBRA NOVA AQUI. A app de calibracao veio do ebgeo_360, onde ela NAO TEM AUTENTICACAO
 * NENHUMA: la ela escreve direto, sem credencial. Neste backend toda escrita do modulo 360 passa
 * por `auth` estrito, e quem escreve e o administrador global OU o PRODUTOR da OM dona do projeto
 * (`canWriteProject`, eixo de producao). Este arquivo e o unico lugar onde essa regra existe do
 * lado do cliente, e ele nao veio da origem.
 *
 * O gate daqui e o par de PAPEIS; a OM e decidida projeto a projeto pelo servidor, que so lista e
 * so aceita escrita no que aquele operador mantem. Um gate por OM aqui seria uma segunda copia do
 * predicado, e a copia e que envelhece errado. (Ate esta fase a regra era `admin` e mais nada,
 * porque a escrita do 360 dependia de `org_role`, que deixou de autorizar.)
 *
 * Boot, na ordem (o mesmo encadeamento de `admin-page.js`):
 *   1. Config — `GET /api/config`, fail-fast com tentativas. E dele que sai o
 *      `streetView360.serviceUrl` que o cliente da calibracao usa como prefixo.
 *   2. Sessao — recupera os tokens persistidos e valida contra o backend.
 *   3. Gate — admin global ou produtor; qualquer outro vai para o mapa.
 *   4. Monta — levanta a area de trabalho e liga o ciclo de vida da sessao.
 *
 * Sem `@store` alem do cliente HTTP e do contexto de sessao, e sem `initServices()`: a pagina nao
 * tem mapa, nem store, nem MapLibre do EBGeo. Puxar `@utils` ou `@modals` aqui traria a fundacao
 * do mapa inteira de volta pela porta dos fundos.
 */

import config from '@js/config.js';
import { applyRuntimeConfig, resolveBackendBaseUrl } from '@store/sync/runtime-config.js';
import { apiClient, configureApiClient } from '@store/sync/api-client.js';
import { sessionContext, sessionUserInfoFromMe } from '@store/sync/session-context.js';
import { showUnavailableScreen } from '@ui/unavailable-screen.js';
// From the FILE, never from the `@utils` barrel: the barrel reaches `@store` transitively.
import { initTabLock, noneKey } from '@utils/tab-lock.js';
import { startIdleWatch } from '../session/idle-watch.js';
// A classificacao de falha de pedido, de um modulo folha e SEM imports: a MESMA definicao que
// `index.js`, `projects/projects-page.js` e `admin/admin-page.js` consomem.
import { classifyRequestFailure, RequestFailure } from '@utils/request-failure.js';
import { mountCalibrationWorkspace, setSessionHandlers } from './app.js';

/** Para onde vai quem nao calibra (ou quem esta deslogado). Relativo: o app pode servir de subpath. */
const MAP_URL = './';
/** "Sair da calibracao" devolve ao seletor de projetos, que e de onde se chega a Administracao. */
const PROJECTS_URL = './atlas.html';

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
 * Recupera o login persistido e espelha no contexto de sessao.
 *
 * SO UMA FALHA DE CREDENCIAL (401/403) APAGA O TOKEN. Ate 2026-08-23 este `catch` era nu, byte a
 * byte igual aos de `projects/projects-page.js` e `admin/admin-page.js`, e as tres paginas foram
 * escritas assim pelo mesmo motivo: cada uma copiou a anterior. Um 502 do proxy, um pico de
 * latencia ou um 429 deslogava em definitivo, e o desfecho e terminal para quem nao sabe a senha
 * de cor.
 *
 * ESTA FOI A QUARTA PAGINA, e ela escapou da correcao das outras tres porque o censo que protege
 * a credencial era uma lista de alvos escrita a mao. Conferir um subconjunto e trata-lo como o
 * conjunto e a classe mais repetida do livro-razao, e ela cobrou de novo aqui.
 *
 * @returns {Promise<boolean>} Se havia sessao a recuperar.
 */
async function restoreSession() {
    try {
        if (!apiClient.loadStoredTokens()) return false;
        const user = await apiClient.getMe();
        sessionContext.setSession(sessionUserInfoFromMe(user));
        return true;
    } catch (error) {
        if (classifyRequestFailure(error) === RequestFailure.CREDENTIAL) {
            apiClient.clearTokens();
        } else {
            // Servidor fora do ar nao e "voce nao esta logado". A pagina cai no gate abaixo e manda
            // para o mapa, que e o desfecho que ela ja tinha para quem nao calibra; o que muda e
            // que a credencial fica no disco, entao um F5 depois que o servidor voltar reencontra
            // a sessao em vez de exigir login novo.
            console.warn('[calibracao] restauracao de sessao adiada (servidor inalcancavel):', error);
        }
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
    // Gate: admin global calibra qualquer projeto; PRODUTOR calibra os da OM que ele mantem.
    // Qualquer outro — deslogado, ou usuario comum que digitou a URL — vai para o mapa, em vez de
    // olhar uma area de trabalho cuja escrita 403.
    // O gate e do CLIENTE e serve a experiencia; quem de fato recusa a escrita e `canWriteProject`
    // no backend, POR OM DONA DO PROJETO, e e ele que continua valendo se alguem contornar esta
    // pagina. Por isso o gate aqui e o par de papeis, e nao a OM: um produtor que abra a area de
    // trabalho ve so os projetos que o servidor lhe entrega.
    if (!sessionContext.isAdmin() && !sessionContext.isProducer()) {
        window.location.replace(MAP_URL);
        return;
    }

    // Joins the multi-tab channel holding NOTHING (`tab-lock.js`, section 1: the arbitration is
    // over which tab may hold which ATLAS, and this page holds none). So it never blocks and is
    // never blocked, which is what keeps "map in one tab, calibration in another" working; it
    // stays visible in every peer's roster, which is the whole point of announcing. No overlay: a
    // page that cannot be blocked has nothing to render, and it does not load `tab-lock.css`.
    // Announced only past the gate, so a tab that is about to redirect does not join and leave.
    initTabLock({ key: noneKey(), overlayHost: null });

    clearSplash();

    setSessionHandlers({
        // Um 401 numa escrita significa que a sessao morreu de vez (o refresh tambem falhou).
        onAuthLost: () => { endSession('encerrada'); },
        // O operador perdeu o papel que calibra (admin ou produtor) com a sessao aberta e saiu.
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
