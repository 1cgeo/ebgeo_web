// Path: tests/e2e/foto-anexa-sobe-e-copia.e2e.test.js

/**
 * @fileoverview FASE 2c DAS FOTOS ANEXAS (2026-09-24), a fronteira inteira contra o backend REAL: um
 * atlas local com uma foto INLINE (acervo anterior à fase 2b) e uma por REFERÊNCIA (fase 2b) sobe
 * pelo transporte atômico que as três portas usam, e as duas fotos abrem dentro do atlas publicado;
 * clonado, as duas abrem dentro da CÓPIA, sob ids que não são os da origem.
 *
 * O que a mudança atravessa, e por isso mora aqui: o cliente decide QUAIS ids sobem
 * (`buildServerImportPayload`) e o servidor decide QUAIS exige (`importImageIds`, conferido por
 * `assertImageManifest`); o clone reescreve do lado do servidor (`rewriteFeatureProperties`).
 */

import { describe, it, beforeAll, expect } from 'vitest';
import { E2E_SKIP, makeApi, registerAndLogin } from './helpers/harness.js';
import { buildServerImportPayload } from '../../src/js/import_export/local-atlas-to-server.js';
import { buildImageUploads } from '../../src/js/import_export/atlas-image-upload.js';
import { blobDeDataUrl } from '../../src/js/utilities/image_utils.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

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

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** JPEG bytes (the signature the server sniffs) that identify the inline photo. */
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x69, 0x6e, 0x6c, 0xff, 0xd9]);
const JPEG_DATA_URL = `data:image/jpeg;base64,${btoa(String.fromCharCode(...JPEG))}`;
const bytesDe = async (blob) => new Uint8Array(await blob.arrayBuffer());

describe.skipIf(E2E_SKIP)('e2e: a foto anexa sobe ao servidor e sobrevive à cópia (fase 2c)', () => {
    let api, atlasId, cloneId;
    const inlineId = generateUUID();
    const refId = generateUUID();
    const discoLocal = new Map([[refId, new Blob([Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0))], { type: 'image/png' })]]);

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Foto 2c' });
        const exportData = {
            maps: {
                'Mapa A': {
                    features: {
                        points: [{
                            type: 'Feature', geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                            properties: {
                                id: generateUUID(), source: 'point', layerId: 'default', nome: 'Com fotos',
                                images: [
                                    { id: inlineId, name: 'velha.jpg', type: 'image/png', data: JPEG_DATA_URL, thumbnail: JPEG_DATA_URL, addedAt: 1 },
                                    { id: refId, name: 'nova.png', type: 'image/png', size: 70, thumbnail: JPEG_DATA_URL, addedAt: 2 },
                                ],
                            },
                        }],
                    },
                },
            },
            layers: { 'Mapa A': [{ id: 'default', name: 'Padrão', order: 0, visible: true, locked: false, opacity: 1 }] },
        };

        // O que as três portas fazem: sondagem, ids novos, payload, bytes (documento antes do disco).
        const sondagem = buildServerImportPayload(exportData, { name: 'Atlas com fotos' });
        const imageIdMap = Object.fromEntries(sondagem.imageIds.map((id) => [id, generateUUID()]));
        const built = buildServerImportPayload(exportData, { name: 'Atlas com fotos', imageIdMap });
        const found = built.imageIds.map((id) => {
            const inline = built.inlineImages.get(id);
            return [imageIdMap[id], inline ? blobDeDataUrl(inline) : discoLocal.get(id)];
        });
        const { uploads, skipped } = await buildImageUploads(found);
        expect(skipped).toEqual([]);
        expect(uploads).toHaveLength(2);

        const atlas = await api.importAtlas(built.payload, { images: uploads, source: { exportData, name: 'Atlas com fotos' }, missingImageIds: [] });
        atlasId = atlas.id;
        cloneId = (await api.cloneAtlas(atlasId, { name: 'Cópia com fotos' })).id;
    }, 60000);

    const fotosDe = async (id) => {
        const { snapshot } = await api.pullSync(id, 0);
        return snapshot.maps[0].features.points[0].properties.images;
    };

    it('as duas fotos abrem no atlas publicado, e nenhuma leva bytes no documento', async () => {
        const [inline, ref] = await fotosDe(atlasId);
        expect(inline).not.toHaveProperty('data');
        expect(inline.type).toBe('image/jpeg');
        expect(inline.thumbnail).toBe(JPEG_DATA_URL);
        expect(await bytesDe(await api.fetchImageBlob(atlasId, inline.id))).toEqual(JPEG);
        expect(await bytesDe(await api.fetchImageBlob(atlasId, ref.id))).toEqual(await bytesDe(discoLocal.get(refId)));
    });

    it('na cópia, as duas abrem sob ids novos, e os da origem não resolvem lá dentro', async () => {
        const origem = await fotosDe(atlasId);
        const copia = await fotosDe(cloneId);
        expect(copia).toHaveLength(2);
        for (let i = 0; i < 2; i++) {
            expect(copia[i].id).not.toBe(origem[i].id);
            expect(await bytesDe(await api.fetchImageBlob(cloneId, copia[i].id)))
                .toEqual(await bytesDe(await api.fetchImageBlob(atlasId, origem[i].id)));
            await expect(api.fetchImageBlob(cloneId, origem[i].id)).rejects.toMatchObject({ status: 404 });
        }
    });
});
