// Path: tests/unit/subida-de-imagens-por-lotes-resiliente.test.js

/**
 * @fileoverview Prende o comportamento de `uploadImagesInChunks`
 * (`src/js/import_export/atlas-image-upload.js`) quando UM lote cai.
 *
 * O DEFEITO QUE ELE EXISTE PARA REPROVAR (onda 3, B3-6). O laço mandava os lotes de 50 sem
 * `try/catch`, então uma queda de rede no lote k propagava a exceção e ABORTAVA o laço: os lotes
 * 1..k-1 já estavam gravados no servidor, os lotes k+1..n nunca eram tentados, e a tela mostrava
 * o texto cru do `fetch` ("Failed to fetch"). Medido no navegador com a rota de upload em lote
 * abortada: `POST /atlas/import` respondeu 201 e o atlas ficou no servidor com 0 imagens.
 *
 * A MARCA É O TERCEIRO LOTE, nunca "não lançou": um teste que só exigisse ausência de exceção
 * passaria também se a função engolisse o erro e parasse ali, que é meia correção. Por isso o
 * insumo tem TRÊS lotes com o do MEIO caindo, e a asserção cobre as duas metades: o mapping dos
 * dois lotes bons e os 50 ids do lote ruim listados em `failed`.
 *
 * A forma de `failed` é a MESMA que o servidor devolve (`{ localId, error }`,
 * `backend/src/modules/images/images.service.js:176-311`), porque os consumidores contam
 * `failed.length` e o lote H1 vai ler a mensagem.
 */

import { describe, it, expect, vi } from 'vitest';
import { uploadImagesInChunks } from '@js/import_export/atlas-image-upload.js';

/** Gera `n` itens de upload no formato que `buildImageUploads` produz. */
function itens(n) {
    return Array.from({ length: n }, (_, i) => ({
        localId: `img-${String(i).padStart(3, '0')}`,
        filename: `img-${String(i).padStart(3, '0')}.png`,
        mimeType: 'image/png',
        data: 'data:image/png;base64,AAAA',
    }));
}

/**
 * Um `apiClient` que responde bem a todo lote menos ao de índice `indiceQueCai`, onde rejeita.
 * @param {number} indiceQueCai
 */
function clienteQueCaiNoLote(indiceQueCai, erro = new TypeError('Failed to fetch')) {
    let chamada = 0;
    const chamadas = [];
    return {
        chamadas,
        bulkUploadImages: vi.fn(async (_atlasId, chunk) => {
            const indice = chamada++;
            chamadas.push(chunk.map((c) => c.localId));
            if (indice === indiceQueCai) throw erro;
            return { mapping: Object.fromEntries(chunk.map((c) => [c.localId, `srv-${c.localId}`])), failed: [] };
        }),
    };
}

describe('B3-6: um lote que cai nao leva embora os lotes seguintes', () => {
    it('tenta os tres lotes, mapeia os dois bons e registra os 50 ids do ruim', async () => {
        const cliente = clienteQueCaiNoLote(1);
        const uploads = itens(150);

        const { mapping, failed, transportErrors } = await uploadImagesInChunks(cliente, 'atlas-1', uploads);

        expect(cliente.bulkUploadImages).toHaveBeenCalledTimes(3);
        expect(cliente.chamadas[2][0]).toBe('img-100');
        expect(Object.keys(mapping)).toHaveLength(100);
        expect(mapping['img-000']).toBe('srv-img-000');
        expect(mapping['img-100']).toBe('srv-img-100');
        expect(mapping['img-050']).toBeUndefined();
        expect(failed).toHaveLength(50);
        expect(failed[0]).toEqual({ localId: 'img-050', error: 'Failed to fetch' });
        expect(failed.at(-1).localId).toBe('img-099');
        expect(transportErrors).toBe(1);
    });

    it('sem queda, o resultado e o de sempre e transportErrors e zero', async () => {
        const cliente = clienteQueCaiNoLote(-1);

        const { mapping, failed, transportErrors } = await uploadImagesInChunks(cliente, 'atlas-1', itens(120));

        expect(cliente.bulkUploadImages).toHaveBeenCalledTimes(3);
        expect(Object.keys(mapping)).toHaveLength(120);
        expect(failed).toEqual([]);
        expect(transportErrors).toBe(0);
    });

    it('o failed que o SERVIDOR devolve continua chegando junto com o do transporte', async () => {
        let chamada = 0;
        const cliente = {
            bulkUploadImages: vi.fn(async (_id, chunk) => {
                if (chamada++ === 0) {
                    return { mapping: {}, failed: [{ localId: chunk[0].localId, error: 'Content does not match declared type' }] };
                }
                throw new Error('socket hang up');
            }),
        };

        const { failed, transportErrors } = await uploadImagesInChunks(cliente, 'atlas-1', itens(60));

        expect(transportErrors).toBe(1);
        expect(failed).toHaveLength(11);
        expect(failed[0]).toEqual({ localId: 'img-000', error: 'Content does not match declared type' });
        expect(failed[1]).toEqual({ localId: 'img-050', error: 'socket hang up' });
    });

    it('erro sem mensagem nao vira "undefined" na lista', async () => {
        const cliente = clienteQueCaiNoLote(0, { nome: 'coisa sem message' });

        const { failed } = await uploadImagesInChunks(cliente, 'atlas-1', itens(2));

        expect(failed).toHaveLength(2);
        expect(failed[0].error).toBeTruthy();
        expect(String(failed[0].error)).not.toContain('undefined');
    });
});
