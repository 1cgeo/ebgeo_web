// Path: js/store/sync/autor-da-fila.js

/**
 * @fileoverview Which account wrote the outbound queue of a server atlas. Zero imports.
 *
 * WHY IT EXISTS (owner's decision of 2026-09-26). After an involuntary rescue, the account that
 * produced the unsent work may send it back to the atlas it came from ("enviar as pendências a
 * este atlas"), and nobody else may: pushing someone else's queue under your own token would sign
 * their edits with your name. An operation carries no author, so the author is recorded where the
 * queue is written (`persistOperationIntents`), one key per server atlas.
 *
 * ONE ACCOUNT PER QUEUE is what makes a single value enough: a login by ANOTHER account first
 * rescues the previous account's queues and sweeps every server namespace
 * (`endPreviousAccountIfReplaced`, `session/unsynced-work-exit.js`), so a queue never holds two
 * accounts' work. The last writer is therefore the author of everything still pending.
 *
 * IN `localStorage`, NOT IN THE ATLAS'S DATABASES: the rescue moves those databases between the two
 * registries and the open of a server atlas may empty them, and the author has to survive both. It
 * is a convenience of the new exit and nothing more: a browser that blocks site data answers null,
 * and null hides the exit, which leaves the two exits that never depended on it.
 */

/** Prefixed, because `localStorage` is shared by the whole origin. */
const PREFIXO = 'ebgeo_autor_da_fila:';

/** @returns {Storage|null} */
function armazenamento() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

/**
 * Records the account writing to a server atlas's queue. A no-op when it is already the recorded one.
 * @param {string|null|undefined} atlasId - Server atlas id.
 * @param {string|null|undefined} conta - The logged account's id (never the anonymous client id).
 */
export function registrarAutorDaFila(atlasId, conta) {
    if (typeof atlasId !== 'string' || atlasId === '' || typeof conta !== 'string' || conta === '') return;
    const loja = armazenamento();
    try {
        if (loja && loja.getItem(PREFIXO + atlasId) !== conta) loja.setItem(PREFIXO + atlasId, conta);
    } catch {
        // Quota or blocked storage: the author stays unknown, and the exit that needs it stays hidden.
    }
}

/**
 * @param {string|null|undefined} atlasId - Server atlas id.
 * @returns {string|null} The account that last wrote to that atlas's queue, or null when unknown.
 */
export function autorDaFila(atlasId) {
    if (typeof atlasId !== 'string' || atlasId === '') return null;
    try {
        return armazenamento()?.getItem(PREFIXO + atlasId) ?? null;
    } catch {
        return null;
    }
}
