// Path: tests/unit/boundary-split-model.test.js
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// The parity check at the bottom imports the GEOMETRY, whose `@tools` barrel
// pulls in DOM/MapLibre-coupled modules. A trivial BaseGeometry keeps this file
// runnable in the `node` environment; nothing here calls a geometry method.
// The MODEL itself needs no mock: it sits under `tool_manager/helpers/` and its
// only import is the sibling `linear-conversion.model.js`, another pure leaf.
vi.mock('@tools', () => ({ BaseGeometry: class {} }));

import {
    MIN_SPLIT_DISTANCE_METERS,
    SPLIT_RATIO_MIN,
    SPLIT_RATIO_MAX,
    canSplitBoundary,
    splitSpineAtPoint,
    splitSymbolInstances,
} from '../../src/js/tool_manager/helpers/boundary-split.model.js';
import AddBoundaryGeometry from '../../src/js/military_tools/boundary_tool/add_boundary_geometry.js';

const A = [-47.9, -15.8];
const B = [-47.8, -15.7];
const C = [-47.7, -15.6];
const MID_AB = [-47.85, -15.75];

/**
 * @param {Object} [props] - Property overrides
 * @returns {Object} A minimal boundary feature
 */
function boundary(props = {}) {
    return {
        type: 'Feature',
        properties: {
            source: 'boundary',
            id: 'b-1',
            baseCoordinates: [A, B, C],
            echelon: 'XX',
            symbol_instances: [{ ratio: 0.5, showLabels: true }],
            ...props,
        },
        // The real thing: segments and echelon strokes in one MultiLineString.
        geometry: {
            type: 'MultiLineString',
            coordinates: [[A, MID_AB], [MID_AB, C], [A, B], [B, C]],
        },
    };
}

// ============================================================================
// canSplitBoundary
// ============================================================================

describe('canSplitBoundary', () => {
    it('accepts one unlocked boundary', () => {
        expect(canSplitBoundary([boundary()])).toEqual({ canSplit: true });
    });

    it('refuses a selection that is not exactly one feature', () => {
        for (const selection of [null, undefined, [], [boundary(), boundary()]]) {
            expect(canSplitBoundary(selection).canSplit).toBe(false);
        }
    });

    it('refuses a feature of another type', () => {
        expect(canSplitBoundary([boundary({ source: 'line' })]).canSplit).toBe(false);
    });

    // THE WORST CASE this check exists to catch. A boundary draws a
    // MultiLineString that mixes its own segments with the strokes of the
    // echelon symbols, so the line tool's `geometry.coordinates.length >= 2`
    // counts PARTS and passes a boundary with no spine at all.
    it('refuses a boundary whose spine is gone even though its geometry has parts', () => {
        const spineless = boundary({ baseCoordinates: undefined });
        expect(spineless.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
        expect(canSplitBoundary([spineless]).canSplit).toBe(false);
    });

    it('refuses a spine of a single vertex', () => {
        expect(canSplitBoundary([boundary({ baseCoordinates: [A] })]).canSplit).toBe(false);
    });

    it('reads a spine persisted as a JSON string', () => {
        const legacy = boundary({ baseCoordinates: JSON.stringify([A, B, C]) });
        expect(canSplitBoundary([legacy]).canSplit).toBe(true);
    });

    it('refuses a locked boundary, including the truthy string', () => {
        expect(canSplitBoundary([boundary({ bloqueado: true })]).canSplit).toBe(false);
        expect(canSplitBoundary([boundary({ bloqueado: 'true' })]).canSplit).toBe(false);
    });

    it('accepts the falsy forms of bloqueado', () => {
        for (const value of [false, undefined, '', 0]) {
            expect(canSplitBoundary([boundary({ bloqueado: value })]).canSplit).toBe(true);
        }
    });

    it('always explains a refusal', () => {
        const refusals = [
            canSplitBoundary([]),
            canSplitBoundary([boundary({ source: 'line' })]),
            canSplitBoundary([boundary({ baseCoordinates: [A] })]),
            canSplitBoundary([boundary({ bloqueado: true })]),
        ];
        for (const refusal of refusals) {
            expect(refusal.reason).toBeTruthy();
        }
    });
});

// ============================================================================
// splitSpineAtPoint
// ============================================================================

describe('splitSpineAtPoint', () => {
    it('cuts a segment in two, repeating the cut at the seam', () => {
        const halves = splitSpineAtPoint([A, B, C], 0, MID_AB);
        expect(halves.first).toEqual([A, MID_AB]);
        expect(halves.second).toEqual([MID_AB, B, C]);
    });

    it('cuts a two-point spine', () => {
        const halves = splitSpineAtPoint([A, B], 0, MID_AB);
        expect(halves.first).toEqual([A, MID_AB]);
        expect(halves.second).toEqual([MID_AB, B]);
    });

    // A repeated vertex is a zero-length segment, and every symbol and label the
    // boundary draws is placed by a segment bearing.
    it('leaves no zero-length segment when the cut lands on a vertex', () => {
        const fromLeft = splitSpineAtPoint([A, B, C], 0, B);
        expect(fromLeft.first).toEqual([A, B]);
        expect(fromLeft.second).toEqual([B, C]);

        const fromRight = splitSpineAtPoint([A, B, C], 1, B);
        expect(fromRight.first).toEqual([A, B]);
        expect(fromRight.second).toEqual([B, C]);
    });

    it('refuses a cut on an end vertex', () => {
        expect(splitSpineAtPoint([A, B, C], 0, A)).toBeNull();
        expect(splitSpineAtPoint([A, B, C], 1, C)).toBeNull();
    });

    it('refuses an unusable segment index', () => {
        expect(splitSpineAtPoint([A, B, C], -1, MID_AB)).toBeNull();
        expect(splitSpineAtPoint([A, B, C], 2, MID_AB)).toBeNull();
        expect(splitSpineAtPoint([A, B, C], 0.5, MID_AB)).toBeNull();
        expect(splitSpineAtPoint([A, B, C], NaN, MID_AB)).toBeNull();
    });

    it('refuses an unusable spine or cut', () => {
        expect(splitSpineAtPoint(null, 0, MID_AB)).toBeNull();
        expect(splitSpineAtPoint([A], 0, MID_AB)).toBeNull();
        expect(splitSpineAtPoint([A, B], 0, [NaN, -15.7])).toBeNull();
        expect(splitSpineAtPoint([A, B], 0, [-47.85])).toBeNull();
        expect(splitSpineAtPoint([A, B], 0, null)).toBeNull();
    });

    it('copies, so writing on a half never reaches the original spine', () => {
        const spine = [[...A], [...B], [...C]];
        const halves = splitSpineAtPoint(spine, 0, MID_AB);
        halves.first[0][0] = 0;
        halves.second[1][1] = 0;
        expect(spine).toEqual([A, B, C]);
    });

    it('always hands back two usable lines meeting at the cut', () => {
        fc.assert(fc.property(
            fc.array(fc.tuple(
                fc.double({ min: -180, max: 180, noNaN: true }),
                fc.double({ min: -85, max: 85, noNaN: true }),
            ), { minLength: 2, maxLength: 8 }),
            fc.nat({ max: 7 }),
            fc.double({ min: 0.1, max: 0.9, noNaN: true }),
            (spine, rawIndex, fraction) => {
                const segmentIndex = rawIndex % (spine.length - 1);
                const start = spine[segmentIndex];
                const end = spine[segmentIndex + 1];
                const cut = [
                    start[0] + (end[0] - start[0]) * fraction,
                    start[1] + (end[1] - start[1]) * fraction,
                ];

                const halves = splitSpineAtPoint(spine, segmentIndex, cut);
                if (halves === null) return true;

                expect(halves.first.length).toBeGreaterThanOrEqual(2);
                expect(halves.second.length).toBeGreaterThanOrEqual(2);
                expect(halves.first[halves.first.length - 1]).toEqual(halves.second[0]);
                return true;
            },
        ));
    });
});

// ============================================================================
// splitSymbolInstances
// ============================================================================

describe('splitSymbolInstances', () => {
    const lengths = { totalLength: 100, firstLength: 40, secondLength: 60 };

    // THE WORST CASE. Copying the instances (what `{ ...originalProps }` does)
    // would leave a symbol at ratio 0.5 in BOTH halves: one symbol becomes two,
    // and neither sits where the user drew it.
    it('moves a symbol to the half that holds it, re-expressed on that half', () => {
        const { first, second } = splitSymbolInstances(
            [{ ratio: 0.5, showLabels: true }], lengths,
        );

        expect(second).toHaveLength(1);
        expect(second[0].ratio).toBeCloseTo(1 / 6, 10);
        expect(second[0].ratio).not.toBeCloseTo(0.5, 3);

        // The half left without a symbol gets the centred one the drawing would
        // have invented anyway, written down instead of implied.
        expect(first).toEqual([{ ratio: 0.5, showLabels: true }]);
    });

    it('splits instances that fall on either side', () => {
        const { first, second } = splitSymbolInstances([
            { ratio: 0.2, showLabels: true },
            { ratio: 0.8, showLabels: false },
        ], lengths);

        expect(first).toEqual([{ ratio: 0.5, showLabels: true }]);
        expect(second).toHaveLength(1);
        expect(second[0].ratio).toBeCloseTo(2 / 3, 10);
        expect(second[0].showLabels).toBe(false);
    });

    it('gives an empty half the label visibility of the nearest symbol', () => {
        const { first } = splitSymbolInstances([
            { ratio: 0.6, showLabels: false },
            { ratio: 0.9, showLabels: true },
        ], lengths);
        expect(first).toEqual([{ ratio: 0.5, showLabels: false }]);

        const { second } = splitSymbolInstances([
            { ratio: 0.1, showLabels: true },
            { ratio: 0.3, showLabels: false },
        ], lengths);
        expect(second).toEqual([{ ratio: 0.5, showLabels: false }]);
    });

    it('clamps a symbol sitting exactly on the cut', () => {
        const { first, second } = splitSymbolInstances([{ ratio: 0.4, showLabels: true }], lengths);
        expect(first[0].ratio).toBe(SPLIT_RATIO_MAX);
        expect(second).toEqual([{ ratio: 0.5, showLabels: true }]);
    });

    it('falls back to one centred symbol per half when nothing can be measured', () => {
        for (const bad of [
            undefined,
            { totalLength: 0, firstLength: 0, secondLength: 0 },
            { totalLength: NaN, firstLength: 40, secondLength: 60 },
            { totalLength: 100, firstLength: 40 },
        ]) {
            const { first, second } = splitSymbolInstances([{ ratio: 0.5, showLabels: false }], bad);
            expect(first).toEqual([{ ratio: 0.5, showLabels: false }]);
            expect(second).toEqual([{ ratio: 0.5, showLabels: false }]);
        }
    });

    it('survives garbage entries and a missing ratio', () => {
        const { first, second } = splitSymbolInstances(
            [null, 'x', {}, { ratio: 0.9 }], lengths,
        );
        // `{}` has no ratio and reads as centred (distance 50, second half).
        expect(first).toEqual([{ ratio: 0.5, showLabels: true }]);
        expect(second).toHaveLength(2);
        for (const inst of second) {
            expect(inst.showLabels).toBe(true);
        }
    });

    it('never places a symbol outside the drawable range, whatever it is given', () => {
        fc.assert(fc.property(
            fc.array(fc.record({
                ratio: fc.double({ min: -5, max: 5, noNaN: false }),
                showLabels: fc.boolean(),
            }), { maxLength: 6 }),
            fc.double({ min: 0.01, max: 1000, noNaN: true }),
            fc.double({ min: 0.05, max: 0.95, noNaN: true }),
            (instances, totalLength, cutFraction) => {
                const firstLength = totalLength * cutFraction;
                const { first, second } = splitSymbolInstances(instances, {
                    totalLength,
                    firstLength,
                    secondLength: totalLength - firstLength,
                });

                expect(first.length).toBeGreaterThanOrEqual(1);
                expect(second.length).toBeGreaterThanOrEqual(1);
                for (const inst of [...first, ...second]) {
                    expect(inst.ratio).toBeGreaterThanOrEqual(SPLIT_RATIO_MIN);
                    expect(inst.ratio).toBeLessThanOrEqual(SPLIT_RATIO_MAX);
                }
                return true;
            },
        ));
    });

    it('keeps every symbol, and invents one only for a half left empty', () => {
        fc.assert(fc.property(
            fc.array(fc.double({ min: 0.01, max: 0.99, noNaN: true }), { maxLength: 6 }),
            fc.double({ min: 0.05, max: 0.95, noNaN: true }),
            (ratios, cutFraction) => {
                const totalLength = 100;
                const firstLength = totalLength * cutFraction;
                const instances = ratios.map(ratio => ({ ratio, showLabels: true }));

                const expectedFirst = ratios.filter(r => r * totalLength <= firstLength).length;
                const expectedSecond = ratios.length - expectedFirst;

                const { first, second } = splitSymbolInstances(instances, {
                    totalLength,
                    firstLength,
                    secondLength: totalLength - firstLength,
                });

                expect(first).toHaveLength(Math.max(expectedFirst, 1));
                expect(second).toHaveLength(Math.max(expectedSecond, 1));
                return true;
            },
        ));
    });
});

// ============================================================================
// PARITY WITH THE GEOMETRY
//
// The model duplicates two numbers so the context menu can import it without
// reaching `military_tools`, which the map page pins at zero eager modules.
// These are the assertions that keep the copies honest.
// ============================================================================

describe('parity with AddBoundaryGeometry', () => {
    const { POSITION_RATIO_MIN, POSITION_RATIO_MAX, MIN_DISTANCE_METERS } =
        AddBoundaryGeometry.GEOMETRY_CONSTANTS;

    it('places symbols in the same range the geometry accepts', () => {
        expect(SPLIT_RATIO_MIN).toBe(POSITION_RATIO_MIN);
        expect(SPLIT_RATIO_MAX).toBe(POSITION_RATIO_MAX);
    });

    it('keeps cuts at the spacing the tool demands of any two vertices', () => {
        expect(MIN_SPLIT_DISTANCE_METERS).toBe(MIN_DISTANCE_METERS);
    });
});
