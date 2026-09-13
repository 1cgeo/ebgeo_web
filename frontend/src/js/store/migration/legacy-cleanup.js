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
 * THE ORIGIN IS NOT SWEPT: IT IS ORDERED, AND THE SWEEP ONLY RESUMES THE ORDER
 * ===========================================================================================
 * The unsuffixed databases (the acervo the previous product line still knows) are the user's
 * other copy, and no automatic path deletes them: deleting the only pre-update copy is not a
 * decision code may take. `dropLegacySource` is the separate, explicit gesture, reached from the
 * button on the recovery screen; the sweep's ONLY business with the origin is finishing a drop
 * that was already ordered and died halfway (`TransitionStatus.DROPPING_SOURCE`), which is
 * carrying out an order, not taking one.
 *
 * AND IT IS ALSO WHY THIS IS A SEPARATE FILE. `legacy-transition.js` declares in its first line
 * that the procedure never writes the originals; the deletion has to live somewhere a reader
 * cannot mistake for the migration.
 */

import {
    LEGACY_DB_SUFFIX, getGlobalStore, dropAtlasDatabases, localScope, readLocalAtlasRegistry
} from '../atlas-namespace.js';
import { legacyScope } from './migration-scope.js';
import { inventoryScope, legacyHasChanged } from './legacy-transition.js';
import {
    LEGACY_TRANSITION_KEY, RECOVERY_PENDING_PREFIX, TRANSITION_LOCK, MigrationRecoveryError,
    TransitionStatus, readLegacyTransition, recoveryDbSuffix, transitionIsSettled
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
 * @property {string|null} source - `'dropped'` when an ORDERED deletion of the origin was
 *   finished here, `'blocked'` when it could not be, null when there was none to finish.
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
        const report = { copies: [], recoveries: [], kept: [], blocked: [], source: null };
        await finishOrderedSourceDrop(report, timeoutMs);
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
 * Finishes a deletion of the origin that was ordered and interrupted.
 *
 * @param {CleanupReport} report - Mutated with what happened.
 * @param {number|undefined} timeoutMs - Per-database bound.
 * @returns {Promise<void>}
 */
async function finishOrderedSourceDrop(report, timeoutMs) {
    let state = null;
    try {
        state = await readLegacyTransition();
    } catch {
        return;
    }
    if (state?.status !== TransitionStatus.DROPPING_SOURCE) return;
    report.source = (await eraseLegacySource(state, timeoutMs)).settled ? 'dropped' : 'blocked';
}

/**
 * Deletes the data databases of the pre-namespace origin and settles the journal.
 *
 * THE INTENT IS ALREADY ON DISK when this runs (`DROPPING_SOURCE`), which is what makes it safe
 * to call twice: `dropInstance` on a name that is not there answers success, so a resumed drop
 * is the same work, and the journal only reaches `SOURCE_DROPPED` after every delete confirmed.
 *
 * THE JOURNAL'S INVENTORIES ARE EMPTIED WITH THE DATABASES, and that is not bookkeeping. They
 * are what `legacyHasChanged` compares against, so leaving the old lists in place would make
 * every later boot announce "the previous version wrote changes" about an acervo the user just
 * deleted; emptying them also keeps the comparison ALIVE for the one case that still matters,
 * a legacy tab that writes to the address again after the deletion.
 *
 * @param {Object} state - Journal record, already at `DROPPING_SOURCE`.
 * @param {number|undefined} timeoutMs - Per-database bound.
 * @returns {Promise<{ settled: boolean, dropped: string[] }>} Whether every delete confirmed and
 *   the journal reached `SOURCE_DROPPED`, and which database names went.
 */
async function eraseLegacySource(state, timeoutMs) {
    const { dropped, blocked } = await dropAtlasDatabases(legacyScope(), {
        atlasDataOnly: true, ...options(timeoutMs)
    });
    if (blocked.length > 0) return { settled: false, dropped };
    await getGlobalStore().setItem(LEGACY_TRANSITION_KEY, {
        ...state,
        status: TransitionStatus.SOURCE_DROPPED,
        sourceInventory: [],
        acknowledgedInventory: []
    });
    return { settled: true, dropped };
}

/**
 * @typedef {Object} LegacySourceVerdict
 * @property {string} reason - `'ok'` when the origin may be deleted right now, otherwise WHY not:
 *   `no_transition`, `not_committed`, `legacy_changes`, `claimed`, `already_dropped`,
 *   `unreadable`. The recovery screen turns each into a sentence.
 * @property {number} records - How many records the origin still holds, for the confirmation to
 *   name. Zero whenever the reason is not `'ok'`, because a number nobody may act on is noise.
 */

/**
 * Reads the state of the pre-namespace origin: may it be deleted, and how big is it?
 *
 * IT IS READ TWICE BY THE SCREEN ON PURPOSE, once to decide whether the command is drawn as
 * available and once inside the click. The state is reversible from the other side (a legacy tab
 * can write between the two), so the answer has to be taken again at the moment of the act; the
 * first read only decides how the command LOOKS.
 *
 * @returns {Promise<LegacySourceVerdict>}
 */
export async function describeLegacySource() {
    let state = null;
    try {
        state = await readLegacyTransition();
    } catch {
        return { reason: 'unreadable', records: 0 };
    }
    if (!state) return { reason: 'no_transition', records: 0 };
    // An order already given is resumable, and the screen may offer to finish it.
    if (state.status === TransitionStatus.DROPPING_SOURCE) {
        return { reason: 'ok', records: (await inventoryScope(legacyScope())).length };
    }
    if (!transitionIsSettled(state)) return { reason: 'not_committed', records: 0 };
    if (await legacyHasChanged(state)) return { reason: 'legacy_changes', records: 0 };
    // A NAMED SLOT THAT CLAIMS THE UNSUFFIXED DATABASES IS AN ATLAS, NOT A LEFTOVER: the card is
    // in the user's list and deleting it here would be deleting an atlas from a screen that
    // promises to delete a copy. It cannot happen after a commit (the registry entry is rewritten
    // to the destination suffix), which is exactly why it is worth refusing out loud.
    if ((await readLocalAtlasRegistry()).some(entry => entry?.dbSuffix === LEGACY_DB_SUFFIX)) {
        return { reason: 'claimed', records: 0 };
    }
    const records = (await inventoryScope(legacyScope())).length;
    if (state.status === TransitionStatus.SOURCE_DROPPED && records === 0) {
        return { reason: 'already_dropped', records: 0 };
    }
    return { reason: 'ok', records };
}

/**
 * Deletes the pre-namespace origin. THE ONLY CALLER IS THE BUTTON ON THE RECOVERY SCREEN.
 *
 * @param {Object} [options_]
 * @param {number} [options_.timeoutMs] - Per-database bound, for a test that does not want to
 *   wait out a held connection.
 * @returns {Promise<{ records: number, dropped: string[] }>} What was deleted, so the screen can
 *   name the same number the confirmation named.
 * @throws {MigrationRecoveryError} With the verdict's reason as code when the origin may not be
 *   deleted, and `drop_blocked` when another window is holding a database open.
 */
export async function dropLegacySource({ timeoutMs } = {}) {
    return withTransitionLock(async () => {
        const verdict = await describeLegacySource();
        if (verdict.reason !== 'ok') {
            throw new MigrationRecoveryError(verdict.reason,
                'A cópia antiga não pode ser apagada neste estado.');
        }
        const state = await readLegacyTransition();
        // THE INTENT GOES FIRST, then the deletes. A crash between them leaves a journal that
        // says the deletion was ordered, and the next boot finishes it; the reverse order leaves
        // an emptied acervo that the journal still describes as whole, and the screen would offer
        // to "recover" the changes of a deletion the user asked for.
        await getGlobalStore().setItem(LEGACY_TRANSITION_KEY,
            { ...state, status: TransitionStatus.DROPPING_SOURCE });
        const { settled, dropped } = await eraseLegacySource(state, timeoutMs);
        if (!settled) {
            throw new MigrationRecoveryError('drop_blocked',
                'Outra janela ainda mantém os dados antigos abertos.');
        }
        console.info(`Cópia antiga apagada: ${verdict.records} registros da versão anterior.`);
        return { records: verdict.records, dropped };
    });
}

/**
 * @param {number|undefined} timeoutMs - Per-database bound, or undefined for the default.
 * @returns {Object} Options object for `dropAtlasDatabases`, without overriding its default
 *   with `undefined`.
 */
function options(timeoutMs) {
    return timeoutMs === undefined ? {} : { timeoutMs };
}
