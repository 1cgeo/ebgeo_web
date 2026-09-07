// Path: js/store/migration/v2.x-to-v3.0.migration.js

/**
 * @fileoverview Migration from any 2.x to v3.0 - the single local workspace becomes a NAMED
 * local atlas, registered in the global database and owning a namespace.
 *
 * THIS FILE REPLACES the old 2.2-to-2.3 step, and the rename is the point. That step was
 * numbered against a 2.3 that ALSO exists on `main`, meaning something else entirely there (the
 * `coordination_lines` bucket), and it was gated by a literal `'2.3'` that a repository stamped
 * by `main` already satisfied. The step never ran for the users who most needed it. The name of
 * the file now says what the step actually spans: any 2.x, from either line, to 3.0.
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
 * ===========================================================================================
 * THE BRANCH IS DECIDED BY THE GLOBAL REGISTRY, NEVER BY THE NUMBER AND NEVER BY THE CONTENT
 * ===========================================================================================
 * Three inputs arrive at this step and they need three different answers, and the version
 * number separates NONE of them: `main` 2.3 and this line's 2.3 are the same string on disk.
 * Discriminators by CONTENT were considered and refused for the same reason they would look
 * attractive: `coordination_lines` does not separate 2.2 from 2.3 in an atlas with no maps, and
 * `bitmapVersion` does not separate 2.3 from 2.4 in an atlas with no symbol and no measurement.
 * Both answer "old" for an empty atlas, which is the input a fresh install produces.
 *
 * What DOES separate them is a fact about form: is there a local-atlas registry entry whose
 * `dbSuffix` is the empty string?
 *
 *   1. NOT the legacy scope -> a namespaced slot, already registered and already owning its
 *      databases. The structural half is spent; only the stamp is missing. This is the path
 *      `migrateActiveSlot` walks, once per mounted slot.
 *   2. legacy scope, and the registry ALREADY claimed the unsuffixed databases -> an
 *      installation of THIS line since 2026-08-14. Nothing structural, only the stamp.
 *   3. legacy scope, and nobody claimed them -> the databases were written by `main`, at 2.2,
 *      2.3 or 2.4. Adopt them (discarding a REMOTE residue first), discard the inert outbound
 *      queue `main` left behind, and stamp.
 *
 * WHERE THE QUESTION IS ASKED MATTERS AS MUCH AS THE QUESTION. `activateBootAtlasScope` runs
 * `initLocalAtlases` before `initializeRepository`, and its bootstrap writes precisely the entry
 * case 2 looks for, so asked from inside this step the answer would always be "already claimed".
 * The boot therefore takes the reading BEFORE it touches anything and parks it in
 * `boot-legacy-adoption.js`; with no snapshot (a direct call, a script, a test) this step reads
 * the registry itself, which is correct because no boot polluted it.
 *
 * THE ONE CASE THAT MAY NOT ADOPT: a store whose origin marker says REMOTE holds a SERVER
 * atlas, which is ephemeral by contract and must not survive a logout. Adopting it would
 * manufacture a permanent, editable local copy of someone else's atlas, which is exactly
 * what the store-origin marker exists to prevent. So a REMOTE store is first DISCARDED
 * (the same wipe `enforceLocalStoreWhenLoggedOut` performs when a session dies) and marked
 * LOCAL, and the now empty databases are adopted. The session survives: the server is
 * authoritative, the outbound queue is global and untouched, and re-opening the atlas
 * pulls a fresh snapshot, which is what `openRemoteAtlas` does on every open anyway.
 *
 * ===========================================================================================
 * THE OUTBOUND QUEUE `main` LEAVES BEHIND IS DISCARDED, AND ONLY IN CASE 3
 * ===========================================================================================
 * `main` enqueues an operation for every edit even though it has no server to send them to
 * (`services.js` turns operation logging on unconditionally), and those entries carry no atlas
 * address. Measured on a real session of 805 features: 446 entries. Here, an unaddressed entry
 * is routed to "the atlas mounted at the time of the upgrade" - which, for a user who logs in
 * and opens a SERVER atlas, is that server atlas. The whole local drawing history of one user
 * would then be flushed into somebody else's project, and the server's schema accepts it.
 *
 * Discarding is safe in a way that is worth stating: the queue describes work that is ALREADY
 * on disk in the very databases being adopted, and it has never been sent anywhere, because the
 * line that produced it has no backend. Nothing is lost by dropping it, and the count is logged
 * rather than dropped in silence.
 *
 * ===========================================================================================
 * THE NAME OF THE ATLAS IS RECOVERED, NEVER OVERWRITTEN
 * ===========================================================================================
 * There are two homes for an atlas name (the registry entry, which the maps tab reads, and the
 * atlas record inside the slot) and the previous step aligned the RECORD to the REGISTRY. That
 * is the direction in which the name is lost: the registry entry had just been invented by the
 * bootstrap as "Meu Atlas", so aligning to it wrote that over the name the user had. The
 * direction is now reversed. The registry entry is renamed from the record, through
 * `renameLocalAtlas`, which writes both homes; and the boot hands `initLocalAtlases` the
 * record's name up front, so the defect is not recreated on the next installation.
 *
 * IDEMPOTENCE. `initLocalAtlases` bootstraps only on an empty registry, `stampVersion` writes a
 * fixed value, `discardRemoteResidue` runs only for a REMOTE origin, the rename is skipped when
 * the two names already agree, the queue discard finds nothing the second time, and the name
 * repair below finds no placeholder left. Running the step twice changes no byte beyond the
 * stamp it already wrote.
 *
 * NO FEATURE IS TRANSFORMED, on purpose. The `coordination_lines` bucket is guaranteed at READ
 * time (`repository.utils.js`, `local.repository.js`) and a stale symbol bitmap regenerates on
 * load (`layers/bitmap-version.js`), so neither of `main`'s 2.3 and 2.4 transforms has to be
 * replayed here.
 *
 * ===========================================================================================
 * THE ONE FIELD THIS STEP DOES REWRITE: THE PLACEHOLDER MAP NAME
 * ===========================================================================================
 * "This step moves nothing" stays true of every byte the user drew, and this is the single
 * named exception to it, so it is declared here instead of being discovered in the diff.
 *
 * `createMapCompat` on `main` (`src/js/store/repositories/index.js`) filled a MISSING name with
 * the name the user asked for, but `getEmptyMapData()` there already returns the placeholder
 * 'Novo Mapa': the guard never fired, and every map created through that screen went to disk
 * with the right KEY and the wrong FIELD. Measured on the real crossing archive on 2026-09-07:
 * 13 of 14 `ebgeo_maps` records carrying `name: 'Novo Mapa'`, all 14 keys correct.
 *
 * `main` got the same repair in its own boot on 2026-09-07, and that does NOT reach the people
 * this step exists for: whoever leaves a production `main` older than that commit arrives here
 * with the field poisoned and never opens `main` again to have it fixed. Inside this line the
 * field is inert for every reader we know of (a local atlas is keyed by name, and the send
 * reader prefers the KEY), so this is not the repair of a live loss; it removes the input that
 * produced one the moment something preferred the field, which is what the send to the server
 * did until 2026-09-07: 2 maps and 33 features arriving out of 14 and 805.
 *
 * IT RUNS WHERE THE ADOPTION RUNS, and the guard is the branch itself rather than a settings
 * flag: the crossing happens once per installation, and afterwards the scope is stamped 3.0 and
 * this step no longer runs at all. The predicate is the SAME one that decides the legacy queue
 * discard (`owesLegacyAdoption`), and for the same reason: `atlas.html` can claim the unsuffixed
 * databases before the map ever boots, so a repair keyed on the branch NAME would skip the very
 * population it was written for (measured in a real browser: 5 of 8 repetitions reached the
 * `ja-adotado` branch over databases that had come from `main`).
 *
 * THE GUARDS ARE WHAT MAKE IT SAFE over the user's own records, and each one names a case: only
 * when the field IS the placeholder, so a name the user chose is never touched; only when the
 * key DIFFERS from it, so a map really called 'Novo Mapa' is left alone; only when the key is
 * not a generated id, because there the key is not a name and rewriting would christen a map
 * with a UUID; written straight to the store rather than through `saveMap`, so sync metadata is
 * untouched and no phantom operation is enqueued; and inside its own try/catch, because a
 * cosmetic repair must never be the reason a migration fails.
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
import { isValidId } from '../../utilities/uuid.js';
import { initLocalAtlases, listLocalAtlases, renameLocalAtlas } from '../local-atlas.api.js';
import { StoreOriginKind, loadStoreOrigin, markStoreLocal } from '../store-origin.js';
import {
    MigrationBranch,
    legacyObservation,
    nameOfAdoptedAtlas,
    recordMigrationOutcome
} from './boot-legacy-adoption.js';

/**
 * The version THIS step reaches. Literal on purpose: stamping `ATLAS_SCHEMA_VERSION` is the
 * defect documented in `v1-to-v2.migration.js`, where a step declares the CHAIN's final
 * version and an interrupted chain is marked complete forever.
 */
const TARGET_VERSION = '3.0';

/** Key of the schema marker inside a scope's settings database. */
const SCHEMA_VERSION_KEY = 'schemaVersion';

/**
 * The name a brand-new map record carries on `main`.
 *
 * It comes from `getEmptyMapData()` in `main`'s `repositories/local.repository.js`, which is not
 * a function this line can import: the literal is the contract with the OTHER product, so it is
 * written out and explained rather than derived from anything here.
 */
const PLACEHOLDER_MAP_NAME = 'Novo Mapa';

/**
 * Empties the pre-namespace databases and marks the store LOCAL. Reached only when the
 * origin marker says the data belongs to a server atlas.
 * @returns {Promise<void>}
 */
async function discardRemoteResidue() {
    console.log('Migration 3.0: store holds a REMOTE atlas, discarding it before adoption');

    // `allSettled` E NÃO um laço com `await` dentro, pela mesma razão que `clearLegacyStores` e
    // `clearAllAtlasStores` a dão: com o laço, a primeira rejeição interrompe a varredura e os
    // bancos ainda não visitados ficam INTACTOS, ou seja, parte do atlas de servidor sobrevive a
    // um descarte que existe para não deixar byte nenhum. Toda limpeza é aguardada, e só então a
    // primeira falha é relançada, para que o chamador continue vendo como falha o que falhou.
    const resultados = await Promise.allSettled(
        listAtlasStores(legacyScope()).map(({ store }) => store.clear())
    );
    const falha = resultados.find(resultado => resultado.status === 'rejected');
    if (falha) throw falha.reason;

    await markStoreLocal();
}

/**
 * Empties the pre-namespace outbound queue, which `main` filled and never sent.
 *
 * It reads the keys first and reports the count, because a `clear()` alone cannot say whether
 * it discarded 446 entries or zero, and "the step ran" is not the same fact as "the step had
 * something to do".
 *
 * @returns {Promise<number>} How many entries were discarded.
 */
async function discardLegacyOperationQueue() {
    const queue = getStoreFor(StoreName.OPERATION_QUEUE, legacyScope());
    const keys = await queue.keys();
    if (keys.length === 0) return 0;
    await queue.clear();
    console.log(`Migration 3.0: discarded ${keys.length} inert operation(s) left by the previous line`);
    return keys.length;
}

/**
 * Rewrites `name` from the storage KEY on the map records that came from `main` holding the
 * placeholder, and reports how many.
 *
 * The rationale, the population it serves and each guard are in the fileoverview, under "THE ONE
 * FIELD THIS STEP DOES REWRITE". Two properties are worth reading off the code itself:
 *
 * - IDEMPOTENT BY CONSTRUCTION, with no flag to keep: after a record is repaired its field is
 *   the key, so the second pass no longer matches the placeholder. Nothing has to remember that
 *   this ran;
 * - it writes through the scope's OWN store (`getStoreFor(StoreName.MAPS, scope)`) and never
 *   through the repository, so it cannot touch `sync` and cannot enqueue an operation. Thirteen
 *   phantom operations is the difference between a repair and thirteen edits.
 *
 * @param {{ kind: string, dbSuffix: string }} scope - Scope whose maps to repair.
 * @returns {Promise<number>} How many records were rewritten.
 */
async function repairPlaceholderMapNames(scope) {
    try {
        const maps = getStoreFor(StoreName.MAPS, scope);
        let repaired = 0;

        for (const key of await maps.keys()) {
            // The key is not a name here: a synchronised atlas keys its maps by generated id,
            // and rewriting would christen the map with its own UUID.
            if (key === PLACEHOLDER_MAP_NAME || isValidId(key)) continue;

            const record = await maps.getItem(key);
            if (!record || record.name !== PLACEHOLDER_MAP_NAME) continue;

            await maps.setItem(key, { ...record, name: key });
            repaired += 1;
        }

        if (repaired > 0) {
            console.log(`Migration 3.0: repaired the placeholder map name on ${repaired} record(s)`);
        }
        return repaired;
    } catch (error) {
        // A repair is never worth a failed migration: the field it fixes is inert for every
        // reader of this line, and the adoption around it is not.
        console.warn('Migration 3.0: could not repair the placeholder map names:', error);
        return 0;
    }
}

/**
 * @returns {Promise<boolean>} True when a registry entry already claims the unsuffixed
 *   databases. Read LIVE, so only meaningful before the boot's bootstrap: see
 *   `boot-legacy-adoption.js`.
 */
async function legacyIsClaimedOnDisk() {
    return (await readLocalAtlasRegistry()).some(entry => entry.dbSuffix === LEGACY_DB_SUFFIX);
}

/**
 * Writes the schema marker of one scope, in BOTH homes the detector reads.
 *
 * IT NO LONGER TOUCHES `name`, and that is the fix for a measured loss. It used to align the
 * atlas record to the registry entry, and on the boot path the registry entry was the one the
 * bootstrap had just invented ("Meu Atlas"), so the alignment overwrote the only copy of the
 * user's own name. Everything in the record is preserved verbatim except the version.
 *
 * @param {{ kind: string, dbSuffix: string }} scope - Scope to stamp.
 * @returns {Promise<void>}
 */
async function stampVersion(scope) {
    await getStoreFor(StoreName.SETTINGS, scope).setItem(SCHEMA_VERSION_KEY, TARGET_VERSION);

    const atlasStore = getStoreFor(StoreName.ATLAS, scope);
    const atlas = await atlasStore.getItem(ATLAS_RECORD_KEY);
    if (!atlas) {
        // A repository with no atlas record is one that never had data; `ensureAtlas`
        // creates it at the current version on first use.
        return;
    }
    await atlasStore.setItem(ATLAS_RECORD_KEY, { ...atlas, schemaVersion: TARGET_VERSION });
}

/**
 * Gives the registry entry of slot #1 the name the atlas record carries, when they disagree.
 *
 * This is the repair for the installations that ALREADY crossed with the previous build: their
 * registry entry says "Meu Atlas" while the record still holds the real name. It is a no-op
 * once the boot passes `bootstrapName`, which is the point (a repair that has to run every boot
 * is a defect being recreated every boot).
 *
 * `renameLocalAtlas` writes the registry entry AND mirrors it into the record, so passing the
 * RECORD's own name leaves the record untouched and moves only the entry.
 *
 * @param {{id: string, name: string, dbSuffix: string}|null} current - Registry entry of the
 *   slot the step adopted.
 * @returns {Promise<string|null>} The recovered name, or null when nothing had to move.
 */
async function recoverAtlasName(current) {
    if (!current || current.dbSuffix !== LEGACY_DB_SUFFIX) return null;

    const recordName = await nameOfAdoptedAtlas();
    if (!recordName || recordName === current.name) return null;

    const result = await renameLocalAtlas(current.id, recordName);
    if (!result.ok) {
        console.warn(`Migration 3.0: could not restore the atlas name "${recordName}": ${result.error}`);
        return null;
    }
    console.log(`Migration 3.0: restored the atlas name "${result.atlas.name}"`);
    return result.atlas.name;
}

/**
 * Main migration function: any 2.x to 3.0.
 * @param {{ kind: string, dbSuffix: string }} [scope] - Target scope. Defaults to the
 *   pre-namespace databases, which is the only scope this step has structural work for.
 * @returns {Promise<{success: boolean, branch: string}>}
 */
export async function migrateToV3_0(scope = legacyScope()) {
    if (!isLegacyScope(scope)) {
        // A namespaced slot is already registered and already owns its databases: the
        // structural half of this step is spent. Only the version marker is missing.
        console.log(`Migration to v3.0: stamping namespaced slot "${scope.dbSuffix}"`);
        await stampVersion(scope);
        recordMigrationOutcome({ branch: MigrationBranch.NAMESPACED_SLOT });
        return { success: true, branch: MigrationBranch.NAMESPACED_SLOT };
    }

    // THE READING THE BOOT TOOK WINS, and it has to: by the time this runs the boot's bootstrap
    // may have written the very entry the live read looks for. Falling back to the live read is
    // right for a caller with no boot behind it.
    const observed = legacyObservation();
    const legacyClaimed = observed ? observed.legacyClaimed : await legacyIsClaimedOnDisk();
    const branch = legacyClaimed ? MigrationBranch.ALREADY_ADOPTED : MigrationBranch.ADOPTED_LEGACY;

    // WHICH ATLAS THE BOOT MOUNTED IS NOT THIS STEP'S DECISION. `initLocalAtlases` activates a
    // scope as a side effect, and this step calls it with a deliberately fixed LOCAL origin (see
    // below), so on a boot that had already activated something else - an authenticated session
    // whose origin is REMOTE activates that atlas's namespace - running the migration would leave
    // the app writing into the local slot while it believes it is in the server atlas. The scope
    // is therefore restored on the way out: a migration is a repository step, not a router.
    const scopeBefore = getActiveScope();

    // WHAT THE TWO LEGACY BRANCHES SHARE, and why the shared half is not "structural work done
    // twice": with a non-empty registry `initLocalAtlases` bootstraps nothing, it only loads the
    // registry mirror and points the store at a slot. Both branches need that mirror, because
    // both may have to repair the NAME of slot #1, and an installation that already crossed with
    // the previous build is exactly the one whose registry entry says "Meu Atlas" while its
    // record still holds the real name.
    let discardedRemote = false;
    if (legacyClaimed) {
        console.log('Migration to v3.0: the unsuffixed databases are already a registered slot');
    } else {
        console.log('Starting migration to v3.0 (adopting the pre-namespace databases)...');
        const origin = await loadStoreOrigin();
        discardedRemote = origin.kind === StoreOriginKind.REMOTE;
        if (discardedRemote) {
            await discardRemoteResidue();
        }
    }

    const hadRegistry = observed ? observed.hadRegistry : (await readLocalAtlasRegistry()).length > 0;

    // Explicit inputs, never inferred: after the discard above the store is LOCAL by
    // construction, and a bootstrap here must adopt the unsuffixed databases (that is the
    // zero-copy move). Passing the origin also keeps this step independent of whatever the
    // boot happened to activate before it.
    const { current } = await initLocalAtlases({
        origin: { kind: StoreOriginKind.LOCAL, atlasId: null },
        isAuthenticated: false,
        adoptLegacyDatabases: true,
        bootstrapName: observed ? observed.bootstrapName : await nameOfAdoptedAtlas()
    });

    const legacyEntry = listLocalAtlases().find(e => e.dbSuffix === LEGACY_DB_SUFFIX) ?? null;
    if (hadRegistry && !legacyEntry) {
        // Only reachable if a registry was bootstrapped on fresh databases while the store
        // held remote data, which the discard above already emptied. Say so out loud
        // instead of adopting: inventing an extra slot here would spend one of the ten on
        // a name the user never chose.
        console.warn('Migration 3.0: the pre-namespace databases are claimed by no local atlas');
    }

    // ONLY THE BRANCH THAT COMES FROM THE OTHER LINE DISCARDS THE QUEUE. An installation of this
    // line may hold pending work that still has a server to reach; one arriving from a line with
    // no backend cannot.
    //
    // AND "CLAIMED" IS NOT THE SAME FACT AS "MIGRATED", which is what `legacyClaimed` alone was
    // being read as. `atlas.html` calls `initLocalAtlases` and runs NO migration, by design (it
    // boots without the store), so a user of the other line who opens "Seus atlas" before the map
    // arrives here with the unsuffixed databases already claimed and the step never run: the
    // branch answers "already adopted" and the 446 inert operations the other line left behind
    // stay on disk. The bootstrap now records WHO claimed (`adoptedLegacy`), and a claim made by
    // an adopting bootstrap over databases this step has not stamped yet still owes the discard.
    const stampedAt = await getStoreFor(StoreName.SETTINGS, legacyScope()).getItem(SCHEMA_VERSION_KEY);
    const claimedButNeverStepped = legacyEntry?.adoptedLegacy === true && stampedAt !== TARGET_VERSION;

    // "THESE DATABASES CAME FROM THE OTHER LINE AND THIS STEP STILL OWES THEM THE ADOPTION" is
    // one fact with two consequences, so it is named once instead of being spelled twice: the
    // queue discard and the placeholder-name repair both hang off it.
    const owesLegacyAdoption = !legacyClaimed || claimedButNeverStepped;

    const discardedOperations = owesLegacyAdoption ? await discardLegacyOperationQueue() : 0;

    // BEFORE THE STAMP, and only over the scope this step adopted: the stamp is what closes the
    // branch, so a repair placed after it would be paid on a boot that will never run again.
    if (owesLegacyAdoption) await repairPlaceholderMapNames(legacyScope());

    const recoveredName = await recoverAtlasName(legacyEntry ?? current);

    // Only the scope this step actually worked on is stamped. Stamping the slot the pointer
    // happens to name would declare it migrated by a chain that never opened its databases,
    // which is what made `migrateActiveSlot` unreachable for that slot forever.
    await stampVersion(legacyScope());

    if (scopeBefore) activateScope(scopeBefore);

    recordMigrationOutcome({ branch, discardedOperations, discardedRemote, recoveredName });
    console.log(`Migration to v3.0 complete (atlas "${recoveredName ?? legacyEntry?.name ?? current.name}")`);
    return { success: true, branch };
}
