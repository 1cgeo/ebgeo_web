// Path: js/store/store-origin.js

/**
 * @fileoverview Tracks whether the local IndexedDB currently holds a LOCAL atlas
 * (data the user owns and persists on THIS machine — including the logged-out
 * "general" atlas) or a REMOTE atlas (a server atlas being edited collaboratively,
 * which only lives here TEMPORARILY while connected and must be discarded on
 * disconnect/logout).
 *
 * This is the explicit, additive separation between "what persists on the machine"
 * and "what only persists because of an active connection". It exists so a logged-out
 * user can never keep editing a remote server atlas: on boot, if the store holds remote
 * data but nobody is authenticated, the remote data is discarded back to a blank local
 * atlas (see store.js). To keep working on a remote atlas offline the user must download
 * its `.ebgeo` (which becomes a local atlas).
 *
 * ADDITIVE GUARANTEE: the origin defaults to LOCAL and is absent for every pre-existing
 * offline user, so the offline/standalone workflow (IndexedDB + `.ebgeo`) is completely
 * untouched — the remote machinery only ever engages after an explicit server connect.
 *
 * WHERE THE MARKER LIVES, AND WHY IT IS THE ONE SETTING THAT CANNOT BE NAMESPACED:
 * it used to be an appStore key (`ebgeo_app_settings`), which is a PER-ATLAS database now.
 * This marker is read BEFORE any scope is active and is what DECIDES the scope, so keeping
 * it per atlas would mean choosing a namespace in order to discover which namespace to
 * choose. It therefore lives in the global database (`GlobalKey.STORE_ORIGIN`).
 *
 * Reading it from the new home alone would be a silent invariant break for anyone
 * upgrading mid-session: their marker is in the legacy unsuffixed `ebgeo_app_settings`,
 * the new home is empty, the read would default to LOCAL, and `enforceLocalStoreWhenLoggedOut`
 * would keep a server atlas as permanent local data. Hence the legacy fallback below. It
 * cannot wait for the schema migration either: `loadStoreOrigin` runs in the boot guard,
 * BEFORE `initializeRepository` runs any migration.
 *
 * ---------------------------------------------------------------------------------------------
 * IT ANSWERS ONE QUESTION, AND IT USED TO BE ASKED TWO
 * ---------------------------------------------------------------------------------------------
 * The marker and the ACTIVE SCOPE (`atlas-namespace.js`) were two sources that could disagree,
 * which is the thing the phase set out to remove. They were disagreeing because the same marker
 * was answering two questions that are not the same question:
 *
 *   1. "IS THERE SERVER DATA IN THE UNSUFFIXED DATABASES?" — a fact about the INSTALLATION, and
 *      the only question the logged-out boot guard asks (`enforceLocalStoreWhenLoggedOut`). It
 *      has to stay global: the residue it hunts predates namespaces and belongs to no tab.
 *   2. "WHICH ATLAS DOES THIS TAB MOUNT?" — a fact about ONE TAB, and with a namespace per atlas
 *      a global answer is simply wrong: tab A presses F5 and boots into tab B's atlas.
 *
 * Question 2 moved out, to the per-tab mount pointer that `activateScope` writes
 * (`atlas-namespace.js`, Decision 6), and `resolveTabMountOrigin` is where the boot reads it.
 * What is left here is question 1 and only question 1. `originOfScope` is the projection that
 * keeps the two from drifting: an origin is DERIVED from a scope, never invented next to one.
 *
 * ---------------------------------------------------------------------------------------------
 * THE MARKER IS A CACHE OF THE REGISTRY, AND THE REGISTRY WINS (P5)
 * ---------------------------------------------------------------------------------------------
 * The marker used to be a SECOND SOURCE OF TRUTH: any caller could write a durable claim, and
 * nothing ever compared it against the registries that every destructive path is derived from
 * (`purgeAllRemoteAtlases` reads the remote registry, `readLocalAtlasRegistry` the local one).
 * Two rules replace that, and between them the marker can no longer state anything the registry
 * contradicts:
 *
 *   1. IT CANNOT CLAIM REMOTE WITHOUT A MOUNT. `markStoreRemote(atlasId)` now ASSERTS that this
 *      tab has that atlas's namespace mounted, and throws otherwise. The only legal way to mount
 *      one is `activateRemoteAtlas`, which REGISTERS before it activates, so a REMOTE marker
 *      implies a registry entry by construction. `tests/unit/portao-de-montagem.test.js` already
 *      policed this by reading the source; it is now also true at run time.
 *   2. A REMOTE CLAIM IS RE-DERIVED AT EVERY BOOT. `loadStoreOrigin` asks the registries who owns
 *      that namespace (`describeRemoteNamespaceClaim`) and downgrades the marker to LOCAL when a
 *      LOCAL slot owns it, repairing the stale value on disk. `reconcileWithRegistry` says which
 *      disagreement that is, and which one it deliberately does NOT touch.
 *
 * WHAT ABOUT THE OTHER DIRECTION, `markStoreLocal()` OVER A LIVE SERVER NAMESPACE. It stays
 * legal, and it is the one contradiction that costs nothing, because the sweep that carries the
 * hard invariant does not read the marker at all: `discardRemoteAtlasNamespaces` runs on every
 * logged-out boot and is derived from the remote registry, so a marker lying LOCAL over a
 * registered namespace does not save that namespace from destruction. The function also takes no
 * argument, so it cannot invent an atlas id — the dangerous direction is the one rule 1 closes.
 *
 * DERIVING FROM THE ACTIVE SCOPE INSTEAD WAS TRIED ON PAPER AND IS WRONG, so it is written down
 * rather than rediscovered: `getStoreOriginSync()` cannot read `getActiveScope()`, because the
 * boot MOUNTS BEFORE IT DECIDES (`atlas-namespace.js`, Decision 6) and `discardRemoteAtlasNamespaces`
 * re-points the store at a LOCAL slot halfway through `enforceLocalStoreWhenLoggedOut`. A scope
 * derived read would answer LOCAL right there and silence the second wipe, which is the wipe the
 * pre-namespace installation depends on. The durable registry is per installation like the marker
 * is; the active scope is per tab and is written by a bridge. Only the first can arbitrate.
 */

import {
    GlobalKey,
    LEGACY_DB_SUFFIX,
    StoreName,
    StoreScopeKind,
    bootTabMountPointer,
    describeRemoteNamespaceClaim,
    forgetRemoteTabMount,
    getActiveScope,
    getGlobalStore,
    getStoreFor,
    localScope
} from './atlas-namespace.js';

/** Origin kinds. */
export const StoreOriginKind = Object.freeze({ LOCAL: 'local', REMOTE: 'remote' });

/** Global-database key holding the persisted origin marker. */
const ORIGIN_KEY = GlobalKey.STORE_ORIGIN;

/**
 * Diagnostic id of the scope used to read the PRE-NAMESPACE settings database. It never
 * reaches a database name (the empty `LEGACY_DB_SUFFIX` does), and this read is the only
 * reason the module knows the legacy layout exists.
 */
const LEGACY_ORIGIN_SCOPE_ID = 'legacy-origin';

/** Default origin: a fresh/offline store is always LOCAL. */
const DEFAULT_ORIGIN = Object.freeze({ kind: StoreOriginKind.LOCAL, atlasId: null });

/**
 * In-memory mirror of the persisted origin, for synchronous reads on hot/boot paths.
 * @type {{ kind: string, atlasId: string|null }}
 */
let _origin = { ...DEFAULT_ORIGIN };

/**
 * Normalizes a persisted value into an origin, or null when it is absent/malformed.
 * @param {*} stored - Raw persisted value.
 * @returns {{ kind: string, atlasId: string|null }|null}
 */
function normalizeOrigin(stored) {
    return stored && stored.kind
        ? { kind: stored.kind, atlasId: stored.atlasId ?? null }
        : null;
}

/**
 * Reads the marker from the pre-namespace settings database (the unsuffixed
 * `ebgeo_app_settings`, which the migration adopts as local slot #1).
 * @returns {Promise<{ kind: string, atlasId: string|null }|null>}
 */
async function readLegacyOrigin() {
    try {
        const legacyScope = localScope(LEGACY_ORIGIN_SCOPE_ID, LEGACY_DB_SUFFIX);
        const legacySettings = getStoreFor(StoreName.SETTINGS, legacyScope);
        return normalizeOrigin(await legacySettings.getItem(ORIGIN_KEY));
    } catch {
        return null;
    }
}

/**
 * Moves a marker found in the legacy settings database into the global database.
 *
 * Order is the whole point: WRITE the new home first, and only then remove the legacy
 * copy. The failure mode of that order is a duplicated marker (inert, because the global
 * copy wins every later read); the reverse order loses the marker if the write fails, and
 * a lost REMOTE marker is a server atlas that becomes permanent local data. Leaving the
 * legacy copy in place forever is not an option either: a global database that is later
 * evicted would resurrect a stale REMOTE marker and the boot guard would discard local
 * work the user has done since.
 *
 * @param {{ kind: string, atlasId: string|null }} origin - Marker read from the legacy database.
 * @returns {Promise<void>}
 */
async function promoteLegacyOrigin(origin) {
    try {
        await getGlobalStore().setItem(ORIGIN_KEY, origin);
        const legacyScope = localScope(LEGACY_ORIGIN_SCOPE_ID, LEGACY_DB_SUFFIX);
        await getStoreFor(StoreName.SETTINGS, legacyScope).removeItem(ORIGIN_KEY);
    } catch {
        // Best effort: the in-memory mirror already holds the correct value for this boot,
        // and the legacy copy is still there to be promoted on the next one.
    }
}

/**
 * Re-derives a REMOTE marker from the registries, and downgrades it to LOCAL when they say
 * otherwise. This is what makes the marker a CACHE and the registry the source (P5).
 *
 * THE SHAPE IT CATCHES, which is a real gesture and used to end in the boot guard emptying the
 * user's local slot #1: THE RESCUE THAT DID NOT FINISH. `adoptRemoteAtlasAsLocal` moves the claim
 * of a namespace from the remote registry to the local one, and only then does the caller call
 * `markStoreLocal()`. A tab closed in between (or a marker write refused by quota) leaves a REMOTE
 * marker over a namespace a LOCAL slot owns. The next logged-out boot then sweeps, finds no remote
 * entry to destroy, `purgeReachedAtlas` answers false, and the second wipe lands on the unsuffixed
 * databases: the user's own local atlas, emptied to finish a job that was never there. Answering
 * LOCAL here stops the guard one line earlier, and the rescued work is reachable as what it is.
 *
 * ONLY A POSITIVE CLAIM OVERRULES THE MARKER, and the restraint is measured, not timid. The
 * tempting extra case is "namespaced installation, atlas in no registry" (the sweep that died
 * before flipping the marker), but "no entry" is also what a PRE-NAMESPACE install looks like,
 * where the server data sits in the unsuffixed databases and the marker is the only evidence of
 * it — and vetoing there hands a logged-out user a permanently editable copy of a server atlas.
 * Trying to separate the two by "does a local registry exist yet" FAILED in the 2.2 fixture suite:
 * the boot bootstraps a local slot before the schema migration re-reads the origin, so the same
 * install answers differently at the two reads and the migration stopped discarding the server
 * atlas it was holding (2 cases red in
 * `tests/integration/migracao-22-para-23-fixture-real.test.js`). A rescued namespace, by contrast,
 * can only be produced by the rescue: nothing else ever gives a LOCAL slot a `remote-<id>` suffix.
 *
 * A REMOTE marker with NO atlas id is left exactly as it is: it names no namespace, so the
 * registries have nothing to say about it, and the boot guard's own handling of it is unchanged.
 *
 * @param {{ kind: string, atlasId: string|null }} origin - Marker as read from disk.
 * @returns {Promise<{ kind: string, atlasId: string|null }>} The origin the registries support.
 */
async function reconcileWithRegistry(origin) {
    if (origin.kind !== StoreOriginKind.REMOTE) return origin;
    const atlasId = origin.atlasId;
    if (typeof atlasId !== 'string' || atlasId.length === 0) return origin;

    let claim;
    try {
        claim = await describeRemoteNamespaceClaim(atlasId);
    } catch {
        // A registry that cannot be read proves nothing, and a read error must never be the
        // reason a server atlas is relabelled as local data.
        return origin;
    }

    if (claim !== 'local') return origin;

    // REPAIR THE CACHE FROM ITS SOURCE, best effort. Leaving the stale value would be harmless
    // for this boot (it is re-derived on every one) and corrosive across boots: it is the exact
    // record every future reader would have to know to distrust.
    try {
        await getGlobalStore().setItem(ORIGIN_KEY, { ...DEFAULT_ORIGIN });
    } catch {
        // The in-memory answer below is already the right one for this boot.
    }
    return { ...DEFAULT_ORIGIN };
}

/**
 * Loads the persisted origin marker into the in-memory mirror. Call once on boot before
 * any synchronous origin read, and before `initLocalAtlases()`, which needs the origin to
 * decide whether to activate a local slot or the remote scratch. Defaults to LOCAL when
 * absent or on any read error.
 *
 * IT IS ALSO WHERE THE MARKER IS RE-DERIVED FROM THE REGISTRY (`reconcileWithRegistry`), which
 * is what demotes it from a second source of truth to a cache.
 * @returns {Promise<{ kind: string, atlasId: string|null }>}
 */
export async function loadStoreOrigin() {
    let stored = null;
    try {
        stored = normalizeOrigin(await getGlobalStore().getItem(ORIGIN_KEY));
    } catch {
        stored = null;
    }

    if (!stored) {
        stored = await readLegacyOrigin();
        if (stored) await promoteLegacyOrigin(stored);
    }

    _origin = stored ? await reconcileWithRegistry(stored) : { ...DEFAULT_ORIGIN };
    return _origin;
}

/**
 * @returns {{ kind: string, atlasId: string|null }} The current in-memory origin.
 */
export function getStoreOriginSync() {
    return _origin;
}

/**
 * The origin a scope IMPLIES. Pure, and the whole point of it being a projection: an origin is
 * read OFF a mount, never asserted beside one.
 *
 * A LOCAL scope always yields `atlasId: null`, even when its `dbSuffix` is `remote-<id>`. That
 * suffix belongs to a slot the rescue ADOPTED (`adoptRemoteAtlasAsLocal`), and its data is local
 * by decision: naming the server atlas here would hand the logged-out sweep an id it would then
 * try to collect, which is the rescued work.
 *
 * @param {{ kind: string, atlasId: string|null }|null} scope - A scope, or null.
 * @returns {{ kind: string, atlasId: string|null }|null} The implied origin, or null for no scope.
 */
export function originOfScope(scope) {
    if (!scope || typeof scope.kind !== 'string') return null;
    return scope.kind === StoreScopeKind.REMOTE
        ? { kind: StoreOriginKind.REMOTE, atlasId: scope.atlasId ?? null }
        : { kind: StoreOriginKind.LOCAL, atlasId: null };
}

/**
 * WHICH ATLAS THIS TAB SHOULD MOUNT, in the order the phase settled on.
 *
 *   1. the per-tab mount pointer (`sessionStorage`), i.e. where THIS tab was before the reload;
 *   2. the installation-wide marker passed in as `fallback`, i.e. what the machine last did.
 *
 * The `?atlas=` deep link is ABOVE both of them and is deliberately NOT read here. It wins by
 * ACTING: `openAtlasFromUrl` runs after the store boot and mounts through `openRemoteAtlas`,
 * whose wipe is aimed at the atlas being opened, so mounting the pointer's atlas first costs one
 * extra mount and no data. Pre-empting it here was tried on paper and rejected: it splits the
 * guard's marker from the mount, and a durable REMOTE marker left uncleaned because the mount
 * went somewhere else is exactly the shape that sends the boot guard's second wipe over the
 * user's local slot #1 (P13). The URL may reorder mounts; it may not silence the guard.
 *
 * @param {{ kind: string, atlasId: string|null }} fallback - The installation-wide origin,
 *   normally `getStoreOriginSync()` after `loadStoreOrigin()`.
 * @returns {{ kind: string, atlasId: string|null }}
 */
export function resolveTabMountOrigin(fallback) {
    return originOfScope(bootTabMountPointer()) ?? fallback;
}

/**
 * @returns {boolean} True when the local store currently holds a REMOTE (server) atlas.
 */
export function isRemoteStoreSync() {
    return _origin.kind === StoreOriginKind.REMOTE;
}

/**
 * Persists the origin marker and updates the in-memory mirror.
 *
 * NOT EXPORTED, and that is the point of P5 in one line: this is the raw writer, and while it
 * was public any caller could state an origin nothing had mounted. The two exported writers
 * below are the narrow forms — one asserts the mount, the other can only ever say LOCAL.
 * @param {string} kind - One of StoreOriginKind.
 * @param {string|null} [atlasId=null] - The connected atlas id (REMOTE only).
 * @returns {Promise<void>}
 */
async function setStoreOrigin(kind, atlasId = null) {
    _origin = { kind, atlasId: atlasId ?? null };
    await getGlobalStore().setItem(ORIGIN_KEY, { ..._origin });
}

/**
 * Marks the local store as holding a REMOTE (server) atlas. Called after a successful
 * connect, so a later boot knows this data is ephemeral.
 *
 * IT ASSERTS THE MOUNT INSTEAD OF TRUSTING THE CALLER, which is the half of D2 that was open
 * (P5). Declaring a REMOTE origin is a durable statement about the whole installation, and while
 * it was a free write it could contradict what this tab actually had mounted: the
 * `saveLocalToServer` defect was exactly that shape, the marker saying server while every store
 * still resolved to the user's LOCAL slot, so the pull wrote a server snapshot into the local
 * databases where no purge could find it.
 *
 * The check is cheap and total: the only legal way to mount a server namespace is
 * `activateRemoteAtlas`, which registers the atlas BEFORE activating it, so an active scope that
 * names `atlasId` is proof the registry names it too. Reversing the dependency (asking the
 * registry here) would ALSO pass for an atlas some other tab registered, which is precisely the
 * claim this must refuse.
 *
 * @param {string} atlasId - Server atlas whose namespace this tab has mounted.
 * @returns {Promise<void>}
 * @throws {Error} When this tab has not mounted that atlas's namespace (caller bug: the fix is
 *   to call `activateRemoteAtlas` first, never to relax this).
 */
export async function markStoreRemote(atlasId) {
    const scope = getActiveScope();
    if (scope?.kind !== StoreScopeKind.REMOTE || scope.atlasId !== atlasId) {
        throw new Error(
            `markStoreRemote("${atlasId}"): this tab has not mounted that atlas's namespace `
            + `(active scope: ${scope ? `${scope.kind}/${scope.atlasId ?? 'none'}` : 'none'}). `
            + 'Call activateRemoteAtlas(atlasId) first.'
        );
    }
    await setStoreOrigin(StoreOriginKind.REMOTE, atlasId);
}

/**
 * Marks the local store as holding a LOCAL (machine-owned) atlas. Called after clearing
 * data on disconnect/logout, and by the boot guard when discarding orphaned remote data.
 *
 * IT ALSO DROPS A PER-TAB POINTER THAT NAMES A SERVER NAMESPACE, and that is not an extra: it is
 * what stops the two from disagreeing across a reload. Every caller of this function is saying
 * "this tab is done with that server atlas" — a failed connect, a deleted atlas, the logged-out
 * guard, the rescue, the discard inside the 2.3 migration. Leaving the pointer aimed at the
 * namespace would make the next F5 mount the very atlas the caller just disowned, and on the
 * failed-connect path that means retrying a dead atlas forever, which is precisely what the
 * durable marker was flipped to LOCAL to prevent.
 *
 * A pointer whose kind is LOCAL is left alone even when its `dbSuffix` is `remote-<id>`: that is
 * a slot the rescue adopted, its data is local, and forgetting it would send the next boot to
 * some other slot while the rescued work sits unopened.
 *
 * IT IS DELIBERATELY NOT SYMMETRIC WITH `markStoreRemote`, which asserts the mount. This one is
 * allowed to run with a server namespace still mounted, because that is what its callers mean (a
 * failed connect, a deleted atlas, a logout, the rescue), and because the contradiction is inert:
 * the sweep that carries the invariant is derived from the remote registry and never reads this
 * marker, so a LOCAL claim cannot save a registered namespace from destruction. Taking no atlas
 * id, it also cannot invent one. See the fileoverview.
 * @returns {Promise<void>}
 */
export async function markStoreLocal() {
    forgetRemoteTabMount();
    await setStoreOrigin(StoreOriginKind.LOCAL, null);
}
