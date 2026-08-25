// Path: tests/unit/visibility-geometry.test.js

/**
 * @fileoverview Pins the pure geometry and the viewshed sweep of
 * `frontend/src/js/analysis_tools/visibility_tool/add_visibility_geometry.js`.
 *
 * WHAT THIS SUITE PINS
 * - The local flat-earth model (`calculateBearing` / `pointAtBearing`): cardinal
 *   directions in absolute degrees, the cos(lat) longitude stretch checked against
 *   an INDEPENDENT number (a degree of longitude at 60N is half a degree at the
 *   equator), and the round trip as a fast-check invariant derived from the
 *   displacement, not from composing the two functions.
 * - `validate`, `calculateDistanceStep`, `updateFromHandle`, `createHandles`,
 *   `generateSectorGeometry`, `generateWedgePolygon`, `generateWedgeCells`,
 *   `generateProcessedFeatures`, `normalizeCenter`, `isValidCenter`,
 *   `normalizeFeatureProperties`, `translateGeometry`, `extractCenterFromGeometry`,
 *   `getBoundingBox`, `isTerrainAvailable`, `createVisibilityFeature` and
 *   `recalculateFromCoordinates`.
 * - `calculateViewshed`, driven end to end with a synthetic terrain: flat ground,
 *   a ridge, and the contract that `targetHeight` is added ONLY to the point being
 *   evaluated and NEVER to the max-angle barrier. The cell count is asserted in
 *   absolute terms, because a loop over a collection of unasserted size proves
 *   nothing.
 *
 * WHAT IT DOES NOT REACH
 * - Anything in `add_visibility_control.js` (MapLibre, store, modals).
 * - The real `getTerrainElevation`: it is mocked, so terrain querying, the DEM
 *   round trip and the map wiring are out of scope. Only the classification math
 *   built on top of it is measured here.
 * - The real turf: only the methods the module calls are stubbed, so this suite
 *   says nothing about turf's own correctness, just about the delegation.
 * - The two processing outputs (`processed_los`, `processed_visibility`) are drawn
 *   and never named; this suite deliberately does NOT assert a label or an icon
 *   for them.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

// `add_visibility_geometry` extends BaseGeometry from the `@tools` barrel, which drags
// DOM/MapLibre-coupled modules into a `node` run. Mock the barrel, but wire the ONE
// inherited method the class actually uses (`calculateDistance`) to the real haversine
// from `utilities/geometry-utils.js`, which is a leaf module with zero imports. Stubbing
// it with a fake would make distance-gated branches (the 10 m floor of `updateFromHandle`)
// measure the stub instead of the module.
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

/** Meters per degree of latitude, the constant baked into the module's flat model. */
const M_PER_DEG = 111320;

/** Silences the console.error/warn the module writes on invalid input. */
let errSpy;
let warnSpy;
beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    errSpy.mockRestore();
    warnSpy.mockRestore();
    vi.mocked(getTerrainElevation).mockReset();
});

// ============================================================================
// calculateBearing (own copy, geographic: 0 = North, clockwise)
// ============================================================================

describe('AddVisibilityGeometry.calculateBearing', () => {
    const c = [0, 0];

    it('norte -> 0', () => expect(geom.calculateBearing(c, [0, 1])).toBeCloseTo(0, 10));
    it('leste -> 90', () => expect(geom.calculateBearing(c, [1, 0])).toBeCloseTo(90, 10));
    it('sul -> 180', () => expect(geom.calculateBearing(c, [0, -1])).toBeCloseTo(180, 10));
    it('oeste -> 270', () => expect(geom.calculateBearing(c, [-1, 0])).toBeCloseTo(270, 10));

    it('ponto coincidente com o centro -> 0 (atan2(0,0) === 0)', () => {
        expect(geom.calculateBearing(c, [0, 0])).toBe(0);
    });

    it('property: a saida fica em [0, 360), com o fechado da direita EXCLUIDO', () => {
        // The JSDoc promises [0, 360), and since the modulo normalization it delivers it.
        fc.assert(fc.property(
            fc.double({ min: -80, max: 80, noNaN: true }),
            fc.double({ min: -10, max: 10, noNaN: true }),
            fc.double({ min: -10, max: 10, noNaN: true }),
            (lat0, dLng, dLat) => {
                const b = geom.calculateBearing([0, lat0], [dLng, lat0 + dLat]);
                expect(b).toBeGreaterThanOrEqual(0);
                expect(b).toBeLessThan(360);
            },
        ));
    });

    // ------------------------------------------------------------- fixed defect
    // `if (bearing < 0) bearing += 360` landed exactly ON 360 whenever the raw atan2
    // was a negative smaller than half the double spacing near 360 (~2.84e-14), which
    // is every point a hair WEST of due north. Now `((b % 360) + 360) % 360`.
    it('CONTROLE: um oeste franco continua devolvendo 270, o ramo discrimina', () => {
        expect(geom.calculateBearing([0, 0], [-1, 0])).toBeCloseTo(270, 10);
    });

    it('um fio a oeste do norte devolve 0, nao 360 (era 360 EXATO)', () => {
        expect(geom.calculateBearing([0, 0], [-1e-16, 1])).toBe(0);
        // The boundary is in the BEARING, not in the longitude: atan2 turns a dLng of
        // -1e-14 into about -5.7e-13 degrees, already wider than the ~2.84e-14 half-ULP,
        // so this one never reached 360 even before the fix. Kept as the neighbour that
        // shows where the cliff is.
        expect(geom.calculateBearing([0, 0], [-1e-14, 1])).toBeCloseTo(360, 10);
        expect(geom.calculateBearing([0, 0], [-1e-14, 1])).toBeLessThan(360);
    });

    it('DEFEITO CORRIGIDO: calculateBearing fica no intervalo [0, 360) documentado', () => {
        expect(geom.calculateBearing([0, 0], [-1e-16, 1])).toBeLessThan(360);
    });

    it('a latitude do CENTRO e quem estica a longitude, nao a do ponto', () => {
        // At 60N a degree of longitude spans half of a degree of latitude, so the same
        // dLng leans the bearing half as far from north. Independent check: the planar
        // displacement is (0.5, 1), whose bearing is atan2(0.5, 1).
        const esperado = Math.atan2(1 * Math.cos(60 * Math.PI / 180), 1) * 180 / Math.PI;
        expect(geom.calculateBearing([0, 60], [1, 61])).toBeCloseTo(esperado, 10);
        expect(esperado).toBeCloseTo(26.5650511771, 8);
    });

    // ------------------------------------------------------------- fixed defect
    // The formula subtracted raw longitudes, so a pair straddling the antimeridian
    // produced dLng = -359 instead of +1 and the bearing pointed the long way round.
    it('CONTROLE: a mesma geometria LONGE do antimeridiano da leste (90)', () => {
        expect(geom.calculateBearing([0, 0], [1, 0])).toBeCloseTo(90, 10);
    });

    it('DEFEITO CORRIGIDO: calculateBearing desenrola a longitude no antimeridiano', () => {
        // The two points are 1 degree apart going EAST; the correct bearing is 90.
        // Before the unwrap this answered 270, pointing due west.
        expect(geom.calculateBearing([179.5, 0], [-179.5, 0])).toBeCloseTo(90, 6);
    });

    it('o desenrolamento vale nos DOIS sentidos e nao mexe no caso comum', () => {
        expect(geom.calculateBearing([-179.5, 0], [179.5, 0])).toBeCloseTo(270, 6);
        // Exactly 180 of separation is the ambiguous case and is NOT unwrapped: the
        // strict comparison leaves it as the eastward reading.
        expect(geom.calculateBearing([0, 0], [180, 0])).toBeCloseTo(90, 6);
        expect(geom.calculateBearing([0, 0], [-1, 0])).toBeCloseTo(270, 10);
    });
});

// ============================================================================
// pointAtBearing (own copy, flat local model)
// ============================================================================

describe('AddVisibilityGeometry.pointAtBearing', () => {
    it('raio 0 devolve o proprio centro, exatamente', () => {
        expect(geom.pointAtBearing([10, -20], 0, 137)).toEqual([10, -20]);
    });

    it('bearing 0 anda exatamente um grau de latitude para 111320 m', () => {
        const p = geom.pointAtBearing([0, 0], M_PER_DEG, 0);
        expect(p[0]).toBeCloseTo(0, 12);
        expect(p[1]).toBeCloseTo(1, 12);
    });

    it('bearing 180 anda para o sul', () => {
        expect(geom.pointAtBearing([0, 0], M_PER_DEG, 180)[1]).toBeCloseTo(-1, 12);
    });

    it('a 60N o mesmo deslocamento leste vale DOIS graus de longitude', () => {
        // Independent number: cos(60) = 0.5 exactly, so the longitude step doubles.
        expect(geom.pointAtBearing([0, 60], M_PER_DEG, 90)[0]).toBeCloseTo(2, 9);
        expect(geom.pointAtBearing([0, 0], M_PER_DEG, 90)[0]).toBeCloseTo(1, 12);
    });

    it('bearing 360 coincide com bearing 0 (a menos do erro de ponto flutuante)', () => {
        const a = geom.pointAtBearing([0, 0], 1000, 0);
        const b = geom.pointAtBearing([0, 0], 1000, 360);
        expect(b[0]).toBeCloseTo(a[0], 12);
        expect(b[1]).toBeCloseTo(a[1], 12);
    });

    it('property: o deslocamento planar tem modulo === raio e direcao === bearing', () => {
        // Derived from the CONTRACT (a point at distance r and bearing b in the local
        // flat frame), not by calling calculateBearing back, so the instrument is not
        // the subject.
        fc.assert(fc.property(
            fc.double({ min: -70, max: 70, noNaN: true }),
            fc.double({ min: 1, max: 200000, noNaN: true }),
            fc.double({ min: 0, max: 359.999, noNaN: true }),
            (lat0, r, b) => {
                const [lng, lat] = geom.pointAtBearing([0, lat0], r, b);
                const dy = (lat - lat0) * M_PER_DEG;
                const dx = (lng - 0) * Math.cos(lat0 * Math.PI / 180) * M_PER_DEG;
                expect(Math.hypot(dx, dy)).toBeCloseTo(r, 3);
                let ang = Math.atan2(dx, dy) * 180 / Math.PI;
                if (ang < 0) ang += 360;
                const erro = Math.min(Math.abs(ang - b), 360 - Math.abs(ang - b));
                expect(erro).toBeLessThan(1e-6);
            },
        ));
    });

    it('OBSERVADO: no polo o modelo plano estoura a longitude (cos(90) ~ 6e-17)', () => {
        const p = geom.pointAtBearing([0, 90], 1000, 90);
        expect(Number.isFinite(p[0])).toBe(true);
        expect(Math.abs(p[0])).toBeGreaterThan(1e13);
    });
});

// ============================================================================
// validate
// ============================================================================

describe('AddVisibilityGeometry.validate', () => {
    it('aceita parametros validos', () => {
        expect(geom.validate([0, 0], 1000, 60)).toBe(true);
    });

    it('recusa centro ausente, curto ou nao-array', () => {
        expect(geom.validate(null, 1000, 60)).toBe(false);
        expect(geom.validate(undefined, 1000, 60)).toBe(false);
        expect(geom.validate([0], 1000, 60)).toBe(false);
        expect(geom.validate('0,0', 1000, 60)).toBe(false);
    });

    it('recusa raio nao-numerico, zero ou negativo', () => {
        expect(geom.validate([0, 0], 0, 60)).toBe(false);
        expect(geom.validate([0, 0], -1, 60)).toBe(false);
        expect(geom.validate([0, 0], '1000', 60)).toBe(false);
    });

    it('aceita as fronteiras 1 e 359 de abertura e recusa fora delas', () => {
        expect(geom.validate([0, 0], 1000, 1)).toBe(true);
        expect(geom.validate([0, 0], 1000, 359)).toBe(true);
        expect(geom.validate([0, 0], 1000, 0.999)).toBe(false);
        expect(geom.validate([0, 0], 1000, 359.001)).toBe(false);
        expect(geom.validate([0, 0], 1000, 360)).toBe(false);
    });

    it('recusa +Infinity de abertura (359 < Inf) e -Infinity (Inf < 1)', () => {
        expect(geom.validate([0, 0], 1000, Infinity)).toBe(false);
        expect(geom.validate([0, 0], 1000, -Infinity)).toBe(false);
    });

    // ------------------------------------------------------------- fixed defect
    it('CONTROLE: validate discrimina, um raio negativo e recusado', () => {
        expect(geom.validate([0, 0], -5, 60)).toBe(false);
    });

    it('DEFEITO CORRIGIDO: validate recusa NaN, toda comparacao com NaN e false', () => {
        expect(geom.validate([0, 0], NaN, 60)).toBe(false);
    });

    it('DEFEITO CORRIGIDO: validate recusa abertura NaN', () => {
        expect(geom.validate([0, 0], 1000, NaN)).toBe(false);
    });

    it('DEFEITO CORRIGIDO: validate recusa raio Infinity', () => {
        expect(geom.validate([0, 0], Infinity, 60)).toBe(false);
        expect(geom.validate([0, 0], -Infinity, 60)).toBe(false);
    });

    it('OBSERVADO: o CONTEUDO do centro segue sem validacao, [NaN, NaN] atravessa', () => {
        // Number.isFinite now guards radius and aperture, but the center is still only
        // checked for shape (array of length >= 2), which is a separate hole.
        expect(geom.validate([NaN, NaN], 1000, 60)).toBe(true);
    });
});

// ============================================================================
// calculateDistanceStep
// ============================================================================

describe('AddVisibilityGeometry.calculateDistanceStep', () => {
    it('raio pequeno cai no piso de 30 m', () => {
        expect(geom.calculateDistanceStep(100, 60)).toBe(30);
        expect(geom.calculateDistanceStep(1, 60)).toBe(30);
    });

    it('numero de controle absoluto: raio 600000 e abertura 60', () => {
        // numRays = 60; idealPointsPerRay = round(10000/60) = 167;
        // idealStep = 600000/167 = 3592.81...; ceil(3592.81/30) = 120; 120*30 = 3600.
        expect(geom.calculateDistanceStep(600000, 60)).toBe(3600);
    });

    it('abertura 0 nao divide por zero (guarda Math.max(1, numRays))', () => {
        expect(geom.calculateDistanceStep(1000, 0)).toBe(30);
    });

    it('raio negativo ainda devolve o piso', () => {
        expect(geom.calculateDistanceStep(-5000, 60)).toBe(30);
    });

    it('property: a saida e sempre multiplo de 30 e >= 30', () => {
        fc.assert(fc.property(
            fc.double({ min: 1, max: 1e6, noNaN: true }),
            fc.double({ min: 1, max: 359, noNaN: true }),
            (radius, aperture) => {
                const step = geom.calculateDistanceStep(radius, aperture);
                expect(step).toBeGreaterThanOrEqual(30);
                expect(step % 30).toBe(0);
            },
        ));
    });

    // ------------------------------------------------------------- fixed defect
    it('CONTROLE: com abertura finita o passo respeita o invariante', () => {
        const step = geom.calculateDistanceStep(50000, 45);
        expect(step % 30).toBe(0);
        expect(step).toBeGreaterThanOrEqual(30);
    });

    it('DEFEITO CORRIGIDO: abertura NaN (ou raio NaN/Infinity) cai no piso, nao em NaN', () => {
        // Was NaN, NaN and Infinity respectively; none of the three is a multiple of 30.
        expect(geom.calculateDistanceStep(1000, NaN)).toBe(30);
        expect(geom.calculateDistanceStep(NaN, 60)).toBe(30);
        expect(geom.calculateDistanceStep(Infinity, 60)).toBe(30);
    });

    it('DEFEITO CORRIGIDO: o invariante "multiplo de 30" sobrevive a entrada nao-finita', () => {
        for (const ruim of [NaN, Infinity, -Infinity, undefined, null, '600']) {
            const step = geom.calculateDistanceStep(1000, ruim);
            expect(step, `abertura ${String(ruim)}`).toBeGreaterThanOrEqual(30);
            expect(step % 30, `abertura ${String(ruim)}`).toBe(0);
            const stepR = geom.calculateDistanceStep(ruim, 60);
            expect(stepR, `raio ${String(ruim)}`).toBeGreaterThanOrEqual(30);
            expect(stepR % 30, `raio ${String(ruim)}`).toBe(0);
        }
    });
});

// ============================================================================
// generateSectorGeometry / generate / calculateSectorPreview
// ============================================================================

describe('AddVisibilityGeometry.generateSectorGeometry', () => {
    it('devolve Polygon com anel fechado e apice no centro', () => {
        const g = geom.generateSectorGeometry([0, 0], 1000, 0, 60);
        expect(g.type).toBe('Polygon');
        const ring = g.coordinates[0];
        // numArcPoints = max(16, round(64*60/360) = 11) = 16 -> 1 + 17 + 1 = 19
        expect(ring.length).toBe(19);
        expect(ring[0]).toEqual([0, 0]);
        expect(ring[ring.length - 1]).toEqual([0, 0]);
    });

    it('abertura grande sobe o numero de pontos do arco', () => {
        // round(64*360/360) = 64 -> 1 + 65 + 1 = 67
        expect(geom.generateSectorGeometry([0, 0], 1000, 0, 360).coordinates[0].length).toBe(67);
    });

    it('o arco varre de bearing - abertura/2 ate bearing + abertura/2', () => {
        const ring = geom.generateSectorGeometry([0, 0], M_PER_DEG, 90, 60).coordinates[0];
        // First arc point sits at bearing 60, last at 120. Independent check by the
        // planar displacement of each.
        const primeiro = ring[1];
        const ultimo = ring[ring.length - 2];
        expect(Math.atan2(primeiro[0], primeiro[1]) * 180 / Math.PI).toBeCloseTo(60, 6);
        expect(Math.atan2(ultimo[0], ultimo[1]) * 180 / Math.PI).toBeCloseTo(120, 6);
    });

    it('generate() delega para generateSectorGeometry', () => {
        expect(geom.generate([1, 2], 500, 10, 30))
            .toEqual(geom.generateSectorGeometry([1, 2], 500, 10, 30));
    });

    it('OBSERVADO: abertura NaN produz um anel degenerado de 2 pontos', () => {
        // Math.max(16, NaN) === NaN, so the arc loop never runs and the ring is
        // [center, center]: a polygon that no renderer can draw.
        const ring = geom.generateSectorGeometry([0, 0], 1000, 0, NaN).coordinates[0];
        expect(ring.length).toBe(2);
        expect(ring[0]).toEqual([0, 0]);
    });

    it('calculateSectorPreview usa a distancia HAVERSINE como raio', () => {
        const centro = [0, 0];
        const borda = [0, 1];
        const ring = geom.calculateSectorPreview(centro, borda, 60);
        expect(Array.isArray(ring)).toBe(true);
        expect(ring.length).toBe(19);
        expect(ring[0]).toEqual([0, 0]);
        // The inherited calculateDistance is a SPHERICAL haversine on R = 6371000 m,
        // so one degree of latitude is 6371000 * pi/180 = 111194.93 m, not the 111320 m
        // of the module's own flat model. Two conventions, ~0.11% apart, in one call.
        const raioHaversine = geom.calculateDistance(centro, borda);
        expect(raioHaversine).toBeCloseTo(6371000 * Math.PI / 180, 6);
        expect(raioHaversine).toBeCloseTo(111194.93, 1);
        expect(Math.abs(raioHaversine - M_PER_DEG)).toBeGreaterThan(100);
    });
});

// ============================================================================
// createHandles
// ============================================================================

describe('AddVisibilityGeometry.createHandles', () => {
    const feature = {
        properties: { center: [0, 0], radius: M_PER_DEG, bearing: 0, aperture: 60, id: 'f1' },
    };

    it('devolve exatamente tres handles, na ordem raio, abertura, centro', () => {
        const handles = geom.createHandles(feature);
        expect(handles).toHaveLength(3);
        expect(handles.map(h => h.properties.handleId)).toEqual(['radius', 'aperture', 'center']);
        expect(handles.map(h => h.id)).toEqual([
            'visibility-handle-f1-radius',
            'visibility-handle-f1-aperture',
            'visibility-handle-f1-center',
        ]);
    });

    it('o handle de raio fica no eixo e o de abertura na borda do arco', () => {
        const [raio, abertura, centro] = geom.createHandles(feature);
        expect(raio.geometry.coordinates[1]).toBeCloseTo(1, 9);
        // bearing + aperture/2 = 30 degrees.
        const p = abertura.geometry.coordinates;
        expect(Math.atan2(p[0], p[1]) * 180 / Math.PI).toBeCloseTo(30, 6);
        expect(centro.geometry.coordinates).toEqual([0, 0]);
    });

    it('so o handle de centro nasce com user_isEditingHandle false', () => {
        const handles = geom.createHandles(feature);
        expect(handles.map(h => h.properties.user_isEditingHandle)).toEqual([true, true, false]);
    });

    it('centro invalido -> null', () => {
        expect(geom.createHandles({ properties: { center: null } })).toBeNull();
        expect(geom.createHandles({ properties: { center: '{oops' } })).toBeNull();
    });
});

// ============================================================================
// updateFromHandle / calculatePreview
// ============================================================================

describe('AddVisibilityGeometry.updateFromHandle', () => {
    const base = () => ({
        properties: { center: [0, 0], radius: 5000, bearing: 0, aperture: 60, id: 'f1' },
    });

    it('handleId desconhecido -> null', () => {
        expect(geom.updateFromHandle('bogus', [0, 1], base())).toBeNull();
        expect(geom.updateFromHandle(undefined, [0, 1], base())).toBeNull();
    });

    it('centro invalido -> null antes de qualquer conta', () => {
        expect(geom.updateFromHandle('radius', [0, 1], { properties: { center: 'x' } })).toBeNull();
    });

    it('raio: abaixo de 10 m -> null (piso estrito <)', () => {
        // 9 m north of the equator in degrees of latitude.
        const perto = [0, 9 / 110574.4];
        expect(geom.updateFromHandle('radius', perto, base())).toBeNull();
    });

    it('raio: exatamente na fronteira de 10 m NAO e recusado', () => {
        const dezMetros = [0, 10.0001 / 110574.4];
        const r = geom.updateFromHandle('radius', dezMetros, base());
        expect(r).not.toBeNull();
        expect(r.radius).toBeGreaterThanOrEqual(10);
    });

    it('raio: reescreve TAMBEM o bearing e preserva a abertura', () => {
        const r = geom.updateFromHandle('radius', [1, 0], base());
        expect(r.bearing).toBeCloseTo(90, 6);
        expect(r.radius).toBeCloseTo(geom.calculateDistance([0, 0], [1, 0]), 6);
        expect(r.aperture).toBe(60);
        expect(r.geometry.type).toBe('Polygon');
    });

    it('abertura: o handle a 30 do eixo produz abertura 60', () => {
        const p = geom.pointAtBearing([0, 0], 5000, 30);
        expect(geom.updateFromHandle('aperture', p, base()).aperture).toBe(60);
    });

    it('abertura: o espelho, o handle a -30 do eixo tambem produz 60', () => {
        const p = geom.pointAtBearing([0, 0], 5000, 330);
        expect(geom.updateFromHandle('aperture', p, base()).aperture).toBe(60);
    });

    it('abertura: sobre o proprio eixo -> clamp para o minimo 1', () => {
        const p = geom.pointAtBearing([0, 0], 5000, 0);
        expect(geom.updateFromHandle('aperture', p, base()).aperture).toBe(1);
    });

    it('abertura: oposto ao eixo (180) -> clamp para o maximo 359, nunca 360', () => {
        const p = geom.pointAtBearing([0, 0], 5000, 180);
        expect(geom.updateFromHandle('aperture', p, base()).aperture).toBe(359);
    });

    it('abertura: preserva raio e bearing do feature', () => {
        const p = geom.pointAtBearing([0, 0], 5000, 45);
        const r = geom.updateFromHandle('aperture', p, base());
        expect(r.radius).toBe(5000);
        expect(r.bearing).toBe(0);
        expect(r.aperture).toBe(90);
    });

    it('property: a abertura resultante fica sempre no intervalo inteiro [1, 359]', () => {
        fc.assert(fc.property(fc.double({ min: 0, max: 359.999, noNaN: true }), (ang) => {
            const p = geom.pointAtBearing([0, 0], 5000, ang);
            const a = geom.updateFromHandle('aperture', p, base()).aperture;
            expect(Number.isInteger(a)).toBe(true);
            expect(a).toBeGreaterThanOrEqual(1);
            expect(a).toBeLessThanOrEqual(359);
        }));
    });

    it('nao muta o feature de entrada', () => {
        const f = base();
        const antes = JSON.stringify(f);
        geom.updateFromHandle('radius', [1, 1], f);
        geom.updateFromHandle('aperture', [1, 1], f);
        expect(JSON.stringify(f)).toBe(antes);
    });

    it('OBSERVADO: bearing ausente no feature propaga NaN ate a abertura', () => {
        const f = { properties: { center: [0, 0], radius: 5000, aperture: 60 } };
        const r = geom.updateFromHandle('aperture', [1, 1], f);
        expect(r.aperture).toBeNaN();
        // and the NaN aperture then degenerates the ring to two points
        expect(r.geometry.coordinates[0].length).toBe(2);
    });
});

describe('AddVisibilityGeometry.calculatePreview', () => {
    const base = () => ({
        properties: { center: [0, 0], radius: 5000, bearing: 0, aperture: 60, id: 'f1' },
    });

    it('devolve geometria, tres handles e os parametros atualizados', () => {
        const prev = geom.calculatePreview('radius', [0, 1], base());
        expect(prev.handles).toHaveLength(3);
        expect(prev.geometry.type).toBe('Polygon');
        expect(prev.handles[2]).toEqual([0, 0]);
        expect(prev.radius).toBeCloseTo(geom.calculateDistance([0, 0], [0, 1]), 6);
    });

    it('herda o null de updateFromHandle', () => {
        expect(geom.calculatePreview('bogus', [0, 1], base())).toBeNull();
        expect(geom.calculatePreview('radius', [0, 1e-9], base())).toBeNull();
    });
});

// ============================================================================
// generateWedgePolygon / generateWedgeCells
// ============================================================================

describe('AddVisibilityGeometry.generateWedgePolygon', () => {
    it('anel INTERNO zero: apice unico no centro, 5 pontos ao todo', () => {
        const ring = geom.generateWedgePolygon([0, 0], 0, 1000, 0, 1);
        // arcPoints = max(2, ceil(1/2)) = 2 -> 1 (apex) + 3 (outer) + 1 (closing) = 5
        expect(ring.length).toBe(5);
        expect(ring[0]).toEqual([0, 0]);
        expect(ring[ring.length - 1]).toBe(ring[0]);
    });

    it('anel interno positivo: dois arcos, 7 pontos ao todo', () => {
        const ring = geom.generateWedgePolygon([0, 0], 500, 1000, 0, 1);
        expect(ring.length).toBe(7);
        expect(ring[ring.length - 1]).toBe(ring[0]);
    });

    it('o arco externo e percorrido na ordem INVERSA do interno (anel simples)', () => {
        const ring = geom.generateWedgePolygon([0, 0], 500, 1000, 0, 1);
        const primeiroInterno = ring[0];
        const ultimoExterno = ring[ring.length - 2];
        // Both sit at startAngle, one at the inner radius and one at the outer.
        expect(Math.hypot(...primeiroInterno)).toBeLessThan(Math.hypot(...ultimoExterno));
    });

    it('largura angular maior sobe a densidade do arco', () => {
        expect(geom.generateWedgePolygon([0, 0], 0, 1000, 0, 20).length).toBe(1 + 11 + 1);
    });
});

describe('AddVisibilityGeometry.generateWedgeCells', () => {
    it('produz (raios - 1) x pontos celulas, e a contagem e asserida em absoluto', () => {
        const grid = [
            [{ visible: true }, { visible: false }],
            [{ visible: true }, { visible: true }],
            [{ visible: false }, { visible: false }],
        ];
        const cells = geom.generateWedgeCells(grid, [0, 0], 0, 1, 30, 2);
        expect(cells).toHaveLength(4);
        expect(cells.map(c => c.isVisible)).toEqual([true, false, true, true]);
        cells.forEach(c => expect(Array.isArray(c.coordinates)).toBe(true));
    });

    it('a classificacao de CADA celula vem do raio de indice menor, nunca do maior', () => {
        const grid = [
            [{ visible: true }],
            [{ visible: false }],
        ];
        const cells = geom.generateWedgeCells(grid, [0, 0], 0, 1, 30, 1);
        expect(cells).toHaveLength(1);
        expect(cells[0].isVisible).toBe(true);
    });

    it('um unico raio nao produz celula nenhuma', () => {
        expect(geom.generateWedgeCells([[{ visible: true }]], [0, 0], 0, 1, 30, 1)).toEqual([]);
    });

    it('OBSERVADO: numPointsPerRay maior que o raio lanca (assume alinhamento)', () => {
        const grid = [[{ visible: true }], [{ visible: true }]];
        expect(() => geom.generateWedgeCells(grid, [0, 0], 0, 1, 30, 2)).toThrow();
    });

    it('dissolveVisibilityCells hoje e identidade (mesma referencia)', () => {
        const cells = [{ coordinates: [], isVisible: true }];
        expect(geom.dissolveVisibilityCells(cells)).toBe(cells);
    });
});

// ============================================================================
// generateProcessedFeatures
// ============================================================================

describe('AddVisibilityGeometry.generateProcessedFeatures', () => {
    const mk = (coords, cellData) => ({
        properties: { id: 'v1', cellData },
        geometry: { type: 'MultiPolygon', coordinates: coords },
    });

    it('geometria que nao e MultiPolygon -> []', () => {
        expect(geom.generateProcessedFeatures({
            properties: { id: 'v1', cellData: [] },
            geometry: { type: 'Polygon', coordinates: [] },
        })).toEqual([]);
    });

    it('mistura visivel/obstruido -> exatamente duas features, visivel primeiro', () => {
        const f = mk([[[[0, 0]]], [[[1, 1]]]], [{ isVisible: true }, { isVisible: false }]);
        const out = geom.generateProcessedFeatures(f);
        expect(out).toHaveLength(2);
        expect(out[0].id).toBe('v1-visible');
        expect(out[0].properties.color).toBe('#00FF00');
        expect(out[0].geometry.coordinates).toEqual([[[[0, 0]]]]);
        expect(out[1].id).toBe('v1-obstructed');
        expect(out[1].properties.color).toBe('#FF0000');
        expect(out[1].geometry.coordinates).toEqual([[[[1, 1]]]]);
    });

    it('tudo visivel -> UMA feature; tudo obstruido -> UMA feature', () => {
        expect(geom.generateProcessedFeatures(
            mk([[[[0, 0]]]], [{ isVisible: true }]),
        )).toHaveLength(1);
        const so = geom.generateProcessedFeatures(mk([[[[0, 0]]]], [{ isVisible: false }]));
        expect(so).toHaveLength(1);
        expect(so[0].id).toBe('v1-obstructed');
    });

    it('MultiPolygon vazio -> [] (nenhuma das duas features nasce)', () => {
        expect(geom.generateProcessedFeatures(mk([], []))).toEqual([]);
    });

    it('o id da feature processada sobrescreve o id herdado nas properties', () => {
        const out = geom.generateProcessedFeatures(mk([[[[0, 0]]]], [{ isVisible: true }]));
        expect(out[0].properties.id).toBe('v1-visible');
    });

    it('OBSERVADO: cellData mais curto que as coordenadas LANCA (invariante de alinhamento)', () => {
        const f = mk([[[[0, 0]]], [[[1, 1]]]], [{ isVisible: true }]);
        expect(() => geom.generateProcessedFeatures(f)).toThrow(TypeError);
    });

    it('OBSERVADO: cellData ausente LANCA', () => {
        const f = mk([[[[0, 0]]]], undefined);
        expect(() => geom.generateProcessedFeatures(f)).toThrow(TypeError);
    });
});

// ============================================================================
// normalizeCenter / isValidCenter / normalizeFeatureProperties
// ============================================================================

describe('AddVisibilityGeometry.normalizeCenter', () => {
    it('array valido passa por referencia', () => {
        const c = [1, 2];
        expect(geom.normalizeCenter(c)).toBe(c);
    });

    it('string JSON de array e desserializada', () => {
        expect(geom.normalizeCenter('[1,2]')).toEqual([1, 2]);
    });

    it('JSON malformado -> null', () => {
        expect(geom.normalizeCenter('{oops')).toBeNull();
        expect(errSpy).toHaveBeenCalled();
    });

    it('JSON valido mas de forma errada -> null (nao vaza 42 nem null)', () => {
        expect(geom.normalizeCenter('42')).toBeNull();
        expect(geom.normalizeCenter('null')).toBeNull();
        expect(geom.normalizeCenter('"[1,2]"')).toBeNull();
    });

    it('array curto, null e undefined -> null', () => {
        expect(geom.normalizeCenter([1])).toBeNull();
        expect(geom.normalizeCenter(null)).toBeNull();
        expect(geom.normalizeCenter(undefined)).toBeNull();
    });

    it('OBSERVADO: nao valida o CONTEUDO, ["a","b"] atravessa', () => {
        expect(geom.normalizeCenter(['a', 'b'])).toEqual(['a', 'b']);
        expect(geom.normalizeCenter([NaN, NaN])).toEqual([NaN, NaN]);
    });
});

describe('AddVisibilityGeometry.isValidCenter', () => {
    it('aceita [0,0], que e falsy por coordenada mas valido', () => {
        expect(geom.isValidCenter([0, 0])).toBe(true);
    });
    it('aceita coordenada 3D (length >= 2)', () => {
        expect(geom.isValidCenter([1, 2, 3])).toBe(true);
    });
    it('recusa NaN, string e curto', () => {
        expect(geom.isValidCenter([NaN, 0])).toBe(false);
        expect(geom.isValidCenter([0, NaN])).toBe(false);
        expect(geom.isValidCenter(['1', '2'])).toBe(false);
        expect(geom.isValidCenter([1])).toBe(false);
    });
    it('recusa null/undefined sem lancar', () => {
        expect(geom.isValidCenter(null)).toBeFalsy();
        expect(geom.isValidCenter(undefined)).toBeFalsy();
    });
    it('OBSERVADO: aceita Infinity (o guarda e isNaN, nao Number.isFinite)', () => {
        expect(geom.isValidCenter([Infinity, 0])).toBe(true);
    });
});

describe('AddVisibilityGeometry.normalizeFeatureProperties', () => {
    it('preenche os quatro defaults quando ausentes', () => {
        expect(geom.normalizeFeatureProperties({})).toEqual({
            bearing: 0, aperture: 60, targetHeight: 0, observerHeight: 2,
        });
    });

    it('bearing cai para a propriedade legada angle', () => {
        expect(geom.normalizeFeatureProperties({ angle: 137 }).bearing).toBe(137);
        expect(geom.normalizeFeatureProperties({ bearing: 10, angle: 137 }).bearing).toBe(10);
    });

    it('usa ?? e NAO ||, entao o ZERO explicito sobrevive nos quatro campos', () => {
        const p = geom.normalizeFeatureProperties({
            bearing: 0, aperture: 0, targetHeight: 0, observerHeight: 0,
        });
        expect(p.aperture).toBe(0);
        expect(p.observerHeight).toBe(0);
        expect(p.targetHeight).toBe(0);
        expect(p.bearing).toBe(0);
    });

    it('null cai para o default, undefined tambem (semantica do ??)', () => {
        expect(geom.normalizeFeatureProperties({ aperture: null }).aperture).toBe(60);
        expect(geom.normalizeFeatureProperties({ observerHeight: null }).observerHeight).toBe(2);
    });

    it('preserva as demais propriedades e nao muta a entrada', () => {
        const entrada = { id: 'x', cor: 'azul' };
        const out = geom.normalizeFeatureProperties(entrada);
        expect(out.id).toBe('x');
        expect(out.cor).toBe('azul');
        expect(entrada).toEqual({ id: 'x', cor: 'azul' });
    });
});

// ============================================================================
// translateGeometry / extractCenterFromGeometry / getBoundingBox
// ============================================================================

describe('AddVisibilityGeometry.translateGeometry', () => {
    it('desloca cada vertice de um MultiPolygon', () => {
        const g = { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 1]]]] };
        expect(geom.translateGeometry(g, 10, -5)).toEqual({
            type: 'MultiPolygon',
            coordinates: [[[[10, -5], [11, -4]]]],
        });
    });

    it('desloca um Polygon', () => {
        const g = { type: 'Polygon', coordinates: [[[0, 0], [2, 2]]] };
        expect(geom.translateGeometry(g, 1, 1).coordinates).toEqual([[[1, 1], [3, 3]]]);
    });

    it('offset zero devolve os MESMOS valores em objetos NOVOS', () => {
        const g = { type: 'Polygon', coordinates: [[[3, 4]]] };
        const out = geom.translateGeometry(g, 0, 0);
        expect(out).toEqual(g);
        expect(out).not.toBe(g);
        expect(out.coordinates[0][0]).not.toBe(g.coordinates[0][0]);
    });

    it('tipo desconhecido atravessa por REFERENCIA, sem copia', () => {
        const g = { type: 'LineString', coordinates: [[0, 0]] };
        expect(geom.translateGeometry(g, 5, 5)).toBe(g);
    });

    it('geometria null nao lanca, o catch devolve a entrada', () => {
        expect(geom.translateGeometry(null, 1, 1)).toBeNull();
        expect(errSpy).toHaveBeenCalled();
    });

    it('OBSERVADO: a terceira componente (z) e DESCARTADA na translacao', () => {
        const g = { type: 'Polygon', coordinates: [[[0, 0, 900]]] };
        expect(geom.translateGeometry(g, 1, 1).coordinates[0][0]).toEqual([1, 1]);
    });

    it('OBSERVADO: offset NaN contamina todo vertice, sem recusa', () => {
        const g = { type: 'Polygon', coordinates: [[[0, 0]]] };
        expect(geom.translateGeometry(g, NaN, 1).coordinates[0][0][0]).toBeNaN();
    });
});

describe('AddVisibilityGeometry.extractCenterFromGeometry', () => {
    it('MultiPolygon: media aritmetica de TODOS os vertices', () => {
        const g = { type: 'MultiPolygon', coordinates: [[[[0, 0], [2, 0], [0, 2], [2, 2]]]] };
        expect(geom.extractCenterFromGeometry(g)).toEqual([1, 1]);
    });

    it('MultiPolygon: o vertice de FECHAMENTO entra na media e enviesa o centro', () => {
        // Closed square: the [0,0] corner is counted twice, so the mean leans toward it.
        const g = {
            type: 'MultiPolygon',
            coordinates: [[[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]],
        };
        const c = geom.extractCenterFromGeometry(g);
        expect(c[0]).toBeCloseTo(0.8, 12);
        expect(c[1]).toBeCloseTo(0.8, 12);
    });

    it('MultiPolygon vazio -> null', () => {
        expect(geom.extractCenterFromGeometry({ type: 'MultiPolygon', coordinates: [] })).toBeNull();
    });

    it('vertice de comprimento < 2 e ignorado', () => {
        const g = { type: 'MultiPolygon', coordinates: [[[[0, 0], [4], [4, 4]]]] };
        expect(geom.extractCenterFromGeometry(g)).toEqual([2, 2]);
    });

    it('tipo desconhecido -> null', () => {
        expect(geom.extractCenterFromGeometry({ type: 'Point', coordinates: [0, 0] })).toBeNull();
    });

    it('null nao lanca', () => {
        expect(geom.extractCenterFromGeometry(null)).toBeNull();
    });

    it('getCoordinatesForMovement delega', () => {
        const g = { type: 'MultiPolygon', coordinates: [[[[0, 0], [2, 2]]]] };
        expect(geom.getCoordinatesForMovement(g)).toEqual([1, 1]);
    });
});

describe('AddVisibilityGeometry.getBoundingBox / isTerrainAvailable', () => {
    afterEach(() => { delete globalThis.turf; });

    it('delega para turf.bbox', () => {
        globalThis.turf = { bbox: vi.fn(() => [1, 2, 3, 4]) };
        const f = { type: 'Feature' };
        expect(geom.getBoundingBox(f)).toEqual([1, 2, 3, 4]);
        expect(globalThis.turf.bbox).toHaveBeenCalledTimes(1);
        expect(globalThis.turf.bbox).toHaveBeenCalledWith(f);
    });

    it('turf que lanca -> [0,0,0,0] e um warn', () => {
        globalThis.turf = { bbox: () => { throw new Error('boom'); } };
        expect(geom.getBoundingBox({})).toEqual([0, 0, 0, 0]);
        expect(warnSpy).toHaveBeenCalled();
    });

    it('isTerrainAvailable compara com null ESTRITAMENTE', () => {
        expect(geom.isTerrainAvailable({ getTerrain: () => null })).toBe(false);
        expect(geom.isTerrainAvailable({ getTerrain: () => ({}) })).toBe(true);
    });

    it('OBSERVADO: getTerrain() undefined e lido como "tem terreno"', () => {
        expect(geom.isTerrainAvailable({ getTerrain: () => undefined })).toBe(true);
    });
});

// ============================================================================
// getCachedElevation
// ============================================================================

describe('AddVisibilityGeometry.getCachedElevation', () => {
    it('consulta o terreno uma vez e serve o cache na segunda', async () => {
        vi.mocked(getTerrainElevation).mockResolvedValue(42);
        const cache = new Map();
        expect(await geom.getCachedElevation({}, [1.23456, 2.34567], cache)).toBe(42);
        expect(await geom.getCachedElevation({}, [1.23456, 2.34567], cache)).toBe(42);
        expect(getTerrainElevation).toHaveBeenCalledTimes(1);
        expect(cache.size).toBe(1);
    });

    it('a chave e arredondada a 5 casas: dois pontos distintos COLIDEM', () => {
        vi.mocked(getTerrainElevation).mockResolvedValue(7);
        const cache = new Map();
        return Promise.all([
            geom.getCachedElevation({}, [1.234561, 0], cache),
            geom.getCachedElevation({}, [1.234562, 0], cache),
        ]).then(() => {
            expect(cache.size).toBe(1);
        });
    });

    it('pontos separados por mais de 1e-5 grau NAO colidem', async () => {
        vi.mocked(getTerrainElevation).mockResolvedValue(7);
        const cache = new Map();
        await geom.getCachedElevation({}, [1.23456, 0], cache);
        await geom.getCachedElevation({}, [1.23458, 0], cache);
        expect(cache.size).toBe(2);
        expect(getTerrainElevation).toHaveBeenCalledTimes(2);
    });
});

// ============================================================================
// calculateViewshed (the max-angle sweep)
// ============================================================================

describe('AddVisibilityGeometry.calculateViewshed', () => {
    /**
     * Wires the mocked terrain to a radial elevation profile, converting the sampled
     * coordinate back to a distance from [0,0] with the SAME flat model the module
     * uses to walk outward. Independent of the module's own functions: plain trig.
     * @param {Function} perfil - (distanceMeters) => elevation
     */
    function terrenoRadial(perfil) {
        vi.mocked(getTerrainElevation).mockImplementation(async (_map, coord) => {
            const dx = coord[0] * Math.cos(0) * M_PER_DEG;
            const dy = coord[1] * M_PER_DEG;
            return perfil(Math.hypot(dx, dy));
        });
    }

    // radius 100 / aperture 2 -> step 30, 4 points per ray, 3 rays, 8 cells.
    const RAIO = 100;
    const ABERTURA = 2;

    it('a grade tem o tamanho previsto: 2 x 4 = 8 celulas', async () => {
        terrenoRadial(() => 0);
        const cells = await geom.calculateViewshed([0, 0], RAIO, 0, ABERTURA, 2, 0, {});
        expect(cells).toHaveLength(8);
        expect(geom.calculateDistanceStep(RAIO, ABERTURA)).toBe(30);
    });

    it('terreno plano: TODAS as celulas visiveis (o observador olha para baixo)', async () => {
        terrenoRadial(() => 0);
        const cells = await geom.calculateViewshed([0, 0], RAIO, 0, ABERTURA, 2, 0, {});
        expect(cells).toHaveLength(8);
        expect(cells.every(c => c.isVisible)).toBe(true);
    });

    it('crista a 60 m: o topo e visivel, tudo depois dele e obstruido', async () => {
        // Sampled distances are 30, 60, 90, 120. Observer elevation = 0 + 2.
        // d=30 : atan2(-2,30)  = -0.0666 > -Inf   -> visivel, barreira -0.0666
        // d=60 : atan2( 48,60) =  0.6747 > -0.0666 -> visivel, barreira  0.6747
        // d=90 : atan2(-2,90)  = -0.0222 < 0.6747  -> obstruido
        // d=120: atan2(-2,120) = -0.0166 < 0.6747  -> obstruido
        terrenoRadial(d => (d > 45 && d < 75 ? 50 : 0));
        const cells = await geom.calculateViewshed([0, 0], RAIO, 0, ABERTURA, 2, 0, {});
        expect(cells).toHaveLength(8);
        expect(cells.map(c => c.isVisible))
            .toEqual([true, true, false, false, true, true, false, false]);
    });

    it('targetHeight entra SO na avaliacao do ponto, NUNCA na barreira', async () => {
        // Same ridge. With a 100 m target the points beyond it come back into view.
        // Were targetHeight also fed into the barrier, the barrier after the ridge would
        // be atan2(148,60) = 1.18 and d=90 (atan2(98,90) = 0.827) would stay obstructed.
        terrenoRadial(d => (d > 45 && d < 75 ? 50 : 0));
        const cells = await geom.calculateViewshed([0, 0], RAIO, 0, ABERTURA, 2, 100, {});
        expect(cells).toHaveLength(8);
        expect(cells.every(c => c.isVisible)).toBe(true);
    });

    it('CONTROLE do caso acima: com targetHeight 0 a mesma crista obstrui', async () => {
        terrenoRadial(d => (d > 45 && d < 75 ? 50 : 0));
        const cells = await geom.calculateViewshed([0, 0], RAIO, 0, ABERTURA, 2, 0, {});
        expect(cells.filter(c => !c.isVisible)).toHaveLength(4);
    });

    it('o PRIMEIRO ponto do raio e sempre visivel, mesmo sendo um paredao', async () => {
        // A 10 km wall standing exactly on the first sample (d = 30) and nothing beyond.
        // The barrier starts at -Infinity, so nothing can obstruct that first sample;
        // everything behind the wall is then obstructed.
        terrenoRadial(d => (d < 45 ? 10000 : 0));
        const cells = await geom.calculateViewshed([0, 0], RAIO, 0, ABERTURA, 2, 0, {});
        expect(cells).toHaveLength(8);
        expect(cells.map(c => c.isVisible))
            .toEqual([true, false, false, false, true, false, false, false]);
    });

    it('observerHeight maior enxerga por cima da crista', async () => {
        terrenoRadial(d => (d > 45 && d < 75 ? 50 : 0));
        const baixo = await geom.calculateViewshed([0, 0], RAIO, 0, ABERTURA, 2, 0, {});
        const alto = await geom.calculateViewshed([0, 0], RAIO, 0, ABERTURA, 400, 0, {});
        expect(baixo.filter(c => c.isVisible)).toHaveLength(4);
        expect(alto.filter(c => c.isVisible)).toHaveLength(8);
    });

    it('cada celula sai com um anel fechado de coordenadas', async () => {
        terrenoRadial(() => 0);
        const cells = await geom.calculateViewshed([0, 0], RAIO, 0, ABERTURA, 2, 0, {});
        expect(cells).toHaveLength(8);
        cells.forEach((c) => {
            expect(c.coordinates.length).toBeGreaterThanOrEqual(5);
            expect(c.coordinates[c.coordinates.length - 1]).toBe(c.coordinates[0]);
        });
    });

    it('o cache de elevacao evita reconsultar o mesmo ponto entre raios', async () => {
        terrenoRadial(() => 0);
        await geom.calculateViewshed([0, 0], RAIO, 0, ABERTURA, 2, 0, {});
        // 1 observer query + 3 rays x 4 points = 13 at most; the cache can only lower it.
        expect(vi.mocked(getTerrainElevation).mock.calls.length).toBeLessThanOrEqual(13);
        expect(vi.mocked(getTerrainElevation).mock.calls.length).toBeGreaterThan(0);
    });

    it('o progressCallback e chamado em ordem crescente e termina em 78', async () => {
        terrenoRadial(() => 0);
        const chamadas = [];
        await geom.calculateViewshed([0, 0], RAIO, 0, ABERTURA, 2, 0, {}, (pct, txt) => {
            chamadas.push([pct, txt]);
        });
        expect(chamadas.length).toBeGreaterThanOrEqual(4);
        expect(chamadas[0][0]).toBe(5);
        expect(chamadas[chamadas.length - 1][0]).toBe(78);
        const pcts = chamadas.map(c => c[0]);
        expect([...pcts].sort((a, b) => a - b)).toEqual(pcts);
        chamadas.forEach(c => expect(typeof c[1]).toBe('string'));
    });
});

// ============================================================================
// createVisibilityFeature / recalculateFromCoordinates
// ============================================================================

describe('AddVisibilityGeometry.createVisibilityFeature', () => {
    beforeAll(() => {
        globalThis.turf = { distance: () => 100 };
    });
    afterAll(() => { delete globalThis.turf; });

    it('cellData e as coordenadas nascem ALINHADOS, que e o que generateProcessedFeatures exige', async () => {
        vi.mocked(getTerrainElevation).mockResolvedValue(0);
        const f = await geom.createVisibilityFeature([0, 0], [0, 0.001], { id: 'v9' }, {});
        expect(f.geometry.type).toBe('MultiPolygon');
        expect(f.properties.cellData).toHaveLength(f.geometry.coordinates.length);
        expect(f.geometry.coordinates.length).toBeGreaterThan(0);
        // round trip: the feature it builds feeds the processed-feature split
        const proc = geom.generateProcessedFeatures(f);
        expect(proc.length).toBeGreaterThanOrEqual(1);
        expect(proc.length).toBeLessThanOrEqual(2);
    });

    it('aplica os defaults de abertura 60, observador 2 e alvo 0', async () => {
        vi.mocked(getTerrainElevation).mockResolvedValue(0);
        const f = await geom.createVisibilityFeature([0, 0], [0, 0.001], { id: 'v9' }, {});
        expect(f.properties.aperture).toBe(60);
        expect(f.properties.center).toEqual([0, 0]);
        expect(f.properties.radius).toBe(100);
        expect(f.id).toBe('v9');
    });

    it('abertura 0 explicita sobrevive ao ?? (nao vira 60)', async () => {
        vi.mocked(getTerrainElevation).mockResolvedValue(0);
        const f = await geom.createVisibilityFeature(
            [0, 0], [0, 0.001], { id: 'v9', aperture: 0 }, {},
        );
        expect(f.properties.aperture).toBe(0);
    });
});

describe('AddVisibilityGeometry.recalculateFromCoordinates', () => {
    it('lanca quando os parametros normalizados nao validam', async () => {
        // normalizeFeatureProperties does NOT default `radius`, so a feature without it
        // fails validate and the recalculation refuses instead of producing garbage.
        await expect(geom.recalculateFromCoordinates([0, 0], { properties: {} }, {}))
            .rejects.toThrow('Invalid parameters for visibility recalculation');
    });

    it('lanca com centro invalido', async () => {
        await expect(geom.recalculateFromCoordinates(
            [0], { properties: { radius: 100 } }, {},
        )).rejects.toThrow();
    });

    it('devolve geometria, cellData alinhado e o novo centro', async () => {
        vi.mocked(getTerrainElevation).mockResolvedValue(0);
        const out = await geom.recalculateFromCoordinates(
            [1, 1], { properties: { radius: 100, bearing: 0, aperture: 2 } }, {},
        );
        expect(out.center).toEqual([1, 1]);
        expect(out.geometry.type).toBe('MultiPolygon');
        expect(out.cellData).toHaveLength(out.geometry.coordinates.length);
        expect(out.cellData).toHaveLength(8);
    });
});
