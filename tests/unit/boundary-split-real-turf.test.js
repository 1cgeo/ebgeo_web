import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import { readFileSync } from 'node:fs';

/**
 * Cutting a boundary, measured against the REAL turf bundle the app ships.
 *
 * `boundary-split-model.test.js` pins the arithmetic with lengths handed to it;
 * it cannot tell whether those numbers put the echelon symbol back on the same
 * PATCH OF GROUND. Everything here is a measurement in metres, which is the only
 * way to catch a symbol that survives the cut and lands somewhere else.
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
let splitSpineAtPoint;
let splitSymbolInstances;

beforeAll(async () => {
    // The app loads turf from a <script> tag, so it is a global, not a module.
    const code = readFileSync(require.resolve('../../public/vendors/turf.min.js'), 'utf8');
    runInThisContext(code);
    turf = globalThis.turf;

    ({ default: AddBoundaryGeometry } = await import('../../src/js/military_tools/boundary_tool/add_boundary_geometry.js'));
    ({ splitSpineAtPoint, splitSymbolInstances } =
        await import('../../src/js/military_tools/boundary_tool/boundary-split.model.js'));
    geom = new AddBoundaryGeometry();
});

// A bent spine, so the cut lands on a real segment and not on a straight run.
const SPINE = [
    [-47.90, -15.80],
    [-47.70, -15.72],
    [-47.55, -15.60],
    [-47.30, -15.55],
];

const CUT_FRACTION = 0.4;

/** Kilometres of a coordinate array. */
const lengthKm = (coords) => turf.length(turf.lineString(coords), { units: 'kilometers' });

/** Metres between two coordinates. */
const metres = (a, b) => turf.distance(turf.point(a), turf.point(b), { units: 'meters' });

/** The ground position at `ratio` of a spine. */
const positionAt = (coords, ratio) =>
    turf.along(turf.lineString(coords), lengthKm(coords) * ratio, { units: 'kilometers' })
        .geometry.coordinates;

/**
 * Cut SPINE at CUT_FRACTION the way the tool does: snap the click onto the
 * line, read the segment it hit, hand both to the model.
 * @returns {Object} The halves and their measured lengths
 */
function cutSpine() {
    const line = turf.lineString(SPINE);
    const totalLength = lengthKm(SPINE);
    const clickPoint = turf.along(line, totalLength * CUT_FRACTION, { units: 'kilometers' });
    const snapped = turf.nearestPointOnLine(line, clickPoint);

    const halves = splitSpineAtPoint(SPINE, snapped.properties.index, snapped.geometry.coordinates);
    return {
        halves,
        totalLength,
        firstLength: lengthKm(halves.first),
        secondLength: lengthKm(halves.second),
    };
}

/**
 * Properties of a boundary carrying one echelon instance at `ratio`.
 * @param {Array<Array<number>>} coordinates - Spine
 * @param {Array<Object>} instances - Symbol instances
 * @returns {Object} Boundary properties
 */
function boundaryProps(coordinates, instances) {
    return {
        source: 'boundary',
        baseCoordinates: coordinates,
        echelon: 'XX',
        symbol_instances: instances,
        symbol_size: 1,
        calculatedSymbolSize: 1,
        text_distance_ratio: 0.9,
        createdAtZoom: 12,
        zoomCorrectionEnabled: true,
        lineWidth: 4,
    };
}

describe('cutting a boundary keeps the echelon on the same ground', () => {
    it('splits the spine into two halves that add up to the original', () => {
        const { totalLength, firstLength, secondLength } = cutSpine();
        expect(firstLength + secondLength).toBeCloseTo(totalLength, 6);
        expect(firstLength / totalLength).toBeCloseTo(CUT_FRACTION, 3);
    });

    // THE CLAIM THE WHOLE FEATURE RESTS ON, in the unit the drawing resolves a
    // ratio to: distance along the line.
    it('leaves the symbol at the same distance along the boundary', () => {
        const { totalLength, firstLength, secondLength } = cutSpine();

        const { first, second } = splitSymbolInstances(
            [{ ratio: 0.5, showLabels: true }],
            { totalLength, firstLength, secondLength },
        );

        // The cut is at 40%, so the symbol at 50% belongs to the second half.
        expect(second).toHaveLength(1);
        expect(firstLength + second[0].ratio * secondLength).toBeCloseTo(totalLength * 0.5, 6);

        // And the half that lost it gets the centred fallback, not a copy.
        expect(first).toEqual([{ ratio: 0.5, showLabels: true }]);
    });

    // The same claim on the ground, with a tolerance that is MEASURED rather
    // than guessed. The cut comes from `nearestPointOnLine`, which reads a
    // segment as a straight line in degrees, while `turf.along` — what places a
    // symbol — walks the great circle. On this 71 km spine the two conventions
    // sit about 6 m apart at the cut, and the symbol inherits a metre of it.
    // The remap itself is exact: see the assertion above.
    it('leaves the symbol within a few metres of where it was drawn', () => {
        const { halves, totalLength, firstLength, secondLength } = cutSpine();
        const before = positionAt(SPINE, 0.5);

        const { second } = splitSymbolInstances(
            [{ ratio: 0.5, showLabels: true }],
            { totalLength, firstLength, secondLength },
        );

        expect(metres(before, positionAt(halves.second, second[0].ratio))).toBeLessThan(10);
    });

    // THE WORST CASE, priced. `{ ...originalProps }` is what `line-split.js`
    // does, and on a boundary it is wrong by kilometres, not by rounding.
    it('measures how far the naive copy of the ratios would move the symbol', () => {
        const { halves, totalLength } = cutSpine();
        const before = positionAt(SPINE, 0.5);

        const naiveSecond = positionAt(halves.second, 0.5);
        const naiveFirst = positionAt(halves.first, 0.5);

        expect(metres(before, naiveSecond)).toBeGreaterThan(1000);
        expect(metres(before, naiveFirst)).toBeGreaterThan(1000);

        // Two symbols where the user drew one, and the drift is a real fraction
        // of the line, not a rounding error.
        expect(metres(before, naiveSecond) / 1000).toBeLessThan(totalLength);
    });

    it('draws both halves, with the gap and the strokes of the echelon', () => {
        const { halves, totalLength, firstLength, secondLength } = cutSpine();
        const instances = splitSymbolInstances(
            [{ ratio: 0.2, showLabels: true }, { ratio: 0.8, showLabels: true }],
            { totalLength, firstLength, secondLength },
        );

        for (const [side, coordinates] of [['first', halves.first], ['second', halves.second]]) {
            const properties = boundaryProps(coordinates, instances[side]);
            const geometry = geom.generate(properties, 12);

            expect(geometry.type).toBe('MultiLineString');
            // Two visible segments around one gap, plus the four strokes of 'XX'.
            expect(geometry.coordinates.length).toBeGreaterThanOrEqual(6);
            for (const part of geometry.coordinates) {
                for (const point of part) {
                    expect(Number.isFinite(point[0])).toBe(true);
                    expect(Number.isFinite(point[1])).toBe(true);
                }
            }
        }
    });

    // A cut landing on a vertex is snapped onto it, and the half must not carry
    // the vertex twice: a repeated point is a segment with no bearing, and every
    // symbol and label is placed by one.
    it('draws a half cut exactly on a vertex', () => {
        const vertex = SPINE[1];
        const halves = splitSpineAtPoint(SPINE, 0, vertex);

        expect(halves.first).toEqual([SPINE[0], vertex]);
        expect(halves.second[0]).toEqual(vertex);

        for (const coordinates of [halves.first, halves.second]) {
            const geometry = geom.generate(boundaryProps(coordinates, [{ ratio: 0.5, showLabels: true }]), 12);
            expect(geometry.coordinates.length).toBeGreaterThanOrEqual(2);
            for (const part of geometry.coordinates) {
                for (const point of part) {
                    expect(Number.isFinite(point[0])).toBe(true);
                    expect(Number.isFinite(point[1])).toBe(true);
                }
            }
        }
    });
});
