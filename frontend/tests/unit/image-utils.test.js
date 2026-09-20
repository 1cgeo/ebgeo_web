// Path: tests/unit/image-utils.test.js

import { describe, it, expect } from 'vitest';

// `validateImageFile` and `validateImageDimensions` are pure checks (no DOM/canvas), so they can
// run in the `node` test environment with plain `{ size, type }` stand-ins for File and with bare
// numbers for the decoded size.
import {
    validateImageFile,
    validateImageDimensions,
    IMAGE_CONFIG,
} from '../../src/js/utilities/image_utils.js';

const fileLike = (type, size = 1024) => ({ type, size, name: `x.${type.split('/')[1]}` });

describe('IMAGE_CONFIG allowedTypes (backend allowlist: png/jpeg/webp)', () => {
    it('accepts only png, jpeg and webp', () => {
        expect(IMAGE_CONFIG.allowedTypes).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    });

    it('does not include gif', () => {
        expect(IMAGE_CONFIG.allowedTypes).not.toContain('image/gif');
        expect(IMAGE_CONFIG.allowedExtensions).not.toContain('.gif');
    });

    it('mirrors the server byte ceiling (MAX_IMAGE_SIZE_MB, default 10)', () => {
        // `/api/config` does not publish it, so the two copies are kept in step by hand and this
        // is the line that says so out loud. A change on either side has to touch this number.
        expect(IMAGE_CONFIG.maxSizeBytes).toBe(10 * 1024 * 1024);
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

    it('rejects an oversized file NAMING both numbers', () => {
        // The sentence is the point, not just the refusal: "muito grande" alone does not tell
        // the person whether to re-export or to pick another file.
        const result = validateImageFile(fileLike('image/png', 37 * 1024 * 1024));
        expect(result.valid).toBe(false);
        expect(result.reason)
            .toBe('A imagem não foi carregada: o arquivo tem 37 MB e o máximo é 10 MB.');
    });

    it('accepts a file of EXACTLY the ceiling, like the server does', () => {
        // Both sides refuse with `>`. A test that only checked `+1` would pass for a `>=` that
        // silently made the two ceilings disagree by one byte.
        expect(validateImageFile(fileLike('image/png', IMAGE_CONFIG.maxSizeBytes)))
            .toEqual({ valid: true });
    });

    it('rejects one byte above the ceiling', () => {
        const result = validateImageFile(fileLike('image/png', IMAGE_CONFIG.maxSizeBytes + 1));
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/não foi carregada/i);
    });

    it('checks the SIZE before the type, so the heavier fact is the one reported', () => {
        const result = validateImageFile(fileLike('image/gif', 40 * 1024 * 1024));
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/o arquivo tem/i);
    });

    it('one byte above the ceiling reads as ABOVE it, never "tem 10 MB e o máximo é 10 MB"', () => {
        const result = validateImageFile(fileLike('image/png', IMAGE_CONFIG.maxSizeBytes + 1));
        expect(result.reason)
            .toBe('A imagem não foi carregada: o arquivo tem 10,1 MB e o máximo é 10 MB.');
    });
});

describe('validateImageFile — MIME vazio (Windows sem mapeamento, algumas origens de arrasto)', () => {
    const semMime = (name) => ({ type: '', size: 1024, name });

    it('a door that re-encodes opts in, and a .jpg with an EMPTY type is judged by extension', () => {
        expect(validateImageFile(semMime('FOTO.JPG'), { allowExtensionFallback: true }))
            .toEqual({ valid: true });
        expect(validateImageFile(semMime('carta.webp'), { allowExtensionFallback: true }))
            .toEqual({ valid: true });
    });

    it('WITHOUT the opt-in the empty type still refuses (doors that store the original bytes)', () => {
        const result = validateImageFile(semMime('foto.jpg'));
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/tipo de arquivo não suportado/i);
    });

    it('the fallback never rescues a WRONG type, nor an extension off the list, nor no name', () => {
        const opt = { allowExtensionFallback: true };
        // A declared MIME wins over the extension: a GIF renamed to .jpg is still a GIF.
        expect(validateImageFile({ type: 'image/gif', size: 1, name: 'x.jpg' }, opt).valid).toBe(false);
        expect(validateImageFile(semMime('animacao.gif'), opt).valid).toBe(false);
        expect(validateImageFile(semMime('semextensao'), opt).valid).toBe(false);
        expect(validateImageFile({ type: '', size: 1 }, opt).valid).toBe(false);
    });

    it('the byte ceiling still comes first on the fallback path', () => {
        const result = validateImageFile(
            { type: '', size: IMAGE_CONFIG.maxSizeBytes + 1, name: 'x.jpg' },
            { allowExtensionFallback: true },
        );
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/o arquivo tem/i);
    });
});

describe('validateImageDimensions — o teto de PIXELS', () => {
    const { maxPixelSide, maxPixelCount } = IMAGE_CONFIG;

    it('the ceilings are the declared ones', () => {
        expect(maxPixelSide).toBe(8192);
        expect(maxPixelCount).toBe(50 * 1000 * 1000);
    });

    it('accepts an ordinary picture', () => {
        expect(validateImageDimensions(1920, 1080)).toEqual({ valid: true });
    });

    it('accepts EXACTLY the side ceiling on both axes (area permitting)', () => {
        // 8192 x 6000 = 49,15 MP, just under the area ceiling: this pins the side test at `>`
        // and not `>=`, which would refuse the largest picture the product claims to accept.
        expect(validateImageDimensions(maxPixelSide, 6000)).toEqual({ valid: true });
        expect(validateImageDimensions(6000, maxPixelSide)).toEqual({ valid: true });
    });

    it('refuses one pixel above the side ceiling, on either axis', () => {
        const largura = validateImageDimensions(maxPixelSide + 1, 10);
        expect(largura.valid).toBe(false);
        expect(largura.reason).toBe(
            'A imagem não foi carregada: ela tem 8193 x 10 px e o máximo é 8192 px de lado.',
        );

        const altura = validateImageDimensions(10, maxPixelSide + 1);
        expect(altura.valid).toBe(false);
        expect(altura.reason).toMatch(/px de lado/);
    });

    it('refuses the decompression bomb the byte ceiling cannot see', () => {
        // A solid-colour PNG of 30000x30000 is a few hundred kB on disk: it passes
        // `validateImageFile` and would decode into 3,6 GB of RGBA.
        const result = validateImageDimensions(30000, 30000);
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/8192 px de lado/);
    });

    it('accepts EXACTLY the area ceiling', () => {
        // 8000 x 6250 = 50 000 000 px, the ceiling itself. Pins the area test at `>`.
        expect(8000 * 6250).toBe(maxPixelCount);
        expect(validateImageDimensions(8000, 6250)).toEqual({ valid: true });
    });

    it('refuses one pixel of AREA above the ceiling, with both sides legal', () => {
        // The case the side ceiling alone cannot catch: 8000 and 6251 are each under 8192.
        const result = validateImageDimensions(8000, 6251);
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/e o máximo é 50 MP\.$/);
        expect(result.reason).toMatch(/8000 x 6251 px/);
    });

    it('refuses NaN, Infinity, zero and negatives as unreadable, never as valid', () => {
        // `x ?? 0` would let NaN through and `x || fallback` would let Infinity through; both
        // then reach `canvas.width` as a native call. Each of these must refuse.
        const ruins = [
            [NaN, 100], [100, NaN], [NaN, NaN],
            [Infinity, 100], [100, Infinity], [-Infinity, 100],
            [0, 100], [100, 0], [0, 0],
            [-1, 100], [100, -1],
        ];
        for (const [w, h] of ruins) {
            const result = validateImageDimensions(w, h);
            expect(result.valid, `${w}x${h} deveria ser recusado`).toBe(false);
            expect(result.reason).toBe(
                'A imagem não foi carregada: não foi possível ler este arquivo de imagem.',
            );
        }
    });

    it('refuses undefined / null / non-numeric input', () => {
        for (const [w, h] of [[undefined, undefined], [null, null], ['800', '600'], [{}, []]]) {
            expect(validateImageDimensions(w, h).valid).toBe(false);
        }
    });
});
