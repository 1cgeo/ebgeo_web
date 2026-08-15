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
 *      (`initLocalAtlases`, whose scope activation is undone on the way out: the boot decides
 *      which atlas is mounted, this step only registers one);
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
 * THIS STEP IS INSTALLATION-LEVEL, AND THAT IS WHY IT BRANCHES ON ITS SCOPE. Registering
 * slot #1 and discarding a REMOTE store happen exactly once, to the pre-namespace databases.
 * Asked to bring a NAMESPACED slot from 2.2 to 2.3 (which `migrateActiveSlot` does), there is
 * nothing structural left to do — the slot already exists, is already in the registry and
 * already owns its namespace — so the step only stamps that slot and returns.
 *
 * IT USED TO STAMP THE MOUNTED SLOT AS A SIDE EFFECT, and that was the worse half of the
 * fixed-name defect: the chain ran against the pre-namespace databases and marked slot #2 as
 * migrated without transforming a byte of it, so the slot looked current and was skipped for
 * good. The stamp of a slot now belongs to the pass that actually migrated it.
 *
 * THE CAP (10 local atlases) CANNOT BE HIT HERE: this step creates an atlas only when the
 * registry is EMPTY, so it can only ever take the count from 0 to 1. A repository that
 * somehow already carries 10 entries gets no new one, no refusal and no error: the step
 * just aligns and stamps.
 */

import {
    ATLAS_RECORD_KEY,
    LEGACY_DB_SUFFIX,
    StoreName,
    activateScope,
    readLocalAtlasRegistry,
    getActiveScope,
    getStoreFor,
    listAtlasStores
} from '../atlas-namespace.js';
import { isLegacyScope, legacyScope } from './migration-scope.js';
import { initLocalAtlases, listLocalAtlases } from '../local-atlas.api.js';
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
    return (await readLocalAtlasRegistry()).length > 0;
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
 * @param {{ kind: string, dbSuffix: string }} [scope] - Target scope. Defaults to the
 *   pre-namespace databases, which is the only scope this step has structural work for.
 * @returns {Promise<{success: boolean}>}
 */
export async function migrateToV2_3(scope = legacyScope()) {
    if (!isLegacyScope(scope)) {
        // A namespaced slot is already registered and already owns its databases: the
        // structural half of this step is spent. Only the version marker is missing.
        console.log(`Migration to v2.3: stamping namespaced slot "${scope.dbSuffix}"`);
        await stampVersion(scope);
        return { success: true };
    }

    console.log('Starting migration to v2.3 (named local atlases)...');

    // WHICH ATLAS THE BOOT MOUNTED IS NOT THIS STEP'S DECISION. `initLocalAtlases` activates a
    // scope as a side effect, and this step calls it with a deliberately fixed LOCAL origin (see
    // below), so on a boot that had already activated something else — an authenticated session
    // whose origin is REMOTE activates that atlas's namespace — running the migration would leave
    // the app writing into the local slot while it believes it is in the server atlas. The scope
    // is therefore restored on the way out: a migration is a repository step, not a router.
    const scopeBefore = getActiveScope();

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

    // Only the scope this step actually worked on is stamped. Stamping the slot the pointer
    // happens to name would declare it migrated by a chain that never opened its databases,
    // which is what made `migrateActiveSlot` unreachable for that slot forever.
    const legacyName = current.dbSuffix === LEGACY_DB_SUFFIX ? current.name : null;
    await stampVersion(legacyScope(), legacyName);

    if (scopeBefore) activateScope(scopeBefore);

    console.log(`Migration to v2.3 complete (atlas "${current.name}")`);
    return { success: true };
}
