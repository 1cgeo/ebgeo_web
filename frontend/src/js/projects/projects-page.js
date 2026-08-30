// Path: js/projects/projects-page.js

/**
 * @module projects/projects-page
 * @description Entry point of `atlas.html` — "Seus atlas", the one place that lists BOTH halves
 * of the product: the atlases stored in this browser and the projects on the server.
 *
 * Signing in used to drop you on the map with a full-screen chooser floating over it; the map you
 * had not chosen yet was already booted behind the dialog, and dismissing it left you in a blank
 * local workspace nobody asked for. As a page, choosing a project happens BEFORE any map exists.
 *
 * IT DOES NOT REQUIRE A SESSION. It used to redirect a signed-out visitor to the map, which meant
 * the named local atlases (a complete store API since the per-atlas namespace phase) had no UI at
 * all for the user the local atlas exists for: the one working offline, or without an account.
 *
 * Like `admin.html`, this boots without MapLibre, without the store and without `initServices()`:
 * the whole surface is the API client, the session context, the runtime config and the dialog/toast
 * primitives. Importing `@store`, or the `@utils`/`@modals` barrels (which reach the store
 * transitively), would silently drag the entire map foundation back in. The local-atlas registry is
 * reached by importing the FILES (`@store/local-atlas.api.js`, `@store/atlas-namespace.js`,
 * `@store/store-origin.js`), which together are nine modules and no store.
 *
 * Opening a project is a NAVIGATION — `./?atlas=<uuid>` for a server atlas, plain `./` for a local
 * one after moving the pointer. The map page's boot router already knows how to open either,
 * including wiping the local store, connecting, and asking what to do with unsaved local work.
 * Duplicating that pipeline here is what the page removes.
 *
 * A `.ebgeo` FILE FOLLOWS THE SAME RULE, and it is the reason this page can be the whole product
 * for somebody with no account: "Abrir arquivo .ebgeo" leaves the bytes in the global database and
 * navigates. It neither parses the archive nor creates the atlas — the map's importer does the
 * first and the map's boot does the second, on the other side of the navigation
 * (`openEbgeoFileAsLocalAtlas`). The signed-in "Importar .ebgeo" of the server section is a
 * DIFFERENT operation (it creates a server atlas) and stays where it is.
 */

import config from '@js/config.js';
import { applyRuntimeConfig, resolveBackendBaseUrl } from '@store/sync/runtime-config.js';
import { apiClient, configureApiClient } from '@store/sync/api-client.js';
import { sessionContext, sessionUserInfoFromMe } from '@store/sync/session-context.js';
// Do ARQUIVO, folha e sem imports: a definição única das audiências de `admin.html`.
import { adminAudience } from '@js/admin/admin-audience.js';
import { showUnavailableScreen, BlockingCause } from '@ui/unavailable-screen.js';
import { createAppBar } from '@ui/app-bar.js';
import { startIdleWatch } from '../session/idle-watch.js';
// Pelo ARQUIVO, como os vizinhos de `session/` (a pasta não tem barrel). Best-effort e sem rede na
// instalação: ver a chamada no topo de `initProjectsPage`.
import { instalarTelemetriaDeErro } from '../session/erro-telemetria.js';
// Por ARQUIVO, nunca por barrel: este modulo alcanca o store por folhas, e e isso que o torna
// importavel de uma pagina que boota sem `initServices()`.
import {
    preserveUnsyncedWorkOnLostSession,
    ExitOutcome,
} from '../session/unsynced-work-exit.js';
import { showError, showSuccess, showWarning } from '@utils/toast_service.js';
// From the FILE, never from the `@utils` barrel: the barrel reaches `@store` transitively.
import { initTabLock, noneKey } from '@utils/tab-lock.js';
// A classificação de falha de pedido, de um módulo folha e SEM imports: é a MESMA definição que
// `index.js` e `admin/admin-page.js` consomem, e a razão de ela ter saído de dentro do mapa.
import { classifyRequestFailure, RequestFailure } from '@utils/request-failure.js';
import { sessionRestoreNotice } from '../session/session-restore-phrases.js';
import { showConfirm, showChoice } from '@modals/confirm.modal.js';
import { PromptModal } from '@modals/prompt.modal.js';
import { showLoginModal } from '@modals/login.modal.js';
// Por ARQUIVO, como os vizinhos: esta página não monta a store, e o barrel `@modals` a arrasta.
import { showSignupModal } from '@modals/signup.modal.js';
// A escada por atlas, de um módulo folha e SEM imports (contrato asserido em
// `tests/unit/permission-levels.test.js`): esta página boota sem a store, então o barrel está fora
// de questão. Nunca uma lista fechada de níveis escrita aqui.
import { isGrantablePermission } from '@js/projects/permission-levels.js';
// The local-atlas registry, by FILE. This is the only module of the page that talks to it, which
// is what `tests/unit/portao-de-montagem.test.js` records for `createLocalAtlas`.
import {
    createLocalAtlas,
    deleteLocalAtlas,
    getCurrentLocalAtlasId,
    initLocalAtlases,
    listLocalAtlases,
    renameLocalAtlas,
    duplicateLocalAtlas,
    scopeOfLocalAtlas,
    setCurrentLocalAtlas,
    MAX_LOCAL_ATLASES,
} from '@store/local-atlas.api.js';
import {
    clearActiveScope,
    getActiveScope,
    savePendingImport,
} from '@store/atlas-namespace.js';
import { loadStoreOrigin, markStoreLocal } from '@store/store-origin.js';
import {
    AtlasDrive,
    LocalAtlasSection,
    arrivalNotice,
    createServerInvite,
    createServerOutage,
} from './atlas-drive.js';
// The refusal-to-sentence rule, in a module a test can reach: this page boots on import, so the
// one property that matters here (a refused local-atlas operation is never a silent no-op) has
// nowhere else to be asserted. See `tests/unit/atlas-local-recusa-chega-ao-usuario.test.js`.
import {
    NoticeKind,
    createNotice,
    createdAtlasToOpen,
    deleteConfirmMessage,
    deleteNotice,
    refusalNotice,
    renameNotice,
    sendToServerNotice,
} from './local-atlas-notices.js';
// The name only, from a module with no imports: the server importer that lives next to it opens
// with `import JSZip`, and this path never parses the archive (the map's importer does).
import { atlasNameFromFilename } from './ebgeo-filename.js';
import { LOCAL_INTENT_KEY } from '../deep-link/local-intent.js';
// The logo the boot splash of this very page already fetched — a URL, not the Base64 the name
// still promises (see the module's own note). By FILE, like everything else here.
import { EBGEO_LOGO_BASE64 } from '../utilities/logo-base64.js';

/** The map page. Relative — the app may be served from a subpath. */
const MAP_URL = './';
const ADMIN_URL = './admin.html';

const CONFIG_BOOT_ATTEMPTS = 3;
const CONFIG_BOOT_RETRY_MS = 1000;

const ICON_MAP = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" opacity="0"/><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>`;
const ICON_ADMIN = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;

/**
 * Fetches the runtime config with a few retries; a real outage gets the branded screen.
 * @returns {Promise<boolean>}
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
 * Restores the persisted login into the session context.
 *
 * ONLY A CREDENTIAL FAILURE (401/403) CLEARS THE TOKENS. Until 2026-08-23 this was a bare
 * `catch { apiClient.clearTokens(); }`, byte for byte the same in `admin/admin-page.js`, so a 502
 * from the proxy, a latency spike, a 429 or a dropped connection signed the user out FOR GOOD —
 * and the outcome is terminal, because the product has no self-service password reset. Worse,
 * this is the DEFAULT path: `shouldRouteToProjects` sends every signed-in visitor arriving at a
 * bare URL here, and this is the first thing the page does.
 *
 * WHAT A NON-CREDENTIAL FAILURE GETS INSTEAD is this page rendered signed-out FOR THIS LOAD, with
 * the tokens intact and a warning that says so. Not the unavailable screen: the local half of
 * this page is the whole product for somebody working offline or without an account, and denying
 * them their own atlases because the server could not confirm somebody's identity would be the
 * larger loss. Not a retry loop either: `bootConfig()` just made up to three successful round
 * trips to `/api/config`, so a `getMe` failing right after is not the millisecond blip a retry
 * fixes, and `getMe` already carries its own boot deadline plus the refresh path. The visitor
 * keeps the manual retry that always worked, and the sentence names it.
 *
 * The old comment claimed the unconditional clear was what stopped a stale token from
 * ping-ponging between this page and the map's boot redirect. It never was: this page does not
 * redirect anybody back to the map, it renders signed-out and stays. The map redirects HERE once
 * and the loop ends here either way.
 *
 * @returns {Promise<boolean>} Whether a session was restored.
 */
async function restoreSession() {
    try {
        if (!apiClient.loadStoredTokens()) return false;
        const user = await apiClient.getMe();
        sessionContext.setSession(sessionUserInfoFromMe(user));
        return true;
    } catch (error) {
        const kind = classifyRequestFailure(error);
        if (kind === RequestFailure.CREDENTIAL) apiClient.clearTokens();
        else console.warn('[projects] session restore deferred (server unreachable):', error);
        // Held, not shown: the splash is still up, and a toast raised under it is a toast nobody
        // reads. `initProjectsPage` says it right after `clearSplash()`.
        pendingSessionNotice = sessionRestoreNotice(kind);
        return false;
    }
}

/**
 * The sentence a failed session restore produced, waiting for the splash to come down.
 * @type {{message: string, tone: string}|null}
 */
let pendingSessionNotice = null;

/** Says the held session-restore sentence, if there is one. One-shot. */
function tellPendingSessionNotice() {
    const notice = pendingSessionNotice;
    pendingSessionNotice = null;
    if (!notice) return;
    if (notice.tone === 'error') showError(notice.message);
    else showWarning(notice.message);
}

/** Removes the boot splash once the page is ready to be seen. */
function clearSplash() {
    document.getElementById('initial-loader')?.remove();
}

/**
 * Explains an arrival the user did not ask for — the atlas they had open was deleted, so the map
 * tore itself down and sent them here with `?aviso=<motivo>`. The message travels in the URL
 * because a toast raised on the map would be destroyed by the navigation that follows it.
 * One-shot: the param is stripped so a reload does not repeat it. Unknown values are ignored
 * rather than echoed.
 *
 * WHAT TO SAY (including "say nothing") is {@link arrivalNotice}, which is pure and where the
 * session gate lives: both codes are facts about a SERVER atlas, and echoing them to a visitor
 * with no account described the ownership of an atlas they never had, off a hand-written URL.
 * The param is stripped either way.
 * @param {boolean} signedIn
 */
function explainArrivalFromUrl(signedIn) {
    const params = new URLSearchParams(window.location.search);
    const notice = params.get('aviso');
    if (!notice) return;
    const message = arrivalNotice(notice, { signedIn });
    if (message) showWarning(message);
    params.delete('aviso');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
}

/**
 * Goes to the map WITHOUT a server project, and records that this was deliberate so the map's boot
 * router does not bounce a signed-in user straight back here. Session-scoped on purpose: the intent
 * belongs to this tab and this sitting, and must not leak into a shared link.
 */
function goToLocalMap() {
    try {
        sessionStorage.setItem(LOCAL_INTENT_KEY, '1');
    } catch {
        // Storage disabled: the map will redirect back here. Annoying, never destructive.
    }
    window.location.assign(MAP_URL);
}

/** Opens an atlas by navigating; the map page's boot router does the rest. */
function openAtlas(atlasId) {
    window.location.assign(`${MAP_URL}?atlas=${encodeURIComponent(atlasId)}`);
}

/** The mounted local section, so a handler can redraw the list after it changed. */
let localSection = null;

/**
 * Says the one sentence a local-atlas operation produced. The DECISION of what to say lives in
 * `local-atlas-notices.js` (pure, tested); this is only the wiring to the toast service.
 * @param {{kind: string, message: string}} notice
 */
function tell(notice) {
    if (notice.kind === NoticeKind.ERROR) showError(notice.message);
    else if (notice.kind === NoticeKind.WARNING) showWarning(notice.message);
    else showSuccess(notice.message);
}

/**
 * Loads the local registry WITHOUT leaving this page holding an atlas.
 *
 * `initLocalAtlases` is not an inert read: it ends in `activateScope`, which takes the shared MOUNT
 * LOCK of that namespace and writes this tab's mount pointer. A chooser sitting there holding the
 * lock is counted by `otherClientHoldsLock` as "another client has this mounted", so a map tab in
 * the same local atlas would have a legitimate wipe REFUSED with "já está aberto em outra aba"
 * while nobody is editing. `clearActiveScope()` gives back both the lock and the pointer.
 *
 * `isAuthenticated: false` is passed EXPLICITLY, and it is not a formality: with a live session and
 * a REMOTE marker, `initLocalAtlases` would go through `activateRemoteAtlas` and mount a server
 * namespace from the chooser, which is a mount nobody asked for.
 *
 * @returns {Promise<{atlases: Array<Object>, currentId: string|null}>}
 */
async function loadLocalAtlases() {
    const origin = await loadStoreOrigin();
    await initLocalAtlases({ origin, isAuthenticated: false });
    const atlases = listLocalAtlases();
    const currentId = getCurrentLocalAtlasId();
    clearActiveScope();
    return { atlases, currentId };
}

/**
 * Redraws the local section from the registry (after a create / rename / delete).
 *
 * `listLocalAtlases` THROWS when the registry was never loaded (its own caller-bug convention), and
 * that is reachable here: the first read can fail, and every handler below ends in this call. The
 * `null` is the section's THIRD state ("did not load"), never an empty list.
 */
function refreshLocalSection() {
    try {
        localSection?.setAtlases(listLocalAtlases(), getCurrentLocalAtlasId());
    } catch (error) {
        console.error('[projects] local atlas registry unreadable:', error);
        localSection?.setAtlases(null, null);
    }
}

/** The sentence said when the local registry cannot be read. Same words in both call sites. */
const REGISTRO_LOCAL_ILEGIVEL = 'Não foi possível ler os atlas deste computador.';

/**
 * "Tentar de novo" from the local section's failure tile: read the registry again and redraw.
 *
 * A FAILED RETRY GOES BACK TO THE FAILURE TILE, not to an empty grid — which is the whole point of
 * the third state surviving `setAtlases`.
 * @returns {Promise<void>}
 */
async function retryLocalAtlases() {
    try {
        const local = await loadLocalAtlases();
        localSection?.setAtlases(local.atlases, local.currentId);
    } catch (error) {
        console.error('[projects] local atlas registry failed:', error);
        localSection?.setAtlases(null, null);
        showError(REGISTRO_LOCAL_ILEGIVEL);
    }
}

/**
 * Opens a LOCAL atlas: move the pointer, then navigate to the bare map. Symmetric to the server
 * side's `./?atlas=<uuid>`, and for the same reason — the map's boot owns mounting.
 *
 * THE ORDER IS THE WHOLE FUNCTION, and each step defuses one silent failure:
 *
 * 1. `markStoreLocal()` FIRST. With the persisted marker still saying REMOTE, the map's
 *    `enterLocalMapOnBoot` calls `clearMountedAtlasIfGranted`, which empties the ACTIVE scope —
 *    and the active scope, by then, is the very slot the user just picked. Declaring LOCAL before
 *    leaving is what stops the open from wiping what it opens.
 * 2. `setCurrentLocalAtlas` moves the installation pointer AND mounts, and the mount is what
 *    rewrites THIS TAB's mount pointer (`atlas-namespace.js`, Decision 6). That pointer BEATS the
 *    installation pointer at the map's boot and survives navigation inside the same tab, so a tab
 *    that came from the map on another slot would reopen that other slot — no error, just the
 *    wrong atlas. Moving only the pointer is therefore not enough.
 * 3. The tab-scoped local intent, or `shouldRouteToProjects` bounces a signed-in user straight
 *    back here.
 *
 * @param {{id: string, name: string}} atlas
 */
async function pointAtLocalAtlasAndGo(atlas) {
    await markStoreLocal();
    const result = await setCurrentLocalAtlas(atlas?.id);
    if (!result.ok) {
        tell(refusalNotice(result));
        return false;
    }
    if (getActiveScope()?.atlasId !== atlas.id) {
        // Defensive, and cheap: nothing mounted means nothing may CLAIM a mount. Dropping the
        // stale pointer lets the installation pointer (just moved above) decide, instead of
        // sending the map to whatever this tab had open before.
        clearActiveScope();
    }
    try {
        sessionStorage.setItem(LOCAL_INTENT_KEY, '1');
    } catch {
        // Storage disabled: the map may redirect back here. Annoying, never destructive.
    }
    window.location.assign(MAP_URL);
    return true;
}

/**
 * "Fazer uma cópia" de um atlas local.
 *
 * ACONTECE AQUI MESMO, sem navegar: copiar é uma operação sobre bancos que ninguém tem montado
 * (`duplicateLocalAtlas` cria o slot e copia chave por chave), então não há por que arrastar o
 * usuário para o mapa. A primeira tentativa fazia o contrário — apontava para a origem, navegava e
 * deixava o mapa copiar por export/import — e cada efeito colateral daquele caminho (o mapa vazio
 * que o wipe cria, a memória do atlas anterior, o reload para desfazer os dois) foi um defeito
 * medido antes de o desenho ser trocado.
 * @param {{id: string, name: string}} atlas
 */
async function duplicateLocalAtlasFromPage(atlas) {
    const name = await askAtlasName({
        // Casa com o rótulo do menu que abre este diálogo (`Duplicar`): eram duas strings
        // diferentes para o mesmo gesto, e nenhuma delas distinguia esta cópia da do servidor.
        title: 'Duplicar',
        defaultValue: `${atlas?.name ?? 'Atlas'} (cópia)`,
        confirmText: 'Copiar',
    });
    if (name === null) return;
    try {
        const result = await duplicateLocalAtlas(atlas.id, name);
        if (!result.ok) {
            tell(refusalNotice(result));
            return;
        }
        showSuccess(`Cópia criada: "${result.atlas.name}".`);
        refreshLocalSection();
    } catch (error) {
        console.error('[projects] local atlas duplicate failed:', error);
        showError('Não foi possível copiar este atlas.');
    }
}

/**
 * "Enviar ao servidor" de um atlas LOCAL. Só aparece com sessão (`localCardMenuActions`).
 *
 * NÃO DESTRUTIVO, E É A DIFERENÇA PARA O IRMÃO DO MAPA. `AccountControl.saveLocalToServer` apaga o
 * store local depois de subir, porque lá o store local É o atlas que subiu, e o wipe é a troca de
 * atlas. Aqui não há atlas montado, e o cartão clicado nem sempre é o slot corrente: apagá-lo seria
 * destruir, sem perguntar, o que a pessoa mandou COPIAR. O cartão continua na lista depois.
 *
 * O DESFECHO É ABRIR O ATLAS DE SERVIDOR, e não redesenhar a lista com ele selecionado. Três
 * razões, em ordem de peso:
 *   - é o que o vizinho mais próximo já faz. `importProjectFromFile` termina em `openAtlas(atlasId)`
 *     depois de `importEbgeoAsAtlas`, que é literalmente a mesma operação com outra fonte;
 *   - é o que "a aplicação passa a apontar para o atlas novo" significa de verdade. Uma lista
 *     redesenhada deixa a pessoa na tela de escolha, e o próximo clique dela é tão capaz de cair no
 *     cartão local quanto no novo, que é o estado que este item existe para tirar;
 *   - abrir é uma NAVEGAÇÃO (`./?atlas=<uuid>`), e o boot do mapa já sabe reivindicar, limpar,
 *     conectar e ativar o mapa inicial (`openRemoteAtlas`, passo 2.7 `activateRemoteAtlas`).
 *     Repetir esse trecho numa página sem store é justamente o que `projects-page.js` remove.
 * O destino sai de `sendToServerNotice`, pura: sem id de servidor ela devolve `null` e a página
 * fica onde está, com a frase na tela, em vez de navegar para `./?atlas=undefined`.
 *
 * O COMPARTILHAMENTO NÃO É PERGUNTADO AQUI, ao contrário do "+ Novo atlas": o atlas nasce privado
 * e cai na lista do servidor, onde "Compartilhar" já é o caminho. Um segundo lugar aplicando
 * `applyAtlasSharing` seria a segunda cópia daquelas regras.
 * @param {{id: string, name: string, dbSuffix: string}} atlas
 */
async function sendLocalAtlasToServerFromPage(atlas) {
    const name = await askAtlasName({
        title: 'Enviar ao servidor',
        defaultValue: atlas?.name ?? 'Atlas',
        confirmText: 'Enviar',
    });
    if (name === null) return;
    try {
        // Por `import()`, como o importador de `.ebgeo` ao lado: nem a transformação nem o leitor
        // de namespace pesam no carregamento de quem só veio escolher um atlas.
        const { sendLocalAtlasToServer } = await import('./send-local-to-server.service.js');
        const result = await sendLocalAtlasToServer(atlas, {
            apiClient,
            scopeOf: scopeOfLocalAtlas,
            name,
        });
        const notice = sendToServerNotice(result);
        tell(notice);
        if (notice.openAtlasId) openAtlas(notice.openAtlasId);
        // Sem destino, a pessoa fica na lista: o cartão local nunca some, então não há o que
        // redesenhar do lado local, e o lado de servidor será relido no próximo boot.
    } catch (error) {
        console.error('[projects] local atlas send to server failed:', error);
        showError(error?.message || 'Não foi possível enviar este atlas ao servidor.');
    }
}

/** Card click / "Abrir": the ordinary way into a local atlas. */
async function openLocalAtlas(atlas) {
    try {
        if (await pointAtLocalAtlasAndGo(atlas)) return;
    } catch (error) {
        console.error('[projects] local atlas open failed:', error);
        showError('Não foi possível abrir este atlas local.');
    }
    refreshLocalSection();
}

/**
 * Said when the ten slots are already taken and the file therefore has nowhere to land. The page's
 * own sentence, not a copy of the API's: the API's ends in "antes de criar outro", and this refusal
 * is about opening a file. The NUMBER comes from the constant, which is the half that could drift.
 */
const SEM_SLOT_PARA_O_ARQUIVO =
    `Limite de ${MAX_LOCAL_ATLASES} atlas locais atingido. Exclua um atlas antes de abrir um arquivo.`;

/**
 * "Abrir arquivo .ebgeo": hands a file on disk to the map, which turns it into a NEW local atlas.
 * Signed out included.
 *
 * THE FILE IS NOT PARSED HERE, and that is the whole shape of this function. The map already owns
 * a `.ebgeo` importer (`import_export/export-import.service.js`, which validates the version,
 * migrates a v1 archive, and restores images, maps, layers, briefings, 3D and 360), and a second
 * one on a page with no store would be a copy that drifts. So the bytes are handed over through
 * the global database (`savePendingImport`) and the map's boot consumes them.
 *
 * AND THE SLOT IS NOT CREATED HERE EITHER, since 2026-08-16. It used to be, and every boot that
 * declined the hand-over (a deep link in the URL, an importer that never registered, a file that
 * fails to parse) left that slot behind — never empty, because the store boot writes a blank
 * `Principal` into it before the decision is even reached, so nothing downstream could tell it from
 * an atlas the user made. The map creates it at the moment it is going to import
 * (`deep-link/pending-import.js` → `switchToNewLocalAtlas`), which is also the pipeline that knows
 * how to leave a SERVER atlas on the way in.
 *
 * WHAT STAYS HERE IS THE CAP, and only as a READ. `listLocalAtlases()` spends nothing, and asking
 * before navigating is the difference between a refusal on the screen the user is looking at and a
 * refusal shouted from a map they were sent to for no reason. The authority is still the API's:
 * `createLocalAtlas` re-checks on the other side, so a race with another tab is refused there.
 *
 * @param {File} file
 */
async function openEbgeoFileAsLocalAtlas(file) {
    try {
        const data = await file.arrayBuffer();

        if (listLocalAtlases().length >= MAX_LOCAL_ATLASES) {
            showError(SEM_SLOT_PARA_O_ARQUIVO);
            return;
        }

        await savePendingImport({ name: atlasNameFromFilename(file?.name), data });
        goToLocalMap();
        return;
    } catch (error) {
        console.error('[projects] .ebgeo open as local atlas failed:', error);
        showError('Não foi possível abrir este arquivo .ebgeo.');
    }
    refreshLocalSection();
}

/**
 * Asks for a name in a dialog of ONE field. Not the create-atlas modal: three of its four sections
 * (public link, members, user search) are server-only, and a search that 401s is what a signed-out
 * visitor would get.
 * @param {Object} options
 * @returns {Promise<string|null>} The trimmed name, or null when cancelled/empty.
 */
async function askAtlasName({ title, defaultValue = '', confirmText }) {
    const typed = await new PromptModal({
        title,
        defaultValue,
        confirmText,
        placeholder: 'Nome do atlas',
        inputTestid: 'local-atlas-name-input',
        confirmTestid: 'local-atlas-name-confirm',
    }).show();
    if (typed == null) return null;
    const trimmed = typed.trim();
    // The API THROWS on an empty name (caller bug, by its error convention), so the empty case is
    // settled here rather than turned into an exception the user cannot read.
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * "+ Novo atlas local". The ceiling is the API's to enforce; this only reports the refusal.
 *
 * CRIA E ABRE desde 2026-08-25. Quem pede um atlas novo quer trabalhar nele, e a lista com um
 * cartão a mais cobrava um segundo clique ("Abrir") que não decidia nada.
 *
 * A NAVEGAÇÃO É DECIDIDA POR `createdAtlasToOpen`, e não por um `openLocalAtlas` escrito na linha
 * seguinte. `createLocalAtlas` RECUSA o décimo primeiro slot, e navegar por cima da recusa é o
 * defeito inteiro: a pessoa não recebeu atlas nenhum, chegaria ao mapa no atlas ANTERIOR, e a
 * frase que explica o teto morreria junto com esta página. Ver o módulo dos avisos.
 *
 * ABRE PELO MESMO CAMINHO DO CARTÃO (`openLocalAtlas`), e isso é o que garante que a página não
 * passa a segurar nada de novo: ela aponta o ponteiro, navega, e o mapa faz o trabalho.
 */
async function createLocalAtlasFromPage() {
    const name = await askAtlasName({ title: 'Novo atlas local', confirmText: 'Criar' });
    if (name === null) return;
    try {
        const result = await createLocalAtlas(name);
        tell(createNotice(result));
        const destino = createdAtlasToOpen(result);
        if (destino) {
            await openLocalAtlas(result.atlas);
            return;
        }
        refreshLocalSection();
    } catch (error) {
        console.error('[projects] local atlas create failed:', error);
        showError('Não foi possível criar o atlas local.');
    }
}

/** Renames a local atlas (registry + the slot's own record, both inside the API). */
async function renameLocalAtlasFromPage(atlas) {
    const name = await askAtlasName({
        title: 'Renomear atlas local',
        defaultValue: atlas?.name ?? '',
        confirmText: 'Renomear',
    });
    if (name === null || name === atlas?.name) return;
    try {
        tell(renameNotice(await renameLocalAtlas(atlas.id, name)));
        refreshLocalSection();
    } catch (error) {
        console.error('[projects] local atlas rename failed:', error);
        showError('Não foi possível renomear o atlas local.');
    }
}

/**
 * Deletes a local atlas, databases and all.
 *
 * The confirmation names the queue on purpose: an atlas's outbound queue dies with its databases,
 * and "there was something unsent in a LOCAL atlas" is not a state a user suspects. IT NAMES IT
 * ONLY TO SOMEBODY WHO HAS AN ACCOUNT, since 2026-08-24: to an anonymous visitor the sentence
 * described a path they never had, and hinted that something in there had been going to the server,
 * against what the section right above promises. The wording is {@link deleteConfirmMessage}.
 *
 * THE "ONLY ATLAS" REFUSAL NEVER REACHES THIS FUNCTION any more: `LocalAtlasSection._attemptDelete`
 * says it on the click, before this dialog is staged. `deleteLocalAtlas` still re-checks.
 *
 * `blockedDatabases` is reported, never swallowed: it means another tab was holding those
 * databases open, so the slot left the registry while its files stayed on disk — and, worse, that
 * tab can still write into them. Silence there is how a user ends up with data nothing can reach.
 * @param {{id: string, name: string}} atlas
 */
async function deleteLocalAtlasFromPage(atlas) {
    const ok = await showConfirm(`Excluir "${atlas?.name ?? ''}"?`, {
        message: deleteConfirmMessage({ signedIn: sessionContext.isAuthenticated() }),
        destructive: true,
        confirmText: 'Excluir',
    });
    if (!ok) return;
    try {
        tell(deleteNotice(await deleteLocalAtlas(atlas.id)));
    } catch (error) {
        console.error('[projects] local atlas delete failed:', error);
        showError('Não foi possível excluir o atlas local.');
    }
    // Deleting the CURRENT slot re-points the store at the surviving one, which mounts it and
    // takes its lock again. This page holds no atlas: give it straight back.
    clearActiveScope();
    refreshLocalSection();
}

/**
 * Signs in without leaving the page.
 *
 * THE DIALOG LIVES HERE RATHER THAN ON THE MAP, and it is affordable: `login.modal.js` imports
 * `ModalBase` + `event-cleanup` and nothing else, and `apiClient` is already this page's transport.
 * Sending the visitor to the map to type a password would load the ~3,3 MB map bundle for a form,
 * and the map would send them right back here after the login — the bounce the page exists to
 * remove. Its stylesheet moved to `css/login-modal.css` so this page can have the rules without
 * `account.css`, which is the map's account control.
 *
 * A RELOAD, not a re-render: the boot IS the code that decides what a session sees (the server
 * list, the identity, the idle watch, the admin action). Patching it in place would be a second
 * copy of that decision, and the two would drift.
 */
function openLoginDialog() {
    // "CRIAR CONTA" TAMBÉM AQUI, e pela mesma bandeira que o mapa consulta. Esta chamada não
    // passava `onRegister`, então onde o auto-cadastro está LIGADO quem chegasse a "Seus atlas"
    // via só "Entrar" e nenhuma porta para criar conta. E este não é um canto do produto: é o
    // destino canônico de quem tem sessão (`shouldRouteToProjects`) e um endereço que as pessoas
    // compartilham entre si, isto é, exatamente por onde um convidado chega.
    //
    // A bandeira é obrigatória, não cortesia: `POST /auth/register` só é montada com
    // `ALLOW_SELF_REGISTRATION`, então oferecer o botão sem consultá-la seria um beco de 404.
    const signupEnabled = config?.features?.self_registration === true;
    showLoginModal({
        onSubmit: async ({ username, password }) => {
            await apiClient.login(username, password);
            window.location.reload();
        },
        onRegister: signupEnabled ? () => openSignupDialog() : undefined,
    });
}

/**
 * O cadastro, a partir desta página. Espelha `AccountControl._handleRegister`: o anúncio acontece
 * DEPOIS de o formulário fechar (senão ele fica montado atrás do diálogo, com a senha digitada), e
 * usa `showChoice`, cujo `Enter` é inerte — com `showConfirm` a tecla que todo mundo usa para
 * dispensar um diálogo disparava o reenvio do e-mail.
 */
function openSignupDialog() {
    showSignupModal({
        onSubmit: (data) => apiClient.register(data),
        onRegistered: async ({ email }) => {
            const choice = await showChoice('Confira sua caixa de entrada', {
                message: `Enviamos um e-mail para ${email}. Se ainda não houver conta com esse `
                    + 'endereço, ele traz o link de confirmação do cadastro; se já houver, traz '
                    + 'as instruções para recuperar o acesso.',
                choices: [
                    { id: 'ok', label: 'Entendi', variant: 'ghost' },
                    { id: 'resend', label: 'Reenviar e-mail', variant: 'primary' },
                ],
            });
            if (choice !== 'resend') return;
            try {
                await apiClient.resendVerification({ email });
                showSuccess('E-mail de confirmação reenviado.');
            } catch {
                showError('Não foi possível reenviar o e-mail agora.');
            }
        },
        onBackToLogin: () => openLoginDialog(),
    });
}

/**
 * Creates a project straight from a `.ebgeo` file and opens it. The importer (and JSZip with it)
 * is loaded ON DEMAND: it is worth ~100 kB and most visits never import anything.
 * @param {File} file
 */
async function importProjectFromFile(file) {
    try {
        const { importEbgeoAsAtlas } = await import('./import-ebgeo.service.js');
        const { atlasId, name, stats, imageStats } = await importEbgeoAsAtlas(file, { apiClient });
        const lost = (imageStats.skipped || 0) + (imageStats.failed || 0);
        showSuccess(
            `"${name}" importado (${stats.maps} mapa(s), ${stats.features} feição(ões))`
            + (lost > 0 ? ` — ${lost} imagem(ns) não enviada(s)` : '')
        );
        openAtlas(atlasId);
    } catch (error) {
        console.error('[projects] .ebgeo import failed:', error);
        showError(error?.message || 'Falha ao importar o arquivo .ebgeo.');
    }
}

/**
 * Ends the session and returns to the map.
 *
 * UNSYNCED WORK IS GUARDED HERE, and which guard runs depends on whether a HUMAN clicked.
 * Until 2026-08-23 this function was `logout` plus `clearSession` plus `replace`, and nothing
 * else: the queue of operations that never reached the server was destroyed by the next boot's
 * logged-out sweep, silently, in every path. The two paths need different guards and it is not a
 * detail:
 *
 *   - VOLUNTARY (the "Sair" action): the person is at the keyboard, so they get the choice.
 *     Cancelling has to abort the whole thing, which is why this returns early instead of
 *     navigating.
 *   - INVOLUNTARY (idle timeout, auth lost): nobody is there to answer, so a dialog would be a
 *     wall nobody dismisses. The work is preserved without asking.
 *
 * THE OUTCOME MESSAGE CANNOT RIDE ALONG AS A STRING: `window.location.replace` kills any toast
 * raised just before it. It travels as a CODE plus a COUNT on the query string, the channel this
 * page already uses for `?sessao=`, and the map rebuilds the sentence from the same pure phrase
 * module. Passing the built sentence would put user-facing prose in a URL, where a reload would
 * repeat it and a hand-edited value would be echoed.
 *
 * @param {string} [reason] - Carried as `?sessao=<reason>` so the map can explain itself.
 * @returns {Promise<void>}
 */
async function endSession(reason) {
    // UM CAMINHO SÓ, e a razão é decisão do dono (2026-08-23): o sincronismo ocorre sempre,
    // então a fila só tem conteúdo quando algo NÃO CONSEGUIU subir, nunca porque alguém
    // escolheu não subir. Não há vontade a respeitar, e por isso o clique e o acidente recebem
    // o mesmo tratamento: guardar e avisar. O parâmetro `voluntary` some junto com a pergunta.
    const guarda = await preserveUnsyncedWorkOnLostSession();

    try {
        await apiClient.logout();
    } catch {
        // logout() already swallows network errors and clears locally.
    }
    sessionContext.clearSession();

    const params = new URLSearchParams();
    if (reason) params.set('sessao', reason);
    // O CÓDIGO, e não a frase. Três valores, e o terceiro é o que mais precisa chegar: a pessoa
    // PEDIU para guardar e o resgate falhou, então ela precisa saber antes de fechar a aba. A
    // contagem viaja à parte porque a frase a interpola, e o nome do atlas NÃO viaja: o resultado
    // do guarda não o carrega, e inventá-lo aqui seria escrever na URL um dado que ninguém mediu.
    if (guarda.outcome && guarda.outcome !== ExitOutcome.NADA) {
        params.set('trabalho', guarda.outcome);
        if (guarda.pendingOps) params.set('pendentes', String(guarda.pendingOps));
    }
    const qs = params.toString();
    window.location.replace(qs ? `${MAP_URL}?${qs}` : MAP_URL);
}

/**
 * Applies the sharing staged in the create dialog to a freshly-created atlas (the creator is the
 * owner). Best-effort per item so one failure does not abort the others.
 * @param {string} atlasId
 * @param {{ isPublic?: boolean, members?: Array<{userId: string, permission: string}> }} [sharing]
 */
async function applyAtlasSharing(atlasId, sharing) {
    if (!sharing) return;
    if (sharing.isPublic) {
        try {
            await apiClient.enablePublicSharing(atlasId);
        } catch (error) {
            console.warn('[projects] enablePublicSharing failed:', error);
        }
    }
    for (const member of (sharing.members || [])) {
        if (!member?.userId) continue;
        // Least-privilege fallback for an unrecognized staged value (never silently escalate to
        // edit). The acceptable set is DERIVED from the ladder (`isGrantablePermission`: every rung
        // below `owner`), not a local array: the same list lived hand-written here and in
        // `account/account.control.js`, so a rung added to `PERMISSION_ORDER` would have been
        // demoted to 'read' by both, silently and in two places.
        const permission = isGrantablePermission(member.permission) ? member.permission : 'read';
        try {
            await apiClient.addShare(atlasId, member.userId, permission);
        } catch (error) {
            console.warn('[projects] addShare failed:', error);
        }
    }
    // O EIXO DE GRUPO, encenado pelo mesmo modal e aplicado pela mesma regra de menor privilégio.
    // O servidor exige grupo PRÓPRIO para conceder (`assertCanAdministerGroup`, 404), e o modal já
    // só oferece os administrados; este `catch` cobre a corrida em que a posse mudou entre abrir o
    // diálogo e criar o atlas.
    for (const group of (sharing.groups || [])) {
        if (!group?.groupId) continue;
        const permission = isGrantablePermission(group.permission) ? group.permission : 'read';
        try {
            await apiClient.addAtlasGroupShare(atlasId, group.groupId, permission);
        } catch (error) {
            console.warn('[projects] addAtlasGroupShare failed:', error);
        }
    }
}

/** How often the cards re-ask who is inside each project. */
const PRESENCE_REFRESH_MS = 20000;

/**
 * Keeps the "N no mapa" badges honest while the page sits open.
 *
 * A POLL, not a socket, and the reason is the page's whole shape: the collaboration socket is per
 * ATLAS, so live presence for a grid of twenty projects would mean twenty connections opened by a
 * page that has entered none of them. One small request every {@link PRESENCE_REFRESH_MS} is the
 * cheap and honest answer to a fact that only ever decorates a card.
 *
 * It stops itself while the tab is hidden: a chooser left open in a background tab for an afternoon
 * would otherwise wake the server every twenty seconds to be told what nobody is looking at.
 *
 * @param {AtlasDrive} drive
 */
function startPresenceRefresh(drive) {
    let timer = null;
    const tick = async () => {
        try {
            drive.setPresence(await apiClient.getAtlasPresence());
        } catch {
            // A failed poll keeps the last known state rather than emptying every badge: "nobody is
            // there" and "I could not ask" are different facts, and only one of them is worth
            // showing. The next tick corrects it.
        }
    };
    const start = () => {
        if (timer == null) timer = setInterval(tick, PRESENCE_REFRESH_MS);
    };
    const stop = () => {
        if (timer != null) { clearInterval(timer); timer = null; }
    };
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { stop(); return; }
        tick();   // coming back, the badges are already stale — refresh before waiting a full cycle
        start();
    });
    start();
}

/**
 * O rótulo da entrada para `admin.html`, que MUDA com o papel global porque o painel muda.
 * Quem decide é `adminAudience`, a MESMA função que a página consulta para montar as abas e que
 * a barra do mapa consulta para desenhar o mesmo botão: enquanto a regra vivia copiada aqui, a
 * entrada podia aparecer numa tela e faltar na outra.
 * @returns {string|null} O rótulo, ou null para quem não abre a página.
 */
function adminEntryLabel() {
    return adminAudience({
        isAuthenticated: sessionContext.isAuthenticated(),
        isAdmin: sessionContext.isAdmin(),
        isProducer: sessionContext.isProducer(),
    }).label;
}

/** @returns {AppBarAction[]} The page actions: back to the local map, and the admin page for
 *  whoever may open it, labelled with what they actually get there. */
function buildActions() {
    const actions = [{
        label: 'Mapa local',
        icon: ICON_MAP,
        testid: 'projects-local-map',
        title: 'Trabalhar no mapa local, sem atlas do servidor',
        onClick: goToLocalMap,
    }];
    const adminLabel = adminEntryLabel();
    if (adminLabel) {
        actions.push({
            label: adminLabel,
            icon: ICON_ADMIN,
            testid: 'projects-admin',
            onClick: () => window.location.assign(ADMIN_URL),
        });
    }
    return actions;
}

/**
 * The "Neste computador" section, wired to the local-atlas API.
 *
 * ONE BUILDER FOR BOTH BOOTS, and that is the point: the page with a server and the page without
 * one draw the SAME local half, because none of these callbacks touches the network
 * (`createLocalAtlas`, `renameLocalAtlas`, `duplicateLocalAtlas`, `deleteLocalAtlas` and
 * `savePendingImport` are IndexedDB only). Two copies of this call would be two places for the
 * offline page to quietly lose an action.
 * @param {{atlases: Array<Object>|null, currentId: string|null}} local
 * @returns {LocalAtlasSection}
 */
function buildLocalSection(local) {
    return new LocalAtlasSection({
        atlases: local.atlases,
        currentId: local.currentId,
        max: MAX_LOCAL_ATLASES,
        onOpen: (atlas) => openLocalAtlas(atlas),
        onCreate: () => createLocalAtlasFromPage(),
        onRename: (atlas) => renameLocalAtlasFromPage(atlas),
        onDuplicate: (atlas) => duplicateLocalAtlasFromPage(atlas),
        // A ÚNICA AÇÃO LOCAL QUE TOCA A REDE, e por isso a única com gate de sessão. Sem conta a
        // página não tem para onde enviar, e `renderWithoutServer` monta esta mesma seção com o
        // servidor fora do ar: nos dois casos `isAuthenticated()` é falso e o item some.
        signedIn: sessionContext.isAuthenticated(),
        onSendToServer: (atlas) => sendLocalAtlasToServerFromPage(atlas),
        onDelete: (atlas) => deleteLocalAtlasFromPage(atlas),
        onOpenFile: (file) => openEbgeoFileAsLocalAtlas(file),
        onRetry: () => retryLocalAtlases(),
    });
}

/**
 * The page WITHOUT a server: "Neste computador" plus an honest account of what is out.
 *
 * WHAT IT DELIBERATELY DOES NOT DO, and each omission is a failure this branch would otherwise
 * stage against a server that is not answering:
 *
 *   - NO SESSION RESTORE. `getMe` would fail exactly like `/api/config` just did, three times over,
 *     and produce a second sentence about a session nobody asked about. Anonymous here does not
 *     mean signed out: it means unasked.
 *   - NO SERVER HALF AT ALL, not even the sign-in invitation: "Entrar" is precisely what cannot
 *     work, and offering it would be the page promising what it cannot keep. `createServerOutage`
 *     stands there instead.
 *   - NO IDLE WATCH, NO PRESENCE POLL, NO 401 HANDLER. All three are session machinery.
 *
 * WHAT IT KEEPS is the tab-lock (local arbitration, no network), the arrival param being STRIPPED
 * from the URL, and the whole local section with every action live.
 * @returns {Promise<void>}
 */
async function renderWithoutServer() {
    document.title = `Seus atlas — ${config?.app?.title || 'EBGeo'}`;
    initTabLock({ key: noneKey(), overlayHost: null });

    let local = { atlases: null, currentId: null };
    try {
        local = await loadLocalAtlases();
    } catch (error) {
        console.error('[projects] local atlas registry failed:', error);
    }

    clearSplash();
    // `false` is the truth here and not a shortcut: nobody was asked to sign in, so no arrival
    // notice about a server atlas may be echoed. The param is still consumed.
    explainArrivalFromUrl(false);
    if (local.atlases === null) showError(REGISTRO_LOCAL_ILEGIVEL);

    const appBar = createAppBar({
        logo: EBGEO_LOGO_BASE64,
        title: config?.app?.title || 'EBGeo',
        user: null,
        actions: buildActions(),
        onLogout: null,
    });
    document.body.appendChild(appBar.element);

    const body = document.createElement('div');
    body.className = 'projects-body';
    document.body.appendChild(body);

    // O AVISO VEM PRIMEIRO, ao contrário da ordem da página completa (local em cima, servidor
    // embaixo): aqui ele explica por que a tela está diferente, e a explicação precede o que ela
    // explica.
    body.appendChild(createServerOutage({ onRetry: () => window.location.reload() }));

    localSection = buildLocalSection(local);
    localSection.mount(body);
}

/**
 * Boots the "Seus atlas" page.
 *
 * The signed-out branch is not a degraded page: the local half is the WHOLE product for a visitor
 * without an account, so it renders identically and only the server half is replaced by an
 * invitation. Everything that presumes a session (the atlas list, the identity, "Sair", the idle
 * watch, the 401 handler) is inside the `signedIn` guards.
 * @returns {Promise<void>}
 */
async function initProjectsPage() {
    // A TELEMETRIA DE ERRO PRIMEIRO, como nas outras três páginas: o erro de boot é o que menos se
    // consegue reproduzir depois. Síncrona, sem rede, e nada abaixo depende dela — esta página
    // sobe igual com a rota ausente, inclusive no ramo `renderWithoutServer`.
    instalarTelemetriaDeErro();

    configureApiClient({ baseUrl: resolveBackendBaseUrl() });

    // NÃO É MAIS FAIL-FAST NESTA PÁGINA, e essa é a decisão do dono de 2026-08-24. O mapa continua
    // sendo (`index.js`), porque lá TUDO vem do servidor; aqui não: "Neste computador" não faz uma
    // requisição sequer, então trocar a página inteira pela tela de bloqueio tornava inalcançável
    // a metade do produto que continuava funcionando, para a pessoa a quem o produto prometeu
    // "Nada aqui vai para o servidor".
    if (!(await bootConfig())) {
        await renderWithoutServer();
        return;
    }
    document.title = `Seus atlas — ${config?.app?.title || 'EBGeo'}`;

    const signedIn = await restoreSession();

    // Joins the multi-tab channel holding NOTHING (`tab-lock.js`, section 1: the arbitration is
    // over which tab may hold which ATLAS, and this page holds none — see `loadLocalAtlases`,
    // which gives the mount lock straight back). So it never blocks and is never blocked, which is
    // what keeps "map in one tab, chooser in another" working; it stays visible in every peer's
    // roster, which is the whole point of announcing. No overlay: a page that cannot be blocked has
    // nothing to render, and it does not load `tab-lock.css` either.
    initTabLock({ key: noneKey(), overlayHost: null });

    // `null` SIGNIFICA "NÃO CHEGOU", e é por isso que ele viaja até o Drive em vez de virar `[]`
    // aqui. O colapso era o achado: a falha de rede na primeira carga produzia uma grade que
    // escrevia "Nenhum atlas nesta categoria", isto é, uma afirmação falsa e permanente sobre a
    // conta da pessoa, com o toast já dissipado e nada para tentar de novo.
    let projects = null;
    let overview = null;
    if (signedIn) {
        // The two in parallel, and they fail apart: the list IS the page, while the overview is
        // what the cards draw on top of it. A grid without covers is a smaller loss than a page
        // that shows nothing because an enrichment request timed out.
        const [list, extras] = await Promise.all([
            apiClient.listAtlas().catch((error) => {
                console.error('[projects] listAtlas failed:', error);
                showError('Não foi possível carregar a lista de atlas.');
                return null;
            }),
            apiClient.getAtlasOverview().catch((error) => {
                console.warn('[projects] atlas overview failed:', error);
                return null;
            }),
        ]);
        projects = Array.isArray(list) ? list : null;
        overview = extras;
    }

    // `null` É O TERCEIRO ESTADO, como no irmão de servidor logo acima: um registro que não pôde
    // ser lido não é um registro vazio, e a lista vazia é literalmente o desenho da falha (o boot
    // do store garante um cartão a todo visitante novo).
    let local = { atlases: null, currentId: null };
    try {
        local = await loadLocalAtlases();
    } catch (error) {
        // A registry this page cannot read must not cost the visitor the server half.
        console.error('[projects] local atlas registry failed:', error);
        showError(REGISTRO_LOCAL_ILEGIVEL);
    }

    clearSplash();
    explainArrivalFromUrl(signedIn);
    // AFTER the splash, and after the arrival notice: a session that could not be confirmed is the
    // reason the server half of this page is missing, so it is the last thing said and therefore
    // the one on top.
    tellPendingSessionNotice();

    const appBar = createAppBar({
        logo: EBGEO_LOGO_BASE64,
        title: config?.app?.title || 'EBGeo',
        // Só id e nome. O SELO DO PAPEL GLOBAL é desenhado pela própria barra, que o lê do
        // `sessionContext`: `admin.html` monta a mesma barra por `admin/admin-panel.js`, que não
        // tem como passar campo novo, e um selo que aparecesse aqui e faltasse lá seria a
        // divergência que a barra compartilhada existe para impedir. O anônimo continua sem
        // `user`, sem selo e sem "Sair": ele não tem papel, e inventar um diria o que o servidor
        // não disse.
        user: signedIn ? { id: sessionContext.userId, name: sessionContext.username } : null,
        actions: buildActions(),
        onLogout: signedIn ? () => { endSession(); } : null,
    });
    document.body.appendChild(appBar.element);

    // One column, two sections. The server half keeps its own internal scroller (the Drive's grid),
    // so the local half is sized by its content and never steals the list's height.
    const body = document.createElement('div');
    body.className = 'projects-body';
    document.body.appendChild(body);

    localSection = buildLocalSection(local);
    localSection.mount(body);

    if (signedIn) {
        const drive = new AtlasDrive({
            projects,
            overview,
            onPick: (atlasId) => openAtlas(atlasId),
            onCreate: async (name, sharing) => {
                const atlas = await apiClient.createAtlas({ name });
                await applyAtlasSharing(atlas.id, sharing);
                openAtlas(atlas.id);
            },
            onImport: (file) => importProjectFromFile(file),
        });
        drive.mount(body);
        startPresenceRefresh(drive);

        apiClient.setAuthLostHandler(() => { endSession('encerrada'); });
        startIdleWatch({
        onExpire: () => { endSession('inatividade'); },
        // "Sair agora" nao e expiracao: motivo proprio, e o mapa nao pede login de volta.
        onLeaveNow: () => { endSession('saida'); },
    });
    } else {
        body.appendChild(createServerInvite({ onLogin: openLoginDialog }));
    }
}

initProjectsPage().catch((error) => {
    console.error('Projects page initialization failed:', error);
    clearSplash();
    // ERRO DE APLICACAO, nao de rede: o servidor JA respondeu (o `bootConfig` acima passou).
    // Anunciar falha de conexao aqui manda a pessoa depurar a internet dela por um defeito do
    // programa, que era exatamente o que esta tela fazia.
    showUnavailableScreen(BlockingCause.APP_ERROR);
});
