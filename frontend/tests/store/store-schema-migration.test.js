import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted shared state (available to vi.mock factories)
// ============================================================================
//
// The migration service AND each individual migration module independently call
// `localforage.createInstance({ name })` at module load time. For the migration
// chain to share state (service reads what a migration wrote), every call for a
// given `name` MUST return the SAME in-memory store. We back this with a
// name-keyed registry of Map-backed stores.
//
// `generateUUID` is mocked to produce stable, incrementing ids ("uuid-1",
// "uuid-2", ...) so the name->UUID mappings produced by v1->v2 are assertable.
// ============================================================================

const { storeRegistry, uuidCounter, makeNamedStore } = vi.hoisted(() => {
    const storeRegistry = new Map();

    function makeNamedStore(name) {
        if (storeRegistry.has(name)) {
            return storeRegistry.get(name);
        }
        const backing = new Map();
        const instance = {
            __name: name,
            __backing: backing,
            setItem: vi.fn(async (key, value) => { backing.set(key, value); return value; }),
            getItem: vi.fn(async (key) => (backing.has(key) ? backing.get(key) : null)),
            removeItem: vi.fn(async (key) => { backing.delete(key); }),
            keys: vi.fn(async () => [...backing.keys()]),
            clear: vi.fn(async () => { backing.clear(); }),
        };
        storeRegistry.set(name, instance);
        return instance;
    }

    return { storeRegistry, uuidCounter: { value: 0 }, makeNamedStore };
});

// ============================================================================
// Mock dependencies (must precede imports of the modules under test)
// ============================================================================

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(({ name }) => makeNamedStore(name)),
    },
}));

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => {
        uuidCounter.value += 1;
        return `uuid-${uuidCounter.value}`;
    }),
    isValidUUID: vi.fn(() => true),
    isLegacyId: vi.fn(() => false),
    isValidId: vi.fn(() => true),
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    detectMigrationNeeded,
    isTooOldToMigrate,
    safelyMigrate,
    getMigrationStatus,
} from '../../src/js/store/migration/migration.service.js';
import { migrateToV2 } from '../../src/js/store/migration/v1-to-v2.migration.js';
import { migrateToV2_1 } from '../../src/js/store/migration/v2-to-v2.1.migration.js';
import { migrateToV2_2 } from '../../src/js/store/migration/v2.1-to-v2.2.migration.js';
import { ATLAS_SCHEMA_VERSION } from '../../src/js/store/atlas/atlas.entity.js';

// `compareVersions` is not exported by migration.service.js; the exported
// `compareVersions` from repository.utils.js is the same algorithm and is what
// the temporal-migration suite already validates. We test the service's version
// logic through its public surface (detectMigrationNeeded / isTooOldToMigrate /
// safelyMigrate) and the pure ordering helper here.
import { compareVersions } from '../../src/js/store/repository.utils.js';

// ============================================================================
// Helpers
// ============================================================================

function appStore() { return makeNamedStore('ebgeo_app_settings'); }
function atlasStore() { return makeNamedStore('ebgeo_atlas'); }
function mapStore() { return makeNamedStore('ebgeo_maps'); }
function groupStore() { return makeNamedStore('ebgeo_groups'); }
function layerStore() { return makeNamedStore('ebgeo_layers'); }

/** Resets every registered store and the deterministic UUID counter. */
function resetAllStores() {
    for (const instance of storeRegistry.values()) {
        instance.__backing.clear();
    }
    uuidCounter.value = 0;
}

/** Builds a minimal v1.x point feature (pre-migration: no sync, raw ids). */
function v1Point(id, extra = {}) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.17, -22.90] },
        properties: { id, source: 'point', nome: `Point ${id}`, layerId: 'default', ...extra },
    };
}

function v1Line(id, extra = {}) {
    return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[-43.17, -22.90], [-43.18, -22.91]] },
        properties: { id, source: 'line', nome: `Line ${id}`, layerId: 'default', ...extra },
    };
}

const SYNC_KEYS = ['createdAt', 'updatedAt', 'version', 'ownerId', 'dirty', 'deleted', 'deletedAt'];

function expectFreshSync(sync) {
    expect(sync).toBeTruthy();
    for (const k of SYNC_KEYS) {
        expect(sync).toHaveProperty(k);
    }
    expect(sync.version).toBe(1);
    expect(sync.ownerId).toBeNull();
    expect(sync.dirty).toBe(true);
    expect(sync.deleted).toBe(false);
    expect(sync.deletedAt).toBeNull();
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
    vi.clearAllMocks();
    resetAllStores();
});

// ============================================================================
// compareVersions (pure ordering — drives the whole chain)
// ============================================================================

describe('compareVersions', () => {
    it('returns -1 when v1 < v2', () => {
        expect(compareVersions('1.3', '2.0')).toBe(-1);
        expect(compareVersions('2.0', '2.1')).toBe(-1);
        expect(compareVersions('2.1', '2.2')).toBe(-1);
    });

    it('returns 1 when v1 > v2', () => {
        expect(compareVersions('2.2', '2.1')).toBe(1);
        expect(compareVersions('2.0', '1.3')).toBe(1);
    });

    it('returns 0 when versions are equal', () => {
        expect(compareVersions('2.2', '2.2')).toBe(0);
        expect(compareVersions('1.3', '1.3')).toBe(0);
    });

    it('treats a missing trailing segment as 0 (differing segment counts)', () => {
        expect(compareVersions('2', '2.1')).toBe(-1);
        expect(compareVersions('2.1', '2')).toBe(1);
        expect(compareVersions('2', '2.0')).toBe(0);
    });

    // NOTE: the SERVICE's private compareVersions guards `(v || '0')`, so a null
    // currentVersion is treated as "0" (oldest). The repository.utils.js export
    // tested above does NOT have that guard (it throws on null) — they are two
    // separate implementations. The service's null->"0" semantics are therefore
    // exercised through its public surface below (isTooOldToMigrate /
    // detectMigrationNeeded with no stored version), not via this raw helper.
    it('the service treats a null/missing current version as oldest ("0")', () => {
        // null is NOT "too old" (fresh install), but it IS strictly older than the
        // minimum migratable version, which only the `(v || "0")` guard makes safe.
        expect(isTooOldToMigrate(null)).toBe(false);
        expect(isTooOldToMigrate(undefined)).toBe(false);
    });
});

// ============================================================================
// isTooOldToMigrate
// ============================================================================

describe('isTooOldToMigrate', () => {
    it('returns false for null (fresh install is not "too old")', () => {
        expect(isTooOldToMigrate(null)).toBe(false);
        expect(isTooOldToMigrate(undefined)).toBe(false);
        expect(isTooOldToMigrate('')).toBe(false);
    });

    it('returns true for versions below the minimum (1.2 < 1.3)', () => {
        expect(isTooOldToMigrate('1.2')).toBe(true);
        expect(isTooOldToMigrate('1.0')).toBe(true);
        expect(isTooOldToMigrate('0.9')).toBe(true);
    });

    it('returns false at exactly the minimum migratable version (1.3)', () => {
        expect(isTooOldToMigrate('1.3')).toBe(false);
    });

    it('returns false for 2.x versions', () => {
        expect(isTooOldToMigrate('2.0')).toBe(false);
        expect(isTooOldToMigrate('2.1')).toBe(false);
        expect(isTooOldToMigrate('2.2')).toBe(false);
    });
});

// ============================================================================
// detectMigrationNeeded
// ============================================================================

describe('detectMigrationNeeded', () => {
    it('flags a fresh v1-ish install (no version, no atlas) as needing migration', async () => {
        const result = await detectMigrationNeeded();
        expect(result.needed).toBe(true);
        expect(result.currentVersion).toBeNull();
        expect(result.targetVersion).toBe(ATLAS_SCHEMA_VERSION);
    });

    it('reports no migration needed when the atlas is already at the current version', async () => {
        await atlasStore().setItem('current_atlas', {
            id: 'a1',
            name: 'Atlas',
            schemaVersion: ATLAS_SCHEMA_VERSION,
            mapOrder: [],
            lastActiveMapId: null,
        });

        const result = await detectMigrationNeeded();
        expect(result.needed).toBe(false);
        expect(result.currentVersion).toBe(ATLAS_SCHEMA_VERSION);
        expect(result.targetVersion).toBe(ATLAS_SCHEMA_VERSION);
    });

    it('reports no migration needed when appStore schemaVersion >= current', async () => {
        await appStore().setItem('schemaVersion', ATLAS_SCHEMA_VERSION);
        const result = await detectMigrationNeeded();
        expect(result.needed).toBe(false);
        expect(result.currentVersion).toBe(ATLAS_SCHEMA_VERSION);
    });

    it('still needs migration when an atlas exists but at an older schema version', async () => {
        await atlasStore().setItem('current_atlas', {
            id: 'a1', name: 'Atlas', schemaVersion: '2.0', mapOrder: [], lastActiveMapId: null,
        });
        await appStore().setItem('schemaVersion', '2.0');

        const result = await detectMigrationNeeded();
        expect(result.needed).toBe(true);
        expect(result.currentVersion).toBe('2.0');
    });
});

// ============================================================================
// safelyMigrate — orchestration
// ============================================================================

describe('safelyMigrate orchestration', () => {
    it('runs v2 -> v2.1 -> v2.2 in order starting from a v1.x install', async () => {
        // Seed a v1.x map so the v2 step has real work and stamps the atlas.
        await mapStore().setItem('MapaAlfa', {
            features: { points: [v1Point('p1')] },
        });
        await appStore().setItem('schemaVersion', '1.3');

        const result = await safelyMigrate();
        expect(result).toEqual({ success: true });

        // End state: atlas created and both stores stamped to the current version.
        const atlas = await atlasStore().getItem('current_atlas');
        expect(atlas).toBeTruthy();
        expect(atlas.schemaVersion).toBe(ATLAS_SCHEMA_VERSION);
        expect(await appStore().getItem('schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);

        // v2.1 ran: the seeded point received the default sizeCreatedAtZoom.
        const map = await mapStore().getItem('MapaAlfa');
        expect(map.features.points[0].properties.sizeCreatedAtZoom).toBe(10);
        // v2 ran: the point id was converted to a UUID and sync metadata added.
        expect(map.features.points[0].properties.id).toMatch(/^uuid-\d+$/);
        expectFreshSync(map.features.points[0].properties.sync);
    });

    it('runs ONLY the v2.2 step when starting from v2.1 (no atlas re-create, no point backfill)', async () => {
        // Already-migrated v2.1 state: atlas + map with a point that ALREADY has zoom.
        await atlasStore().setItem('current_atlas', {
            id: 'atlas-existing', name: 'Keep Me', schemaVersion: '2.1',
            mapOrder: ['m1'], lastActiveMapId: 'm1',
        });
        await mapStore().setItem('MapaBeta', {
            id: 'm1',
            features: { points: [v1Point('uuid-keep', { sizeCreatedAtZoom: 7 })] },
        });
        await appStore().setItem('schemaVersion', '2.1');

        const result = await safelyMigrate();
        expect(result).toEqual({ success: true });

        const atlas = await atlasStore().getItem('current_atlas');
        // Same atlas object identity preserved (only version stamped, not recreated).
        expect(atlas.id).toBe('atlas-existing');
        expect(atlas.name).toBe('Keep Me');
        expect(atlas.schemaVersion).toBe(ATLAS_SCHEMA_VERSION);

        // v2.1 step did NOT run again: existing zoom value untouched, id untouched.
        const map = await mapStore().getItem('MapaBeta');
        expect(map.features.points[0].properties.sizeCreatedAtZoom).toBe(7);
        expect(map.features.points[0].properties.id).toBe('uuid-keep');
        // No UUID was generated at all (v2 step skipped).
        expect(uuidCounter.value).toBe(0);
    });

    it('returns success without touching data when no migration is needed', async () => {
        await atlasStore().setItem('current_atlas', {
            id: 'atlas-current', name: 'Current', schemaVersion: ATLAS_SCHEMA_VERSION,
            mapOrder: [], lastActiveMapId: null,
        });
        await appStore().setItem('schemaVersion', ATLAS_SCHEMA_VERSION);
        await mapStore().setItem('Untouched', { id: 'm', features: { points: [v1Point('raw-id')] } });

        const result = await safelyMigrate();
        expect(result).toEqual({ success: true });

        // Nothing migrated: raw id preserved, no UUID generated.
        const map = await mapStore().getItem('Untouched');
        expect(map.features.points[0].properties.id).toBe('raw-id');
        expect(map.features.points[0].properties.sync).toBeUndefined();
        expect(uuidCounter.value).toBe(0);
    });

    it('returns success WITHOUT migrating when data is too old to migrate', async () => {
        await appStore().setItem('schemaVersion', '1.2'); // below MIN_MIGRATABLE_VERSION (1.3)
        await mapStore().setItem('Ancient', { id: 'm', features: { points: [v1Point('old-id')] } });

        const result = await safelyMigrate();
        expect(result).toEqual({ success: true });

        // Too-old path bails out BEFORE running any migration step.
        const map = await mapStore().getItem('Ancient');
        expect(map.features.points[0].properties.id).toBe('old-id');
        expect(map.features.points[0].properties.sync).toBeUndefined();
        expect(await atlasStore().getItem('current_atlas')).toBeNull();
        expect(uuidCounter.value).toBe(0);
    });

    it('leaves the DB at 2.0 (still migratable) when the chain breaks AFTER v1->v2', async () => {
        // The expensive failure this pins: v1->v2 used to stamp the CHAIN's final version,
        // so an interruption between steps marked the DB fully migrated and the remaining
        // backfills never ran again — silently, since initializeRepository swallows the error.
        await mapStore().setItem('MapaAlfa', { features: { points: [v1Point('p1')] } });
        await appStore().setItem('schemaVersion', '1.3');

        const maps = mapStore();
        const realKeys = maps.keys.getMockImplementation();
        // 1st keys() belongs to migrateToV2, 2nd to migrateToV2_1 → break the second step.
        maps.keys
            .mockImplementationOnce(realKeys)
            .mockRejectedValueOnce(new Error('quota exceeded'));

        await expect(safelyMigrate()).rejects.toThrow('quota exceeded');

        // Both markers stop at the version actually reached...
        expect(await appStore().getItem('schemaVersion')).toBe('2.0');
        expect((await atlasStore().getItem('current_atlas')).schemaVersion).toBe('2.0');
        // ...so the next boot still knows there is work to do.
        const detected = await detectMigrationNeeded();
        expect(detected.needed).toBe(true);
        expect(detected.currentVersion).toBe('2.0');
    });

    it('completes the interrupted chain on the next run (backfill actually applied)', async () => {
        await mapStore().setItem('MapaAlfa', { features: { points: [v1Point('p1')] } });
        await appStore().setItem('schemaVersion', '1.3');

        const maps = mapStore();
        const realKeys = maps.keys.getMockImplementation();
        maps.keys
            .mockImplementationOnce(realKeys)
            .mockRejectedValueOnce(new Error('quota exceeded'));
        await expect(safelyMigrate()).rejects.toThrow('quota exceeded');

        // Second boot: storage is healthy again.
        maps.keys.mockImplementation(realKeys);
        await expect(safelyMigrate()).resolves.toEqual({ success: true });

        const map = await mapStore().getItem('MapaAlfa');
        // The v2.1 backfill this whole defect was hiding: without it the point renders at
        // MAX_POINT_RADIUS because sizeCreatedAtZoom || 0 makes the zoom diff enormous.
        expect(map.features.points[0].properties.sizeCreatedAtZoom).toBe(10);
        expect(await appStore().getItem('schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);
        expect((await detectMigrationNeeded()).needed).toBe(false);
    });

    it('rejects with the wrapped Portuguese message when a migration step throws', async () => {
        await appStore().setItem('schemaVersion', '1.3');
        // Force the v2 step to throw by making the maps store reject on keys().
        const maps = mapStore();
        maps.keys.mockRejectedValueOnce(new Error('IndexedDB exploded'));

        await expect(safelyMigrate()).rejects.toThrow(
            `Falha na migração para ${ATLAS_SCHEMA_VERSION}: IndexedDB exploded. Por favor, exporte seus dados e limpe o armazenamento local.`
        );
    });
});

// ============================================================================
// v1 -> v2 deep transformation
// ============================================================================

describe('migrateToV2 (deep)', () => {
    beforeEach(async () => {
        // A single v1.x map "Cidade" with:
        //  - layers: 'default' (preserved) + 'camada-raw' (remapped to UUID)
        //  - features: 2 points + 1 line, referencing the raw layer/group ids
        //  - a group 'grupo-raw' whose feature refs point at OLD feature ids
        await mapStore().setItem('Cidade', {
            features: {
                points: [
                    v1Point('feat-A', { layerId: 'camada-raw', groupId: 'grupo-raw' }),
                    v1Point('feat-B', { layerId: 'default' }),
                ],
                lines: [
                    v1Line('feat-C', { layerId: 'camada-raw' }),
                ],
            },
        });
        await layerStore().setItem('layers_Cidade', [
            { id: 'default', name: 'Padrão' },
            { id: 'camada-raw', name: 'Camada Customizada' },
        ]);
        await groupStore().setItem('Cidade', {
            'grupo-raw': {
                id: 'grupo-raw',
                name: 'Grupo 1',
                features: [{ id: 'feat-A', type: 'points' }],
            },
        });
        await appStore().setItem('mapOrder', ['Cidade']);
        await appStore().setItem('lastActiveMap', 'Cidade');
    });

    it('converts feature ids to deterministic UUIDs and adds sync metadata', async () => {
        await migrateToV2();

        const map = await mapStore().getItem('Cidade');
        const points = map.features.points;
        const line = map.features.lines[0];

        // Each feature id became a generated UUID (deterministic via mock).
        expect(points[0].properties.id).toMatch(/^uuid-\d+$/);
        expect(points[1].properties.id).toMatch(/^uuid-\d+$/);
        expect(line.properties.id).toMatch(/^uuid-\d+$/);
        // Distinct features -> distinct ids.
        const ids = new Set([points[0].properties.id, points[1].properties.id, line.properties.id]);
        expect(ids.size).toBe(3);

        // Sync metadata added to every feature.
        expectFreshSync(points[0].properties.sync);
        expectFreshSync(points[1].properties.sync);
        expectFreshSync(line.properties.sync);
    });

    it("preserves the 'default' layer id and remaps custom layer ids to UUIDs", async () => {
        await migrateToV2();

        const layers = await layerStore().getItem('layers_Cidade');
        const byName = Object.fromEntries(layers.map(l => [l.name, l]));

        expect(byName['Padrão'].id).toBe('default'); // preserved verbatim
        expect(byName['Camada Customizada'].id).toMatch(/^uuid-\d+$/);
        expect(byName['Camada Customizada'].id).not.toBe('camada-raw');

        // Layer sync metadata added.
        expectFreshSync(byName['Padrão'].sync);
        expectFreshSync(byName['Camada Customizada'].sync);

        // Features referencing the custom layer now carry the remapped UUID.
        const map = await mapStore().getItem('Cidade');
        const remappedLayerId = byName['Camada Customizada'].id;
        expect(map.features.points[0].properties.layerId).toBe(remappedLayerId);
        expect(map.features.lines[0].properties.layerId).toBe(remappedLayerId);
        // The 'default'-layer feature keeps 'default'.
        expect(map.features.points[1].properties.layerId).toBe('default');
    });

    it('rewrites group ids to UUIDs and rewrites group feature-refs to the new feature UUIDs', async () => {
        await migrateToV2();

        const map = await mapStore().getItem('Cidade');
        const newFeatAId = map.features.points[0].properties.id; // feat-A's new UUID

        const groups = await groupStore().getItem('Cidade');
        const groupKeys = Object.keys(groups);
        expect(groupKeys).toHaveLength(1);

        const newGroupId = groupKeys[0];
        expect(newGroupId).toMatch(/^uuid-\d+$/);
        expect(newGroupId).not.toBe('grupo-raw');

        const group = groups[newGroupId];
        expect(group.id).toBe(newGroupId);
        // The feature ref inside the group was rewritten from 'feat-A' to its new UUID.
        expect(group.features).toEqual([{ id: newFeatAId, type: 'points' }]);
        expectFreshSync(group.sync);
    });

    it('also remaps groupId on features that belong to a group', async () => {
        await migrateToV2();

        const map = await mapStore().getItem('Cidade');
        const groups = await groupStore().getItem('Cidade');
        const newGroupId = Object.keys(groups)[0];

        // feat-A belonged to 'grupo-raw' -> now carries the remapped group UUID.
        expect(map.features.points[0].properties.groupId).toBe(newGroupId);
        // feat-B had no group -> groupId stays undefined.
        expect(map.features.points[1].properties.groupId).toBeUndefined();
    });

    it("creates 'current_atlas' with mapOrder, resolved lastActiveMapId and a map id + sync", async () => {
        await migrateToV2();

        const atlas = await atlasStore().getItem('current_atlas');
        expect(atlas).toBeTruthy();
        expect(atlas.name).toBe('Meu Atlas');
        // This step reaches 2.0, NOT the chain's final version: stamping the final one
        // here made an interrupted chain look complete and skip the remaining steps.
        expect(atlas.schemaVersion).toBe('2.0');
        // mapOrder comes from appStore.mapOrder (still keyed by map NAME at this stage).
        expect(atlas.mapOrder).toEqual(['Cidade']);
        // lastActiveMap matched a real map name -> kept.
        expect(atlas.lastActiveMapId).toBe('Cidade');
        expectFreshSync(atlas.sync);

        // The map itself received a generated UUID id + name + sync.
        const map = await mapStore().getItem('Cidade');
        expect(map.id).toMatch(/^uuid-\d+$/);
        expect(map.name).toBe('Cidade');
        expectFreshSync(map.sync);
    });

    it('stamps its OWN target version (2.0) on the appStore, not the chain final', async () => {
        await migrateToV2();
        expect(await appStore().getItem('schemaVersion')).toBe('2.0');
    });

    it('falls back to map names for mapOrder and first map for lastActiveMapId when appStore lacks them', async () => {
        // Clear the appStore-provided ordering hints.
        appStore().__backing.delete('mapOrder');
        appStore().__backing.delete('lastActiveMap');

        await migrateToV2();

        const atlas = await atlasStore().getItem('current_atlas');
        expect(atlas.mapOrder).toEqual(['Cidade']);  // fell back to map keys
        expect(atlas.lastActiveMapId).toBe('Cidade'); // fell back to first map
    });
});

// ============================================================================
// v2 -> v2.1: sizeCreatedAtZoom default on points
// ============================================================================

describe('migrateToV2_1 (point sizeCreatedAtZoom)', () => {
    it('adds sizeCreatedAtZoom=10 to point features that lack it', async () => {
        await mapStore().setItem('M', {
            features: { points: [v1Point('p1'), v1Point('p2')] },
        });

        await migrateToV2_1();

        const map = await mapStore().getItem('M');
        expect(map.features.points[0].properties.sizeCreatedAtZoom).toBe(10);
        expect(map.features.points[1].properties.sizeCreatedAtZoom).toBe(10);
    });

    it('leaves an existing sizeCreatedAtZoom untouched', async () => {
        await mapStore().setItem('M', {
            features: { points: [v1Point('p1', { sizeCreatedAtZoom: 14 })] },
        });

        await migrateToV2_1();

        const map = await mapStore().getItem('M');
        expect(map.features.points[0].properties.sizeCreatedAtZoom).toBe(14);
    });

    it('does not add sizeCreatedAtZoom to non-point feature types', async () => {
        await mapStore().setItem('M', {
            features: { lines: [v1Line('l1')] },
        });

        await migrateToV2_1();

        const map = await mapStore().getItem('M');
        expect(map.features.lines[0].properties).not.toHaveProperty('sizeCreatedAtZoom');
    });

    it('is idempotent: running twice produces the same result with no second write', async () => {
        await mapStore().setItem('M', {
            features: { points: [v1Point('p1')] },
        });

        await migrateToV2_1();
        const afterFirst = await mapStore().getItem('M');
        expect(afterFirst.features.points[0].properties.sizeCreatedAtZoom).toBe(10);

        // Spy how many times the map is persisted on the second run.
        const setSpy = mapStore().setItem;
        const callsBefore = setSpy.mock.calls.length;

        await migrateToV2_1();
        const afterSecond = await mapStore().getItem('M');

        // Value unchanged and the map was NOT re-written on the second pass
        // (migration only persists when something actually changed).
        expect(afterSecond.features.points[0].properties.sizeCreatedAtZoom).toBe(10);
        const mapWritesOnSecondRun = setSpy.mock.calls
            .slice(callsBefore)
            .filter(([key]) => key === 'M');
        expect(mapWritesOnSecondRun).toHaveLength(0);
    });

    it('skips maps without features and still stamps the version', async () => {
        await mapStore().setItem('Empty', { id: 'e' }); // no .features
        await atlasStore().setItem('current_atlas', {
            id: 'a', name: 'A', schemaVersion: '2.0', mapOrder: [], lastActiveMapId: null,
        });

        await migrateToV2_1();

        const map = await mapStore().getItem('Empty');
        expect(map).toEqual({ id: 'e' }); // untouched
        expect((await atlasStore().getItem('current_atlas')).schemaVersion).toBe(ATLAS_SCHEMA_VERSION);
        expect(await appStore().getItem('schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);
    });
});

// ============================================================================
// v2.1 -> v2.2: version stamp only
// ============================================================================

describe('migrateToV2_2 (version stamp only)', () => {
    it('stamps ATLAS_SCHEMA_VERSION on the atlas and appStore without backfilling features', async () => {
        const point = v1Point('p1'); // no sizeCreatedAtZoom, no temporal fields
        await mapStore().setItem('M', { features: { points: [point] } });
        await atlasStore().setItem('current_atlas', {
            id: 'a', name: 'A', schemaVersion: '2.1', mapOrder: ['m'], lastActiveMapId: 'm',
        });
        await appStore().setItem('schemaVersion', '2.1');

        await migrateToV2_2();

        const atlas = await atlasStore().getItem('current_atlas');
        expect(atlas.schemaVersion).toBe(ATLAS_SCHEMA_VERSION);
        // Atlas otherwise unchanged.
        expect(atlas.id).toBe('a');
        expect(atlas.mapOrder).toEqual(['m']);
        expect(await appStore().getItem('schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);

        // No feature backfill: the point is byte-for-byte the same as seeded.
        const map = await mapStore().getItem('M');
        expect(map.features.points[0]).toEqual(point);
    });

    it('is safe when no atlas is present (only stamps appStore)', async () => {
        await appStore().setItem('schemaVersion', '2.1');

        const result = await migrateToV2_2();

        expect(result).toEqual({ success: true });
        expect(await atlasStore().getItem('current_atlas')).toBeNull();
        expect(await appStore().getItem('schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);
    });
});

// ============================================================================
// Full-chain idempotency + status
// ============================================================================

describe('full migration chain', () => {
    it('after a full migrate from v1.x, no further migration is detected', async () => {
        await mapStore().setItem('Cidade', {
            features: { points: [v1Point('p1', { layerId: 'camada-raw' })] },
        });
        await layerStore().setItem('layers_Cidade', [
            { id: 'default', name: 'Padrão' },
            { id: 'camada-raw', name: 'Custom' },
        ]);
        await appStore().setItem('schemaVersion', '1.3');

        await safelyMigrate();

        const detect = await detectMigrationNeeded();
        expect(detect.needed).toBe(false);
        expect(detect.currentVersion).toBe(ATLAS_SCHEMA_VERSION);

        // A second safelyMigrate is a no-op (detect short-circuits before any step).
        const before = uuidCounter.value;
        const result = await safelyMigrate();
        expect(result).toEqual({ success: true });
        expect(uuidCounter.value).toBe(before); // no new UUIDs generated
    });

    it('getMigrationStatus reflects the post-migration state', async () => {
        await mapStore().setItem('Cidade', { features: { points: [v1Point('p1')] } });
        await appStore().setItem('schemaVersion', '1.3');

        await safelyMigrate();

        const status = await getMigrationStatus();
        expect(status.currentVersion).toBe(ATLAS_SCHEMA_VERSION);
        expect(status.targetVersion).toBe(ATLAS_SCHEMA_VERSION);
        expect(status.hasAtlas).toBe(true);
        expect(status.atlasVersion).toBe(ATLAS_SCHEMA_VERSION);
    });
});
