import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    calculateZoomCorrectedValue,
    applyZoomCorrections,
    syncZoomCorrectedProperty,
} from '../../src/js/tool_manager/helpers/zoom-correction.helpers.js';

// The module is pure: no turf global, no `@tools` barrel, no DOM. Import directly.

// ============================================================================
// calculateZoomCorrectedValue — core scaling
// ============================================================================

describe('calculateZoomCorrectedValue', () => {
    const cfg = { sourceProperty: 'size' };

    it('returns the raw size when zoom equals createdAtZoom (scale = 1)', () => {
        const props = { size: 24, createdAtZoom: 12 };
        expect(calculateZoomCorrectedValue(props, 12, cfg)).toBe(24);
    });

    it('doubles the size for each +1 zoom level (2^Δ)', () => {
        const props = { size: 10, createdAtZoom: 10 };
        expect(calculateZoomCorrectedValue(props, 11, cfg)).toBe(20);
        expect(calculateZoomCorrectedValue(props, 12, cfg)).toBe(40);
        expect(calculateZoomCorrectedValue(props, 13, cfg)).toBe(80);
    });

    it('halves the size for each -1 zoom level', () => {
        const props = { size: 16, createdAtZoom: 12 };
        expect(calculateZoomCorrectedValue(props, 11, cfg)).toBe(8);
        expect(calculateZoomCorrectedValue(props, 10, cfg)).toBe(4);
    });

    it('handles fractional zoom differences', () => {
        const props = { size: 10, createdAtZoom: 10 };
        // 2^0.5 = sqrt(2)
        expect(calculateZoomCorrectedValue(props, 10.5, cfg)).toBeCloseTo(10 * Math.SQRT2, 9);
    });

    it('clamps the result to maxValue', () => {
        const props = { size: 10, createdAtZoom: 10 };
        // At +4 zoom the raw value would be 160, but maxValue caps it.
        expect(calculateZoomCorrectedValue(props, 14, { sourceProperty: 'size', maxValue: 100 })).toBe(100);
    });

    it('does NOT clamp when the scaled value is below maxValue', () => {
        const props = { size: 10, createdAtZoom: 10 };
        expect(calculateZoomCorrectedValue(props, 11, { sourceProperty: 'size', maxValue: 100 })).toBe(20);
    });

    it('defaults maxValue to Infinity when omitted (no upper clamp)', () => {
        const props = { size: 10, createdAtZoom: 0 };
        // 2^20 * 10 is huge but finite; should pass through unchanged.
        expect(calculateZoomCorrectedValue(props, 20, cfg)).toBe(10 * 2 ** 20);
    });

    it('treats maxValue: null / undefined as Infinity (?? fallback)', () => {
        const props = { size: 10, createdAtZoom: 10 };
        expect(calculateZoomCorrectedValue(props, 14, { sourceProperty: 'size', maxValue: null })).toBe(160);
        expect(calculateZoomCorrectedValue(props, 14, { sourceProperty: 'size', maxValue: undefined })).toBe(160);
    });

    it('uses a configurable sourceProperty (e.g. lineWidth)', () => {
        const props = { lineWidth: 4, createdAtZoom: 10 };
        expect(calculateZoomCorrectedValue(props, 11, { sourceProperty: 'lineWidth' })).toBe(8);
    });

    it('returns the raw source value unchanged when zoomCorrectionEnabled === false', () => {
        const props = { size: 24, createdAtZoom: 5, zoomCorrectionEnabled: false };
        // Even though current zoom is far from createdAtZoom, no scaling is applied.
        expect(calculateZoomCorrectedValue(props, 18, cfg)).toBe(24);
    });

    it('still applies correction when zoomCorrectionEnabled is truthy/absent (only === false disables)', () => {
        const props = { size: 10, createdAtZoom: 10, zoomCorrectionEnabled: true };
        expect(calculateZoomCorrectedValue(props, 11, cfg)).toBe(20);
        const propsUndef = { size: 10, createdAtZoom: 10 };
        expect(calculateZoomCorrectedValue(propsUndef, 11, cfg)).toBe(20);
    });

    it('clamp uses Math.min, so a maxValue smaller than the raw size at scale 1 still caps it', () => {
        const props = { size: 50, createdAtZoom: 10 };
        expect(calculateZoomCorrectedValue(props, 10, { sourceProperty: 'size', maxValue: 30 })).toBe(30);
    });
});

// ============================================================================
// calculateZoomCorrectedValue — non-finite inputs (DOCUMENTED current behavior)
// ============================================================================

describe('calculateZoomCorrectedValue — non-finite input handling (documented)', () => {
    const cfg = { sourceProperty: 'size' };

    // DOCUMENTED: `config.maxValue ?? Infinity` only guards null/undefined, NOT NaN.
    // A NaN source `size` propagates through `NaN * scaleFactor` and `Math.min(NaN, ...)`,
    // so the function returns NaN. This pins the CURRENT behavior — no guard added
    // (see TESTING-BACKLOG.md: fix must be a deliberate, flagged change).
    it('propagates NaN when the source size is NaN (no Number.isFinite guard)', () => {
        const props = { size: NaN, createdAtZoom: 10 };
        expect(Number.isNaN(calculateZoomCorrectedValue(props, 11, cfg))).toBe(true);
    });

    // DOCUMENTED: NaN createdAtZoom → zoomDifference NaN → scaleFactor NaN → NaN.
    it('propagates NaN when createdAtZoom is NaN', () => {
        const props = { size: 10, createdAtZoom: NaN };
        expect(Number.isNaN(calculateZoomCorrectedValue(props, 11, cfg))).toBe(true);
    });

    // DOCUMENTED: NaN currentZoom → NaN result.
    it('propagates NaN when currentZoom is NaN', () => {
        const props = { size: 10, createdAtZoom: 10 };
        expect(Number.isNaN(calculateZoomCorrectedValue(props, NaN, cfg))).toBe(true);
    });

    // DOCUMENTED: undefined source property → undefined * number = NaN.
    it('returns NaN when the source property is missing (undefined * scaleFactor)', () => {
        const props = { createdAtZoom: 10 };
        expect(Number.isNaN(calculateZoomCorrectedValue(props, 11, cfg))).toBe(true);
    });

    // DOCUMENTED: a NaN maxValue is NOT replaced by Infinity (?? keeps NaN), and
    // Math.min(finite, NaN) === NaN — so a NaN clamp poisons an otherwise valid result.
    it('returns NaN when maxValue is NaN, even with a valid scaled value', () => {
        const props = { size: 10, createdAtZoom: 10 };
        const result = calculateZoomCorrectedValue(props, 11, { sourceProperty: 'size', maxValue: NaN });
        expect(Number.isNaN(result)).toBe(true);
    });

    // DOCUMENTED: +Infinity zoom difference with positive size → Infinity (Math.min keeps it
    // below Infinity default, but here maxValue is default Infinity so it stays Infinity).
    it('returns Infinity when currentZoom is +Infinity (unbounded scale)', () => {
        const props = { size: 10, createdAtZoom: 10 };
        expect(calculateZoomCorrectedValue(props, Infinity, cfg)).toBe(Infinity);
    });

    // DOCUMENTED: a huge negative zoom difference collapses the value toward 0.
    it('returns 0 when currentZoom is -Infinity', () => {
        const props = { size: 10, createdAtZoom: 10 };
        expect(calculateZoomCorrectedValue(props, -Infinity, cfg)).toBe(0);
    });

    it('disabled correction returns the raw (even NaN) source value verbatim', () => {
        const props = { size: NaN, createdAtZoom: 10, zoomCorrectionEnabled: false };
        expect(Number.isNaN(calculateZoomCorrectedValue(props, 11, cfg))).toBe(true);
    });
});

// ============================================================================
// calculateZoomCorrectedValue — fast-check invariants
// ============================================================================

describe('calculateZoomCorrectedValue — properties', () => {
    const cfg = { sourceProperty: 'size' };

    it('identity: result === size when currentZoom === createdAtZoom', () => {
        fc.assert(fc.property(
            fc.double({ min: 0, max: 1000, noNaN: true }),
            fc.double({ min: 0, max: 24, noNaN: true }),
            (size, zoom) => {
                const props = { size, createdAtZoom: zoom };
                expect(calculateZoomCorrectedValue(props, zoom, cfg)).toBe(size);
            }
        ));
    });

    it('monotonic non-decreasing in currentZoom (higher zoom never shrinks the value)', () => {
        fc.assert(fc.property(
            fc.double({ min: 0.001, max: 1000, noNaN: true }),
            fc.double({ min: 0, max: 24, noNaN: true }),
            fc.double({ min: 0, max: 12, noNaN: true }),
            fc.double({ min: 0, max: 12, noNaN: true }),
            (size, createdAtZoom, zA, zB) => {
                const lo = Math.min(zA, zB);
                const hi = Math.max(zA, zB);
                const props = { size, createdAtZoom };
                const vLo = calculateZoomCorrectedValue(props, lo, cfg);
                const vHi = calculateZoomCorrectedValue(props, hi, cfg);
                expect(vHi).toBeGreaterThanOrEqual(vLo);
            }
        ));
    });

    it('result never exceeds maxValue (clamp invariant)', () => {
        fc.assert(fc.property(
            fc.double({ min: 0, max: 100, noNaN: true }),
            fc.double({ min: -20, max: 20, noNaN: true }),
            fc.double({ min: 0, max: 24, noNaN: true }),
            fc.double({ min: 0.1, max: 500, noNaN: true }),
            (size, createdAtZoom, currentZoom, maxValue) => {
                const result = calculateZoomCorrectedValue(
                    { size, createdAtZoom },
                    currentZoom,
                    { sourceProperty: 'size', maxValue }
                );
                expect(result).toBeLessThanOrEqual(maxValue);
            }
        ));
    });

    it('result is non-negative for non-negative sizes', () => {
        fc.assert(fc.property(
            fc.double({ min: 0, max: 1000, noNaN: true }),
            fc.double({ min: 0, max: 24, noNaN: true }),
            fc.double({ min: 0, max: 24, noNaN: true }),
            (size, createdAtZoom, currentZoom) => {
                const result = calculateZoomCorrectedValue({ size, createdAtZoom }, currentZoom, cfg);
                expect(result).toBeGreaterThanOrEqual(0);
            }
        ));
    });
});

// ============================================================================
// applyZoomCorrections — bulk transform
// ============================================================================

describe('applyZoomCorrections', () => {
    const cfg = { sourceProperty: 'size', calculatedProperty: 'calculatedSize' };

    it('returns [] for null / undefined / non-array inputs', () => {
        expect(applyZoomCorrections(null, 10, cfg)).toEqual([]);
        expect(applyZoomCorrections(undefined, 10, cfg)).toEqual([]);
        expect(applyZoomCorrections('nope', 10, cfg)).toEqual([]);
        expect(applyZoomCorrections({ length: 1 }, 10, cfg)).toEqual([]);
    });

    it('returns [] for an empty array', () => {
        expect(applyZoomCorrections([], 10, cfg)).toEqual([]);
    });

    it('sets the calculatedProperty on each feature', () => {
        const features = [
            { properties: { size: 10, createdAtZoom: 10 } },
            { properties: { size: 20, createdAtZoom: 10 } },
        ];
        const out = applyZoomCorrections(features, 11, cfg);
        expect(out[0].properties.calculatedSize).toBe(20);
        expect(out[1].properties.calculatedSize).toBe(40);
    });

    it('does not mutate the input features (returns a new array/objects)', () => {
        const features = [{ properties: { size: 10, createdAtZoom: 10 } }];
        const out = applyZoomCorrections(features, 11, cfg);
        expect(out).not.toBe(features);
        expect(out[0]).not.toBe(features[0]);
        expect(out[0].properties).not.toBe(features[0].properties);
        expect(features[0].properties.calculatedSize).toBeUndefined();
    });

    it('preserves other feature fields (geometry, id) and existing properties', () => {
        const features = [{
            id: 'feat-1',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { size: 10, createdAtZoom: 10, nome: 'Alvo' },
        }];
        const out = applyZoomCorrections(features, 10, cfg);
        expect(out[0].id).toBe('feat-1');
        expect(out[0].geometry).toEqual({ type: 'Point', coordinates: [0, 0] });
        expect(out[0].properties.nome).toBe('Alvo');
        expect(out[0].properties.calculatedSize).toBe(10);
    });

    it('honors maxValue per feature', () => {
        const features = [{ properties: { size: 10, createdAtZoom: 10 } }];
        const out = applyZoomCorrections(features, 14, { ...cfg, maxValue: 100 });
        expect(out[0].properties.calculatedSize).toBe(100);
    });

    it('respects zoomCorrectionEnabled === false per feature', () => {
        const features = [{ properties: { size: 33, createdAtZoom: 5, zoomCorrectionEnabled: false } }];
        const out = applyZoomCorrections(features, 18, cfg);
        expect(out[0].properties.calculatedSize).toBe(33);
    });
});

// ============================================================================
// syncZoomCorrectedProperty — paired mutation
// ============================================================================

describe('syncZoomCorrectedProperty', () => {
    const cfg = { sourceProperty: 'size', calculatedProperty: 'calculatedSize' };

    function makePair(props) {
        return {
            sourceFeature: { properties: { ...props } },
            selectedFeature: { properties: { ...props } },
        };
    }

    it('writes the corrected value to both features', () => {
        const { sourceFeature, selectedFeature } = makePair({ size: 10, createdAtZoom: 10 });
        syncZoomCorrectedProperty(sourceFeature, selectedFeature, 'size', 10, 11, cfg);
        expect(sourceFeature.properties.calculatedSize).toBe(20);
        expect(selectedFeature.properties.calculatedSize).toBe(20);
    });

    it('rounds createdAtZoom to one decimal on both features when that property changes', () => {
        const { sourceFeature, selectedFeature } = makePair({ size: 10, createdAtZoom: 0 });
        syncZoomCorrectedProperty(sourceFeature, selectedFeature, 'createdAtZoom', 12.34, 12.3, cfg);
        expect(sourceFeature.properties.createdAtZoom).toBe(12.3);
        expect(selectedFeature.properties.createdAtZoom).toBe(12.3);
    });

    it('uses the rounded createdAtZoom for the subsequent correction', () => {
        const { sourceFeature, selectedFeature } = makePair({ size: 10, createdAtZoom: 0 });
        // value 11.0 → rounds to 11.0; currentZoom 12 → Δ = 1 → ×2
        syncZoomCorrectedProperty(sourceFeature, selectedFeature, 'createdAtZoom', 11.04, 12, cfg);
        expect(sourceFeature.properties.createdAtZoom).toBe(11);
        expect(sourceFeature.properties.calculatedSize).toBe(20);
        expect(selectedFeature.properties.calculatedSize).toBe(20);
    });

    it('does NOT touch createdAtZoom when a different property changes', () => {
        const { sourceFeature, selectedFeature } = makePair({ size: 10, createdAtZoom: 10 });
        syncZoomCorrectedProperty(sourceFeature, selectedFeature, 'size', 10, 10, cfg);
        expect(sourceFeature.properties.createdAtZoom).toBe(10);
        expect(sourceFeature.properties.calculatedSize).toBe(10);
    });

    it('honors maxValue clamp', () => {
        const { sourceFeature, selectedFeature } = makePair({ size: 10, createdAtZoom: 10 });
        syncZoomCorrectedProperty(sourceFeature, selectedFeature, 'size', 10, 14, { ...cfg, maxValue: 100 });
        expect(sourceFeature.properties.calculatedSize).toBe(100);
        expect(selectedFeature.properties.calculatedSize).toBe(100);
    });

    it('respects zoomCorrectionEnabled === false (raw value mirrored to both)', () => {
        const { sourceFeature, selectedFeature } = makePair({ size: 42, createdAtZoom: 5, zoomCorrectionEnabled: false });
        syncZoomCorrectedProperty(sourceFeature, selectedFeature, 'size', 42, 18, cfg);
        expect(sourceFeature.properties.calculatedSize).toBe(42);
        expect(selectedFeature.properties.calculatedSize).toBe(42);
    });

    // DOCUMENTED: NaN source size propagates to the calculatedProperty on both features.
    it('propagates NaN to both features when the source size is NaN (documented)', () => {
        const { sourceFeature, selectedFeature } = makePair({ size: NaN, createdAtZoom: 10 });
        syncZoomCorrectedProperty(sourceFeature, selectedFeature, 'size', NaN, 11, cfg);
        expect(Number.isNaN(sourceFeature.properties.calculatedSize)).toBe(true);
        expect(Number.isNaN(selectedFeature.properties.calculatedSize)).toBe(true);
    });
});
