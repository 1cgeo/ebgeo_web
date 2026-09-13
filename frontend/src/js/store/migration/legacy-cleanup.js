// Path: js/store/migration/legacy-cleanup.js

/**
 * @fileoverview The copies the legacy transition ABANDONS, and who is allowed to collect them
 * (decision D8 of 2026-09-13).
 *
 * ===========================================================================================
 * WHAT ACCUMULATES, AND WHY NOTHING USED TO COLLECT IT
 * ===========================================================================================
 * The transition never deletes: `legacy-transition.js` copies the pre-namespace acervo into
 * `upgrade-<uuid>`, and `restartLegacyCopy` pushes that address into `state.history` and mints
 * another one whenever a copy is interrupted. A restoration that dies halfway leaves
 * `recovery-<id>` plus its `recovery_pending:` key (`recovery-archive.js`). Every one of those
 * is a FULL copy of the same acervo, and only the recovery exporter could even name them, so a
 * user who hit two interruptions carried three copies on disk with no way to see or drop them.
 *
 * ===========================================================================================
 * THE RULE IS THE ONE THE SNAPSHOT GENERATIONS ALREADY USE (D3)
 * ===========================================================================================
 * Keep the live one plus ONE reserve, drop the rest, and never guess. The reserve is the floor
 * of a reader that was already walking that copy (`buildRecoveryArchive` names the destination
 * AND the history), and, once the origin is gone, the only complete copy left besides the
 * active one. Anything older has already survived a whole interruption cycle without anybody
 * resolving it.
 *
 * A DELETE THAT DOES NOT CONFIRM KEEPS ITS ENTRY, for the same reason it does there: the
 * surviving list is written AFTER the deletes, because a list that names a database no longer
 * on disk is exactly the leak this path exists to close, and its mirror image (a database on
 * disk that no list names) is worse, since nothing can ever find it again.
 *
 * ===========================================================================================
 * THE ORIGIN IS NOT SWEPT, AND THAT IS THE HALF THIS FILE DOES NOT DECIDE
 * ===========================================================================================
 * The unsuffixed databases (the acervo the previous product line still knows) are the user's
 * other copy, and nothing here touches them: the sweep is automatic, and automatic deletion of
 * the only pre-update copy is not a decision code may take. `dropLegacySource` is the separate,
 * explicit gesture, and the button that calls it is on the recovery screen.
 */

import {
    getGlobalStore, dropAtlasDatabases, localScope, readLocalAtlasRegistry
} from '../atlas-namespace.js';
import {
    LEGACY_TRANSITION_KEY, RECOVERY_PENDING_PREFIX, TRANSITION_LOCK,
    readLegacyTransition, recoveryDbSuffix
} from './transition-state.js';

/**
 * How long an unfinished restoration is left alone before the boot sweep drops it.
 *
 * SEVEN DAYS, and the number is chosen from the two failure modes, not from taste. Deleting too
 * EARLY destroys a restoration that is merely paused: `recoverLateLegacyChanges` resumes across
 * boots under the same id, and a person who starts a recovery on Friday and comes back on Monday
 * has to find it where they left it. Deleting too LATE only costs disk, which is the thing this
 * sweep is trading against, so the asymmetry says to be generous. A week is the longest gap an
 * interruption plausibly survives as a still-wanted resume (a weekend plus a holiday), and the
 * record is stamped once at the START of the restoration, never refreshed, so the clock measures
 * the whole attempt and not the last write.
 *
 * @type {number}
 */
export const ABANDONED_RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Runs a task under the transition lock when the browser has one.
 *
 * The sweep reads and rewrites the SAME journal that `restartLegacyCopy` and the restoration
 * write, so it takes the same lock they take. Without a lock manager it runs anyway: a
 * non-secure context already cannot run the transition itself, and refusing to collect disk
 * there would only make the degraded case the one that accumulates copies forever.
 *
 * @param {() => Promise<*>} task - Work to run.
 * @returns {Promise<*>} Whatever the task returned.
 */
function withTransitionLock(task) {
    const locks = globalThis.navigator?.locks;
    if (!locks?.request) return task();
    return locks.request(TRANSITION_LOCK, task);
}

/**
 * @typedef {Object} CleanupReport
 * @property {string[]} copies - `upgrade-<uuid>` suffixes whose databases are now off disk.
 * @property {Array<{ id?: string, key?: string, outcome: string }>} recoveries - Pending
 *   restoration records that were collected, each with WHY.
 * @property {string[]} kept - Restorations left alone because they are still inside the window.
 * @property {string[]} blocked - Suffixes whose delete did not confirm. They keep their entry,
 *   so the next boot retries; this is disk cost, never data loss.
 */

/**
 * Drops the abandoned copies of the legacy transition, keeping one reserve.
 *
 * Called by the boot gate (`runLegacyUpgradeGate`) AFTER the transition itself has settled,
 * which is what makes it safe to reason about `state.history`: the active destination is
 * committed and nothing is copying.
 *
 * @param {Object} [options]
 * @param {number} [options.now] - Clock, injectable so a test can age a record without waiting.
 * @param {number} [options.maxAgeMs] - Window an unfinished restoration is left alone for.
 * @param {number} [options.timeoutMs] - Per-database bound handed to `dropAtlasDatabases`.
 * @returns {Promise<CleanupReport>}
 */
export async function pruneAbandonedCopies({
    now = Date.now(),
    maxAgeMs = ABANDONED_RECOVERY_MAX_AGE_MS,
    timeoutMs
} = {}) {
    return withTransitionLock(async () => {
        const report = { copies: [], recoveries: [], kept: [], blocked: [] };
        await pruneTransitionHistory(report, timeoutMs);
        await pruneStaleRestorations(report, now, maxAgeMs, timeoutMs);
        return report;
    });
}

/**
 * Keeps the most recent abandoned destination and drops every older one.
 *
 * @param {CleanupReport} report - Mutated with what happened.
 * @param {number|undefined} timeoutMs - Per-database bound.
 * @returns {Promise<void>}
 */
async function pruneTransitionHistory(report, timeoutMs) {
    let state = null;
    try {
        state = await readLegacyTransition();
    } catch {
        // An unreadable journal is the recovery screen's case, not the sweep's: it is the one
        // state in which this function cannot tell an abandoned address from the live one.
        return;
    }
    if (!state || !Array.isArray(state.history) || state.history.length <= 1) return;

    const reserve = state.history[state.history.length - 1];
    const condemned = state.history
        .slice(0, -1)
        .filter(suffix => suffix !== reserve && suffix !== state.destination);
    if (condemned.length === 0) return;

    const survived = [];
    for (const suffix of condemned) {
        const { blocked } = await dropAtlasDatabases(localScope(state.entry.id, suffix), options(timeoutMs));
        if (blocked.length > 0) {
            survived.push(suffix);
            report.blocked.push(suffix);
        } else {
            report.copies.push(suffix);
        }
    }

    // AFTER the deletes, never before.
    const next = state.history.filter(suffix => !condemned.includes(suffix) || survived.includes(suffix));
    if (next.length !== state.history.length) {
        await getGlobalStore().setItem(LEGACY_TRANSITION_KEY, { ...state, history: next });
    }
}

/**
 * Collects the records of restorations that finished, or that were abandoned long enough ago.
 *
 * THE THREE OUTCOMES ARE NOT THE SAME GESTURE, and reading them as one would delete a registered
 * atlas: a restoration whose id is IN the local registry has finished (the registry entry is
 * written one line before the pending key is removed, so a crash between them leaves exactly
 * this state), and its `recovery-<id>` databases are a card the user can open. There, only the
 * stale KEY goes. The databases go only for a record the registry never claimed.
 *
 * @param {CleanupReport} report - Mutated with what happened.
 * @param {number} now - Clock.
 * @param {number} maxAgeMs - Window.
 * @param {number|undefined} timeoutMs - Per-database bound.
 * @returns {Promise<void>}
 */
async function pruneStaleRestorations(report, now, maxAgeMs, timeoutMs) {
    const global = getGlobalStore();
    const registered = new Set((await readLocalAtlasRegistry()).map(entry => entry?.id));

    for (const key of await global.keys()) {
        if (typeof key !== 'string' || !key.startsWith(RECOVERY_PENDING_PREFIX)) continue;
        const pending = await global.getItem(key);
        const id = typeof pending?.id === 'string' && pending.id.length > 0 ? pending.id : null;

        // THE SUFFIX IS DERIVED AND COMPARED, never trusted: a record that does not address the
        // namespace this product would have minted for that id names databases nothing can reach,
        // and honouring its suffix would let a malformed record aim a deletion at another atlas.
        if (!id || pending.dbSuffix !== recoveryDbSuffix(id)) {
            await global.removeItem(key);
            report.recoveries.push({ key, outcome: 'unreadable' });
            continue;
        }

        if (registered.has(id)) {
            await global.removeItem(key);
            report.recoveries.push({ id, outcome: 'finished' });
            continue;
        }

        const startedAt = Number.isFinite(pending.createdAt) ? pending.createdAt : null;
        if (startedAt !== null && now - startedAt < maxAgeMs) {
            report.kept.push(id);
            continue;
        }

        const { blocked } = await dropAtlasDatabases(localScope(id, pending.dbSuffix), options(timeoutMs));
        if (blocked.length > 0) {
            // The key stays, so the next boot retries. Removing it here would leave half a
            // restoration on disk under a name nothing else ever opens.
            report.blocked.push(pending.dbSuffix);
            continue;
        }
        await global.removeItem(key);
        report.recoveries.push({ id, outcome: 'abandoned' });
    }
}

/**
 * @param {number|undefined} timeoutMs - Per-database bound, or undefined for the default.
 * @returns {Object} Options object for `dropAtlasDatabases`, without overriding its default
 *   with `undefined`.
 */
function options(timeoutMs) {
    return timeoutMs === undefined ? {} : { timeoutMs };
}
