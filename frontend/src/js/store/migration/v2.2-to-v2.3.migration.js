// Path: js/store/migration/v2.2-to-v2.3.migration.js

/**
 * @fileoverview Migration from v2.2 to v2.3 — the single local workspace becomes a NAMED
 * local atlas ("Meu Atlas"), registered in the global database and owning a namespace.
 *
 * WHAT THIS STEP MOVES: nothing. That is the whole design, not a shortcut.
 *
 * The namespace factory gives the first local slot the EMPTY suffix (`LEGACY_DB_SUFFIX`),
 * so the databases the app has always used (`ebgeo_maps`, `ebgeo_layers`, ...) ARE the
 * databases of slot #1. Adopting them is therefore equivalent to copying every byte into
 * `ebgeo_maps__<id>` and deleting the originals, minus the risk: IndexedDB has NO
 * transaction across databases, so a copy-then-clear of ten databases (one of them full of
 * image blobs) loses data if the tab closes mid-flight, and only a copy-verify-delete PER
 * KEY would be resumable. A migration that copies nothing cannot lose anything, and it
 * cannot half-finish.
 *
 * WHAT IT ACTUALLY WRITES, in order, with the version stamp LAST:
 *   1. discards the store contents when they are REMOTE (see below);
 *   2. the local-atlas registry and the current-atlas pointer, in `ebgeo_global`
 *      (`initLocalAtlases`, which also activates the slot's scope);
 *   3. the name of the slot's own atlas record, aligned with the registry;
 *   4. `schemaVersion` = 2.3 on the settings store and on the atlas record.
 * Crashing anywhere before step 4 leaves `detectMigrationNeeded` reporting `needed: true`,
 * so the next boot runs this again; every step is idempotent (a registry that already has
 * entries is never bootstrapped a second time).
 *
 * THE ONE CASE THAT MAY NOT ADOPT: a store whose origin marker says REMOTE holds a SERVER
 * atlas, which is ephemeral by contract and must not survive a logout. Adopting it would
 * manufacture a permanent, editable local copy of someone else's atlas, which is exactly
 * what the store-origin marker exists to prevent. So a REMOTE store is first DISCARDED
 * (the same wipe `enforceLocalStoreWhenLoggedOut` performs when a session dies) and marked
 * LOCAL, and the now empty databases are adopted. The session survives: the server is
 * authoritative, the outbound queue is global and untouched, and re-opening the atlas
 * pulls a fresh snapshot, which is what `openRemoteAtlas` does on every open anyway.
 * Note this branch is only reachable for an AUTHENTICATED user: an expired session is
 * discarded by the boot guard before the repository is initialized.
 *
 * WHY THE STAMP GOES TO THE LEGACY SCOPE, ALWAYS: `detectMigrationNeeded` reads
 * `ebgeo_app_settings` and `ebgeo_atlas` by FIXED name (as do the three earlier steps of
 * the chain, which stay frozen on those names). Stamping only the active slot would leave
 * the fixed-name marker at 2.2 forever, and the whole chain — including v1→v2, which
 * CREATES an atlas record — would re-run against those databases on every single boot.
 *
 * THE CAP (10 local atlases) CANNOT BE HIT HERE: this step creates an atlas only when the
 * registry is EMPTY, so it can only ever take the count from 0 to 1. A repository that
 * somehow already carries 10 entries gets no new one, no refusal and no error: the step
 * just aligns and stamps.
 */

import {
    ATLAS_RECORD_KEY,
    GlobalKey,
    LEGACY_DB_SUFFIX,
    StoreName,
    getGlobalStore,
    getStoreFor,
    listAtlasStores,
    localScope
} from '../atlas-namespace.js';
import {
    initLocalAtlases,
    listLocalAtlases,
    scopeOfLocalAtlas
} from '../local-atlas.api.js';
import { StoreOriginKind, loadStoreOrigin, markStoreLocal } from '../store-origin.js';

/**
 * The version THIS step reaches. Literal on purpose: stamping `ATLAS_SCHEMA_VERSION` is the
 * defect documented in `v1-to-v2.migration.js`, where a step declares the CHAIN's final
 * version and an interrupted chain is marked complete forever.
 */
const TARGET_VERSION = '2.3';

/** Key of the schema marker inside a scope's settings database. */
const SCHEMA_VERSION_KEY = 'schemaVersion';

/**
 * Diagnostic id of the scope that resolves to the PRE-NAMESPACE (unsuffixed) databases. It
 * never reaches a database name: the empty `LEGACY_DB_SUFFIX` does.
 */
const LEGACY_SCOPE_ID = 'legacy-workspace';

/**
 * @returns {{ kind: string, atlasId: string, dbSuffix: string }} Scope of the unsuffixed
 *   databases, which are both the pre-namespace layout and local slot #1.
 */
function legacyScope() {
    return localScope(LEGACY_SCOPE_ID, LEGACY_DB_SUFFIX);
}

/**
 * Empties the pre-namespace databases and marks the store LOCAL. Reached only when the
 * origin marker says the data belongs to a server atlas.
 * @returns {Promise<void>}
 */
async function discardRemoteResidue() {
    console.log('Migration 2.3: store holds a REMOTE atlas — discarding it before adoption');
    for (const { store } of listAtlasStores(legacyScope())) {
        await store.clear();
    }
    await markStoreLocal();
}

/**
 * Name the registered atlas takes.
 *
 * The owner's decision is that today's workspace becomes an atlas called "Meu Atlas", and
 * that is what a repository gets: every local atlas record in existence carries that name
 * already (`createAtlas`'s default, and what `v1-to-v2` writes). It is read from the record
 * instead of hard-coded so the exceptions are not relabelled in silence — an atlas record
 * can arrive carrying a server atlas's name, and a rename that the user never asked for
 * would show up in the top bar, in a phase whose whole constraint is "no visible change".
 *
 * @returns {Promise<string|undefined>} Name to register, or undefined for the default.
 */
async function nameOfAdoptedAtlas() {
    const atlas = await getStoreFor(StoreName.ATLAS, legacyScope()).getItem(ATLAS_RECORD_KEY);
    const name = typeof atlas?.name === 'string' ? atlas.name.trim() : '';
    return name.length > 0 ? name : undefined;
}

/**
 * @returns {Promise<boolean>} True when a local-atlas registry with at least one entry
 *   already exists, i.e. this installation already claimed its workspace.
 */
async function hasRegistryEntries() {
    const stored = await getGlobalStore().getItem(GlobalKey.LOCAL_ATLASES);
    return Array.isArray(stored?.atlases) && stored.atlases.length > 0;
}

/**
 * Writes the schema marker of one scope, and optionally aligns the atlas record's name.
 *
 * The registry is the source of truth for an atlas NAME, so the record is aligned to it
 * rather than the other way round: a record still calling itself something else would be a
 * name the user sees in one place and not in another, with nothing to reconcile them
 * (renaming a local atlas does not exist yet). Everything else in the record — the id, the
 * `mapOrder`, `lastActiveMapId`, `settings`, `sync` — is preserved verbatim.
 *
 * @param {{ kind: string, dbSuffix: string }} scope - Scope to stamp.
 * @param {string|null} [name=null] - Registry name to align the atlas record with.
 * @returns {Promise<void>}
 */
async function stampVersion(scope, name = null) {
    await getStoreFor(StoreName.SETTINGS, scope).setItem(SCHEMA_VERSION_KEY, TARGET_VERSION);

    const atlasStore = getStoreFor(StoreName.ATLAS, scope);
    const atlas = await atlasStore.getItem(ATLAS_RECORD_KEY);
    if (!atlas) {
        // A repository with no atlas record is one that never had data; `ensureAtlas`
        // creates it at the current version on first use.
        return;
    }
    await atlasStore.setItem(ATLAS_RECORD_KEY, {
        ...atlas,
        ...(name ? { name } : {}),
        schemaVersion: TARGET_VERSION
    });
}

/**
 * Main migration function: v2.2 to v2.3.
 * @returns {Promise<{success: boolean}>}
 */
export async function migrateToV2_3() {
    console.log('Starting migration to v2.3 (named local atlases)...');

    const origin = await loadStoreOrigin();
    if (origin.kind === StoreOriginKind.REMOTE) {
        await discardRemoteResidue();
    }

    const hadRegistry = await hasRegistryEntries();

    // Explicit inputs, never inferred: after the discard above the store is LOCAL by
    // construction, and a bootstrap here must adopt the unsuffixed databases (that is the
    // zero-copy move). Passing the origin also keeps this step independent of whatever the
    // boot happened to activate before it.
    const { current } = await initLocalAtlases({
        origin: { kind: StoreOriginKind.LOCAL, atlasId: null },
        isAuthenticated: false,
        adoptLegacyDatabases: true,
        bootstrapName: await nameOfAdoptedAtlas()
    });

    const legacyIsClaimed = listLocalAtlases().some(e => e.dbSuffix === LEGACY_DB_SUFFIX);
    if (hadRegistry && !legacyIsClaimed) {
        // Only reachable if a registry was bootstrapped on fresh databases while the store
        // held remote data, which the discard above already emptied. Say so out loud
        // instead of adopting: inventing an extra slot here would spend one of the ten on
        // a name the user never chose.
        console.warn('Migration 2.3: the pre-namespace databases are claimed by no local atlas');
    }

    // The fixed-name marker is what `detectMigrationNeeded` (and the three frozen earlier
    // steps) read, so it is stamped whether or not it is also the active slot.
    const legacyName = current.dbSuffix === LEGACY_DB_SUFFIX ? current.name : null;
    await stampVersion(legacyScope(), legacyName);
    if (current.dbSuffix !== LEGACY_DB_SUFFIX) {
        await stampVersion(scopeOfLocalAtlas(current), current.name);
    }

    console.log(`Migration to v2.3 complete (atlas "${current.name}")`);
    return { success: true };
}
