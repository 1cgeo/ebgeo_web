// Path: tests/integration/retomadas-sobrepostas-sobem-uma-vez.repro.test.js
//
// DUAS RETOMADAS AO MESMO TEMPO SOBEM A MESMA FOTO UMA VEZ SÓ, E UM REGISTRO CONFIRMADO NÃO VOLTA A
// PENDENTE (terceira revisão das fotos anexas, 2026-09-25, item 2).
//
// O DEFEITO. Todo `connect` dispara duas retomadas (`image-sync.js`: a troca de atlas e a volta a
// ONLINE), e o temporizador de 15 s pode disparar uma terceira. A retomada punha o id na linha única de
// transferência (`emSerie`) sem marcá-lo como NA FILA, então, com outra transferência no fio, a segunda
// retomada não o via e o enfileirava de novo: os mesmos bytes duas vezes num link lento. E o veredito
// da duplicata era escrito sobre o registro lido ANTES da espera, de modo que uma duplicata que falhasse
// depois de a primeira confirmar gravava PENDENTE por cima de CONFIRMADO, e as edições que citam a foto
// voltavam a ficar presas até a próxima retomada.
//
// Mesmo arnês de `op-espera-a-foto.repro.test.js`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { activateScope, getActiveScope, remoteScope, StoreName, getStoreFor } from '@store/atlas-namespace.js';
import { BLOB_UPLOAD_KEY_PREFIX } from '@store/sync/blob-upload-keys.js';

const h = vi.hoisted(() => ({ resposta: null, segurar: null, noFio: [] }));

vi.mock('@js/import_export/atlas-image-upload.js', () => ({
    buildImageUploads: async (pares) => ({
        uploads: pares.map(([id]) => ({ localId: id, filename: `${id}.jpg`, mimeType: 'image/jpeg', data: 'ZmFsc28=' })),
        skipped: [],
    }),
    uploadImagesInChunks: async (_apiClient, atlasId, uploads) => {
        h.noFio.push(...uploads.map(u => u.localId));
        if (h.segurar) await h.segurar;
        return h.resposta(atlasId, uploads);
    },
}));

import {
    registrarBlob, enviarBlobRegistrado, retomarBlobsPendentes, esquecerPendenciasEmMemoria, listarPendenciasDeBlob,
} from '@store/sync/blob-upload-queue.js';

const aceita = () => (_a, uploads) => ({ mapping: Object.fromEntries(uploads.map(u => [u.localId, u.localId])), failed: [], transportErrors: 0 });
const blob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });

/** Uma pendência deixada por uma sessão anterior: o registro PENDENTE e os bytes no disco. */
async function pendenciaAntiga(scope, imageId) {
    const imagens = getStoreFor(StoreName.IMAGES, scope);
    await imagens.setItem(imageId, blob());
    await imagens.setItem(`${BLOB_UPLOAD_KEY_PREFIX}t-${imageId}`, {
        tentativaId: `t-${imageId}`, imageId, atlasId: scope.atlasId, origem: 'foto-anexa',
        estado: 'pendente', tentativas: 0, criadoEm: Date.now(), atualizadoEm: Date.now(),
    });
}

beforeEach(() => {
    const memoria = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (k) => memoria.get(k) ?? null, setItem: (k, v) => memoria.set(k, String(v)), removeItem: (k) => memoria.delete(k),
    });
    h.resposta = aceita();
    h.segurar = null;
    h.noFio = [];
    esquecerPendenciasEmMemoria();
    activateScope(remoteScope(crypto.randomUUID()));
});

describe('retomadas sobrepostas', () => {
    it('REPRO: com outra foto no fio, duas retomadas mandam a pendência antiga UMA vez', async () => {
        const scope = getActiveScope();
        const antiga = crypto.randomUUID();
        await pendenciaAntiga(scope, antiga);

        // Uma foto recém-anexada ocupa a linha única, como logo depois de reconectar.
        let soltar;
        h.segurar = new Promise((r) => { soltar = r; });
        const nova = await registrarBlob({ imageId: crypto.randomUUID(), blob: blob(), atlasId: scope.atlasId, origem: 'foto-anexa' });
        const envio = enviarBlobRegistrado(nova, blob());

        // As duas retomadas do `connect`, ao mesmo tempo.
        const r1 = retomarBlobsPendentes(scope.atlasId);
        const r2 = retomarBlobsPendentes(scope.atlasId);
        await new Promise((r) => setTimeout(r, 20));
        h.segurar = null;
        soltar();
        await Promise.all([envio, r1, r2]);

        expect(h.noFio.filter(id => id === antiga), 'os bytes da pendência antiga foram ao fio uma vez').toHaveLength(1);
        const registro = (await listarPendenciasDeBlob()).find(r => r.imageId === antiga);
        expect(registro?.estado).toBe('confirmado');
    });

    it('REPRO: uma tentativa que falha depois de outra confirmar não rebaixa o registro a PENDENTE', async () => {
        const scope = getActiveScope();
        const antiga = crypto.randomUUID();
        await pendenciaAntiga(scope, antiga);

        // A primeira tentativa da pendência antiga confirma; uma segunda, se chegar ao fio, recebe uma
        // falha de rede. A foto nova é sempre aceita.
        let tentativasDaAntiga = 0;
        h.resposta = (a, uploads) => {
            if (!uploads.some(u => u.localId === antiga)) return aceita()(a, uploads);
            tentativasDaAntiga += 1;
            return tentativasDaAntiga === 1
                ? aceita()(a, uploads)
                : { mapping: {}, failed: uploads.map(u => ({ localId: u.localId, error: 'Failed to fetch' })), transportErrors: 1 };
        };
        let soltar;
        h.segurar = new Promise((r) => { soltar = r; });
        const nova = await registrarBlob({ imageId: crypto.randomUUID(), blob: blob(), atlasId: scope.atlasId, origem: 'foto-anexa' });
        const envio = enviarBlobRegistrado(nova, blob());
        const r1 = retomarBlobsPendentes(scope.atlasId);
        const r2 = retomarBlobsPendentes(scope.atlasId);
        await new Promise((r) => setTimeout(r, 20));
        h.segurar = null;
        soltar();
        await Promise.all([envio, r1, r2]);

        const registro = (await listarPendenciasDeBlob()).find(r => r.imageId === antiga);
        expect(registro?.estado, 'o registro confirmado continua confirmado').toBe('confirmado');
    });
});
