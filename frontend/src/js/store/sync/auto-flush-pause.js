// Path: js/store/sync/auto-flush-pause.js

// Shared with account-only pages: no import of the map or sync engine belongs here.
import { logoutBarrierBlocks } from '@store/write-coordinator.js';
import { getActiveScope } from '@store/atlas-namespace.js';

let pauses = 0;
const active = new Set();

export function canStartAutoFlush() { return pauses === 0; }

export function trackAutoFlush() {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    active.add(pending);
    return () => { active.delete(pending); finish(); };
}

/** Suspend new sends and expose the completion of every already-started auto-flush. */
export function pauseAutoFlush() {
    pauses += 1;
    let resumed = false;
    return {
        settled: Promise.all([...active]),
        resume() {
            if (!resumed) pauses -= 1;
            resumed = true;
        },
    };
}

/**
 * THE SAME QUESTION ACROSS TABS: is a logout dialog holding the barrier of the mounted scope?
 *
 * `canStartAutoFlush` only knows about pauses taken in THIS document, and the send is precisely the
 * act a sibling's logout must stop: it pushes work that the dialog is about to count and discard,
 * and the server would accept it after the person agreed to lose it. It PROBES rather than holds
 * (`logoutBarrierBlocks`), because a flush has nothing to protect across the await: what it pushes
 * is already on disk.
 *
 * @returns {Promise<boolean>} True when the send must not happen now. False whenever there is no
 *   fact to read (a local atlas, a runtime without Web Locks), which is the regime this module had
 *   before the barrier existed.
 */
export async function autoFlushBarredByLogout() {
    return logoutBarrierBlocks(getActiveScope());
}
