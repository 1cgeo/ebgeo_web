// Path: tests/unit/enviar-blob-com-id-novo.test.js

/**
 * @fileoverview Prende a metade CLIENTE do conserto da colisao de id no envio de atlas local.
 *
 * `images.id` e chave primaria GLOBAL no servidor, como `features.id`. O servidor recunha o id
 * ocupado de toda entidade que chega no payload do import, mas o BLOB sobe DEPOIS do import: um
 * id recunhado ali deixaria a feicao de imagem, ja gravada, apontando para o nada. Por isso o
 * cliente cunha um id novo para cada blob ANTES de montar o payload, e o `imageIdMap` reescreve
 * as referencias de uma vez.
 *
 * A MARCA E A CONCORDANCIA, nunca "o id mudou": um teste que so exigisse id novo passaria
 * tambem se o payload e o upload cunhassem ids DIFERENTES um do outro, que e exatamente a
 * falha que este arquivo existe para reprovar.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateUUID, isValidUUID } from '@utils/uuid.js';

const blobs = new Map();

vi.mock('@store', () => ({
    getImage: vi.fn(async (id) => blobs.get(id) || null),
    getAllMapNamesStore: vi.fn(async () => ['Mapa A']),
}));

const { saveLocalAtlasToServer } = await import('@js/import_export/save-local-atlas.service.js');

/** Um PNG de 1x1 de verdade: `buildImageUploads` recusa mime fora da lista. */
function pngBlob() {
    return new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
}

// `FileReader` nao e global do Node, e `blobToBase64` depende dele. Sem esta ponte todo blob
// cairia no `catch` de `buildImageUploads` e o arquivo mediria uma lista vazia, verde por
// engano. Le o blob de verdade, e nao devolve dado fixo.
if (typeof globalThis.FileReader === 'undefined') {
    globalThis.FileReader = class {
        readAsDataURL(blob) {
            blob.arrayBuffer().then((buf) => {
                const bytes = new Uint8Array(buf);
                let bruto = '';
                for (const b of bytes) bruto += String.fromCharCode(b);
                this.result = `data:${blob.type};base64,${btoa(bruto)}`;
                this.onloadend?.();
            }, (err) => { this.error = err; this.onerror?.(); });
        }
    };
}

describe('salvar atlas local no servidor: o blob sobe com id novo', () => {
    const idLocalDaImagem = generateUUID();
    const idLocalDoIcone = generateUUID();
    let apiClient, exportService, importado, enviados;

    beforeEach(() => {
        blobs.clear();
        blobs.set(idLocalDaImagem, pngBlob());
        blobs.set(idLocalDoIcone, pngBlob());
        importado = null;
        enviados = [];

        apiClient = {
            importAtlas: vi.fn(async (payload) => {
                importado = payload;
                return { id: generateUUID(), name: payload.atlas.name };
            }),
            bulkUploadImages: vi.fn(async (atlasId, chunk) => {
                enviados.push(...chunk);
                return { mapping: {}, failed: [] };
            }),
        };

        exportService = {
            buildExportDataObject: vi.fn(async () => ({
                maps: {
                    'Mapa A': {
                        features: {
                            images: [{
                                type: 'Feature',
                                geometry: { type: 'Point', coordinates: [0, 0] },
                                properties: { id: idLocalDaImagem, source: 'image' },
                            }],
                            points: [{
                                type: 'Feature',
                                geometry: { type: 'Point', coordinates: [1, 1] },
                                properties: {
                                    id: generateUUID(), source: 'point',
                                    markerSymbol: `custom:${idLocalDoIcone}`,
                                },
                            }],
                        },
                    },
                },
                customIcons: [{ id: idLocalDoIcone, name: 'icone', type: 'image/png' }],
            })),
        };
    });

    it('a feicao de imagem e o blob enviado usam O MESMO id, e ele nao e o local', async () => {
        await saveLocalAtlasToServer(apiClient, exportService, { name: 'Atlas com imagem' });

        const feicao = importado.maps[0].features.find((f) => f.feature_type === 'image');
        expect(feicao).toBeDefined();
        expect(isValidUUID(feicao.id)).toBe(true);
        expect(feicao.id).not.toBe(idLocalDaImagem);
        expect(feicao.properties.id).toBe(feicao.id);

        // A CONCORDANCIA: o blob subiu com o id que a feicao cita.
        const idsEnviados = enviados.map((u) => u.localId);
        expect(idsEnviados).toContain(feicao.id);
        expect(idsEnviados).not.toContain(idLocalDaImagem);
    });

    it('o icone proprio segue a mesma troca, em `markerSymbol` e em `settings`', async () => {
        await saveLocalAtlasToServer(apiClient, exportService, { name: 'Atlas com icone' });

        const ponto = importado.maps[0].features.find((f) => f.feature_type === 'point');
        const idNovoDoIcone = ponto.properties.markerSymbol.slice('custom:'.length);
        expect(isValidUUID(idNovoDoIcone)).toBe(true);
        expect(idNovoDoIcone).not.toBe(idLocalDoIcone);

        expect(importado.atlas.settings.customIcons[0].id).toBe(idNovoDoIcone);
        expect(enviados.map((u) => u.localId)).toContain(idNovoDoIcone);
    });

    it('o blob ilegivel nao vira envio, e a contagem continua contando o citado', async () => {
        blobs.delete(idLocalDoIcone);
        const r = await saveLocalAtlasToServer(apiClient, exportService, { name: 'Sem o icone' });

        expect(r.imageStats.total).toBe(2);
        expect(enviados).toHaveLength(1);
    });
});
