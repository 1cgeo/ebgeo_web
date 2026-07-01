import { describe, it, expect, vi } from 'vitest';

// point-custom-icons.js pulls in the store barrel and DOM/canvas-coupled utils.
// Mock the heavy deps so the pure marker-id helpers can be tested in `node`.
vi.mock('@store', () => ({
    getCustomIconBlob: () => Promise.resolve(null),
}));
vi.mock('@utils/image_utils.js', () => ({
    IMAGE_CONFIG: { maxSizeBytes: 10 * 1024 * 1024 },
}));
vi.mock('@utils/toast_service.js', () => ({
    showError: () => {},
}));

const { parseCustomMarker, customMarkerSymbol } = await import(
    '../../src/js/draw_tools/point_tool/point-custom-icons.js'
);

describe('parseCustomMarker', () => {
    it('extracts the icon id from a custom marker', () => {
        expect(parseCustomMarker('custom:abc-123')).toBe('abc-123');
    });

    it('returns null for built-in symbols', () => {
        expect(parseCustomMarker('circle')).toBeNull();
        expect(parseCustomMarker('car')).toBeNull();
        expect(parseCustomMarker('x-mark')).toBeNull();
    });

    it('returns null for the bare prefix with no id', () => {
        expect(parseCustomMarker('custom:')).toBeNull();
    });

    it('returns null for empty / non-string input', () => {
        expect(parseCustomMarker('')).toBeNull();
        expect(parseCustomMarker(undefined)).toBeNull();
        expect(parseCustomMarker(null)).toBeNull();
        expect(parseCustomMarker(42)).toBeNull();
    });

    it('does not treat a colon mid-string as custom', () => {
        expect(parseCustomMarker('not-custom:abc')).toBeNull();
    });
});

describe('customMarkerSymbol', () => {
    it('builds the prefixed marker value', () => {
        expect(customMarkerSymbol('abc')).toBe('custom:abc');
    });

    it('round-trips with parseCustomMarker', () => {
        const id = 'icon-9f8e';
        expect(parseCustomMarker(customMarkerSymbol(id))).toBe(id);
    });
});
