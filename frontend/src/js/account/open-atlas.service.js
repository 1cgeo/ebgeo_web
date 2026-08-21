// Path: js/account/open-atlas.service.js

/**
 * @fileoverview Shared "open a remote atlas" flow. Opening (or switching to) a server atlas mounts
 * that atlas's own namespace and connects: close any previous socket, ACTIVATE the atlas namespace
 * (registering it first), wipe it, mark the origin REMOTE (durable intent before the snapshot
 * pull), connect + initial-pull, activate the atlas map, and resume auto-flush.
 *
 * OPENING A SERVER PROJECT DOES NOT TOUCH THE LOCAL ATLAS, and the flow no longer claims it does.
 * Until 2026-08-16 the first thing this function did was ask a three-way question titled "Você tem
 * trabalho local não salvo", whose red button read "Descartar e abrir" — wording inherited from the
 * single-address era, when the wipe really did land on the databases holding local work. With a
 * namespace per atlas, `activateRemoteAtlas` runs BEFORE `clearAllDataStore` and the wipe empties
 * `remote-<atlasId>`; the local slot keeps every byte. Measured, not reasoned: a point drawn on the
 * local map survives "Descartar e abrir" and is still there afterwards. A destructive-looking button
 * that destroys nothing is worse than no button, because it teaches people to click through
 * warnings — and the branch worth keeping ("upload my local work to the server") already exists as
 * "Enviar ao servidor" in the account menu, which is offered in exactly this state.
 *
 * THE ONE CASE WHERE THE TWO NAMESPACES REALLY COINCIDE keeps its question
 * (`confirmDiscardingRescuedWork`), and it is the reason the removed one could never be the guard:
 * an atlas rescued by `adoptRemoteAtlasAsLocal` keeps the `remote-<atlasId>` suffix, so re-opening
 * that same server atlas empties the rescue for real. The generic question did not cover it — it
 * read the MOUNTED store, and the rescued slot need not be mounted.
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
 *
 * BOTH PRE-FLIGHTS NOW CARRY A WITNESS, and that is the correction of an assumption this file made
 * for a phase: that an AWAITED `acquire()` was proof. It is not. The settle answers by absence, and
 * a boot is where absence is cheapest to produce — the sibling tab is busy rendering, the two
 * settle windows overlap, one dropped message costs a heartbeat — so both tabs were granted and
 * both wiped. The witness (`mountWitness` below) reads the store's own SHARED MOUNT LOCK, which is
 * a fact of the browser: it survives the sibling being frozen, throttled or unheard, because a Web
 * Lock is released by the DEATH of a client and never by its silence. The settle stays, because it
 * is what names the blocker and drives "Usar aqui"; the witness is what makes the grant mean
 * something. Rationale and the rejected alternative in `utilities/tab-lock.js`, section 5.
 */

import { syncEngine } from '@store/sync/sync-engine.js';
import { getControl } from '@store';
import { startAutoFlush, stopAutoFlush } from '@store/sync/sync-flush.js';
import {
    clearAllDataStore,
    markStoreRemote,
    markStoreLocal,
    activateAtlasInitialMap,
    activateRemoteAtlas,
} from '@store/store.js';
import {
    createLocalAtlas,
    localAtlasAdoptingRemote,
    mountLocalAtlas,
    releaseAdoptedLocalAtlas,
} from '@store/local-atlas.api.js';
import {
    getActiveScope,
    remoteAtlasIdFromDbSuffix,
    StoreScopeKind,
    atlasMountLockName,
    hasMountLockSupport,
    remoteScope,
} from '@store/atlas-namespace.js';
import { ensureAtlasScope } from '@store/repositories/local.repository.js';
import {
    acquireTabLock,
    getTabLock,
    setTabLockKey,
    releaseTabLock,
    localAtlasKey,
    remoteAtlasKey,
    noneKey,
    otherClientHoldsLock,
    TabLockKeyKind,
} from '@utils/tab-lock.js';
import { showChoice } from '@modals/confirm.modal.js';
import { showError } from '@utils/toast_service.js';
import { reapplyAtlasAppearance } from '@store/atlas-appearance.service.js';

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
 * The server atlas this tab has actually WON an arbitration over, which is a different fact from
 * the atlas it is ANNOUNCING (`getTabLock().key`).
 *
 * THE TWO WERE CONFLATED, AND THAT WAS THE DEFECT A2b MEASURED. The announced key is derived at
 * boot from `currentAtlasLockKey()`, i.e. from the scope `activateBootAtlasScope` mounted, and
 * that scope comes from `resolveTabMountOrigin`, which falls back to the INSTALLATION-wide origin
 * marker when this tab has no pointer of its own (`store/store-origin.js`). A brand-new second tab
 * therefore boots already announcing the atlas its SIBLING is in, before the lock has heard a
 * single peer — and `claimRemoteAtlas` read that as "this tab already holds it" and skipped the
 * settle, the order and the witness in one go. Measured on two tabs of one profile in the same
 * server atlas: the second tab wiped, connected and went online behind the blocking overlay that
 * arrived a moment later, so both tabs were live in the same atlas, one of them behind a screen
 * saying it was stopped.
 *
 * It is set where an arbitration was actually won, and nowhere else: a granted `acquire()`, and
 * the unblock, which the lock only performs when no live colliding peer precedes this tab any more
 * (`utilities/tab-lock.js`, section 7).
 * @type {string|null}
 */
let _arbitratedRemoteAtlasId = null;

/**
 * Records (or forgets) the atlas whose claim this tab won.
 * @param {string|null} atlasId - The atlas won, or null to forget.
 * @returns {void}
 */
function noteRemoteClaimWon(atlasId) {
    _arbitratedRemoteAtlasId = typeof atlasId === 'string' && atlasId.length > 0 ? atlasId : null;
}

/**
 * Whether this tab's hold on `atlasId` is EVIDENCE and not merely an announcement.
 *
 * A live connection counts on its own: `syncEngine.atlasId` is only ever set by an open that got
 * through this same pre-flight, and it is the source of truth `currentAtlasLockKey` prefers.
 * @param {string} atlasId - Atlas UUID being opened.
 * @returns {boolean}
 */
function holdsArbitratedClaim(atlasId) {
    return syncEngine.atlasId === atlasId || _arbitratedRemoteAtlasId === atlasId;
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
    // THE UNBLOCK IS THE ARBITRATION, and this is where it is written down. `onResumed` fires from
    // `_leaveBlocked`, which the lock reaches only when no live colliding peer precedes this tab
    // any more — evidence that the holder stopped, not a hope that it will. The replay below needs
    // that fact recorded, because it must NOT re-enter the order: `acquire()` stamps a fresh
    // `claimedAt`, which would hand the atlas this tab has just won to whoever was waiting behind
    // it, and the mount witness would refuse anyway (the tab that yielded keeps its mount lock by
    // design — `store/sync/tab-lock-sync-brake.js`).
    const key = getTabLock()?.key;
    if (key?.kind === TabLockKeyKind.REMOTE) noteRemoteClaimWon(key.atlasId);
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
    return localKeyOfScope(scope);
}

/**
 * The LOCAL key of a store scope, carrying the adoption when the slot has one.
 *
 * The adoption is the whole reason this is a function and not `localAtlasKey(scope.atlasId)`: a
 * slot rescued by `adoptRemoteAtlasAsLocal` keeps the `remote-<atlasId>` databases of the server
 * atlas it came from, so its CLAIM has to name that atlas or a tab opening it would be allowed to
 * wipe the rescued work (`utilities/tab-lock.js`, section 2).
 * @param {{kind: string, atlasId: string|null, dbSuffix: string}|null} scope - Active scope.
 * @returns {import('@utils/tab-lock.js').TabLockKey}
 */
function localKeyOfScope(scope) {
    if (!scope?.atlasId) return noneKey();
    return localAtlasKey(scope.atlasId, {
        adoptedFrom: remoteAtlasIdFromDbSuffix(scope.dbSuffix)
    });
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
 * atlas without a reload: login with a pending link, "Enviar ao servidor", logout, and a session
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
    // The claim goes and the EVIDENCE of having won it goes with it, or the next open of that
    // atlas would take the shortcut on the strength of an arbitration this tab has just given up.
    noteRemoteClaimWon(null);
    releaseTabLock();
    const scope = getActiveScope();
    if (scope?.kind === StoreScopeKind.LOCAL && scope.atlasId) {
        setTabLockKey(localKeyOfScope(scope));
    }
}

// =================================================================================================
// THE WITNESS: the fact a destructive pre-flight checks, next to the settle
// =================================================================================================

/**
 * What a tab is told when the browser says somebody else is in those databases.
 *
 * IT IS A SEPARATE MESSAGE FROM THE OVERLAY, and it has to be: the overlay appears when the tab
 * lost the ORDER, which means it heard the other tab and can offer "Usar aqui". This message is
 * for the case the overlay cannot cover — the peer never made it into the roster (its settle
 * overlapped ours, its main thread was busy, its message was dropped), so there is nobody to ask
 * for a handoff and the honest thing is to name the situation and stop.
 */
const OCCUPIED_MESSAGE = 'Este atlas já está aberto em outra aba deste navegador. '
    + 'Nada foi apagado: continue por lá, ou feche a outra aba e tente de novo.';

/**
 * Builds the witness `acquire()` consults before it grants a destructive claim.
 *
 * WHAT IT READS, AND WHY IT IS NOT THE TAB-LOCK CHANNEL. The store takes a SHARED Web Lock on
 * every namespace it MOUNTS (`atlas-namespace.js`, Decision 5), and that lock is released by the
 * DEATH of the client, never by its silence. So it answers the one question the channel answers
 * badly: is a live client — frozen, throttled, or simply not heard from — using these databases
 * right now. Every tab maintains it unconditionally, including the ones that never speak to the
 * tab lock, which is what makes it evidence rather than cooperation.
 *
 * `selfHolds` IS THE WHOLE SUBTLETY. This client holds AT MOST ONE mount lock (Decision 5 keeps it
 * on `globalThis` and releases the previous one when the scope changes), so the count that means
 * "somebody else" depends on whether the address being asked about is the one THIS tab has
 * mounted: 1 for the wipe of the mounted atlas, 0 for an atlas this tab has not entered yet. Get
 * this backwards and the pre-flight either blocks every tab on its own mount or stops seeing the
 * only peer that matters.
 *
 * @param {string|null|undefined} dbSuffix - Database suffix of the namespace about to be destroyed.
 * @param {number} selfHolds - How many holds on that lock belong to this client (0 or 1).
 * @returns {(() => Promise<boolean|null>)|null} The witness, or null where there is nothing to
 *   read (no LockManager at all, i.e. plain HTTP, or no address to name).
 */
function mountWitness(dbSuffix, selfHolds) {
    if (typeof dbSuffix !== 'string' || !hasMountLockSupport()) return null;
    const lockName = atlasMountLockName(dbSuffix);
    return () => otherClientHoldsLock(navigator.locks, lockName, selfHolds);
}

/**
 * The witness for an atlas this tab is about to OPEN.
 *
 * `selfHolds` is normally 0, because the namespace is not mounted yet: `activateRemoteAtlas` runs
 * after the claim, on purpose (`openRemoteAtlas`).
 *
 * IT IS 1 FOR THE TAB THAT HAS ALREADY MOUNTED THAT NAMESPACE, and this used to be waved away as
 * unreachable ("`claimRemoteAtlas` short-circuits first"). It is very reachable: the boot mounts
 * whatever `resolveTabMountOrigin` resolves BEFORE the lock exists, so an ordinary reload of a tab
 * sitting in its own server atlas arrives here holding the very lock the witness is counting. With
 * a flat 0 that tab reads its OWN mount as a peer and refuses the open it is entitled to — which
 * is why the shortcut could not be narrowed without this line, and it now has to be, because the
 * shortcut was letting an inherited claim through (see `_arbitratedRemoteAtlasId`). The store keeps
 * at most one mount lock per client (`atlas-namespace.js`, Decision 5), so the ACTIVE scope naming
 * the same address is exactly the "one of the holds is mine" case.
 *
 * A suffix that cannot be built (an id `remoteScope` refuses) yields no witness rather than an
 * exception: this is a pre-flight, and failing to read a fact must not become the failure of the
 * open. The very next step of the open builds the same scope and will throw there, where the
 * caller already handles it.
 * @param {string} atlasId - Atlas UUID being opened.
 * @returns {(() => Promise<boolean|null>)|null}
 */
export function remoteMountWitness(atlasId) {
    try {
        const { dbSuffix } = remoteScope(atlasId);
        return mountWitness(dbSuffix, getActiveScope()?.dbSuffix === dbSuffix ? 1 : 0);
    } catch {
        return null;
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
 *
 * "ALREADY HOLDS IT" IS A FACT ABOUT ARBITRATION, NEVER ABOUT THE ANNOUNCED KEY, and reading it
 * off `lock.key` alone is what let a second tab into an atlas its sibling was holding (A2b of
 * `tests/e2e-ui/browser-multi-tab-namespace.spec.js`). The announced key is inherited at boot from
 * an INSTALLATION-wide marker, so a tab that has never spoken to a peer can be announcing the
 * neighbour's atlas — see `_arbitratedRemoteAtlasId` for the measurement. The shortcut now needs
 * both: the key is what the lock defends, and `holdsArbitratedClaim` is what says the tab ever won
 * the right to defend it.
 *
 * A tab that is merely INHERITING therefore takes the full pre-flight, and there is nothing left
 * for it to lose by re-stamping: a claim it never won had no standing to protect.
 * @param {string} atlasId - Atlas UUID being opened.
 * @returns {Promise<boolean>} True when this tab may proceed with the open.
 */
async function claimRemoteAtlas(atlasId) {
    const lock = getTabLock();
    if (lock && !lock.blocked && sameAtlasClaim(lock.key, remoteAtlasKey(atlasId))
        && holdsArbitratedClaim(atlasId)) {
        return true;
    }
    const { granted, deniedBy } = await acquireTabLock(remoteAtlasKey(atlasId), {
        witness: remoteMountWitness(atlasId),
    });
    if (granted) noteRemoteClaimWon(atlasId);
    // Only the record for THIS atlas is dropped: a refusal to open Y says nothing about the X this
    // tab won and may still be holding.
    else if (_arbitratedRemoteAtlasId === atlasId) noteRemoteClaimWon(null);
    // A refusal by the WITNESS produces no overlay, because there is no peer in the roster to
    // offer a handoff to (that is the whole point: the peer was never heard). Saying nothing here
    // would leave the user clicking a project that silently does not open.
    if (!granted && deniedBy === 'witness') showError(OCCUPIED_MESSAGE);
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
 * AND THE SETTLE ALONE IS NOT AN ANSWER EITHER, which is why this is the pre-flight that most
 * needed the witness. A boot is exactly where the other tab is least likely to be heard in time:
 * it is busy rendering a map, the duplicate's own settle overlaps it, and a dropped message costs
 * a whole heartbeat. The witness reads the sibling's SHARED MOUNT LOCK instead of waiting for it
 * to speak — and `selfHolds` is 1 here, because the address being asked about is the one this tab
 * has mounted, so this tab's own hold must not be read as a peer.
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
        // Read AFTER `currentAtlasLockKey()`, which is what runs `ensureAtlasScope()`: the key and
        // the address must name the same slot, or the witness would guard a namespace nobody is
        // about to erase.
        const { granted, deniedBy } = await acquireTabLock(key, {
            witness: mountWitness(getActiveScope()?.dbSuffix, 1),
        });
        if (!granted) {
            if (replay) deferAtlasOpen(replay);
            console.warn(`[tab-lock] wipe refused (${deniedBy}): another tab holds this atlas`);
            // Only the witness path needs a message. A refusal by the ORDER already put the
            // overlay on screen, and a toast behind it would be the same news said twice.
            if (deniedBy === 'witness') showError(OCCUPIED_MESSAGE);
            return false;
        }
    }
    await clearAllDataStore();
    return true;
}

/**
 * Asks before opening the server atlas a RESCUE came from, which is the one open that still
 * destroys data the user was promised would be kept.
 *
 * THE SEQUENCE THIS EXISTS FOR, and every step of it is an ordinary gesture: a session dies with
 * unsynced operations, so `preserveUnsyncedWorkAsLocal` adopts the namespace as a local slot and
 * the user is TOLD the work was kept on this computer; the user logs back in and reopens THE SAME
 * project; the wipe on the way in lands on `remote-<atlasId>`, which is literally the rescued slot's
 * ten databases (`adoptRemoteAtlasAsLocal` moves the claim, never the bytes). The work is gone, the
 * slot stays in the list and empty, and the namespace ends up claimed by BOTH registries forever,
 * which makes `purgeAllRemoteAtlases` spare server data at every logout from then on.
 *
 * WHY ASK, and what was rejected. Deleting the rescue silently is what the code already did and is
 * the whole defect. Opening the server atlas under a SECOND address was the other candidate: it
 * would need `remoteScope` to stop being one namespace per atlas, and that identity is what the
 * logout sweep, the tab-lock address comparison and the rescue itself are all derived from, so the
 * cure would cost more than the disease. That leaves asking, and the answer set is deliberately two
 * members: the reversible one, and the destructive one the user typed out for themselves.
 *
 * NO "SAVE IT FOR ME" BUTTON HERE, ON PURPOSE. An upload button would have to send the MOUNTED
 * store, and the rescued slot is only sometimes the mounted one (another tab may hold it, and the
 * pointer may have moved). A button whose meaning depends on invisible state is worse than a button
 * that is not there — so the message spells out the route that always works, which is the one the
 * logout toast already promised: go back to the local map and use "Enviar ao servidor".
 *
 * THIS IS NOW THE ONLY QUESTION ON THE WAY IN. A generic "you have unsaved local work" one used to
 * fire first, inherited from the single-address era; it was removed in 2026-08-16 because opening a
 * server project stopped touching the local atlas (see the fileoverview). This one survives it
 * precisely because here the two namespaces ARE the same ten databases.
 *
 * @param {import('@store/local-atlas.api.js').LocalAtlasEntry} rescued - The local slot claiming
 *   this atlas's namespace.
 * @returns {Promise<boolean>} True when the user chose to discard the rescue and open.
 */
async function confirmDiscardingRescuedWork(rescued) {
    const choice = await showChoice('Este atlas tem trabalho resgatado neste computador', {
        message:
            `Quando sua sessão caiu, as alterações que ainda não tinham subido para o servidor foram `
            + `guardadas aqui como o atlas local "${rescued.name}". Ele ocupa o mesmo espaço deste `
            + `atlas do servidor, então abrir agora apaga o resgate.\n\n`
            + `Para não perder nada: cancele, volte ao mapa local e use "Enviar ao servidor".`,
        choices: [
            { id: 'cancel', label: 'Cancelar', variant: 'ghost' },
            { id: 'discard', label: 'Descartar o resgate e abrir', variant: 'danger' },
        ],
    });
    return choice === 'discard';
}

/**
 * Opens a remote atlas, optionally landing on a specific map.
 *
 * Mounts and empties THAT ATLAS'S namespace, never the local one — so an ordinary local workspace
 * is asked nothing and loses nothing. The single question left is for the rescued slot, which
 * really does share these databases.
 *
 * @param {string} atlasId - Atlas UUID.
 * @param {{ mapId?: string|null }} [options] - mapId: a specific map UUID to activate (else initial/last).
 * @returns {Promise<boolean>} true when the atlas was opened; false when the user declined to
 *   discard a rescued slot, or when another tab already holds a server atlas (in which case this
 *   tab is left BLOCKED, with the open remembered for the takeover — see `isTabLockBlocked`).
 * @throws Propagates a connect/permission error (e.g. 403/404) so callers can message the user; on
 *   such a failure the durable origin is reverted to LOCAL so a reload does not retry the dead atlas.
 */
export async function openRemoteAtlas(atlasId, { mapId = null } = {}) {
    // PRE-FLIGHT, and it has to come FIRST. `clearAllDataStore()` below empties the databases this
    // tab has mounted, which is another tab's LIVE data whenever the two hold the same atlas:
    // asking after the wipe is asking after the damage. It also has to precede the rescue question,
    // because there is no point asking what to do with work we are not going to be allowed to
    // replace.
    if (!await claimRemoteAtlas(atlasId)) {
        // Stay claimed and BLOCKED: the overlay is the answer to the user, and its "Usar aqui" is
        // the way through. Nothing is wiped — the outbound queue is global and holds work from BOTH
        // tabs — and the open is remembered so a successful takeover finishes it.
        deferAtlasOpen(() => openRemoteAtlas(atlasId, { mapId }));
        return false;
    }

    // WHOSE WORK THIS WIPE WOULD DESTROY, asked of the local REGISTRY and not of the mounted
    // scope. A rescued slot claims the very namespace this open is about to empty, and it does not
    // have to be the atlas this tab has mounted for that to be true: another tab may hold it, and
    // the local pointer may have moved on. Reading the registry is what makes the question fire in
    // those cases too, and it comes BEFORE anything destructive so "Cancelar" costs nothing.
    // There is NO second question for the ordinary case, and that absence is the correction: the
    // wipe below lands on the namespace being opened, so an ordinary local atlas loses nothing.
    const rescued = await localAtlasAdoptingRemote(atlasId);
    // A refusal leaves this tab holding a claim on an atlas it is not going to open, so the claim
    // goes back to whatever it really holds; leaving it standing would block the next tab for free.
    if (rescued && !await confirmDiscardingRescuedWork(rescued)) {
        syncAtlasLockKey();
        return false;
    }

    // Switching atlases: close any previous server connection first (one socket per atlas — the
    // server has no "switch"), then wipe local + connect the new one.
    if (syncEngine.atlasId) {
        stopAutoFlush();
        syncEngine.disconnect();
    }

    // THE NAMESPACE OF THIS ATLAS, activated before anything writes. `activateRemoteAtlas` is the
    // only legal way in: it REGISTERS the atlas in the remote registry and only then points every
    // store at `ebgeo_*__remote-<atlasId>`. Reaching for `activateScope(remoteScope(...))` instead
    // skips the registration and produces a namespace no logout wipe can find, forever and without
    // an error (`remote-atlas.api.js`, property 1).
    //
    // IT PRECEDES `clearAllDataStore`, and that is not cosmetic. The wipe empties the ACTIVE scope,
    // and by this line the tab-lock claim already names the atlas being OPENED: emptying under the
    // previous scope would erase databases this tab no longer holds the claim for, which with one
    // namespace per atlas is another tab's live data. Activating first aims the wipe at the
    // namespace this tab has just claimed, which is the only one it may destroy.
    try {
        await activateRemoteAtlas(atlasId);
        // AND ONLY NOW the rescue's claim goes away, never before. Registering the remote claim
        // first means a crash between the two lines leaves the namespace claimed TWICE, which is
        // exactly the rescued state and heals itself at the next sweep (`adopted`, stale remote key
        // dropped). Releasing first would leave a window with NO claim at all, and unclaimed data
        // is the one outcome the two registries exist to prevent. Nothing has been emptied yet
        // either way: the wipe is the next statement.
        if (rescued) await releaseAdoptedLocalAtlas(atlasId);
    } catch (error) {
        // The registry write comes first inside it, so a failure here activated NOTHING and wrote
        // nothing. Retract, or every other tab stays locked out on behalf of an atlas this one
        // never opened.
        retractAtlasClaim();
        throw error;
    }

    // `markLocal: false`: the very next line marks REMOTE, and the marker is global to the
    // installation. Flipping it to LOCAL in between announced, to every other tab, an origin
    // that contradicts what this one had already mounted.
    await clearAllDataStore({ markLocal: false });
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
    // A APARÊNCIA É DO ATLAS QUE ACABOU DE ENTRAR, e o cache dela vive num módulo: sem esta
    // releitura, um atlas local marcado como "plano" deixava plano um projeto de servidor que
    // nunca escolheu nada. O boot não cobre este caso — ele lê antes do namespace montar e antes
    // do snapshot chegar.
    await reapplyAtlasAppearance(getControl('TerrainControl'), globalThis.__ebgeoMap);
    startAutoFlush();
    return true;
}

/**
 * Leaves whatever atlas this tab holds and lands on a BRAND-NEW, EMPTY local atlas.
 *
 * This is the fifth (and last) entry into an atlas, and it exists for one caller: importing a
 * `.ebgeo` while a SERVER project is open. That import used to be refused outright (phase E3's
 * deliberate cut), because the alternative available then was worse: the import writes into
 * whatever scope is mounted, so with a namespace per atlas the imported project was born inside
 * `ebgeo_*__remote-<id>` and died with it at the next logout, silently.
 *
 * THE ORDER IS THE CONTRACT, and it is the same one `openRemoteAtlas` obeys, for the same reason:
 *
 *   1. CREATE FIRST, because creating is the only step that can be REFUSED (the cap of 10 local
 *      atlases) and the only one that is not destructive. A cap hit here has cost the user
 *      nothing: the socket is still up, the server project is still open, and the caller gets a
 *      pt-BR refusal instead of an exception. Creating writes into the NEW slot's own databases
 *      (`seedAtlasRecord` passes an explicit scope), never into the mounted one.
 *   2. DISCONNECT, because one socket belongs to one atlas and the server has no "switch". The
 *      outbound queue is deliberately NOT cleared: since E2B every operation carries the scope it
 *      was born in, so the server atlas's pending work stays queued for the next time it is
 *      opened instead of being discarded on the way out.
 *   3. MOUNT, and only then WIPE. The wipe empties the ACTIVE scope; running it before the mount
 *      would empty the server atlas's namespace, which is another tab's live data whenever two
 *      tabs hold the same atlas. Mounting first aims it at the slot created in step 1, which is
 *      empty anyway — the wipe is here to rebuild the in-memory store (and the drawn map) from
 *      the new slot, not to destroy anything.
 *   4. DECLARE the origin LOCAL last, after the wipe, so the marker can never announce an origin
 *      that contradicts the namespace actually mounted.
 *
 * THE CLAIM MOVES WITHOUT ARBITRATION, on purpose. A slot created one line above carries a fresh
 * UUID and fresh databases, so no peer can be holding it; `syncAtlasLockKey` re-derives the key
 * from the scope now mounted, which both releases the server atlas for other tabs and stops this
 * one from being blocked on its behalf.
 *
 * PARTIAL FAILURE, and what survives it. If anything after step 1 throws, NOTHING has been
 * destroyed: the server atlas's databases were never the wipe's target and no operation was
 * pushed. The user may end up on an empty local atlas with the server project closed, which is
 * recoverable by reopening it from "Seus atlas"; the caller is expected to say so.
 *
 * @param {string} name - Display name for the new atlas, pt-BR. Duplicates are suffixed.
 * @returns {Promise<import('@store/local-atlas.api.js').LocalAtlasResult>} `{ ok: true, atlas }`,
 *   or the named refusal `createLocalAtlas` produced (cap reached), in which case NOTHING moved.
 * @throws {Error} Propagates a persistence failure from the mount or the wipe.
 */
export async function switchToNewLocalAtlas(name) {
    const created = await createLocalAtlas(name);
    if (!created.ok) return created;

    if (syncEngine.atlasId) {
        stopAutoFlush();
        syncEngine.disconnect();
    }

    await mountLocalAtlas(created.atlas.id);
    syncAtlasLockKey();
    // `clearQueue: false` is SPELLED OUT rather than left to follow `markLocal`, because this
    // caller breaks the coupling that default encodes. `markLocal: true` means "this wipe ends in
    // a blank local store, so abandon the pending work with it"; here the pending work belongs to
    // the SERVER atlas just left, which is still on the server and still reopenable, so discarding
    // it would push ghosts (or lose edits) the next time that atlas is opened. Whether the queue in
    // reach is even the same one is a property of the queue's own addressing, and this line must
    // not depend on which way that is settled.
    await clearAllDataStore({ markLocal: false, clearQueue: false });
    await markStoreLocal();

    return created;
}
