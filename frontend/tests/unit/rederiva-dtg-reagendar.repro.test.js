import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

// Regression test for the two dead branches of `rederiveAutoDtg`
// (store/feature.operations.js).
//
// Root cause: a comparison between two namespaces, at a site where neither side throws.
// `rederiveAutoDtg` compares its `type` argument against the SOURCE types
// `military_symbol` / `coordination_measure` (singular), but its only caller is the loop
// inside `shiftMapTemporalTimes`, whose key comes from `Object.keys(features)` — the
// STORAGE buckets `military_symbols` / `coordination_measures` (plural). No branch ever
// ran. The function's own JSDoc said "Storage feature type", so the documentation
// recorded the error instead of catching it.
//
// Symptom: after "Reagendar", a symbol with the `autoDtg` opt-in keeps the OLD date-time
// group printed on it while its validity window has already moved to the new D-Day. No
// error anywhere: a missing `else` is silence.
//
// Drives the PUBLIC function (`shiftMapTemporalTimes`), never the private helper, so a
// fix that only renamed the helper would not satisfy it.

const { mockMapData, mockMapManager, mockLockedMaps } = vi.hoisted(() => ({
    mockMapData: { value: null },
    mockMapManager: {
        getCurrentMapName: vi.fn(() => 'TestMap'),
        getCurrentMapId: vi.fn(() => 'map-uuid-123'),
        getMapId: vi.fn(() => 'map-uuid-123'),
        getFeatureColor: vi.fn(() => null),
        getFeatureColors: vi.fn(() => []),
        updateColorUsage: vi.fn(),
        recordAction: vi.fn(),
    },
    mockLockedMaps: { value: new Set() },
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_PERSIST_ERROR: 'store:persistError',
        STORE_OPERATION_BLOCKED: 'store:operationBlocked',
    },
    emitStoreError: vi.fn(),
}));

// The role gate is real but only engages on a connected REMOTE atlas; LOCAL keeps every
// case here on the permissive path, which is what isolates this item from item 1.
vi.mock('../../src/js/store/store-origin.js', () => ({
    StoreOriginKind: { LOCAL: 'local', REMOTE: 'remote' },
    isRemoteStoreSync: vi.fn(() => false),
    getStoreOriginSync: vi.fn(() => ({ kind: 'local', atlasId: null })),
    loadStoreOrigin: vi.fn(async () => ({ kind: 'local', atlasId: null })),
    setStoreOrigin: vi.fn(async () => {}),
    markStoreRemote: vi.fn(async () => {}),
    markStoreLocal: vi.fn(async () => {}),
}));

vi.mock('../../src/js/store/map.operations.js', () => ({
    isCurrentMapLockedSync: vi.fn(() => false),
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logFeatureOperation: vi.fn().mockResolvedValue(undefined),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getMapDataCompat: vi.fn(async () => mockMapData.value),
    updateMapDataCompat: vi.fn(async (mapName, data) => { mockMapData.value = data; }),
    getLayersCompat: vi.fn(async () => []),
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({ default: mockMapManager }));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: {
        get lockedMaps() { return mockLockedMaps.value; },
        set lockedMaps(v) { mockLockedMaps.value = v; },
        currentMap: 'TestMap',
    },
}));

import { shiftMapTemporalTimes } from '../../src/js/store/feature.operations.js';
import { updateMapDataCompat } from '../../src/js/store/repositories/index.js';

// 2024-11-20 14:00Z, and three days later. The DTG strings below are written as
// LITERALS, not built with formatDTG: an expectation computed by the function under
// test would agree with it however wrong it got.
const T0 = Date.UTC(2024, 10, 20, 14, 0);
const T_FIM = Date.UTC(2024, 10, 20, 16, 0);
const DELTA = 3 * 86_400_000;

const DTG_ANTES = '201400NOV24';
const DTG_DEPOIS = '231400NOV24';
const GDH_INI_ANTES = '201400Z NOV';
const GDH_INI_DEPOIS = '231400Z NOV';
const GDH_FIM_ANTES = '201600Z NOV';
const GDH_FIM_DEPOIS = '231600Z NOV';

function timedFeature(id, extra = {}) {
    return {
        type: 'Feature',
        id,
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: {
            id,
            layerId: 'default',
            temporalInicio: T0,
            temporalFim: T_FIM,
            ...extra,
        },
    };
}

/** Properties as PERSISTED by the shift (what the store hands back on the next read). */
function persisted(bucket, id) {
    const data = updateMapDataCompat.mock.calls.at(-1)[1];
    return data.features[bucket].find((f) => f.properties.id === id).properties;
}

describe('Reagendar — re-derivação do GDH automático', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockMapData.value = getEmptyMapData();
        mockLockedMaps.value = new Set();
    });

    it('desloca a janela do símbolo militar (controle positivo)', async () => {
        mockMapData.value.features.military_symbols.push(
            timedFeature('s1', { autoDtg: true, dateTimeGroup: DTG_ANTES }),
        );

        const changed = await shiftMapTemporalTimes('TestMap', DELTA);

        // Green here with the case below red is what proves the next case measures the
        // RE-DERIVATION and not the shift.
        expect(changed).toBe(1);
        expect(persisted('military_symbols', 's1').temporalInicio).toBe(T0 + DELTA);
    });

    it('re-deriva o dateTimeGroup do símbolo militar', async () => {
        mockMapData.value.features.military_symbols.push(
            timedFeature('s1', { autoDtg: true, dateTimeGroup: DTG_ANTES }),
        );

        await shiftMapTemporalTimes('TestMap', DELTA);

        expect(persisted('military_symbols', 's1').dateTimeGroup).toBe(DTG_DEPOIS);
    });

    it('re-deriva gdhIni e gdhFim da medida de coordenação', async () => {
        mockMapData.value.features.coordination_measures.push(
            timedFeature('c1', { autoDtg: true, gdhIni: GDH_INI_ANTES, gdhFim: GDH_FIM_ANTES }),
        );

        await shiftMapTemporalTimes('TestMap', DELTA);

        // The sibling case exists because BOTH branches were dead, not one.
        const p = persisted('coordination_measures', 'c1');
        expect(p.gdhIni).toBe(GDH_INI_DEPOIS);
        expect(p.gdhFim).toBe(GDH_FIM_DEPOIS);
    });

    it('não toca no GDH quando o vínculo automático está desligado', async () => {
        mockMapData.value.features.military_symbols.push(
            timedFeature('s1', { dateTimeGroup: DTG_ANTES }),
        );
        mockMapData.value.features.coordination_measures.push(
            timedFeature('c1', { gdhIni: GDH_INI_ANTES, gdhFim: GDH_FIM_ANTES }),
        );

        await shiftMapTemporalTimes('TestMap', DELTA);

        // The derivation is opt-in: a hand-typed amplifier is never rewritten. This is
        // also the instrument control — turning `autoDtg` off must make the two cases
        // above go quiet, or they are measuring something other than the opt-in.
        expect(persisted('military_symbols', 's1').dateTimeGroup).toBe(DTG_ANTES);
        expect(persisted('coordination_measures', 'c1').gdhIni).toBe(GDH_INI_ANTES);
        expect(persisted('coordination_measures', 'c1').gdhFim).toBe(GDH_FIM_ANTES);
        // …and the window still moved, so "quiet" is not "nothing ran".
        expect(persisted('military_symbols', 's1').temporalInicio).toBe(T0 + DELTA);
    });

    it('não inventa GDH para um tipo que não tem amplificador de data', async () => {
        mockMapData.value.features.points.push(timedFeature('p1', { autoDtg: true }));

        await shiftMapTemporalTimes('TestMap', DELTA);

        const p = persisted('points', 'p1');
        expect(p.temporalInicio).toBe(T0 + DELTA);
        expect(p.dateTimeGroup).toBeUndefined();
        expect(p.gdhIni).toBeUndefined();
    });
});
