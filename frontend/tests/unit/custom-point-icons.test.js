import { describe, it, expect, vi, beforeEach } from 'vitest';

// point-custom-icons.js pulls in the store barrel and DOM/canvas-coupled utils.
// Mock the heavy deps so the pure marker-id helpers can be tested in `node`.
vi.mock('@store', () => ({
    getCustomIconBlob: () => Promise.resolve(null),
}));
vi.mock('@utils/image_utils.js', () => ({
    IMAGE_CONFIG: { maxSizeBytes: 10 * 1024 * 1024 },
}));
const showError = vi.fn();
vi.mock('@utils/toast_service.js', () => ({
    showError: (...args) => showError(...args),
}));

const { parseCustomMarker, customMarkerSymbol, normalizeIconFile } = await import(
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

describe('normalizeIconFile — accepted input types (backend allowlist + rasterized svg)', () => {
    // The `node` test env has no DOM/canvas, so accepted types fall through the
    // type gate and fail later in `blobToImage`. We assert the *type gate* only:
    // rejected types short-circuit with the "Tipo não suportado" toast and never
    // attempt to decode; accepted types pass the gate (that toast is never shown).
    const TYPE_REJECTION = /Tipo não suportado/;
    const fileLike = (type) => ({ type, size: 1024, name: `icon.${type.split('/')[1]}` });

    beforeEach(() => {
        showError.mockClear();
    });

    it('rejects gif at the type gate (backend rejects gif)', async () => {
        const result = await normalizeIconFile(fileLike('image/gif'));
        expect(result).toBeNull();
        expect(showError).toHaveBeenCalledTimes(1);
        expect(showError).toHaveBeenCalledWith(expect.stringMatching(TYPE_REJECTION));
    });

    it.each([
        ['image/png'],
        ['image/jpeg'],
        ['image/webp'],
        ['image/svg+xml'], // accepted only as a rasterization input
    ])('passes the type gate for %s', async (type) => {
        // Decoding fails without a DOM, but the type-rejection toast must NOT fire.
        const result = await normalizeIconFile(fileLike(type));
        expect(result).toBeNull(); // no canvas in `node` → processing fails after the gate
        const typeRejections = showError.mock.calls.filter(
            ([msg]) => typeof msg === 'string' && TYPE_REJECTION.test(msg),
        );
        expect(typeRejections).toHaveLength(0);
    });

    it('rejects a missing file', async () => {
        const result = await normalizeIconFile(null);
        expect(result).toBeNull();
        expect(showError).toHaveBeenCalledWith(expect.stringMatching(/Nenhum arquivo/));
    });
});
