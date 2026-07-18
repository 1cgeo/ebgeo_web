import { describe, it, expect } from 'vitest';
import { validateMapLibreStyle, parseStyleJson } from '../../src/js/utilities/maplibre-style-validate.js';

const VALID_MIN = { version: 8, sources: {}, layers: [] };

describe('validateMapLibreStyle', () => {
    it('accepts a minimal valid style (version 8 + sources object + layers array)', () => {
        expect(validateMapLibreStyle(VALID_MIN)).toEqual({ ok: true, errors: [] });
    });

    it('accepts a realistic style with a raster source and layer', () => {
        const style = {
            version: 8,
            glyphs: 'https://x/{fontstack}/{range}.pbf',
            sources: { osm: { type: 'raster', tiles: ['https://x/{z}/{x}/{y}.png'], tileSize: 256 } },
            layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
        };
        expect(validateMapLibreStyle(style).ok).toBe(true);
    });

    it('rejects a wrong version', () => {
        const r = validateMapLibreStyle({ version: 7, sources: {}, layers: [] });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('version'))).toBe(true);
    });

    it('rejects a missing version', () => {
        expect(validateMapLibreStyle({ sources: {}, layers: [] }).ok).toBe(false);
    });

    it('rejects sources that are not a plain object', () => {
        expect(validateMapLibreStyle({ version: 8, sources: [], layers: [] }).ok).toBe(false);
        expect(validateMapLibreStyle({ version: 8, sources: null, layers: [] }).ok).toBe(false);
    });

    it('rejects layers that are not an array', () => {
        expect(validateMapLibreStyle({ version: 8, sources: {}, layers: {} }).ok).toBe(false);
        expect(validateMapLibreStyle({ version: 8, sources: {} }).ok).toBe(false);
    });

    it('accumulates multiple errors', () => {
        const r = validateMapLibreStyle({ version: 7 });
        expect(r.ok).toBe(false);
        expect(r.errors.length).toBeGreaterThanOrEqual(2);
    });

    // Edge cases
    it('rejects non-object inputs (null, array, string, number)', () => {
        for (const bad of [null, undefined, [], 'x', 42]) {
            expect(validateMapLibreStyle(bad).ok).toBe(false);
        }
    });
});

describe('parseStyleJson', () => {
    it('parses + validates valid JSON', () => {
        const r = parseStyleJson(JSON.stringify(VALID_MIN));
        expect(r.ok).toBe(true);
        expect(r.style).toEqual(VALID_MIN);
    });

    it('returns a JSON error for malformed text (no throw)', () => {
        const r = parseStyleJson('{ not json ');
        expect(r.ok).toBe(false);
        expect(r.style).toBeNull();
        expect(r.errors[0]).toMatch(/JSON inválido/);
    });

    it('returns an empty-string parse error, not a crash', () => {
        const r = parseStyleJson('');
        expect(r.ok).toBe(false);
        expect(r.style).toBeNull();
    });

    it('parses valid JSON that fails structural validation (style stays null)', () => {
        const r = parseStyleJson('{"version":7,"sources":{},"layers":[]}');
        expect(r.ok).toBe(false);
        expect(r.style).toBeNull();
        expect(r.errors.some((e) => e.includes('version'))).toBe(true);
    });
});
