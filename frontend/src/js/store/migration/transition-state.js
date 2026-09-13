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

export async function legacySourceIsProtected() {
    return Boolean(await readLegacyTransition());
}
