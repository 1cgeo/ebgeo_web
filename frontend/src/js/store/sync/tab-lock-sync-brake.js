// Path: js/store/sync/tab-lock-sync-brake.js

/**
 * @fileoverview The EFFECT half of the tab lock: what "this tab lost the arbitration" actually
 * DOES to the sync.
 *
 * The lock itself (`utilities/tab-lock.js`) decides WHO holds an atlas and shows the overlay. It
 * cannot perform the stop, because it must not import the store: the three pages without a map
 * use it, and a module that can reach `clearAllDataStore` is one edit away from erasing the very
 * data it exists to protect. So the arbitration lives there, the effect lives here, and the two
 * are joined by `setTabLockEffects` at page level. The direction of the import is the point:
 * sync knows about the lock, the lock knows nothing about sync.
 *
 * WHAT BLOCKING MEANS HERE
 * - `stopAutoFlush()` — the 1.5 s drain of the outbound queue stops. Behind the old overlay it
 *   kept running, so the "blocked" tab went on writing to the server.
 * - `syncEngine.disconnect()` — the WebSocket closes, which also takes this tab out of the
 *   presence roster and stops inbound operations from landing in a store another tab owns.
 *
 * WHAT BLOCKING MUST NEVER MEAN
 * - NOTHING IS ERASED. Two tabs collide only when they hold the SAME atlas, and the outbound queue
 *   is per atlas, so on a collision it is ONE queue holding the unsynced work of BOTH tabs and
 *   wiping it discards the loser's and the winner's alike. (This line used to say the queue was
 *   global; it stopped being global, and the conclusion did not change, only the reason.) This
 *   module has no import that can clear storage, and a test reads the source to keep it that way.
 * - The ANONYMOUS path does not move. A tab with no connection and no flush loop has nothing to
 *   stop: the brake records that it stopped nothing and calls neither function, so no
 *   `ATLAS_SETTINGS_CHANGED` is emitted and no config is reverted for a tab that never had one.
 *
 * RESUME RESTORES EXACTLY WHAT WAS STOPPED, which is why the stop records it. A tab that wins
 * the claim back ("Usar aqui", or the holder died) and stayed disconnected would be a zombie:
 * unblocked, editable, and silently offline. So the release reconnects the atlas it disconnected
 * (`connectPublic` when the session is a public visitor, `connect` otherwise) and restarts the
 * flush only if it had been running. A reconnect that fails leaves the tab unblocked but offline
 * and SAYS so, because that is the one state the user cannot see for themselves.
 *
 * AND ONLY IF THE TAB STILL WANTS THAT ATLAS. A blocked tab is not a frozen tab: while it waits,
 * the user can log out, lose the session to a 401, or open another atlas, and each of those is a
 * live key change on the lock, hence a resume. Restoring the recorded connection blindly would
 * drag a logged-out user back into a server atlas. `syncEngine.atlasId` decides, the same source
 * of truth the URL sync reads.
 *
 * ORDER, ON A HANDOFF. `applySyncBrake` is what the yielding tab awaits before it retracts its
 * key, so "the other tab already disconnected" is evidence and not a hope. Keep it awaitable:
 * making the stop fire-and-forget would restore exactly the race the handoff was built to close.
 *
 * THE REPLAY COMES FIRST ON THE WAY BACK, and that is the one order in this file that is not
 * "undo the stop". A tab blocked while OPENING another atlas keeps that open as a deferred thunk
 * (`open-atlas.service.js`); when it wins the claim, replaying the open is what the user asked
 * for, and it connects on its own. Reconnecting the recorded atlas first would pull a whole
 * snapshot of an atlas the tab is leaving in the next line. So the replay runs, and if it ran the
 * record is DISCARDED rather than applied. If it did not run (the ordinary handoff: a tab that was
 * already in its atlas and got it back), the record is applied and the tab reconnects.
 *
 * THE THIRD EFFECT IS THE FREEZE, and it answers a different question from the other two. Blocking
 * means "another tab holds this atlas" and is reversible; freezing means "the databases this tab
 * writes to are being DESTROYED" (a logout in a sibling tab sweeps every remote namespace on the
 * machine, including the one mounted here) and is not. The notice arrives on the lock's channel
 * addressed by a set of database addresses, and matching it is this module's job precisely because
 * the lock may not import the store: only here can `getActiveScope()` be read.
 *
 * WHAT THE FREEZE HAS TO ACHIEVE:
 *   1. the automatic writers stop (`applySyncBrake`: the 1.5 s drain and the inbound socket);
 *   2. the brake's record is DISCARDED, because there is nothing to restore. The lock keeps a
 *      frozen tab out of `onResumed` on its side too; belt and braces, since a reconnect here
 *      would pull a snapshot into a namespace whose session is over.
 *
 * AND WHAT IT MUST NOT DO IS LET GO OF THE MOUNT LOCK, which is the one line of this module that
 * cost a data loss. It used to release it (and clear the active scope with it), on the reasoning
 * that a tab which stopped but kept the lock would leave the namespace standing and only push the
 * destruction out to the 24 h reprieve. That reasoning traded the wrong thing away, because the
 * mount lock is not a formality about WHEN the namespace dies: it is the only thing standing
 * between the sibling's databases and the sweep. Measured, atlas Y open in the sibling: with the
 * mount held the sweep reports `spared:[Y]` and both the data and the per-atlas outbound queue
 * (`ebgeo__remote-Y`) survive; with it released the sweep reports `atlases:[Y]`, the data reads
 * back `null` and the queue database is gone. So obeying the notice was what destroyed the tab the
 * notice was invented to protect, unsynced work included, and that work has no rescue on this side
 * (`preserveUnsyncedWorkAsLocal` only runs in the tab that logs out).
 *
 * THE TWO LOSSES, AND THE ONE THAT IS CHOSEN. Releasing loses the sibling's unsynced operations,
 * irreversibly and with no gesture from its user. Keeping loses nothing of the user's, and costs
 * this instead: a server atlas's data stays on this machine after somebody logged out, for as long
 * as the frozen tab keeps the lock, and at most `SPARE_GRACE_MS` past the first sparing before a
 * later sweep takes it by force. That residue is bounded, it is already the arbitrated behaviour
 * for every sibling that does not answer the notice at all (an older-protocol tab, a freeze that
 * throws), and the reprieve exists precisely to time-box it. Work destroyed under a live tab is
 * bounded by nothing.
 *
 * WHICH IS ALSO WHY THE ACTIVE SCOPE STAYS. Clearing it was step 3 of the old design, and its whole
 * job was to stop a stray write from RECREATING databases that had just been deleted, outside the
 * registry, where no later sweep finds them. With the mount kept, those databases are not deleted:
 * they are spared, still registered, and a write that slips through lands where it always did. The
 * clearing would now be the harmful half, because `ensureAtlasScope`
 * (`repositories/local.repository.js`) sends a scope-less write to the LEGACY `ebgeo_maps`, i.e.
 * into the user's own local slot.
 *
 * THE EXCEPTION IS A RUNTIME WITH NO WEB LOCKS (plain HTTP, a hardened embedder), where
 * `withExclusiveAtlasLock` is granted unconditionally and sparing is impossible by construction.
 * There the databases really are going away whatever this tab does, so the freeze keeps the old
 * behaviour: release, clear the scope, and accept the legacy bridge as the lesser evil.
 *
 * The freeze also shows the lock's blocking overlay in both regimes, because the gestures that
 * would still produce a write are the user's, and the overlay is what stops them.
 *
 * THE PUBLIC VISITOR IS THE ONE TAB THAT DOES NOT FREEZE. It is anonymous by definition, so the
 * logout of some other identity says nothing about it, and it is protected by the mount lock it
 * keeps rather than by the session gate. Freezing it would hand its namespace to a sweep that has
 * no business there.
 *
 * @dependencies sync-engine.js, sync-flush.js, connection-state.js, session-context.js,
 *   @store/atlas-namespace.js, @utils/tab-lock.js, @utils/toast_service.js
 */

import { syncEngine } from './sync-engine.js';
import { connectionState } from './connection-state.js';
import { sessionContext } from './session-context.js';
import { startAutoFlush, stopAutoFlush, isAutoFlushRunning } from './sync-flush.js';
import {
    getActiveScope,
    clearActiveScope,
    releaseMountLock,
    hasMountLockSupport
} from '@store/atlas-namespace.js';
import { setTabLockEffects } from '@utils/tab-lock.js';
import { showWarning } from '@utils/toast_service.js';

/**
 * What the brake stopped, so the release can put back that and nothing else.
 * @type {{engaged: boolean, flushWasRunning: boolean, atlasId: string|null, visitor: boolean}}
 */
const state = {
    engaged: false,
    flushWasRunning: false,
    atlasId: null,
    visitor: false,
};

/** Resets the record to "nothing stopped". @returns {void} */
function clearRecord() {
    state.engaged = false;
    state.flushWasRunning = false;
    state.atlasId = null;
    state.visitor = false;
}

/**
 * Snapshot of what the brake is holding down. Diagnostics and tests only.
 * @returns {{engaged: boolean, flushWasRunning: boolean, atlasId: string|null, visitor: boolean}}
 */
export function getSyncBrakeState() {
    return { ...state };
}

/**
 * FORGETS what was stopped, without restoring it. For the one case where restoring would be
 * wrong: a replayed atlas open has just connected this tab somewhere else, so the record
 * describes an atlas the tab has left. Applying it there means a pointless snapshot pull
 * followed immediately by a disconnect.
 * @returns {void}
 */
export function discardSyncBrakeRecord() {
    clearRecord();
}

/**
 * STOPS this tab's sync because another tab holds the atlas. Idempotent: a second call while the
 * brake is engaged changes nothing and, crucially, does not overwrite the record of what to
 * restore (a re-entrant stop would record "nothing was running" and lose the reconnect target).
 *
 * Awaitable on purpose: the tab-lock handoff waits for this to finish before retracting its key.
 * @returns {Promise<void>}
 */
export async function applySyncBrake() {
    if (state.engaged) return;

    const atlasId = syncEngine.atlasId ?? null;
    const wasConnected = Boolean(atlasId) || connectionState.isOnline();

    state.engaged = true;
    state.flushWasRunning = isAutoFlushRunning();
    state.atlasId = atlasId;
    state.visitor = sessionContext.isVisitor();

    if (state.flushWasRunning) stopAutoFlush();
    // Never disconnect a tab that was never connected: `disconnect()` also reverts the per-atlas
    // config overlay and emits, which for an anonymous local tab is noise about a state it was
    // never in.
    if (wasConnected) syncEngine.disconnect();
}

/**
 * RESTORES what {@link applySyncBrake} stopped, after this tab wins the claim back. No-op when
 * the brake was never engaged, so an unblock that follows nothing does nothing.
 * @returns {Promise<void>}
 */
export async function releaseSyncBrake() {
    if (!state.engaged) return;

    const { atlasId, flushWasRunning, visitor } = state;
    // Cleared BEFORE the awaits: a reconnect can take seconds, and a second block arriving in
    // that window must be free to record the new truth instead of being swallowed as re-entrant.
    clearRecord();

    // A blocked tab is not a frozen tab: the user can log out (remote becomes local, the map
    // stays), lose the session to a 401, or open another atlas. `syncEngine.atlasId` is the same
    // source of truth the URL sync reads, and it is nulled by `logoutAndDisconnect` and replaced
    // by a new open, so a mismatch means the atlas this brake stopped is no longer the one this
    // tab wants. Reconnecting it anyway would pull a logged-out user back into a server atlas.
    if (!atlasId || syncEngine.atlasId !== atlasId) return;

    if (!connectionState.isOnline()) {
        try {
            if (visitor) {
                await syncEngine.connectPublic(atlasId);
            } else {
                await syncEngine.connect(atlasId, { initialPull: true });
            }
        } catch (error) {
            console.warn('[tab-lock] reconnect after takeover failed:', error);
            try {
                showWarning(
                    'Esta aba assumiu o projeto, mas não conseguiu reconectar ao servidor. '
                    + 'Recarregue a página para voltar a sincronizar.',
                    { duration: 8000 }
                );
            } catch {
                // Headless (tests, worker): no UI to tell.
            }
            return;
        }
    }

    if (flushWasRunning) startAutoFlush();
}

/**
 * ANSWERS AN UNMOUNT NOTICE: another tab is about to destroy the databases named in `addresses`.
 *
 * It reports whether THIS tab was one of the writers and has stopped, which is what the lock acks
 * back to the sender. `false` is the safe answer and the common one (most notices name namespaces
 * this tab never mounted): the sender then finds the namespace either unmounted, and destroys it,
 * or mounted by somebody else, and spares it.
 *
 * STOPPING IS THE WHOLE ANSWER. The tab keeps its mount lock, so the sweep waiting on this ack
 * finds the namespace mounted and SPARES it, data and outbound queue included; see the fileoverview
 * for the two losses and which one is chosen. The mount is let go only where the lock does not
 * exist, and there it buys nothing anyway.
 *
 * @param {string[]} addresses - `dbSuffix` values about to be destroyed.
 * @returns {Promise<boolean>} True when this tab held one of them and is now stopped.
 */
export async function applyTeardownFreeze(addresses) {
    const scope = getActiveScope();
    if (!scope || !Array.isArray(addresses) || !addresses.includes(scope.dbSuffix)) return false;
    // The public visitor holds a server namespace without a session, so a logout elsewhere is not
    // about it. The mount lock it keeps is what protects it.
    if (sessionContext.isVisitor()) return false;

    await applySyncBrake();
    if (!hasMountLockSupport()) {
        // No arbitration in this runtime: the sweep is granted whatever this tab holds, so the
        // databases are going regardless and the only remaining job is to keep a stray write from
        // recreating them outside the registry. AWAITED before `clearActiveScope`, which fires its
        // own release but neither targets a scope nor is awaitable.
        await releaseMountLock(scope);
        clearActiveScope();
    }
    // Nothing to put back: this tab's session is over. Discarding the record is what keeps a later
    // resume from reconnecting to an atlas nobody is entitled to any more.
    discardSyncBrakeRecord();
    return true;
}

/**
 * Wires the brake into the page's tab lock. Call it once, on a page that can hold an atlas (the
 * map). Late-safe: a tab that is already blocked when this runs is stopped right away, and the
 * returned promise resolves once that catch-up stop has finished.
 *
 * This is the ONLY wiring of the lock's effects, on purpose. Passing `onBlocked`/`onResumed`
 * straight to `initTabLock` is how the map page ended up with a stop that erased nothing but also
 * restored nothing: unblocking left the tab editable and silently offline. Handing the whole pair
 * to one owner is what keeps the stop and the restore describing the same thing.
 *
 * THE THREE HANDLERS BELOW ARE THE WHOLE SEAM, and it is measured as one. Deleting `onTeardown`
 * from this call used to leave every case of both suites green: the protocol proved itself against
 * a fake effect, the effect proved itself against a direct call, and nothing walked the wire a real
 * tab walks. `tests/unit/tab-lock-sync-brake.test.js` §"o aviso atravessa o protocolo até o freio
 * REAL" is what fails now, in the same arrangement `index.js` builds.
 *
 * @param {Object} [options]
 * @param {(() => Promise<boolean>)|null} [options.replay] - An open this tab still owes (see the
 *   fileoverview). It runs BEFORE the restore and, when it reports that it ran, replaces it.
 * @returns {Promise<void>}
 */
export function installTabLockSyncBrake({ replay = null } = {}) {
    return setTabLockEffects({
        onBlocked: applySyncBrake,
        onResumed: async () => {
            if (replay && await replay()) {
                discardSyncBrakeRecord();
                return;
            }
            await releaseSyncBrake();
        },
        onTeardown: applyTeardownFreeze,
    });
}
