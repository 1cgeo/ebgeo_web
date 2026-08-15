// Path: js/account/open-atlas.service.js

/**
 * @fileoverview Shared "open a remote atlas" flow. Opening (or switching to) a server atlas replaces
 * the local store and connects: resolve what happens to unsaved local work, close any previous
 * socket, wipe local, mark the origin REMOTE (durable intent before the snapshot pull), connect +
 * initial-pull, activate the atlas map, and resume auto-flush.
 *
 * This is the SINGLE place the local-work guard lives. It used to be duplicated in
 * `AccountControl.openProjectPicker`, which fired it when the picker OPENED — i.e. right after every
 * login, before the user had chosen anything, warning about a replacement that might never happen.
 * The guard belongs to the act, not to the browsing.
 *
 * The address-bar `?atlas=&map=` is kept in sync REACTIVELY (atlas-url-sync.js, on connection/map
 * events) — NOT here — so every open path (picker, URL, resume, reconnect) updates the URL uniformly.
 *
 * ---------------------------------------------------------------------------------------------
 * THIS MODULE ALSO OWNS "WHICH ATLAS THIS TAB HOLDS", the key of the multi-tab lock
 * (`utilities/tab-lock.js`). It is the same question the open pipeline already answers, so the
 * answer lives here once instead of being re-derived by every caller.
 *
 * The key is read from `syncEngine.atlasId` plus the ACTIVE STORE SCOPE (`atlas-namespace.js`),
 * which is the pair `deep-link/atlas-url-sync.js` reads for the URL. Deriving it from anything
 * else is how the URL and the lock end up disagreeing about the same tab.
 *
 * The pre-flights are the load-bearing calls, and there are two of them, because there are two
 * shapes of wipe. `claimRemoteAtlas` answers "may I open THAT atlas" before `openRemoteAtlas`
 * clears the store on its way in. `clearMountedAtlasIfGranted` answers "may I erase the atlas I
 * ALREADY have" for the boot paths, which used to call `clearAllDataStore()` outright: with a
 * namespace per atlas, that wipe lands on the exact databases another tab may be writing to,
 * and a duplicated tab inherits the sessionStorage intent that takes it there.
 */

import { syncEngine } from '@store/sync/sync-engine.js';
import { getControl } from '@store';
import { apiClient } from '@store/sync/api-client.js';
import { startAutoFlush, stopAutoFlush } from '@store/sync/sync-flush.js';
import {
    clearAllDataStore,
    markStoreRemote,
    markStoreLocal,
    isRemoteStoreSync,
    hasAnyMapFeatures,
    activateAtlasInitialMap,
} from '@store/store.js';
import { getActiveScope, StoreScopeKind } from '@store/atlas-namespace.js';
import { ensureAtlasScope } from '@store/repositories/local.repository.js';
import {
    acquireTabLock,
    getTabLock,
    setTabLockKey,
    releaseTabLock,
    localAtlasKey,
    remoteAtlasKey,
    noneKey,
    TabLockKeyKind,
} from '@utils/tab-lock.js';
import { showChoice } from '@modals/confirm.modal.js';
import { showPrompt } from '@modals/prompt.modal.js';
import { saveLocalAtlasToServer } from '@js/import_export/save-local-atlas.service.js';
import { showSuccess, showError } from '@utils/toast_service.js';

/** Default name offered when saving the local workspace before opening something else. */
function defaultLocalAtlasName() {
    return `Trabalho local — ${new Date().toLocaleDateString('pt-BR')}`;
}

// =================================================================================================
// TAB-LOCK KEY: which atlas this tab holds
// =================================================================================================

/**
 * An open this tab was NOT allowed to perform, kept so the handoff can finish it.
 *
 * The losing tab stays blocked instead of silently giving up: the overlay's "Usar aqui" posts a
 * TAKEOVER, the holder stops for real and retracts, and the unblock runs this thunk. Without it the
 * button would unblock a tab that then just sits there, having never opened the atlas it asked for.
 * @type {(() => Promise<unknown>)|null}
 */
let _deferredOpen = null;

/**
 * Remembers an open to retry once this tab wins the claim.
 * @param {() => Promise<unknown>} run - The open to replay. Only the last one is kept.
 * @returns {void}
 */
export function deferAtlasOpen(run) {
    _deferredOpen = typeof run === 'function' ? run : null;
}

/**
 * Runs (once) the open that the lock deferred. Wired to the lock's `onResumed`, so it fires on
 * every unblock — a takeover that succeeded, or a holder tab that died and expired.
 * @returns {Promise<boolean>} True when there was something to resume and it ran without throwing.
 */
export async function resumeDeferredAtlasOpen() {
    const run = _deferredOpen;
    _deferredOpen = null;
    if (!run) return false;
    try {
        await run();
        return true;
    } catch (error) {
        console.warn('[tab-lock] deferred atlas open failed:', error);
        return false;
    }
}

/**
 * The key this tab should be announcing right now.
 *
 * Order matters: a live server connection wins, because `syncEngine.atlasId` is the only thing that
 * says WHICH server atlas. With no connection the honest answer is the active store scope — a tab
 * whose origin is REMOTE already holds that atlas's databases before its socket is up, and saying
 * "local" there would let a second tab wipe them out from under it.
 * @returns {import('@utils/tab-lock.js').TabLockKey}
 */
export function currentAtlasLockKey() {
    if (syncEngine.atlasId) return remoteAtlasKey(syncEngine.atlasId);
    // The repository activates the legacy bridge scope on its first access anyway; asking it here
    // is what keeps this key and the databases actually in use naming the same slot.
    ensureAtlasScope();
    const scope = getActiveScope();
    // A remote scope always names its atlas (`remoteScope` throws without one); the guard is for a
    // hand-built or legacy scope object, where inventing an id would be worse than holding nothing.
    if (scope?.kind === StoreScopeKind.REMOTE) {
        return scope.atlasId ? remoteAtlasKey(scope.atlasId) : noneKey();
    }
    return scope?.atlasId ? localAtlasKey(scope.atlasId) : noneKey();
}

/**
 * Whether two keys are the SAME CLAIM, i.e. whether re-announcing would be a no-op.
 *
 * It is `keysCollide` restricted to a single tab, plus `none` equal to `none`: same kind, same id.
 * The id used to be ignored for a remote key, because every remote claim collided with every other
 * one and the id was decoration; under the uniform rule it decides, so ignoring it here would make
 * this tab keep announcing the atlas it LEFT.
 *
 * Why this exists at all: `setKey` stamps a fresh `claimedAt` and the total order is `claimedAt`
 * first, so re-announcing an unchanged claim would push this tab to the BACK of the order and hand
 * a lock it already holds to a newcomer.
 * @param {import('@utils/tab-lock.js').TabLockKey|null} a
 * @param {import('@utils/tab-lock.js').TabLockKey|null} b
 * @returns {boolean}
 */
export function sameAtlasClaim(a, b) {
    if (!a || !b) return false;
    if (a.kind !== b.kind) return false;
    return (a.atlasId ?? null) === (b.atlasId ?? null);
}

/**
 * Reconciles the announced key with the live atlas. Wired to `CONNECTION_STATE_CHANGED` +
 * `SESSION_CHANGED` (index.js), which is what makes the lock follow the FOUR flows that change
 * atlas without a reload: login with a pending link, "Salvar no servidor", logout, and a session
 * lost to a 401.
 *
 * Two guards, both load-bearing. It never re-announces an unchanged claim (see `sameAtlasClaim`),
 * and it never touches the key while this tab is BLOCKED: `onBlocked` disconnects, the disconnect
 * emits `CONNECTION_STATE_CHANGED`, and a tab that answered that event by dropping to a local key
 * would unblock itself in the middle of being stopped.
 * @returns {import('@utils/tab-lock.js').TabLockKey|null} The key in force after the call.
 */
export function syncAtlasLockKey() {
    const lock = getTabLock();
    if (!lock || lock.blocked) return lock?.key ?? null;
    const next = currentAtlasLockKey();
    if (sameAtlasClaim(lock.key, next)) return lock.key;
    setTabLockKey(next);
    return next;
}

/**
 * Drops a claim this tab announced but could not honour (a 403/404 on connect, an open that was
 * refused). Retraction is a first-class move of the protocol, not a special case of unload: peers
 * forget the claim and one of them can proceed.
 *
 * Falls back to the local slot when there still is one, so a retraction does not leave the tab
 * announcing `none` while it holds a local atlas (`none` never collides, which would be a hole).
 * @returns {void}
 */
export function retractAtlasClaim() {
    releaseTabLock();
    const scope = getActiveScope();
    if (scope?.kind === StoreScopeKind.LOCAL && scope.atlasId) {
        setTabLockKey(localAtlasKey(scope.atlasId));
    }
}

/**
 * Claims `atlasId` for this tab, unless this tab already holds THAT atlas.
 *
 * The "already holds it" shortcut is not an optimisation, it is the difference between re-entering
 * an atlas and losing it. `acquire()` stamps a FRESH `claimedAt` every time, and the order is
 * `claimedAt` first, so a tab that re-opens the atlas it is already in (a deep link replay, a
 * resumed open) would push itself to the back of the order and hand its own atlas to a tab that was
 * waiting behind it. It is deliberately narrow: opening a DIFFERENT atlas is a different claim and
 * takes the full pre-flight, because somebody else may be holding that one.
 * @param {string} atlasId - Atlas UUID being opened.
 * @returns {Promise<boolean>} True when this tab may proceed with the open.
 */
async function claimRemoteAtlas(atlasId) {
    const lock = getTabLock();
    if (lock && !lock.blocked && sameAtlasClaim(lock.key, remoteAtlasKey(atlasId))) return true;
    const { granted } = await acquireTabLock(remoteAtlasKey(atlasId));
    return granted;
}

/**
 * Wipes the atlas THIS TAB HAS MOUNTED, and only if the lock says it may.
 *
 * The two boot paths (`enterLocalMapOnBoot`, `openAtlasChooserOnBoot` in `index.js`) called
 * `clearAllDataStore()` outright. That was safe only while every server atlas shared one scratch
 * AND no second tab could hold it; today the wipe lands on `remote-<atlasId>`, which is precisely
 * the namespace another tab may be writing to, and the route there is ordinary: `ebgeo_local_intent`
 * lives in sessionStorage, sessionStorage is INHERITED by a duplicated tab, so the duplicate boots
 * with the intent, reads a remote origin and erases the original's live databases.
 *
 * IT MUST AWAIT, not read a flag. At boot the lock has just been constructed and has heard from
 * nobody, so `isTabLockBlocked()` is `false` for a tab that is about to lose. Only `acquire()`, with
 * its settle window, can answer.
 *
 * @param {(() => Promise<unknown>)|null} [replay] - What to re-run if the claim is refused, so the
 *   overlay's "Usar aqui" finishes the boot step instead of leaving the tab merely unblocked.
 * @returns {Promise<boolean>} True when the wipe ran.
 */
export async function clearMountedAtlasIfGranted(replay = null) {
    const key = currentAtlasLockKey();
    // Holding nothing means there is no atlas to arbitrate: nobody else can be writing to a
    // namespace this tab has not resolved.
    if (key.kind !== TabLockKeyKind.NONE) {
        const { granted } = await acquireTabLock(key);
        if (!granted) {
            if (replay) deferAtlasOpen(replay);
            console.warn('[tab-lock] wipe refused: another tab holds this atlas');
            return false;
        }
    }
    await clearAllDataStore();
    return true;
}

/**
 * Uploads the current LOCAL store as a NEW server atlas, so it survives being replaced. Asks for a
 * name (pre-filled with today's date) — the user is about to lose sight of this data, and an
 * auto-generated name would make it unfindable in the project list later.
 * @returns {Promise<boolean>} true when the work is safely on the server; false if the user backed
 *   out of the name prompt or the upload failed (in which case NOTHING must be wiped).
 */
async function saveLocalWorkToServer() {
    const exportService = getControl('exportImport');
    if (!exportService) {
        showError('Serviço de exportação indisponível — não foi possível salvar o trabalho local.');
        return false;
    }
    const name = await showPrompt('Salvar o trabalho local como', defaultLocalAtlasName());
    if (name == null || !name.trim()) return false;
    try {
        const { stats, imageStats } = await saveLocalAtlasToServer(apiClient, exportService, { name: name.trim() });
        const lost = (imageStats.skipped || 0) + (imageStats.failed || 0);
        showSuccess(
            `Trabalho local salvo como "${name.trim()}" (${stats.maps} mapa(s), ${stats.features} feição(ões))`
            + (lost > 0 ? ` — ${lost} imagem(ns) não enviada(s)` : '')
        );
        return true;
    } catch (error) {
        console.error('[openRemoteAtlas] saving local work failed:', error);
        showError('Falha ao salvar o trabalho local. Nada foi substituído.');
        return false;
    }
}

/**
 * Opens a remote atlas, optionally landing on a specific map.
 *
 * Replaces the local store, so when the current store is the user's own LOCAL workspace with unsaved
 * work it first asks what to do with it: cancel, save it to the server first, or discard it. If the
 * user cancels (or the save fails), nothing is wiped and it returns false.
 *
 * @param {string} atlasId - Atlas UUID.
 * @param {{ mapId?: string|null }} [options] - mapId: a specific map UUID to activate (else initial/last).
 * @returns {Promise<boolean>} true when the atlas was opened; false when the user declined to
 *   replace the local work, or when another tab already holds a server atlas (in which case this
 *   tab is left BLOCKED, with the open remembered for the takeover — see `isTabLockBlocked`).
 * @throws Propagates a connect/permission error (e.g. 403/404) so callers can message the user; on
 *   such a failure the durable origin is reverted to LOCAL so a reload does not retry the dead atlas.
 */
export async function openRemoteAtlas(atlasId, { mapId = null } = {}) {
    // PRE-FLIGHT, and it has to come FIRST. `clearAllDataStore()` below empties the databases this
    // tab has mounted, which is another tab's LIVE data whenever the two hold the same atlas:
    // asking after the wipe is asking after the damage. It also has to precede the local-work
    // question, because there is no point asking what to do with work we are not going to be
    // allowed to replace.
    if (!await claimRemoteAtlas(atlasId)) {
        // Stay claimed and BLOCKED: the overlay is the answer to the user, and its "Usar aqui" is
        // the way through. Nothing is wiped — the outbound queue is global and holds work from BOTH
        // tabs — and the open is remembered so a successful takeover finishes it.
        deferAtlasOpen(() => openRemoteAtlas(atlasId, { mapId }));
        return false;
    }

    // Opening a remote atlas REPLACES the local store. When that store is the user's own LOCAL
    // workspace with work in it, the honest answer set has three members — a two-button confirm
    // would hide the one people actually want ("keep it AND open the project").
    if (!isRemoteStoreSync() && await hasAnyMapFeatures()) {
        const choice = await showChoice('Você tem trabalho local não salvo', {
            message: 'Abrir este projeto do servidor substitui os dados que estão abertos agora.',
            choices: [
                { id: 'cancel', label: 'Cancelar', variant: 'ghost' },
                { id: 'save', label: 'Salvar e continuar', variant: 'primary' },
                { id: 'discard', label: 'Descartar e abrir', variant: 'danger' },
            ],
        });
        // Dismissing (Esc/backdrop) resolves null and must behave exactly like Cancelar.
        // Either way this tab claimed a remote atlas it is not going to open, so the claim goes
        // back to whatever it really holds; leaving it standing would block the next tab for free.
        if (choice !== 'save' && choice !== 'discard') {
            syncAtlasLockKey();
            return false;
        }
        if (choice === 'save' && !(await saveLocalWorkToServer())) {
            syncAtlasLockKey();
            return false;
        }
    }

    // Switching atlases: close any previous server connection first (one socket per atlas — the
    // server has no "switch"), then wipe local + connect the new one.
    if (syncEngine.atlasId) {
        stopAutoFlush();
        syncEngine.disconnect();
    }
    await clearAllDataStore();
    // Mark REMOTE before connecting (durable intent): if the tab dies mid-pull, the boot guard sees
    // 'remote' and discards the partial data instead of mislabeling it as a permanent local atlas.
    await markStoreRemote(atlasId);
    try {
        await syncEngine.connect(atlasId, { initialPull: true });
        // Land on the atlas's map (the requested one when given), not the local default.
        await activateAtlasInitialMap(mapId);
    } catch (error) {
        // Connect failed (e.g. 403/404 or a backend hiccup): the local store is already blank and the
        // origin is durably 'remote' pointing at an atlas we cannot open. Revert the origin to LOCAL
        // so the boot reconnect (which reads the origin) does not keep retrying the dead atlas on F5.
        await markStoreLocal();
        // Same revert for the lock: a tab that announced a UUID it cannot open must RETRACT it,
        // or every other tab stays locked out of the server on behalf of an atlas nobody has.
        retractAtlasClaim();
        throw error;
    }
    // Render the now-current atlas map (base layer + feature sources + client-generated rasters). The
    // open path sets the current map but, unlike a UI map switch, never ran setupMapFeatures for it —
    // so military-symbol/coordination/declination rasters intermittently 404'd → error icon. After the
    // try/catch so a render error can't revert the (successfully opened) atlas origin.
    await getControl('BaseLayerControl')?.switchMap?.(false);
    startAutoFlush();
    return true;
}
