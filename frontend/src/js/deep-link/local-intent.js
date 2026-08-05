// Path: js/deep-link/local-intent.js

/**
 * @module deep-link/local-intent
 * @description "I chose to work on the local map" — the one escape hatch from the boot rule that
 * sends a signed-in user to `projetos.html`.
 *
 * Without it a signed-in user can never reach the local workspace, and the local workspace is a real
 * state: it is the only place "Salvar no servidor" applies, and the only thing an `.ebgeo` file
 * loads into. With it, the rule stays simple — bare `/` means "choose a project", unless you said
 * otherwise on this tab.
 *
 * `sessionStorage`, deliberately, NOT the URL: the intent belongs to this tab and this sitting. In
 * the URL it would ride along into every shared/bookmarked link and impose one person's choice on
 * whoever opens it. It is cleared on logout so the next identity starts from the plain rule.
 */

/** sessionStorage key holding the local-map intent. */
export const LOCAL_INTENT_KEY = 'ebgeo_local_intent';

/** @returns {boolean} Whether this tab chose the local map over the project chooser. */
export function hasLocalMapIntent() {
    try {
        return sessionStorage.getItem(LOCAL_INTENT_KEY) === '1';
    } catch {
        // Storage disabled/blocked: no intent, fall back to the plain rule.
        return false;
    }
}

/** Forgets the intent (on logout, or when the user asks for the project list again). */
export function clearLocalMapIntent() {
    try {
        sessionStorage.removeItem(LOCAL_INTENT_KEY);
    } catch {
        // Nothing to clear if storage is unavailable.
    }
}
