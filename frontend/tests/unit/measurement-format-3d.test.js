// Path: tests/unit/measurement-format-3d.test.js

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    formatArea3D,
    formatDistance3D,
    formatMeasurementResult3D,
} from '../../src/js/3d_models_viewer_tool/measurement-format-3d.js';

// measurement-format-3d has zero imports, so it runs as-is in the `node`
// environment. What these tests pin down is the hectare removal of 2026-09-02:
// the 3D area formatter must have exactly TWO branches (m² and km²), and the
// display of an already-saved measurement must be derived from the numeric
// value, not from the `formatted` string persisted next to it. That string also
// travels to a collaborator over sync (entity `measurement3d`), so the
// derivation is what lets a new build show m²/km² for an op written by an old
// one.

// ============================================================================
// formatArea3D - the removed hectare branch
// ============================================================================

describe('formatArea3D', () => {
    it('formats sub-km² areas in square metres with 2 decimals', () => {
        expect(formatArea3D(0)).toBe('0.00 m²');
        expect(formatArea3D(9999.5)).toBe('9999.50 m²');
    });

    it('keeps 10000 m² in square metres (the boundary that used to be ha)', () => {
        // The old formatter returned '1.00 ha' here, and '100.00 ha' for the
        // value below. This is the assertion that fails if hectares come back.
        expect(formatArea3D(10000)).toBe('10000.00 m²');
        expect(formatArea3D(999999)).toBe('999999.00 m²');
        expect(formatArea3D(999999.99)).toBe('999999.99 m²');
    });

    it('switches to km² at exactly 1e6 m²', () => {
        expect(formatArea3D(1000000)).toBe('1.00 km²');
        expect(formatArea3D(1500000)).toBe('1.50 km²');
    });

    it('uses the metre branch for negatives (plain >= comparison, no guard)', () => {
        expect(formatArea3D(-5)).toBe('-5.00 m²');
    });

    it('passes non-finite input straight through, as the old formatter did', () => {
        expect(formatArea3D(NaN)).toBe('NaN m²');
        expect(formatArea3D(Infinity)).toBe('Infinity km²');
        expect(formatArea3D(-Infinity)).toBe('-Infinity m²');
    });

    it('never emits hectares for any finite input', () => {
        // The unbounded double generator almost never lands inside the old
        // hectare window [1e4, 1e6), so on its own this property stays GREEN
        // with the hectare branch put back (measured). The generator bounded to
        // exactly that window is what makes it discriminate.
        const anyFinite = fc.double({ noNaN: true, noDefaultInfinity: true });
        const oldHectareWindow = fc.double({ min: 1e4, max: 1e6, noNaN: true });

        fc.assert(fc.property(
            fc.oneof(anyFinite, oldHectareWindow),
            (v) => {
                const out = formatArea3D(v);
                expect(out.endsWith(' ha')).toBe(false);
                expect(out.endsWith(' m²') || out.endsWith(' km²')).toBe(true);
            }
        ));
    });
});

// ============================================================================
// formatDistance3D - moved verbatim, boundary at 1000 m
// ============================================================================

describe('formatDistance3D', () => {
    it('formats sub-kilometre distances in metres with 2 decimals', () => {
        expect(formatDistance3D(0)).toBe('0.00 m');
        expect(formatDistance3D(999)).toBe('999.00 m');
        expect(formatDistance3D(999.99)).toBe('999.99 m');
    });

    it('switches to km at exactly 1000 m', () => {
        expect(formatDistance3D(1000)).toBe('1.00 km');
        expect(formatDistance3D(1234.5)).toBe('1.23 km');
    });

    it('passes non-finite input straight through, and negatives read in metres', () => {
        expect(formatDistance3D(NaN)).toBe('NaN m');
        expect(formatDistance3D(Infinity)).toBe('Infinity km');
        expect(formatDistance3D(-7)).toBe('-7.00 m');
    });

    it('always ends in a metre or kilometre unit for finite input', () => {
        fc.assert(fc.property(
            fc.double({ noNaN: true, noDefaultInfinity: true }),
            (v) => {
                const out = formatDistance3D(v);
                expect(out.endsWith(' m') || out.endsWith(' km')).toBe(true);
            }
        ));
    });
});

// ============================================================================
// formatMeasurementResult3D - the value wins over the persisted string
// ============================================================================

describe('formatMeasurementResult3D', () => {
    it('re-derives a legacy hectare record from its numeric value', () => {
        const measurement = { type: 'area', result: { value: 15000, formatted: '1.50 ha' } };
        expect(formatMeasurementResult3D(measurement)).toBe('15000.00 m²');
    });

    it('falls back to the persisted string when there is no value', () => {
        const measurement = { type: 'area', result: { formatted: '12.50 ha' } };
        expect(formatMeasurementResult3D(measurement)).toBe('12.50 ha');
    });

    it('falls back to the persisted string when the value is not finite', () => {
        const measurement = { type: 'area', result: { value: NaN, formatted: '3.00 ha' } };
        expect(formatMeasurementResult3D(measurement)).toBe('3.00 ha');
    });

    it('formats a distance measurement with the distance formatter', () => {
        const measurement = { type: 'distance', result: { value: 1500, formatted: '' } };
        expect(formatMeasurementResult3D(measurement)).toBe('1.50 km');
    });

    it('treats an unknown type as a distance, never as an area', () => {
        const measurement = { type: undefined, result: { value: 1500 } };
        expect(formatMeasurementResult3D(measurement)).toBe('1.50 km');
    });

    it('formats a zero-valued result instead of falling back', () => {
        // The store default is { value: 0, formatted: '' }; 0 is finite, so it
        // must be formatted rather than treated as "no result".
        expect(formatMeasurementResult3D({ type: 'area', result: { value: 0, formatted: '' } }))
            .toBe('0.00 m²');
    });

    it('EDGE: returns null when there is neither a value nor a stored string', () => {
        expect(formatMeasurementResult3D({ type: 'area', result: {} })).toBeNull();
        expect(formatMeasurementResult3D({ type: 'area', result: { formatted: '' } })).toBeNull();
        expect(formatMeasurementResult3D({ type: 'area' })).toBeNull();
        expect(formatMeasurementResult3D(undefined)).toBeNull();
        expect(formatMeasurementResult3D(null)).toBeNull();
    });
});
