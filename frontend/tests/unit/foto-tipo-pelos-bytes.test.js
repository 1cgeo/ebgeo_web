// Path: tests/unit/foto-tipo-pelos-bytes.test.js

/**
 * @fileoverview O TIPO DA FOTO É O DOS BYTES, NUNCA O DECLARADO (revisão da fase 2c, 2026-09-24).
 *
 * O servidor fareja os bytes (`fileTypeFromBuffer`) e recusa um tipo declarado que eles contradizem;
 * a importação atômica recusa o atlas INTEIRO por uma imagem assim
 * (`backend/src/modules/atlas/import-attempt.service.js`). O acervo da linha anterior tem fotos
 * cujo cabeçalho diz um formato sobre bytes de outro (um PNG salvo com nome `.jpg`), e três pontos
 * tipavam sem olhar os bytes: `blobDeDataUrl`, `mimeDeFotoInlineQueSobe` e `buildImageUploads`.
 * O quarto, `processImageFile`, precisa de canvas e é cobrado no navegador.
 */

import { describe, it, expect } from 'vitest';
import { blobDeDataUrl, mimeDeFotoInlineQueSobe, mimeDosBytes } from '@utils/image_utils.js';
import { buildImageUploads } from '@js/import_export/atlas-image-upload.js';
import { buildServerImportPayload } from '@js/import_export/local-atlas-to-server.js';

// `FileReader` não é global do Node, e `blobToBase64` depende dele. Lê o blob de verdade.
if (typeof globalThis.FileReader === 'undefined') {
    globalThis.FileReader = class {
        readAsDataURL(blob) {
            blob.arrayBuffer().then((buf) => {
                let bruto = '';
                for (const b of new Uint8Array(buf)) bruto += String.fromCharCode(b);
                this.result = `data:${blob.type};base64,${btoa(bruto)}`;
                this.onloadend?.();
            }, (err) => { this.error = err; this.onerror?.(); });
        }
    };
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
const base64 = (bytes) => btoa(String.fromCharCode(...bytes));
const MINIATURA = 'data:image/jpeg;base64,/9j/';

describe('o tipo da foto vem dos bytes', () => {
    it('mimeDosBytes reconhece as assinaturas, e o que não conhece é null', () => {
        expect(mimeDosBytes(PNG)).toBe('image/png');
        expect(mimeDosBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
        expect(mimeDosBytes(GIF)).toBe('image/gif');
        expect(mimeDosBytes(Uint8Array.from([1, 2, 3, 4]))).toBeNull();
        expect(mimeDosBytes(null)).toBeNull();
    });

    it('PNG declarado JPEG: o blob da data URL sai PNG', () => {
        const blob = blobDeDataUrl(`data:image/jpeg;base64,${base64(PNG)}`);
        expect(blob.type).toBe('image/png');
    });

    it('PNG declarado JPEG converte como PNG; GIF declarado PNG fica inline', () => {
        expect(mimeDeFotoInlineQueSobe({ id: 'a', thumbnail: MINIATURA, data: `data:image/jpeg;base64,${base64(PNG)}` })).toBe('image/png');
        expect(mimeDeFotoInlineQueSobe({ id: 'b', thumbnail: MINIATURA, data: `data:image/png;base64,${base64(GIF)}` })).toBeNull();
    });

    it('a subida declara o tipo dos bytes, não o do blob', async () => {
        const { uploads, skipped } = await buildImageUploads([['id-mentiroso', new Blob([PNG], { type: 'image/jpeg' })]], { rasterizeSvg: null });
        expect(skipped).toEqual([]);
        expect(uploads[0].mimeType).toBe('image/png');
        expect(uploads[0].filename).toBe('id-mentiroso.png');
    });

    it('a fronteira do servidor leva o tipo dos bytes no item e não converte o GIF disfarçado', () => {
        const dados = { maps: { M: { features: { points: [{
            type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { id: 'p', source: 'point', images: [
                { id: 'png-como-jpg', name: 'croqui.jpg', type: 'image/jpeg', data: `data:image/jpeg;base64,${base64(PNG)}`, thumbnail: MINIATURA },
                { id: 'gif-como-png', name: 'velho.png', type: 'image/png', data: `data:image/png;base64,${base64(GIF)}`, thumbnail: MINIATURA },
            ] },
        }] } } } };
        const built = buildServerImportPayload(dados, { name: 'A' });
        expect(built.imageIds).toEqual(['png-como-jpg']);
        const [convertida, inline] = built.payload.maps[0].features[0].properties.images;
        expect(convertida.type).toBe('image/png');
        expect(convertida).not.toHaveProperty('data');
        expect(inline.data).toMatch(/^data:image\/png;base64,R0lG/);
    });
});
