// Path: tests/integration/foto-recusada-sai-com-a-foto.repro.test.js
//
// O REGISTRO DE UMA FOTO ANEXA RECUSADA SAI QUANDO A FOTO SAI DA ENTIDADE (decisão do dono de
// 2026-09-26; terceira revisão das fotos anexas, item 5).
//
// O DEFEITO. O servidor pode recusar de vez os bytes de uma foto anexada, e o registro da recusa fica
// porque este navegador passa a ter a única cópia de uma foto que a feição ainda mostra. Só que nada
// o tirava: depois de a pessoa remover a foto da feição (ou apagar a feição), toda saída da conta
// continuava perguntando por ela, e o painel de pendências a listava sem comando nenhum para tirá-la.
//
// A REGRA: citada, fica; sem citação em entidade nenhuma do atlas, sai. A citação é lida do DISCO do
// atlas, todos os mapas, porque a memória guarda um mapa por vez.
//
// Mesmo arnês de `recusa-de-foto-convertida-no-atlas-certo.repro.test.js`: IndexedDB de verdade
// (`fake-indexeddb`), a fila real, o transporte dublado acima de `buildImageUploads`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { activateScope, getActiveScope, getStoreFor, remoteScope, StoreName } from '@store/atlas-namespace.js';

vi.mock('@js/import_export/atlas-image-upload.js', () => ({
    buildImageUploads: async (pares) => ({
        uploads: pares.map(([id]) => ({ localId: id, filename: `${id}.jpg`, mimeType: 'image/jpeg', data: 'ZmFsc28=' })),
        skipped: [],
    }),
    uploadImagesInChunks: async (_apiClient, _atlasId, uploads) => ({
        mapping: {}, failed: uploads.map(u => ({ localId: u.localId, error: 'Invalid file type', permanent: true })), transportErrors: 0,
    }),
}));

import {
    registrarBlob, enviarBlobRegistrado, esquecerPendenciasEmMemoria, listarPendenciasDeBlob,
    blobUploadRefusal, BlobUploadState,
} from '@store/sync/blob-upload-queue.js';
import { countPendingOperations, countPendingOperationsFor } from '@js/session/unsynced-work-exit.js';

const blob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
const foto = (id) => ({ id, name: `${id}.jpg`, type: 'image/jpeg', thumbnail: 'data:image/jpeg;base64,/9j/' });

/** Grava no disco do atlas um mapa com uma feição que cita estas fotos (ou nenhuma). */
async function gravarMapa(scope, mapId, fotos) {
    await getStoreFor(StoreName.MAPS, scope).setItem(mapId, {
        id: mapId, name: `Mapa ${mapId.slice(0, 4)}`,
        features: { points: [{ type: 'Feature', properties: { id: `f-${mapId}`, source: 'point', images: fotos } }] },
    });
}

/** Anexa uma foto que o servidor recusa de vez, citada por uma feição do mapa dado. */
async function fotoRecusada(scope, mapId) {
    const id = crypto.randomUUID();
    await gravarMapa(scope, mapId, [foto(id)]);
    const registrado = await registrarBlob({ imageId: id, blob: blob(), atlasId: scope.atlasId, origem: 'foto-anexa' });
    await enviarBlobRegistrado(registrado, blob());
    return id;
}

const recusadas = async () => (await listarPendenciasDeBlob())
    .filter(r => r.estado === BlobUploadState.RECUSADO).map(r => r.imageId);

beforeEach(() => {
    const memoria = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (k) => memoria.get(k) ?? null, setItem: (k, v) => memoria.set(k, String(v)), removeItem: (k) => memoria.delete(k),
    });
    esquecerPendenciasEmMemoria();
    activateScope(remoteScope(crypto.randomUUID()));
});

describe('foto anexa recusada pelo servidor', () => {
    it('enquanto a feição a cita, o registro fica, conta na saída e aparece nas pendências', async () => {
        const scope = getActiveScope();
        const id = await fotoRecusada(scope, crypto.randomUUID());

        expect(await recusadas()).toEqual([id]);
        expect(await countPendingOperations()).toBe(1);
        expect(await countPendingOperationsFor(scope.atlasId)).toBe(1);
        expect(blobUploadRefusal(id)).not.toBeNull();
    });

    it('REPRO: removida a foto da feição, a saída não pergunta mais e o registro sai do disco', async () => {
        const scope = getActiveScope();
        const mapa = crypto.randomUUID();
        const id = await fotoRecusada(scope, mapa);
        await gravarMapa(scope, mapa, []);

        // A saída da conta, pelas duas portas: o atlas montado e o atlas pelo nome (atlas.html).
        expect(await countPendingOperations()).toBe(0);
        expect(await countPendingOperationsFor(scope.atlasId)).toBe(0);
        // O painel: a linha some, e o registro sai do disco e do espelho em memória.
        expect(await recusadas()).toEqual([]);
        const chaves = await getStoreFor(StoreName.IMAGES, scope).keys();
        expect(chaves.filter(k => k.startsWith('upload_pendente__'))).toEqual([]);
        expect(blobUploadRefusal(id)).toBeNull();
    });

    it('a citação vale em QUALQUER mapa do atlas, e não só no que está na memória', async () => {
        const scope = getActiveScope();
        const mapa = crypto.randomUUID();
        const id = await fotoRecusada(scope, mapa);
        // A foto sai do mapa onde nasceu e continua num OUTRO mapa (uma cópia da feição).
        await gravarMapa(scope, mapa, []);
        await gravarMapa(scope, crypto.randomUUID(), [foto(id)]);

        expect(await countPendingOperations()).toBe(1);
        expect(await recusadas()).toEqual([id]);
    });

    it('a citação de um item 3D ou 360 também segura o registro', async () => {
        const scope = getActiveScope();
        const mapa = crypto.randomUUID();
        const id = await fotoRecusada(scope, mapa);
        await gravarMapa(scope, mapa, []);
        await getStoreFor(StoreName.STREETVIEW360, scope).setItem(mapa, { markers: [{ id: 'm1', images: [foto(id)] }] });

        expect(await recusadas()).toEqual([id]);
    });
});
