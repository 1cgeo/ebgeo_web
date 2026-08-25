// Path: tests/integration/visibilidade-azimute-360.repro.test.js

/**
 * @fileoverview Regression repro: the visibility sector used to persist an azimuth of
 * exactly 360, a value its own JSDoc excludes.
 *
 * ROOT CAUSE
 * `AddVisibilityGeometry.calculateBearing` normalized a negative `atan2` result with
 * `if (bearing < 0) bearing += 360`. For any negative smaller than half the double
 * spacing near 360 (~2.84e-14) that addition rounds to 360 EXACTLY, so every target a
 * hair WEST of due north answered 360 instead of 0. The documented contract is
 * `[0, 360)`. Fixed with `((bearing % 360) + 360) % 360`, which cannot land on 360.
 *
 * WHY IT IS A PRODUCT DEFECT AND NOT A UNIT CURIOSITY
 * The number does not stay in the function. `createVisibilityFeature` stamps it into
 * `properties.bearing`, and `add_visibility_control.js` writes `result.bearing` back into
 * the selected feature on every handle drag, so the out-of-range value is PERSISTED and
 * travels through sync and through `.ebgeo`. Any consumer that reads the property as a
 * compass azimuth in `[0, 360)` reads a value the contract says cannot exist.
 *
 * WHAT THIS REPRO DOES NOT REACH
 * MapLibre, the store and the attributes panel: it drives the geometry class directly,
 * which is where the number is minted and where the fix lives.
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

vi.mock('@js/terrain', () => ({ getTerrainElevation: vi.fn() }));

const { getTerrainElevation } = await import('@js/terrain');
const { default: AddVisibilityGeometry } = await import(
    '../../src/js/analysis_tools/visibility_tool/add_visibility_geometry.js'
);

const geom = new AddVisibilityGeometry();

/** A target a hair WEST of due north: the exact input that produced 360. */
const UM_FIO_A_OESTE_DO_NORTE = [-1e-16, 1];

beforeEach(() => {
    vi.mocked(getTerrainElevation).mockResolvedValue(0);
    globalThis.turf = { distance: () => 100 };
});

afterEach(() => {
    vi.mocked(getTerrainElevation).mockReset();
    delete globalThis.turf;
});

describe('repro: azimute 360 no setor de visibilidade', () => {
    it('CONTROLE: um alvo francamente a oeste continua devolvendo 270', () => {
        // Proves the normalization branch still discriminates. Without this the repro
        // below would also pass against a function that returned 0 for everything.
        expect(geom.calculateBearing([0, 0], [-1, 0])).toBeCloseTo(270, 10);
        expect(geom.calculateBearing([0, 0], [1, 0])).toBeCloseTo(90, 10);
        expect(geom.calculateBearing([0, 0], [0, -1])).toBeCloseTo(180, 10);
    });

    it('o azimute cunhado fica em [0, 360), e para este alvo vale 0 e nao 360', () => {
        const azimute = geom.calculateBearing([0, 0], UM_FIO_A_OESTE_DO_NORTE);
        expect(azimute).toBe(0);
        expect(azimute).toBeGreaterThanOrEqual(0);
        expect(azimute).toBeLessThan(360);
    });

    it('o azimute PERSISTIDO na feature respeita o intervalo documentado', async () => {
        // This is the path the tool actually takes on the second click.
        const f = await geom.createVisibilityFeature(
            [0, 0], UM_FIO_A_OESTE_DO_NORTE, { id: 'v-repro', aperture: 2 }, {},
        );
        expect(f.properties.bearing).toBe(0);
        expect(f.properties.bearing).toBeLessThan(360);
    });

    it('o azimute reescrito ao ARRASTAR o handle de raio tambem respeita o intervalo', () => {
        // add_visibility_control.js assigns this straight into properties.bearing.
        const feature = {
            properties: { center: [0, 0], radius: 5000, bearing: 0, aperture: 60, id: 'v1' },
        };
        const r = geom.updateFromHandle('radius', [-1e-16, 1], feature);
        expect(r).not.toBeNull();
        expect(r.bearing).toBe(0);
        expect(r.bearing).toBeLessThan(360);
    });

    it('a fronteira e do ARREDONDAMENTO, e o vizinho logo fora dela nunca foi 360', () => {
        // A dLng of -1e-14 becomes a raw bearing of about -5.7e-13 degrees, already wider
        // than the half-ULP, so it landed just BELOW 360 even before the fix. Pinning both
        // sides keeps a future reader from mistaking the cliff for a wide plateau.
        const dentro = geom.calculateBearing([0, 0], [-1e-16, 1]);
        const fora = geom.calculateBearing([0, 0], [-1e-14, 1]);
        expect(dentro).toBe(0);
        expect(fora).toBeLessThan(360);
        expect(fora).toBeCloseTo(360, 10);
    });
});
