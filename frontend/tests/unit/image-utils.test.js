// Path: tests/unit/image-utils.test.js

import { describe, it, expect } from 'vitest';

// `validateImageFile` and `validateImageDimensions` are pure checks (no DOM/canvas), so they can
// run in the `node` test environment with plain `{ size, type }` stand-ins for File and with bare
// numbers for the decoded size.
import {
    validateImageFile,
    validateImageDimensions,
    acceptedImageTypes,
    acceptedImageExtensions,
    reencodedImageType,
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

describe('a porta que RE-ENCODA aceita GIF e BMP, e só ela', () => {
    // A ferramenta de imagem e o arrastar-e-soltar desenham a figura num canvas e jogam fora os
    // bytes originais, então o servidor nunca vê o GIF. Recusá-los ali era uma recusa que não
    // protegia nada, e tirava um comportamento que as pessoas tinham.
    const REENCODA = { allowReencodable: true };

    it('aceita GIF e BMP quando a porta declara que re-encoda', () => {
        expect(validateImageFile(fileLike('image/gif'), REENCODA)).toEqual({ valid: true });
        expect(validateImageFile(fileLike('image/bmp'), REENCODA)).toEqual({ valid: true });
    });

    it('continua recusando GIF e BMP quando a porta guarda os bytes originais', () => {
        // O controle que dá sentido ao caso acima: a opção tem de MUDAR a resposta, senão as duas
        // metades passariam com um gate que aceita tudo.
        for (const tipo of ['image/gif', 'image/bmp']) {
            const result = validateImageFile(fileLike(tipo));
            expect(result.valid, `${tipo} sem a opção`).toBe(false);
            expect(result.reason).toMatch(/não suportado/i);
        }
    });

    it('não afrouxa nada mais: SVG e PDF continuam recusados nos dois modos', () => {
        for (const tipo of ['image/svg+xml', 'image/tiff', 'application/pdf']) {
            expect(validateImageFile(fileLike(tipo), REENCODA).valid, tipo).toBe(false);
            expect(validateImageFile(fileLike(tipo)).valid, tipo).toBe(false);
        }
    });

    it('o teto de bytes continua valendo para um GIF aceito', () => {
        const grande = { type: 'image/gif', size: IMAGE_CONFIG.maxSizeBytes + 1, name: 'a.gif' };
        const result = validateImageFile(grande, REENCODA);
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/o máximo é 10 MB/);
    });

    it('a FRASE de recusa nomeia os formatos DAQUELA porta, não uma lista fixa', () => {
        // O defeito que isto prende: uma porta que aceita quatro formatos recusando com a frase de
        // duas manda a pessoa converter um arquivo à toa.
        const naPortaLarga = validateImageFile(fileLike('image/tiff'), REENCODA).reason;
        expect(naPortaLarga).toContain('JPEG, PNG, WebP, GIF ou BMP');

        const naPortaEstreita = validateImageFile(fileLike('image/tiff')).reason;
        expect(naPortaEstreita).toContain('JPEG, PNG ou WebP');
        expect(naPortaEstreita).not.toContain('GIF');
    });

    it('o fallback de MIME vazio aceita .gif e .bmp só na porta larga', () => {
        const semMime = (nome) => ({ type: '', size: 1024, name: nome });
        const opcoes = { allowExtensionFallback: true, allowReencodable: true };

        expect(validateImageFile(semMime('foto.GIF'), opcoes)).toEqual({ valid: true });
        expect(validateImageFile(semMime('mapa.bmp'), opcoes)).toEqual({ valid: true });
        // Sem a opção de re-encode, a mesma extensão não vale.
        expect(validateImageFile(semMime('foto.gif'), { allowExtensionFallback: true }).valid)
            .toBe(false);
        // E sem o fallback declarado, nem com a opção larga: MIME vazio não é MIME certo.
        expect(validateImageFile(semMime('foto.gif'), REENCODA).valid).toBe(false);
    });

    it('acceptedImageTypes / acceptedImageExtensions são derivadas e não compartilham o array', () => {
        expect(acceptedImageTypes()).toEqual(['image/jpeg', 'image/png', 'image/webp']);
        expect(acceptedImageTypes({ allowReencodable: true }))
            .toEqual(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']);
        expect(acceptedImageExtensions({ allowReencodable: true }))
            .toEqual(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

        // Cópia, nunca a constante viva: um chamador que ordenasse o retorno reescreveria o gate.
        const copia = acceptedImageTypes();
        copia.push('image/tiff');
        expect(IMAGE_CONFIG.allowedTypes).not.toContain('image/tiff');
    });
});

describe('reencodedImageType: o canvas só devolve formato que o servidor aceita', () => {
    it('mantém JPEG como JPEG', () => {
        expect(reencodedImageType('data:image/jpeg;base64,AAAA')).toBe('image/jpeg');
    });

    it('converte GIF e BMP para PNG, que é o defeito que isto conserta', () => {
        // `canvas.toDataURL('image/gif')` não é codificável em navegador nenhum: a especificação
        // manda cair em PNG calado. O ramo que pedia `image/gif` dava os bytes certos com o nome
        // errado, e o nome é o que a subida lê.
        expect(reencodedImageType('data:image/gif;base64,R0lGOD')).toBe('image/png');
        expect(reencodedImageType('data:image/bmp;base64,Qk0')).toBe('image/png');
    });

    it('converte PNG e WebP para PNG', () => {
        expect(reencodedImageType('data:image/png;base64,iVBOR')).toBe('image/png');
        expect(reencodedImageType('data:image/webp;base64,UklGR')).toBe('image/png');
    });

    it('nunca devolve um tipo fora da lista do servidor, para entrada nenhuma', () => {
        const entradas = [
            undefined, null, '', 'lixo', 42, {},
            'data:image/gif', 'DATA:IMAGE/JPEG;base64,AA', 'data:image/jpeg2000;base64,AA',
        ];
        for (const entrada of entradas) {
            expect(IMAGE_CONFIG.allowedTypes, String(entrada))
                .toContain(reencodedImageType(entrada));
        }
    });

    it('é sensível a maiúsculas de propósito: o prefixo vem de `canvas.toDataURL`', () => {
        // Nada nesta árvore produz `DATA:IMAGE/JPEG`; normalizar aqui esconderia uma origem
        // inesperada de data URL em vez de tratá-la, e o PNG é o lado seguro.
        expect(reencodedImageType('DATA:IMAGE/JPEG;base64,AA')).toBe('image/png');
    });
});
