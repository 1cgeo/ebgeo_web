import { describe, it, expect } from 'vitest';

// `validateImageFile` is a pure size/MIME check (no DOM/canvas), so it can run
// in the `node` test environment with plain `{ size, type }` stand-ins for File.
import { validateImageFile, IMAGE_CONFIG } from '../../src/js/utilities/image_utils.js';

const fileLike = (type, size = 1024) => ({ type, size, name: `x.${type.split('/')[1]}` });

describe('IMAGE_CONFIG allowedTypes (backend allowlist: png/jpeg/webp)', () => {
    it('accepts only png, jpeg and webp', () => {
        expect(IMAGE_CONFIG.allowedTypes).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    });

    it('does not include gif', () => {
        expect(IMAGE_CONFIG.allowedTypes).not.toContain('image/gif');
        expect(IMAGE_CONFIG.allowedExtensions).not.toContain('.gif');
    });
});

describe('validateImageFile', () => {
    it('rejects gif (backend rejects gif)', () => {
        const result = validateImageFile(fileLike('image/gif'));
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/não suportado/i);
    });

    it('accepts png', () => {
        expect(validateImageFile(fileLike('image/png'))).toEqual({ valid: true });
    });

    it('accepts jpeg', () => {
        expect(validateImageFile(fileLike('image/jpeg'))).toEqual({ valid: true });
    });

    it('accepts webp', () => {
        expect(validateImageFile(fileLike('image/webp'))).toEqual({ valid: true });
    });

    it('rejects svg for plain image uploads', () => {
        const result = validateImageFile(fileLike('image/svg+xml'));
        expect(result.valid).toBe(false);
    });

    it('rejects a missing file', () => {
        const result = validateImageFile(null);
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/nenhum arquivo/i);
    });

    it('rejects an oversized file', () => {
        const result = validateImageFile(fileLike('image/png', IMAGE_CONFIG.maxSizeBytes + 1));
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/muito grande/i);
    });
});
