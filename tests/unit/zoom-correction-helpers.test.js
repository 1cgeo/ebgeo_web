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
// calculateZoomCorrectedValue — non-finite inputs (GUARDED since 2026-09-02)
// ============================================================================

// This whole block used to pin the OPPOSITE, under the heading "documented current
// behavior": every case below returned NaN or Infinity, flagged in TESTING-BACKLOG.md
// as a fix that had to be deliberate. It was made deliberately on 2026-09-02, after a
// legacy `.ebgeo` froze the page's main thread with one of these NaNs (the repro and
// the measurement live in `tests/unit/zoom-correction-sem-referencia.repro.test.js`).
// The rule now: no non-finite value leaves this module.
describe('calculateZoomCorrectedValue — non-finite input handling (guarded)', () => {
    const cfg = { sourceProperty: 'size' };

    // A base value that is not a number has nothing to correct, so the answer is the
    // caller's declared fallback (undefined when none is declared, which MapLibre
    // reads as absent and answers with the layout property's own default).
    it('returns the fallback when the source size is NaN', () => {
        const props = { size: NaN, createdAtZoom: 10 };
        expect(calculateZoomCorrectedValue(props, 11, cfg)).toBeUndefined();
        expect(calculateZoomCorrectedValue(props, 11, { ...cfg, fallbackValue: 1 })).toBe(1);
    });

    // NaN createdAtZoom means NO ZOOM REFERENCE, so the factor is 1 and the base value
    // comes out untouched. This is the legacy-feature case the defect was found in.
    it('returns the base value when createdAtZoom is NaN', () => {
        const props = { size: 10, createdAtZoom: NaN };
        expect(calculateZoomCorrectedValue(props, 11, cfg)).toBe(10);
    });

    it('returns the base value when currentZoom is NaN', () => {
        const props = { size: 10, createdAtZoom: 10 };
        expect(calculateZoomCorrectedValue(props, NaN, cfg)).toBe(10);
    });

    it('returns the fallback when the source property is missing', () => {
        const props = { createdAtZoom: 10 };
        expect(calculateZoomCorrectedValue(props, 11, cfg)).toBeUndefined();
        expect(calculateZoomCorrectedValue(props, 11, { ...cfg, fallbackValue: 7 })).toBe(7);
    });

    // `config.maxValue ?? Infinity` did NOT guard a NaN clamp: `Math.min(x, NaN)` is
    // NaN, so a poisoned clamp poisoned an otherwise valid result. It is ignored now.
    it('ignores a NaN maxValue instead of letting it poison a valid result', () => {
        const props = { size: 10, createdAtZoom: 10 };
        const result = calculateZoomCorrectedValue(props, 11, { sourceProperty: 'size', maxValue: NaN });
        expect(result).toBe(20);
    });

    // An infinite zoom is not a zoom: no reference, factor 1, base value out.
    it('returns the base value when currentZoom is +Infinity (was Infinity)', () => {
        const props = { size: 10, createdAtZoom: 10 };
        expect(calculateZoomCorrectedValue(props, Infinity, cfg)).toBe(10);
    });

    it('returns the base value when currentZoom is -Infinity (was 0)', () => {
        const props = { size: 10, createdAtZoom: 10 };
        expect(calculateZoomCorrectedValue(props, -Infinity, cfg)).toBe(10);
    });

    it('disabled correction with a NaN source returns the fallback, not NaN', () => {
        const props = { size: NaN, createdAtZoom: 10, zoomCorrectionEnabled: false };
        expect(calculateZoomCorrectedValue(props, 11, cfg)).toBeUndefined();
        expect(calculateZoomCorrectedValue(props, 11, { ...cfg, fallbackValue: 1 })).toBe(1);
    });

    // A scale factor that overflows (or underflows to exactly zero) is no factor at
    // all: the base value survives instead of becoming Infinity or vanishing.
    it('a scale factor that overflows leaves the base value in place', () => {
        expect(calculateZoomCorrectedValue({ size: 10, createdAtZoom: -5000 }, 5000, cfg)).toBe(10);
        expect(calculateZoomCorrectedValue({ size: 10, createdAtZoom: 5000 }, -5000, cfg)).toBe(10);
    });

    // CONTROL: the guard discriminates. Without this line every assertion above
    // would also pass against a function that ignored its inputs entirely.
    it('controle: uma entrada boa continua sendo corrigida normalmente', () => {
        expect(calculateZoomCorrectedValue({ size: 10, createdAtZoom: 10 }, 12, cfg)).toBe(40);
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

    // GUARDED since 2026-09-02 (this used to pin the NaN propagating to both copies).
    it('writes the fallback, not NaN, to both features when the source size is NaN', () => {
        const { sourceFeature, selectedFeature } = makePair({ size: NaN, createdAtZoom: 10 });
        syncZoomCorrectedProperty(sourceFeature, selectedFeature, 'size', NaN, 11, { ...cfg, fallbackValue: 1 });
        expect(sourceFeature.properties.calculatedSize).toBe(1);
        expect(selectedFeature.properties.calculatedSize).toBe(1);
    });

    // A non-finite `createdAtZoom` must not be rounded into a stored anchor that
    // looks like a number: `Math.round(NaN * 10) / 10` is NaN, and downstream that
    // reads as "no reference" only because the guard tests finiteness, not shape.
    it('does not round a non-finite createdAtZoom into the feature', () => {
        const { sourceFeature, selectedFeature } = makePair({ size: 10, createdAtZoom: 10 });
        syncZoomCorrectedProperty(sourceFeature, selectedFeature, 'createdAtZoom', NaN, 11, cfg);
        expect(Number.isNaN(sourceFeature.properties.createdAtZoom)).toBe(true);
        // The derived size survives it: no reference means factor 1, not NaN.
        expect(sourceFeature.properties.calculatedSize).toBe(10);
        expect(selectedFeature.properties.calculatedSize).toBe(10);
    });
});
