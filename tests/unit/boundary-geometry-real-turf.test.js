import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import { readFileSync } from 'node:fs';

/**
 * Boundary geometry against the REAL turf bundle the app ships.
 *
 * The sibling `boundary-geometry.test.js` drives a stub whose line is always
 * 10 km and whose `along`/`destination` only record the numbers they are given:
 * perfect for pinning the arithmetic, blind to whether the result lands on the
 * line. Everything in this file is a MEASUREMENT of the drawn coordinates
 * (distances in metres, gap lengths in km), which is the only way to catch a
 * symbol that drifts off its boundary or a gap that swallows it.
 */

// The geometry imports BaseGeometry from the `@tools` barrel, which pulls in
// DOM/MapLibre-coupled modules; a trivial base keeps this file in `node`.
vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
        calculateDistance() { return 0; }
    },
}));

const require = createRequire(import.meta.url);

let AddBoundaryGeometry;
let geom;
let turf;

beforeAll(async () => {
    // The app loads turf from a <script> tag, so it is a global, not a module:
    // run the shipped bundle in this context and read the global it defines.
    const code = readFileSync(require.resolve('../../public/vendors/turf.min.js'), 'utf8');
    runInThisContext(code);
    turf = globalThis.turf;

    ({ default: AddBoundaryGeometry } = await import('../../src/js/military_tools/boundary_tool/add_boundary_geometry.js'));
    geom = new AddBoundaryGeometry();
});

/** Metres between a coordinate and a polyline. */
const distToLine = (coord, lineCoords) =>
    turf.pointToLineDistance(turf.point(coord), turf.lineString(lineCoords), { units: 'meters' });

/** Kilometres between two coordinates. */
const km = (a, b) => turf.distance(turf.point(a), turf.point(b), { units: 'kilometers' });

/** Length of a coordinate array, in kilometres. */
const lengthKm = (coords) => turf.length(turf.lineString(coords), { units: 'kilometers' });

/**
 * Split a generated MultiLineString into the pieces that lie ON the boundary
 * (the visible segments) and the pieces that do not (the echelon strokes).
 * The threshold is 1 m: an 'X' stroke leaves the line at 45 degrees and its
 * endpoints sit `size / 2 * sin45` away, which is tens of metres at any size
 * this suite uses.
 */
function splitLines(geometry, baseCoordinates) {
    const segments = [];
    const strokes = [];

    for (const line of geometry.coordinates) {
        const onLine = distToLine(line[0], baseCoordinates) < 1
            && distToLine(line[line.length - 1], baseCoordinates) < 1;
        (onLine ? segments : strokes).push(line);
    }

    return { segments, strokes };
}

const STRAIGHT = [[-47.0, -15.0], [-46.9, -15.05]];
const JAGGED = [
    [-47.00, -15.00], [-46.99, -15.004], [-46.985, -15.001],
    [-46.975, -15.006], [-46.96, -15.003], [-46.95, -15.01],
];

const INSTANCES = [
    { ratio: 0.4, showLabels: true },
    { ratio: 0.5, showLabels: true },
    { ratio: 0.6, showLabels: true },
];

/** A boundary pinned to the SCREEN, anchored at zoom 13.2. */
const screenPinned = (baseCoordinates, extra = {}) => ({
    id: 'b1',
    baseCoordinates,
    echelon: 'X',
    symbol_instances: INSTANCES,
    symbol_size: 0.3,
    createdAtZoom: 13.2,
    zoomCorrectionEnabled: false,
    text_top: 'CIA A',
    text_bottom: 'CIA B',
    text_size: 35,
    text_distance_ratio: 0.9,
    ...extra,
});

// ============================================================================
// (a) The drawing follows the CURRENT zoom and stays on the line
// ============================================================================

describe('boundary drawn at a given zoom', () => {
    const ZOOMS = [13.2, 15, 17, 17.9];

    for (const [name, baseCoordinates] of [['a straight line', STRAIGHT], ['a jagged polyline', JAGGED]]) {
        it(`keeps every echelon stroke on ${name} at every zoom`, () => {
            const props = screenPinned(baseCoordinates);
            const total = lengthKm(baseCoordinates);

            for (const zoom of ZOOMS) {
                const effective = geom.resolveSymbolSize(props, zoom, total).effective;
                // Pinned to the screen: the symbol shrinks by 2 ** (z0 - z) as the
                // map zooms in, which is what keeps it the same size in pixels.
                expect(effective).toBeCloseTo(0.3 * 2 ** (13.2 - zoom), 10);

                const { strokes } = splitLines(geom.generate(props, zoom), baseCoordinates);
                expect(strokes.length).toBe(INSTANCES.length * 2); // two per 'X'

                for (const stroke of strokes) {
                    const mid = turf.midpoint(turf.point(stroke[0]), turf.point(stroke[1])).geometry.coordinates;
                    // The X is centred on the boundary: its diagonals cross ON the line.
                    expect(distToLine(mid, baseCoordinates)).toBeLessThan(2);
                    // ...and each diagonal is `size` long, side to side.
                    expect(km(stroke[0], stroke[1])).toBeCloseTo(effective, 3);
                }
            }
        });

        it(`places every label at effective * text_distance_ratio on ${name}`, () => {
            const props = screenPinned(baseCoordinates);
            const line = turf.lineString(baseCoordinates);
            const total = lengthKm(baseCoordinates);

            for (const zoom of ZOOMS) {
                const effective = geom.resolveSymbolSize(props, zoom, total).effective;
                const expected = effective * 0.9;

                const texts = geom.generateBoundaryTexts({ type: 'Feature', properties: props }, zoom);
                expect(texts.length).toBe(INSTANCES.length * 2); // top + bottom

                for (const [index, text] of texts.entries()) {
                    // Measured from the symbol's own centre, not from the polyline:
                    // a label pushed perpendicular to the LOCAL bearing near a
                    // vertex is legitimately closer to the NEXT segment.
                    const ratio = INSTANCES[Math.floor(index / 2)].ratio;
                    const centre = turf.along(line, total * ratio, { units: 'kilometers' });
                    const offset = km(centre.geometry.coordinates, text.geometry.coordinates);
                    expect(Math.abs(offset - expected) / expected).toBeLessThan(0.05);
                }
            }
        });
    }
});

// ============================================================================
// (b) A stale derived size is ignored when a zoom is available
// ============================================================================

describe('stale calculatedSymbolSize', () => {
    it('changes nothing about the drawing when the zoom is known', () => {
        const clean = screenPinned(STRAIGHT);
        // 50 km is the old MAX_SYMBOL_SIZE_KM clamp: the value a boundary picks up
        // after a pass at a far-out zoom, and the one that used to be drawn by
        // every copy of the feature living outside the source.
        const stale = screenPinned(STRAIGHT, { calculatedSymbolSize: 50 });

        expect(geom.generate(stale, 17)).toEqual(geom.generate(clean, 17));
        expect(geom.generateBoundaryTexts({ type: 'Feature', properties: stale }, 17))
            .toEqual(geom.generateBoundaryTexts({ type: 'Feature', properties: clean }, 17));
    });

    it('is still what the drawing falls back to when there is no zoom at all', () => {
        // Callers with no map (the linear conversion helper) have nothing else to
        // go on, and that is the behaviour this repo shipped before the zoom
        // travelled with the call.
        const stale = screenPinned(STRAIGHT, { calculatedSymbolSize: 0.02 });
        expect(geom.resolveSymbolSize(stale, undefined, lengthKm(STRAIGHT)).effective).toBeCloseTo(0.02, 10);
    });
});

// ============================================================================
// (c) The echelon may not eat the line it annotates
// ============================================================================

describe('cap by line length', () => {
    const SHORT = [[-47.0, -15.0], [-47.0, -15.0179856]]; // ~2 km, straight
    const oversized = () => ({
        id: 'b-cap',
        baseCoordinates: SHORT,
        echelon: 'XXX',
        symbol_instances: [{ ratio: 0.5, showLabels: true }],
        symbol_size: 5,
        createdAtZoom: 13.2,
        zoomCorrectionEnabled: false,
    });

    it('leaves half the line visible for a symbol far too big for it', () => {
        const props = oversized();
        const total = lengthKm(SHORT);
        expect(total).toBeCloseTo(2, 1);

        const { segments } = splitLines(geom.generate(props, 13.2), SHORT);
        const visible = segments.reduce((sum, seg) => sum + lengthKm(seg), 0);

        // Two visible stretches, one on each side of the single gap...
        expect(segments.length).toBe(2);
        // ...and the gap takes no more than half the line (5 km of authored
        // symbol on a 2 km line used to leave nothing at all).
        expect(total - visible).toBeLessThanOrEqual(total * 0.5 + 1e-6);
        expect(visible).toBeGreaterThan(total * 0.49);
    });

    it('saturates at the same drawing when zoomed far out with the correction off', () => {
        // Eight zoom levels out the ground factor is 256, so the derived size is
        // 1280 km: without the cap the "boundary" is a symbol with no line left.
        const props = oversized();
        expect(geom.resolveSymbolSize(props, 5.2, lengthKm(SHORT)).effective)
            .toBeCloseTo(geom.resolveSymbolSize(props, 13.2, lengthKm(SHORT)).effective, 12);
        expect(geom.generate(props, 5.2)).toEqual(geom.generate(props, 13.2));
    });
});

// ============================================================================
// (d) The size handle writes the BASE for the zoom it was dragged at
// ============================================================================

describe('size handle at a zoom', () => {
    it('converts the dragged ground size into the authored base', () => {
        const props = screenPinned(STRAIGHT, { symbol_size: 0.3 });
        const line = turf.lineString(STRAIGHT);
        const total = lengthKm(STRAIGHT);
        // The shared handles anchor on the LEFTMOST instance (ratio 0.4).
        const centre = turf.along(line, total * 0.4, { units: 'kilometers' });
        // Drag to 20 m from the centre, i.e. an EFFECTIVE symbol of 40 m.
        const dragged = turf.destination(centre, 0.02, 30, { units: 'kilometers' });

        const out = geom.updateFromHandle(
            'size_handle', dragged.geometry.coordinates, { properties: props }, null, 17,
        );

        expect(out.properties.symbol_size).toBeCloseTo(0.04 / 2 ** (13.2 - 17), 4);
        // The cache belongs to the zoom pass: the drag must not write it, or the
        // value travels on the selection copy and outlives the zoom it was for.
        expect(out.properties.calculatedSymbolSize).toBeUndefined();

        // Round trip: drawn back at zoom 17, the symbol is the 40 m that was dragged.
        expect(geom.resolveSymbolSize(out.properties, 17, total).effective).toBeCloseTo(0.04, 6);
    });
});

// ============================================================================
// (e) The bulk rebuild covers EVERY boundary
// ============================================================================

describe('buildDependentFeatures', () => {
    const boundary = (id, ratioShift) => screenPinned(STRAIGHT, {
        id,
        echelon: 'oXo',
        symbol_instances: [{ ratio: 0.3 + ratioShift, showLabels: true }],
    });

    it('returns the children of all the boundaries it is given', () => {
        const features = ['b1', 'b2', 'b3'].map((id, i) => ({
            type: 'Feature',
            properties: boundary(id, i * 0.2),
        }));

        const { circles, texts } = geom.buildDependentFeatures(features, 15);

        // Two labels and two 'o' circles per boundary. The restore path used to
        // keep only the LAST boundary's children, because every per-feature call
        // read the same empty collection before any of them had written.
        expect(texts.length).toBe(6);
        expect(circles.length).toBe(6);
        expect(new Set(texts.map(t => t.properties.parent))).toEqual(new Set(['b1', 'b2', 'b3']));
        expect(new Set(circles.map(c => c.properties.parent))).toEqual(new Set(['b1', 'b2', 'b3']));
    });

    it('skips malformed entries instead of throwing the whole rebuild away', () => {
        const features = [null, { type: 'Feature' }, { type: 'Feature', properties: boundary('b9', 0) }];
        const { texts } = geom.buildDependentFeatures(features, 15);

        expect(texts.map(t => t.properties.parent)).toEqual(['b9', 'b9']);
        expect(geom.buildDependentFeatures(undefined, 15)).toEqual({ circles: [], texts: [] });
    });
});

describe('symbolSizeBounds (what the "Tamanho do símbolo" slider shows)', () => {
    const straight = [[-47.0, -15.0], [-46.9, -15.05]]; // ~12.09 km
    const threeX = {
        baseCoordinates: straight,
        echelon: 'X',
        symbol_instances: [{ ratio: 0.4 }, { ratio: 0.5 }, { ratio: 0.6 }],
        symbol_size: 0.3,
        createdAtZoom: 13.2,
    };

    it('tops out at the line-length cap and shows the authored size when anchored to the ground', () => {
        const bounds = geom.symbolSizeBounds({ ...threeX, zoomCorrectionEnabled: true }, 15);
        // 12.09 km * 0.5 / (3 instances * 1 symbol * 1.8)
        expect(bounds.max).toBeCloseTo(bounds.lengthKm * 0.5 / (3 * 1.8), 6);
        expect(bounds.max).toBeCloseTo(1.12, 2);
        expect(bounds.effective).toBeCloseTo(0.3, 9);
        expect(bounds.groundFactor).toBe(1);
        expect(bounds.min).toBeCloseTo(0.05, 9);
    });

    it('shows the drawn (zoom-scaled) size for a screen-pinned boundary, with the same cap', () => {
        const bounds = geom.symbolSizeBounds({ ...threeX, zoomCorrectionEnabled: false }, 17);
        const factor = 2 ** (13.2 - 17);
        expect(bounds.groundFactor).toBeCloseTo(factor, 9);
        expect(bounds.effective).toBeCloseTo(0.3 * factor, 9);
        expect(bounds.max).toBeCloseTo(1.12, 2);
        // The floor follows the zoom too, so the slider still has room to shrink.
        expect(bounds.min).toBeCloseTo(0.05 * factor, 9);
    });

    it('saturates the drawn size at the cap when the authored size is larger', () => {
        const bounds = geom.symbolSizeBounds({ ...threeX, zoomCorrectionEnabled: true, symbol_size: 5 }, 15);
        expect(bounds.effective).toBeCloseTo(bounds.max, 9);
        expect(bounds.base).toBe(5);
    });

    it('falls back to the global limits when there is no usable line', () => {
        const bounds = geom.symbolSizeBounds({ ...threeX, baseCoordinates: null }, 15);
        expect(bounds.max).toBe(50);
        expect(bounds.min).toBeGreaterThanOrEqual(0.001);
        expect(Number.isNaN(bounds.lengthKm)).toBe(true);
    });
});
