// Path: tests/unit/boundary-zoom-model.test.js

/**
 * @fileoverview The pure zoom model of the boundary tool
 * (`src/js/tool_manager/helpers/boundary-zoom.model.js`).
 *
 * It lives under `tool_manager/helpers/` and not next to the tool because two
 * CORE modules import it statically and `military_tools` is pinned at zero eager
 * modules; the file's own header carries that reasoning. Nothing here depends on
 * where it lives, except the import path.
 *
 * The last block is the one that could not live anywhere else: it imports BOTH
 * this model and the geometry, and compares the gap factor the model duplicates
 * (`SYMBOL_GAP_FACTOR`) with the product the geometry actually uses.
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// The parity check at the bottom imports the GEOMETRY, whose `@tools` barrel
// pulls in DOM/MapLibre-coupled modules. A trivial BaseGeometry keeps this file
// runnable in the `node` environment; nothing here calls a geometry method.
vi.mock('@tools', () => ({ BaseGeometry: class {} }));

import {
    BOUNDARY_ZOOM_LIMITS,
    BOUNDARY_ZOOM_DEFAULTS,
    hasZoomReference,
    getPixelZoomFactor,
    getGroundZoomFactor,
    isScreenAnchored,
    computeBoundaryZoomSizes,
    withBoundaryZoomSizes,
    computeTextRotation,
    computeTextAnchor,
    maxSymbolSizeForLine,
    buildBoundaryLineWidthExpression,
    buildBoundaryTextSizeExpression,
    buildBoundaryCircleStrokeExpression,
} from '../../src/js/tool_manager/helpers/boundary-zoom.model.js';
import AddBoundaryGeometry from '../../src/js/military_tools/boundary_tool/add_boundary_geometry.js';

const anchored = (extra = {}) => ({
    createdAtZoom: 12,
    zoomCorrectionEnabled: true,
    lineWidth: 4,
    text_size: 35,
    ...extra,
});

// ============================================================================
// hasZoomReference
// ============================================================================

describe('hasZoomReference', () => {
    it('is true only for a finite createdAtZoom above zero', () => {
        expect(hasZoomReference({ createdAtZoom: 12 })).toBe(true);
        expect(hasZoomReference({ createdAtZoom: 0.1 })).toBe(true);
    });

    it('rejects zero, which is the "never anchored" sentinel of DEFAULT_PROPERTIES', () => {
        // The map's own minimum zoom is 1, so a real anchor is never 0; accepting
        // it would turn every unstamped copy of the defaults into a 2**zoom factor.
        expect(hasZoomReference({ createdAtZoom: 0 })).toBe(false);
        expect(hasZoomReference({ createdAtZoom: -3 })).toBe(false);
    });

    it('is false for legacy features and for unusable anchors', () => {
        expect(hasZoomReference({})).toBe(false);
        expect(hasZoomReference(undefined)).toBe(false);
        expect(hasZoomReference(null)).toBe(false);
        expect(hasZoomReference({ createdAtZoom: null })).toBe(false);
        expect(hasZoomReference({ createdAtZoom: NaN })).toBe(false);
        expect(hasZoomReference({ createdAtZoom: Infinity })).toBe(false);
        expect(hasZoomReference({ createdAtZoom: '12' })).toBe(false);
    });
});

// ============================================================================
// getGroundZoomFactor / isScreenAnchored
// ============================================================================

describe('getGroundZoomFactor', () => {
    it('is 1 while the correction is ON (the echelon stays on the terrain)', () => {
        expect(getGroundZoomFactor(anchored(), 18)).toBe(1);
        expect(getGroundZoomFactor(anchored({ zoomCorrectionEnabled: undefined }), 18)).toBe(1);
    });

    it('is 2 ** (z0 - z) once the correction is switched OFF', () => {
        const off = anchored({ zoomCorrectionEnabled: false });
        expect(getGroundZoomFactor(off, 12)).toBe(1);
        expect(getGroundZoomFactor(off, 13)).toBe(0.5);
        expect(getGroundZoomFactor(off, 10)).toBe(4);
    });

    it('is 1 without a reference and for a non-finite zoom', () => {
        expect(getGroundZoomFactor({ zoomCorrectionEnabled: false }, 18)).toBe(1);
        expect(getGroundZoomFactor({ createdAtZoom: 0, zoomCorrectionEnabled: false }, 18)).toBe(1);
        expect(getGroundZoomFactor(anchored({ zoomCorrectionEnabled: false }), NaN)).toBe(1);
        expect(getGroundZoomFactor(anchored({ zoomCorrectionEnabled: false }), Infinity)).toBe(1);
    });

    it('collapses to 1 rather than to 0 when the factor underflows', () => {
        expect(getGroundZoomFactor({ createdAtZoom: 1, zoomCorrectionEnabled: false }, 5000)).toBe(1);
    });
});

describe('isScreenAnchored', () => {
    it('is true only with a reference zoom AND the correction switched off', () => {
        expect(isScreenAnchored(anchored({ zoomCorrectionEnabled: false }))).toBe(true);
        expect(isScreenAnchored(anchored())).toBe(false);
        expect(isScreenAnchored({ zoomCorrectionEnabled: false })).toBe(false);
        expect(isScreenAnchored({ createdAtZoom: 0, zoomCorrectionEnabled: false })).toBe(false);
        expect(isScreenAnchored(undefined)).toBe(false);
    });
});

// ============================================================================
// getPixelZoomFactor
// ============================================================================

describe('getPixelZoomFactor', () => {
    it('is 1 at the reference zoom (identity)', () => {
        expect(getPixelZoomFactor(anchored(), 12)).toBe(1);
    });

    it('doubles per zoom level in and halves per level out', () => {
        expect(getPixelZoomFactor(anchored(), 13)).toBe(2);
        expect(getPixelZoomFactor(anchored(), 14)).toBe(4);
        expect(getPixelZoomFactor(anchored(), 11)).toBe(0.5);
    });

    it('is 1 for a legacy feature with no anchor (today behaviour)', () => {
        expect(getPixelZoomFactor({ lineWidth: 4 }, 18)).toBe(1);
        expect(getPixelZoomFactor({ createdAtZoom: null }, 18)).toBe(1);
        expect(getPixelZoomFactor({ createdAtZoom: NaN }, 18)).toBe(1);
    });

    it('is 1 when the correction is switched off', () => {
        expect(getPixelZoomFactor(anchored({ zoomCorrectionEnabled: false }), 18)).toBe(1);
    });

    it('treats only the literal false as off', () => {
        expect(getPixelZoomFactor(anchored({ zoomCorrectionEnabled: undefined }), 13)).toBe(2);
        expect(getPixelZoomFactor(anchored({ zoomCorrectionEnabled: 0 }), 13)).toBe(2);
    });

    it('is 1 when the current zoom is not a finite number', () => {
        expect(getPixelZoomFactor(anchored(), NaN)).toBe(1);
        expect(getPixelZoomFactor(anchored(), Infinity)).toBe(1);
        expect(getPixelZoomFactor(anchored(), undefined)).toBe(1);
    });
});

// ============================================================================
// computeBoundaryZoomSizes
// ============================================================================

describe('computeBoundaryZoomSizes', () => {
    it('returns the authored values at the reference zoom', () => {
        expect(computeBoundaryZoomSizes(anchored({ symbol_size: 3 }), 12)).toEqual({
            calculatedLineWidth: 4,
            calculatedTextSize: 35,
            calculatedStrokeWidth: 2,
            calculatedSymbolSize: 3,
        });
    });

    it('scales line, text and stroke together, leaving the echelon on the ground', () => {
        expect(computeBoundaryZoomSizes(anchored({ text_size: 10, symbol_size: 3 }), 13)).toEqual({
            calculatedLineWidth: 8,
            calculatedTextSize: 20,
            calculatedStrokeWidth: 4,
            calculatedSymbolSize: 3,
        });
    });

    it('renders a legacy feature exactly as before (factor 1 on both axes)', () => {
        const legacy = { lineWidth: 7, text_size: 21, symbol_size: 3 };
        expect(computeBoundaryZoomSizes(legacy, 19)).toEqual({
            calculatedLineWidth: 7,
            calculatedTextSize: 21,
            calculatedStrokeWidth: 2,
            calculatedSymbolSize: 3,
        });
    });

    it('freezes the whole feature on screen when the correction is off', () => {
        // Pixels stay authored AND the echelon (km) shrinks by the reciprocal
        // factor, which is what makes the switch mean one thing for the feature.
        const off = anchored({ zoomCorrectionEnabled: false, text_size: 20, symbol_size: 2 });
        expect(computeBoundaryZoomSizes(off, 14)).toEqual({
            calculatedLineWidth: 4,
            calculatedTextSize: 20,
            calculatedStrokeWidth: 2,
            calculatedSymbolSize: 0.5,
        });
        expect(computeBoundaryZoomSizes(off, 10).calculatedSymbolSize).toBe(8);
    });

    it('clamps each derived value at its own maximum', () => {
        const sizes = computeBoundaryZoomSizes(anchored({ createdAtZoom: 1 }), 21);
        expect(sizes.calculatedLineWidth).toBe(BOUNDARY_ZOOM_LIMITS.MAX_LINE_WIDTH_PX);
        expect(sizes.calculatedTextSize).toBe(BOUNDARY_ZOOM_LIMITS.MAX_TEXT_SIZE_PX);
        expect(sizes.calculatedStrokeWidth).toBe(BOUNDARY_ZOOM_LIMITS.MAX_CIRCLE_STROKE_PX);
    });

    it('bounds the derived echelon size at both ends', () => {
        const off = (extra) => anchored({ zoomCorrectionEnabled: false, ...extra });
        // 2 ** (18 - 1) km would put the symbol across a continent.
        expect(computeBoundaryZoomSizes(off({ createdAtZoom: 18, symbol_size: 1 }), 1).calculatedSymbolSize)
            .toBe(BOUNDARY_ZOOM_LIMITS.MAX_SYMBOL_SIZE_KM);
        // ...and 2 ** (1 - 21) km would be a symbol nobody can see or grab.
        expect(computeBoundaryZoomSizes(off({ createdAtZoom: 1, symbol_size: 1 }), 21).calculatedSymbolSize)
            .toBe(BOUNDARY_ZOOM_LIMITS.MIN_SYMBOL_SIZE_KM);
    });

    it('never clamps an authored echelon size the user dragged past the ceiling', () => {
        // The bounds guard the DERIVED growth. A size handle can drag a symbol to
        // 80 km on a long boundary, and it must keep drawing at 80 km.
        const huge = anchored({ symbol_size: 80 });
        expect(computeBoundaryZoomSizes(huge, 15).calculatedSymbolSize).toBe(80);
        expect(computeBoundaryZoomSizes({ symbol_size: 80 }, 15).calculatedSymbolSize).toBe(80);
    });

    it('falls back to the defaults for missing, NaN or non-positive bases', () => {
        expect(computeBoundaryZoomSizes({}, 12)).toEqual({
            calculatedLineWidth: BOUNDARY_ZOOM_DEFAULTS.lineWidth,
            calculatedTextSize: BOUNDARY_ZOOM_DEFAULTS.textSize,
            calculatedStrokeWidth: BOUNDARY_ZOOM_DEFAULTS.circleStrokeWidth,
            calculatedSymbolSize: BOUNDARY_ZOOM_DEFAULTS.symbolSizeKm,
        });
        expect(computeBoundaryZoomSizes({ lineWidth: NaN, text_size: 0, symbol_size: NaN }, 12)).toEqual({
            calculatedLineWidth: BOUNDARY_ZOOM_DEFAULTS.lineWidth,
            calculatedTextSize: BOUNDARY_ZOOM_DEFAULTS.textSize,
            calculatedStrokeWidth: BOUNDARY_ZOOM_DEFAULTS.circleStrokeWidth,
            calculatedSymbolSize: BOUNDARY_ZOOM_DEFAULTS.symbolSizeKm,
        });
        expect(computeBoundaryZoomSizes({ lineWidth: -3 }, 12).calculatedLineWidth)
            .toBe(BOUNDARY_ZOOM_DEFAULTS.lineWidth);
        // A NaN base must not survive the multiplication into the geometry.
        const offNaN = anchored({ zoomCorrectionEnabled: false, symbol_size: NaN });
        expect(computeBoundaryZoomSizes(offNaN, 10).calculatedSymbolSize)
            .toBe(BOUNDARY_ZOOM_DEFAULTS.symbolSizeKm * 4);
    });

    it('survives undefined properties and a non-finite zoom', () => {
        expect(computeBoundaryZoomSizes(undefined, Infinity)).toEqual({
            calculatedLineWidth: BOUNDARY_ZOOM_DEFAULTS.lineWidth,
            calculatedTextSize: BOUNDARY_ZOOM_DEFAULTS.textSize,
            calculatedStrokeWidth: BOUNDARY_ZOOM_DEFAULTS.circleStrokeWidth,
            calculatedSymbolSize: BOUNDARY_ZOOM_DEFAULTS.symbolSizeKm,
        });
        expect(computeBoundaryZoomSizes(anchored({ symbol_size: 2 }), NaN)).toEqual({
            calculatedLineWidth: 4,
            calculatedTextSize: 35,
            calculatedStrokeWidth: 2,
            calculatedSymbolSize: 2,
        });
    });

    it('reads the circle own strokeWidth base when the feature carries one', () => {
        const circle = { createdAtZoom: 10, zoomCorrectionEnabled: true, strokeWidth: 3 };
        expect(computeBoundaryZoomSizes(circle, 11).calculatedStrokeWidth).toBe(6);
    });

    it('collapses to the base rather than to zero when the factor underflows', () => {
        // 2 ** -2000 underflows to exactly 0; a zero-width line would be invisible.
        const sizes = computeBoundaryZoomSizes(anchored({ createdAtZoom: 2000 }), 0);
        expect(sizes.calculatedLineWidth).toBe(4);
        expect(sizes.calculatedTextSize).toBe(35);
    });
});

// ============================================================================
// withBoundaryZoomSizes
// ============================================================================

describe('withBoundaryZoomSizes', () => {
    it('does not mutate the input properties', () => {
        const props = anchored();
        const out = withBoundaryZoomSizes(props, 14);
        expect(props.calculatedLineWidth).toBeUndefined();
        expect(out.calculatedLineWidth).toBe(16);
        expect(out).not.toBe(props);
    });

    it('preserves every unrelated property', () => {
        const out = withBoundaryZoomSizes(anchored({ echelon: 'XX', nome: 'Limite 1' }), 12);
        expect(out.echelon).toBe('XX');
        expect(out.nome).toBe('Limite 1');
    });

    it('tolerates undefined properties', () => {
        expect(withBoundaryZoomSizes(undefined, 12).calculatedLineWidth)
            .toBe(BOUNDARY_ZOOM_DEFAULTS.lineWidth);
    });
});

// ============================================================================
// computeTextRotation
// ============================================================================

describe('computeTextRotation', () => {
    it('pins the glyphs to north whatever the line bearing is', () => {
        expect(computeTextRotation({ northFacing: true, lineBearing: 137 })).toBe(0);
        expect(computeTextRotation({ northFacing: true, lineBearing: -12 })).toBe(0);
        expect(computeTextRotation({ northFacing: true, lineBearing: NaN })).toBe(0);
    });

    it('keeps the legacy perpendicular with keep-upright on the other half', () => {
        expect(computeTextRotation({ northFacing: false, lineBearing: 90 })).toBe(0);
        expect(computeTextRotation({ northFacing: false, lineBearing: 270 })).toBe(360);
    });

    it('handles the two branch boundaries', () => {
        expect(computeTextRotation({ northFacing: false, lineBearing: 0 })).toBe(90);
        expect(computeTextRotation({ northFacing: false, lineBearing: 180 })).toBe(270);
    });

    it('falls back to bearing 0 for a non-finite bearing', () => {
        expect(computeTextRotation({ northFacing: false, lineBearing: NaN })).toBe(90);
        expect(computeTextRotation({ northFacing: false, lineBearing: undefined })).toBe(90);
        expect(computeTextRotation({ northFacing: false, lineBearing: Infinity })).toBe(90);
        expect(computeTextRotation({})).toBe(90);
        expect(computeTextRotation()).toBe(90);
    });

    it('only treats the literal true as north-facing', () => {
        // Bearing 45 and NOT 90: the legacy branch gives 90 - 90 = 0 for a bearing
        // of 90, the same as north-facing, so that case cannot tell the two apart.
        expect(computeTextRotation({ northFacing: 'sim', lineBearing: 45 })).toBe(-45);
        expect(computeTextRotation({ northFacing: 1, lineBearing: 45 })).toBe(-45);
        expect(computeTextRotation({ northFacing: true, lineBearing: 45 })).toBe(0);
    });
});

// ============================================================================
// computeTextAnchor
// ============================================================================

describe('computeTextAnchor', () => {
    it('centres the label whenever the glyphs are glued to the line', () => {
        expect(computeTextAnchor({ northFacing: false, placementBearing: 0 })).toBe('center');
        expect(computeTextAnchor({ northFacing: 'sim', placementBearing: 0 })).toBe('center');
        expect(computeTextAnchor({ placementBearing: 90 })).toBe('center');
        expect(computeTextAnchor({})).toBe('center');
        expect(computeTextAnchor()).toBe('center');
    });

    it('hangs a north-facing label from the edge that faces the line, per octant', () => {
        const cases = [
            [0, 'bottom'], [45, 'bottom-left'], [90, 'left'], [135, 'top-left'],
            [180, 'top'], [225, 'top-right'], [270, 'right'], [315, 'bottom-right'],
        ];
        for (const [bearing, anchor] of cases) {
            expect(computeTextAnchor({ northFacing: true, placementBearing: bearing }), `bearing ${bearing}`)
                .toBe(anchor);
        }
    });

    it('rounds to the nearest octant and wraps any bearing range', () => {
        expect(computeTextAnchor({ northFacing: true, placementBearing: 22 })).toBe('bottom');
        expect(computeTextAnchor({ northFacing: true, placementBearing: 23 })).toBe('bottom-left');
        expect(computeTextAnchor({ northFacing: true, placementBearing: 359 })).toBe('bottom');
        expect(computeTextAnchor({ northFacing: true, placementBearing: 360 })).toBe('bottom');
        expect(computeTextAnchor({ northFacing: true, placementBearing: -90 })).toBe('right');
        expect(computeTextAnchor({ northFacing: true, placementBearing: 450 })).toBe('left');
        expect(computeTextAnchor({ northFacing: true, placementBearing: -0 })).toBe('bottom');
    });

    it('the two labels of one line always land on opposite edges', () => {
        const opposite = {
            bottom: 'top', 'bottom-left': 'top-right', left: 'right', 'top-left': 'bottom-right',
            top: 'bottom', 'top-right': 'bottom-left', right: 'left', 'bottom-right': 'top-left',
        };
        for (let bearing = -720; bearing <= 720; bearing += 7) {
            const top = computeTextAnchor({ northFacing: true, placementBearing: bearing });
            const bottom = computeTextAnchor({ northFacing: true, placementBearing: bearing + 180 });
            expect(bottom, `bearing ${bearing}`).toBe(opposite[top]);
        }
    });

    it('falls back to centre for a non-finite bearing instead of emitting undefined', () => {
        expect(computeTextAnchor({ northFacing: true, placementBearing: NaN })).toBe('center');
        expect(computeTextAnchor({ northFacing: true, placementBearing: Infinity })).toBe('center');
        expect(computeTextAnchor({ northFacing: true })).toBe('center');
    });
});

// ============================================================================
// Expression builders
// ============================================================================

describe('boundary zoom expression builders', () => {
    // The VALUE each expression paints, against this model and against MapLibre's own
    // arithmetic, lives in boundary-zoom-expressions.test.js. Here it is only the SHAPE:
    // three zoom curves, and no longer a lookup of the property a per-frame JavaScript
    // pass used to write.
    const BUILDERS = [
        ['line width', buildBoundaryLineWidthExpression, 'calculatedLineWidth', 'lineWidth', BOUNDARY_ZOOM_LIMITS.MAX_LINE_WIDTH_PX],
        ['text size', buildBoundaryTextSizeExpression, 'calculatedTextSize', 'text_size', BOUNDARY_ZOOM_LIMITS.MAX_TEXT_SIZE_PX],
        ['circle stroke', buildBoundaryCircleStrokeExpression, 'calculatedStrokeWidth', 'strokeWidth', BOUNDARY_ZOOM_LIMITS.MAX_CIRCLE_STROKE_PX],
    ];

    const DEFAULT_BY_BUILDER = new Map([
        [buildBoundaryLineWidthExpression, BOUNDARY_ZOOM_DEFAULTS.lineWidth],
        [buildBoundaryTextSizeExpression, BOUNDARY_ZOOM_DEFAULTS.textSize],
        [buildBoundaryCircleStrokeExpression, BOUNDARY_ZOOM_DEFAULTS.circleStrokeWidth],
    ]);

    it.each(BUILDERS)('%s is a zoom curve, not a lookup of the derived value', (_label, build, derived, authored, max) => {
        const expression = build();

        expect(expression[0]).toBe('interpolate');
        expect(expression[1]).toEqual(['exponential', 2]);
        expect(expression[2]).toEqual(['zoom']);
        expect(JSON.stringify(expression)).not.toContain(derived);
        expect(JSON.stringify(expression)).toContain(`"${authored}"`);
        expect(JSON.stringify(expression)).toContain(String(max));
    });

    it.each(BUILDERS)('%s falls back to the model default, read off the expression itself', (_label, build, _derived, _authored, max) => {
        // Each stop value is `['min', max, ['case', ..., base, ..., base, scaled]]`, and the
        // base is `['case', isPositiveFinite, authored, default]`. Reading the default out of
        // that tree beats a substring search, which would trip over the zoom stop numbers.
        const stopValue = build()[4];
        expect(stopValue[0]).toBe('min');
        expect(stopValue[1]).toBe(max);

        const base = stopValue[2][2];
        expect(base[0]).toBe('case');
        expect(base[base.length - 1]).toBe(DEFAULT_BY_BUILDER.get(build));
    });

    it('reads 35 for the missing text size, not the legacy 14', () => {
        // The 14 only ever showed between a label being drawn and the first zoom pass writing
        // `calculatedTextSize`, which is `positiveOr(text_size, 35)`. The two numbers were a
        // disagreement, not a feature.
        const base = buildBoundaryTextSizeExpression()[4][2][2];
        expect(base[base.length - 1]).toBe(BOUNDARY_ZOOM_DEFAULTS.textSize);
        expect(base[base.length - 1]).not.toBe(14);
    });

    it('returns a fresh array each call (layers must not share a mutable literal)', () => {
        const a = buildBoundaryLineWidthExpression();
        const b = buildBoundaryLineWidthExpression();
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
    });
});

// ============================================================================
// Invariants (fast-check)
// ============================================================================

describe('boundary zoom model invariants', () => {
    const zoom = () => fc.double({ min: 0, max: 22, noNaN: true });

    it('is monotonic in the current zoom (never shrinks as you zoom in)', () => {
        fc.assert(fc.property(zoom(), zoom(), zoom(), (z0, za, zb) => {
            const props = { createdAtZoom: z0, zoomCorrectionEnabled: true, lineWidth: 4 };
            const lo = Math.min(za, zb);
            const hi = Math.max(za, zb);
            return computeBoundaryZoomSizes(props, lo).calculatedLineWidth
                <= computeBoundaryZoomSizes(props, hi).calculatedLineWidth;
        }));
    });

    it('always produces finite values inside the declared range', () => {
        fc.assert(fc.property(
            zoom(),
            zoom(),
            fc.double({ min: 0.01, max: 1000, noNaN: true }),
            (z0, z, base) => {
                const sizes = computeBoundaryZoomSizes(
                    { createdAtZoom: z0, zoomCorrectionEnabled: true, lineWidth: base, text_size: base },
                    z,
                );
                return Number.isFinite(sizes.calculatedLineWidth)
                    && sizes.calculatedLineWidth > 0
                    && sizes.calculatedLineWidth <= BOUNDARY_ZOOM_LIMITS.MAX_LINE_WIDTH_PX
                    && Number.isFinite(sizes.calculatedTextSize)
                    && sizes.calculatedTextSize > 0
                    && sizes.calculatedTextSize <= BOUNDARY_ZOOM_LIMITS.MAX_TEXT_SIZE_PX;
            },
        ));
    });

    it('is the identity whenever the current zoom is the reference zoom', () => {
        fc.assert(fc.property(zoom(), fc.double({ min: 1, max: 50, noNaN: true }), (z0, base) => {
            const sizes = computeBoundaryZoomSizes(
                { createdAtZoom: z0, zoomCorrectionEnabled: true, lineWidth: base, text_size: base },
                z0,
            );
            return sizes.calculatedLineWidth === base && sizes.calculatedTextSize === base;
        }));
    });

    it('has reciprocal factors: pixels ON times kilometres OFF is always 1', () => {
        // This is the whole design in one line. The same (z0, z) pair either grows
        // the pixels (ON) or shrinks the ground (OFF), by exactly inverse amounts,
        // so the feature is glued to the terrain or to the screen, never to half
        // of each. Compared with a tolerance because 2**a * 2**-a is a pow round
        // trip, not an exact one, for a non-integer exponent.
        fc.assert(fc.property(
            fc.double({ min: 1, max: 22, noNaN: true }),
            fc.double({ min: 0, max: 22, noNaN: true }),
            (z0, z) => {
                const px = getPixelZoomFactor({ createdAtZoom: z0, zoomCorrectionEnabled: true }, z);
                const km = getGroundZoomFactor({ createdAtZoom: z0, zoomCorrectionEnabled: false }, z);
                return Math.abs(px * km - 1) <= 1e-9;
            },
        ));
    });

    it('scales the echelon only while the correction is off, and never both axes at once', () => {
        fc.assert(fc.property(
            fc.double({ min: 1, max: 22, noNaN: true }),
            fc.double({ min: 0, max: 22, noNaN: true }),
            fc.double({ min: 0.05, max: 20, noNaN: true }),
            (z0, z, base) => {
                const on = computeBoundaryZoomSizes(
                    { createdAtZoom: z0, zoomCorrectionEnabled: true, symbol_size: base }, z,
                );
                const off = computeBoundaryZoomSizes(
                    { createdAtZoom: z0, zoomCorrectionEnabled: false, lineWidth: 4, symbol_size: base }, z,
                );
                return on.calculatedSymbolSize === base
                    && off.calculatedLineWidth === 4
                    && Number.isFinite(off.calculatedSymbolSize)
                    && off.calculatedSymbolSize >= BOUNDARY_ZOOM_LIMITS.MIN_SYMBOL_SIZE_KM
                    && off.calculatedSymbolSize <= BOUNDARY_ZOOM_LIMITS.MAX_SYMBOL_SIZE_KM;
            },
        ));
    });

    it('keeps the text rotation inside the range the legacy branch could produce', () => {
        fc.assert(fc.property(fc.double({ min: -360, max: 720, noNaN: true }), (bearing) => {
            const rotation = computeTextRotation({ northFacing: false, lineBearing: bearing });
            return Number.isFinite(rotation) && rotation >= bearing - 90 && rotation <= bearing + 90;
        }));
    });
});

// ============================================================================
// maxSymbolSizeForLine — the echelon may not eat its own line
// ============================================================================

describe('maxSymbolSizeForLine', () => {
    it('divides half the line among the gaps the instances cut', () => {
        // 12 km, three instances of a single 'X': 3 * 1 * 1.8 = 5.4 km of gap per
        // km of symbol, and the gaps together may take 6 km.
        expect(maxSymbolSizeForLine(12, 3, 1)).toBeCloseTo(1.1111111111, 9);
        // 2 km with one 'XXX': 5.4 km of gap per km of symbol, 1 km available.
        expect(maxSymbolSizeForLine(2, 1, 3)).toBeCloseTo(0.1851851852, 9);
    });

    it('scales linearly with the line and inversely with the symbol count', () => {
        expect(maxSymbolSizeForLine(24, 3, 1)).toBeCloseTo(2 * maxSymbolSizeForLine(12, 3, 1), 12);
        expect(maxSymbolSizeForLine(12, 6, 1)).toBeCloseTo(maxSymbolSizeForLine(12, 3, 1) / 2, 12);
        expect(maxSymbolSizeForLine(12, 3, 2)).toBeCloseTo(maxSymbolSizeForLine(12, 3, 1) / 2, 12);
    });

    it('caps nothing when an input is missing or unusable', () => {
        // Infinity, never 0 or NaN: "unknown" must not silently shrink a symbol
        // to nothing, and NaN would poison every comparison downstream.
        expect(maxSymbolSizeForLine(0, 3, 1)).toBe(Infinity);
        expect(maxSymbolSizeForLine(NaN, 3, 1)).toBe(Infinity);
        expect(maxSymbolSizeForLine(undefined, 3, 1)).toBe(Infinity);
        expect(maxSymbolSizeForLine(-5, 3, 1)).toBe(Infinity);
        expect(maxSymbolSizeForLine(12, 0, 1)).toBe(Infinity);
        expect(maxSymbolSizeForLine(12, NaN, 1)).toBe(Infinity);
        expect(maxSymbolSizeForLine(12, 3, 0)).toBe(Infinity);
        expect(maxSymbolSizeForLine(12, 3, NaN)).toBe(Infinity);
    });

    it('is exactly the size whose gaps fill MAX_GAP_FRACTION of the line', () => {
        fc.assert(fc.property(
            fc.double({ min: 0.001, max: 5000, noNaN: true }),
            fc.integer({ min: 1, max: 12 }),
            fc.integer({ min: 1, max: 5 }),
            (lengthKm, instances, symbols) => {
                const size = maxSymbolSizeForLine(lengthKm, instances, symbols);
                const gapTotal = instances * symbols * BOUNDARY_ZOOM_LIMITS.SYMBOL_GAP_FACTOR * size;
                expect(gapTotal).toBeCloseTo(lengthKm * BOUNDARY_ZOOM_LIMITS.MAX_GAP_FRACTION, 6);
            },
        ));
    });
});

// ============================================================================
// The duplicated gap factor
// ============================================================================

describe('SYMBOL_GAP_FACTOR mirrors the geometry constants', () => {
    it('equals SYMBOL_WIDTH_MULTIPLIER * GAP_WIDTH_MULTIPLIER', () => {
        // This model has zero imports by contract, so the factor is a COPY of the
        // product the geometry uses to size a gap. The two are compared here, in
        // the only file that imports both, so that changing one and not the other
        // fails instead of quietly capping at the wrong size.
        const { SYMBOL_WIDTH_MULTIPLIER, GAP_WIDTH_MULTIPLIER } = AddBoundaryGeometry.GEOMETRY_CONSTANTS;
        expect(SYMBOL_WIDTH_MULTIPLIER).toBe(1.5);
        expect(GAP_WIDTH_MULTIPLIER).toBe(1.2);
        // `1.5 * 1.2` is 1.7999999999999998 in binary floating point, so the
        // comparison is by closeness and not by identity.
        expect(SYMBOL_WIDTH_MULTIPLIER * GAP_WIDTH_MULTIPLIER)
            .toBeCloseTo(BOUNDARY_ZOOM_LIMITS.SYMBOL_GAP_FACTOR, 12);
    });
});
