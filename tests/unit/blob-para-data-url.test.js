// Path: tests/unit/blob-para-data-url.test.js

/**
 * @fileoverview `blobToDataUrl`: a base64 saiu do gerador e virou um utilitario.
 *
 * O gerador da medida de coordenacao codificava o PNG em base64 a cada regeracao, so
 * para devolver um `dataUrl` que apenas a previa do modal lia (e que as ferramentas
 * ainda copiavam para `properties.imageUrl`, onde ninguem o lia). A codificacao passou
 * para este utilitario, chamado nos tres pontos do modal que de fato precisam de uma
 * URL para um `<img src>`.
 *
 * O ambiente de teste e `node`: o `FileReader` daqui e um dublê, e o que se prende e o
 * contrato do utilitario (resolve com o resultado, rejeita no erro e no blob ausente),
 * nao a codificacao do navegador.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { blobToDataUrl } from '@utils/blob-to-data-url.js';

const FileReaderOriginal = globalThis.FileReader;

/**
 * Installs a FileReader double with the given outcome.
 * @param {Object} comportamento - { resultado } to succeed, { erro: true } to fail
 * @returns {Array<*>} The blobs handed to readAsDataURL
 */
function instalarFileReader(comportamento) {
    const lidos = [];

    globalThis.FileReader = class {
        readAsDataURL(blob) {
            lidos.push(blob);
            queueMicrotask(() => {
                if (comportamento.erro) {
                    this.onerror?.();
                    return;
                }
                this.result = comportamento.resultado;
                this.onload?.();
            });
        }
    };

    return lidos;
}

afterEach(() => {
    globalThis.FileReader = FileReaderOriginal;
});

describe('blobToDataUrl', () => {
    it('devolve a data URL do blob lido', async () => {
        const lidos = instalarFileReader({ resultado: 'data:image/png;base64,ABC' });
        const blob = { tipo: 'png' };

        await expect(blobToDataUrl(blob)).resolves.toBe('data:image/png;base64,ABC');
        expect(lidos).toEqual([blob]);
    });

    it('rejeita quando a leitura falha, em vez de resolver com undefined', async () => {
        instalarFileReader({ erro: true });

        await expect(blobToDataUrl({})).rejects.toThrow('Failed to read blob');
    });

    it('rejeita sem blob, em vez de estourar dentro do FileReader', async () => {
        const lidos = instalarFileReader({ resultado: 'data:,' });

        for (const vazio of [null, undefined, 0, '']) {
            await expect(blobToDataUrl(vazio)).rejects.toThrow('a blob is required');
        }

        expect(lidos).toEqual([]);
    });
});
