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
 *
 * THE ONE THING IT REACHES OUTSIDE PERSISTENCE is the tab-lock channel, and only on the one
 * operation that DESTROYS databases: `deleteLocalAtlas` announces the unmount notice before it
 * drops anything, exactly as `store.js` does for the remote sweep. It is bound to the destruction
 * and not to the caller for the reason written there: two callers and one of them remembering is
 * the shape of defect that comes back.
 */

import { createAtlas, ATLAS_SCHEMA_VERSION } from './atlas/atlas.entity.js';
import { generateUUID } from '../utilities/uuid.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import {
    ATLAS_RECORD_KEY,
    GlobalKey,
    LEGACY_DB_SUFFIX,
    localAtlasRegistryKey,
    isLocalAtlasRegistryKey,
    atlasIdFromLocalRegistryKey,
    StoreName,
    StoreScopeKind,
    activateScope,
    getActiveScope,
    getGlobalStore,
    getStoreFor,
    dropAtlasDatabases,
    localScope,
    bootTabMountPointer,
    readLocalAtlasRegistry,
    remoteAtlasRegistryKey,
    remoteScope
} from './atlas-namespace.js';
import { activateRemoteAtlas } from './remote-atlas.api.js';
// From the FILE, never from the `@utils` barrel, for the reason `store.js` states at its own copy
// of this import: the barrel reaches `@store` transitively, and this module is loaded by
// `projetos.html`, which exists in order not to load the store's map half.
import { announceTabLockTeardown, TeardownReason } from '@utils/tab-lock.js';

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
    for (const entry of _entries) {
        await globalStore.setItem(localAtlasRegistryKey(entry.id), { version: REGISTRY_VERSION, ...entry });
    }
    await globalStore.setItem(GlobalKey.CURRENT_LOCAL_ATLAS, _currentId);
}

/**
 * Persists ONE slot's registry entry, without touching the in-memory mirror.
 *
 * Separate from `persistRegistry` so a caller can write to disk FIRST and only mirror after
 * the write resolves. A mirror updated before the disk is a claim the next boot cannot honour.
 * @param {LocalAtlasEntry} entry
 * @returns {Promise<void>}
 */
async function persistRegistryEntry(entry) {
    await getGlobalStore().setItem(localAtlasRegistryKey(entry.id), { version: REGISTRY_VERSION, ...entry });
}

/**
 * Removes one slot's registry entry. Deleting a slot must not rewrite the entries of the
 * others, which is the whole point of one key per slot.
 * @param {string} id - Local atlas id.
 * @returns {Promise<void>}
 */
async function removeRegistryEntry(id) {
    await getGlobalStore().removeItem(localAtlasRegistryKey(id));
}

/**
 * Reads the registry from the global database into memory, migrating the legacy
 * single-array key on the way.
 *
 * ONE KEY PER SLOT, and the local registry arrived here late. It used to be one array under
 * `local_atlases`, written whole on every change, which is a read-modify-write across tabs:
 * tab A reads [x], appends a, writes [x,a]; tab B reads [x], appends b, writes [x,b]; the
 * result is [x,b] and slot `a` is gone from the registry while its ten databases sit on
 * disk, reachable by no purge and no UI. It is not a theoretical race: two tabs whose
 * session dies together both run the rescue, and the loser's rescued work disappears from
 * the list that was supposed to be saving it.
 *
 * The remote registry already documents this reasoning (`remote-atlas.api.js`, property 2)
 * and the local one ignored it. They now use the same shape.
 *
 * @returns {Promise<void>}
 */
async function loadRegistry() {
    const globalStore = getGlobalStore();
    _entries = [];

    const keys = await globalStore.keys();
    for (const key of keys) {
        if (!isLocalAtlasRegistryKey(key)) continue;
        const stored = await globalStore.getItem(key);
        const id = atlasIdFromLocalRegistryKey(key);
        // Identity comes from the KEY: a value that failed to parse still yields an
        // enumerable slot instead of turning into unreachable disk.
        if (!stored || typeof stored !== 'object') continue;
        _entries.push({ ...stored, id });
    }

    await migrateLegacyRegistryArray(globalStore);

    _entries.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    _currentId = await globalStore.getItem(GlobalKey.CURRENT_LOCAL_ATLAS) ?? null;
}

/**
 * Converts the legacy `local_atlases` array into one key per slot, once.
 *
 * Entries already present as their own key WIN: a tab that migrated and then created a slot
 * must not have that slot shadowed by a stale copy of the old array.
 *
 * @param {import('localforage').default} globalStore
 * @returns {Promise<void>}
 */
async function migrateLegacyRegistryArray(globalStore) {
    const legacy = await globalStore.getItem(GlobalKey.LOCAL_ATLASES);
    if (!Array.isArray(legacy?.atlases)) return;

    const known = new Set(_entries.map(e => e.id));
    for (const entry of legacy.atlases) {
        if (!entry?.id || known.has(entry.id)) continue;
        _entries.push({ ...entry });
        await globalStore.setItem(localAtlasRegistryKey(entry.id), { version: REGISTRY_VERSION, ...entry });
    }
    // Only after every entry has its own key: a crash before this point re-runs the
    // migration harmlessly, while removing first could lose the whole registry.
    await globalStore.removeItem(GlobalKey.LOCAL_ATLASES);
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
 *
 * IT ALSO STAMPS `schemaVersion`, AND THAT IS NOT DECORATION. `checkAndCleanLegacyData`
 * (`repository.js`) reads that key from the ACTIVE scope on every boot and, finding it absent
 * or below the minimum, calls `clearLegacyStores()`. A slot created here starts empty, so
 * without the stamp the FIRST boot after it receives data would delete that data, silently and
 * with no error: the guard cannot tell "brand-new slot at the current schema" from "ancient
 * installation from before the schema existed", and absence reads as the second.
 *
 * Nothing hit this while the only slot came from the migration (which stamps on its own way
 * through). It becomes reachable the moment anything calls `createLocalAtlas`, and the
 * `.ebgeo` import is the first caller.
 *
 * @param {LocalAtlasEntry} entry
 * @returns {Promise<void>}
 */
async function seedAtlasRecord(entry) {
    const scope = scopeOfLocalAtlas(entry);
    await getStoreFor(StoreName.ATLAS, scope)
        .setItem(ATLAS_RECORD_KEY, { ...createAtlas(entry.name), id: entry.id });
    await getStoreFor(StoreName.SETTINGS, scope).setItem('schemaVersion', ATLAS_SCHEMA_VERSION);
}

/**
 * The LOCAL slot this tab had mounted before the reload, if any.
 *
 * It reads the BOOT SNAPSHOT and never the live pointer, for the reason spelled out in
 * `bootTabMountPointer`: the repository bridge mounts the legacy scope before the boot decides
 * anything, so the live pointer would answer "the legacy slot" for every tab.
 *
 * A REMOTE pointer yields null on purpose: which server atlas to reopen is decided by the origin
 * (`resolveTabMountOrigin` feeds it in as `options.origin`), and answering it from here would give
 * a server atlas id to code whose whole subject is the local registry.
 * @returns {string|null} A local slot id, not yet checked against the registry.
 */
function tabMountedLocalSlotId() {
    const pointer = bootTabMountPointer();
    return pointer?.kind === StoreScopeKind.LOCAL ? pointer.atlasId : null;
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
 * @param {boolean} [options.preferTabMountPointer=false] - Whether the slot THIS TAB last mounted
 *   wins over the installation pointer (`atlas-namespace.js`, Decision 6). Opt-in, and only the
 *   boot passes it: the schema migration hands in an origin of its own and must not have its
 *   target redirected by wherever the tab happened to be.
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

    // WHICH SLOT THIS TAB REOPENS. `GlobalKey.CURRENT_LOCAL_ATLAS` answers for the installation,
    // which is the right answer for a tab that has never mounted anything and the WRONG one for a
    // tab that has: with two tabs in two local atlases, the pointer holds whichever was opened
    // last, so a reload in the other tab lands it in its neighbour's atlas.
    const mountedSlotId = options.preferTabMountPointer ? tabMountedLocalSlotId() : null;
    let current = _entries.find(e => e.id === mountedSlotId)
        ?? _entries.find(e => e.id === _currentId)
        ?? null;

    if (!current) {
        // A pointer that no longer resolves is not an error worth stopping the boot for:
        // fall back to the most recently touched slot, and repair the pointer.
        current = [..._entries].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        _currentId = current.id;
        await persistRegistry();
    } else if (current.id !== _currentId) {
        // IN MEMORY ONLY, and never persisted: this branch is only reachable when the tab pointer
        // won. Writing it through would make this tab's reload move the INSTALLATION's default,
        // which is the coupling the per-tab pointer exists to cut — the neighbour tab would then
        // find its own default changed by a reload it did not perform.
        _currentId = current.id;
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
    // PERSISTE PRIMEIRO, ESPELHA DEPOIS. O espelho em memória era escrito antes, e num disco
    // que recusa a escrita (cota) o resultado era o pior possível: `listLocalAtlases()`
    // afirmava um slot que NENHUM boot vai encontrar, apontando para bancos que a varredura
    // seguinte esvazia. A UI mostrava o resgate na lista e o dado já estava condenado.
    //
    // A ordem aqui é a mesma regra da transação do store: efeito colateral só depois que a
    // persistência confirma. Se `persistRegistry` lança, nada foi anunciado e o chamador
    // (`preserveUnsyncedWorkAsLocal`) trata a falha alto, sem marcar a origem LOCAL.
    await persistRegistryEntry(entry);
    _entries.push(entry);
    _currentId = entry.id;
    await getGlobalStore().setItem(GlobalKey.CURRENT_LOCAL_ATLAS, _currentId);

    await getGlobalStore().removeItem(remoteAtlasRegistryKey(atlasId));

    // The databases do not move, so the only thing left is the KIND of the active scope:
    // leaving it REMOTE would let the next logged-out purge treat it as server data.
    if (getActiveScope()?.dbSuffix === dbSuffix) {
        activateScope(scopeOfLocalAtlas(entry));
    }

    return { ok: true, atlas: { ...entry } };
}

/**
 * The LOCAL slot that claims the namespace of one SERVER atlas, if there is one. That slot only
 * ever comes from `adoptRemoteAtlasAsLocal`, so this is "was work of this project rescued on this
 * machine".
 *
 * IT READS THE DISK, never the in-memory mirror, for the reason the remote registry states as its
 * property 3: the rescue may have happened in ANOTHER TAB after this one loaded its registry, and
 * a caller that misses the claim opens the server atlas over the rescued work.
 *
 * `describeRemoteNamespaceClaim` (`atlas-namespace.js`) answers the same question with a word;
 * this answers it with the ENTRY, because the caller has to name the slot to the user and has to
 * be able to release it.
 *
 * @param {string} atlasId - Server atlas id.
 * @returns {Promise<LocalAtlasEntry|null>} A copy of the claiming entry, or null.
 */
export async function localAtlasAdoptingRemote(atlasId) {
    let dbSuffix;
    try {
        ({ dbSuffix } = remoteScope(atlasId));
    } catch {
        // An id that cannot name a namespace is claimed by nobody. Same rule as
        // `describeRemoteNamespaceClaim`: refusing loudly here would turn a corrupt URL into a
        // crash on a path whose whole job is to ask a question.
        return null;
    }
    const entry = (await readLocalAtlasRegistry()).find(e => e?.dbSuffix === dbSuffix);
    return entry ? { ...entry } : null;
}

/**
 * Gives the namespace of a rescued slot BACK to the remote registry: removes the local claim and
 * moves ZERO bytes. It is the exact inverse of `adoptRemoteAtlasAsLocal`.
 *
 * WHO CALLS IT AND WHY. Re-opening the very server atlas a rescue came from is the one open that
 * still lands on databases the user cares about (`account/open-atlas.service.js`): the rescued slot
 * and the server atlas ARE the same ten databases. Opening while both registries name them leaves
 * the namespace claimed twice and permanently, and `purgeAllRemoteAtlases` then reports it
 * `adopted` and spares it, so server data stays readable after a logout, which is the one
 * invariant `remote-atlas.api.js` may not break. Before this existed the wipe simply destroyed the
 * rescue and left that double claim behind.
 *
 * THE CALLER REGISTERS THE REMOTE CLAIM FIRST AND RELEASES AFTERWARDS, and that order is the same
 * "register before you write" the adoption obeys in reverse: a crash in between leaves BOTH claims,
 * which is the rescued state and heals itself (the next sweep sees `adopted` and drops the stale
 * remote key). Releasing first would leave a window in which NOBODY claims the namespace, and
 * unclaimed data is the outcome this design may not produce.
 *
 * IT DOES NOT DELETE A DATABASE. The caller mounts that same namespace as the server atlas one
 * line later and empties it there; dropping here would delete a database that is about to be
 * reopened, for nothing.
 *
 * @param {string} atlasId - Server atlas id whose namespace goes back to the remote registry.
 * @returns {Promise<LocalAtlasResult>} `{ ok: true, atlas }` with the released entry, or
 *   `{ ok: true, atlas: null }` when no local slot claimed it. Idempotent by design: "no claim to
 *   release" is the end state the caller asked for, not a refusal to report to the user.
 * @throws {Error} When `atlasId` is not an opaque server id (caller bug).
 */
export async function releaseAdoptedLocalAtlas(atlasId) {
    const { dbSuffix } = remoteScope(atlasId);
    const globalStore = getGlobalStore();

    // From disk, like the reader above: the tab that rescued the work may not be this one.
    const entry = (await readLocalAtlasRegistry()).find(e => e?.dbSuffix === dbSuffix) ?? null;
    if (!entry) return { ok: true, atlas: null };

    await globalStore.removeItem(localAtlasRegistryKey(entry.id));

    // Mirror AFTER the disk (the rule `adoptRemoteAtlasAsLocal` writes out): a mirror that drops
    // the slot while the key survives would hide from this tab a claim the next boot honours.
    if (_entries !== null) {
        const index = _entries.findIndex(e => e.id === entry.id);
        if (index !== -1) _entries.splice(index, 1);
    }

    if (_currentId === entry.id) {
        // The pointer cannot stay on a slot that no longer exists. Null is a legal value here:
        // `initLocalAtlases` falls back to the most recently touched slot, and bootstraps one when
        // the registry ends up empty (the released slot may have been the only one, and refusing
        // for that reason would mean keeping a claim the user asked to drop).
        _currentId = _entries?.length
            ? [..._entries].sort((a, b) => b.updatedAt - a.updatedAt)[0].id
            : null;
        await globalStore.setItem(GlobalKey.CURRENT_LOCAL_ATLAS, _currentId);
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
 * Renames a local atlas.
 *
 * THE NAME LIVES IN TWO PLACES THAT ARE BORN EQUAL, and a rename that writes only one of them
 * produces a UI that contradicts itself: the registry (this module's source of truth, what the
 * project chooser lists) and the slot's OWN atlas record, seeded from it by `seedAtlasRecord`
 * and read by the map. Renaming only the registry leaves the chooser showing the new name and
 * the map showing the old one, with nothing erroring.
 *
 * The DATABASES ARE NOT TOUCHED: `dbSuffix` is the id precisely so a rename never has to rename
 * a database (IndexedDB has no rename). The slot's record is written through an EXPLICIT scope,
 * so renaming a slot this client does not have mounted neither mounts it nor takes its lock.
 *
 * Duplicates are SUFFIXED, never refused, for the reason `uniqueName` spells out; the entry
 * being renamed is excluded from the comparison, so re-confirming the same name is a no-op
 * instead of turning "Alfa" into "Alfa (2)".
 *
 * Disk first, mirror after, the rule `adoptRemoteAtlasAsLocal` writes out: a mirror updated
 * before the write lands announces a name no boot would honour.
 *
 * @param {string} id - Local atlas id.
 * @param {string} name - New display name, pt-BR.
 * @returns {Promise<LocalAtlasResult>} `{ ok: true, atlas }`, or a named refusal.
 * @throws {Error} When `name` is not a non-empty string (caller bug).
 */
export async function renameLocalAtlas(id, name) {
    if (typeof name !== 'string' || name.trim().length === 0) {
        throw new Error('renameLocalAtlas: name must be a non-empty string');
    }
    const entries = requireEntries();
    const entry = entries.find(e => e.id === id);
    if (!entry) {
        return refuse(LocalAtlasError.NOT_FOUND, { atlasId: id });
    }

    const renamed = {
        ...entry,
        name: uniqueName(name.trim(), entries.filter(e => e.id !== id)),
        updatedAt: Date.now()
    };
    await persistRegistryEntry(renamed);
    entry.name = renamed.name;
    entry.updatedAt = renamed.updatedAt;

    const store = getStoreFor(StoreName.ATLAS, scopeOfLocalAtlas(entry));
    const record = await store.getItem(ATLAS_RECORD_KEY);
    // A slot with no record yet (the legacy slot before its first boot) needs no mirror: the
    // record is seeded from the registry when it is finally written, already carrying this name.
    if (record) {
        await store.setItem(ATLAS_RECORD_KEY, { ...record, name: renamed.name });
    }

    return { ok: true, atlas: { ...renamed } };
}

/**
 * Switches the current local atlas. The caller must have unmounted the previous atlas
 * (memory store, layer caches, outbound queue) BEFORE calling this.
 *
 * While a remote atlas is open the pointer moves but the active scope does NOT: the remote
 * namespace stays mounted until the session ends, and the new pointer takes effect on the next
 * local activation. Leaving a server atlas ON PURPOSE is `mountLocalAtlas`, which says so.
 *
 * @param {string} id - Local atlas id.
 * @returns {Promise<LocalAtlasResult>} `{ ok: true, atlas }`, or a named refusal.
 */
export async function setCurrentLocalAtlas(id) {
    return pointAtLocalAtlas(id, getActiveScopeKind() !== StoreScopeKind.REMOTE);
}

/**
 * Moves the pointer AND mounts the slot, whatever was mounted before — including a server
 * atlas's namespace.
 *
 * WHY IT IS A SEPARATE EXPORT AND NOT A FLAG ON `setCurrentLocalAtlas`. The conditional above is
 * a safety net for a caller that only meant to move the pointer: silently mounting over a live
 * remote namespace would redirect writes the connected session still believes are going to the
 * server. Leaving the server atlas is a DECISION, and a decision needs a caller that spells it
 * out. Today there is exactly one (`account/open-atlas.service.js`, the `.ebgeo` import that
 * creates a local atlas and switches to it), and `tests/unit/portao-de-montagem.test.js` pins
 * that list, because "who may mount an atlas" is the question that phase E3 exists to keep
 * answerable.
 *
 * IT DOES NOT DISCONNECT, WIPE OR UNMOUNT ANYTHING. This module owns persistence and scope
 * selection only (see the fileoverview): the caller must have closed the socket and must empty
 * the newly mounted slot afterwards, so the in-memory store stops mirroring the atlas it left.
 *
 * @param {string} id - Local atlas id.
 * @returns {Promise<LocalAtlasResult>} `{ ok: true, atlas }`, or a named refusal.
 */
export async function mountLocalAtlas(id) {
    return pointAtLocalAtlas(id, true);
}

/**
 * Shared body of the two pointer moves: persist first, then (maybe) mount.
 * @param {string} id - Local atlas id.
 * @param {boolean} mount - Whether to point every store at this slot.
 * @returns {Promise<LocalAtlasResult>}
 */
async function pointAtLocalAtlas(id, mount) {
    const entry = requireEntries().find(e => e.id === id);
    if (!entry) {
        return refuse(LocalAtlasError.NOT_FOUND, { atlasId: id });
    }

    _currentId = entry.id;
    entry.updatedAt = Date.now();
    await persistRegistry();

    if (mount) {
        activateScope(scopeOfLocalAtlas(entry));
    }

    return { ok: true, atlas: { ...entry } };
}

/**
 * WARNS EVERY OTHER TAB THAT THESE DATABASES ARE ABOUT TO GO, and waits for them to stop.
 *
 * Same protocol as the logout sweep (`utilities/tab-lock.js`, section 8, and `store.js`
 * `announceRemoteNamespaceTeardown` on the remote side), addressed by the slot's `dbSuffix` and
 * never by a key: a tab deleting an atlas in `projetos.html` holds NOTHING (`noneKey`), so it
 * collides with nobody and a notice routed through `keysCollide` would reach no one. That tab is
 * also never on the receiving end, because it installs no `onTeardown` effect: it announces and
 * is never announced to.
 *
 * WHAT IT BUYS, AND WHAT IT DOES NOT. It is NOT what authorises the deletion, and it never blocks
 * it: a peer that cannot answer costs the timeout and nothing more, and with no transport at all
 * the delete behaves exactly as it did before this existed. What it buys is that a sibling tab
 * with this slot MOUNTED stops writing BEFORE `dropAtlasDatabases` lands. Without that, the drop
 * completes anyway (localforage closes on `versionchange`) and the sibling's next write RECREATES
 * the ten databases under a name no registry mentions, which is unreachable residue: the exact
 * defect the namespace registry exists to prevent, and the reason this notice was worth wiring.
 *
 * IT IS DERIVED HERE, next to the destruction, for the reason the remote announcer gives: a copy
 * of this derivation in the caller is a list that drifts from the one actually destroyed.
 *
 * @param {LocalAtlasEntry} entry - The slot about to be deleted.
 * @returns {Promise<void>} Never rejects: failing to warn must not abort a deletion the user asked
 *   for, and the silent case is the behaviour that preceded the notice.
 */
async function announceLocalAtlasTeardown(entry) {
    try {
        await announceTabLockTeardown([scopeOfLocalAtlas(entry).dbSuffix], {
            reason: TeardownReason.LOCAL_ATLAS_DELETED
        });
    } catch (error) {
        console.warn('[local-atlas] announcing the deletion failed:', error);
    }
}

/**
 * Deletes a local atlas and its databases.
 *
 * Order matters and is deliberate: warn the other tabs, then the pointer, then the registry, then
 * the databases. A crash after the pointer moved leaves a consistent installation; a crash after
 * the registry write leaves orphan databases, which are inert garbage. The reverse order
 * would leave the pointer aimed at a half deleted atlas.
 *
 * THE WARNING COMES BEFORE ANY MUTATION AND AFTER BOTH REFUSALS, which is the only placement that
 * is right in both directions: announcing a destruction that is then refused (the cap, a stale id)
 * would freeze a sibling tab over an atlas nobody deleted, and announcing after the drop would be
 * a warning that arrives once there is nothing left to stop. See {@link announceLocalAtlasTeardown}.
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

    await announceLocalAtlasTeardown(entries[index]);

    const [entry] = entries.splice(index, 1);
    const wasCurrent = _currentId === entry.id;

    if (wasCurrent) {
        _currentId = [...entries].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
    }
    // The deleted slot's key is REMOVED, never left to be overwritten by a rewrite of the
    // whole registry: under one key per slot, `persistRegistry` only touches the entries it
    // still knows about, so without this the deleted slot would survive on disk and come
    // back on the next boot.
    await removeRegistryEntry(entry.id);
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
