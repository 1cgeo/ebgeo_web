import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import {
    formatDistanceAuto,
    formatAreaAuto,
    formatAngle,
    formatDistance,
    formatArea,
    calculateAngle,
    generateArcCoordinates,
} from '../../src/js/measurement_tool/measurement-geometry.js';
import {
    DISTANCE_UNITS,
    AREA_UNITS,
    ANGLE_UNITS,
} from '../../src/js/measurement_tool/measurement.constants.js';

// measurement-geometry only depends on the global `turf` (loaded via <script>
// in the real app). The pure formatters do not touch turf at all; only
// calculateAngle / generateArcCoordinates do, so we stub it for those.

const findUnit = (units, id) => units.find((u) => u.id === id);

const M = findUnit(DISTANCE_UNITS, 'meters');
const KM = findUnit(DISTANCE_UNITS, 'kilometers');
const NM = findUnit(DISTANCE_UNITS, 'nautical_miles');
const FT = findUnit(DISTANCE_UNITS, 'feet');

const SQM = findUnit(AREA_UNITS, 'sqmeters');
const HA = findUnit(AREA_UNITS, 'hectares');
const SQKM = findUnit(AREA_UNITS, 'sqkilometers');

const DEG = findUnit(ANGLE_UNITS, 'degrees');
const MIL = findUnit(ANGLE_UNITS, 'mils');
const GON = findUnit(ANGLE_UNITS, 'gradians');

// ============================================================================
// formatDistanceAuto — boundary at 1000 m
// ============================================================================

describe('formatDistanceAuto', () => {
    it('formats sub-kilometre distances in metres with 1 decimal', () => {
        expect(formatDistanceAuto(523.45)).toBe('523.5 m');
        expect(formatDistanceAuto(0)).toBe('0.0 m');
    });

    it('switches to km at exactly 1000 m (boundary inclusive)', () => {
        expect(formatDistanceAuto(1000)).toBe('1.00 km');
    });

    it('keeps metres just below the 1000 m boundary', () => {
        expect(formatDistanceAuto(999.9)).toBe('999.9 m');
    });

    it('formats kilometres with 2 decimals', () => {
        expect(formatDistanceAuto(1523.4)).toBe('1.52 km');
        expect(formatDistanceAuto(12345)).toBe('12.35 km');
    });

    it('property: output unit matches the 1000 m boundary', () => {
        fc.assert(fc.property(fc.double({ min: 0, max: 1e7, noNaN: true }), (m) => {
            const s = formatDistanceAuto(m);
            return m >= 1000 ? s.endsWith(' km') : s.endsWith(' m');
        }));
    });

    // --- documented current behaviour (no guard): NaN / Infinity pass through ---
    it('documents: NaN yields "NaN m" (no finite-guard)', () => {
        expect(formatDistanceAuto(NaN)).toBe('NaN m');
    });
    it('documents: +Infinity yields "Infinity km" (>= 1000 branch)', () => {
        expect(formatDistanceAuto(Infinity)).toBe('Infinity km');
    });
    it('documents: -Infinity yields "-Infinity m" (< 1000 branch)', () => {
        expect(formatDistanceAuto(-Infinity)).toBe('-Infinity m');
    });
});

// ============================================================================
// formatAreaAuto — boundaries at 10 000 m² (ha) and 1e6 m² (km²)
// ============================================================================

describe('formatAreaAuto', () => {
    it('formats small areas in m² with 1 decimal', () => {
        expect(formatAreaAuto(9999.9)).toBe('9999.9 m²');
        expect(formatAreaAuto(0)).toBe('0.0 m²');
    });

    it('switches to hectares at exactly 10 000 m² (boundary inclusive)', () => {
        expect(formatAreaAuto(10000)).toBe('1.00 ha');
    });

    it('formats hectares with 2 decimals below the km² boundary', () => {
        expect(formatAreaAuto(123456)).toBe('12.35 ha');
        expect(formatAreaAuto(999999)).toBe('100.00 ha');
    });

    it('switches to km² at exactly 1e6 m² (boundary inclusive)', () => {
        expect(formatAreaAuto(1e6)).toBe('1.000 km²');
    });

    it('formats km² with 3 decimals', () => {
        expect(formatAreaAuto(2_500_000)).toBe('2.500 km²');
    });

    it('uses the m² suffix (U+00B2 superscript two)', () => {
        expect(formatAreaAuto(1).endsWith('²')).toBe(true);
    });

    it('property: output unit matches the ha / km² boundaries', () => {
        fc.assert(fc.property(fc.double({ min: 0, max: 1e9, noNaN: true }), (a) => {
            const s = formatAreaAuto(a);
            if (a >= 1e6) return s.endsWith('km²');
            if (a >= 10000) return s.endsWith(' ha');
            return s.endsWith('m²') && !s.endsWith('km²');
        }));
    });

    // --- documented current behaviour (no guard) ---
    it('documents: NaN yields "NaN m²" (no finite-guard)', () => {
        expect(formatAreaAuto(NaN)).toBe('NaN m²');
    });
    it('documents: +Infinity yields "Infinity km²" (>= 1e6 branch)', () => {
        expect(formatAreaAuto(Infinity)).toBe('Infinity km²');
    });
});

// ============================================================================
// formatDistance — explicit unit (factor / decimals / suffix)
// ============================================================================

describe('formatDistance', () => {
    it('metres: factor 1, 1 decimal', () => {
        expect(formatDistance(1234.56, M)).toBe('1234.6 m');
    });
    it('kilometres: factor 0.001, 3 decimals', () => {
        expect(formatDistance(1500, KM)).toBe('1.500 km');
    });
    it('nautical miles: 1852 m = 1.000 NM', () => {
        expect(formatDistance(1852, NM)).toBe('1.000 NM');
    });
    it('feet: 0.3048 m = 1.0 ft', () => {
        expect(formatDistance(0.3048, FT)).toBe('1.0 ft');
    });
    it('uses a space before the suffix', () => {
        expect(formatDistance(100, M)).toBe('100.0 m');
    });

    it('property: value equals meters * factor rounded to decimals', () => {
        fc.assert(fc.property(fc.double({ min: 0, max: 1e7, noNaN: true }), (m) => {
            const s = formatDistance(m, KM);
            const expected = (m * KM.factor).toFixed(KM.decimals);
            return s === `${expected} km`;
        }));
    });

    it('documents: NaN distance yields "NaN <suffix>"', () => {
        expect(formatDistance(NaN, M)).toBe('NaN m');
    });
});

// ============================================================================
// formatArea — explicit unit
// ============================================================================

describe('formatArea', () => {
    it('square metres: factor 1, 1 decimal', () => {
        expect(formatArea(2500.5, SQM)).toBe('2500.5 m²');
    });
    it('hectares: 10 000 m² = 1.000 ha (3 decimals)', () => {
        expect(formatArea(10000, HA)).toBe('1.000 ha');
    });
    it('square kilometres: 1e6 m² = 1.0000 km² (4 decimals)', () => {
        expect(formatArea(1e6, SQKM)).toBe('1.0000 km²');
    });

    it('documents: NaN area yields "NaN <suffix>"', () => {
        expect(formatArea(NaN, SQM)).toBe('NaN m²');
    });
});

// ============================================================================
// formatAngle — degrees use ° with NO space; mil / gon factors
// ============================================================================

describe('formatAngle', () => {
    it('degrees: ° suffix attached with no separating space', () => {
        expect(formatAngle(90, DEG)).toBe('90.00°');
        expect(formatAngle(90, DEG)).not.toContain(' ');
    });
    it('mils: 360° = 6400 mil (factor 6400/360, 0 decimals)', () => {
        expect(formatAngle(360, MIL)).toBe('6400mil');
    });
    it('mils: 90° = 1600 mil', () => {
        expect(formatAngle(90, MIL)).toBe('1600mil');
    });
    it('gradians: 360° = 400 gon (factor 400/360, 2 decimals)', () => {
        expect(formatAngle(360, GON)).toBe('400.00gon');
    });
    it('gradians: 90° = 100 gon', () => {
        expect(formatAngle(90, GON)).toBe('100.00gon');
    });

    it('property: degree formatter never inserts a space before °', () => {
        fc.assert(fc.property(fc.double({ min: 0, max: 360, noNaN: true }), (d) => {
            const s = formatAngle(d, DEG);
            return s.endsWith('°') && !s.includes(' ');
        }));
    });

    it('property: value equals degrees * factor rounded to decimals', () => {
        fc.assert(fc.property(fc.double({ min: 0, max: 360, noNaN: true }), (d) => {
            const s = formatAngle(d, MIL);
            return s === `${(d * MIL.factor).toFixed(MIL.decimals)}mil`;
        }));
    });

    it('documents: NaN angle yields "NaN<suffix>"', () => {
        expect(formatAngle(NaN, DEG)).toBe('NaN°');
    });
});

// ============================================================================
// calculateAngle / generateArcCoordinates — turf stubbed
// ============================================================================

describe('calculateAngle & generateArcCoordinates (turf stubbed)', () => {
    beforeAll(() => {
        // Deterministic stub. bearing() returns a fixed bearing keyed by the
        // target point's longitude so calculateAngle is predictable; destination()
        // is a flat offset so generateArcCoordinates yields finite, inspectable
        // coordinates and we can detect NaN bearings.
        globalThis.turf = {
            point: (coords) => ({ geometry: { coordinates: coords } }),
            // bearing(from, to): encode the angle directly in the to-point's lng.
            bearing: (_from, to) => to.geometry.coordinates[0],
            // destination(from, distKm, bearing, opts): offset lng by the bearing so
            // a NaN bearing is observable as a NaN coordinate.
            destination: (from, distKm, bearing) => ({
                geometry: {
                    coordinates: [
                        from.geometry.coordinates[0] + bearing,
                        from.geometry.coordinates[1] + distKm,
                    ],
                },
            }),
        };
    });
    afterAll(() => { delete globalThis.turf; });

    // ---- calculateAngle ----

    it('returns bearing2 - bearing1 when positive', () => {
        // p1 lng = 30 → bearing1 = 30; p3 lng = 120 → bearing2 = 120; diff = 90
        expect(calculateAngle([30, 0], [0, 0], [120, 0])).toBe(90);
    });

    it('wraps a negative difference into [0, 360)', () => {
        // bearing1 = 120, bearing2 = 30 → -90 → +360 = 270
        expect(calculateAngle([120, 0], [0, 0], [30, 0])).toBe(270);
    });

    it('returns 0 for identical bearings', () => {
        expect(calculateAngle([45, 0], [0, 0], [45, 0])).toBe(0);
    });

    // CORRIGIDO EM 2026-08-24, E O LIMITE SUPERIOR MUDOU DE INCLUSIVO PARA EXCLUSIVO. Esta
    // propriedade admitia `<= 360` para acomodar o defeito que o caso abaixo documentava, e o
    // caso abaixo o afirmava como comportamento. Os dois juntos transformavam o bug em contrato:
    // quem consertasse veria vermelho e reverteria. O wrap agora e `((x % 360) + 360) % 360`, e a
    // faixa e a que o JSDoc sempre prometeu.
    it('property: result is always in [0, 360)', () => {
        fc.assert(fc.property(
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -180, max: 180, noNaN: true }),
            (b1, b2) => {
                const a = calculateAngle([b1, 0], [0, 0], [b2, 0]);
                return a >= 0 && a < 360;
            }
        ));
    });

    it('uma diferenca negativa sub-ULP devolve 0, e nao 360', () => {
        // ANTES: `0 - 5e-324 = -5e-324 (< 0)` → `+= 360` → **360 exato**, porque a soma arredonda
        // para o vizinho mais proximo. Tres pontos quase colineares mediam 360 graus em vez de ~0.
        expect(calculateAngle([5e-324, 0], [0, 0], [0, 0])).toBe(0);
        // CONTROLE: o wrap continua funcionando para uma diferenca negativa de verdade.
        expect(calculateAngle([90, 0], [0, 0], [-90, 0])).toBeCloseTo(180, 9);
    });

    // ---- generateArcCoordinates ----

    it('produces numPoints + 1 coordinates for the default', () => {
        const coords = generateArcCoordinates([0, 0], 0, 90, 1000);
        expect(coords).toHaveLength(37); // default 36 + 1
    });

    it('produces numPoints + 1 coordinates for an explicit count', () => {
        const coords = generateArcCoordinates([0, 0], 0, 90, 1000, 4);
        expect(coords).toHaveLength(5);
    });

    it('first/last bearings span the (wrapped) sweep', () => {
        // sweep from 10 to 70 = 60; with the stub, lng offset == bearing.
        const coords = generateArcCoordinates([0, 0], 10, 70, 1000, 6);
        expect(coords[0][0]).toBeCloseTo(10, 9);          // first bearing = bearing1
        expect(coords[coords.length - 1][0]).toBeCloseTo(70, 9); // last = bearing2
    });

    it('handles a negative sweep by wrapping +360', () => {
        // bearing1 = 350, bearing2 = 10 → sweep = 20, last bearing = 370
        const coords = generateArcCoordinates([0, 0], 350, 10, 1000, 4);
        expect(coords[coords.length - 1][0]).toBeCloseTo(370, 9);
    });

    it('all coordinates are finite for valid input', () => {
        const coords = generateArcCoordinates([0, 0], 0, 180, 5000, 12);
        for (const [lng, lat] of coords) {
            expect(Number.isFinite(lng)).toBe(true);
            expect(Number.isFinite(lat)).toBe(true);
        }
    });

    // numPoints=0 previously produced 0/0 = NaN fractions → NaN bearings.
    // The guard falls back to the documented default (36) so output stays finite.
    it('numPoints=0 does not produce NaN coordinates (guarded)', () => {
        const coords = generateArcCoordinates([0, 0], 0, 90, 1000, 0);
        expect(coords.length).toBeGreaterThan(0);
        for (const [lng, lat] of coords) {
            expect(Number.isFinite(lng)).toBe(true);
            expect(Number.isFinite(lat)).toBe(true);
        }
    });

    it('negative numPoints also falls back to a finite arc (guarded)', () => {
        const coords = generateArcCoordinates([0, 0], 0, 90, 1000, -5);
        expect(coords.length).toBeGreaterThan(0);
        for (const [lng, lat] of coords) {
            expect(Number.isFinite(lng)).toBe(true);
            expect(Number.isFinite(lat)).toBe(true);
        }
    });
});
