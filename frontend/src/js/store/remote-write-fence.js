// Path: js/store/remote-write-fence.js

/**
 * @fileoverview The epoch that says "the pendências of this mount were discarded".
 *
 * IT IS READ SYNCHRONOUSLY BECAUSE `assertWritable` IS CALLED INSIDE NATIVE INDEXEDDB CALLBACKS,
 * where there is nowhere to await: that is why the authoritative copy is `localStorage` and not the
 * database the data lives in.
 *
 * TWO THINGS THAT USED TO MAKE IT DEGRADE OPEN, both closed in 2026-09-13 (F12):
 *
 *   - NO `localStorage` AT ALL answered `{ epoch: 0, discarded: false }`, i.e. "nothing was ever
 *     discarded", which is the most permissive answer available for a fact that could not be read.
 *     Inside a browser document the absence is now CLOSED, and outside one (node, a test worker)
 *     it stays open, because there is no tab, no consent and nothing to fence. The probe is
 *     `globalThis.window`, and that asymmetry is the whole of it: the suite must keep measuring the
 *     product, and a browser that lost its storage must not keep writing to a discarded atlas.
 *   - THE KEY IS NOW REMOVED together with the databases of the namespace (F12: it never was), and
 *     removing it must not reopen anything. It does not: every epoch this file writes is at least 1,
 *     so a writer that captured a record reads 0 afterwards and fails the epoch comparison. Read the
 *     block below for the one writer that removal cannot fence, and for who does fence it.
 *
 * The mirror in the global database (`GlobalKey.WRITE_EPOCH_PREFIX`) is the other half: it is
 * written after the authoritative copy and read back by `reconcileDurablePointers`
 * (`atlas-namespace.js`), so a lost `localStorage` is rebuilt instead of silently consenting.
 * It is INJECTED, not imported, for the reason given in `namespace-generation.js`.
 */

const PREFIX = 'ebgeo_remote_write_epoch:';
const mounts = new WeakMap();

/**
 * WHAT THE REMOVAL OF THE RECORD DOES AND DOES NOT FENCE, declared because the gap is not obvious
 * and because closing it here was tried and cost more than it bought.
 *
 * The absence of the record is AMBIGUOUS BY CONSTRUCTION: once the key is removed with the
 * databases, "no record" means both "nothing was ever discarded" (an ordinary fresh mount) and
 * "everything was just destroyed". A writer that captured a real record is still fenced, because
 * every written epoch is at least 1 and the removal reads back as 0. A writer born BEFORE any record
 * existed captured 0 as well, and nothing in this file can separate the two states for it without
 * keeping a tombstone per atlas forever, which is the accumulation F12 objects to.
 *
 * That residual writer is not unguarded, it is guarded ELSEWHERE, and by design: the teardown brake
 * (`store/sync/tab-lock-sync-brake.js`) releases the mount and clears the active scope, which is
 * what keeps a lost write from recreating the destroyed databases. Two attempts to close it HERE
 * were written and reverted, and the second is the instructive one: an in-memory set of destroyed
 * suffixes duplicated the brake and, measured, made the brake's own negative control stop
 * reproducing (the write no longer resurrected the database even with the brake removed), which
 * turns a guard into one that cannot fail. The first was a `present` flag on the captured fence, and
 * it was dead code: no path writes an epoch of 0, so presence never disagreed where the epoch
 * already agreed. Reverting the fix and seeing NOTHING go red is what said so.
 */

/** @type {{ save: (dbSuffix: string, value: Object) => void, remove: (dbSuffix: string) => void }|null} */
let _mirror = null;

/**
 * Registers the durable mirror of the discard epoch. One caller, `atlas-namespace.js`.
 * @param {{ save: Function, remove: Function }|null} mirror - Best-effort, may be asynchronous.
 * @returns {void}
 */
export function setEpochMirror(mirror) {
    _mirror = mirror;
}

/**
 * @param {*} state - A parsed record.
 * @returns {boolean} Whether it is a record this build may act on.
 */
function isValidState(state) {
    return Boolean(state) && Number.isSafeInteger(state.epoch) && state.epoch >= 0
        && typeof state.discarded === 'boolean';
}

/**
 * @returns {boolean} Whether this runtime is a browser document, i.e. a place where `localStorage`
 *   is expected to exist and its absence means the fact cannot be read rather than "no fact".
 */
function insideDocument() {
    return typeof globalThis.window !== 'undefined';
}

function read(scope) {
    const storage = globalThis.localStorage ?? null;
    if (!storage) {
        // Closed in a document, open outside one.
        return insideDocument()
            ? { epoch: 0, discarded: true }
            : { epoch: 0, discarded: false };
    }
    const raw = storage.getItem(PREFIX + scope.dbSuffix);
    if (raw === null || raw === undefined) return { epoch: 0, discarded: false };
    const state = JSON.parse(raw);
    if (!isValidState(state)) {
        throw new Error('O registro de descarte deste atlas está inválido.');
    }
    return state;
}

function write(scope, discarded) {
    if (scope?.kind !== 'remote') throw new Error('O descarte remoto não pode alterar um atlas local.');
    const state = read(scope);
    if (!globalThis.localStorage || state.epoch === Number.MAX_SAFE_INTEGER) {
        throw new Error('Não foi possível registrar o descarte remoto com segurança.');
    }
    const next = { epoch: state.epoch + 1, discarded };
    globalThis.localStorage.setItem(PREFIX + scope.dbSuffix, JSON.stringify(next));
    _mirror?.save(scope.dbSuffix, next);
}

/** Capture at mount/birth, before an asynchronous operation can outlive its session. */
export function captureRemoteWriteFence(scope) {
    if (scope?.kind !== 'remote') return () => {};
    if (!mounts.has(scope)) mounts.set(scope, read(scope).epoch);
    const epoch = mounts.get(scope);
    const assertWritable = () => {
        const state = read(scope);
        if (state.discarded || state.epoch !== epoch) {
            throw new DOMException('As pendências desta sessão foram descartadas. Esta gravação foi cancelada.', 'AbortError');
        }
    };
    assertWritable();
    return assertWritable;
}

/** Only call after explicit discard consent and exclusion of locally adopted namespaces. */
export function discardRemoteWrites(scope) {
    write(scope, true);
}

/** Called after the abandoned databases have been cleared, before a fresh remote mount. */
export function reopenRemoteWrites(scope) {
    if (scope?.kind !== 'remote') return;
    if (read(scope).discarded) write(scope, false);
}

/** A persisted fence also recovers interrupted writes of the asynchronous registry. */
export function remoteWritesDiscarded(scope) {
    return scope?.kind === 'remote' && read(scope).discarded;
}

/**
 * Forgets the discard record of a namespace, in both copies, because the namespace itself is gone.
 *
 * A writer that captured a record is stopped by the epoch comparison (the removal reads back as 0);
 * one born before any record existed is the declared residual case at the top of this file, and the
 * teardown brake is what holds it.
 * @param {{ dbSuffix: string }} scope - Scope being destroyed.
 * @returns {void}
 */
export function forgetRemoteWriteFence(scope) {
    try {
        globalThis.localStorage?.removeItem(PREFIX + scope.dbSuffix);
    } catch {
        // See `namespace-generation.js#forgetGeneration`.
    }
    _mirror?.remove(scope.dbSuffix);
}

/**
 * Reconciles the authoritative discard record with the mirrored one.
 *
 * THE HIGHER EPOCH WINS, and a TIE GOES TO THE DISCARD: the two copies only disagree when the
 * ordering of `write` was broken from outside (cleared site data, a restored profile), and of the
 * two possible mistakes at that moment, refusing a write that was allowed costs one edit while
 * allowing a write that was discarded costs the invariant the whole fence exists for.
 *
 * @param {{ kind: string, dbSuffix: string }} scope - Scope to reconcile.
 * @param {*} mirrored - The record read from the global database, or null.
 * @returns {'restored'|'adopted'|'kept'|'absent'}
 */
export function adoptMirroredDiscardState(scope, mirrored) {
    if (scope?.kind !== 'remote' || !isValidState(mirrored)) return 'absent';
    if (!globalThis.localStorage) return 'absent';

    let local = null;
    try {
        const raw = globalThis.localStorage.getItem(PREFIX + scope.dbSuffix);
        local = raw ? JSON.parse(raw) : null;
    } catch {
        local = null;
    }

    const restore = outcome => {
        globalThis.localStorage.setItem(PREFIX + scope.dbSuffix, JSON.stringify({
            epoch: mirrored.epoch, discarded: mirrored.discarded,
        }));
        return outcome;
    };
    if (!isValidState(local)) return restore('restored');
    if (mirrored.epoch > local.epoch) return restore('adopted');
    if (mirrored.epoch === local.epoch && mirrored.discarded && !local.discarded) return restore('adopted');
    return 'kept';
}
