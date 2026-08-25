// Path: tests/integration/migracao-zoom-zero-de-ponto.repro.test.js

/**
 * @fileoverview Regression repro: the schema step to 2.1 rewrote a point's reference
 * zoom of 0 to 10, changing the size at which the point draws.
 *
 * ROOT CAUSE
 * `migrateToV2_1` (`frontend/src/js/store/migration/v2-to-v2.1.migration.js`) backfilled
 * with `if (!feature.properties.sizeCreatedAtZoom)`, testing TRUTHINESS where it meant
 * ABSENCE. Zoom 0 is the whole-world zoom level and a value a point can legitimately be
 * created at, so it was read as missing and overwritten with the default of 10. Fixed
 * with `!Number.isFinite(...)`, which still backfills `undefined`, `null` and `NaN`.
 *
 * WHY IT IS A PRODUCT DEFECT
 * `sizeCreatedAtZoom` is the anchor of the point label's zoom size correction (see
 * `.claude/rules/architecture.md`, §Point Label): the whole purpose of the field is to
 * keep the VISUAL size constant as the zoom changes. Moving the anchor from 0 to 10 moves
 * every drawn size with it, and the step runs once, silently, at startup: the operator
 * opens a saved atlas and finds points drawn at a size nobody chose, with no way back.
 *
 * WHAT THIS REPRO DOES NOT REACH
 * Real IndexedDB and real localforage: `atlas-namespace.js` is replaced by a scope-keyed
 * registry of in-memory stores, so nothing here says the databases are named correctly.
 * That is `frontend/tests/unit/repository-namespace.test.js`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { registry, makeStore, SCOPE_KEY } = vi.hoisted(() => {
    const registry = new Map();
    const SCOPE_KEY = (storeId, scope) => `${storeId}@${scope?.dbSuffix ?? '<none>'}`;

    function makeStore(key) {
        if (registry.has(key)) return registry.get(key);
        const backing = new Map();
        const instance = {
            __backing: backing,
            getItem: vi.fn(async k => (backing.has(k) ? backing.get(k) : null)),
            setItem: vi.fn(async (k, v) => { backing.set(k, v); return v; }),
            removeItem: vi.fn(async (k) => { backing.delete(k); }),
            keys: vi.fn(async () => [...backing.keys()]),
            clear: vi.fn(async () => { backing.clear(); }),
        };
        registry.set(key, instance);
        return instance;
    }

    return { registry, makeStore, SCOPE_KEY };
});

vi.mock('../../src/js/store/atlas-namespace.js', () => ({
    ATLAS_RECORD_KEY: 'current_atlas',
    LEGACY_DB_SUFFIX: '',
    StoreName: { MAPS: 'maps', ATLAS: 'atlas', SETTINGS: 'settings' },
    localScope: (atlasId, dbSuffix) => ({ kind: 'local', atlasId, dbSuffix }),
    getStoreFor: (storeId, scope) => makeStore(SCOPE_KEY(storeId, scope)),
}));

const { migrateToV2_1 } = await import(
    '../../src/js/store/migration/v2-to-v2.1.migration.js'
);

/** The pre-namespace scope the step defaults to. */
const mapStore = () => makeStore(SCOPE_KEY('maps', { dbSuffix: '' }));

/**
 * @param {object} props - Point feature properties.
 * @returns {object} A point feature.
 */
function ponto(props) {
    return {
        type: 'Feature',
        properties: { ...props },
        geometry: { type: 'Point', coordinates: [0, 0] },
    };
}

let logSpy;
beforeEach(() => {
    for (const store of registry.values()) store.__backing.clear();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { logSpy.mockRestore(); });

describe('repro: o degrau para 2.1 engolia o zoom 0 do ponto', () => {
    it('CONTROLE: o ponto SEM o campo continua sendo preenchido com 10', async () => {
        // Without this the repro below would also pass against a step that stopped
        // backfilling anything at all, which is the wrong fix.
        await mapStore().setItem('M', { features: { points: [ponto({ id: 'p1' })] } });

        await migrateToV2_1();

        const pontos = (await mapStore().getItem('M')).features.points;
        expect(pontos).toHaveLength(1);
        expect(pontos[0].properties.sizeCreatedAtZoom).toBe(10);
    });

    it('o zoom 0 SOBREVIVE ao degrau', async () => {
        await mapStore().setItem('M', {
            features: { points: [ponto({ id: 'p1', sizeCreatedAtZoom: 0 })] },
        });

        await migrateToV2_1();

        const pontos = (await mapStore().getItem('M')).features.points;
        expect(pontos).toHaveLength(1);
        expect(pontos[0].properties.sizeCreatedAtZoom).toBe(0);
    });

    it('os tres casos de AUSENCIA de verdade continuam preenchendo', async () => {
        const ausentes = [
            ponto({ id: 'sem' }),
            ponto({ id: 'nulo', sizeCreatedAtZoom: null }),
            ponto({ id: 'nan', sizeCreatedAtZoom: NaN }),
        ];
        expect(ausentes).toHaveLength(3);
        await mapStore().setItem('M', { features: { points: ausentes } });

        await migrateToV2_1();

        const pontos = (await mapStore().getItem('M')).features.points;
        expect(pontos).toHaveLength(3);
        for (const p of pontos) {
            expect(p.properties.sizeCreatedAtZoom, p.properties.id).toBe(10);
        }
    });

    it('um zoom 0 no meio de vizinhos preenchiveis nao contamina nem e contaminado', async () => {
        await mapStore().setItem('M', {
            features: {
                points: [
                    ponto({ id: 'a' }),
                    ponto({ id: 'zero', sizeCreatedAtZoom: 0 }),
                    ponto({ id: 'c', sizeCreatedAtZoom: 14 }),
                ],
            },
        });

        await migrateToV2_1();

        const pontos = (await mapStore().getItem('M')).features.points;
        expect(pontos).toHaveLength(3);
        expect(pontos.map(p => p.properties.sizeCreatedAtZoom)).toEqual([10, 0, 14]);
    });

    it('um mapa em que SO ha zoom 0 nao e reescrito no disco', async () => {
        // The step decides the write by the identity of the features object, so a map with
        // nothing left to backfill must not be touched at all.
        await mapStore().setItem('M', {
            features: { points: [ponto({ id: 'p1', sizeCreatedAtZoom: 0 })] },
        });
        mapStore().setItem.mockClear();

        await migrateToV2_1();

        const escritas = mapStore().setItem.mock.calls.filter(([k]) => k === 'M');
        expect(escritas).toHaveLength(0);
    });
});
