// Path: tests/integration/los-amostragem-nao-finita-falha-aberto.repro.test.js

/**
 * @fileoverview Regression repro, and the most serious of its batch: a line of sight
 * with a non-finite sample count used to fail OPEN, reporting a 5 km mountain as
 * entirely visible.
 *
 * ROOT CAUSE
 * `AddLOSGeometry.calculateLOS` read `options.samplePoints ?? DEFAULT_SAMPLE_POINTS`.
 * `??` guards `null` and `undefined` and does NOT guard `NaN`, so a NaN count survived
 * into `steps = Math.max(2, samplePoints)`, which is NaN, and `for (let i = 1; i < NaN;)`
 * never runs. With no sample taken, `firstObstructedPoint` stayed null and the function
 * returned `obstructed: null` with `visibleLength === totalLength`. Fixed by falling back
 * to the default whenever the count is not finite.
 *
 * WHY THE DIRECTION OF THE FAILURE IS THE POINT
 * The output was not visible garbage (no NaN in a length, no exception, no empty
 * geometry): it was a WELL-FORMED verdict of "everything visible" over blocking terrain.
 * In a targeting tool that is the wrong way to fail, because nothing downstream and
 * nobody reading the panel has a reason to doubt it.
 *
 * HOW A NON-FINITE COUNT GETS THERE
 * The attributes panel offers a bounded slider (10..500), so the UI is not the likely
 * source. `samplePoints` is a persisted feature property: it round-trips through `.ebgeo`
 * import and through sync from another client, where it is arbitrary JSON, and
 * `add_los_control.js` feeds it back with `feature.properties.samplePoints ?? 100`, the
 * same `??` that does not guard NaN.
 *
 * WHAT THIS REPRO DOES NOT REACH
 * The real turf and the real terrain sampler: both are doubles here, deterministic by
 * design. It measures the module's own sweep, which is where the fix lives.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tools', async () => {
    const { calculateDistance } = await import('../../src/js/utilities/geometry-utils.js');
    return {
        BaseGeometry: class {
            constructor(properties = {}) { this.properties = { ...properties }; }
            calculateDistance(a, b) { return calculateDistance(a, b); }
        },
    };
});

// O terreno entra pelo AMOSTRADOR (createTerrainSampler), construido uma vez por calculo,
// com `elevation` sincrona. O duplo separa a construcao da leitura porque as duas contam.
vi.mock('@js/terrain', () => {
    const elevation = vi.fn(() => 0);
    return {
        createTerrainSampler: vi.fn(() => ({ elevation, fast: true, zoom: 12 })),
        __elevation: elevation,
    };
});

const { createTerrainSampler, __elevation: amostraElevacao } = await import('@js/terrain');
const { default: AddLOSGeometry } = await import(
    '../../src/js/analysis_tools/los_tool/add_los_geometry.js'
);

const geom = new AddLOSGeometry();

/** A west-to-east line whose sampled longitude doubles as the progress fraction. */
const LINHA = [[0, 0], [1, 0]];

/**
 * Deterministic 2-point turf double: `along` interpolates linearly between the two
 * endpoints, so the sampled longitude IS the fraction of the way along.
 * @param {number} totalLength - Length in meters that turf.length reports.
 * @returns {Object} The double, for call-count assertions.
 */
function stubTurf(totalLength) {
    const stub = {
        alongCalls: [],
        lineString: vi.fn(coords => ({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords.map(c => [...c]) },
        })),
        length: vi.fn(() => totalLength),
        along: vi.fn((line, dist) => {
            stub.alongCalls.push(dist);
            const [a, b] = line.geometry.coordinates;
            const t = totalLength === 0 ? 0 : dist / totalLength;
            return {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
                },
            };
        }),
    };
    globalThis.turf = stub;
    return stub;
}

/**
 * A real 5 km peak: ground at 0 at BOTH endpoints, summit across the middle. A uniform
 * 5000 m plateau would NOT obstruct anything, because the observer stands on it and the
 * sight line runs above it: using one would make this repro fail for a reason that has
 * nothing to do with the sample count.
 * @param {number} f - Fraction of the way along the line.
 * @returns {number} Elevation in meters.
 */
const montanhaDe5km = f => (f > 0.4 && f < 0.6 ? 5000 : 0);

beforeEach(() => {
    vi.mocked(amostraElevacao).mockImplementation((coord) => montanhaDe5km(coord[0]));
});

afterEach(() => {
    vi.mocked(amostraElevacao).mockReset();
    vi.mocked(amostraElevacao).mockReturnValue(0);
    vi.mocked(createTerrainSampler).mockClear();
    delete globalThis.turf;
});

describe('repro: LOS com contagem de amostras nao finita falhava ABERTO', () => {
    it('CONTROLE: com uma contagem numerica a montanha sempre foi detectada', async () => {
        stubTurf(1000);
        const r = await geom.calculateLOS(LINHA, {}, { samplePoints: 10 });
        expect(r.obstructed).not.toBeNull();
        expect(r.obstructedLength).toBeGreaterThan(0);
    });

    it('CONTROLE do terreno: sem montanha, a mesma linha e toda visivel', async () => {
        // Ensures the assertions below are about the sample count and not about a sweep
        // that now reports obstruction for everything.
        vi.mocked(amostraElevacao).mockReturnValue(0);
        stubTurf(1000);
        const r = await geom.calculateLOS(LINHA, {}, { samplePoints: 10 });
        expect(r.obstructed).toBeNull();
        expect(r.visibleLength).toBe(1000);
    });

    it('samplePoints NaN NAO declara mais tudo visivel', async () => {
        stubTurf(1000);
        const r = await geom.calculateLOS(LINHA, {}, { samplePoints: NaN });
        expect(r.obstructed).not.toBeNull();
        expect(r.obstructedLength).toBeGreaterThan(0);
        expect(r.visibleLength).toBeLessThan(r.totalLength);
    });

    it('o laco volta a amostrar: antes eram ZERO consultas ao terreno intermediario', async () => {
        const turfStub = stubTurf(1000);
        await geom.calculateLOS(LINHA, {}, { samplePoints: NaN });
        expect(turfStub.alongCalls.length).toBeGreaterThan(0);
    });

    it('a mesma protecao vale para Infinity, string e outros nao-finitos', async () => {
        const ruins = [NaN, Infinity, -Infinity, '50', {}];
        expect(ruins).toHaveLength(5);
        for (const ruim of ruins) {
            stubTurf(1000);
            const r = await geom.calculateLOS(LINHA, {}, { samplePoints: ruim });
            expect(r.obstructed, `samplePoints ${String(ruim)}`).not.toBeNull();
        }
    });

    it('a feature criada pelo controle tambem para de mentir', async () => {
        // createLOSFeature is what add_los_control.js calls on the second click, and it
        // forwards properties.samplePoints straight into the options.
        stubTurf(1000);
        const f = await geom.createLOSFeature(LINHA, { samplePoints: NaN }, {});
        expect(f.geometry.type).toBe('MultiLineString');
        expect(f.properties.obstructedLength).toBeGreaterThan(0);
        expect(f.properties.visibleLength).toBeLessThan(f.properties.totalLength);
    });

    it('a contagem finita continua sendo respeitada, o padrao NAO se impoe', async () => {
        // Guards against "fix" by hard-coding the default: 4 samples must still mean 4.
        vi.mocked(amostraElevacao).mockReturnValue(0);
        const turfStub = stubTurf(1000);
        await geom.calculateLOS(LINHA, {}, { samplePoints: 4 });
        expect(turfStub.alongCalls).toEqual([250, 500, 750]);
    });
});
