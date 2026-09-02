// Path: js/index.js

/**
 * @module index
 * @description Application entry point.
 *
 * Orchestrates initialization in explicit sequential phases:
 * 1. Config — Apply app title, attach config helpers
 * 1.5. Verify — consume a one-shot `?verify=` e-mail confirmation (it speaks before the map)
 * 2. Services — EventBus, StateManager, LayerManager, GroupManager
 * 3. Map — MapLibre GL instance with tile error handling
 * 4. Controls — All tools, UI components, control registrations
 * 5+6. State + UI — IndexedDB load, map load handler, deep linking
 */

import { initializeAppConfig } from './config-loader.js';
import { initConfigHelpers } from './config.helpers.js';
import { applyRuntimeConfig, resolveBackendBaseUrl } from '@store/sync/runtime-config.js';
import { syncEngine } from '@store/sync/sync-engine.js';
import { apiClient } from '@store/sync/api-client.js';
import { cleanup3DFeatures } from './3d_models_viewer_tool/index.js';
import { cleanupFirstPersonFeatures } from '@js/first_person_3d_tool/index.js';
import { initServices, loadStoreOrigin, markStoreRemote, clearAllDataStore, activateAtlasInitialMap, activateRemoteAtlas, getControl, getEventBus } from './store';
import { installTabLockSyncBrake } from '@store/sync/tab-lock-sync-brake.js';
import { EventTypes } from '@events/event_types.js';
import { sessionContext, sessionUserInfoFromMe } from '@store/sync/session-context.js';
import { refreshVisibleResources } from '@store/sync/resource-access.service.js';
import {
    openRemoteAtlas,
    currentAtlasLockKey,
    syncAtlasLockKey,
    deferAtlasOpen,
    resumeDeferredAtlasOpen,
    retractAtlasClaim,
    clearMountedAtlasIfGranted,
    remoteMountWitness,
    switchToNewLocalAtlas,
    switchAtlas,
} from './account/open-atlas.service.js';
import { parseAtlasLink, setPendingAtlasLink, clearAtlasUrl } from './deep-link/atlas-link.js';
import { publicLinkFailureNotice, shouldForgetPublicLink } from './deep-link/public-link-phrases.js';
// From the FILE, never from the `@utils` barrel: `atlas.html` and `admin.html` consume the same
// definition and boot without the store.
import { classifyRequestFailure, isCredentialFailure } from '@utils/request-failure.js';
import { hasLocalMapIntent } from './deep-link/local-intent.js';
import { shouldRouteToProjects } from './deep-link/route-decision.js';
import { parseDeepLink } from './deep-link/parse.js';
import { consumePendingEbgeoImport } from './deep-link/pending-import.js';
import { initAtlasUrlSync } from './deep-link/atlas-url-sync.js';
import { IdleTimeoutController } from './session/idle-timeout.controller.js';
import { exitOutcomeNotice } from './session/unsynced-work-phrases.js';
// Pelo ARQUIVO, de um módulo folha com zero imports: é a página de CALIBRAÇÃO que escreve este
// parâmetro, e o mapa é quem tem de o explicar, porque `replace` mata todo toast levantado lá.
import { calibrationExitNotice } from './calibration/exit-decision.js';
import { emailVerificationNotice } from './session/email-verification-phrases.js';
import { sessionRestoreNotice } from './session/session-restore-phrases.js';
import { showVisitorBanner, destroyVisitorBanner } from './session/visitor-banner.js';
// Pelo ARQUIVO (a pasta `session/` não tem barrel), e de um módulo que não participa do boot: ver
// a chamada no topo de `initApp`.
import {
    instalarTelemetriaDeErro, relatarErro, descarregarFilaDeRelatos,
} from './session/erro-telemetria.js';
// Pelo ARQUIVO, pelo mesmo motivo do vizinho acima. SÓ O MAPA o importa: as outras três páginas
// bootam sem `initServices()` e portanto sem barramento, e as migalhas delas vêm dos alimentadores
// que não dependem dele (API, console, navegação).
import { instalarMigalhasDoBarramento } from './session/migalhas-do-barramento.js';
import { OrigemDeErro } from './session/origens-de-erro.js';
import { getViewModeController } from '@ui/view-mode.controller.js';
import { showToast } from '@utils';
import { createMap, createControls, initializeApp, setupCleanupHandlers } from './map_sig.js';
import { hideLoadingScreen } from '@ui/loading-screen.js';
import { initTabLock, isTabLockBlocked, acquireTabLock, remoteAtlasKey } from '@utils/tab-lock.js';
import { installWindowBridge, setTracing, resolveTraceFlag } from '@store/sync/diag/trace-core.js';
import { showUnavailableScreen } from '@ui/unavailable-screen.js';

// ============================================================================
// BOOTSTRAP
// ============================================================================

/**
 * Main application initialization.
 * Runs phases sequentially — no side-effects at import time.
 */
async function initApp() {
    // Phase -2: TELEMETRIA DE ERRO, e ela é a primeira linha do boot de propósito: o erro que mais
    // custa a diagnosticar é justamente o de boot, e um capturador instalado depois das fases não
    // vê nenhum deles. Síncrona, sem rede e best-effort: ela não participa desta função em mais
    // nada, e o fail-fast do `GET /api/config` mais abaixo continua sendo o único portão do mapa.
    instalarTelemetriaDeErro();

    // Capture the URL deep-link params at the VERY TOP, before any async boot work. The store boot
    // (initializeWithLastActiveMap, kicked off inside initializeApp) and initAtlasUrlSync emit
    // MAP_LOCK_CHANGED early, and atlas-url-sync strips `?atlas` for an anonymous visitor — so reading
    // the URL later (in the boot router below) loses the link and the login prompt never opens.
    // Reading here, before the first await, is the only point guaranteed to still see the original URL.
    const bootPublicLink = new URLSearchParams(window.location.search).get('atlasPublico');
    const bootAtlasLink = parseAtlasLink();

    // A VISTA COMPARTILHADA (`#view=base`) e capturada aqui e aplicada la embaixo, no `finally` do
    // roteamento. Ela nao pode ser lida no ponto de uso porque `handleDeepLink` limpa o hash muito
    // antes (dentro do manipulador de `load`), e nao pode ser APLICADA no ponto de leitura porque a
    // camera 2D ainda vai ser movida duas vezes: por `renderBootMap` ou por `openRemoteAtlas`, e os
    // dois terminam em `applyMapSavedPosition`. Aplicada cedo, ela e sobrescrita em silencio.
    //
    // `parseDeepLink` vem de `parse.js`, e nunca de `deep-link.js`: aquele arrasta `@store` e o
    // barril `@utils` para o pedaco de boot, que e a razao de a leitura morar separada.
    const bootSharedView = parseDeepLink();

    // Phase -1: page routing. A signed-in visitor arriving at a bare `/` is here to CHOOSE a
    // project, so send them to the chooser page BEFORE building a map they did not ask for — that
    // is the whole point of `atlas.html` being a page. Everything else stays on the map: a deep
    // link (`?atlas`/`?atlasPublico`, or a `#view=` viewer link), a one-shot `?verify`, an explicit
    // "Mapa local", or nobody signed in at all. The rule itself lives in `route-decision.js`, where
    // a test can reach it.
    //
    // Reads the token WITHOUT validating it: validation costs a round trip, and `atlas.html`
    // validates on arrival anyway — a token the server rejects is cleared there and the page sends
    // the user back here, now anonymous. That is what keeps the two redirects from ping-ponging.
    if (shouldRouteToProjects(bootAtlasLink, bootPublicLink, apiClient.hasStoredTokens())) {
        window.location.replace('./atlas.html');
        return;
    }

    // Phase 0: SyncLedger observability — install the window.__ebgeoSyncTrace bridge and
    // enable capture only if a trace flag is present (?trace=sync / localStorage['ebgeo_trace']
    // / a globalThis.__EBGEO_TRACE__ set by Playwright addInitScript). Flag-gated and zero-cost
    // when off; fully fail-safe so it never blocks boot.
    try {
        installWindowBridge();
        setTracing(resolveTraceFlag());
    } catch (error) {
        console.warn('SyncLedger trace bridge init failed:', error);
    }

    // Phase 1: Config. The deploy ALWAYS ships a backend and it is the SINGLE source of
    // config/catalog (the bundled config.js is just a shell hydrated by /api/config). Boot is
    // FAIL-FAST: if /api/config is unreachable there is nothing to run on, so we show the branded
    // "EBGeo indisponível" screen and stop instead of booting on an empty/stale config.
    try {
        syncEngine.configure({ baseUrl: resolveBackendBaseUrl() });
    } catch (error) {
        console.warn('Sync engine configuration failed:', error);
    }
    // Fetch the backend config with a few retries — a transient blip at boot must not take the app
    // down. Only a real outage (all attempts fail) reaches the branded unavailable screen.
    const CONFIG_BOOT_ATTEMPTS = 3;
    const CONFIG_BOOT_RETRY_MS = 1000;
    let runtimeConfig = { applied: false };
    for (let attempt = 1; attempt <= CONFIG_BOOT_ATTEMPTS; attempt++) {
        runtimeConfig = await applyRuntimeConfig({ apiClient });
        if (runtimeConfig.applied) break;
        if (attempt < CONFIG_BOOT_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, CONFIG_BOOT_RETRY_MS));
        }
    }
    if (!runtimeConfig.applied) {
        showUnavailableScreen();
        return;
    }

    // AQUI, E NÃO ANTES: este é o primeiro instante do boot em que se SABE que o servidor responde,
    // e a fila de relatos guarda justamente o que não conseguiu sair numa carga anterior (o caso
    // que ela existe para cobrir é este `applyRuntimeConfig` ter falhado da última vez). Mandar
    // antes seria gastar pedido contra um servidor que ainda não respondeu. Sem `await`: o boot não
    // espera pela telemetria, e a promessa nunca rejeita.
    descarregarFilaDeRelatos();

    initializeAppConfig();
    initConfigHelpers();

    // Phase 1.5: an e-mail-confirmation link (`?verify=<token>`), anonymous and one-shot.
    //
    // AS CEDO QUANTO ELE PODE RODAR, e não mais cedo. Quem clica num link de confirmação de
    // e-mail veio ler UMA frase; até 2026-08-24 ele a lia depois de `createControls` ter sido
    // aguardado (preflight de streetview incluído) e depois do controlador de modo de visão, ou
    // seja, depois de o mapa inteiro montar. (A auditoria original dizia "depois do
    // `bootRendered`", o que é falso: a chamada estava antes dele. O atraso medido é o dos
    // controles, que é grande o bastante sozinho.)
    //
    // O PISO É `applyRuntimeConfig`: `apiClient` não tem URL de base antes dela, então esta é a
    // primeira linha do boot em que a chamada pode existir. `showToast` só precisa de
    // `document.body`, que um módulo diferido já tem; e a rota é `auth: false`, então ela não
    // depende da restauração de sessão que vem abaixo.
    //
    // AS TRÊS INVARIANTES DA ORDEM DO BOOT CONTINUAM: `?verify=` é consumido ANTES da cadeia
    // (`openPublicAtlasFromUrl` → `openAtlasFromUrl` → `enterLocalMapOnBoot` →
    // `openAtlasChooserOnBoot`); ele é consumido DEPOIS da Fase -1, que precisa ver o parâmetro
    // na URL para manter este boot no mapa (`shouldRouteToProjects`); e ele continua sendo o
    // PRIMEIRO dos parâmetros de uma vez só a falar, antes de `?sessao=`/`?trabalho=`.
    await handleEmailVerificationFromUrl();

    // Phase 2: Services (EventBus, StateManager, LayerManager, GroupManager, MapResolver)
    initServices();

    // AS MIGALHAS DO BARRAMENTO, e este é o primeiro instante em que elas podem existir:
    // `getEventBus()` não responde antes de `initServices()`. Uma assinatura `onAny` só, com
    // allowlist, idempotente, que nunca quebra a entrega de evento. Ela não participa do boot em
    // mais nada, como a telemetria da Fase -2.
    instalarMigalhasDoBarramento(getEventBus());

    // Keep the address-bar `?atlas=&map=` reconciled with the live connection from here on. Wired
    // early (before session restore / connect) so it reflects every open path; it never clears a
    // pending `?atlas=` deep link while logged-in-but-not-yet-connected (the boot window).
    initAtlasUrlSync();

    // Phase 2.5: Restore a persisted login so the session survives F5 until the JWT/refresh
    // token expires. MUST run before the store boot (initializeApp → initializeWithLastActiveMap)
    // so the boot guard sees the authenticated session and keeps a cached remote atlas rather
    // than discarding it. Fully fail-safe: no stored token, or any error, leaves the anonymous
    // offline path completely unchanged.
    await restoreSessionFromStorage();

    // Phase 3: Map (MapLibre GL instance + tile error handling)
    const { map, analysisLayersManager, dataLayersManager } = createMap();

    // Phase 4: Controls (async — includes streetview preflight check)
    // Start creation but register map.on('load') BEFORE awaiting, to avoid
    // race condition where map fires 'load' during the preflight fetch timeout.
    const controlsPromise = createControls(map, analysisLayersManager, dataLayersManager);

    // ESTE BOOT VAI ABRIR UM ATLAS DE SERVIDOR? A pergunta se responde AQUI, e nao la embaixo no
    // roteamento, porque a resposta muda o que o manipulador de `load` faz.
    //
    // O QUE ELA ECONOMIZA. Com `?atlas=` na barra de enderecos e sessao viva, o unico desfecho
    // ordinario e `openAtlasFromUrl` -> `openRemoteAtlas`, cujo `clearAllDataStore` esvazia o
    // escopo montado. Ate 2026-08-25 o boot montava, migrava, lia para a memoria e DESENHAVA o
    // slot local inteiro antes disso, para apaga-lo em seguida. Medido em A/B pareado nesta
    // bancada, 5 boots de cada lado: porta a porta, mediana de 2515 ms para 1370 ms. A pintura
    // jogada fora custava 125 ms; o resto era a CONTENCAO que ela deixava. A conta por etapa esta
    // no JSDoc de `renderBootMap` (`map_sig.js`).
    //
    // E O QUE A PESSOA VE TAMBEM MUDA. Quem clica num link de atlas de servidor via, por um
    // segundo e meio, o atlas LOCAL dela aparecer e ser substituido. Hoje a cortina fica de pe ate
    // o atlas pedido estar montado, que e o unico conteudo que aquele clique pediu.
    //
    // AS DUAS CORRIDAS QUE `bootRendered` SERIALIZAVA NAO VOLTAM, e a razao e que a serializacao
    // deixa de ser necessaria em vez de ser dispensada. A primeira era o `clearAllDataStore` da
    // abertura remota interlevando com o `switchMap` do manipulador: sem pintura nao ha `switchMap`
    // no manipulador. A segunda era o boot do store deixando um "Principal" local ao lado dos
    // mapas sincronizados (o terceiro mapa fantasma no F5): o `await` de `bootRendered` e de
    // `statePromise` CONTINUA onde estava, entao o boot do store continua terminando antes de
    // qualquer wipe. O que saiu do manipulador foi a pintura, nunca a montagem.
    //
    // A SESSAO PRECISA ESTAR VIVA, e ela ja esta decidida: `restoreSessionFromStorage` roda acima.
    // Sem sessao, `openAtlasFromUrl` guarda o link e abre o login, e ali o mapa local pintado e o
    // fundo certo para a caixa de entrada.
    const abreAtlasDeServidor = Boolean(bootAtlasLink) && sessionContext.isAuthenticated();

    // Phase 5+6: Register map.on('load') handler synchronously — BEFORE 'load' can fire.
    // Capture the local-store boot + initial-render promises so the remote reconnect/open below
    // can await them (so its clearAllDataStore can't race the load handler — see bootRendered).
    const { statePromise, bootRendered, renderBootMap } = initializeApp(map, controlsPromise, {
        pintarSlotLocal: !abreAtlasDeServidor,
    });

    // Wait for controls to finish (preflight + UI setup)
    const controls = await controlsPromise;

    // Cleanup handlers (global error handlers + beforeunload)
    setupCleanupHandlers(controls.destroyables);

    // Session lifecycle guards (logged-in only): idle timeout ends an inactive session with a
    // warning; a terminally-failed refresh drops to anonymous. Both re-open login cleanly. Wired
    // AFTER controls so the account control exists; a boot-time expiry already fell to anonymous.
    //
    // The message no longer says "expirou": since the backend gained a session cut-off
    // (users.sessions_valid_from, backend migration 008), this handler also fires when the
    // server ENDED the session on purpose — a password change, an admin reset, or refresh-token
    // reuse detected, i.e. suspected theft. Telling someone their session "expired" when it was
    // in fact revoked is the wrong thing to read right after someone else touched their account.
    new IdleTimeoutController().init();
    apiClient.setAuthLostHandler(
        () => getControl('account')?.handleSessionLost?.('Sua sessão foi encerrada. Entre novamente.'),
    );

    // Safe view ↔ edit driver: locks a no-edit role to the view profile and powers the "Editar mapa"
    // toggle. Wired after controls so the UI elements are registered with the visibility controller.
    getViewModeController().init();

    // A session that ended on the admin PAGE lands back here with `?sessao=` — say why.
    // (`?verify=` was already consumed in Phase 1.5, above.)
    explainEndedSessionFromUrl();

    // Boot routing precedence (see docs/ui-ux-ebgeo.md §1): a public viewer link wins for an
    // anonymous visitor; then an `?atlas=` deep link (open, or prompt login + resume); otherwise
    // open the atlas CHOOSER — the boot does NOT reconnect the last remote atlas on its own.
    // (`#view=3d/360` is handled
    // earlier in the map-load path and has absolute precedence; `?verify=` ran above.) The links were
    // captured at the very top of initApp — atlas-url-sync has since stripped `?atlas` from the URL
    // for an anonymous visitor, so re-reading it here would be too late.

    // Serialize the boot BEFORE any remote open/reconnect. bootRendered resolves after the load
    // handler rendered the initial map + cleared the splash; awaiting it prevents the remote open's
    // clearAllDataStore from interleaving with the load handler's switchMap (which hangs the splash
    // on a logged-in `?atlas=&map=` deep link) AND with the boot store-init (which could leave a
    // stray local "Principal" alongside the synced maps — phantom 3rd map on F5). The race() caps the
    // wait so a 'load' event that never fires can't deadlock boot. Local IDB only — no network wait.
    await Promise.race([bootRendered, new Promise((resolve) => setTimeout(resolve, 15000))]);
    await statePromise.catch(() => {});

    // Tab lock — announce WHAT THIS TAB HOLDS, and keep announcing it for the rest of the session.
    //
    // It runs HERE, and not right after the controls, for two reasons. The map is already rendered,
    // so an overlay lands on a visible app rather than on a splash; and the store boot (schema
    // migration included) has finished, so the active atlas scope is the real one — announced any
    // earlier the key would name the bridge scope and then silently disagree with the databases
    // this tab actually writes to.
    //
    // Everything below this line either opens an atlas or wipes one, and each of those asks the
    // lock FIRST: with a namespace per atlas, a wipe lands on exactly the databases another tab in
    // the same atlas is writing to.
    initTabLock({ key: currentAtlasLockKey() });
    // The EFFECTS come from the brake, not from a handler written here. Blocking has to STOP the
    // tab (stop the flush, close the socket) and erase nothing, and unblocking has to put back what
    // was stopped — an inline `onBlocked` that stopped without a matching restore is what left a
    // tab unblocked, editable and silently offline after a "Usar aqui" round trip. Awaited because
    // `setEffects` is late-safe: a tab that lost the arbitration in the microtask before this line
    // is stopped right here, and this is where that stop finishes.
    await installTabLockSyncBrake({ replay: resumeDeferredAtlasOpen });
    // The atlas changes LIVE in four flows (login with a pending link, "Enviar ao servidor",
    // logout, a session lost to a 401). These are the same two signals `deep-link/atlas-url-sync.js`
    // listens to, reading the same `syncEngine.atlasId`, so the URL and the lock cannot disagree.
    getEventBus().on(EventTypes.CONNECTION_STATE_CHANGED, syncAtlasLockKey);
    getEventBus().on(EventTypes.SESSION_CHANGED, syncAtlasLockKey);

    installLiveAtlasSwitchHook();

    // A CORTINA CAI EM TODO DESFECHO, e o `finally` e o que faz disso um fato em vez de uma
    // promessa. Quando `pintarSlotLocal` foi false, o manipulador de `load` nao pintou nada e nao
    // baixou a cortina: quem pinta e `openRemoteAtlas`, no caminho feliz. Nos desfechos em que a
    // abertura remota NAO acontece (outra aba segura o atlas, o usuario recusou descartar um
    // resgate, o servidor respondeu 403/404, a sessao caiu no meio), a cortina ficaria de pe para
    // sempre sobre um mapa em branco — que e uma tela travada, nao uma abertura lenta.
    //
    // `renderBootMap` E IDEMPOTENTE E SO CORRE UMA VEZ, entao chama-lo aqui depois de um `?atlas=`
    // bem-sucedido nao repinta nada: `abriuAtlasDeServidor` ja o dispensa, e a idempotencia e o
    // piso caso um caminho novo esqueca de dispensa-lo.
    try {
        // A `.ebgeo` handed over by "Seus atlas" comes FIRST, and it is not a fifth entry in the chain
        // below: it is the completion of a gesture the user already made on the other page, so there is
        // nothing left for the chain to route. It runs after the lock is up, because it both creates an
        // atlas and wipes the mounted scope; and it declines to the chain when a deep link is present,
        // because a `?atlas=` boot is going to open a SERVER atlas and a file must never be imported
        // into one.
        //
        // `createAtlas` IS THE ENTRY INTO A NEW ATLAS, injected rather than imported over there because
        // `pending-import.js` is unit-tested in bare node and this pipeline drags the whole store. It
        // is the same one the in-map import uses when it has to leave a server atlas
        // (`_prepareNonAdditiveTarget`), which is what keeps "who may mount an atlas" a list of one.
        if (await consumePendingEbgeoImport({
            hasDeepLink: Boolean(bootPublicLink || bootAtlasLink),
            getImporter: () => getControl('exportImport'),
            createAtlas: (name) => switchToNewLocalAtlas(name),
            notify: showToast,
        })) return;

        if (await openPublicAtlasFromUrl(bootPublicLink)) return;
        if (await openAtlasFromUrl(bootAtlasLink)) return;
        if (await enterLocalMapOnBoot()) return;
        openAtlasChooserOnBoot();
    } finally {
        // O caminho feliz do `?atlas=` ja pintou o atlas de SERVIDOR (`openRemoteAtlas` termina em
        // `switchMap` mais a releitura de aparencia), entao aqui so falta baixar a cortina. Todo o
        // resto pinta o slot local, que e o que o boot antigo entregava em qualquer desfecho.
        if (_abriuAtlasDeServidor) hideLoadingScreen();
        else await renderBootMap().catch(() => hideLoadingScreen());

        // A VISTA COMPARTILHADA VAI POR ULTIMO, e o lugar dela e aqui pelo mesmo motivo que a
        // cortina cai aqui: e o unico ponto que roda em TODO desfecho da cadeia acima, e depois
        // de a pintura ter movido a camera. O modulo entra por import dinamico porque so este
        // boot precisa dele, e um import estatico o traria (com `@store` e o barril `@utils`)
        // para o pedaco de boot de todo mundo.
        if (bootSharedView?.type === 'base') {
            await import('./deep-link/deep-link.js')
                .then(({ applySharedView }) => applySharedView(bootSharedView))
                .catch((error) => console.warn('[boot] vista compartilhada nao aplicada:', error));
        }
    }
}

/**
 * True depois de `openRemoteAtlas` ter aberto o atlas do deep link.
 *
 * ELE EXISTE PORQUE `openAtlasFromUrl` DEVOLVE `true` EM TRES DESFECHOS DIFERENTES: o atlas abriu,
 * a aba foi bloqueada por outra, e o usuario ainda nao entrou (o login foi pedido). Os tres dizem
 * "assumi o boot", que e a pergunta da cadeia de roteamento; so o primeiro diz "o mapa ja esta
 * pintado", que e a pergunta do `finally` acima. Alargar o retorno daquela funcao para responder
 * as duas coisas mudaria a cadeia inteira por causa de um caso; um sinalizador de modulo com nome
 * proprio responde a segunda pergunta e deixa a primeira em paz.
 */
let _abriuAtlasDeServidor = false;

/**
 * O GANCHO DE MEDICAO DA TROCA AO VIVO. Sem interface, de proposito.
 *
 * PARA QUE ELE EXISTE: `switchAtlas` elimina a recarga da pagina, e a recarga e o custo inteiro
 * da troca (medido: de 1,6 a 2,9 s, com 4203 kB de JavaScript executados no boot do mapa). Uma
 * afirmacao de ganho sem numero e chute, e o numero so sai exercitando a troca no navegador de
 * verdade. Este gancho e o que da a bancada (Playwright, ou o console) acesso ao caminho novo.
 *
 * POR QUE NAO TEM BOTAO, E ISSO AGORA E DECISAO TOMADA, nao pergunta em aberto. A porta VISIVEL
 * existiu entre 2026-08-26 e 2026-08-30, como um modal debaixo do clique de "Seus atlas"
 * (um arquivo atlas-switch.modal.js em modals/, ja removido, sem crase porque nao existe mais), e
 * o dono do produto a RECUSOU em 2026-08-30: aquele
 * gesto voltou a NAVEGAR para `atlas.html`, que e o nome do destino. O que a decisao alcanca e a
 * INTERFACE, nao a capacidade: `switchAtlas` continua de pe, e este gancho continua sendo o unico
 * jeito de exercita-la. Nao construa um seletor novo aqui: seria refazer a porta recusada.
 *
 * ELE E INSTALADO ANTES DO ROTEAMENTO DE BOOT porque cada ramo daquela cadeia sai com `return`:
 * instalado depois, ele so existiria no boot que caisse no seletor de atlas.
 * @returns {void}
 */
function installLiveAtlasSwitchHook() {
    /**
     * @param {'remote'|'local'} kind - Tipo do destino.
     * @param {string} atlasId - Id do atlas (UUID do servidor, ou id do slot local).
     * @param {string|null} [mapId] - Mapa a ativar dentro do destino.
     * @returns {Promise<import('./account/open-atlas.service.js').AtlasSwitchResult>}
     */
    globalThis.__ebgeoSwitchAtlas = (kind, atlasId, mapId = null) =>
        switchAtlas({ kind, atlasId, mapId });
}

/**
 * Honours the "Mapa local" choice by landing on a REAL local workspace.
 *
 * The intent flag alone only stopped the redirect — the IndexedDB store still held the atlas that
 * was open when the user left, so "Mapa local" reopened that atlas's maps and merely looked local.
 * Discarding remote-origin data here is what makes the choice mean what it says; `clearAllDataStore`
 * lands on a blank default map and emits `ALL_DATA_CLEARED`, which repopulates the live sources from
 * it (no features left drawn on the canvas).
 *
 * A store that is ALREADY local is left untouched: that is the offline user's own work.
 *
 * THE WIPE IS GATED, and this path is the reason the gate exists. `ebgeo_local_intent` lives in
 * sessionStorage, and sessionStorage is INHERITED when a tab is duplicated: the duplicate boots
 * carrying the intent, reads the same remote origin, and would erase the namespace the original tab
 * is working in. `clearMountedAtlasIfGranted` asks the lock and AWAITS the answer, which a boot-time
 * read of `isTabLockBlocked()` cannot do (the lock has not heard from anybody yet). Refused, the tab
 * stays blocked with the overlay, and "Usar aqui" replays this same entry.
 * @returns {Promise<boolean>} true when this boot is a local-map boot (the chooser must not run).
 */
async function enterLocalMapOnBoot() {
    if (!hasLocalMapIntent()) return false;
    try {
        const origin = await loadStoreOrigin();
        if (origin.kind === 'remote') await clearMountedAtlasIfGranted(() => enterLocalMapOnBoot());
    } catch (error) {
        console.warn('[boot] local map entry failed:', error);
    }
    return true;
}

/**
 * If the URL carries an atlas deep link (`?atlas=<uuid>[&map=<uuid>]`): when logged in with access,
 * opens that atlas (landing on `&map` when given); when logged out, remembers the target and prompts
 * login (the account control resumes it on success). Returns true when it took over the boot.
 * Best-effort: a connect/permission failure shows a clear message and falls through to the normal path.
 * @returns {Promise<boolean>}
 */
async function openAtlasFromUrl(link = parseAtlasLink()) {
    if (!link) return false;

    if (!sessionContext.isAuthenticated()) {
        // Remember the target and open the login modal; account.control resumes it after auth.
        setPendingAtlasLink(link);
        getControl('account')?.requestLogin?.();
        return true;
    }

    try {
        const opened = await openRemoteAtlas(link.atlasId, { mapId: link.mapId });
        // O atlas de servidor esta montado E pintado (`openRemoteAtlas` termina com `switchMap` e
        // com a releitura de aparencia), entao o `finally` do roteamento nao tem o que pintar.
        if (opened) _abriuAtlasDeServidor = true;
        // User declined the "replace local work" confirm → stay local; drop the deep link so a
        // reconnect doesn't re-open it, and don't fall through to the last-atlas reconnect.
        //
        // A tab BLOCKED by another one is the other `false`, and it must keep the link: the open is
        // only deferred, and "Usar aqui" is about to replay it. Stripping the URL there would leave
        // the address bar denying an atlas this tab is still on its way into.
        if (!opened && !isTabLockBlocked()) clearAtlasUrl();
        return true;
    } catch (error) {
        const status = error?.status ?? error?.statusCode;
        // O 404 aqui cobre DOIS casos que o servidor não distingue de propósito: o atlas
        // não existe, e o atlas existe mas quem pede não tem nenhum vínculo com ele
        // (`resolvePermission` sem linha em `atlas_shares` responde NotFound, para não
        // confirmar a existência a quem não deveria saber). "Atlas não encontrado" seco
        // manda o usuário procurar um erro de digitação num link que está correto; o 403
        // sobrou para o caso estreito de ter compartilhamento com nível insuficiente.
        if (status === 403) showToast('Você não tem acesso a este atlas.', 'error');
        else if (status === 404) showToast('Atlas não encontrado ou sem acesso.', 'error');
        else showToast('Não foi possível abrir o atlas do servidor.', 'error');
        console.warn('[boot] atlas open from URL failed:', error);
        clearAtlasUrl();
        return false; // origin reverted to local in openRemoteAtlas → reconnect is a no-op; land local
    }
}

/** Why a session ended on another page, and how to say it here. */
const ENDED_SESSION_MESSAGES = Object.freeze({
    inatividade: 'Sua sessão expirou por inatividade. Entre novamente.',
    encerrada: 'Sua sessão foi encerrada. Entre novamente.',
    // SAIR DE PROPÓSITO É O TERCEIRO MOTIVO, e ele faltava. O botão "Sair agora" do aviso de
    // inatividade mandava `inatividade`, então quem escolheu sair era informado de que a sessão
    // dele havia EXPIRADO e convidado a entrar de novo: a tela contando uma causa que não
    // aconteceu e desfazendo o gesto. Este ramo não pede login de volta, porque ninguém perdeu
    // nada; ele só confirma o que a pessoa fez.
    saida: 'Você saiu da conta.',
});

/**
 * Explains a session that ended on `atlas.html` or on `admin.html`. Neither page has a login UI of
 * its own, so it revokes the token and sends the user here; without this the user would simply find
 * themselves on an anonymous map with no idea why.
 *
 * TWO DIFFERENT FACTS TRAVEL, and they need two toasts. `?sessao=<motivo>` says WHY the session
 * ended; `?trabalho=<desfecho>` (plus `?pendentes=<n>`) says what became of work the server never
 * received, which is the one the person has to act on. The channel is the query string and not a
 * toast raised before leaving, because `window.location.replace` kills any toast raised just before
 * it.
 *
 * ONLY A CODE TRAVELS, NEVER A SENTENCE. The prose is rebuilt here from the same pure module the
 * other page would have used (`exitOutcomeNotice`), so a hand-edited URL cannot put words in the
 * app's mouth, and the wording lives in one place. One-shot: every parameter is stripped so a
 * reload does not repeat the message, and unknown values are ignored rather than echoed.
 */
function explainEndedSessionFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get('sessao');
    const outcome = params.get('trabalho');
    // TERCEIRO FATO, e ele tem parâmetro próprio: `?calibracao=` fala do alinhamento que vivia só
    // na memória da outra página (perdido, ou nunca começado porque a porta recusou). Misturá-lo
    // com `?trabalho=`, que é o vocabulário da fila de sync, daria a frase errada para um dos dois.
    const calibracao = params.get('calibracao');
    if (!reason && !outcome && !calibracao && !params.has('pendentes')) return;

    const message = ENDED_SESSION_MESSAGES[reason];
    if (message) showToast(message, 'warning');
    // DEPOIS do motivo, porque este é o aviso sobre o qual há algo a fazer.
    const trabalho = exitOutcomeNotice(outcome, params.get('pendentes'));
    if (trabalho) showToast(trabalho.message, trabalho.tone);
    // POR ÚLTIMO, portanto por cima: entre os três, é o único que fala de trabalho que NÃO tem
    // como voltar, ou do próximo passo de quem foi recusado na porta.
    const calib = calibrationExitNotice(calibracao);
    if (calib) showToast(calib.message, calib.tone);

    params.delete('sessao');
    params.delete('trabalho');
    // Apagado mesmo quando `trabalho` não veio: parâmetro solto na barra de endereços sobrevive ao
    // F5, e a limpeza de uma vez só existe justamente para isso.
    params.delete('pendentes');
    params.delete('calibracao');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
}

/**
 * Confirms an account when the URL carries a verification token (`?verify=<token>`). Anonymous and
 * one-shot: shows the outcome as a toast and strips the param so a reload never retries a consumed
 * token. Best-effort: every failure ends in a sentence, never in a thrown boot.
 *
 * IT RETURNS IMMEDIATELY WHEN THERE IS NO TOKEN, and that is what lets it sit in Phase 1.5, ahead
 * of the map: the ordinary boot pays one `URLSearchParams` read for it. Only the boot that HAS a
 * token waits on the round trip, and that boot is here for the sentence, not for the map.
 * @returns {Promise<void>}
 */
async function handleEmailVerificationFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('verify');
    if (!token) return;
    // O CÓDIGO E O PROPÓSITO DECIDEM, e os dois eram jogados fora aqui. Ver o `fileoverview` de
    // `session/email-verification-phrases.js`: a frase única de erro chutava a expiração para as
    // quatro recusas do servidor, e a de sucesso mandava fazer login inclusive para quem estava
    // logado e acabara de trocar o próprio endereço.
    let desfecho;
    try {
        const resposta = await apiClient.verifyEmail(token);
        desfecho = emailVerificationNotice({ ok: true, purpose: resposta?.purpose ?? null });
    } catch (error) {
        desfecho = emailVerificationNotice({ ok: false, code: error?.code ?? null });
    }
    try {
        showToast(desfecho.message, desfecho.tone);
    } finally {
        params.delete('verify');
        const qs = params.toString();
        const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
        window.history.replaceState({}, '', url);
    }
}

/**
 * Removes `?atlasPublico=` from the address bar, preserving every other param and the hash.
 *
 * INLINE, and not through `deep-link/atlas-link.js`, for the same reason `?verify` and `?sessao`
 * are handled inline here: those are one-shot boot params, and `buildAtlasSearch` PRESERVES
 * `atlasPublico` by contract (an anonymous viewer fires disconnect events and must not lose the
 * link they are viewing under). Teaching that function to drop it would put the exception in the
 * function every disconnect goes through, to serve the one branch that has proof.
 */
function forgetPublicAtlasUrl() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('atlasPublico')) return;
    params.delete('atlasPublico');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
}

/**
 * If the URL carries a public viewer link (`?atlasPublico=<link>`) and nobody is logged in, opens
 * that atlas as an anonymous read-only visitor. Returns true if it took over the boot (so the
 * normal last-atlas reconnect is skipped). A failure falls back to the normal path AND SAYS SO.
 *
 * THE TRY IS SPLIT IN TWO, and the split is the whole fix. One `catch` around everything could
 * only report the bare fact of failing, so four different situations (link revogado, link
 * expirado, link digitado errado, atlas excluído) plus every LOCAL failure below (the namespace,
 * the wipe, the socket) collapsed into a single `console.warn` and a generic local map. The first
 * half is the only one that speaks about the LINK, because it is the only one holding the
 * server's answer about it; the second half already has the atlas resolved, so anything it
 * throws is about this browser, and saying "your link is dead" there would be a lie.
 * @returns {Promise<boolean>}
 */
async function openPublicAtlasFromUrl(link = new URLSearchParams(window.location.search).get('atlasPublico')) {
    if (!link || sessionContext.isAuthenticated()) return false;

    let atlas;
    try {
        // RESOLVE FIRST, CLAIM SECOND. `?atlasPublico=` carries a link TOKEN, and the atlas UUID
        // only exists once the server answers — but under the uniform rule the key IS the UUID, so
        // there is nothing honest to claim before this call. Resolving is a read: it opens nothing
        // and destroys nothing, so deferring the claim costs one round trip and no data. (The
        // alternative, claiming under a placeholder id and re-stamping later, collides with the
        // wrong tabs and hands away a claim this tab already holds — see tab-lock.js, section 1.)
        atlas = await apiClient.getPublicAtlas(link);
    } catch (error) {
        console.warn('[boot] public atlas link refused:', error);
        // Nothing was claimed yet (the claim is below, after the resolve), but the retract is kept
        // here anyway: it is what the single catch did for this exact failure before the split, and
        // it is a no-op for a tab that holds nothing remote. Behaviour of the lock is unchanged.
        retractAtlasClaim();
        const kind = classifyRequestFailure(error);
        const notice = publicLinkFailureNotice(kind);
        showToast(notice.message, notice.tone);
        // Only a link the SERVER refused leaves the address bar; see `shouldForgetPublicLink`.
        if (shouldForgetPublicLink(kind)) forgetPublicAtlasUrl();
        return false;
    }

    try {
        apiClient.setEphemeralToken(atlas.publicToken);
        // Now the claim, and it still precedes every destructive step below.
        // A TESTEMUNHA, pelo mesmo motivo dos outros dois sítios destrutivos: `granted` sozinho é
        // concedido por AUSÊNCIA DE PROVA (o settle ouve silêncio e conclui que está só), e três
        // linhas abaixo este caminho chama `clearAllDataStore`. O lock de montagem é fato do
        // navegador e é solto pela MORTE do cliente, nunca pelo silêncio dele, então ele responde
        // onde o canal se cala. `selfHolds` é 0: o namespace público ainda não foi ativado aqui.
        //
        // Este era o QUARTO sítio destrutivo e ficou de fora quando os outros três foram ligados,
        // porque `index.js` não estava na lista de arquivos daquela frente. Um sítio destrutivo
        // sem testemunha é o furo inteiro de volta, num caminho só.
        const claim = await acquireTabLock(remoteAtlasKey(atlas.id), {
            witness: remoteMountWitness(atlas.id),
        });
        if (!claim.granted) {
            // Blocked: the overlay explains it and its "Usar aqui" replays this open.
            deferAtlasOpen(() => openPublicAtlasFromUrl(link));
            return true;
        }
        // The namespace, before the first write into it. A public visit is READ-only for the user
        // and ephemeral by contract, but on disk it is server data like any other: it has to own
        // `ebgeo_*__remote-<atlasId>` and be in the remote registry, or the logged-out purge (which
        // is the only thing that ever collects it, since nobody here logs out) cannot find it.
        // Same reason as `openRemoteAtlas` for coming before the wipe: the claim above already
        // names this atlas, so this is the only namespace this tab may empty.
        await activateRemoteAtlas(atlas.id);
        // `markLocal: false`: this visit mounts a REMOTE atlas two lines down, and the marker is
        // global to the installation. Announcing LOCAL in between is a window in which another
        // tab reads a marker that contradicts what this one has mounted.
        await clearAllDataStore({ markLocal: false });
        await markStoreRemote(atlas.id);
        await syncEngine.connectPublic(atlas.id);
        await activateAtlasInitialMap();
        // A FAIXA SUBSTITUI O TOAST, e não se soma a ele.
        //
        // O toast anterior ('Visualização pública, somente leitura') era o ÚNICO anúncio da visita
        // e durava três segundos; depois deles a única diferença visível era a ausência das barras
        // de ferramenta, que se lê como "ainda está carregando" ou como defeito (achado A2). A
        // faixa diz as mesmas coisas e continua dizendo, mais o NOME do atlas e uma saída.
        //
        // O `false` mantém o anúncio antigo como PISO. Ele não deveria acontecer (a visita já
        // marcou a sessão como visitante em `connectPublic`, três linhas acima), mas se um dia
        // acontecer, o desfecho tem de ser o anúncio velho e não anúncio nenhum: perder a faixa é
        // uma regressão, perder a fala é o defeito original de volta.
        if (!showVisitorBanner(atlas.name)) {
            showToast('Visualização pública, somente leitura', 'info');
        }
        return true;
    } catch (error) {
        console.warn('[boot] public atlas open failed:', error);
        // A failed open must not leave this tab holding the server claim: retract, or nobody else
        // gets to open a server atlas until this tab is closed.
        retractAtlasClaim();
        // The link RESOLVED, so this is a local failure (namespace, wipe, socket, initial map) and
        // the URL keeps the link: it is good, and a reload is the honest retry. The sentence says
        // "neste computador" for the same reason — blaming the link here would send the visitor to
        // ask for a replacement that would fail exactly the same way.
        showToast('Não foi possível abrir este atlas de visualização neste computador. '
            + 'Recarregue a página para tentar de novo.', 'error');
        return false;
    }
}

/**
 * Restores a persisted login: loads the stored tokens, validates them against the backend
 * (transparently refreshing an expired access token), and mirrors the identity into the
 * session context.
 *
 * A CREDENTIAL failure (401/403) clears the tokens. Anything else (timeout, offline, 5xx)
 * KEEPS them and simply boots anonymous for this load — the next F5 recovers the session.
 * Either way the anonymous/offline path is untouched.
 * @returns {Promise<void>}
 */
async function restoreSessionFromStorage() {
    try {
        if (!apiClient.loadStoredTokens()) return;
        const user = await apiClient.getMe();
        sessionContext.setSession(sessionUserInfoFromMe(user));
        // A SOMA DOS RECURSOS PRIVADOS TAMBÉM PRECISA SOBREVIVER AO F5.
        //
        // `syncEngine.login()` a faz no gesto de entrar, e só ali: um recarregamento
        // restaura a sessão por este caminho, que não passa por `login()`. Sem esta
        // linha, o catálogo de quem tem papel global ou concessão perdia todo o
        // privado a cada F5 e só voltava com um logout seguido de login — um sumiço
        // que não deixa erro nenhum e que o usuário lê como "o recurso foi tirado
        // de mim". Sem atlas em foco de propósito: o empréstimo entra depois, em
        // `_applyAtlasSettingsOverlay`, quando houver atlas.
        //
        // Best-effort como todo o resto deste caminho: `refreshVisibleResources`
        // engole a própria falha e devolve `false`, então o boot anônimo/offline
        // continua intocado.
        await refreshVisibleResources(null);
    } catch (error) {
        if (isCredentialFailure(error)) {
            apiClient.clearTokens();
            return;
        }
        console.warn('[boot] session restore deferred (server unreachable):', error);
        // E DIZ ISSO NA TELA, que era a metade que faltava. A restauração adiada por falha
        // transitória deixava o mapa idêntico a "eu nunca entrei": nenhum aviso, nenhuma
        // diferença visível, e a conclusão natural de quem vê é que a conta sumiu. A frase existe
        // desde 2026-08-23 (`session/session-restore-phrases.js`) e tinha UM consumidor,
        // `atlas.html`; o mapa, que é onde a maior parte das pessoas está, continuava mudo.
        //
        // Ela diz, nos ramos transitórios, a coisa que mais importa: a conta continua ativa e
        // nada foi apagado. É por isso que um toast genérico de erro não serviria.
        const aviso = sessionRestoreNotice(classifyRequestFailure(error));
        showToast(aviso.message, aviso.tone);
    }
}

/**
 * Signed in but nothing to open: hand over to the chooser PAGE.
 *
 * Normally Phase -1 already routed this boot away, so the only way here is a fallthrough — an
 * `?atlas=` deep link that failed to open, or a "Mapa local" tab whose session outlived the intent.
 * Discards any remote-atlas data left over from a previous session first, so the user does not
 * leave a disconnected atlas sitting in IndexedDB (clearAllDataStore re-marks LOCAL).
 *
 * Same gate as `enterLocalMapOnBoot`, for the same reason: that "left over" data is left over only
 * from THIS tab's point of view, and another tab may have it open right now. Refused, the chooser
 * does not open either — the tab is blocked, and the overlay is the answer the user needs first.
 *
 * The boot deliberately does NOT reconnect the last atlas: the address bar is the source of truth.
 * @returns {Promise<void>}
 */
async function openAtlasChooserOnBoot() {
    try {
        if (!sessionContext.isAuthenticated()) return;
        const origin = await loadStoreOrigin();
        if (origin.kind === 'remote'
            && !await clearMountedAtlasIfGranted(() => openAtlasChooserOnBoot())) {
            return;
        }
        getControl('account')?.openProjectPicker?.();
    } catch (error) {
        console.warn('[boot] atlas chooser failed:', error);
    }
}

// Start initialization immediately (map container exists in static HTML)
initApp().catch(error => {
    // O `console.error` FICA, e o relato é acrescentado ao lado dele. Ele é o que a pessoa que
    // está com o console aberto lê agora; o relato é o que sobrevive ao fechamento da aba, que é
    // quando quase todo defeito de boot acontece.
    console.error('Application initialization failed:', error);
    relatarErro(error, { origem: OrigemDeErro.BOOT });
});

// ============================================================================
// DOM CONTENT LOADED
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    if (window.performance?.mark) {
        window.performance.mark('app-init');
    }
});

// ============================================================================
// GLOBAL CLEANUP
// ============================================================================

window.addEventListener('beforeunload', () => {
    try {
        cleanup3DFeatures();
    } catch (error) {
        console.warn('Cesium cleanup error:', error);
    }

    // A faixa de visita pública: um assinante do barramento e um listener de clique, soltos aqui
    // pelo mesmo motivo dos dois vizinhos. Ela vive tanto quanto a página de propósito (a única
    // saída da visita é navegar), então este é o único ponto em que ela pode ser desfeita.
    try {
        destroyVisitorBanner();
    } catch (error) {
        console.warn('Visitor banner cleanup error:', error);
    }

    // First-person scene. The barrel wrapper is async (it dynamically imports the
    // viewer), so a failure surfaces as a rejected promise, not as a throw: the
    // try/catch alone would let it escape as an unhandled rejection.
    try {
        Promise.resolve(cleanupFirstPersonFeatures()).catch(error => {
            console.warn('First-person cleanup error:', error);
        });
    } catch (error) {
        console.warn('First-person cleanup error:', error);
    }
});

