// Path: js/store/namespace-generation.js

/**
 * @fileoverview Which GENERATION of databases holds an atlas, and up to which server version.
 *
 * THE RECORD IS READ SYNCHRONOUSLY, AND THAT IS A REQUIREMENT, NOT A PREFERENCE: it sits inside
 * `resolveDbName`, which every `getStore()` call goes through, and those callers are synchronous.
 * So the authoritative copy is `localStorage`.
 *
 * THE DATA IT POINTS AT LIVES IN INDEXEDDB, THOUGH, AND THE TWO ARE CLEARED BY DIFFERENT GESTURES
 * (F12). A browser that drops `localStorage` and keeps IndexedDB leaves nine databases full of an
 * atlas that nothing resolves to any more: the pointer is gone, so every read lands on the
 * generation-less names and the acervo reads as empty. Hence the MIRROR in the global database
 * (`GlobalKey.GENERATION_PREFIX`), written right after the authoritative copy and read back by
 * `reconcileDurablePointers` (`atlas-namespace.js`) before a remote atlas is used.
 *
 * The mirror is INJECTED (`setGenerationMirror`) instead of imported: `atlas-namespace.js` already
 * imports this module, so importing it back would be a cycle around the one function every store
 * access depends on. With no mirror registered this module behaves exactly as it did before, which
 * is what keeps it loadable in a bare node process.
 */

const PREFIX = 'ebgeo_atlas_generation:';

/** @type {{ save: (dbSuffix: string, value: Object) => void, remove: (dbSuffix: string) => void }|null} */
let _mirror = null;

/**
 * Registers the durable mirror of this pointer. One caller, `atlas-namespace.js`, at module load.
 * @param {{ save: Function, remove: Function }|null} mirror - Best-effort, may be asynchronous.
 * @returns {void}
 */
export function setGenerationMirror(mirror) {
    _mirror = mirror;
}

/**
 * @param {*} value - A parsed record.
 * @returns {boolean} Whether it is a record this build may act on.
 */
function isValidRecord(value) {
    const valid = generation => generation === null
        || (typeof generation === 'string' && /^[a-zA-Z0-9-]+$/.test(generation));
    return Boolean(value) && valid(value.active) && Array.isArray(value.known) && value.known.every(valid)
        && Number.isSafeInteger(value.cursor) && value.cursor >= 0;
}

/** One atomic localStorage record selects both the data generation and its applied cursor. */
export function readGeneration(scope) {
    const raw = globalThis.localStorage?.getItem(PREFIX + scope.dbSuffix);
    if (!raw) return { active: null, known: [], cursor: 0 };
    const value = JSON.parse(raw);
    if (!isValidRecord(value)) {
        throw new Error('O registro de recuperação deste atlas está inválido.');
    }
    return value;
}

export function writeGeneration(scope, value) {
    if (!globalThis.localStorage) throw new Error('Não foi possível guardar o registro de recuperação do atlas.');
    globalThis.localStorage.setItem(PREFIX + scope.dbSuffix, JSON.stringify(value));
    // The mirror goes SECOND and is never awaited: the authoritative write has to have landed
    // before anything resolves a database name, and a mirror that fails costs recoverability,
    // never correctness.
    _mirror?.save(scope.dbSuffix, value);
}

/**
 * Forgets the pointer of a namespace, in both copies. Called when the namespace itself is
 * destroyed: a pointer that outlives its databases would send the next reader to names that no
 * longer exist, and the mirror would offer to "restore" it.
 * @param {{ dbSuffix: string }} scope - Scope being destroyed.
 * @returns {void}
 */
export function forgetGeneration(scope) {
    try {
        globalThis.localStorage?.removeItem(PREFIX + scope.dbSuffix);
    } catch {
        // A storage that refuses to write leaves a stale pointer, which the mirror removal below
        // and the absent databases both already contradict.
    }
    _mirror?.remove(scope.dbSuffix);
}

/**
 * Reconciles the authoritative pointer with the mirrored one, and says what it did.
 *
 * THE MIRROR IS ONLY EVER BEHIND OR EQUAL, in the ordinary life of an installation, because
 * `writeGeneration` writes `localStorage` first. So the two cases worth acting on are the ones
 * where that ordering was broken from outside: the authoritative copy is GONE (site data cleared,
 * a storage partition the browser dropped) while the databases are still there, or it came back
 * OLDER than the mirror (a profile restored from a backup). The tie stays with `localStorage`,
 * which is the copy every synchronous reader uses.
 *
 * @param {{ dbSuffix: string }} scope - Scope to reconcile.
 * @param {*} mirrored - The record read from the global database, or null.
 * @returns {'restored'|'adopted'|'kept'|'absent'} `restored` when the authoritative copy was
 *   rebuilt from the mirror, `adopted` when a newer mirror overruled it.
 */
export function adoptMirroredGeneration(scope, mirrored) {
    if (!isValidRecord(mirrored)) return 'absent';

    let local = null;
    try {
        const raw = globalThis.localStorage?.getItem(PREFIX + scope.dbSuffix);
        local = raw ? JSON.parse(raw) : null;
    } catch {
        local = null;
    }

    if (!isValidRecord(local)) {
        writeGeneration(scope, mirrored);
        return 'restored';
    }
    if (mirrored.cursor > local.cursor) {
        writeGeneration(scope, mirrored);
        return 'adopted';
    }
    return 'kept';
}

export function captureDataScope(scope) {
    if (!scope || Object.hasOwn(scope, 'dataGeneration')) return scope;
    return { ...scope, dataGeneration: readGeneration(scope).active };
}

export function dataGenerationFor(scope) {
    return Object.hasOwn(scope, 'dataGeneration') ? scope.dataGeneration : readGeneration(scope).active;
}
