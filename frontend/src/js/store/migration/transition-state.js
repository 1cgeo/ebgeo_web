// Path: js/store/migration/transition-state.js
import { getGlobalStore } from '../atlas-namespace.js';

export const LEGACY_TRANSITION_KEY = 'legacy_transition_v1';
export const TRANSITION_LOCK = 'ebgeo-legacy-transition-v1';

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
