import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    realLineFeature,
    realMilitarySymbolFeature,
    realPointFeature,
    realFeature
} from '../helpers/real-fixtures.js';

// ============================================================================
// Mock localforage for LocalRepository
//
// Wired identically to tests/integration/repository-contract.test.js: a single
// hoisted `stores` registry keyed by instance name, each backed by a Map so the
// repository's per-store createInstance() calls land in stable, inspectable
// fakes. We deep-clone values on the way in/out to mirror IndexedDB's structured
// clone — otherwise a verbatim round-trip would trivially pass by reference and
// hide shape mutations the repository may perform.
// ============================================================================

const { stores } = vi.hoisted(() => ({ stores: {} }));

// structuredClone is available in Node 18+ (vitest runtime); fall back to JSON.
const clone = (v) =>
    typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(({ name }) => {
            if (!stores[name]) {
                const map = new Map();
                stores[name] = {
                    setItem: vi.fn(async (key, value) => { map.set(key, clone(value)); return value; }),
                    getItem: vi.fn(async (key) => {
                        const val = map.get(key);
                        return val !== undefined ? clone(val) : null;
                    }),
                    removeItem: vi.fn(async (key) => { map.delete(key); }),
                    keys: vi.fn(async () => [...map.keys()]),
                    clear: vi.fn(async () => { map.clear(); }),
                    iterate: vi.fn(async (callback) => {
                        for (const [key, value] of map.entries()) {
                            callback(clone(value), key);
                        }
                    }),
                    _map: map
                };
            }
            return stores[name];
        })
    }
}));

// Mock dependencies used by local.repository.js (same as the contract test).
vi.mock('../../src/js/store/atlas/atlas.entity.js', () => ({
    createAtlas: vi.fn((name) => ({ id: 'atlas-uuid', name: name || 'Projeto sem nome', maps: [] })),
    isValidAtlas: vi.fn(() => true)
}));

vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: {
        isInitialized: false,
        resolveToId: vi.fn((nameOrId) => nameOrId),
        resolveToName: vi.fn((id) => id),
        registerMap: vi.fn()
    }
}));

// ============================================================================
// Import after mocks
// ============================================================================

import { LocalRepository } from '../../src/js/store/repositories/local.repository.js';

// ============================================================================
// SETUP
// ============================================================================

let repo;

beforeEach(() => {
    for (const storeName of Object.keys(stores)) {
        stores[storeName]._map.clear();
    }
    vi.clearAllMocks();
    repo = new LocalRepository();
});

// ============================================================================
// HELPERS
// ============================================================================

// A non-UUID map key, so _resolveMapKey doesn't short-circuit on isValidUUID
// and we exercise the direct-lookup path used by name-keyed maps. (The features
// inside are what we care about, not the map key.)
const MAP_ID = 'mapa-operacao-alfa';

// Build a real, tool-shaped map: features grouped by source bucket exactly like
// the IndexedDB snapshot, every feature carrying a NUMERIC top-level id and
// properties.layerId:'default'.
function buildRealMap(line, mil, point) {
    return {
        name: 'Operação Alfa',
        baseLayer: 'carta-topografica',
        features: {
            lines: [line],
            military_symbols: [mil],
            points: [point]
        }
    };
}

// ============================================================================
// TESTS
// ============================================================================

describe('LocalRepository — real feature shape round-trips', () => {

    it('saveMap/getMap preserves a REAL line + military symbol VERBATIM (numeric top id + layerId survive)', async () => {
        const line = realLineFeature();
        const mil = realMilitarySymbolFeature();
        const point = realPointFeature();

        // Snapshot the exact bytes we hand in so we can prove nothing mutated.
        const lineExpected = clone(line);
        const milExpected = clone(mil);
        const pointExpected = clone(point);

        await repo.saveMap(MAP_ID, buildRealMap(line, mil, point));
        const loaded = await repo.getMap(MAP_ID);

        expect(loaded).not.toBeNull();

        const loadedLine = loaded.features.lines[0];
        const loadedMil = loaded.features.military_symbols[0];
        const loadedPoint = loaded.features.points[0];

        // Whole-feature verbatim equality (catches ANY field drift).
        expect(loadedLine).toEqual(lineExpected);
        expect(loadedMil).toEqual(milExpected);
        expect(loadedPoint).toEqual(pointExpected);

        // Explicit assertions on the two gotchas the gap let through:
        // 1) numeric top-level GeoJSON id stays a NUMBER, unchanged, not a UUID.
        expect(typeof loadedLine.id).toBe('number');
        expect(loadedLine.id).toBe(lineExpected.id);
        expect(typeof loadedMil.id).toBe('number');
        expect(loadedMil.id).toBe(milExpected.id);

        // 2) properties.layerId === 'default' (NON-UUID sentinel) survives.
        expect(loadedLine.properties.layerId).toBe('default');
        expect(loadedMil.properties.layerId).toBe('default');
        expect(loadedPoint.properties.layerId).toBe('default');

        // properties.id remains the canonical UUID, distinct from the numeric top id.
        expect(loadedLine.properties.id).toBe(lineExpected.properties.id);
        expect(loadedLine.properties.id).not.toBe(loadedLine.id);
        expect(loadedMil.properties.sidc).toBe(milExpected.properties.sidc);
    });

    it('getAllMaps returns each saved map identified/keyed by its id', async () => {
        const mapA = buildRealMap(realLineFeature(), realMilitarySymbolFeature(), realPointFeature());
        const mapB = buildRealMap(realLineFeature(), realMilitarySymbolFeature(), realPointFeature());
        mapA.name = 'Map A';
        mapB.name = 'Map B';

        await repo.saveMap('map-alfa', mapA);
        await repo.saveMap('map-bravo', mapB);

        const all = await repo.getAllMaps();

        expect(all).toBeInstanceOf(Map);
        expect(all.size).toBe(2);
        // Keyed by the storage id...
        expect(all.has('map-alfa')).toBe(true);
        expect(all.has('map-bravo')).toBe(true);
        // ...and each value carries that same id (saveMap stamps data.id = key).
        expect(all.get('map-alfa').id).toBe('map-alfa');
        expect(all.get('map-bravo').id).toBe('map-bravo');
        // Real features survived the bulk read too.
        expect(all.get('map-alfa').features.military_symbols[0].properties.layerId).toBe('default');
        expect(typeof all.get('map-bravo').features.lines[0].id).toBe('number');
    });

    it('saveMap with NO features object reads back without throwing', async () => {
        await repo.saveMap('map-sem-features', { name: 'Sem Features' });

        const loaded = await repo.getMap('map-sem-features');
        expect(loaded).not.toBeNull();
        expect(loaded.name).toBe('Sem Features');
        // The repository does not synthesize a features bucket; it stays absent.
        expect(loaded.features).toBeUndefined();
    });

    it('getMap for a missing id resolves to null', async () => {
        const loaded = await repo.getMap('nao-existe-id');
        expect(loaded).toBeNull();
    });

    it('saving the same map id twice is an idempotent overwrite (one entry)', async () => {
        const first = buildRealMap(realLineFeature(), realMilitarySymbolFeature(), realPointFeature());
        first.name = 'Versão 1';

        // Second save: different real features, same key.
        const newLine = realLineFeature();
        const second = buildRealMap(newLine, realMilitarySymbolFeature(), realPointFeature());
        second.name = 'Versão 2';

        await repo.saveMap('map-dup', first);
        await repo.saveMap('map-dup', second);

        const all = await repo.getAllMaps();
        const dupCount = [...all.keys()].filter((k) => k === 'map-dup').length;
        expect(dupCount).toBe(1);
        expect(all.size).toBe(1);

        const loaded = await repo.getMap('map-dup');
        expect(loaded.name).toBe('Versão 2');
        // The overwrite kept the second real line verbatim (top id + layerId intact).
        expect(loaded.features.lines[0].id).toBe(newLine.id);
        expect(loaded.features.lines[0].properties.layerId).toBe('default');
    });

    it('preserves the real shape across the full source factory (realFeature) too', async () => {
        // A couple of extra real types via the generic factory, to widen coverage
        // beyond line/military_symbol without copying the happy-path sweep.
        const circle = realFeature('circle');
        // A seta deixou de cair no envelope genérico de PONTO: desde que
        // `realArrowFeature` existe, ela vem com a geometria `Polygon` (o contorno
        // DESENHADO) e o eixo autoral em `properties.baseCoordinates`, que é uma forma
        // bem mais exigente para o round-trip do repositório.
        const arrow = realFeature('arrow');

        await repo.saveMap('map-mix', {
            name: 'Mix',
            features: { circles: [circle], arrows: [arrow] }
        });
        const loaded = await repo.getMap('map-mix');

        expect(loaded.features.circles[0]).toEqual(circle);
        expect(loaded.features.arrows[0]).toEqual(arrow);
        expect(typeof loaded.features.circles[0].id).toBe('number');
        expect(loaded.features.arrows[0].properties.layerId).toBe('default');
    });
});
