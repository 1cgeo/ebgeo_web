import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import { readFileSync } from 'node:fs';

/**
 * Coordination line geometry against the REAL turf bundle the app ships.
 *
 * Everything here is a MEASUREMENT of the drawn coordinates, because the two
 * defects this symbol can have are both invisible to a stub: a diamond that does
 * not touch the line it interrupts, and a pattern that eats the line it is
 * supposed to annotate.
 *
 * The seam figures are not decoration. Measured on 2026-09-03 against this same
 * bundle, cutting the gaps with `turf.lineSlice` (which re-projects points onto
 * the line with a planar nearest-point) instead of `turf.lineSliceAlong` left
 * 1.13 m of daylight on a 10 km line and 113.59 m on a 100 km one, because
 * `turf.along`, which places the diamond vertices, interpolates along a great
 * circle. This suite fails loudly if anyone swaps the call back.
 */

// The geometry imports BaseGeometry from the `@tools` barrel, which pulls in
// DOM/MapLibre-coupled modules; a trivial base keeps this file in `node`.
vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
        calculateDistance(a, b) {
            const toRad = (d) => (d * Math.PI) / 180;
            const R = 6371000;
            const dLat = toRad(b[1] - a[1]);
            const dLng = toRad(b[0] - a[0]);
            const h = Math.sin(dLat / 2) ** 2
                + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(h));
        }
    },
}));

const require = createRequire(import.meta.url);

let AddCoordinationLineGeometry;
let geom;
let turf;

beforeAll(async () => {
    // The app loads turf from a <script> tag, so it is a global, not a module:
    // run the shipped bundle in this context and read the global it defines.
    const code = readFileSync(require.resolve('../../public/vendors/turf.min.js'), 'utf8');
    runInThisContext(code);
    turf = globalThis.turf;

    ({ default: AddCoordinationLineGeometry } =
        await import('../../src/js/military_tools/coordination_line_tool/add_coordination_line_geometry.js'));
    geom = new AddCoordinationLineGeometry();
});

/** Metres between two coordinates. */
const metres = (a, b) => turf.distance(turf.point(a), turf.point(b), { units: 'meters' });

/** Kilometres along a coordinate array. */
const lengthKm = (coords) => turf.length(turf.lineString(coords), { units: 'kilometers' });

/** A straight west-to-east line of roughly `km` kilometres at latitude -30. */
const straightLine = (km) => [[-53.0, -30.0], [-53.0 + km / 96.3, -30.0]];

/**
 * Split a generated MultiLineString into the diamonds and the surviving segments.
 * A diamond is exactly five points with the last repeating the first; a segment
 * never closes on itself.
 * @param {Object} geometry - Generated geometry
 * @returns {{diamonds: Array, segments: Array}} The two families
 */
function split(geometry) {
    const diamonds = [];
    const segments = [];

    for (const coords of geometry.coordinates) {
        const first = coords[0];
        const last = coords[coords.length - 1];
        if (coords.length === 5 && first[0] === last[0] && first[1] === last[1]) {
            diamonds.push(coords);
        } else {
            segments.push(coords);
        }
    }

    return { diamonds, segments };
}

/** Build the properties a drawn coordination line would carry. */
const props = (baseCoordinates, overrides = {}) => ({
    baseCoordinates,
    lineWidth: 4,
    symbol_size: 0.5,
    symbol_spacing: 2,
    createdAtZoom: 0,
    zoomCorrectionEnabled: true,
    ...overrides,
});

// ============================================================================
// THE SEAM — the measurement that separates lineSliceAlong from lineSlice
// ============================================================================

describe('the diamond meets the line it interrupts', () => {
    const cases = [
        ['straight 10 km', straightLine(10)],
        ['straight 100 km', straightLine(100)],
        ['90 degree elbow', [[-53.0, -30.0], [-52.98, -30.0], [-52.98, -29.98]]],
        ['zigzag, 8 vertices', Array.from({ length: 8 }, (_, i) => [-53 + i * 0.01, -30 + (i % 2) * 0.004])],
    ];

    for (const [name, baseCoordinates] of cases) {
        it(`${name}: every diamond vertex sits within a millimetre of a segment end`, () => {
            const geometry = geom.generate(props(baseCoordinates), 12);
            expect(geometry.type).toBe('MultiLineString');

            const { diamonds, segments } = split(geometry);
            expect(diamonds.length).toBeGreaterThan(0);
            expect(segments.length).toBeGreaterThan(0);

            // Collect every free end of every segment.
            const ends = segments.flatMap(seg => [seg[0], seg[seg.length - 1]]);

            let worstSeam = 0;
            for (const diamond of diamonds) {
                for (const vertex of [diamond[0], diamond[2]]) {
                    const nearest = Math.min(...ends.map(end => metres(vertex, end)));
                    worstSeam = Math.max(worstSeam, nearest);
                }
            }

            // A millimetre. `lineSlice` would put 1.13 m here on the 10 km case
            // and 113.59 m on the 100 km one.
            expect(worstSeam).toBeLessThan(0.001);
        });
    }
});

// ============================================================================
// THE DIAMOND ITSELF
// ============================================================================

describe('the diamond is the symbol', () => {
    it('has the requested along-line diagonal and is a rhombus', () => {
        const geometry = geom.generate(props(straightLine(10), { symbol_size: 0.5 }), 12);
        const { diamonds } = split(geometry);

        for (const [left, top, right, bottom] of diamonds) {
            expect(metres(left, right)).toBeCloseTo(500, 0);
            expect(metres(top, bottom)).toBeCloseTo(500, 0);
            // All four sides equal: a rhombus, not a kite.
            const sides = [metres(left, top), metres(top, right), metres(right, bottom), metres(bottom, left)];
            for (const side of sides) {
                expect(side).toBeCloseTo(sides[0], 1);
            }
        }
    });

    it('stays a rhombus across a bend, by measuring the chord instead of the request', () => {
        // The elbow is placed so a diamond straddles it: the arc between the two
        // vertices is longer than the chord, and a transverse half-diagonal taken
        // from the requested size would stretch the shape.
        const geometry = geom.generate(props([[-53.0, -30.0], [-52.98, -30.0], [-52.98, -29.98]]), 12);
        const { diamonds } = split(geometry);

        for (const [left, top, right, bottom] of diamonds) {
            expect(metres(left, right)).toBeCloseTo(metres(top, bottom), 1);
        }
    });

    it('places the pattern with equal tails of plain line at both ends', () => {
        const base = straightLine(10);
        const geometry = geom.generate(props(base), 12);
        const { segments } = split(geometry);

        const head = segments.find(seg => metres(seg[0], base[0]) < 0.001);
        const tail = segments.find(seg => metres(seg[seg.length - 1], base[base.length - 1]) < 0.001);

        expect(head).toBeDefined();
        expect(tail).toBeDefined();
        expect(lengthKm(head)).toBeCloseTo(lengthKm(tail), 3);
    });
});

// ============================================================================
// WORST CASE — the inputs the ruler exists to reject
// ============================================================================

describe('worst case', () => {
    it('a size wider than its spacing does NOT eat the line', () => {
        // The raw request is 3 km diamonds every 1 km on a 96 km line. Measured
        // on 2026-09-03 without the invariant: 94 diamonds and 2 stray segments,
        // i.e. no visible line at all.
        const base = straightLine(96);
        const geometry = geom.generate(props(base, { symbol_size: 3, symbol_spacing: 1 }), 12);

        const { diamonds, segments } = split(geometry);
        expect(diamonds.length).toBeGreaterThan(0);

        const visibleKm = segments.reduce((sum, seg) => sum + lengthKm(seg), 0);
        const totalKm = lengthKm(base);
        // Line survives, and there is more line than diamond.
        expect(visibleKm).toBeGreaterThan(totalKm * 0.4);
    });

    it('the diamond ceiling holds when a screen-pinned line is zoomed in hard', () => {
        // A 100 km line drawn at z=12 and viewed at z=22 asks for 51,277
        // diamonds (358,941 vertices, 14 MB of GeoJSON, 135 ms to build).
        const geometry = geom.generate(
            props(straightLine(100), { createdAtZoom: 12, zoomCorrectionEnabled: false }),
            22,
        );

        const { diamonds } = split(geometry);
        expect(diamonds.length).toBeLessThanOrEqual(geom.maxGlyphs);

        const vertexCount = geometry.coordinates.reduce((sum, coords) => sum + coords.length, 0);
        expect(vertexCount).toBeLessThan(2000);
    });

    it('the capped pattern still spans the whole line instead of stopping midway', () => {
        const base = straightLine(100);
        const geometry = geom.generate(
            props(base, { createdAtZoom: 12, zoomCorrectionEnabled: false }),
            22,
        );

        const { diamonds } = split(geometry);
        const lastDiamond = diamonds[diamonds.length - 1];
        const endOfLine = base[base.length - 1];

        // The far end of the line carries a diamond, not 99 km of bare line.
        expect(metres(lastDiamond[2], endOfLine)).toBeLessThan(1500);
    });

    it('degenerate input degrades to the drawn spine, never to empty geometry', () => {
        const spine = straightLine(10);
        const degenerate = [
            ['zero-length line', props([[-53, -30], [-53, -30]])],
            ['diamond longer than the line', props(straightLine(1), { symbol_size: 50 })],
            ['zero spacing', props(spine, { symbol_spacing: 0 })],
            ['NaN spacing', props(spine, { symbol_spacing: NaN })],
            ['NaN size', props(spine, { symbol_size: NaN })],
            ['negative size', props(spine, { symbol_size: -1 })],
            ['single vertex', props([[-53, -30]])],
            ['null coordinates', props(null)],
            ['coordinates as a JSON string', props(JSON.stringify(spine))],
        ];

        for (const [name, properties] of degenerate) {
            const geometry = geom.generate(properties, 12);
            expect(geometry, name).toBeTruthy();
            expect(['LineString', 'MultiLineString'], name).toContain(geometry.type);
            expect(Array.isArray(geometry.coordinates), name).toBe(true);
            expect(geometry.coordinates.length, name).toBeGreaterThan(0);
        }
    });

    it('a line doubling back on itself still draws', () => {
        const geometry = geom.generate(props([[-53, -30], [-52.95, -30], [-53, -30]]), 12);
        const { diamonds, segments } = split(geometry);
        expect(diamonds.length).toBeGreaterThan(0);
        expect(segments.length).toBeGreaterThan(0);
    });
});

// ============================================================================
// THE ZOOM SWITCH, MEASURED
// ============================================================================

describe('zoom anchor, measured on the drawing', () => {
    it('screen-pinned: zooming in two levels quarters the diamond on the ground', () => {
        const base = straightLine(10);
        const at12 = geom.generate(props(base, { createdAtZoom: 12, zoomCorrectionEnabled: false }), 12);
        const at14 = geom.generate(props(base, { createdAtZoom: 12, zoomCorrectionEnabled: false }), 14);

        const size = (geometry) => {
            const [left, , right] = split(geometry).diamonds[0];
            return metres(left, right);
        };

        expect(size(at12)).toBeCloseTo(500, 0);
        expect(size(at14)).toBeCloseTo(125, 0);
    });

    it('terrain-pinned: the diamond keeps its ground size at every zoom', () => {
        const base = straightLine(10);
        const size = (zoom) => {
            const geometry = geom.generate(props(base, { createdAtZoom: 12, zoomCorrectionEnabled: true }), zoom);
            const [left, , right] = split(geometry).diamonds[0];
            return metres(left, right);
        };

        expect(size(10)).toBeCloseTo(500, 0);
        expect(size(12)).toBeCloseTo(500, 0);
        expect(size(16)).toBeCloseTo(500, 0);
    });
});

// ============================================================================
// EDIT HANDLES
// ============================================================================

describe('edit handles', () => {
    const feature = {
        properties: { id: 'abc', baseCoordinates: [[-53, -30], [-52.98, -30], [-52.98, -29.98]] },
    };

    it('gives one handle per vertex and one per segment midpoint', () => {
        const handles = geom.createHandles(feature);
        expect(handles.filter(h => h.properties.type === 'vertex')).toHaveLength(3);
        expect(handles.filter(h => h.properties.type === 'midpoint')).toHaveLength(2);
        expect(handles.every(h => h.properties.user_isEditingHandle === true)).toBe(true);
    });

    it('a vertex drag moves that vertex and nothing else', () => {
        const result = geom.updateFromHandle('vertex', [-52.99, -30.01], feature, 1, 12);
        expect(result.baseCoordinates).toHaveLength(3);
        expect(result.baseCoordinates[1]).toEqual([-52.99, -30.01]);
        expect(result.baseCoordinates[0]).toEqual([-53, -30]);
    });

    it('a midpoint drag INSERTS a vertex between its neighbours', () => {
        const result = geom.updateFromHandle('midpoint', [-52.99, -30.01], feature, 0, 12);
        expect(result.baseCoordinates).toHaveLength(4);
        expect(result.baseCoordinates[1]).toEqual([-52.99, -30.01]);
    });

    it('refuses a drag it cannot apply instead of corrupting the spine', () => {
        expect(geom.updateFromHandle('vertex', [-52.99, -30.01], feature, 99, 12)).toBeNull();
        expect(geom.updateFromHandle('midpoint', [-52.99, -30.01], feature, 2, 12)).toBeNull();
        expect(geom.updateFromHandle('bogus', [-52.99, -30.01], feature, 0, 12)).toBeNull();
        expect(geom.updateFromHandle('vertex', [NaN, -30.01], feature, 0, 12)).toBeNull();
    });

    it('keeps the minimum of two vertices when removing', () => {
        expect(geom.removeVertexAtIndex([[-53, -30], [-52.98, -30], [-52.98, -29.98]], 1)).toHaveLength(2);
        expect(geom.removeVertexAtIndex([[-53, -30], [-52.98, -30]], 0)).toBeNull();
        expect(geom.removeVertexAtIndex([[-53, -30], [-52.98, -30], [-52.98, -29.98]], 9)).toBeNull();
    });
});

// ============================================================================
// describeLayout — what the panel tells the user
// ============================================================================

describe('describeLayout', () => {
    it('reports the count and whether the ceiling fired', () => {
        const plain = geom.describeLayout(props(straightLine(10)), 12);
        expect(plain.count).toBe(5);
        expect(plain.capped).toBe(false);

        const capped = geom.describeLayout(
            props(straightLine(100), { createdAtZoom: 12, zoomCorrectionEnabled: false }),
            22,
        );
        expect(capped.count).toBe(geom.maxGlyphs);
        expect(capped.capped).toBe(true);
    });

    it('reports zero for a line too short to carry one whole diamond', () => {
        const tiny = geom.describeLayout(props(straightLine(0.1), { symbol_size: 5 }), 12);
        expect(tiny.count).toBe(0);
    });
});

// ============================================================================
// THE CATALOGUE — one drawing problem, five symbols, two axes of variation
// ============================================================================

/**
 * Total length of every emitted ring, in kilometres.
 * @param {Object} geometry - Generated geometry
 * @returns {number} Length in kilometres
 */
const totalDrawn = (geometry) => geometry.coordinates
    .reduce((sum, coords) => sum + lengthKm(coords), 0);

/** Rings of a given vertex count. */
const ringsOfSize = (geometry, n) => geometry.coordinates.filter(c => c.length === n);

/**
 * The unbroken spine a non-interrupting symbol rides on: the one ring as long as
 * the line itself. On a straight two-vertex line the spine is ALSO a two-point
 * ring, so every count of strokes has to exclude it explicitly.
 */
const spineOf = (geometry, base) =>
    geometry.coordinates.find(c => lengthKm(c) > lengthKm(base) * 0.99);

/** Two-point strokes that are not the spine. */
const strokesOf = (geometry, base) => geometry.coordinates
    .filter(c => c.length === 2 && lengthKm(c) < lengthKm(base) * 0.5);

describe('catalogo de simbolos lineares', () => {
    const base = straightLine(10);

    it('a linha de obstaculos (290100) desenha picos de tres pontos e INTERROMPE a linha', () => {
        const geometry = geom.generate(props(base, { symbol_code: '290100' }), 12);
        const picos = ringsOfSize(geometry, 3);

        expect(picos.length).toBe(5);
        // Interrupted: what is drawn is shorter than the spine plus the glyphs
        // would be if the line ran whole underneath them.
        expect(totalDrawn(geometry)).toBeLessThan(lengthKm(base) * 1.5);

        for (const [left, apex, right] of picos) {
            // The apex stands off the line; the two feet sit on it.
            expect(metres(left, apex)).toBeGreaterThan(1);
            expect(metres(apex, right)).toBeGreaterThan(1);
            expect(metres(left, apex)).toBeCloseTo(metres(apex, right), 1);
        }
    });

    it('a cerca de arame (290302) poe tres tracos por simbolo e NAO interrompe a linha', () => {
        const geometry = geom.generate(props(base, { symbol_code: '290302' }), 12);
        expect(strokesOf(geometry, base).length).toBe(5 * 3);

        // The spine survives whole underneath: one ring covers the full length.
        expect(spineOf(geometry, base)).toBeDefined();
    });

    it('a cerca de arame dupla (290303) poe seis tracos por simbolo', () => {
        const geometry = geom.generate(props(base, { symbol_code: '290303' }), 12);
        const esperado = geom.describeLayout(props(base, { symbol_code: '290303' }), 12).count;

        expect(esperado).toBeGreaterThan(0);
        expect(strokesOf(geometry, base).length).toBe(esperado * 6);
        expect(spineOf(geometry, base)).toBeDefined();
    });

    it('a concertina (290307) desenha lacos fechados APOIADOS na linha, todos do mesmo lado', () => {
        const properties = props(base, { symbol_code: '290307' });
        const geometry = geom.generate(properties, 12);
        const esperado = geom.describeLayout(properties, 12).count;

        const lacos = ringsOfSize(geometry, 17);
        expect(lacos.length).toBe(esperado);

        // Measured against the DRAWN spine, not the clicked base line. The two
        // differ by the great-circle bow (1.13 m on this 10 km line, measured on
        // 2026-09-03), and the loop is placed by the same convention as the
        // spine, so the spine is the honest reference.
        const espinhaCoords = spineOf(geometry, base);
        expect(espinhaCoords).toBeDefined();
        const espinha = turf.lineString(espinhaCoords);
        for (const laco of lacos) {
            // Closed ring.
            expect(laco[0]).toEqual(laco[laco.length - 1]);
            // Every vertex on the same side, and the lowest one touching the line.
            const lados = laco.map(p => Math.sign(
                turf.pointToLineDistance(turf.point(p), espinha, { units: 'meters', method: 'planar' })
            ));
            const distancias = laco.map(p => Math.abs(
                turf.pointToLineDistance(turf.point(p), espinha, { units: 'meters' })
            ));
            // The loop stands on the line to within a fraction of its own height.
            // The residual is NOT slack in the glyph: it is the great-circle bow,
            // measured at 1.13 m on this 10 km east-west line on 2026-09-03. The
            // spine of a straight line is drawn between its two clicked vertices,
            // while the loop is anchored at a turf.along point, and the two
            // conventions differ by exactly that. Symbols that INTERRUPT the line
            // do not show it, because both sides of their seam come from along
            // (see the seam suite above, which measures 0.000 m).
            const altura = Math.max(...distancias);
            expect(Math.min(...distancias)).toBeLessThan(altura * 0.02);
            expect(altura).toBeGreaterThan(100);
            expect(new Set(lados.filter(s => s !== 0)).size).toBeLessThanOrEqual(1);
        }
    });

    it('um codigo desconhecido cai no simbolo padrao em vez de lancar', () => {
        const geometry = geom.generate(props(base, { symbol_code: '999999' }), 12);
        const padrao = geom.generate(props(base, { symbol_code: '290199' }), 12);
        expect(geometry).toEqual(padrao);
    });

    it('WORST CASE: todo simbolo do catalogo sobrevive aos insumos degenerados', () => {
        const spine = straightLine(10);
        const codigos = ['290100', '290199', '290302', '290303', '290307'];
        const degenerados = [
            ['linha de comprimento zero', [[-53, -30], [-53, -30]]],
            ['vai-e-volta', [[-53, -30], [-52.95, -30], [-53, -30]]],
        ];

        for (const code of codigos) {
            for (const [nome, coords] of degenerados) {
                const geometry = geom.generate(props(coords, { symbol_code: code }), 12);
                expect(geometry, `${code} / ${nome}`).toBeTruthy();
                expect(['LineString', 'MultiLineString'], `${code} / ${nome}`).toContain(geometry.type);
            }
            // E o teto vale para todos, nao so para o losango.
            const apertado = geom.generate(
                props(spine, { symbol_code: code, symbol_size: 0.001, symbol_spacing: 0.002 }), 12,
            );
            expect(geom.describeLayout(
                props(spine, { symbol_code: code, symbol_size: 0.001, symbol_spacing: 0.002 }), 12,
            ).count, code).toBeLessThanOrEqual(geom.maxGlyphs);
            expect(apertado.coordinates.length, code).toBeGreaterThan(0);
        }
    });
});
