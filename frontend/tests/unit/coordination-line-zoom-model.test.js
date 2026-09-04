// Path: tests/unit/coordination-line-zoom-model.test.js

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// The model's only import is the integer zoom stops, from a module that imports
// nothing itself, so it still needs no mocking at all.
import {
    COORDINATION_LINE_ZOOM_LIMITS,
    COORDINATION_LINE_ZOOM_DEFAULTS,
    hasZoomReference,
    getPixelZoomFactor,
    getGroundZoomFactor,
    isScreenAnchored,
    clampSpacingForSize,
    resolveGlyphLayout,
    computeCoordinationLineZoomSizes,
    withCoordinationLineZoomSizes,
    buildCoordinationLineWidthExpression,
} from '@tools/helpers/coordination-line-zoom.model.js';

const { MAX_GAP_FRACTION, MAX_GLYPHS, MAX_LINE_WIDTH_PX, MAX_SYMBOL_SIZE_KM } = COORDINATION_LINE_ZOOM_LIMITS;

/** A feature pinned to the TERRAIN (the default). */
const terrainAnchored = { createdAtZoom: 12, zoomCorrectionEnabled: true, lineWidth: 4, symbol_size: 0.5, symbol_spacing: 1.5 };
/** The same feature pinned to the SCREEN. */
const screenAnchored = { ...terrainAnchored, zoomCorrectionEnabled: false };

// ============================================================================
// hasZoomReference — the zero sentinel
// ============================================================================

describe('hasZoomReference', () => {
    it('accepts a real anchor', () => {
        expect(hasZoomReference({ createdAtZoom: 12 })).toBe(true);
        expect(hasZoomReference({ createdAtZoom: 0.5 })).toBe(true);
    });

    it('rejects the "never anchored" sentinel, which is finite but means no anchor', () => {
        expect(hasZoomReference({ createdAtZoom: 0 })).toBe(false);
    });

    it('rejects a missing, NaN or negative anchor', () => {
        expect(hasZoomReference(undefined)).toBe(false);
        expect(hasZoomReference({})).toBe(false);
        expect(hasZoomReference({ createdAtZoom: NaN })).toBe(false);
        expect(hasZoomReference({ createdAtZoom: -3 })).toBe(false);
    });
});

// ============================================================================
// The two factors are reciprocal, and never both different from 1
// ============================================================================

describe('zoom factors', () => {
    it('terrain-anchored scales the PIXEL part and leaves the ground part alone', () => {
        expect(getPixelZoomFactor(terrainAnchored, 14)).toBeCloseTo(4, 10);
        expect(getGroundZoomFactor(terrainAnchored, 14)).toBe(1);
    });

    it('screen-anchored scales the GROUND part and leaves the pixel part alone', () => {
        expect(getPixelZoomFactor(screenAnchored, 14)).toBe(1);
        expect(getGroundZoomFactor(screenAnchored, 14)).toBeCloseTo(0.25, 10);
    });

    it('a legacy feature with no anchor gets 1 on both axes', () => {
        expect(getPixelZoomFactor({ lineWidth: 4 }, 18)).toBe(1);
        expect(getGroundZoomFactor({ lineWidth: 4 }, 18)).toBe(1);
    });

    it('a non-finite zoom gets 1 on both axes', () => {
        expect(getPixelZoomFactor(terrainAnchored, NaN)).toBe(1);
        expect(getGroundZoomFactor(screenAnchored, undefined)).toBe(1);
    });

    it('property: at most one factor ever leaves 1', () => {
        fc.assert(fc.property(
            fc.double({ min: 1, max: 21, noNaN: true }),
            fc.double({ min: 1, max: 21, noNaN: true }),
            fc.boolean(),
            (createdAtZoom, currentZoom, enabled) => {
                const props = { createdAtZoom, zoomCorrectionEnabled: enabled };
                const pixel = getPixelZoomFactor(props, currentZoom);
                const ground = getGroundZoomFactor(props, currentZoom);
                expect(pixel === 1 || ground === 1).toBe(true);
            },
        ));
    });

    it('isScreenAnchored is the gate for the ground factor', () => {
        expect(isScreenAnchored(screenAnchored)).toBe(true);
        expect(isScreenAnchored(terrainAnchored)).toBe(false);
        // No anchor means the switch is inert, so it is not "screen anchored".
        expect(isScreenAnchored({ zoomCorrectionEnabled: false })).toBe(false);
    });
});

// ============================================================================
// clampSpacingForSize — the invariant that keeps the line from disappearing
// ============================================================================

describe('clampSpacingForSize', () => {
    it('leaves a spacing that already clears the floor', () => {
        expect(clampSpacingForSize(0.5, 2)).toBe(2);
    });

    it('WORST CASE: a spacing at or below the size is raised, not accepted', () => {
        // Measured on 2026-09-03: with size >= spacing every gap merges into one
        // and a 96 km line kept 2 stray segments and no visible line at all.
        expect(clampSpacingForSize(1, 1)).toBe(2);
        expect(clampSpacingForSize(3, 1)).toBe(6);
    });

    it('falls back to the defaults for unusable input instead of returning NaN', () => {
        expect(Number.isFinite(clampSpacingForSize(NaN, NaN))).toBe(true);
        expect(Number.isFinite(clampSpacingForSize(-1, 0))).toBe(true);
    });

    it('property: the result always satisfies size <= MAX_GAP_FRACTION * spacing', () => {
        fc.assert(fc.property(
            fc.double({ min: 0.001, max: 50, noNaN: true }),
            fc.double({ min: 0.001, max: 500, noNaN: true }),
            (size, spacing) => {
                const clamped = clampSpacingForSize(size, spacing);
                expect(size).toBeLessThanOrEqual(MAX_GAP_FRACTION * clamped + 1e-9);
            },
        ));
    });
});

// ============================================================================
// resolveGlyphLayout — count, centring and the ceiling
// ============================================================================

describe('resolveGlyphLayout', () => {
    it('centres the pattern, leaving equal tails of plain line at both ends', () => {
        const layout = resolveGlyphLayout(10, 0.5, 2);
        expect(layout.count).toBe(5);
        expect(layout.spacing).toBe(2);
        expect(layout.start).toBeCloseTo(1, 10);
        expect(layout.capped).toBe(false);

        // First gap starts at 0.75, last gap ends at 9.25: line survives at both ends.
        const firstGapStart = layout.start - layout.size / 2;
        const lastGapEnd = layout.start + (layout.count - 1) * layout.spacing + layout.size / 2;
        expect(firstGapStart).toBeGreaterThan(0);
        expect(lastGapEnd).toBeLessThan(10);
        expect(firstGapStart).toBeCloseTo(10 - lastGapEnd, 10);
    });

    it('WORST CASE: a size wider than its spacing is spread out, never drawn as asked', () => {
        // The raw request would put 96 diamonds on a 96 km line and eat it whole.
        const layout = resolveGlyphLayout(96, 3, 1);
        expect(layout.spacing).toBeGreaterThanOrEqual(3 / MAX_GAP_FRACTION);
        // What survives is line, and there is more line than there is diamond.
        const visible = 96 - layout.count * layout.size;
        expect(visible).toBeGreaterThanOrEqual((96 - layout.size) * MAX_GAP_FRACTION - 1e-9);
    });

    it('WORST CASE: the diamond ceiling holds, and widens the spacing instead of stopping midway', () => {
        // A 100 km line pinned to the screen at z=22 asks for 51,277 diamonds.
        const layout = resolveGlyphLayout(100, 0.00049, 0.00195);
        expect(layout.count).toBe(MAX_GLYPHS);
        expect(layout.capped).toBe(true);

        // Still spans the line: the last diamond sits at the far end, not at 0.2%.
        const lastCentre = layout.start + (layout.count - 1) * layout.spacing;
        expect(lastCentre).toBeGreaterThan(99);
    });

    it('WORST CASE: degenerate input yields no diamonds rather than throwing', () => {
        const degenerate = [
            ['zero-length line', [0, 0.5, 2]],
            ['diamond longer than the line', [1, 5, 2]],
            ['zero spacing', [10, 0.5, 0]],
            ['NaN spacing', [10, 0.5, NaN]],
            ['NaN size', [10, NaN, 2]],
            ['negative size', [10, -1, 2]],
            ['negative length', [-10, 0.5, 2]],
            ['Infinity length', [Infinity, 0.5, 2]],
        ];

        for (const [name, args] of degenerate) {
            const layout = resolveGlyphLayout(...args);
            expect(layout.count, name).toBe(0);
            expect(layout.capped, name).toBe(false);
        }
    });

    it('property: the count never exceeds the ceiling and the gaps never eat the line', () => {
        fc.assert(fc.property(
            fc.double({ min: 0.01, max: 500, noNaN: true }),
            fc.double({ min: 0.001, max: 50, noNaN: true }),
            fc.double({ min: 0.001, max: 500, noNaN: true }),
            (length, size, spacing) => {
                const layout = resolveGlyphLayout(length, size, spacing);
                expect(layout.count).toBeLessThanOrEqual(MAX_GLYPHS);
                if (layout.count > 0) {
                    // The guarantee the invariant actually buys, stated on what
                    // SURVIVES rather than on what the diamonds eat. `count` is
                    // `floor((L - s) / p) + 1`, and that trailing `+ 1` can push the
                    // eaten share half a diamond past the naive `L * MAX_GAP_FRACTION`
                    // reading. What holds without exception is that at least half of
                    // the line-minus-one-diamond stays visible, which is positive
                    // whenever a diamond fits at all.
                    const visible = length - layout.count * layout.size;
                    expect(visible).toBeGreaterThanOrEqual((length - layout.size) * MAX_GAP_FRACTION - 1e-9);
                    expect(visible).toBeGreaterThan(0);
                    expect(layout.start).toBeGreaterThanOrEqual(layout.size / 2 - 1e-9);
                }
            },
        ));
    });
});

// ============================================================================
// computeCoordinationLineZoomSizes
// ============================================================================

describe('computeCoordinationLineZoomSizes', () => {
    it('terrain-anchored grows the stroke and keeps the diamonds on the ground', () => {
        const sizes = computeCoordinationLineZoomSizes(terrainAnchored, 14);
        expect(sizes.calculatedLineWidth).toBeCloseTo(16, 10);
        expect(sizes.calculatedSymbolSize).toBeCloseTo(0.5, 10);
        expect(sizes.calculatedSymbolSpacing).toBeCloseTo(1.5, 10);
    });

    it('screen-anchored shrinks the diamonds and keeps the stroke', () => {
        const sizes = computeCoordinationLineZoomSizes(screenAnchored, 14);
        expect(sizes.calculatedLineWidth).toBeCloseTo(4, 10);
        expect(sizes.calculatedSymbolSize).toBeCloseTo(0.125, 10);
        expect(sizes.calculatedSymbolSpacing).toBeCloseTo(0.375, 10);
    });

    it('clamps the stroke at the MapLibre ceiling instead of overflowing', () => {
        const sizes = computeCoordinationLineZoomSizes({ ...terrainAnchored, createdAtZoom: 1 }, 21);
        expect(sizes.calculatedLineWidth).toBe(MAX_LINE_WIDTH_PX);
    });

    it('clamps the diamond in kilometres instead of wandering off the planet', () => {
        const sizes = computeCoordinationLineZoomSizes({ ...screenAnchored, createdAtZoom: 20 }, 1);
        expect(sizes.calculatedSymbolSize).toBe(MAX_SYMBOL_SIZE_KM);
    });

    it('falls back to the defaults for missing or unusable authored values', () => {
        const sizes = computeCoordinationLineZoomSizes({}, 12);
        expect(sizes.calculatedLineWidth).toBe(COORDINATION_LINE_ZOOM_DEFAULTS.lineWidth);
        expect(sizes.calculatedSymbolSize).toBe(COORDINATION_LINE_ZOOM_DEFAULTS.symbolSizeKm);
        expect(sizes.calculatedSymbolSpacing).toBe(COORDINATION_LINE_ZOOM_DEFAULTS.symbolSpacingKm);
    });

    it('property: never returns NaN, for any input at all', () => {
        fc.assert(fc.property(
            fc.record({
                createdAtZoom: fc.oneof(fc.double(), fc.constant(undefined)),
                zoomCorrectionEnabled: fc.oneof(fc.boolean(), fc.constant(undefined)),
                lineWidth: fc.oneof(fc.double(), fc.constant(undefined)),
                symbol_size: fc.oneof(fc.double(), fc.constant(undefined)),
                symbol_spacing: fc.oneof(fc.double(), fc.constant(undefined)),
            }),
            fc.oneof(fc.double({ min: 0, max: 24 }), fc.constant(NaN)),
            (props, zoom) => {
                const sizes = computeCoordinationLineZoomSizes(props, zoom);
                expect(Number.isFinite(sizes.calculatedLineWidth)).toBe(true);
                expect(Number.isFinite(sizes.calculatedSymbolSize)).toBe(true);
                expect(Number.isFinite(sizes.calculatedSymbolSpacing)).toBe(true);
            },
        ));
    });
});

// ============================================================================
// withCoordinationLineZoomSizes and the paint expression
// ============================================================================

describe('withCoordinationLineZoomSizes', () => {
    it('returns a NEW object and keeps the authored properties', () => {
        const result = withCoordinationLineZoomSizes(terrainAnchored, 14);
        expect(result).not.toBe(terrainAnchored);
        expect(result.symbol_size).toBe(0.5);
        expect(result.calculatedLineWidth).toBeCloseTo(16, 10);
        expect(terrainAnchored.calculatedLineWidth).toBeUndefined();
    });
});

describe('buildCoordinationLineWidthExpression', () => {
    // The VALUE the expression paints, against this model and an evaluator that
    // reproduces MapLibre's own arithmetic, lives in
    // coordination-line-width-expression.test.js. Here it is only the shape: a
    // zoom curve, not the property lookup it used to be.
    it('is a zoom curve over the integer stops, not a lookup of the derived value', () => {
        const expression = buildCoordinationLineWidthExpression();

        expect(expression[0]).toBe('interpolate');
        expect(expression[1]).toEqual(['exponential', 2]);
        expect(expression[2]).toEqual(['zoom']);
        expect(JSON.stringify(expression)).not.toContain('calculatedLineWidth');
        expect(JSON.stringify(expression)).toContain(String(COORDINATION_LINE_ZOOM_DEFAULTS.lineWidth));
    });
});
