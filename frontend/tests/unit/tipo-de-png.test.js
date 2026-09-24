// Path: tests/unit/tipo-de-png.test.js

/**
 * @fileoverview O PNG ANIMADO é `image/apng` para o servidor, e o cliente passou a dizer o mesmo
 * (2026-09-24, item 3 da segunda revisão das fotos anexas).
 *
 * O DEFEITO. O detector do servidor (`file-type`, `detectors/png.js`) percorre os pedaços do PNG e
 * chama o arquivo de `image/apng` quando um `acTL` vem antes do primeiro `IDAT`. O cliente lia 32 ou
 * 33 bytes e dizia `image/png`: a subida era recusada como tipo contradito pelos bytes, e a
 * importação atômica recusava o atlas INTEIRO por essa figura. A foto anexa inline passa a ficar
 * inline; a figura que só existe como blob sobe achatada num PNG parado, sob o mesmo id.
 *
 * O CORPUS É O MESMO que `tests/e2e/tipo-de-png-como-o-servidor.e2e.test.js` manda ao servidor real,
 * e o `esperado` de cada arquivo é o que o servidor responde: este arquivo prende o cliente a ele pelas
 * TRÊS portas que tipam uma figura (os bytes inteiros, o blob, a data URL de uma foto inline).
 */

import { describe, it, expect, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { mimeDosBytes, mimeDoBlob, mimeDeFotoInlineQueSobe } from '@utils/image_utils.js';
import { buildImageUploads } from '@js/import_export/atlas-image-upload.js';
import { corpusDoTipoDePng, pngSintetico } from '../helpers/png-sintetico.js';

// `FileReader` não é global do Node, e `blobToBase64` depende dele. Lê o blob de verdade.
if (typeof globalThis.FileReader === 'undefined') {
    globalThis.FileReader = class {
        readAsDataURL(blob) {
            blob.arrayBuffer().then((buf) => {
                this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`;
                this.onloadend?.();
            }, (err) => { this.error = err; this.onerror?.(); });
        }
    };
}

const MINIATURA = 'data:image/jpeg;base64,/9j/';
const dataUrl = (bytes, tipo = 'image/png') => `data:${tipo};base64,${Buffer.from(bytes).toString('base64')}`;

describe('o tipo de um PNG é o que o servidor diz, pelas três portas', () => {
    for (const { nome, bytes, esperado } of corpusDoTipoDePng()) {
        it(`${nome}: ${esperado ?? 'sem tipo'}`, async () => {
            expect(mimeDosBytes(bytes), 'os bytes inteiros').toBe(esperado);
            expect(await mimeDoBlob(new Blob([bytes])), 'o blob, lido por pedaços').toBe(esperado);
            // A foto inline converte só quando o tipo é aceito pelo servidor: um APNG fica inline.
            expect(mimeDeFotoInlineQueSobe({ id: 'f', thumbnail: MINIATURA, data: dataUrl(bytes) }), 'a data URL')
                .toBe(esperado === 'image/png' ? 'image/png' : null);
        });
    }

    it('o acTL além de 33 bytes é achado, que era exatamente o que a cabeça fixa perdia', () => {
        const apng = pngSintetico({ animado: true, antes: [['tEXt', Buffer.alloc(5000, 0x61)]] });
        expect(Buffer.from(apng).indexOf('acTL'), 'o acTL está depois dos 5 KB de texto').toBeGreaterThan(5000);
        expect(mimeDosBytes(apng.subarray(0, 33)), 'a cabeça sozinha diz PNG parado').toBe('image/png');
        expect(mimeDosBytes(apng)).toBe('image/apng');
    });

    it('a data URL declarada image/png com bytes de APNG fica inline, qualquer que seja o preenchimento', () => {
        for (const extra of [0, 1, 2]) {
            const apng = pngSintetico({ animado: true, antes: [['tEXt', Buffer.alloc(3000 + extra, 0x61)]] });
            expect(mimeDeFotoInlineQueSobe({ id: 'f', thumbnail: MINIATURA, data: dataUrl(apng) })).toBeNull();
        }
    });
});

describe('a figura que só existe como blob sobe como PNG parado', () => {
    it('um APNG passa pelo achatador e sobe como image/png, sob o mesmo id', async () => {
        const apng = new Blob([pngSintetico({ animado: true })], { type: 'image/png' });
        const parado = new Blob([pngSintetico()], { type: 'image/png' });
        const flattenApng = vi.fn(async () => parado);

        const { uploads, skipped } = await buildImageUploads([['figura', apng]], { rasterizeSvg: null, flattenApng });

        expect(flattenApng).toHaveBeenCalledTimes(1);
        expect(skipped).toEqual([]);
        expect(uploads).toHaveLength(1);
        expect(uploads[0]).toMatchObject({ localId: 'figura', mimeType: 'image/png', filename: 'figura.png' });
        expect(uploads[0].data).toBe(dataUrl(pngSintetico()));
    });

    it('um PNG parado não passa pelo achatador', async () => {
        const flattenApng = vi.fn();
        const { uploads } = await buildImageUploads([['p', new Blob([pngSintetico()])]], { rasterizeSvg: null, flattenApng });
        expect(flattenApng).not.toHaveBeenCalled();
        expect(uploads[0].mimeType).toBe('image/png');
    });

    it('sem achatador, o APNG fica de fora com o motivo, em vez de subir declarado PNG', async () => {
        const { uploads, skipped, skippedReasons } = await buildImageUploads(
            [['figura', new Blob([pngSintetico({ animado: true })], { type: 'image/png' })]],
            { rasterizeSvg: null, flattenApng: null },
        );
        expect(uploads).toEqual([]);
        expect(skipped).toEqual(['figura']);
        expect(skippedReasons[0].reason).toContain('image/apng');
    });

    it('um achatador que devolve outro APNG não sobe mentindo o tipo', async () => {
        const flattenApng = async () => new Blob([pngSintetico({ animado: true })], { type: 'image/png' });
        const { uploads, skipped } = await buildImageUploads(
            [['figura', new Blob([pngSintetico({ animado: true })])]],
            { rasterizeSvg: null, flattenApng },
        );
        expect(uploads).toEqual([]);
        expect(skipped).toEqual(['figura']);
    });
});
