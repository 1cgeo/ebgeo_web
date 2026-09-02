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
import { showUnavailableScreen, BlockingCause } from '@ui/unavailable-screen.js';
// A MESMA barra de atlas.html e admin.html, pelo arquivo. Ela traz identidade, selo de papel e
// 'Sair' de graca, que era metade do buraco desta pagina; a outra metade (voltar ao catalogo e ir
// para o mapa) entra como acao propria abaixo. 'Minha conta' fica de fora aqui, por opcao.
import { createAppBar } from '@ui/app-bar.js';
// A definicao unica das audiencias de `admin.html`, folha e sem imports. Ela entra aqui porque
// o botao 'Catalogo' e uma PORTA para aquela pagina, e a regra da casa e que quem decide porta
// consome `adminAudience`, nunca um predicado escrito de novo.
import { adminAudience } from '@js/admin/admin-audience.js';
import { EBGEO_LOGO_BASE64 } from '../utilities/logo-base64.js';
// From the FILE, never from the `@utils` barrel: the barrel reaches `@store` transitively.
import { initTabLock, noneKey } from '@utils/tab-lock.js';
import { startIdleWatch } from '../session/idle-watch.js';
// Pelo ARQUIVO, como os vizinhos de `session/` (a pasta nao tem barrel). Best-effort e sem rede na
// instalacao: ver a chamada no topo de `initCalibracaoPage`.
import { instalarTelemetriaDeErro, descarregarFilaDeRelatos } from '@js/session/erro-telemetria.js';
// A IRMA DE USO, logo ao lado: mesma divisao (fiacao aqui, decisao em `uso-lote.js`) e mesma
// promessa de nao participar do boot. Esta pagina nao tem barramento, entao o que ela conta e a
// carga dela propria.
import { instalarUso } from '@js/session/uso-telemetria.js';
// Pelo ARQUIVO, nunca por barrel, que e o que o mantem carregavel numa pagina sem
// `initServices()`. Mesma importacao que `admin-page.js` e `projects-page.js` fazem.
import {
    preserveUnsyncedWorkOnLostSession,
    ExitOutcome,
} from '../session/unsynced-work-exit.js';
// A classificacao de falha de pedido, de um modulo folha e SEM imports: a MESMA definicao que
// `index.js`, `projects/projects-page.js` e `admin/admin-page.js` consomem.
import { classifyRequestFailure, RequestFailure } from '@utils/request-failure.js';
import { mountCalibrationWorkspace, setSessionHandlers, guardCalibrationExit } from './app.js';
// Modulo folha, zero imports: o MAPA le a frase do outro lado do `replace`.
import { CALIBRATION_LOST_PARAM, CalibrationExitParam } from './exit-decision.js';

/** Para onde vai quem nao calibra (ou quem esta deslogado). Relativo: o app pode servir de subpath. */
const MAP_URL = './';
/** "Sair da calibracao" devolve ao seletor de projetos, que e de onde se chega a Administracao. */
const PROJECTS_URL = './atlas.html';

/**
 * O CAMINHO DE VOLTA desta tela: a aba Catalogo do painel, que e de onde se chega aqui.
 *
 * Desde 2026-08-25 a calibracao se alcanca pela LINHA do projeto 360 naquela aba
 * (`admin/catalog-tab.js`), e nao mais por um botao global. Uma ida sem volta e o defeito que
 * isto fecha: quem entrava no estudio so tinha 'Ir para o mapa', que devolve ao EBGeo e nao ao
 * inventario de onde ele veio. Relativa, como as duas acima.
 */
const CATALOG_URL = './admin.html?aba=catalog';

/**
 * O id da aba de Catalogo. Quem recebe a aba e `adminAudience`, e este literal so nomeia qual
 * aba perguntar; escreve-lo aqui nao duplica decisao nenhuma.
 */
const CATALOG_TAB_ID = 'catalog';

/** Icone do botao "Catalogo": pilha de camadas, estatico e sem dado de usuario. */
const CATALOG_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>`;

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
        if (result.applied) {
            // A FILA DE RELATOS SAI AQUI TAMBÉM, e não só no mapa: este é o primeiro instante em
            // que se sabe que o servidor responde. Um `APP_ERROR` desta página guardou o relato
            // num armazenamento que só quem drena esvazia, e esperar que a pessoa abra o mapa
            // para a notícia chegar é atraso sem motivo. Sem `await`: a promessa nunca rejeita.
            descarregarFilaDeRelatos();
            return true;
        }
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
async function endSession(reason, { voluntary = false } = {}) {
    // A CALIBRACAO ABERTA E O PRIMEIRO A SER PERGUNTADO, antes do logout, porque depois do logout
    // nao ha mais como gravar. `guardCalibrationExit` pergunta quando ha alguem no teclado
    // ("Sair agora") e apenas RELATA quando nao ha (expiracao, sessao encerrada pelo servidor):
    // o alinhamento vive so em `calibration/state.js`, entao nao e alcancado pelo resgate de fila
    // abaixo, e o `beforeunload` nao intercepta `window.location.replace`.
    const calib = await guardCalibrationExit({ voluntary });
    if (!calib.proceed) return;

    // A QUARTA PAGINA, e ela ficou para tras. As outras tres passaram a resgatar o trabalho nao
    // enviado antes de encerrar a sessao em 2026-08-23; esta nao, porque e gateada por `isAdmin()`
    // ou `isProducer()` e por isso ficou fora do relatorio do usuario comum. O buraco e o mesmo e
    // nao depende do papel: sem o resgate, a fila pendente e destruida pela varredura de deslogado
    // do boot seguinte, que apaga o namespace com ela dentro.
    //
    // O modulo ja era importavel daqui: `unsynced-work-exit.js` importa por ARQUIVO, nunca por
    // barrel, que e o que o mantem carregavel numa pagina sem `initServices()`.
    const guarda = await preserveUnsyncedWorkOnLostSession();

    try {
        await apiClient.logout();
    } catch {
        // logout() ja engole erro de rede e limpa localmente; nao sobra o que fazer.
    }
    sessionContext.clearSession();

    // O CODIGO, E NAO A FRASE, como nas outras duas: `replace` mata qualquer toast levantado logo
    // antes, entao o desfecho viaja como valor e o mapa remonta a sentenca.
    const params = new URLSearchParams();
    if (reason) params.set('sessao', reason);
    if (guarda.outcome && guarda.outcome !== ExitOutcome.NADA) {
        params.set('trabalho', guarda.outcome);
        if (guarda.pendingOps) params.set('pendentes', String(guarda.pendingOps));
    }
    // PARAMETRO PROPRIO, e nao mais um valor de `trabalho`: aquele carrega o vocabulario de
    // `ExitOutcome`, que e sobre a fila de sync. Sao duas perdas de dois subsistemas diferentes, e
    // colapsa-las num parametro so daria a frase errada para uma das duas.
    if (calib.lost) params.set('calibracao', CALIBRATION_LOST_PARAM);
    const qs = params.toString();
    window.location.replace(qs ? `${MAP_URL}?${qs}` : MAP_URL);
}

/**
 * Levanta a pagina de calibracao.
 * @returns {Promise<void>}
 */
/**
 * A chave de sessao onde a foto pedida fica guardada quando o gate recusa a entrada.
 *
 * Por ABA (`sessionStorage`, como o `LOCAL_INTENT_KEY` de `projects-page.js`) e nao por origem: e
 * a intencao DESTA visita, e vazar para outra aba mandaria o operador para uma foto que ele nao
 * pediu ali.
 */
const FOTO_PEDIDA_KEY = 'ebgeo.calibracao.foto-pedida';

/**
 * Recusa a entrada na calibracao, dizendo POR QUE e sem jogar fora a foto pedida.
 *
 * A recusa anterior era `window.location.replace(MAP_URL)` seco: o mesmo desfecho mudo para quem
 * nao tem o papel e para quem nem entrou, e o `?photo=` que trouxe o operador ate aqui morria no
 * caminho. Sao duas pessoas diferentes com dois proximos passos diferentes, e uma delas so
 * precisa entrar na conta.
 *
 * A foto e guardada ANTES do `replace` e relida no boot seguinte desta mesma aba, o que torna o
 * caminho 'entrei na conta e abri o endereco de novo' um caminho que funciona, em vez de uma
 * frase simpatica. Sem consumidor, guardar seria lixo.
 * @returns {void}
 */
function refuseCalibrationEntry() {
    const foto = new URLSearchParams(window.location.search).get('photo');
    try {
        if (foto) sessionStorage.setItem(FOTO_PEDIDA_KEY, foto);
    } catch {
        // Aba privada ou armazenamento bloqueado: perder a foto e o pior caso aceitavel aqui, e
        // nao pode custar a explicacao, que e a parte que importa.
    }
    const motivo = sessionContext.isAuthenticated()
        ? CalibrationExitParam.SEM_PAPEL
        : CalibrationExitParam.SEM_SESSAO;
    window.location.replace(`${MAP_URL}?calibracao=${motivo}`);
}

/**
 * Devolve a foto guardada por uma recusa anterior DESTA aba, consumindo-a.
 *
 * Consome na leitura de proposito: a intencao vale uma vez. Deixa-la de pe faria a proxima visita
 * deliberada ao seletor de projetos saltar para uma foto que ninguem pediu desta vez.
 * @returns {string|null}
 */
function takeRequestedPhoto() {
    try {
        const foto = sessionStorage.getItem(FOTO_PEDIDA_KEY);
        if (foto) sessionStorage.removeItem(FOTO_PEDIDA_KEY);
        return foto || null;
    } catch {
        return null;
    }
}

async function initCalibracaoPage() {
    // A TELEMETRIA DE ERRO PRIMEIRO, como nas outras tres paginas, e aqui ela vale ainda mais: o
    // gate manda para o mapa quem nao calibra, entao um erro levantado antes dele so existe nesta
    // aba e por um instante. Sincrona, sem rede, e nada abaixo depende dela.
    instalarTelemetriaDeErro();
    // Logo depois da de erro, e pela mesma razao de ordem: `pagina.vista` e o denominador de todo
    // o resto, e uma pagina que morra antes de desenhar continua tendo sido uma carga de pagina.
    instalarUso();

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
        refuseCalibrationEntry();
        return;
    }

    // ENTROU NA CONTA E VOLTOU: recupera a foto que a recusa anterior guardou, reescrevendo a URL
    // ANTES de `mountCalibrationWorkspace()`, que e quem le `?photo=`. `replaceState` e nao
    // `assign`: nao ha por que recarregar uma pagina que acabou de bootar.
    if (!new URLSearchParams(window.location.search).get('photo')) {
        const pedida = takeRequestedPhoto();
        if (pedida) {
            const params = new URLSearchParams(window.location.search);
            params.set('photo', pedida);
            window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
        }
    }

    // Joins the multi-tab channel holding NOTHING (`tab-lock.js`, section 1: the arbitration is
    // over which tab may hold which ATLAS, and this page holds none). So it never blocks and is
    // never blocked, which is what keeps "map in one tab, calibration in another" working; it
    // stays visible in every peer's roster, which is the whole point of announcing. No overlay: a
    // page that cannot be blocked has nothing to render, and it does not load `tab-lock.css`.
    // Announced only past the gate, so a tab that is about to redirect does not join and leave.
    initTabLock({ key: noneKey(), overlayHost: null });

    clearSplash();

    // A BARRA, e ela e a unica identidade desta pagina. Antes, `calibracao.html` nao tinha
    // cabecalho nenhum: zero ocorrencias de barra, selo de papel, nome de OM ou 'Minha conta' em
    // toda a pasta. O operador nao sabia em que conta estava, e o unico botao de sair era o
    // '← Projetos', que volta ao seletor INTERNO e nao sai da calibracao.
    //
    // Ela SOBREPOE o viewer (ver calibracao.css, secao BARRA SUPERIOR): empurrar o viewer para
    // baixo mudaria a razao de aspecto do canvas, que e o que garante que a projecao aqui seja
    // identica a do visualizador 360 do mapa.
    //
    // 'MINHA CONTA' SAI E 'CATALOGO' ENTRA, e so nesta pagina. Decisao do chefe, 2026-08-25: a
    // conta nao e destino util de quem esta calibrando, e o que faltava era o caminho de VOLTA
    // para a aba de onde se chega aqui. Quem tira a porta da conta e a OPCAO `showAccount`, nunca
    // um `if` sobre o nome do arquivo dentro de `app-bar.js`: aquela barra serve quatro paginas e
    // nao conhece nenhuma. As outras tres continuam com 'Minha conta' por nao passarem a opcao.
    //
    // E QUEM DECIDE A PORTA NOVA E `adminAudience`, e nao o gate desta pagina. As duas dao o mesmo
    // resultado hoje (as duas audiencias que calibram recebem a aba `catalog`), e nao e por isso
    // que a linha e assim: um recorte futuro daquela aba passa a valer aqui sem ninguem lembrar
    // deste arquivo, que e a razao de a definicao ser unica.
    const audiencia = adminAudience({
        isAuthenticated: sessionContext.isAuthenticated(),
        isAdmin: sessionContext.isAdmin(),
        isProducer: sessionContext.isProducer(),
    });

    const acoes = [];
    if (audiencia.tabIds.includes(CATALOG_TAB_ID)) {
        acoes.push({
            label: 'Catálogo',
            icon: CATALOG_ICON,
            testid: 'calibracao-catalogo',
            title: 'Voltar ao catálogo 360, onde fica a linha deste projeto',
            // PASSA PELO GUARDA pela mesma razao do botao ao lado: e saida da pagina.
            onClick: async () => {
                const { proceed } = await guardCalibrationExit({ voluntary: true });
                if (proceed) window.location.assign(CATALOG_URL);
            },
        });
    }
    acoes.push({
        label: 'Ir para o mapa',
        testid: 'calibracao-sair',
        title: 'Sair da calibração e voltar ao EBGeo',
        // PASSA PELO GUARDA, como o botao '← Projetos': sair da pagina com alinhamento nao
        // gravado e a mesma perda, e `beforeunload` nao intercepta navegacao programatica.
        onClick: async () => {
            const { proceed } = await guardCalibrationExit({ voluntary: true });
            if (proceed) window.location.assign(MAP_URL);
        },
    });

    const barra = createAppBar({
        logo: EBGEO_LOGO_BASE64,
        title: 'Calibração 360',
        subtitle: config?.app?.title || 'EBGeo',
        user: { id: sessionContext.userId, name: sessionContext.username },
        showAccount: false,
        actions: acoes,
        onLogout: () => { endSession('saida', { voluntary: true }); },
    });
    document.body.prepend(barra.element);

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
    startIdleWatch({
        onExpire: () => { endSession('inatividade', { voluntary: false }); },
        // "Sair agora" nao e expiracao: motivo proprio, e o mapa nao pede login de volta.
        onLeaveNow: () => { endSession('saida', { voluntary: true }); },
    });
}

initCalibracaoPage().catch((error) => {
    console.error('Calibration page initialization failed:', error);
    clearSplash();
    // ERRO DE APLICACAO, nao de rede: o servidor JA respondeu (o `bootConfig` acima passou).
    // Anunciar falha de conexao aqui manda a pessoa depurar a internet dela por um defeito do
    // programa, que era exatamente o que esta tela fazia.
    showUnavailableScreen(BlockingCause.APP_ERROR);
});
