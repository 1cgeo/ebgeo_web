// Path: js/store/migration/transition-state.js
import { getGlobalStore } from '../atlas-namespace.js';

export const LEGACY_TRANSITION_KEY = 'legacy_transition_v1';
export const TRANSITION_LOCK = 'ebgeo-legacy-transition-v1';

/**
 * PREFIX of the global key that describes an IN-FLIGHT restoration (`recovery_pending:<id>`).
 *
 * It lives here, and not next to the restoration that writes it, because THREE readers have to
 * agree on it and they are in three files: the restoration resumes from it, the recovery
 * exporter walks it to find archives nobody registered yet, and the boot sweep decides from it
 * what is abandoned. While it was a string literal in each of them, a rename in one would have
 * left the other two reading keys that nothing writes, with nothing red.
 */
export const RECOVERY_PENDING_PREFIX = 'recovery_pending:';

/**
 * @param {string} id - Local atlas id the restoration is claiming.
 * @returns {string} Key of that restoration's pending record in the global database.
 */
export function recoveryPendingKey(id) {
    return `${RECOVERY_PENDING_PREFIX}${id}`;
}

/**
 * @param {string} id - Local atlas id the restoration is claiming.
 * @returns {string} Database suffix a restored archive lands on. Derived from the id on
 *   purpose: the sweep refuses to delete a pending record whose suffix is not the one this
 *   function would have produced, so a malformed record can never aim a deletion elsewhere.
 */
export function recoveryDbSuffix(id) {
    return `recovery-${id}`;
}

export class MigrationRecoveryError extends Error {
    constructor(code, message, options) {
        super(message, options);
        this.name = 'MigrationRecoveryError';
        this.code = code;
    }
}

export async function readLegacyTransition() {
    const state = await getGlobalStore().getItem(LEGACY_TRANSITION_KEY);
    if (state && (state.version !== 1 || typeof state.entry?.id !== 'string'
        || typeof state.destination !== 'string' || !state.destination.startsWith('upgrade-')
        || !Array.isArray(state.sourceInventory) || !Array.isArray(state.history)
        || state.history.some(suffix => typeof suffix !== 'string' || !suffix.startsWith('upgrade-')))) {
        throw new MigrationRecoveryError('unreadable', 'O registro da atualização precisa de recuperação.');
    }
    return state;
}

/**
 * The statuses of the transition journal, in the order they happen.
 *
 * THE LAST TWO ARE NOT THE COPY'S, THEY ARE THE ORIGIN'S (decision D8 of 2026-09-13). The copy
 * ends at `COMMITTED` and never moves again; what comes after describes the pre-namespace
 * databases the copy was made FROM, which the user may order deleted from the recovery screen.
 * `DROPPING_SOURCE` is the intent written before the first delete, so a crash in the middle is
 * resumable instead of leaving a half-emptied acervo that the journal still claims is whole.
 */
export const TransitionStatus = Object.freeze({
    COPYING: 'copying',
    MIGRATING: 'migrating',
    READY: 'ready',
    COMMITTED: 'committed',
    DROPPING_SOURCE: 'dropping_source',
    SOURCE_DROPPED: 'source_dropped'
});

/**
 * @param {{ status?: string }|null} state - Journal record.
 * @returns {boolean} True once the copy is ACTIVE and nothing about it is pending. Every caller
 *   that used to compare with `'committed'` asks this instead, because the two origin statuses
 *   are also states in which the copy is done: reading them as "not committed" would restart a
 *   transition over an atlas the user is already working in.
 */
export function transitionIsSettled(state) {
    return state?.status === TransitionStatus.COMMITTED || legacySourceIsGone(state);
}

/**
 * @param {{ status?: string }|null} state - Journal record.
 * @returns {boolean} True once the deletion of the pre-namespace databases has been ORDERED.
 *   In flight counts: from that instant the origin is no longer a copy anybody may rely on.
 */
export function legacySourceIsGone(state) {
    return state?.status === TransitionStatus.DROPPING_SOURCE
        || state?.status === TransitionStatus.SOURCE_DROPPED;
}

/**
 * Do the unsuffixed databases hold an acervo this build must leave alone?
 *
 * TRUE FOR THE WHOLE LIFE OF THE COPY, and false again once the origin is dropped: the three
 * consumers that read this (`initLocalAtlases`, the outbound queue migration, and the schema
 * detector through `legacyTransitionExists`) are all asking "is somebody else's acervo sitting
 * at the legacy address", and after an explicit deletion nobody's is.
 *
 * @returns {Promise<boolean>}
 */
export async function legacySourceIsProtected() {
    const state = await readLegacyTransition();
    return Boolean(state) && !legacySourceIsGone(state);
}

/**
 * Has this installation ALREADY been through the transition?
 *
 * IT IS NOT THE SAME QUESTION AS `legacySourceIsProtected`, and the schema detector needs this
 * one. The installation upgrade runs ONCE; after it, the unsuffixed databases are a copy that
 * was left behind, and dropping them does not make them a fresh install. Asking about
 * protection there would let `detectMigrationNeeded` answer "needed" over the emptied legacy
 * address, and the chain would write an atlas record into it and register a phantom slot #1.
 *
 * @returns {Promise<boolean>}
 */
export async function legacyTransitionExists() {
    return Boolean(await readLegacyTransition());
}
