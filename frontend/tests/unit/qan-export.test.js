// Path: tests/unit/qan-export.test.js

/**
 * @fileoverview Pins `generateQAN` (js/import_export/qan/qan-export.js), the pure
 * half of the QAN (Quadro Auxiliar de Navegacao) export: it turns a line/polygon
 * feature into one row per leg.
 *
 * WHAT THIS SUITE PINS
 * - leg COUNT and the polygon ring closure (n points -> n-1 legs for a line,
 *   n legs for a polygon, because the ring is closed with a synthetic last point);
 * - the bearing normalization `-180..180 -> 0..360` and the 1-decimal formatting;
 * - the `observations[i] || ''` alignment (index i belongs to the leg STARTING at
 *   point i) and what that `||` swallows;
 * - the coordinate text order (`formatCoordinates(lat, lng)` from a `[lng, lat]`
 *   pair, i.e. the pair is SWAPPED on the way out);
 * - `distance` (formatted, unit auto-switch at 1000 m) vs `distanceMeters` (raw);
 * - degenerate inputs: no `baseCoordinates`, empty array, single point.
 *
 * WHAT IT DOES NOT REACH
 * - `downloadQANAsHTML`, which needs `Blob`, `URL.createObjectURL` and `document`.
 *   Its escaping is already covered by `tests/unit/html-escape.test.js`, and the
 *   node environment here has no DOM.
 * - The real turf. `measurement-geometry.js` reads the GLOBAL `turf` (a <script>
 *   tag in the app, not an npm dep), so this suite installs a stub whose bearing
 *   and distance are derived INDEPENDENTLY (spherical law / haversine written out
 *   here) rather than by calling the module under test.
 * - `formatCoordinates` itself, covered by `tests/unit/coordinate-converter.test.js`;
 *   here it runs for real (mgrs/proj4 are real npm deps) and only the 'latlong'
 *   branch is exercised.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { generateQAN } from '../../src/js/import_export/qan/qan-export.js';

// ============================================================================
// Independent turf stub
// ============================================================================

const R_EARTH_M = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Initial great-circle bearing, degrees in (-180, 180]. Written out on purpose. */
function initialBearing([lng1, lat1], [lng2, lat2]) {
    const p1 = toRad(lat1);
    const p2 = toRad(lat2);
    const dl = toRad(lng2 - lng1);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return toDeg(Math.atan2(y, x));
}

/** Haversine distance in metres. */
function haversineMeters([lng1, lat1], [lng2, lat2]) {
    const p1 = toRad(lat1);
    const p2 = toRad(lat2);
    const dp = toRad(lat2 - lat1);
    const dl = toRad(lng2 - lng1);
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

beforeAll(() => {
    globalThis.turf = {
        point: (coords) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: coords } }),
        bearing: (a, b) => initialBearing(a.geometry.coordinates, b.geometry.coordinates),
        distance: (a, b, opts) => {
            // The module always asks for metres; fail loudly if that ever changes,
            // because a silent unit swap would make every assertion below wrong.
            if (!opts || opts.units !== 'meters') throw new Error(`unexpected units: ${opts && opts.units}`);
            return haversineMeters(a.geometry.coordinates, b.geometry.coordinates);
        },
    };
});

afterAll(() => {
    delete globalThis.turf;
});

// ============================================================================
// Helpers
// ============================================================================

const lineFeature = (baseCoordinates, observations) => ({
    properties: { source: 'line', baseCoordinates, observations },
});

const polygonFeature = (baseCoordinates, observations) => ({
    properties: { source: 'polygon', baseCoordinates, observations },
});

/** A short east-west then north-south path near Rio, in [lng, lat]. */
const P0 = [-43.20, -22.90];
const P1 = [-43.10, -22.90];
const P2 = [-43.10, -22.80];

// ============================================================================
// Leg count and ring closure
// ============================================================================

describe('generateQAN - contagem de pernas', () => {
    it('linha de N pontos produz N-1 pernas, numeradas a partir de 1', () => {
        const legs = generateQAN(lineFeature([P0, P1, P2]));
        expect(legs).toHaveLength(2);
        expect(legs.map((l) => l.leg)).toEqual([1, 2]);
    });

    it('poligono de N pontos produz N pernas: a ultima fecha o anel', () => {
        const legs = generateQAN(polygonFeature([P0, P1, P2]));
        expect(legs).toHaveLength(3);
        // The closing leg goes from the last vertex back to the first one.
        expect(legs[2].to).toBe(legs[0].from);
    });

    it('invariante (fast-check): linha n-1, poligono n, para 2..12 pontos', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.tuple(
                        fc.double({ min: -179, max: 179, noNaN: true }),
                        fc.double({ min: -80, max: 80, noNaN: true }),
                    ),
                    { minLength: 2, maxLength: 12 },
                ),
                (coords) => {
                    expect(generateQAN(lineFeature(coords))).toHaveLength(coords.length - 1);
                    expect(generateQAN(polygonFeature(coords))).toHaveLength(coords.length);
                },
            ),
            { numRuns: 60 },
        );
    });

    it('source ausente e tratado como linha (so a string exata "polygon" fecha o anel)', () => {
        const noSource = generateQAN({ properties: { baseCoordinates: [P0, P1, P2] } });
        expect(noSource).toHaveLength(2);
        const wrongCase = generateQAN({
            properties: { source: 'Polygon', baseCoordinates: [P0, P1, P2] },
        });
        expect(wrongCase).toHaveLength(2);
    });
});

// ============================================================================
// Degenerate inputs
// ============================================================================

describe('generateQAN - entradas degeneradas', () => {
    it('sem baseCoordinates devolve lista vazia, sem lancar', () => {
        expect(generateQAN({ properties: {} })).toEqual([]);
        expect(generateQAN({ properties: { baseCoordinates: null, source: 'line' } })).toEqual([]);
    });

    it('poligono com baseCoordinates VAZIO nao lanca e devolve vazio', () => {
        // `[...[], undefined]` has length 1, so `points.length - 1 === 0` and the
        // loop never dereferences the `undefined` sentinel. The guard is the loop
        // bound, not a check: worth pinning, because it is one edit away from a crash.
        expect(generateQAN(polygonFeature([]))).toEqual([]);
    });

    it('linha com UM ponto devolve vazio', () => {
        expect(generateQAN(lineFeature([P0]))).toEqual([]);
    });

    it('poligono com UM ponto devolve uma perna degenerada de comprimento zero', () => {
        const legs = generateQAN(polygonFeature([P0]));
        expect(legs).toHaveLength(1);
        expect(legs[0].distanceMeters).toBe(0);
        expect(legs[0].distance).toBe('0.0 m');
        expect(legs[0].from).toBe(legs[0].to);
    });

    it('OBSERVADO: poligono JA fechado ganha uma perna extra de comprimento zero', () => {
        // The ring is closed unconditionally, so a caller that already repeats the
        // first vertex at the end gets a spurious final leg. Today's behaviour.
        const legs = generateQAN(polygonFeature([P0, P1, P2, P0]));
        expect(legs).toHaveLength(4);
        expect(legs[3].distanceMeters).toBe(0);
    });
});

// ============================================================================
// Azimuth normalization
// ============================================================================

describe('generateQAN - azimute', () => {
    it('rumo leste vale ~90 e rumo oeste vale ~270 (negativo normalizado)', () => {
        const east = generateQAN(lineFeature([P0, P1]))[0];
        expect(Number(east.azimuth)).toBeCloseTo(90, 1);

        const west = generateQAN(lineFeature([P1, P0]))[0];
        // turf would return ~-90 here; the module must have added 360.
        expect(Number(west.azimuth)).toBeCloseTo(270, 1);
    });

    it('rumo norte vale 0.0 e rumo sul vale 180.0', () => {
        const north = generateQAN(lineFeature([[0, 0], [0, 1]]))[0];
        expect(north.azimuth).toBe('0.0');
        const south = generateQAN(lineFeature([[0, 1], [0, 0]]))[0];
        expect(south.azimuth).toBe('180.0');
    });

    it('azimute e string com exatamente uma casa decimal', () => {
        const legs = generateQAN(lineFeature([P0, P1, P2]));
        expect(legs).toHaveLength(2);
        for (const leg of legs) {
            expect(typeof leg.azimuth).toBe('string');
            expect(leg.azimuth).toMatch(/^-?\d+\.\d$/);
        }
    });

    it('invariante (fast-check): o azimute numerico fica em [0, 360]', () => {
        fc.assert(
            fc.property(
                fc.double({ min: -179, max: 179, noNaN: true }),
                fc.double({ min: -80, max: 80, noNaN: true }),
                fc.double({ min: -179, max: 179, noNaN: true }),
                fc.double({ min: -80, max: 80, noNaN: true }),
                (lng1, lat1, lng2, lat2) => {
                    const legs = generateQAN(lineFeature([[lng1, lat1], [lng2, lat2]]));
                    expect(legs).toHaveLength(1);
                    const az = Number(legs[0].azimuth);
                    expect(Number.isNaN(az)).toBe(false);
                    expect(az).toBeGreaterThanOrEqual(0);
                    expect(az).toBeLessThanOrEqual(360);
                },
            ),
            { numRuns: 150 },
        );
    });

    it('OBSERVADO: um rumo logo a oeste do norte imprime "360.0", nao "0.0"', () => {
        // -0.04 deg becomes 359.96 after the +360, and toFixed(1) rounds it UP to
        // 360.0 - an azimuth the QAN table is not supposed to be able to print.
        // Cosmetic, but it is what the code does today.
        const legs = generateQAN(lineFeature([[0, 0], [-0.0007, 1]]));
        expect(legs).toHaveLength(1);
        expect(Number(legs[0].azimuth)).toBeGreaterThan(359.9);
        expect(legs[0].azimuth).toBe('360.0');
    });

    it('OBSERVADO: coordenada NaN propaga para o azimute como a string "NaN"', () => {
        // NaN < 0 is false, so the normalization does not fire and toFixed yields
        // the literal 'NaN' straight into the exported table.
        const legs = generateQAN(lineFeature([[NaN, 0], [1, 1]]));
        expect(legs).toHaveLength(1);
        expect(legs[0].azimuth).toBe('NaN');
    });
});

// ============================================================================
// Distance
// ============================================================================

describe('generateQAN - distancia', () => {
    it('distanceMeters e o valor cru e distance e o texto com troca de unidade', () => {
        const leg = generateQAN(lineFeature([P0, P1]))[0];
        expect(typeof leg.distanceMeters).toBe('number');
        // ~0.1 deg of longitude at lat -22.9 is roughly 10.2 km.
        expect(leg.distanceMeters).toBeGreaterThan(10000);
        expect(leg.distance).toMatch(/^\d+\.\d{2} km$/);
    });

    it('abaixo de 1000 m sai em metros com uma casa', () => {
        // ~0.001 deg of latitude is about 111 m.
        const leg = generateQAN(lineFeature([[0, 0], [0, 0.001]]))[0];
        expect(leg.distanceMeters).toBeLessThan(1000);
        expect(leg.distance).toMatch(/^\d+\.\d m$/);
    });

    it('antimeridiano: a perna e curta, nao a volta ao mundo', () => {
        const leg = generateQAN(lineFeature([[179.95, 0], [-179.95, 0]]))[0];
        expect(leg.distanceMeters).toBeLessThan(20000);
        expect(Number(leg.azimuth)).toBeCloseTo(90, 1);
    });
});

// ============================================================================
// Coordinate text
// ============================================================================

describe('generateQAN - texto das coordenadas', () => {
    it('o par [lng, lat] sai INVERTIDO como "lat, lng" com 6 casas', () => {
        const leg = generateQAN(lineFeature([P0, P1]))[0];
        expect(leg.from).toBe('-22.900000, -43.200000');
        expect(leg.to).toBe('-22.900000, -43.100000');
    });

    it('o "to" de uma perna e o "from" da seguinte (encadeamento)', () => {
        const legs = generateQAN(lineFeature([P0, P1, P2]));
        expect(legs).toHaveLength(2);
        expect(legs[0].to).toBe(legs[1].from);
    });

    it('fronteiras de latitude/longitude formatam sem sinal perdido', () => {
        const legs = generateQAN(lineFeature([[-180, -90], [180, 90]]));
        expect(legs).toHaveLength(1);
        expect(legs[0].from).toBe('-90.000000, -180.000000');
        expect(legs[0].to).toBe('90.000000, 180.000000');
    });
});

// ============================================================================
// Observations
// ============================================================================

describe('generateQAN - observacoes', () => {
    it('a observacao i pertence a perna que COMECA no ponto i', () => {
        const legs = generateQAN(lineFeature([P0, P1, P2], ['saida', 'curva']));
        expect(legs).toHaveLength(2);
        expect(legs[0].observation).toBe('saida');
        expect(legs[1].observation).toBe('curva');
    });

    it('observacao faltante vira string vazia', () => {
        const legs = generateQAN(lineFeature([P0, P1, P2], ['so a primeira']));
        expect(legs).toHaveLength(2);
        expect(legs[1].observation).toBe('');
    });

    it('observacoes em excesso sao ignoradas, sem criar pernas', () => {
        const legs = generateQAN(lineFeature([P0, P1], ['a', 'b', 'c']));
        expect(legs).toHaveLength(1);
        expect(legs[0].observation).toBe('a');
    });

    it('sem a propriedade observations todas as pernas ficam com ""', () => {
        const legs = generateQAN(lineFeature([P0, P1, P2]));
        expect(legs).toHaveLength(2);
        expect(legs.every((l) => l.observation === '')).toBe(true);
    });

    it('OBSERVADO: `observations[i] || ""` engole 0 e false, mas preserva "0"', () => {
        // The falsy-swallowing `||`. A numeric 0 written by a caller disappears;
        // the string '0' survives. Pinned so a future refactor to `?? ''` is a
        // deliberate, visible change.
        const legs = generateQAN(lineFeature([P0, P1, P2, [-43.0, -22.8]], [0, false, '0']));
        expect(legs).toHaveLength(3);
        expect(legs[0].observation).toBe('');
        expect(legs[1].observation).toBe('');
        expect(legs[2].observation).toBe('0');
    });

    it('poligono: a perna de fechamento nao tem observacao propria alem do indice n-1', () => {
        const legs = generateQAN(polygonFeature([P0, P1, P2], ['a', 'b', 'c']));
        expect(legs).toHaveLength(3);
        expect(legs.map((l) => l.observation)).toEqual(['a', 'b', 'c']);
    });
});

// ============================================================================
// Row shape
// ============================================================================

describe('generateQAN - forma da linha exportada', () => {
    it('cada perna traz exatamente as sete chaves esperadas', () => {
        const legs = generateQAN(lineFeature([P0, P1]));
        expect(legs).toHaveLength(1);
        expect(Object.keys(legs[0]).sort()).toEqual(
            ['azimuth', 'distance', 'distanceMeters', 'from', 'leg', 'observation', 'to'].sort(),
        );
    });
});
