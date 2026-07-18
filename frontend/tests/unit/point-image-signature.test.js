import { describe, it, expect } from 'vitest';

// pointImageSignature is pure (no DOM at import time) — the canvas-coupled helpers
// in the same module are only touched lazily inside generatePointImage().
const { pointImageSignature, needsPerFeatureImage } = await import(
    '../../src/js/draw_tools/point_tool/point-marker-symbols.js'
);

describe('needsPerFeatureImage', () => {
    it('is false for circle / unset (rendered by the native circle layer)', () => {
        expect(needsPerFeatureImage('circle')).toBe(false);
        expect(needsPerFeatureImage('')).toBe(false);
        expect(needsPerFeatureImage(undefined)).toBe(false);
        expect(needsPerFeatureImage(null)).toBe(false);
    });

    it('is true for built-in shapes/icons and custom markers', () => {
        expect(needsPerFeatureImage('triangle')).toBe(true);
        expect(needsPerFeatureImage('car')).toBe(true);
        expect(needsPerFeatureImage('custom:abc')).toBe(true);
    });
});

describe('pointImageSignature', () => {
    it('changes when the marker symbol changes (the icon-staleness bug)', () => {
        const a = pointImageSignature({ markerSymbol: 'car', fillColor: '#fff', lineColor: '#000', lineWidth: 1 });
        const b = pointImageSignature({ markerSymbol: 'plane', fillColor: '#fff', lineColor: '#000', lineWidth: 1 });
        expect(a).not.toBe(b);
    });

    it('changes when any baked visual prop changes (fill, border color, border width)', () => {
        const base = { markerSymbol: 'triangle', fillColor: '#3f4fb5', lineColor: '#000000', lineWidth: 0 };
        const sig = pointImageSignature(base);
        expect(pointImageSignature({ ...base, fillColor: '#ff0000' })).not.toBe(sig);
        expect(pointImageSignature({ ...base, lineColor: '#ffffff' })).not.toBe(sig);
        expect(pointImageSignature({ ...base, lineWidth: 2 })).not.toBe(sig);
    });

    it('is stable for identical props (lets setImages skip unchanged markers)', () => {
        const props = { markerSymbol: 'star', fillColor: '#abc', lineColor: '#def', lineWidth: 3 };
        expect(pointImageSignature(props)).toBe(pointImageSignature({ ...props }));
    });

    it('distinguishes different custom icons keyed under the same feature id', () => {
        expect(pointImageSignature({ markerSymbol: 'custom:A' }))
            .not.toBe(pointImageSignature({ markerSymbol: 'custom:B' }));
    });

    it('does not collide via separator smuggling (delimited fields)', () => {
        // Without delimited joining, ('a','b','','') and ('a','','b','') could collapse
        // to the same string. The '|' separators keep field boundaries distinct.
        const x = pointImageSignature({ markerSymbol: 'a', fillColor: 'b', lineColor: '', lineWidth: '' });
        const y = pointImageSignature({ markerSymbol: 'a', fillColor: '', lineColor: 'b', lineWidth: '' });
        expect(x).not.toBe(y);
    });

    it('treats missing color/width as empty fields without throwing', () => {
        expect(() => pointImageSignature({ markerSymbol: 'square' })).not.toThrow();
        const sig = pointImageSignature({ markerSymbol: 'square' });
        // lineWidth uses ?? so an explicit 0 is preserved and differs from missing.
        expect(sig).not.toBe(pointImageSignature({ markerSymbol: 'square', lineWidth: 0 }));
    });
});
