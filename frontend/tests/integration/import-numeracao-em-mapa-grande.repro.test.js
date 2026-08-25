// Path: tests/integration/import-numeracao-em-mapa-grande.repro.test.js

/**
 * @fileoverview Repro for the import naming collapse on a large map.
 *
 * ROOT CAUSE. `getTypeCountersFromMapContext` collected every "Ponto #N" already on the map
 * into an array and then took `Math.max(...existingNumbers)`. A spread pushes ONE ARGUMENT
 * PER ELEMENT onto the call stack, and past roughly 125 000 arguments on this Node that
 * throws RangeError. The throw landed in the per-source `try/catch`, which logs a
 * `console.warn` and moves on, so the counter kept its initial value of 1. The import then
 * named its first new point "Ponto #1", which already existed, and every subsequent one
 * collided as well. Nothing surfaced to the user: the import reported success.
 *
 * WHAT MAKES IT A PRODUCT DEFECT rather than a guard: the failure is SILENT, it corrupts the
 * names of real user data, and it only appears on maps big enough that nobody re-checks the
 * names by hand. The same class was already closed in `add_brush_geometry.getBoundingBox`.
 *
 * FIX: one scan, tracking the running maximum, with no spread anywhere.
 *
 * The test drives the PRODUCTION method against a MapLibre-ish source stub. It asserts BOTH
 * the recovered number and the ABSENCE of the swallowed warning, because the warning is the
 * only trace the old path left and a fix that merely widened the catch would still pass on
 * the number alone.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('jszip', () => ({ default: class {} }));
vi.mock('@tmcw/togeojson', () => ({ kml: vi.fn(), gpx: vi.fn() }));
vi.mock('shpjs', () => ({ default: vi.fn() }));
vi.mock('@store', () => ({
    addFeatures: vi.fn(async () => {}),
    createLayerForImport: vi.fn(async (name) => ({ id: 'layer-1', name })),
    getLayers: vi.fn(async () => []),
    getCurrentMapNameSync: vi.fn(() => 'Principal'),
    getEventBus: vi.fn(() => ({ emit: vi.fn() })),
}));
vi.mock('@utils/id_utils.js', () => ({
    IDUtils: { generateFeatureIds: () => ({ id: 'fid', geoJsonId: 1 }) },
}));
vi.mock('@utils/toast_service.js', () => ({ showSuccess: vi.fn(), showError: vi.fn() }));
vi.mock('@js/terrain', () => ({ getTerrainElevation: vi.fn(async () => 0) }));
vi.mock('@events', () => ({ EventTypes: { LAYERS_CHANGED: 'layers:changed' } }));
vi.mock('@layers/geojson-dispatcher.js', () => ({ getGeoJsonDispatcher: vi.fn(() => ({ add: vi.fn() })) }));
vi.mock('@js/user_data', () => ({
    userDataManager: { extractAttributesFromImport: () => ({ attributes: {}, descricao: '' }) },
}));
vi.mock('@js/temporal/temporal-import.js', () => ({
    extractTemporalProperties: () => ({}),
    buildTrajectoryFromGpxFeature: () => [],
    extractGpxTimes: () => [],
    sanitizeImportedTrajectory: () => [],
}));

import AddImportControl from '../../src/js/import_export/import.control.js';

/**
 * @param {Record<string, Array<object>>} byType
 * @returns {AddImportControl}
 */
function controlOverMap(byType) {
    const control = new AddImportControl({ setActiveTool: vi.fn(), deactivateCurrentTool: vi.fn() });
    control.setMap({
        getSource: (name) => (name in byType
            ? { getData: async () => ({ features: byType[name] }) }
            : null),
    });
    return control;
}

let warnSpy;
beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warnSpy.mockRestore(); });

describe('REPRO: a numeracao de import REINICIAVA em 1 num mapa grande', () => {
    it('200 mil pontos existentes: o proximo nome continua de onde o mapa parou, sem warn engolido', async () => {
        // 200 000 is comfortably past the ~125 000 argument ceiling that the spread hit.
        const pontos = Array.from({ length: 200000 }, (_, i) => ({
            properties: { nome: `Ponto #${i + 1}` },
        }));
        expect(pontos).toHaveLength(200000);

        const c = controlOverMap({ points: pontos });
        const counters = await c.getTypeCountersFromMapContext();

        expect(counters.points).toBe(200001);
        // The swallowed RangeError was the old path's only trace; its absence is what
        // distinguishes a real fix from a wider catch.
        expect(warnSpy).not.toHaveBeenCalled();

        // And the number is actually USED: the first imported feature does not collide.
        expect(c.generateImportName('points', counters)).toBe('Ponto #200001');
    });

    it('CONTROLE: uma amostra pequena percorre o MESMO caminho e conta certo', async () => {
        const c = controlOverMap({
            points: [{ properties: { nome: 'Ponto #3' } }, { properties: { nome: 'Ponto #7' } }],
        });
        await expect(c.getTypeCountersFromMapContext()).resolves.toMatchObject({ points: 8 });
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('CONTROLE: uma fonte que realmente falha ainda cai no catch e ainda avisa', async () => {
        // Without this the assertion above ("did not warn") would also pass if the try/catch
        // had been deleted, which would trade a silent wrong answer for a silent crash.
        const c = new AddImportControl({ setActiveTool: vi.fn(), deactivateCurrentTool: vi.fn() });
        c.setMap({
            getSource: (name) => (name === 'points'
                ? { getData: async () => { throw new Error('fonte quebrada'); } }
                : null),
        });
        await expect(c.getTypeCountersFromMapContext())
            .resolves.toEqual({ points: 1, lines: 1, polygons: 1 });
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });
});
