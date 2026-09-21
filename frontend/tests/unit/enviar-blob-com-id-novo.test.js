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
            importAtlas: vi.fn(async (payload, { images }) => {
                enviados.push(...images);
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

    // UMA FIGURA SEM ARQUIVO E PERGUNTA, NAO RECUSA (2026-09-21). Este caso prendia a recusa ("refuses
    // a missing original"), e ela era a armadilha: um icone cujo arquivo nao existe mais tornava o
    // atlas impossivel de publicar, para sempre. O que continua valendo, e e o que os tres casos
    // cobram: NADA vai a rede sem a pessoa decidir. Ver `atlas-sobe-com-figura-orfa.test.js`.
    it('figura ausente SEM quem pergunte: nada e publicado, e o erro vem marcado como cancelamento', async () => {
        blobs.delete(idLocalDoIcone);
        await expect(saveLocalAtlasToServer(apiClient, exportService, { name: 'Sem icone' }))
            .rejects.toMatchObject({ cancelled: true });
        expect(apiClient.importAtlas).not.toHaveBeenCalled();
        expect(enviados).toHaveLength(0);
    });

    it('figura ausente e a pessoa CANCELA: a pergunta nomeou a perda, e nada foi publicado', async () => {
        blobs.delete(idLocalDoIcone);
        const confirmMissingImages = vi.fn(async () => false);
        await expect(saveLocalAtlasToServer(apiClient, exportService, { name: 'Sem icone', confirmMissingImages }))
            .rejects.toMatchObject({ cancelled: true });
        expect(confirmMissingImages).toHaveBeenCalledTimes(1);
        const pergunta = confirmMissingImages.mock.calls[0][0];
        expect(pergunta.title).toBe('Este atlas sobe sem 1 figura');
        expect(pergunta.message).toContain('1 ícone personalizado');
        expect(apiClient.importAtlas).not.toHaveBeenCalled();
    });

    it('figura ausente e a pessoa CONFIRMA: sobe o resto, e o servidor e avisado do id NOVO da ausente', async () => {
        blobs.delete(idLocalDoIcone);
        const resultado = await saveLocalAtlasToServer(apiClient, exportService, {
            name: 'Sem icone', confirmMissingImages: async () => true,
        });
        expect(apiClient.importAtlas).toHaveBeenCalledTimes(1);
        const opcoes = apiClient.importAtlas.mock.calls[0][1];
        const ponto = importado.maps[0].features.find((f) => f.feature_type === 'point');
        const idNovoDoIcone = ponto.properties.markerSymbol.slice('custom:'.length);
        // A CONCORDANCIA, de novo: o id declarado ausente e o que o payload cita, nao o local.
        expect(opcoes.missingImageIds).toEqual([idNovoDoIcone]);
        expect(opcoes.missingImageIds).not.toContain(idLocalDoIcone);
        // A imagem que TINHA arquivo subiu, e a ausente nao entrou no manifesto de subida.
        expect(enviados).toHaveLength(1);
        expect(enviados.map((u) => u.localId)).not.toContain(idNovoDoIcone);
        expect(resultado.imageStats).toMatchObject({ total: 2, uploaded: 1, skipped: 0, failed: 0, missing: 1 });
    });

    it('nada ausente: ninguem e perguntado, e a declaracao vai vazia', async () => {
        const confirmMissingImages = vi.fn(async () => true);
        await saveLocalAtlasToServer(apiClient, exportService, { name: 'Inteiro', confirmMissingImages });
        expect(confirmMissingImages).not.toHaveBeenCalled();
        expect(apiClient.importAtlas.mock.calls[0][1].missingImageIds).toEqual([]);
    });
});
