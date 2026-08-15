// Path: tests/integration/migracao-22-para-23-fixture-real.test.js

/**
 * @fileoverview Does a PRODUCTION user survive the upgrade?
 *
 * Every other test of this migration builds its own idea of what a 2.2 repository looks
 * like, which means it verifies the migration against the test author's model of the data.
 * This one seeds from `.ebgeo` archives the `main` app actually produced (11 maps, 262
 * features, 5 image blobs, 2 briefings, 2 custom icons), runs the REAL boot sequence, and
 * asserts by ABSOLUTE database name.
 *
 * THE BOOT UNDER TEST is the migration-carrying prefix of `initializeWithLastActiveMap`
 * (`src/js/store/store.js`), in its real order and with the real modules:
 *
 *     loadStoreOrigin()  ->  initLocalAtlases({ origin, isAuthenticated })  ->  initializeRepository()
 *
 * What is deliberately NOT in it: `enforceLocalStoreWhenLoggedOut` (which needs
 * `sessionContext` and is the LOGGED-OUT purge, not the migration) and everything after
 * `initializeRepository` (mapManager, the event bus, the layer caches), none of which
 * touches storage shape.
 *
 * WHY THE ORDER MATTERS AND IS NOT AN IMPLEMENTATION DETAIL: `initLocalAtlases` bootstraps
 * the local registry BEFORE `initializeRepository` ever reaches `migrateToV2_3`, so by the
 * time the migration step runs, the adoption it describes has already happened. A test that
 * called `safelyMigrate()` on its own would exercise a path the app never takes.
 *
 * READ BACK TWICE, ON PURPOSE. Every survival count is taken from the raw databases (by
 * absolute name, through `idb-helpers`) AND from the real `localRepository`. The seeder in
 * `tests/helpers/ebgeo-fixture.js` mirrors a key layout by hand; if that layout were wrong,
 * the raw read would be full while the repository read came back empty, and the pair would
 * disagree instead of agreeing on a fiction.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE FIXTURE IS, STATED HONESTLY (an earlier version of this header was wrong)
 * ---------------------------------------------------------------------------
 * The archive is NOT a dump of `ebgeo_maps`. `exportProject` REBUILDS each map payload
 * from separate accessors and hardcodes `hillshadeEnabled` / `analysisLayers`, so what is
 * seeded here is a faithful replay of the EXPORT, not of every field a user's disk carries.
 * The full list of what the exporter invents, omits or moves is in the fileoverview of
 * `tests/helpers/ebgeo-fixture.js`; read it before concluding that a green here says
 * anything about a field the archive does not carry.
 *
 * THE `sizeCreatedAtZoom` OBSERVABLE, AND ITS ONE DEPENDENCY. The last describe uses the
 * absence of `sizeCreatedAtZoom` on the 168 point features as the mark that the v2.0→v2.1
 * backfill has NOT run on a slot. That absence is a property of how the fixtures were
 * GENERATED, not of the point tool: `main`'s `add_point_control.js` writes
 * `sizeCreatedAtZoom: currentZoom` on every point it creates, while the generator
 * (`_ebgeo_dados_teste/_geradores/_gera-fixtures.mjs`) builds features through
 * `store.addFeature` with hand-written GeoJSON and therefore bypasses it. That is
 * convenient here and it is written down in `tests/fixtures/ebgeo-2.2/README.md` so a
 * regeneration does not silently redefine what the test measures. It cannot silently break
 * either: the positive control `expect(before.withProp).toBe(0)` over a non-zero total goes
 * RED, loudly, if a future fixture arrives with the property already present.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    countKeys,
    databaseExists,
    databaseState,
    listDatabases,
    readDatabase,
    readKey,
    resetIndexedDB,
    seedDatabase
} from '../helpers/idb-helpers.js';
import {
    countFixture,
    IMAGE_VALUE_FORM,
    legacyDbNames,
    loadEbgeoFixture,
    seedLegacyWorkspace
} from '../helpers/ebgeo-fixture.js';
import { ATLAS_SCHEMA_VERSION } from '@store/atlas/atlas.entity.js';

/**
 * The numbers the fixture README declares. Written out instead of derived so a fixture that
 * silently changes is caught here rather than quietly redefining what "survived" means.
 * `countFixture()` re-derives them from the archive and the two are compared first.
 */
const DECLARED = Object.freeze({
    completo: Object.freeze({
        schemaVersion: '2.2',
        maps: 11,
        features: 262,
        layers: 17,
        groups: 2,
        briefings: 2,
        slides: 5,
        customIcons: 2,
        images: 5
    }),
    minimo: Object.freeze({
        schemaVersion: '2.2',
        maps: 1,
        features: 1,
        layers: 1,
        groups: 0,
        briefings: 0,
        slides: 0,
        customIcons: 0,
        images: 0
    })
});

/** Ids fixed so the absolute database names of slot #2 are known to the assertions. */
const SLOT_TWO_ID = 'aaaaaaaa-1111-4222-8333-444444444444';
const REMOTE_ATLAS_ID = 'bbbbbbbb-2222-4333-8444-555555555555';

/**
 * Absolute database names of one scope, for every per-atlas store, keyed by `StoreName`
 * value. Built with the app's own `resolveDbName`, never by string concatenation here.
 * @param {Object} ns - The freshly imported `atlas-namespace.js` module.
 * @param {{ kind: string, atlasId: string, dbSuffix: string }} scope
 * @returns {Object<string, string>}
 */
function dbNamesOf(ns, scope) {
    const names = {};
    for (const id of Object.values(ns.StoreName)) {
        if (id === ns.StoreName.GLOBAL || id === ns.StoreName.OPERATION_QUEUE) continue;
        names[id] = ns.resolveDbName(id, scope);
    }
    return names;
}

/**
 * The absolute names of the LEGACY (unsuffixed) scope, asserted to be the unsuffixed ones.
 *
 * Every scenario below calls this instead of building names inline, so the premise of each
 * one ("these are the pre-namespace databases") is CHECKED in each one. The scenario that
 * lacked this check went red only through its result assertion when another agent rewrote
 * `atlas-namespace.js` mid-run, with nothing saying the instrument had moved.
 * @param {Object} ns - Freshly imported `atlas-namespace.js`.
 * @returns {Object<string, string>}
 */
function legacyNamesOf(ns) {
    const names = dbNamesOf(ns, ns.localScope('legacy-workspace', ns.LEGACY_DB_SUFFIX));
    expect(names.maps).toBe('ebgeo_maps');
    expect(names.settings).toBe('ebgeo_app_settings');
    expect(names.atlas).toBe('ebgeo_atlas');
    return names;
}

/**
 * The absolute names of a namespaced local slot, asserted to carry the suffix.
 * @param {Object} ns - Freshly imported `atlas-namespace.js`.
 * @param {string} slotId - Slot id, used as its own `dbSuffix`.
 * @returns {Object<string, string>}
 */
function slotNamesOf(ns, slotId) {
    const names = dbNamesOf(ns, ns.localScope(slotId, slotId));
    expect(names.settings).toBe(`ebgeo_app_settings${ns.NAMESPACE_SEPARATOR}${slotId}`);
    expect(names.maps).toBe(`ebgeo_maps${ns.NAMESPACE_SEPARATOR}${slotId}`);
    return names;
}

/**
 * Runs the migration-carrying prefix of the real boot, with freshly imported modules.
 *
 * The dynamic imports are not decoration: `atlas-namespace.js` holds the active scope and
 * the instance cache, `local-atlas.api.js` holds the registry mirror and `store-origin.js`
 * holds the origin mirror, all as module state. Reusing them across boots would let one
 * test's memory answer another test's question.
 *
 * `migrationRuns` counts how many times `safelyMigrate` DECIDED TO MIGRATE, and
 * `migrationSkips` how many times it was called and declined. Final state alone cannot
 * tell "it did not re-run" from "it re-ran harmlessly", which is what the idempotency case
 * needs and what its previous version could not say.
 *
 * @param {Object} [options]
 * @param {boolean} [options.isAuthenticated=false] - Whether a session is live.
 * @returns {Promise<{ activeMap: string, ns: Object, repo: Object,
 *   migrationRuns: number, migrationSkips: number }>}
 */
async function runBoot({ isAuthenticated = false } = {}) {
    const origin = await import('@store/store-origin.js');
    const localAtlas = await import('@store/local-atlas.api.js');
    const repository = await import('@store/repository.js');
    const ns = await import('@store/atlas-namespace.js');
    const { localRepository } = await import('@store/repositories/local.repository.js');

    const lines = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
        if (typeof args[0] === 'string') lines.push(args[0]);
    });

    let activeMap;
    try {
        await origin.loadStoreOrigin();
        await localAtlas.initLocalAtlases({
            origin: origin.getStoreOriginSync(),
            isAuthenticated
        });
        activeMap = await repository.initializeRepository();
    } finally {
        logSpy.mockRestore();
    }

    return {
        activeMap,
        ns,
        repo: localRepository,
        migrationRuns: lines.filter(l => l.startsWith('Migration needed:')).length,
        migrationSkips: lines.filter(l => l === 'No migration needed').length
    };
}

/**
 * Counts what actually reached the databases, read RAW by absolute name.
 * @param {Object<string, string>} names - Absolute names from `dbNamesOf`.
 * @returns {Promise<Object>} The same shape `countFixture()` produces.
 */
async function countRaw(names) {
    const maps = (await readDatabase(names.maps)) ?? {};
    let features = 0;
    for (const record of Object.values(maps)) {
        for (const list of Object.values(record.features ?? {})) {
            if (Array.isArray(list)) features += list.length;
        }
    }

    const layersDb = (await readDatabase(names.layers)) ?? {};
    let layers = 0;
    for (const [key, list] of Object.entries(layersDb)) {
        if (key.startsWith('layers_') && Array.isArray(list)) layers += list.length;
    }

    const groupsDb = (await readDatabase(names.groups)) ?? {};
    let groups = 0;
    for (const byId of Object.values(groupsDb)) {
        groups += Object.keys(byId ?? {}).length;
    }

    const briefingsDb = (await readDatabase(names.briefings)) ?? {};
    const briefings = Object.values(briefingsDb);

    const settings = (await readDatabase(names.settings)) ?? {};

    return {
        maps: Object.keys(maps).length,
        features,
        layers,
        groups,
        briefings: briefings.length,
        slides: briefings.reduce((sum, b) => sum + (b.slides?.length ?? 0), 0),
        customIcons: (settings.custom_icons ?? []).length,
        images: (await countKeys(names.images)) ?? 0
    };
}

/**
 * Counts the same things through the REAL repository, i.e. the code the app runs.
 * @param {Object} repo - `localRepository`.
 * @returns {Promise<Object>}
 */
async function countThroughRepository(repo) {
    const maps = await repo.getAllMaps();
    let features = 0;
    let layers = 0;
    let groups = 0;
    for (const [name, record] of maps) {
        for (const list of Object.values(record.features ?? {})) {
            if (Array.isArray(list)) features += list.length;
        }
        layers += (await repo.getLayers(name)).length;
        groups += Object.keys(await repo.getGroups(name)).length;
    }
    const briefings = await repo.getAllBriefings();
    return {
        maps: maps.size,
        features,
        layers,
        groups,
        briefings: briefings.length,
        slides: briefings.reduce((sum, b) => sum + (b.slides?.length ?? 0), 0),
        customIcons: ((await repo.getSetting('custom_icons')) ?? []).length
    };
}

/**
 * @param {Object} record - A stored map record.
 * @returns {number} Features in it, across every bucket.
 */
function featuresOf(record) {
    let n = 0;
    for (const list of Object.values(record?.features ?? {})) {
        if (Array.isArray(list)) n += list.length;
    }
    return n;
}

beforeEach(async () => {
    vi.resetModules();
    await resetIndexedDB();
});

afterEach(async () => {
    vi.restoreAllMocks();
    await resetIndexedDB();
});


/**
 * O registro local montado das chaves `local_atlas:<id>` (E4: uma chave por slot).
 * @param {object} ns - O módulo `atlas-namespace.js` já carregado.
 * @returns {Promise<{atlases: Array<object>}|null>}
 */
async function lerRegistroLocalFixture(ns) {
    const store = ns.getGlobalStore();
    const atlases = [];
    for (const k of await store.keys()) {
        if (!ns.isLocalAtlasRegistryKey(k)) continue;
        atlases.push({ ...(await store.getItem(k)), id: ns.atlasIdFromLocalRegistryKey(k) });
    }
    atlases.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    return atlases.length > 0 ? { atlases } : null;
}

describe('migração 2.2 → 2.3 com fixture real do main', () => {
    it('a fixture completa declara exatamente o que o README diz', async () => {
        const counted = countFixture(await loadEbgeoFixture('01-completo.ebgeo'));
        expect(counted).toMatchObject(DECLARED.completo);
        expect(counted.mapNames).toHaveLength(DECLARED.completo.maps);
    });

    it('a fixture mínima declara outros números (o contador não é constante)', async () => {
        const counted = countFixture(await loadEbgeoFixture('02-minimo.ebgeo'));
        expect(counted).toMatchObject(DECLARED.minimo);
    });

    // The version the whole detection turns on. Asserted as a LITERAL here and used as the
    // IMPORTED constant everywhere else, so the two ways of being wrong are distinguishable:
    // bumping the constant without touching this file trips this line, while a new step that
    // forgets to bump it trips the "needed" assertion below.
    it('o alvo da migração é a constante do código, e hoje ela vale 2.3', async () => {
        expect(ATLAS_SCHEMA_VERSION).toBe('2.3');

        const fixture = await loadEbgeoFixture('02-minimo.ebgeo');
        const ns0 = await import('@store/atlas-namespace.js');
        const names = legacyNamesOf(ns0);
        await seedLegacyWorkspace(fixture, names, { schemaVersion: '2.2' });

        vi.resetModules();
        const migration = await import('@store/migration/migration.service.js');
        const detected = await migration.detectMigrationNeeded();

        // A 2.2 install MUST be seen as needing work. This is the assertion that goes red
        // when a schema step is added and `ATLAS_SCHEMA_VERSION` is not bumped with it,
        // which the constitution names as the failure that happens most easily and in
        // silence.
        expect(detected.needed).toBe(true);
        expect(detected.currentVersion).toBe('2.2');
        expect(detected.targetVersion).toBe(ATLAS_SCHEMA_VERSION);
    });

    it('um usuário 2.2 local mantém TODO o dado, o banco legado vira o slot #1, e nenhum byte é copiado', async () => {
        const fixture = await loadEbgeoFixture('01-completo.ebgeo');
        const counted = countFixture(fixture);
        const ns0 = await import('@store/atlas-namespace.js');
        const names = legacyNamesOf(ns0);

        await seedLegacyWorkspace(fixture, names, { schemaVersion: '2.2' });

        // ===== INSTRUMENT CONTROL: the seeded install is the NINE databases `main` has,
        // and not one more. `ebgeo_comments` does not exist in `main`; an instrument that
        // fabricated it would answer every future existence-based gate on its own.
        expect(await listDatabases()).toEqual(legacyDbNames(names));

        // ===== POSITIVE ASSERTIONS BEFORE, so "survived" is distinguishable from
        // "never existed". This is the half whose absence made an earlier refutation test
        // unable to tell a wipe from an empty repository.
        expect(await databaseState(names.maps)).toBe('populated');
        expect(await countRaw(names)).toMatchObject({
            maps: DECLARED.completo.maps,
            features: DECLARED.completo.features,
            layers: DECLARED.completo.layers,
            groups: DECLARED.completo.groups,
            briefings: DECLARED.completo.briefings,
            slides: DECLARED.completo.slides,
            customIcons: DECLARED.completo.customIcons,
            images: DECLARED.completo.images
        });
        expect(await readKey(names.settings, 'schemaVersion')).toBe('2.2');
        expect(await readKey(names.settings, 'mapOrder')).toEqual(fixture.data.mapOrder);
        expect(await databaseExists('ebgeo_global')).toBe(false);

        vi.resetModules();
        const { activeMap, ns, repo } = await runBoot({ isAuthenticated: false });

        // ----- the data survived, read raw by absolute name
        expect(await countRaw(names)).toMatchObject({
            maps: DECLARED.completo.maps,
            features: DECLARED.completo.features,
            layers: DECLARED.completo.layers,
            groups: DECLARED.completo.groups,
            briefings: DECLARED.completo.briefings,
            slides: DECLARED.completo.slides,
            customIcons: DECLARED.completo.customIcons,
            images: DECLARED.completo.images
        });

        // ----- and the app can read it, which is what says the seeded layout is the real one
        expect(await countThroughRepository(repo)).toMatchObject({
            maps: DECLARED.completo.maps,
            features: DECLARED.completo.features,
            layers: DECLARED.completo.layers,
            groups: DECLARED.completo.groups,
            briefings: DECLARED.completo.briefings,
            slides: DECLARED.completo.slides,
            customIcons: DECLARED.completo.customIcons
        });
        // The loop below is vacuous over an empty map, so the size is asserted first.
        expect(fixture.images.size).toBe(DECLARED.completo.images);
        for (const id of fixture.images.keys()) {
            expect(await repo.hasImage(id)).toBe(true);
        }
        // DECLARED LIMIT, asserted so it cannot rot into a silent one: under node the five
        // images are raw bytes, not `Blob`s (see `IMAGE_VALUE_FORM`). "5 images survived"
        // above is therefore about five byte arrays, and nothing here exercises `blob.type`.
        expect(IMAGE_VALUE_FORM).toBe('bytes');

        // ----- the ORDER of the maps is data too, and it lives in a key none of the counts
        //       above touch. Without this line, "the order survived" and "the order was
        //       never seeded" are the same green.
        expect(await readKey(names.settings, 'mapOrder')).toEqual(fixture.data.mapOrder);
        expect(fixture.data.mapOrder).toHaveLength(DECLARED.completo.maps);

        // ----- the legacy databases were ADOPTED as local slot #1
        const registry = await lerRegistroLocalFixture(ns);
        expect(registry.atlases).toHaveLength(1);
        expect(registry.atlases[0].dbSuffix).toBe(ns.LEGACY_DB_SUFFIX);
        expect(await readKey('ebgeo_global', ns.GlobalKey.CURRENT_LOCAL_ATLAS))
            .toBe(registry.atlases[0].id);

        // ----- ZERO COPY: no namespaced database was created at all
        const created = await listDatabases();
        expect(created.filter(name => name.includes(ns.NAMESPACE_SEPARATOR))).toEqual([]);
        expect(created).toContain('ebgeo_maps');

        // ----- the version stamp moved, on both markers the chain reads
        expect(await readKey(names.settings, 'schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);
        expect((await readKey(names.atlas, ns.ATLAS_RECORD_KEY)).schemaVersion)
            .toBe(ATLAS_SCHEMA_VERSION);

        // ----- and the boot RETURNED a map of the user's own data, not a fresh "Principal".
        //       `initializeRepository` returns `DEFAULT_MAP_NAME` from two different
        //       fallbacks, so the name alone would not settle it: the record under that name
        //       must carry the feature count the archive declares for it, and that count must
        //       be non-zero.
        expect(activeMap).toBe(fixture.data.currentMap);
        const onDisk = await readDatabase(names.maps);
        expect(Object.keys(onDisk)).toContain(activeMap);
        expect(counted.featuresByMap[activeMap]).toBeGreaterThan(0);
        expect(featuresOf(onDisk[activeMap])).toBe(counted.featuresByMap[activeMap]);
    });

    it('o segundo boot não re-roda a migração nem cria um segundo slot (idempotência)', async () => {
        const fixture = await loadEbgeoFixture('01-completo.ebgeo');
        const ns0 = await import('@store/atlas-namespace.js');
        const names = legacyNamesOf(ns0);
        await seedLegacyWorkspace(fixture, names, { schemaVersion: '2.2' });

        vi.resetModules();
        const first = await runBoot({ isAuthenticated: false });
        const registryAfterFirst = await lerRegistroLocalFixture(first.ns);
        const dbsAfterFirst = await listDatabases();
        expect(registryAfterFirst.atlases).toHaveLength(1);
        // The counter is not stuck at zero: the FIRST boot really migrated.
        expect(first.migrationRuns).toBe(1);

        vi.resetModules();
        const migration = await import('@store/migration/migration.service.js');
        const detected = await migration.detectMigrationNeeded();
        expect(detected.needed).toBe(false);
        expect(detected.currentVersion).toBe(ATLAS_SCHEMA_VERSION);

        vi.resetModules();
        const second = await runBoot({ isAuthenticated: false });
        const registryAfterSecond = await lerRegistroLocalFixture(second.ns);

        // NOT RE-RUN, observed as non-execution and not only as unchanged final state: a
        // migration that re-ran harmlessly would leave exactly the same bytes behind.
        expect(second.migrationRuns).toBe(0);
        expect(registryAfterSecond.atlases).toHaveLength(1);
        expect(registryAfterSecond.atlases[0].id).toBe(registryAfterFirst.atlases[0].id);
        expect(registryAfterSecond.atlases[0].dbSuffix).toBe(ns0.LEGACY_DB_SUFFIX);
        expect(await listDatabases()).toEqual(dbsAfterFirst);
        expect(await countRaw(names)).toMatchObject({
            maps: DECLARED.completo.maps,
            features: DECLARED.completo.features,
            images: DECLARED.completo.images
        });

        // NEGATIVE CONTROL of the counter itself: put BOTH markers back one version and the
        // third boot migrates again, 1. Without this, `migrationRuns === 0` above would also
        // be what a spy that was never wired reports.
        await seedDatabase(names.settings, { schemaVersion: '2.2' });
        const atlasRecord = await readKey(names.atlas, ns0.ATLAS_RECORD_KEY);
        await seedDatabase(names.atlas, {
            [ns0.ATLAS_RECORD_KEY]: { ...atlasRecord, schemaVersion: '2.2' }
        });

        vi.resetModules();
        const third = await runBoot({ isAuthenticated: false });
        expect(third.migrationRuns).toBe(1);
    });

    it('a fixture mínima migra igual, e os números a acompanham', async () => {
        const fixture = await loadEbgeoFixture('02-minimo.ebgeo');
        const ns0 = await import('@store/atlas-namespace.js');
        const names = legacyNamesOf(ns0);
        await seedLegacyWorkspace(fixture, names, { schemaVersion: '2.2' });

        expect(await countRaw(names)).toMatchObject({ maps: 1, features: 1, images: 0 });

        vi.resetModules();
        const { ns } = await runBoot({ isAuthenticated: false });

        expect(await countRaw(names)).toMatchObject({ maps: 1, features: 1 });
        const registry = await lerRegistroLocalFixture(ns);
        expect(registry.atlases).toHaveLength(1);
        expect(registry.atlases[0].dbSuffix).toBe(ns.LEGACY_DB_SUFFIX);
        expect(await readKey(names.settings, 'schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);
    });
});

describe('o controle que mais importa: origem persistida REMOTE não pode virar cópia local', () => {
    /**
     * A 2.2 install whose store holds a SERVER atlas: pre-namespace, so the server's data
     * sits in the UNSUFFIXED databases. Adopting those databases as local slot #1 would
     * manufacture a permanent, editable local copy of someone else's atlas, which is the
     * one thing the origin marker exists to prevent.
     *
     * TWO HOMES FOR THE MARKER, AND ONLY ONE OF THEM BELONGS TO A 2.2 USER. `loadStoreOrigin`
     * reads the global database FIRST and falls back to the legacy `ebgeo_app_settings`. A
     * real 2.2 install has NO `ebgeo_global` at all (the neighbouring test asserts exactly
     * that as a premise), so its marker can only be in the legacy home, and the path it takes
     * is `readLegacyOrigin` + `promoteLegacyOrigin`. Seeding the global home instead — which
     * an earlier version of this file did — hits the first branch and never executes either
     * function, i.e. it tests an install that cannot exist and skips the code that the
     * upgrade actually runs. Both homes are covered below and labelled.
     *
     * @param {Object} [options]
     * @param {'legacy'|'global'} [options.home='legacy'] - Where the marker is seeded.
     * @returns {Promise<Object>}
     */
    async function seedRemoteOriginInstall({ home = 'legacy' } = {}) {
        const fixture = await loadEbgeoFixture('01-completo.ebgeo');
        const ns0 = await import('@store/atlas-namespace.js');
        const names = legacyNamesOf(ns0);
        await seedLegacyWorkspace(fixture, names, { schemaVersion: '2.2' });

        const marker = { kind: 'remote', atlasId: REMOTE_ATLAS_ID };
        if (home === 'legacy') {
            await seedDatabase(names.settings, { [ns0.GlobalKey.STORE_ORIGIN]: marker });
            expect(await databaseExists('ebgeo_global')).toBe(false);
        } else {
            await seedDatabase('ebgeo_global', { [ns0.GlobalKey.STORE_ORIGIN]: marker });
        }
        return { fixture, names, ns0 };
    }

    it('o dado do servidor estava mesmo lá antes (asserção positiva do "antes")', async () => {
        const { names } = await seedRemoteOriginInstall();
        expect(await databaseState(names.maps)).toBe('populated');
        expect(await countRaw(names)).toMatchObject({
            maps: DECLARED.completo.maps,
            features: DECLARED.completo.features
        });
        expect(await readKey(names.settings, 'schemaVersion')).toBe('2.2');
    });

    // The upgrade path, isolated: only the FIRST step of the boot runs, so the promotion is
    // observable before the wipe that follows it erases the evidence either way.
    it('o marcador legado é PROMOVIDO para o banco global, e a cópia antiga sai', async () => {
        const { names, ns0 } = await seedRemoteOriginInstall({ home: 'legacy' });

        vi.resetModules();
        const origin = await import('@store/store-origin.js');
        const loaded = await origin.loadStoreOrigin();

        expect(loaded).toEqual({ kind: 'remote', atlasId: REMOTE_ATLAS_ID });
        expect(await readKey('ebgeo_global', ns0.GlobalKey.STORE_ORIGIN))
            .toEqual({ kind: 'remote', atlasId: REMOTE_ATLAS_ID });
        expect(await readKey(names.settings, ns0.GlobalKey.STORE_ORIGIN)).toBeNull();
        // Nothing was destroyed by this step: the promotion is a move of one key.
        expect(await countKeys(names.maps)).toBe(DECLARED.completo.maps);
    });

    /**
     * The full boot, run against both marker homes and both session states.
     *
     * All four arms must converge on the SAME invariant (no permanent local copy of a server
     * atlas), and that is why they share one body. What they do NOT share is where the boot
     * lands, and pretending otherwise would have been the easy mistake: with a session the
     * boot mounts the REMOTE scratch named by the marker; with no session it mounts a FRESH
     * LOCAL slot instead. Both are asserted, per arm, absolutely — an arm whose expectation
     * were merely "not the legacy suffix" would be satisfied by either, and by a boot that
     * mounted nothing in particular.
     */
    const arms = [
        {
            home: 'legacy', isAuthenticated: true, registersRemote: true,
            scope: { kind: 'remote', dbSuffix: `remote-${REMOTE_ATLAS_ID}` },
            label: 'marcador legado, sessão viva (o upgrade real de 2.2)'
        },
        {
            home: 'legacy', isAuthenticated: false, registersRemote: false,
            scope: { kind: 'local' },
            label: 'marcador legado, sem sessão'
        },
        {
            home: 'global', isAuthenticated: true, registersRemote: true,
            scope: { kind: 'remote', dbSuffix: `remote-${REMOTE_ATLAS_ID}` },
            label: 'marcador já namespaceado, sessão viva'
        },
        {
            home: 'global', isAuthenticated: false, registersRemote: false,
            scope: { kind: 'local' },
            label: 'marcador já namespaceado, sem sessão'
        }
    ];

    it.each(arms)(
        'o banco legado NÃO é adotado, o dado do servidor é destruído, e a origem volta a LOCAL ($label)',
        async ({ home, isAuthenticated, registersRemote, scope }) => {
            const { names, ns0 } = await seedRemoteOriginInstall({ home });
            expect(await countKeys(names.maps)).toBe(DECLARED.completo.maps);

            vi.resetModules();
            const { ns } = await runBoot({ isAuthenticated });

            // ----- the boot really honoured the REMOTE marker (otherwise "the legacy slot was
            // not adopted" could be true for a reason that has nothing to do with the origin)
            const active = ns.getActiveScope();
            expect(active.kind).toBe(scope.kind);
            if (scope.dbSuffix) {
                expect(active.dbSuffix).toBe(scope.dbSuffix);
            } else {
                // A fresh slot, and specifically NOT the legacy databases.
                expect(active.dbSuffix).not.toBe(ns0.LEGACY_DB_SUFFIX);
                expect(active.dbSuffix.length).toBeGreaterThan(0);
            }
            if (registersRemote) {
                expect(await readKey('ebgeo_global', ns.remoteAtlasRegistryKey(REMOTE_ATLAS_ID))).not.toBeNull();
            } else {
                expect(await readKey('ebgeo_global', ns.remoteAtlasRegistryKey(REMOTE_ATLAS_ID))).toBeNull();
            }

            // ----- nobody claims the legacy suffix
            const registry = await lerRegistroLocalFixture(ns);
            expect(registry.atlases).toHaveLength(1);
            expect(registry.atlases[0].dbSuffix).not.toBe(ns0.LEGACY_DB_SUFFIX);
            expect(registry.atlases.some(e => e.dbSuffix === ns0.LEGACY_DB_SUFFIX)).toBe(false);

            // ----- and the server data is gone from where it sat
            expect(await countKeys(names.maps)).toBe(0);
            expect(await countKeys(names.layers)).toBe(0);
            expect(await countKeys(names.images)).toBe(0);
            expect(await countKeys(names.briefings)).toBe(0);
            expect(await readKey(names.atlas, ns.ATLAS_RECORD_KEY)).toBeNull();

            // ----- the marker no longer claims the store holds a server atlas, in EITHER home
            expect(await readKey('ebgeo_global', ns.GlobalKey.STORE_ORIGIN))
                .toMatchObject({ kind: 'local' });
            expect(await readKey(names.settings, ns.GlobalKey.STORE_ORIGIN)).toBeNull();
        }
    );
});

describe('migração por SLOT: o boot alcança o atlas MONTADO, não só o slot #1', () => {
    /**
     * The finding this group was written for (`migration.service.js`, fixed in E5):
     * `detectMigrationNeeded` opened `ebgeo_app_settings` / `ebgeo_atlas` by FIXED name at
     * module load, so it always asked the LEGACY slot whether a migration was needed — even
     * when the mounted atlas was a different slot carrying older data. `needed` came back
     * false and that slot was never brought forward, with no error and no log.
     *
     * Setup: slot #1 (legacy, already at 2.3, the normal state after the upgrade) plus a
     * slot #2 whose databases hold real data stamped 2.1, with the pointer on slot #2.
     * A boot mounts slot #2 and must bring it forward.
     *
     * THE ARRANGEMENT IS ALSO THE DISCRIMINATOR. Slot #1 is already current here, so the
     * INSTALLATION pass declines and any migration observed in this group can only have come
     * from the per-slot pass. Its mirror image is the neighbouring "origem persistida REMOTE"
     * group, where the mounted scope must NOT be a target: the two together are what separate
     * "the slot pass works" from "something migrates everything it can reach", and either one
     * alone would be satisfied by a wrong implementation.
     */
    async function seedTwoSlots() {
        const fixture = await loadEbgeoFixture('02-minimo.ebgeo');
        const ns0 = await import('@store/atlas-namespace.js');

        // Both name sets are asserted ABSOLUTELY by these two helpers, which is the check
        // this scenario lacked: its thesis is "the chain is anchored on the FIXED names", and
        // without it a change of naming rule would move both slots while every assertion kept
        // talking about names the same call had just produced.
        const legacyNames = legacyNamesOf(ns0);
        const slotTwoNames = slotNamesOf(ns0, SLOT_TWO_ID);

        // Slot #1: an already-migrated installation.
        await seedLegacyWorkspace(
            await loadEbgeoFixture('01-completo.ebgeo'),
            legacyNames,
            { schemaVersion: ATLAS_SCHEMA_VERSION, atlasName: 'Meu Atlas' }
        );

        // Slot #2: real data, one schema step behind.
        await seedLegacyWorkspace(fixture, slotTwoNames, {
            schemaVersion: '2.1',
            atlasName: 'Atlas Antigo',
            atlasId: SLOT_TWO_ID
        });

        const now = Date.now();
        await seedDatabase('ebgeo_global', {
            [ns0.GlobalKey.LOCAL_ATLASES]: {
                version: 1,
                atlases: [
                    { id: 'legacy-slot', name: 'Meu Atlas', dbSuffix: ns0.LEGACY_DB_SUFFIX, createdAt: now - 1000, updatedAt: now - 1000 },
                    { id: SLOT_TWO_ID, name: 'Atlas Antigo', dbSuffix: SLOT_TWO_ID, createdAt: now, updatedAt: now }
                ]
            },
            [ns0.GlobalKey.CURRENT_LOCAL_ATLAS]: SLOT_TWO_ID
        });

        return { ns0, legacyNames, slotTwoNames };
    }

    it('o slot #2 foi semeado em 2.1 e o boot monta ELE (o instrumento aponta para o banco certo)', async () => {
        const { slotTwoNames, legacyNames } = await seedTwoSlots();

        // POSITIVE ASSERTION BEFORE: the absolute names are the suffixed ones, they carry
        // the seeded data, and the two slots really start at DIFFERENT versions. Without
        // this last line "slot #2 ended at 2.3" would also be true of a slot that was
        // already there.
        expect(await readKey(slotTwoNames.settings, 'schemaVersion')).toBe('2.1');
        expect(await readKey(legacyNames.settings, 'schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);
        expect(await countKeys(slotTwoNames.maps)).toBe(1);

        vi.resetModules();
        const { ns, migrationRuns } = await runBoot({ isAuthenticated: false });

        // The boot really mounted slot #2 (otherwise the assertion below would be about a
        // database the app never opened, and its greenness would prove nothing).
        expect(ns.getActiveScope().dbSuffix).toBe(SLOT_TWO_ID);
        expect(ns.resolveDbName(ns.StoreName.SETTINGS)).toBe(slotTwoNames.settings);

        // EXACTLY ONE migration decided to run, and slot #1 was already current, so the one
        // that ran can only be the per-slot pass. This is the line that separates "the
        // mounted slot was migrated" from "the whole chain re-ran over everything".
        expect(migrationRuns).toBe(1);
        expect(await readKey(slotTwoNames.settings, 'schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);

        // The fixed-name slot was NOT re-migrated, and its own detector still answers about
        // itself: the two targets stayed separate.
        vi.resetModules();
        const migration = await import('@store/migration/migration.service.js');
        const detected = await migration.detectMigrationNeeded();
        expect(detected.needed).toBe(false);
        expect(detected.currentVersion).toBe(ATLAS_SCHEMA_VERSION);

        // And asked about slot #2 EXPLICITLY, it now also answers "nothing to do".
        const slotScope = ns.localScope(SLOT_TWO_ID, SLOT_TWO_ID);
        expect((await migration.detectMigrationNeeded(slotScope)).needed).toBe(false);

        // The data was brought forward, not replaced: the map is still there.
        expect(await countKeys(slotTwoNames.maps)).toBe(1);
    });

    it('o slot montado termina o boot em 2.3', async () => {
        const { slotTwoNames } = await seedTwoSlots();
        vi.resetModules();
        await runBoot({ isAuthenticated: false });

        expect(await readKey(slotTwoNames.settings, 'schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);
    });

    it('o registro de atlas do slot montado termina o boot em 2.3', async () => {
        const { ns0, slotTwoNames } = await seedTwoSlots();
        vi.resetModules();
        await runBoot({ isAuthenticated: false });

        const record = await readKey(slotTwoNames.atlas, ns0.ATLAS_RECORD_KEY);
        expect(record.schemaVersion).toBe(ATLAS_SCHEMA_VERSION);
    });

    it('o slot #1, que já estava em 2.3, não é tocado pela passagem do slot montado', async () => {
        const { legacyNames } = await seedTwoSlots();

        // The full fixture sits in slot #1 and must come out byte-identical: a per-slot pass
        // that leaked onto the fixed names would re-run v2.1 over 168 points here.
        const before = await countRaw(legacyNames);
        expect(before).toMatchObject({
            maps: DECLARED.completo.maps,
            features: DECLARED.completo.features,
            images: DECLARED.completo.images
        });

        vi.resetModules();
        await runBoot({ isAuthenticated: false });

        expect(await countRaw(legacyNames)).toEqual(before);
        expect(await readKey(legacyNames.settings, 'schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);
    });
});

describe('dois slots atrasados: cada um recebe a TRANSFORMAÇÃO, não só o carimbo', () => {
    /**
     * The half of the finding that was worse than "the slot never migrates".
     *
     * The chain's four steps used to be anchored on the fixed pre-namespace names, but the
     * last one (`migrateToV2_3`) stamped the MOUNTED slot as well. So when the legacy slot
     * triggered the chain, slot #2 came out marked 2.3 while the steps that transform its
     * data ran against a different set of databases — and that stamp would then make the slot
     * look already-migrated and be skipped for good. The stamp of a slot now belongs to the
     * pass that opened that slot's databases, which is what this group measures.
     *
     * THE OBSERVABLE, and its honest provenance: `sizeCreatedAtZoom`, which
     * `v2-to-v2.1.migration.js` backfills onto every point feature that lacks it. The 168
     * point features of the archive carry no such property — NOT because that is what the
     * point tool writes (`main`'s `add_point_control.js` sets `sizeCreatedAtZoom:
     * currentZoom` on every point it creates) but because the fixture GENERATOR builds
     * features through `store.addFeature` with hand-written GeoJSON and bypasses the tool.
     * The dependency is recorded in `tests/fixtures/ebgeo-2.2/README.md`, and the positive
     * control below turns a regenerated fixture into a red test rather than a silent one.
     */
    const SIZE_ZOOM_PROP = 'sizeCreatedAtZoom';

    /**
     * Seeds two slots, both stamped 2.0, with the pointer on slot #2.
     * @returns {Promise<Object>} Module handle and the absolute names of both slots.
     */
    async function seedTwoSlotsAtV20() {
        const ns0 = await import('@store/atlas-namespace.js');
        const legacyNames = legacyNamesOf(ns0);
        const slotTwoNames = slotNamesOf(ns0, SLOT_TWO_ID);

        await seedLegacyWorkspace(await loadEbgeoFixture('01-completo.ebgeo'), legacyNames, {
            schemaVersion: '2.0'
        });
        await seedLegacyWorkspace(await loadEbgeoFixture('01-completo.ebgeo'), slotTwoNames, {
            schemaVersion: '2.0',
            atlasName: 'Atlas Antigo',
            atlasId: SLOT_TWO_ID
        });

        const now = Date.now();
        await seedDatabase('ebgeo_global', {
            [ns0.GlobalKey.LOCAL_ATLASES]: {
                version: 1,
                atlases: [
                    { id: 'legacy-slot', name: 'Meu Atlas', dbSuffix: ns0.LEGACY_DB_SUFFIX, createdAt: now - 1000, updatedAt: now - 1000 },
                    { id: SLOT_TWO_ID, name: 'Atlas Antigo', dbSuffix: SLOT_TWO_ID, createdAt: now, updatedAt: now }
                ]
            },
            [ns0.GlobalKey.CURRENT_LOCAL_ATLAS]: SLOT_TWO_ID
        });

        return { ns0, legacyNames, slotTwoNames };
    }

    /**
     * @param {string} dbName - Absolute name of a maps database.
     * @returns {Promise<{ total: number, withProp: number }>} Point features, and how many
     *   carry the property v2.0→v2.1 backfills.
     */
    async function countPoints(dbName) {
        const maps = (await readDatabase(dbName)) ?? {};
        let total = 0;
        let withProp = 0;
        for (const record of Object.values(maps)) {
            for (const point of record.features?.points ?? []) {
                total += 1;
                if (point?.properties?.[SIZE_ZOOM_PROP] !== undefined) withProp += 1;
            }
        }
        return { total, withProp };
    }

    it('a cadeia roda DUAS vezes, uma por slot, e o carimbo de cada um acompanha a transformação', async () => {
        const { legacyNames, slotTwoNames } = await seedTwoSlotsAtV20();

        // POSITIVE ASSERTION BEFORE: both slots really start without the property, and the
        // count is non-zero, so "168 afterwards" cannot be an empty measurement. It is
        // also the guard against a regenerated fixture: a `.ebgeo` whose points already carry
        // the property trips HERE, instead of quietly making the case below meaningless.
        const before = await countPoints(legacyNames.maps);
        expect(before.total).toBe(168);
        expect(before.withProp).toBe(0);
        expect(await countPoints(slotTwoNames.maps)).toEqual({ total: 168, withProp: 0 });

        vi.resetModules();
        const { migrationRuns } = await runBoot({ isAuthenticated: false });

        // TWO migrations decided to run — observed as execution, not inferred from the
        // result. One target cannot produce two, so this is the count that says the mounted
        // slot got a pass of its own instead of a stamp borrowed from slot #1's.
        expect(migrationRuns).toBe(2);

        expect(await countPoints(legacyNames.maps)).toEqual({ total: 168, withProp: 168 });
        expect(await readKey(legacyNames.settings, 'schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);

        // And the MOUNTED slot came out transformed, in its OWN databases (the absolute
        // suffixed names, which the pre-namespace chain never opens), with the stamp that
        // matches what happened to it.
        expect(await countPoints(slotTwoNames.maps)).toEqual({ total: 168, withProp: 168 });
        expect(await readKey(slotTwoNames.settings, 'schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);
    });

    it('o slot montado recebe a transformação, não só o carimbo', async () => {
        const { slotTwoNames } = await seedTwoSlotsAtV20();
        vi.resetModules();
        await runBoot({ isAuthenticated: false });

        expect((await countPoints(slotTwoNames.maps)).withProp).toBe(168);
    });

    it('o segundo boot não re-roda nenhuma das duas, e o terceiro re-roda SÓ a do slot atrasado', async () => {
        const { ns0, slotTwoNames } = await seedTwoSlotsAtV20();

        // The counter is not stuck: the first boot really ran both passes.
        vi.resetModules();
        expect((await runBoot({ isAuthenticated: false })).migrationRuns).toBe(2);

        vi.resetModules();
        expect((await runBoot({ isAuthenticated: false })).migrationRuns).toBe(0);

        // NEGATIVE CONTROL OF THE PER-SLOT PASS, and the reason this case is worth its
        // runtime: put BOTH markers of slot #2 (and only slot #2) back one version, and the
        // third boot migrates exactly ONCE. A zero here would mean the second target had
        // stopped being asked; a two would mean a pass had leaked onto the other slot.
        await seedDatabase(slotTwoNames.settings, { schemaVersion: '2.2' });
        const record = await readKey(slotTwoNames.atlas, ns0.ATLAS_RECORD_KEY);
        await seedDatabase(slotTwoNames.atlas, {
            [ns0.ATLAS_RECORD_KEY]: { ...record, schemaVersion: '2.2' }
        });

        vi.resetModules();
        expect((await runBoot({ isAuthenticated: false })).migrationRuns).toBe(1);
        expect(await readKey(slotTwoNames.settings, 'schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);
    });
});

describe('asserções sobre o INSTRUMENTO (não sobre o boot: nenhuma mudança de src/ as alcança)', () => {
    // These three describe the SHAPE of the assertions used above, over literals this file
    // seeds itself. They are worth keeping and they are worth labelling: no mutation of
    // `src/` can turn the first two red, so counting them among the facts verified about the
    // migration would inflate the count by two.
    it('FORMA: a asserção de adoção reprova um registro que reivindica um slot COM sufixo', async () => {
        const ns0 = await import('@store/atlas-namespace.js');
        await seedDatabase('ebgeo_global', {
            [ns0.GlobalKey.LOCAL_ATLASES]: {
                version: 1,
                atlases: [{ id: SLOT_TWO_ID, name: 'Meu Atlas', dbSuffix: SLOT_TWO_ID, createdAt: 1, updatedAt: 1 }]
            }
        });
        const registry = await lerRegistroLocalFixture(ns0);

        expect(() => expect(registry.atlases[0].dbSuffix).toBe(ns0.LEGACY_DB_SUFFIX)).toThrow();
    });

    it('FORMA: a asserção de zero-cópia reprova quando existe um banco com sufixo', async () => {
        const ns0 = await import('@store/atlas-namespace.js');
        await seedDatabase(`ebgeo_maps__${SLOT_TWO_ID}`, { 'Principal': { features: {} } });
        const created = await listDatabases();

        expect(created.filter(n => n.includes(ns0.NAMESPACE_SEPARATOR))).not.toEqual([]);
    });

    // This one DOES exercise the helper against real storage: it proves `databaseState`
    // separates 'empty' from 'absent', which is the distinction every wipe assertion rests on.
    it('HELPER: a contagem raw reprova quando o dado é apagado (distingue apagado de nunca existiu)', async () => {
        const fixture = await loadEbgeoFixture('02-minimo.ebgeo');
        const ns0 = await import('@store/atlas-namespace.js');
        const names = legacyNamesOf(ns0);
        await seedLegacyWorkspace(fixture, names, { schemaVersion: '2.2' });

        expect(await countRaw(names)).toMatchObject({ maps: 1, features: 1 });
        expect(await databaseState(names.maps)).toBe('populated');

        for (const name of legacyDbNames(names)) {
            const store = (await import('localforage')).default.createInstance({ name });
            await store.clear();
        }

        expect(await countRaw(names)).toMatchObject({ maps: 0, features: 0 });
        expect(await databaseState(names.maps)).toBe('empty');
        expect(await databaseState('ebgeo_maps__nunca_existiu')).toBe('absent');
    });
});
