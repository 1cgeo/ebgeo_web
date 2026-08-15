// Path: js/store/remote-atlas.api.js

/**
 * @fileoverview The registry of REMOTE (server) atlas namespaces, and the wipe derived
 * from it. Sibling of `local-atlas.api.js`, and deliberately shaped like it: the local
 * atlases got an explicit registry and a wipe derived from that registry, and this is the
 * same move for the other side of the store-origin split.
 *
 * WHY IT EXISTS. Every server atlas now owns its ten databases
 * (`ebgeo_maps__remote-<atlasId>`, `atlas-namespace.js` Decision 1), because two tabs may
 * sit in two DIFFERENT server atlases and a single shared scratch would make them the same
 * ten databases. The price of that is this file: with a fixed scratch the logout wipe was a
 * constant list, and with N namespaces it needs to know WHICH namespaces exist. It cannot
 * ask the browser (`indexedDB.databases()` is not available everywhere), so it asks a
 * registry that is written BEFORE any namespace is used.
 *
 * THE INVARIANT, unchanged and non-negotiable: no data belonging to a server atlas
 * survives a logout. Three properties hold it up, and each one is a test:
 *
 *   1. REGISTER BEFORE THE FIRST WRITE. `activateRemoteAtlas` persists the entry and only
 *      then activates the scope, so a namespace can never receive a byte before the wipe
 *      knows it exists. The reverse order fails silently and forever.
 *   2. ONE KEY PER ATLAS (`remote_atlas:<atlasId>` in the global database), never one array
 *      under one key. Two tabs connecting to two atlases would each read the array, add
 *      their entry and write it back, and the loser's entry would vanish, which is exactly
 *      the unreachable residue this registry prevents. Separate keys do not race.
 *   3. THE PURGE READS FROM DISK, ALWAYS. There is no in-memory mirror in this module on
 *      purpose: a mirror loaded at boot cannot know about the atlas another tab opened
 *      afterwards, and logging out here has to wipe THAT one too.
 *
 * THE IDENTITY IS IN THE KEY, not in the stored value. A record that fails to parse still
 * yields its atlas id from the key, so a corrupted value cannot hide a server atlas from
 * the purge.
 *
 * IT SPARES WHAT A LIVE CLIENT HAS MOUNTED, AND ONLY FOR A WHILE (E2, Decision 5 of
 * `atlas-namespace.js`). Two tabs may sit in two different server atlases, and the sweep of one
 * used to empty and DEREGISTER the namespace the other had open: the neighbour then kept
 * writing into ten databases that no registry named any more, which is the unreachable residue
 * this module exists to prevent, produced by the module itself. So destruction now asks for the
 * mount lock of the namespace in `{exclusive, ifAvailable}`, and a refusal means "somebody is
 * alive in there": the data stays, the registry ENTRY stays (that is what makes the retry
 * derived instead of remembered), and the atlas is reported in `spared`.
 *
 * SPARING HAS A DEADLINE, and it is not a detail: the only collector of remote residue is gated
 * on there being no session (`store.js`), and `restoreSessionFromStorage` re-authenticates on
 * every boot while the refresh token lives. A spare without an expiry therefore does not DELAY
 * the residue, it makes it PERMANENT. The first refusal stamps `sparedAt` on the registry entry;
 * once `SPARE_GRACE_MS` has passed the namespace is destroyed with the mount still live.
 *
 * THE ONE EXIT THAT KEEPS THE DATA: `adoptRemoteAtlasAsLocal` (implemented in
 * `local-atlas.api.js`, which owns the local registry). When a session dies with unsynced
 * operations, `AccountControl._handleLogout` deliberately preserves the work as local; with
 * a namespace per remote atlas that rescue is no longer "flip the origin marker", it is
 * "move the claim from this registry to the local one". That call site IS wired now
 * (`preserveUnsyncedWorkAsLocal`, in `account.control.js`), and the purge below is what runs
 * for everything it does not rescue. The purge SKIPS a namespace already claimed by a local
 * registry entry, so the two registries can disagree for a moment without anyone losing
 * data, and it removes the stale remote key when it finds one.
 *
 * THAT DISAGREEMENT HAS TO BE A MOMENT, and for one gesture it was permanent. Re-opening the very
 * server atlas a rescue came from used to wipe the rescued slot on the way in and leave its LOCAL
 * claim standing, so from then on every sweep found the namespace `adopted`, spared it, and server
 * data stayed readable after a logout. The exit from a rescue is therefore as explicit as the
 * entrance: `releaseAdoptedLocalAtlas` (`local-atlas.api.js`) hands the claim back, and
 * `openRemoteAtlas` calls it AFTER `activateRemoteAtlas` has registered the remote claim, so the
 * two claims overlap rather than leaving a window with none.
 */

import {
    atlasIdFromRemoteRegistryKey,
    clearActiveScope,
    clearAtlasDatabases,
    dropAtlasDatabases,
    getActiveScope,
    getGlobalStore,
    isRemoteAtlasRegistryKey,
    activateScope,
    readLocalAtlasRegistry,
    releaseMountLock,
    releaseRemoteMountLock,
    remoteAtlasRegistryKey,
    remoteScope,
    StoreScopeKind,
    withExclusiveAtlasLock
} from './atlas-namespace.js';

/**
 * How long a namespace may be spared because a live client has it mounted, before the sweep
 * destroys it anyway.
 *
 * A DAY IS A CHOICE BETWEEN TWO LOSSES, so it is written here with both named. Shorter, and a
 * long working session in a second tab loses its data under it while the user is looking at it.
 * Longer, and a server atlas stays readable offline for longer than the hard invariant tolerates
 * (the collector only runs while nobody is authenticated, and a stored refresh token brings the
 * session back on every boot). The clock starts at the FIRST refusal and is never reset by a
 * later re-registration: resetting it would let a tab that reconnects periodically hold the
 * residue forever, which is the very failure the deadline exists to bound.
 */
export const SPARE_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} RemoteAtlasEntry
 * @property {string} atlasId - Server atlas id, the identity of the namespace.
 * @property {string} dbSuffix - Database suffix derived from it (`remote-<atlasId>`).
 * @property {number} createdAt - Epoch ms of the first registration.
 * @property {number} updatedAt - Epoch ms of the last activation.
 * @property {number} sparedAt - Epoch ms of the FIRST time a sweep spared this namespace
 *   because a live client had it mounted; 0 when it never was. It is the deadline's clock.
 */

/**
 * @typedef {Object} RemotePurgeReport
 * @property {string[]} atlases - Atlas ids whose namespace HELD DATA and was destroyed. The
 *   "held data" half is what keeps a namespace that was never written (registered by a tab
 *   that died before its first write) from counting as a destruction that happened.
 * @property {string[]} empty - Atlas ids whose registered namespace held nothing. Their entry
 *   is removed like any other, and they DO count as reached (`purgeReachedAtlas`): the split
 *   from `atlases` is a report of what was found, not a statement about whether the atlas owned
 *   a namespace, which the registry entry already settled.
 * @property {string[]} spared - Atlas ids left ALONE because a live client holds the mount
 *   lock. Their registry entry survives, and so does their data.
 * @property {string[]} forced - Atlas ids destroyed although a live client had them mounted,
 *   because the spare deadline expired. A subset of `atlases`/`empty`.
 * @property {string[]} cleared - Database names that held data and were emptied (the
 *   invariant-carrying step).
 * @property {string[]} dropped - Database names confirmed deleted from disk.
 * @property {string[]} blocked - Database names still on disk: emptied, delete not
 *   confirmed. Their registry entry is KEPT so the next logged-out boot retries.
 * @property {string[]} adopted - Atlas ids skipped because a local atlas claims their
 *   namespace. Their data is local now and must not be touched.
 * @property {boolean} deactivated - True when the active scope was one the sweep dealt with
 *   and was therefore cleared.
 */

/**
 * Reads every remote registry entry straight from the global database.
 *
 * No cache, by design (see the fileoverview): the set this returns is what another tab may
 * have changed one millisecond ago, and a wipe that consults a stale copy leaves server
 * data behind while reporting success.
 *
 * @returns {Promise<RemoteAtlasEntry[]>} Entries, oldest registration first.
 */
export async function listRemoteAtlases() {
    const globalStore = getGlobalStore();
    const keys = await globalStore.keys();
    const entries = [];

    for (const key of keys) {
        if (!isRemoteAtlasRegistryKey(key)) continue;
        const atlasId = atlasIdFromRemoteRegistryKey(key);
        if (!atlasId) continue;

        // The value is metadata; the KEY is the identity. A malformed value still produces
        // a usable entry, because a namespace the purge cannot see is the failure mode this
        // whole module exists to remove.
        //
        // BUT THE KEY ITSELF CAN BE UNUSABLE, and that promise did not cover it: `remoteScope`
        // REFUSES an id with characters outside the opaque set, and the throw escaped this
        // function. One corrupt key therefore took down the whole listing, so the logged-out
        // sweep enumerated NOTHING and every server atlas on the machine survived the logout,
        // which is the exact invariant this module carries. A key that cannot be turned into a
        // scope names no reachable namespace, so skipping it loudly costs nothing and lets the
        // others be collected.
        const stored = await globalStore.getItem(key);
        let dbSuffix;
        try {
            dbSuffix = remoteScope(atlasId).dbSuffix;
        } catch (error) {
            console.error(`[remote-atlas] registry key "${key}" is unusable and was skipped:`, error);
            continue;
        }
        entries.push({
            atlasId,
            dbSuffix,
            createdAt: Number.isFinite(stored?.createdAt) ? stored.createdAt : 0,
            updatedAt: Number.isFinite(stored?.updatedAt) ? stored.updatedAt : 0,
            sparedAt: Number.isFinite(stored?.sparedAt) ? stored.sparedAt : 0
        });
    }

    return entries.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Records that a server atlas owns a namespace on this machine. Idempotent: re-registering
 * keeps `createdAt` and refreshes `updatedAt`.
 *
 * CALL THIS BEFORE THE FIRST WRITE to the namespace, which is why `activateRemoteAtlas`
 * exists and why nothing else should call `activateScope(remoteScope(...))` directly.
 *
 * @param {string} atlasId - Server atlas id.
 * @returns {Promise<{ entry: RemoteAtlasEntry, scope: Object }>}
 * @throws {Error} When `atlasId` is missing or not an opaque id (caller bug: it reaches a
 *   database name).
 */
export async function registerRemoteAtlas(atlasId) {
    const scope = remoteScope(atlasId);
    const globalStore = getGlobalStore();
    const key = remoteAtlasRegistryKey(atlasId);

    const existing = await globalStore.getItem(key);
    const now = Date.now();
    const entry = {
        atlasId,
        dbSuffix: scope.dbSuffix,
        createdAt: Number.isFinite(existing?.createdAt) ? existing.createdAt : now,
        updatedAt: now,
        // CARRIED OVER, NEVER RESET. Re-registering is how a mounted namespace refreshes its
        // entry, and clearing the spare clock here would hand a periodically reconnecting tab
        // a permanent exemption from the sweep.
        sparedAt: Number.isFinite(existing?.sparedAt) ? existing.sparedAt : 0
    };

    await globalStore.setItem(key, entry);
    return { entry, scope };
}

/**
 * Registers a server atlas and points every subsequent `getStore()` at its namespace.
 *
 * THE ORDER IS THE CONTRACT: if the registry write fails, this throws and NOTHING is
 * activated, so the caller cannot end up writing into a namespace no wipe can find.
 *
 * @param {string} atlasId - Server atlas id.
 * @returns {Promise<Object>} The activated scope.
 */
export async function activateRemoteAtlas(atlasId) {
    const { scope } = await registerRemoteAtlas(atlasId);
    activateScope(scope);
    return scope;
}

/**
 * @returns {Promise<Set<string>>} Database suffixes claimed by a LOCAL atlas. Read straight
 *   from the global database rather than through `local-atlas.api.js` so the purge works at
 *   boot, before any registry is loaded into memory.
 */
async function locallyClaimedSuffixes() {
    const atlases = await readLocalAtlasRegistry();
    return new Set(atlases.map(entry => entry?.dbSuffix).filter(s => typeof s === 'string'));
}

/**
 * Destroys the namespace of ONE registered remote atlas: empties it, then deletes the empty
 * databases, then removes the registry entry.
 *
 * IT DOES NOT ASK WHETHER IT MAY. The arbitration lives in `destroyRemoteAtlasIfUnmounted`,
 * because the deadline path deliberately runs this with a live mount.
 *
 * @param {RemoteAtlasEntry} entry - Entry to destroy.
 * @param {number|undefined} dropTimeoutMs - Bound on each delete.
 * @returns {Promise<{ cleared: string[], dropped: string[], blocked: string[], hadData: boolean }>}
 *   `hadData` distinguishes a namespace that was emptied from one that was never written: only
 *   the first counts as a destruction that happened (P3, and `clearAtlasDatabases`).
 */
async function destroyRemoteAtlas(entry, dropTimeoutMs) {
    const scope = remoteScope(entry.atlasId);

    // Step 1 carries the invariant and cannot be blocked; step 2 is hygiene and can.
    const { cleared } = await clearAtlasDatabases(scope);
    const { dropped, blocked } = await dropAtlasDatabases(
        scope,
        dropTimeoutMs === undefined ? {} : { timeoutMs: dropTimeoutMs }
    );

    if (blocked.length === 0) {
        await getGlobalStore().removeItem(remoteAtlasRegistryKey(entry.atlasId));
    } else {
        // The entry SURVIVES on purpose: the data is already gone, and keeping the claim is
        // what makes the retry derived instead of remembered. The next boot without a
        // session finds it and deletes the shells, once the other tab has let go.
        console.warn(
            `[remote-atlas] delete blocked for atlas ${entry.atlasId}; data was emptied, `
            + `${blocked.length} empty database(s) stay until the next logged-out boot`
        );
    }

    return { cleared, dropped, blocked, hadData: cleared.length > 0 };
}

/**
 * Destroys the namespace of one atlas ONLY IF no live client has it mounted.
 *
 * @param {RemoteAtlasEntry} entry - Entry to destroy.
 * @param {number|undefined} dropTimeoutMs - Bound on each delete.
 * @returns {Promise<{ spared: boolean, cleared: string[], dropped: string[], blocked: string[],
 *   hadData: boolean }>} With `spared:true` NOTHING ran: no database was opened, no key was
 *   read, and the registry entry is untouched.
 */
async function destroyRemoteAtlasIfUnmounted(entry, dropTimeoutMs) {
    const { granted, result } = await withExclusiveAtlasLock(
        remoteScope(entry.atlasId),
        () => destroyRemoteAtlas(entry, dropTimeoutMs)
    );
    if (!granted) {
        return { spared: true, cleared: [], dropped: [], blocked: [], hadData: false };
    }
    return { spared: false, ...result };
}

/**
 * Stamps the moment a namespace was FIRST spared, which is the clock the deadline reads.
 *
 * The write is idempotent and never moves an existing stamp. It also tolerates a corrupted
 * value, because the identity is in the key: a record that cannot be parsed still gets a fresh
 * entry, so the namespace stays enumerable instead of falling out of the registry.
 *
 * @param {RemoteAtlasEntry} entry - Entry that was just spared.
 * @returns {Promise<void>}
 */
async function stampSparedAt(entry) {
    if (entry.sparedAt > 0) return;

    const globalStore = getGlobalStore();
    const key = remoteAtlasRegistryKey(entry.atlasId);
    const stored = await globalStore.getItem(key);
    const base = (stored && typeof stored === 'object') ? stored : {};

    await globalStore.setItem(key, {
        ...base,
        atlasId: entry.atlasId,
        dbSuffix: entry.dbSuffix,
        sparedAt: Date.now()
    });
}

/**
 * THE LOGGED-OUT WIPE. Empties and deletes every registered remote namespace.
 *
 * It is derived from the registry, never from a hand-written list of atlases and never
 * from the store-origin marker: the marker describes the atlas this tab last had mounted,
 * while the residue that outlives a session is whatever any tab ever opened. That is why
 * `store.js` calls this whenever nobody is authenticated, INCLUDING when the marker says
 * LOCAL, which is the case a crash leaves behind.
 *
 * ITS FIRST ACT IS TO LET GO OF ITS OWN MOUNT. The sweep means "the session is over", so a
 * server namespace THIS client has mounted is forfeit; leaving the shared lock in place would
 * make the client spare itself, and the atlas the user was just looking at would be the one
 * namespace that survives the logout. Releasing is also what makes the sweep survive a module
 * reload: the lock belongs to the client, not to the instance that took it.
 *
 * @param {Object} [options]
 * @param {number} [options.dropTimeoutMs] - Bound on each database delete.
 * @param {number} [options.spareGraceMs=SPARE_GRACE_MS] - How long a mounted namespace may be
 *   spared before it is destroyed anyway.
 * @returns {Promise<RemotePurgeReport>}
 */
export async function purgeAllRemoteAtlases({ dropTimeoutMs, spareGraceMs = SPARE_GRACE_MS } = {}) {
    const entries = await listRemoteAtlases();
    const report = {
        // EVERY ATLAS THE REGISTRY KNEW, captured BEFORE anything is destroyed. This is the
        // field the boot guard actually needs, and having it removes an inference: the guard
        // asks "was this atlas registered", not "did the sweep end up putting it in one of the
        // outcome lists". The two agree on the happy path and diverge exactly where it matters,
        // because an entry whose destruction THREW lands in no outcome list at all, and the
        // guard reading the outcome lists would then aim its second wipe at the user's local
        // slot #1 (see `purgeReachedAtlas`).
        registered: entries.map(e => e.atlasId),
        atlases: [],
        empty: [],
        spared: [],
        forced: [],
        failed: [],
        cleared: [],
        dropped: [],
        blocked: [],
        adopted: [],
        deactivated: false
    };
    if (entries.length === 0) return report;

    await releaseRemoteMountLock();
    const claimed = await locallyClaimedSuffixes();
    const now = Date.now();

    for (const entry of entries) {
        try {
            await purgeOneRemoteAtlas(entry, { report, claimed, now, dropTimeoutMs, spareGraceMs });
        } catch (error) {
            // ONE ATLAS FAILING MUST NOT ABORT THE SWEEP. Without this, an entry that throws
            // (a database another process holds in a state localforage rejects, a quota error
            // mid-clear) takes down the whole logged-out purge, and every OTHER server atlas on
            // the machine survives the logout, which is the invariant this function carries.
            // The entry is kept in the registry so the next boot retries it.
            console.error(`[remote-atlas] purge of ${entry.atlasId} failed:`, error);
            report.failed.push(entry.atlasId);
        }
    }

    // A sweep only ever runs because the session is over, so this client has no business in a
    // server namespace afterwards, whatever happened to that particular one: a destroyed scope
    // left active would be RECREATED by the next write, now outside the registry, and a spared
    // one belongs to somebody else's session.
    if (getActiveScope()?.kind === StoreScopeKind.REMOTE) {
        clearActiveScope();
        report.deactivated = true;
    }

    return report;
}

/**
 * Destroys the namespace of ONE registry entry, writing the outcome into the shared report.
 *
 * Extracted from the loop so a failure can be caught PER ENTRY: the sweep carries the invariant
 * "no server data survives a logout", and one unlucky database must not let the others live.
 *
 * @param {Object} entry - Registry entry.
 * @param {Object} ctx
 * @param {RemotePurgeReport} ctx.report - Mutated in place.
 * @param {Set<string>} ctx.claimed - Suffixes a LOCAL atlas claims (the rescue).
 * @param {number} ctx.now - Epoch ms, read once so every entry is judged against one instant.
 * @param {number} [ctx.dropTimeoutMs] - Bound on each database delete.
 * @param {number} ctx.spareGraceMs - How long a mounted namespace may be spared.
 * @returns {Promise<void>}
 */
async function purgeOneRemoteAtlas(entry, { report, claimed, now, dropTimeoutMs, spareGraceMs }) {
    if (claimed.has(entry.dbSuffix)) {
        // A local atlas owns these databases now (the unsynced-work rescue). The data
        // is local by decision, so only the stale remote claim goes.
        await getGlobalStore().removeItem(remoteAtlasRegistryKey(entry.atlasId));
        report.adopted.push(entry.atlasId);
        return;
    }

    // THE LOCK IS ASKED FIRST EVEN WHEN THE DEADLINE HAS PASSED, so `forced` means exactly
    // "a live client had it AND the reprieve ran out". Going straight to the forced path
    // would also report an entry whose holder died long ago as one taken by force, which is
    // a report that reads like a rare event every time an ordinary one happens.
    let result = await destroyRemoteAtlasIfUnmounted(entry, dropTimeoutMs);

    if (result.spared) {
        const overdue = entry.sparedAt > 0 && (now - entry.sparedAt) >= spareGraceMs;
        if (!overdue) {
            await stampSparedAt(entry);
            report.spared.push(entry.atlasId);
            return;
        }
        console.warn(
            `[remote-atlas] atlas ${entry.atlasId} is still mounted somewhere, but its `
            + 'spare deadline expired; destroying its namespace anyway'
        );
        report.forced.push(entry.atlasId);
        result = { spared: false, ...await destroyRemoteAtlas(entry, dropTimeoutMs) };
    }

    (result.hadData ? report.atlases : report.empty).push(entry.atlasId);
    report.cleared.push(...result.cleared);
    report.dropped.push(...result.dropped);
    report.blocked.push(...result.blocked);
}

/**
 * Whether the sweep already DEALT WITH the namespace of one atlas, either by destroying it or by
 * finding it adopted by a local atlas.
 *
 * It exists for one caller, the logged-out boot guard, and it answers a question that decides
 * whether the guard also empties the MOUNTED atlas. Before namespaces there was nothing to ask:
 * server data sat in the unsuffixed databases and the guard emptied them. Now the same marker can
 * mean two very different things, and telling them apart is the difference between finishing the
 * wipe and destroying the user's local slot:
 *
 *   - the atlas OWNED a namespace: this sweep already emptied it (or a local atlas claims it after
 *     a rescue), so there is nothing left to empty and the mounted scope is a LOCAL slot;
 *   - the atlas owned NO namespace (a store written before the wiring, or by a build that never
 *     activated one): its data is in the unsuffixed databases and the guard must still empty them.
 *
 * `spared` COUNTS AS REACHED, and leaving it out would have been a new way to lose data: a spared
 * namespace appears in neither `atlases` nor `adopted`, so the predicate would answer false and
 * the guard would run its second wipe over the legacy bridge, emptying the user's local slot #1
 * at boot, without an error.
 *
 * `empty` COUNTS TOO, and it did not always: the answer is EVERY BRANCH of the sweep, which is
 * the same thing as saying the question is "was this atlas registered", asked of a report that is
 * derived from the registry. The version that left `empty` out came from P3 and cost a data loss
 * of its own, because `empty` mixes nothing of the sort it was meant to catch:
 *
 *   - "never registered" does not appear in the report AT ALL (the report is derived from the
 *     registry), so it already answers false and the second wipe still runs. That is the
 *     pre-namespace case, and it is the one the second wipe exists for;
 *   - "registered and never written" is an atlas that OWNS a namespace, so its data was never in
 *     the unsuffixed databases and the second wipe has nothing to finish there. Answering false
 *     for it aimed the wipe at the user's local slot #1 instead. The window is a real gesture:
 *     `openRemoteAtlas` registers the namespace and marks the origin REMOTE before
 *     `syncEngine.connect`, and a tab closed mid-pull never runs the `catch` that would revert.
 *
 * What P3 actually feared was a sweep FABRICATING ten databases and reporting them destroyed, and
 * that was removed at the source: `clearAtlasDatabases` only reports a database that held data, so
 * no branch of this report can be invented by the act of reading. The remaining split between
 * `atlases` and `empty` is diagnostic, and callers that need "held data" must read `atlases`.
 *
 * Pure — reads only the report it is given, and tolerates one built before these fields existed.
 * @param {RemotePurgeReport|null} report - Report of the sweep that just ran.
 * @param {string|null} atlasId - Atlas named by the store-origin marker.
 * @returns {boolean}
 */
export function purgeReachedAtlas(report, atlasId) {
    if (!report || typeof atlasId !== 'string' || atlasId.length === 0) return false;
    const inList = list => Array.isArray(list) && list.includes(atlasId);

    // THE QUESTION IS "WAS THIS ATLAS REGISTERED", ASKED DIRECTLY. `registered` is captured
    // before the sweep touches anything, so it answers even for an entry whose destruction
    // THREW: that entry lands in `failed` and in no outcome list, and a predicate built by
    // summing outcomes would answer false and send the guard's second wipe over the user's
    // local slot #1. Owning a registry entry is the whole of what the guard needs to know,
    // because it proves the atlas had a namespace of its own and therefore never had data in
    // the unsuffixed databases.
    if (inList(report.registered)) return true;

    // Fallback for a report built before `registered` existed (an older cached report, a test
    // double). Summing every outcome branch is the same question asked indirectly, and it was
    // the previous implementation.
    return inList(report.atlases) || inList(report.empty)
        || inList(report.adopted) || inList(report.spared) || inList(report.forced);
}

/**
 * Destroys ONE remote namespace and forgets it. For the caller that leaves a server atlas
 * while the session stays alive; the logged-out sweep is `purgeAllRemoteAtlases`.
 *
 * It lets go of the mount FIRST when the atlas being left is the one this client has mounted,
 * for the same reason the sweep does: otherwise the caller's own shared lock would refuse the
 * exclusive and the atlas it just left would be spared from its own destruction.
 *
 * @param {string} atlasId - Server atlas id.
 * @param {Object} [options]
 * @param {number} [options.dropTimeoutMs] - Bound on each database delete.
 * @returns {Promise<{ spared: boolean, cleared: string[], dropped: string[], blocked: string[],
 *   hadData: boolean }>} `spared:true` means ANOTHER live client has it mounted and nothing was
 *   touched; the registry entry stays, so the next logged-out sweep collects it.
 */
export async function forgetRemoteAtlas(atlasId, { dropTimeoutMs } = {}) {
    const scope = remoteScope(atlasId);
    await releaseMountLock(scope);

    const entry = { atlasId, dbSuffix: scope.dbSuffix, createdAt: 0, updatedAt: 0, sparedAt: 0 };
    const result = await destroyRemoteAtlasIfUnmounted(entry, dropTimeoutMs);
    if (result.spared) {
        await stampSparedAt(entry);
        return result;
    }

    if (getActiveScope()?.kind === StoreScopeKind.REMOTE
        && getActiveScope()?.dbSuffix === scope.dbSuffix) {
        clearActiveScope();
    }
    return result;
}
