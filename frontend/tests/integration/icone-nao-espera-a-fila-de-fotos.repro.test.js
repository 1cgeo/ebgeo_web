// Path: tests/integration/icone-nao-espera-a-fila-de-fotos.repro.test.js
//
// O ÍCONE PERSONALIZADO NÃO ESPERA AS FOTOS QUE ESTÃO SUBINDO (terceira revisão das fotos anexas,
// 2026-09-25, item 3).
//
// O DEFEITO. A linha única de transferência (`emSerie`) passou a levar toda primeira tentativa, e o
// ícone entrava nela: `addCustomIcon` espera a subida antes de gravar o registro de ícones (é o que
// deixa o blob no servidor quando a gravação do registro falha e a intenção é reprojetada), então, num
// link lento com fotos na fila, o ladrilho do ícone novo só aparecia depois de TODAS elas. É a mesma
// razão pela qual as cópias ficaram fora da linha: um gesto que espera a subida não pode esperar a
// foto de outro gesto. A saída é a mesma das cópias: o ícone sobe fora da linha e disputa o link.
//
// Mesmo arnês de `op-espera-a-foto.repro.test.js`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { activateScope, getActiveScope, remoteScope } from '@store/atlas-namespace.js';

const h = vi.hoisted(() => ({ segurados: new Map() }));

vi.mock('@js/import_export/atlas-image-upload.js', () => ({
    buildImageUploads: async (pares) => ({
        uploads: pares.map(([id]) => ({ localId: id, filename: `${id}.png`, mimeType: 'image/png', data: 'ZmFsc28=' })),
        skipped: [],
    }),
    uploadImagesInChunks: async (_apiClient, _atlasId, uploads) => {
        for (const u of uploads) if (h.segurados.has(u.localId)) await h.segurados.get(u.localId);
        return { mapping: Object.fromEntries(uploads.map(u => [u.localId, u.localId])), failed: [], transportErrors: 0 };
    },
}));

import { registrarBlob, enviarBlobRegistrado, enfileirarBlob, esquecerPendenciasEmMemoria } from '@store/sync/blob-upload-queue.js';

const blob = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });

beforeEach(() => {
    const memoria = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (k) => memoria.get(k) ?? null, setItem: (k, v) => memoria.set(k, String(v)), removeItem: (k) => memoria.delete(k),
    });
    h.segurados = new Map();
    esquecerPendenciasEmMemoria();
    activateScope(remoteScope(crypto.randomUUID()));
});

describe('o ícone e a linha de fotos', () => {
    it('REPRO: a subida do ícone termina com uma foto ainda presa no fio', async () => {
        const scope = getActiveScope();
        const fotoId = crypto.randomUUID();
        let soltarFoto;
        h.segurados.set(fotoId, new Promise((r) => { soltarFoto = r; }));
        const foto = await registrarBlob({ imageId: fotoId, blob: blob(), atlasId: scope.atlasId, origem: 'foto-anexa' });
        const envioDaFoto = enviarBlobRegistrado(foto, blob());

        const icone = enfileirarBlob({ imageId: crypto.randomUUID(), blob: blob(), atlasId: scope.atlasId, origem: 'icone-personalizado', foraDaFila: true });
        const venceu = await Promise.race([
            icone.then(() => 'icone'),
            new Promise((r) => setTimeout(() => r('esperou a foto'), 300)),
        ]);

        soltarFoto();
        await envioDaFoto;
        expect(venceu, 'o ícone não esperou a foto que estava no fio').toBe('icone');
        expect((await icone).confirmado).toBe(true);
    });

    it('CONTROLE: sem a opção, a subida continua na linha e espera a vez', async () => {
        const scope = getActiveScope();
        const fotoId = crypto.randomUUID();
        let soltarFoto;
        h.segurados.set(fotoId, new Promise((r) => { soltarFoto = r; }));
        const foto = await registrarBlob({ imageId: fotoId, blob: blob(), atlasId: scope.atlasId, origem: 'foto-anexa' });
        const envioDaFoto = enviarBlobRegistrado(foto, blob());

        const outra = enfileirarBlob({ imageId: crypto.randomUUID(), blob: blob(), atlasId: scope.atlasId, origem: 'foto-anexa' });
        const venceu = await Promise.race([
            outra.then(() => 'outra'),
            new Promise((r) => setTimeout(() => r('esperou a foto'), 300)),
        ]);

        soltarFoto();
        await Promise.all([envioDaFoto, outra]);
        expect(venceu).toBe('esperou a foto');
    });
});
