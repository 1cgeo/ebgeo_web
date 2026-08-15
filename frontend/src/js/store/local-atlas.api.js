// Path: js/store/local-atlas.api.js

/**
 * @fileoverview The named LOCAL atlases: registry, cap, and the boot choice of which one
 * is current. This is the only way to create, list, delete or switch a local atlas, so
 * the cap of 10 applies uniformly to the UI, to the schema migration and to a `.ebgeo`
 * import without any of them having to remember it.
 *
 * The registry and the current-atlas pointer live in the GLOBAL database
 * (`atlas-namespace.js`, Decision 2 and 3): a pointer stored inside a namespace could
 * only be read by someone who already knew which namespace to open.
 *
 * The registry is the single source of truth for an atlas NAME. The slot's own atlas
 * record (`current_atlas`, inside the slot) is seeded from it at creation so the two
 * agree from birth; the opaque `dbSuffix` is persisted next to the name precisely so a
 * rename never has to rename a database (IndexedDB has no rename).
 *
 * ERROR CONVENTION (see `store-errors.js`): an argument the caller had no business
 * passing (empty name) throws, because it is a bug. Hitting the cap, or naming an atlas
 * that is gone, is an EXPECTED failure aimed at the user: these return a named result
 * with a pt-BR message and emit `STORE_OPERATION_BLOCKED`, never a silent no-op.
 *
 * This module owns persistence and scope selection ONLY. It does not touch the memory
 * store, the layer caches or the outbound queue, so a caller that switches or deletes an
 * atlas must unmount the current one first (the wipe/unmount path stays in `store.js`).
 */

import { createAtlas } from './atlas/atlas.entity.js';
import { generateUUID } from '../utilities/uuid.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import {
    ATLAS_RECORD_KEY,
    GlobalKey,
    LEGACY_DB_SUFFIX,
    StoreName,
    StoreScopeKind,
    activateScope,
    getActiveScope,
    getGlobalStore,
    getStoreFor,
    dropAtlasDatabases,
    localScope,
    remoteAtlasKey,
    remoteScope
} from './atlas-namespace.js';
import { activateRemoteAtlas } from './remote-atlas.api.js';

/**
 * Ceiling of named local atlases. Owner decision, and deliberately low: every slot is 10
 * IndexedDB databases, so the cap is also the cap on databases this origin creates.
 */
export const MAX_LOCAL_ATLASES = 10;

/** Registry shape version, for a future change to the registry itself. */
const REGISTRY_VERSION = 1;

/** Name given to the atlas that inherits the pre-namespace workspace. */
export const DEFAULT_LOCAL_ATLAS_NAME = 'Meu Atlas';

/** Named failures. Every one of them carries a pt-BR message for the UI. */
export const LocalAtlasError = Object.freeze({
    /** The cap of MAX_LOCAL_ATLASES was reached. */
    LIMIT_REACHED: 'local_atlas_limit',
    /** No local atlas with that id (a stale list, a double click on delete). */
    NOT_FOUND: 'local_atlas_not_found',
    /** Refused: the installation must always keep at least one local atlas. */
    LAST_ATLAS: 'local_atlas_last'
});

/** UI messages, pt-BR. Kept next to the codes so a new code cannot ship without one. */
const ERROR_MESSAGES = Object.freeze({
    [LocalAtlasError.LIMIT_REACHED]:
        `Limite de ${MAX_LOCAL_ATLASES} atlas locais atingido. Exclua um atlas antes de criar outro.`,
    [LocalAtlasError.NOT_FOUND]:
        'Atlas local não encontrado. Ele pode ter sido excluído em outra aba.',
    [LocalAtlasError.LAST_ATLAS]:
        'Este é o seu único atlas local e não pode ser excluído. Crie outro antes de excluí-lo.'
});

/**
 * @typedef {Object} LocalAtlasEntry
 * @property {string} id - Opaque atlas id (also the registry key).
 * @property {string} name - Display name, pt-BR, renameable.
 * @property {string} dbSuffix - Opaque database suffix. Empty for the legacy slot.
 * @property {number} createdAt - Epoch ms.
 * @property {number} updatedAt - Epoch ms.
 */

/**
 * @typedef {Object} LocalAtlasResult
 * @property {boolean} ok - False when the operation was refused.
 * @property {string} [error] - A `LocalAtlasError` code when refused.
 * @property {string} [message] - pt-BR message for the UI when refused.
 * @property {LocalAtlasEntry} [atlas] - The affected entry when successful.
 */

/** In-memory mirror of the registry. Null until `initLocalAtlases()` runs. */
let _entries = null;

/** In-memory mirror of the pointer. */
let _currentId = null;

/**
 * Builds a refusal result and emits it, so no caller can drop it on the floor silently.
 * @param {string} code - A `LocalAtlasError` value.
 * @param {Object} [context] - Extra fields for the emitted payload.
 * @returns {LocalAtlasResult}
 */
function refuse(code, context = {}) {
    const message = ERROR_MESSAGES[code];
    emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
        operation: 'localAtlas',
        reason: code,
        message,
        ...context
    });
    return { ok: false, error: code, message };
}

/**
 * @returns {LocalAtlasEntry[]} The in-memory registry.
 * @throws {Error} When the registry was never loaded (caller bug).
 */
function requireEntries() {
    if (_entries === null) {
        throw new Error('local-atlas.api: initLocalAtlases() must run before any local atlas operation');
    }
    return _entries;
}

/**
 * Persists the registry and the pointer together. They are written in one place so they
 * cannot drift apart.
 * @returns {Promise<void>}
 */
async function persistRegistry() {
    const globalStore = getGlobalStore();
    await globalStore.setItem(GlobalKey.LOCAL_ATLASES, {
        version: REGISTRY_VERSION,
        atlases: _entries.map(e => ({ ...e }))
    });
    await globalStore.setItem(GlobalKey.CURRENT_LOCAL_ATLAS, _currentId);
}

/**
 * Reads the registry from the global database into memory.
 * @returns {Promise<void>}
 */
async function loadRegistry() {
    const globalStore = getGlobalStore();
    const stored = await globalStore.getItem(GlobalKey.LOCAL_ATLASES);
    _entries = Array.isArray(stored?.atlases) ? stored.atlases.map(e => ({ ...e })) : [];
    _currentId = await globalStore.getItem(GlobalKey.CURRENT_LOCAL_ATLAS) ?? null;
}

/**
 * Makes a name unique inside the registry by appending " (n)".
 *
 * DECISION, duplicate names: SUFFIX, never refuse. The identity of an atlas is its id;
 * the name is a label. Two of the three callers that create an atlas are not interactive
 * (the schema migration and a `.ebgeo` import), so refusing on a cosmetic collision
 * would abort a data operation for a reason the user cannot act on mid-flight, and
 * importing the same `.ebgeo` twice on purpose (to compare two versions) is legitimate.
 * The user can rename afterwards; nothing is lost by suffixing, and a failed import is.
 *
 * @param {string} name - Requested name, already trimmed.
 * @param {LocalAtlasEntry[]} entries - Existing entries.
 * @returns {string} A name no existing entry uses.
 */
function uniqueName(name, entries) {
    const taken = new Set(entries.map(e => e.name.trim().toLocaleLowerCase('pt-BR')));
    if (!taken.has(name.toLocaleLowerCase('pt-BR'))) return name;

    let n = 2;
    let candidate = `${name} (${n})`;
    while (taken.has(candidate.toLocaleLowerCase('pt-BR'))) {
        n += 1;
        candidate = `${name} (${n})`;
    }
    return candidate;
}

/**
 * Builds the scope of a registry entry.
 * @param {LocalAtlasEntry} entry
 * @returns {{ kind: string, atlasId: string, dbSuffix: string }}
 */
export function scopeOfLocalAtlas(entry) {
    return localScope(entry.id, entry.dbSuffix);
}

/**
 * Creates the registry entry an installation with no registry needs, and seeds its atlas
 * record. `adoptLegacy` is what decides whether this slot INHERITS the pre-namespace
 * databases (zero-copy migration) or starts on fresh ones.
 * @param {boolean} adoptLegacy
 * @param {string} [name=DEFAULT_LOCAL_ATLAS_NAME] - Name of the bootstrap slot.
 * @returns {Promise<LocalAtlasEntry>}
 */
async function bootstrapEntry(adoptLegacy, name = DEFAULT_LOCAL_ATLAS_NAME) {
    const id = generateUUID();
    const now = Date.now();
    const entry = {
        id,
        name,
        dbSuffix: adoptLegacy ? LEGACY_DB_SUFFIX : id,
        createdAt: now,
        updatedAt: now
    };
    _entries.push(entry);
    _currentId = id;
    await persistRegistry();

    // Only a fresh slot gets a seeded record. Adopting the legacy databases must not
    // overwrite the atlas record already there, which carries the user's map order.
    if (!adoptLegacy) {
        await seedAtlasRecord(entry);
    }
    return entry;
}

/**
 * Writes the slot's own atlas record, so the slot is valid the moment it exists and its
 * name matches the registry.
 * @param {LocalAtlasEntry} entry
 * @returns {Promise<void>}
 */
async function seedAtlasRecord(entry) {
    const atlasStore = getStoreFor(StoreName.ATLAS, scopeOfLocalAtlas(entry));
    await atlasStore.setItem(ATLAS_RECORD_KEY, { ...createAtlas(entry.name), id: entry.id });
}

/**
 * Boot entry point: loads the registry, decides which atlas is current, and activates the
 * scope every store resolves against (Decision 3).
 *
 * @param {Object} [options]
 * @param {{ kind: string, atlasId: string|null }} [options.origin] - Persisted origin
 *   marker. Defaults to reading it from the global database (absent means LOCAL).
 * @param {boolean} [options.isAuthenticated=false] - Whether a session is live. A REMOTE
 *   origin without a session is orphan data, handled by the boot guard in `store.js`.
 * @param {boolean} [options.adoptLegacyDatabases] - Whether a bootstrap slot inherits the
 *   pre-namespace databases. Defaults to "only when the origin is LOCAL": adopting a
 *   store that holds REMOTE data would manufacture a permanent local copy of a server
 *   atlas, which is the invariant this phase may not break.
 * @param {string} [options.bootstrapName] - Name for the slot created when the registry is
 *   empty. Defaults to `DEFAULT_LOCAL_ATLAS_NAME`. The schema migration passes the name the
 *   adopted atlas record already carries, so a workspace the user named something else is
 *   not silently relabelled by being registered.
 * @returns {Promise<{ scope: Object, current: LocalAtlasEntry|null, atlases: LocalAtlasEntry[] }>}
 */
export async function initLocalAtlases(options = {}) {
    await loadRegistry();

    const origin = options.origin ?? await getGlobalStore().getItem(GlobalKey.STORE_ORIGIN);
    const isRemoteOrigin = origin?.kind === StoreScopeKind.REMOTE;
    const adoptLegacy = options.adoptLegacyDatabases ?? !isRemoteOrigin;

    if (_entries.length === 0) {
        await bootstrapEntry(adoptLegacy, options.bootstrapName ?? DEFAULT_LOCAL_ATLAS_NAME);
    }

    let current = _entries.find(e => e.id === _currentId) ?? null;
    if (!current) {
        // A pointer that no longer resolves is not an error worth stopping the boot for:
        // fall back to the most recently touched slot, and repair the pointer.
        current = [..._entries].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        _currentId = current.id;
        await persistRegistry();
    }

    // A live session on a remote atlas keeps working in THAT atlas's namespace; the local
    // pointer stays where it is, untouched, for the next local boot. Going through
    // `activateRemoteAtlas` (rather than `activateScope(remoteScope(...))`) is what makes
    // this boot path also REPAIR the registry: an installation whose marker says REMOTE but
    // whose registry entry was lost gets the entry back here, so the logout wipe can find
    // the namespace again.
    const atlasId = typeof origin?.atlasId === 'string' ? origin.atlasId : '';
    if (isRemoteOrigin && options.isAuthenticated && atlasId.length > 0) {
        const scope = await activateRemoteAtlas(atlasId);
        return { scope, current, atlases: listLocalAtlases() };
    }

    // A REMOTE marker with no atlas id names no namespace, so there is nothing to activate
    // and nothing to repair: fall back to the local slot instead of inventing a scope.
    const scope = scopeOfLocalAtlas(current);
    activateScope(scope);
    return { scope, current, atlases: listLocalAtlases() };
}

/**
 * @returns {LocalAtlasEntry[]} All local atlases, oldest first. Never includes the remote
 *   scratch, which is not a local atlas and never counts against the cap.
 */
export function listLocalAtlases() {
    return requireEntries()
        .map(e => ({ ...e }))
        .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * @returns {string|null} Id of the current local atlas.
 */
export function getCurrentLocalAtlasId() {
    return _currentId;
}

/**
 * Points the store at the current LOCAL slot, if the registry is loaded and has one.
 *
 * Written for exactly one caller: the logged-out purge in `store.js`, which destroys the
 * active remote namespace and leaves nothing active. It reports failure instead of
 * bootstrapping a slot, because inventing an atlas inside a wipe is how a wipe grows a side
 * effect nobody expects; a false here means the repository's own `ensureAtlasScope` bridge
 * will activate the legacy local databases, which is the pre-namespace behavior.
 *
 * @returns {boolean} True when a local scope was activated.
 */
export function activateCurrentLocalAtlasScope() {
    if (_entries === null || _entries.length === 0) return false;

    const entry = _entries.find(e => e.id === _currentId)
        ?? [..._entries].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!entry) return false;

    activateScope(scopeOfLocalAtlas(entry));
    return true;
}

/**
 * Turns a REMOTE namespace into a named LOCAL atlas, moving zero bytes.
 *
 * THIS IS THE RESCUE PATH, and it is the reason `localScope` accepts a `remote-<id>`
 * suffix. When a session dies with operations still queued, `AccountControl._handleLogout`
 * keeps the work instead of wiping it. That used to be nothing more than flipping the
 * origin marker, because remote and local data shared one set of databases. Now the work
 * sits in a namespace the logged-out purge deletes, so keeping it means moving the CLAIM
 * from the remote registry to the local one.
 *
 * Order is deliberate: the local claim is written FIRST, and only then is the remote key
 * removed. A crash in between leaves the namespace claimed by BOTH registries, which is
 * harmless because `purgeAllRemoteAtlases` skips a namespace a local atlas claims (and
 * removes the stale remote key when it sees one). The reverse order has a crash window in
 * which the namespace is claimed by NOBODY, and unclaimed server data is the one outcome
 * this design may not produce.
 *
 * THE CAP DOES NOT APPLY. Refusing here would mean deleting work the user cannot get back,
 * to defend a ceiling on databases. An installation can therefore end up with 11 local
 * atlases; the user deletes one, and the next `createLocalAtlas` refuses as usual.
 *
 * @param {string} atlasId - Server atlas id whose namespace is being adopted.
 * @param {string} name - Display name for the new local atlas, pt-BR.
 * @returns {Promise<LocalAtlasResult>} `{ ok: true, atlas }`.
 * @throws {Error} When `name` is not a non-empty string (caller bug).
 */
export async function adoptRemoteAtlasAsLocal(atlasId, name) {
    if (typeof name !== 'string' || name.trim().length === 0) {
        throw new Error('adoptRemoteAtlasAsLocal: name must be a non-empty string');
    }
    const { dbSuffix } = remoteScope(atlasId);

    // The rescue can fire at any moment of a session, so it cannot require a boot that
    // already loaded the registry.
    if (_entries === null) await loadRegistry();

    const already = _entries.find(e => e.dbSuffix === dbSuffix);
    if (already) {
        // Idempotent: a retried rescue must not spend a second slot on the same databases.
        return { ok: true, atlas: { ...already } };
    }

    const now = Date.now();
    const entry = {
        id: generateUUID(),
        name: uniqueName(name.trim(), _entries),
        dbSuffix,
        createdAt: now,
        updatedAt: now
    };
    _entries.push(entry);
    _currentId = entry.id;
    await persistRegistry();

    await getGlobalStore().removeItem(remoteAtlasKey(atlasId));

    // The databases do not move, so the only thing left is the KIND of the active scope:
    // leaving it REMOTE would let the next logged-out purge treat it as server data.
    if (getActiveScope()?.dbSuffix === dbSuffix) {
        activateScope(scopeOfLocalAtlas(entry));
    }

    return { ok: true, atlas: { ...entry } };
}

/**
 * @param {string} id
 * @returns {LocalAtlasEntry|null} A copy of the entry, or null.
 */
export function getLocalAtlas(id) {
    const entry = requireEntries().find(e => e.id === id);
    return entry ? { ...entry } : null;
}

/**
 * Creates a named local atlas. Does NOT switch to it: switching is `setCurrentLocalAtlas`,
 * because the caller has to unmount the current atlas first.
 *
 * @param {string} name - Display name, pt-BR. Duplicates are suffixed, not refused.
 * @returns {Promise<LocalAtlasResult>} `{ ok: true, atlas }`, or a named refusal.
 * @throws {Error} When `name` is not a non-empty string (caller bug).
 */
export async function createLocalAtlas(name) {
    if (typeof name !== 'string' || name.trim().length === 0) {
        throw new Error('createLocalAtlas: name must be a non-empty string');
    }
    const entries = requireEntries();

    if (entries.length >= MAX_LOCAL_ATLASES) {
        return refuse(LocalAtlasError.LIMIT_REACHED, { count: entries.length, max: MAX_LOCAL_ATLASES });
    }

    const id = generateUUID();
    const now = Date.now();
    const entry = {
        id,
        name: uniqueName(name.trim(), entries),
        // The suffix is the id and never the name: a name is user text with accents and
        // spaces, and renaming an atlas must not require renaming a database.
        dbSuffix: id,
        createdAt: now,
        updatedAt: now
    };

    entries.push(entry);
    await persistRegistry();
    await seedAtlasRecord(entry);

    return { ok: true, atlas: { ...entry } };
}

/**
 * Switches the current local atlas. The caller must have unmounted the previous atlas
 * (memory store, layer caches, outbound queue) BEFORE calling this.
 *
 * @param {string} id - Local atlas id.
 * @returns {Promise<LocalAtlasResult>} `{ ok: true, atlas }`, or a named refusal.
 */
export async function setCurrentLocalAtlas(id) {
    const entry = requireEntries().find(e => e.id === id);
    if (!entry) {
        return refuse(LocalAtlasError.NOT_FOUND, { atlasId: id });
    }

    _currentId = entry.id;
    entry.updatedAt = Date.now();
    await persistRegistry();

    // While a remote atlas is open the pointer moves but the active scope does not: the
    // remote scratch stays active until the session ends, and the new pointer takes
    // effect on the next local activation.
    if (getActiveScopeKind() !== StoreScopeKind.REMOTE) {
        activateScope(scopeOfLocalAtlas(entry));
    }

    return { ok: true, atlas: { ...entry } };
}

/**
 * Deletes a local atlas and its databases.
 *
 * Order matters and is deliberate: pointer first, then the registry, then the databases.
 * A crash after the pointer moved leaves a consistent installation; a crash after the
 * registry write leaves orphan databases, which are inert garbage. The reverse order
 * would leave the pointer aimed at a half deleted atlas.
 *
 * @param {string} id - Local atlas id.
 * @returns {Promise<LocalAtlasResult & { droppedDatabases?: string[], blockedDatabases?: string[] }>}
 *   `blockedDatabases` names the databases another tab was holding open: the slot is gone
 *   from the registry either way, and those files stay on disk as unreferenced garbage
 *   rather than the delete hanging (`atlas-namespace.js` Decision 4).
 */
export async function deleteLocalAtlas(id) {
    const entries = requireEntries();
    const index = entries.findIndex(e => e.id === id);
    if (index === -1) {
        return refuse(LocalAtlasError.NOT_FOUND, { atlasId: id });
    }
    if (entries.length === 1) {
        // The app always has a local workspace to fall back to (the logged out boot guard
        // needs one). Emptying an atlas is the existing "Limpar todos os dados" action.
        return refuse(LocalAtlasError.LAST_ATLAS, { atlasId: id });
    }

    const [entry] = entries.splice(index, 1);
    const wasCurrent = _currentId === entry.id;

    if (wasCurrent) {
        _currentId = [...entries].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
    }
    await persistRegistry();

    const { dropped, blocked } = await dropAtlasDatabases(scopeOfLocalAtlas(entry));

    if (wasCurrent && getActiveScopeKind() !== StoreScopeKind.REMOTE) {
        activateScope(scopeOfLocalAtlas(entries.find(e => e.id === _currentId)));
    }

    return {
        ok: true,
        atlas: { ...entry },
        droppedDatabases: dropped,
        blockedDatabases: blocked
    };
}

/**
 * @returns {string|null} Kind of the active scope, or null when nothing is active.
 */
function getActiveScopeKind() {
    return getActiveScope()?.kind ?? null;
}
