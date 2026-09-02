import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
    EXTENDABLE_SOURCES,
    EXTENSION_ENDS,
    extendCoordinates,
    previewCoordinates,
    resolveEndpoints,
    anchorFor,
    canExtendFeature,
    buildExtendedProperties,
} from '../../src/js/tool_manager/helpers/line-extension.model.js';

// ============================================================================
// FIXTURES
//
// Named points, so the ORDER assertions below read as the drawing does: A and B
// are the line the user already has, C and D are the two clicks they add now (C
// first, D second).
// ============================================================================

const A = [-47.9, -15.8];
const B = [-47.8, -15.7];
const C = [-47.7, -15.6];
const D = [-47.6, -15.5];
const CURSOR = [-47.5, -15.4];

/**
 * @param {Object} [props] - Property overrides
 * @param {Array} [coords] - Spine
 * @returns {Object} A minimal linear feature
 */
function feature(props = {}, coords = [A, B]) {
    return {
        type: 'Feature',
        properties: { source: 'line', id: 'f-1', baseCoordinates: coords, ...props },
        geometry: { type: 'LineString', coordinates: coords },
    };
}

/** @returns {import('fast-check').Arbitrary<Array<number>>} A finite lng/lat pair */
const pointArb = () => fc.tuple(
    fc.double({ min: -180, max: 180, noNaN: true }),
    fc.double({ min: -85, max: 85, noNaN: true })
);

// ============================================================================
// extendCoordinates
// ============================================================================

describe('extendCoordinates', () => {
    it('appends in click order when continuing from the end', () => {
        expect(extendCoordinates([A, B], [C, D], 'end')).toEqual([A, B, C, D]);
    });

    it('PREPENDS THE ADDED POINTS REVERSED when continuing from the start', () => {
        // The user clicked C first (nearest the old first vertex) and D second
        // (furthest away). Reading the finished line from index 0 therefore has
        // to start at D. Getting this backwards is the whole point of the module.
        expect(extendCoordinates([A, B], [C, D], 'start')).toEqual([D, C, A, B]);
    });

    it('round-trips: dropping the N prepended points restores the original spine', () => {
        const extended = extendCoordinates([A, B], [C, D], 'start');
        expect(extended.slice(2)).toEqual([A, B]);
    });

    it('round-trips: dropping the N appended points restores the original spine', () => {
        const extended = extendCoordinates([A, B], [C, D], 'end');
        expect(extended.slice(0, -2)).toEqual([A, B]);
    });

    it('works on a two-vertex feature, the shortest a line can be', () => {
        expect(extendCoordinates([A, B], [C], 'end')).toEqual([A, B, C]);
        expect(extendCoordinates([A, B], [C], 'start')).toEqual([C, A, B]);
    });

    it('with nothing added returns an EQUAL COPY, never the input array', () => {
        const existing = [A, B];
        const result = extendCoordinates(existing, [], 'end');

        expect(result).toEqual(existing);
        expect(result).not.toBe(existing);
    });

    it('never aliases the inputs, so mutating the result cannot corrupt the feature', () => {
        const existing = [[...A], [...B]];
        const added = [[...C]];
        const result = extendCoordinates(existing, added, 'end');

        result[0][0] = 999;
        result.push([0, 0]);

        expect(existing[0][0]).toBe(A[0]);
        expect(existing).toHaveLength(2);
        expect(added).toHaveLength(1);
    });

    it('does not mutate the added array it was handed (the reverse is on a copy)', () => {
        const added = [C, D];
        extendCoordinates([A, B], added, 'start');
        expect(added).toEqual([C, D]);
    });

    it('throws on an end that is neither start nor end', () => {
        expect(() => extendCoordinates([A, B], [C], 'END')).toThrow(/Invalid extension end/);
        expect(() => extendCoordinates([A, B], [C], 'middle')).toThrow(/Invalid extension end/);
        expect(() => extendCoordinates([A, B], [C], undefined)).toThrow(/Invalid extension end/);
    });

    // CONTRACT ON GARBAGE: a non-array list reads as empty, but coordinate
    // VALUES pass through untouched. Validity belongs to each tool's geometry
    // (three different minimum spacings), and dropping a bad point here would
    // hand the caller a spine shorter than the one it asked for.
    it('reads null/undefined lists as empty instead of throwing', () => {
        expect(extendCoordinates(null, [C], 'end')).toEqual([C]);
        expect(extendCoordinates([A, B], undefined, 'end')).toEqual([A, B]);
        expect(extendCoordinates(undefined, null, 'start')).toEqual([]);
    });

    it('passes NaN and Infinity coordinates through, it does not silently drop them', () => {
        const bad = [NaN, Infinity];
        expect(extendCoordinates([A, B], [bad], 'end')).toEqual([A, B, bad]);
        expect(extendCoordinates([A, B], [bad], 'start')).toEqual([bad, A, B]);
    });
});

// ============================================================================
// previewCoordinates
// ============================================================================

describe('previewCoordinates', () => {
    it('puts the cursor LAST when continuing from the end', () => {
        expect(previewCoordinates([A, B], [C], CURSOR, 'end')).toEqual([A, B, C, CURSOR]);
    });

    it('puts the cursor FIRST when continuing from the start', () => {
        // The cursor is the newest "added" point, so under the reversal it lands
        // at index 0. This is what makes the rubber band grow outwards.
        expect(previewCoordinates([A, B], [C], CURSOR, 'start')).toEqual([CURSOR, C, A, B]);
    });

    it('degrades to the committed spine when the pointer has not moved yet', () => {
        expect(previewCoordinates([A, B], [C], null, 'end')).toEqual([A, B, C]);
        expect(previewCoordinates([A, B], [], undefined, 'start')).toEqual([A, B]);
    });

    it('throws on an invalid end, like extendCoordinates', () => {
        expect(() => previewCoordinates([A, B], [], CURSOR, 'tail')).toThrow(/Invalid extension end/);
    });
});

// ============================================================================
// resolveEndpoints / anchorFor
// ============================================================================

describe('resolveEndpoints', () => {
    it('reads the two ends off baseCoordinates', () => {
        const result = resolveEndpoints(feature({}, [A, B, C]));
        expect(result.spine).toEqual([A, B, C]);
        expect(result.start).toEqual(A);
        expect(result.end).toEqual(C);
    });

    it('parses baseCoordinates persisted as a JSON STRING (legacy arrows)', () => {
        const legacy = {
            properties: { source: 'arrow', baseCoordinates: JSON.stringify([A, B, C]) },
        };
        const result = resolveEndpoints(legacy);
        expect(result.start).toEqual(A);
        expect(result.end).toEqual(C);
    });

    it('falls back to a LineString geometry when baseCoordinates is unusable', () => {
        const noBase = {
            properties: { source: 'line', baseCoordinates: 'not json' },
            geometry: { type: 'LineString', coordinates: [A, B] },
        };
        expect(resolveEndpoints(noBase).end).toEqual(B);
    });

    it('returns null for a spine of fewer than two points', () => {
        expect(resolveEndpoints(feature({}, [A]))).toBeNull();
        expect(resolveEndpoints(feature({}, []))).toBeNull();
        expect(resolveEndpoints(undefined)).toBeNull();
    });

    it('returns copies, so a caller cannot write back into the feature', () => {
        const source = feature({}, [[...A], [...B]]);
        const result = resolveEndpoints(source);
        result.start[0] = 999;
        result.spine[1][1] = 999;

        expect(source.properties.baseCoordinates[0][0]).toBe(A[0]);
        expect(source.properties.baseCoordinates[1][1]).toBe(B[1]);
    });
});

describe('anchorFor', () => {
    it('is the first vertex for start and the last for end', () => {
        expect(anchorFor([A, B, C], 'start')).toEqual(A);
        expect(anchorFor([A, B, C], 'end')).toEqual(C);
    });

    it('returns a copy, not the stored point', () => {
        const spine = [[...A], [...B]];
        const anchor = anchorFor(spine, 'start');
        anchor[0] = 999;
        expect(spine[0][0]).toBe(A[0]);
    });

    it('is null when there is nothing to anchor to', () => {
        expect(anchorFor([], 'end')).toBeNull();
        expect(anchorFor(null, 'end')).toBeNull();
    });

    it('throws on an invalid end', () => {
        expect(() => anchorFor([A, B], 'left')).toThrow(/Invalid extension end/);
    });
});

// ============================================================================
// canExtendFeature
// ============================================================================

describe('canExtendFeature', () => {
    it('accepts each of the three linear types', () => {
        for (const source of EXTENDABLE_SOURCES) {
            expect(canExtendFeature(feature({ source }))).toEqual({ ok: true });
        }
    });

    it('refuses a type that is not linear, naming the three that are', () => {
        const verdict = canExtendFeature(feature({ source: 'polygon' }));
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toBe('Só linha, seta e linha de limite podem ser continuadas');
    });

    it('refuses a feature with no properties at all', () => {
        expect(canExtendFeature(undefined).ok).toBe(false);
        expect(canExtendFeature({}).ok).toBe(false);
    });

    it('refuses a locked feature', () => {
        const verdict = canExtendFeature(feature({ bloqueado: true }));
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toBe('Feição está bloqueada');
    });

    it('refuses a MERGED arrow, whose drawing comes from branches and not from the spine', () => {
        const merged = feature({
            source: 'arrow',
            isMerged: true,
            branches: [{ baseCoordinates: [A, B] }, { baseCoordinates: [B, C] }],
        });
        const verdict = canExtendFeature(merged);
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toBe('Separe as setas antes de continuar');
    });

    it('refuses a merged arrow even when it carries a single branch', () => {
        // Stricter than canConvertLinear on purpose: rewriting baseCoordinates
        // would change nothing on screen, and a refusal beats a dead gesture.
        const merged = feature({ source: 'arrow', isMerged: true, branches: [{ baseCoordinates: [A, B] }] });
        expect(canExtendFeature(merged).ok).toBe(false);
    });

    it('accepts an arrow that only carries the isMerged key as false', () => {
        expect(canExtendFeature(feature({ source: 'arrow', isMerged: false })).ok).toBe(true);
    });

    it('refuses a feature whose spine is too short or unusable', () => {
        const verdict = canExtendFeature(feature({}, [A]));
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toBe('Feição sem coordenadas suficientes');

        const nanSpine = { properties: { source: 'line', baseCoordinates: [[NaN, 0], B] }, geometry: null };
        expect(canExtendFeature(nanSpine).ok).toBe(false);
    });

    it('exposes exactly the three types and the two ends', () => {
        expect([...EXTENDABLE_SOURCES]).toEqual(['line', 'arrow', 'boundary']);
        expect([...EXTENSION_ENDS]).toEqual(['start', 'end']);
    });
});

// ============================================================================
// buildExtendedProperties
//
// The invariant the boundary depends on: continuing changes the SPINE and
// nothing else. `createdAtZoom` / `zoomCorrectionEnabled` are its zoom anchor,
// `symbol_instances` holds ratios along the line, and the `calculated*` keys are
// a cache owned by the zoom pass.
// ============================================================================

describe('buildExtendedProperties', () => {
    const boundaryProps = {
        source: 'boundary',
        id: 'b-1',
        nome: 'Limite 1',
        color: '#123456',
        echelon: 'XXX',
        symbol_instances: [{ ratio: 0.25, showLabels: true }, { ratio: 0.8, showLabels: false }],
        symbol_size: 1.5,
        createdAtZoom: 12.4,
        zoomCorrectionEnabled: true,
        calculatedLineWidth: 9,
        calculatedTextSize: 71,
        calculatedStrokeWidth: 4,
        calculatedSymbolSize: 1.5,
        baseCoordinates: [A, B],
    };

    it('changes baseCoordinates and NOTHING else', () => {
        const coords = [A, B, C];
        const result = buildExtendedProperties({ properties: boundaryProps }, coords);

        expect(Object.keys(result).sort()).toEqual(Object.keys(boundaryProps).sort());
        expect(result.baseCoordinates).toBe(coords);

        for (const key of Object.keys(boundaryProps)) {
            if (key === 'baseCoordinates') continue;
            // Identity, not equality: a re-derived or re-cloned value would fail
            // here, which is exactly the drift this guards against.
            expect(result[key]).toBe(boundaryProps[key]);
        }
    });

    it('keeps the zoom anchor, so the boundary does not resize when it grows', () => {
        const result = buildExtendedProperties({ properties: boundaryProps }, [A, B, C]);
        expect(result.createdAtZoom).toBe(12.4);
        expect(result.zoomCorrectionEnabled).toBe(true);
    });

    it('keeps the symbol ratios, so the echelon slides along the longer line', () => {
        const result = buildExtendedProperties({ properties: boundaryProps }, [A, B, C]);
        expect(result.symbol_instances).toEqual([
            { ratio: 0.25, showLabels: true },
            { ratio: 0.8, showLabels: false },
        ]);
    });

    it('does not touch the calculated* cache the zoom pass owns', () => {
        const result = buildExtendedProperties({ properties: boundaryProps }, [A, B, C]);
        expect(result.calculatedLineWidth).toBe(9);
        expect(result.calculatedTextSize).toBe(71);
        expect(result.calculatedStrokeWidth).toBe(4);
        expect(result.calculatedSymbolSize).toBe(1.5);
    });

    it('never mutates the feature it was handed', () => {
        const source = { properties: { ...boundaryProps } };
        buildExtendedProperties(source, [A, B, C]);
        expect(source.properties.baseCoordinates).toEqual([A, B]);
    });

    it('tolerates a feature with no properties', () => {
        expect(buildExtendedProperties(undefined, [A, B])).toEqual({ baseCoordinates: [A, B] });
    });
});

// ============================================================================
// INVARIANTS (fast-check)
// ============================================================================

describe('extendCoordinates invariants', () => {
    it('keeps every point: length is existing + added, both ways', () => {
        fc.assert(fc.property(
            fc.array(pointArb(), { minLength: 2, maxLength: 12 }),
            fc.array(pointArb(), { minLength: 0, maxLength: 12 }),
            fc.constantFrom(...EXTENSION_ENDS),
            (existing, added, end) => {
                expect(extendCoordinates(existing, added, end)).toHaveLength(
                    existing.length + added.length
                );
            }
        ));
    });

    it('leaves the existing spine CONTIGUOUS and in order, whichever end grew', () => {
        fc.assert(fc.property(
            fc.array(pointArb(), { minLength: 2, maxLength: 12 }),
            fc.array(pointArb(), { minLength: 1, maxLength: 12 }),
            fc.constantFrom(...EXTENSION_ENDS),
            (existing, added, end) => {
                const result = extendCoordinates(existing, added, end);
                const offset = end === 'end' ? 0 : added.length;
                expect(result.slice(offset, offset + existing.length)).toEqual(existing);
            }
        ));
    });

    it('ties the two directions together: start is end, read backwards', () => {
        // extendCoordinates(e, a, 'start') reversed === extendCoordinates(reverse(e), a, 'end').
        // Continuing the front of a line is continuing the back of the same line
        // drawn the other way round, and nothing else.
        fc.assert(fc.property(
            fc.array(pointArb(), { minLength: 2, maxLength: 12 }),
            fc.array(pointArb(), { minLength: 0, maxLength: 12 }),
            (existing, added) => {
                const fromStart = extendCoordinates(existing, added, 'start');
                const fromEnd = extendCoordinates([...existing].reverse(), added, 'end');
                expect([...fromStart].reverse()).toEqual(fromEnd);
            }
        ));
    });

    it('is stable: the same inputs always give the same spine', () => {
        fc.assert(fc.property(
            fc.array(pointArb(), { minLength: 2, maxLength: 8 }),
            fc.array(pointArb(), { minLength: 0, maxLength: 8 }),
            fc.constantFrom(...EXTENSION_ENDS),
            (existing, added, end) => {
                expect(extendCoordinates(existing, added, end))
                    .toEqual(extendCoordinates(existing, added, end));
            }
        ));
    });

    it('the anchor is the point the continuation grows away from', () => {
        fc.assert(fc.property(
            fc.array(pointArb(), { minLength: 2, maxLength: 12 }),
            fc.array(pointArb(), { minLength: 1, maxLength: 12 }),
            fc.constantFrom(...EXTENSION_ENDS),
            (existing, added, end) => {
                const anchor = anchorFor(existing, end);
                const result = extendCoordinates(existing, added, end);
                const anchorIndex = end === 'end' ? existing.length - 1 : added.length;
                expect(result[anchorIndex]).toEqual(anchor);
            }
        ));
    });
});
