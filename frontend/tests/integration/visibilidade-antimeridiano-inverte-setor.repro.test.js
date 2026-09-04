// Path: tests/integration/visibilidade-antimeridiano-inverte-setor.repro.test.js

/**
 * @fileoverview Regression repro: a visibility sector drawn ACROSS the antimeridian
 * pointed 180 degrees away from where the operator clicked.
 *
 * ROOT CAUSE
 * `AddVisibilityGeometry.calculateBearing` subtracted raw longitudes
 * (`point[0] - center[0]`). For an observer at 179.5 and a target at -179.5 that is
 * `-359`, not `+1`, so the azimuth came out 270 (due WEST) for a target 1 degree due
 * EAST. Fixed by unwrapping the difference into `(-180, 180]` before the `atan2`.
 *
 * WHY IT IS A PRODUCT DEFECT
 * The tool is a two-click affair: the second click gives direction AND radius. On the
 * wrong side of 180 the preview drawn under the cursor, the sector persisted by
 * `createVisibilityFeature`, and the viewshed swept by `calculateViewshed` all faced the
 * opposite half of the horizon. Nothing errored: the operator got a well-formed analysis
 * of the wrong terrain, which is the failure mode that costs the most in this tool.
 *
 * WHAT THIS REPRO DOES NOT REACH
 * MapLibre and the store. It drives the geometry class, which is where the azimuth is
 * minted and where every one of those three consumers reads it from.
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
const { default: AddVisibilityGeometry } = await import(
    '../../src/js/analysis_tools/visibility_tool/add_visibility_geometry.js'
);

const geom = new AddVisibilityGeometry();

/** Observer just west of 180, target just east of it: 1 degree apart, going EAST. */
const OBSERVADOR = [179.5, 0];
const ALVO = [-179.5, 0];

beforeEach(() => {
    vi.mocked(amostraElevacao).mockReturnValue(0);
    globalThis.turf = { distance: () => 111000 };
});

afterEach(() => {
    vi.mocked(amostraElevacao).mockReset();
    vi.mocked(amostraElevacao).mockReturnValue(0);
    vi.mocked(createTerrainSampler).mockClear();
    delete globalThis.turf;
});

describe('repro: setor de visibilidade cruzando o antimeridiano', () => {
    it('CONTROLE: a MESMA geometria longe do antimeridiano sempre deu leste (90)', () => {
        // Independent of the module: the target sits at +1 degree of longitude, so the
        // planar bearing is atan2(1, 0) = 90. This is the number the wrapped case must
        // reproduce, and it never regressed, which is what makes it the control.
        expect(geom.calculateBearing([0, 0], [1, 0])).toBeCloseTo(90, 10);
    });

    it('o azimute atraves de 180 e LESTE (90), nao oeste (270)', () => {
        expect(geom.calculateBearing(OBSERVADOR, ALVO)).toBeCloseTo(90, 6);
    });

    it('vale no sentido inverso: de leste para oeste da 270', () => {
        expect(geom.calculateBearing(ALVO, OBSERVADOR)).toBeCloseTo(270, 6);
    });

    it('a feature persistida guarda o azimute de LESTE', async () => {
        const f = await geom.createVisibilityFeature(
            OBSERVADOR, ALVO, { id: 'v-anti', aperture: 2 }, {},
        );
        expect(f.properties.bearing).toBeCloseTo(90, 6);
        expect(f.properties.center).toEqual(OBSERVADOR);
    });

    it('o setor previsto sob o cursor cai a LESTE do observador, nao a oeste', () => {
        // calculateSectorPreview is the live path from add_visibility_control.js while the
        // operator is still moving the mouse. Checking the drawn ring, not the azimuth,
        // makes the assertion independent of the number the previous cases pin.
        const anel = geom.calculateSectorPreview(OBSERVADOR, ALVO, 60);
        expect(anel.length).toBeGreaterThan(3);
        const arco = anel.slice(1, -1);
        expect(arco.length).toBeGreaterThan(0);
        for (const [lng] of arco) {
            // Eastward means every arc vertex sits at a longitude GREATER than the
            // observer's, in the unwrapped frame the flat model works in.
            expect(lng).toBeGreaterThan(OBSERVADOR[0]);
        }
    });

    it('CONTROLE do desenho: um alvo a OESTE de verdade poe o arco a oeste', () => {
        // Same assertion shape, opposite expectation, so the loop above is not measuring
        // "every ring leans east".
        const anel = geom.calculateSectorPreview([0, 0], [-1, 0], 60);
        const arco = anel.slice(1, -1);
        expect(arco.length).toBeGreaterThan(0);
        for (const [lng] of arco) {
            expect(lng).toBeLessThan(0);
        }
    });
});
