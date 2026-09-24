// Path: tests/integration/op-espera-a-foto.repro.test.js
//
// A OP QUE CITA UMA FOTO ESPERA OS BYTES DELA (revisão das fases 2b e 2c, 2026-09-24, item 1).
//
// O DEFEITO. O despachante só segurava a op cujo `entityId` tinha blob pendente, que é a feição de
// IMAGEM (ela É o blob). A foto anexa tem id próprio, citado em `properties.images` da feição ou em
// `images` do item 3D/360, e a op da entidade saía na hora. Num link de 40 kbps, renomear uma feição
// com foto inline de 1 MB (a próxima edição converte a foto) mandava a op em um segundo e a foto em
// minutos; o "Sair" contava zero pendências e não perguntava nada, o namespace e os bytes morriam, e
// o servidor ficava com uma referência para uma foto que ninguém ia mandar. O mesmo na queda
// involuntária sem resgate, e na 2b com a foto recém-anexada.
//
// A REGRA NOVA é a da feição de imagem, estendida aos ids de foto que a entidade cita: a op nasce
// PREPARADA e só sai quando TODAS as fotos que ela cita forem confirmadas. A foto RECUSADA não segura
// (a edição sai com a referência, e o aviso já nomeou a foto). E o censo de saída conta as subidas
// pendentes como trabalho não enviado.
//
// Mesmo arnês de `blob-upload-queue.test.js`: IndexedDB de verdade (`fake-indexeddb`), a fila REAL,
// o transporte dublado acima de `buildImageUploads` (que usa `FileReader`, ausente em node).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { activateScope, getActiveScope, remoteScope } from '@store/atlas-namespace.js';
import { operationQueue } from '@store/sync/operation-queue.js';
import { enableOperationLogging, persistOperationIntents } from '@store/sync/operation-dispatcher.js';
import { EntityType, OperationType } from '@store/sync/operation-types.js';

const h = vi.hoisted(() => ({ resposta: null, noFio: 0, maximoNoFio: 0, segurar: null }));

vi.mock('@js/import_export/atlas-image-upload.js', () => ({
    buildImageUploads: async (pares) => ({
        uploads: pares.map(([id]) => ({ localId: id, filename: `${id}.jpg`, mimeType: 'image/jpeg', data: 'ZmFsc28=' })),
        skipped: [],
    }),
    uploadImagesInChunks: async (_apiClient, atlasId, uploads) => {
        h.noFio += 1;
        h.maximoNoFio = Math.max(h.maximoNoFio, h.noFio);
        try {
            if (h.segurar) await h.segurar;
            return h.resposta(atlasId, uploads);
        } finally {
            h.noFio -= 1;
        }
    },
}));

import {
    registrarBlob,
    enviarBlobRegistrado,
    esquecerPendenciasEmMemoria,
} from '@store/sync/blob-upload-queue.js';
import { countPendingOperationsFor } from '@js/session/unsynced-work-exit.js';

const aceita = () => (_a, uploads) => ({ mapping: Object.fromEntries(uploads.map(u => [u.localId, u.localId])), failed: [], transportErrors: 0 });
const recusa = () => (_a, uploads) => ({ mapping: {}, failed: uploads.map(u => ({ localId: u.localId, error: 'Invalid file type', permanent: true })), transportErrors: 0 });
/** O servidor respondeu e NÃO conseguiu gravar (disco, banco): `permanent: false`. */
const falhaDoServidor = () => (_a, uploads) => ({ mapping: {}, failed: uploads.map(u => ({ localId: u.localId, error: 'Unknown error', permanent: false })), transportErrors: 0 });
const blob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
const foto = (id) => ({ id, name: `${id}.jpg`, type: 'image/jpeg', thumbnail: 'data:image/jpeg;base64,/9j/' });

/** Registra, pela porta real do despachante, a edição de uma feição que cita estas fotos. */
async function editarFeicao(scope, fotos, entityId = crypto.randomUUID()) {
    const materializar = await persistOperationIntents([{
        entityType: EntityType.FEATURE, operationType: OperationType.UPDATE, entityId, mapId: scope.atlasId,
        data: { type: 'Feature', properties: { id: entityId, source: 'point', nome: 'Renomeada', images: fotos } },
        previousData: null,
    }], { scope, traceId: 'traco' });
    if (materializar) await materializar();
    return entityId;
}

const prontas = async () => (await operationQueue.peek(50)).map(op => op.entityId);

beforeEach(() => {
    const memoria = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (k) => memoria.get(k) ?? null, setItem: (k, v) => memoria.set(k, String(v)), removeItem: (k) => memoria.delete(k),
    });
    h.resposta = aceita();
    h.noFio = 0;
    h.maximoNoFio = 0;
    h.segurar = null;
    esquecerPendenciasEmMemoria();
    activateScope(remoteScope(crypto.randomUUID()));
    enableOperationLogging();
});

describe('a op que cita uma foto pendente espera os bytes', () => {
    it('REPRO: a edição que cita uma foto registrada e não enviada nasce PREPARADA', async () => {
        const scope = getActiveScope();
        const p = crypto.randomUUID();
        await registrarBlob({ imageId: p, blob: blob(), atlasId: scope.atlasId });
        const feicao = await editarFeicao(scope, [foto(p)]);
        expect(await prontas()).not.toContain(feicao);
        expect((await operationQueue.countByState()).preparadas).toBe(1);
    });

    it('a confirmação da foto libera a op', async () => {
        const scope = getActiveScope();
        const p = crypto.randomUUID();
        const registrado = await registrarBlob({ imageId: p, blob: blob(), atlasId: scope.atlasId });
        const feicao = await editarFeicao(scope, [foto(p)]);
        await enviarBlobRegistrado(registrado, blob());
        expect(await prontas()).toContain(feicao);
    });

    it('duas fotos: a op sai quando a SEGUNDA confirma, nunca no meio', async () => {
        const scope = getActiveScope();
        const [p1, p2] = [crypto.randomUUID(), crypto.randomUUID()];
        const r1 = await registrarBlob({ imageId: p1, blob: blob(), atlasId: scope.atlasId });
        const r2 = await registrarBlob({ imageId: p2, blob: blob(), atlasId: scope.atlasId });
        const feicao = await editarFeicao(scope, [foto(p1), foto(p2)]);
        await enviarBlobRegistrado(r1, blob());
        expect(await prontas()).not.toContain(feicao);
        await enviarBlobRegistrado(r2, blob());
        expect(await prontas()).toContain(feicao);
    });

    it('a foto RECUSADA não segura: a edição sai com a referência, sem virar problema', async () => {
        const scope = getActiveScope();
        const p = crypto.randomUUID();
        h.resposta = recusa();
        const registrado = await registrarBlob({ imageId: p, blob: blob(), atlasId: scope.atlasId });
        const feicao = await editarFeicao(scope, [foto(p)]);
        await enviarBlobRegistrado(registrado, blob());
        expect(await prontas()).toContain(feicao);
        expect((await operationQueue.countByState()).problemas).toBe(0);
    });

    it('o item 3D que cita a foto também espera', async () => {
        const scope = getActiveScope();
        const p = crypto.randomUUID();
        await registrarBlob({ imageId: p, blob: blob(), atlasId: scope.atlasId });
        const marcador = crypto.randomUUID();
        const materializar = await persistOperationIntents([{
            entityType: EntityType.MARKER_3D, operationType: OperationType.UPDATE, entityId: marcador, mapId: scope.atlasId,
            data: { id: marcador, tilesetId: 't1', images: [foto(p)] }, previousData: null,
        }], { scope, traceId: 'traco-3d' });
        if (materializar) await materializar();
        expect(await prontas()).not.toContain(marcador);
    });

    it('CONTROLE: a foto já confirmada (sem pendência) não segura nada', async () => {
        const scope = getActiveScope();
        const feicao = await editarFeicao(scope, [foto(crypto.randomUUID())]);
        expect(await prontas()).toContain(feicao);
    });
});

// A RECUSA DE UMA FOTO CONVERTIDA NÃO PODE LIBERAR A OP (revisão, 2026-09-24, item 1). O servidor
// ainda tem os bytes da foto INLINE na entidade; a op que os trocaria pela referência é justamente o
// que não pode sair. E uma falha por item que não seja de validação (disco cheio, erro de banco) é
// TRANSITÓRIA: antes ela fechava a foto de vez, e a conversão perdia a única cópia no servidor.
describe('a recusa e a falha do servidor numa foto CONVERTIDA', () => {
    it('recusa de foto convertida vira PROBLEMA nas ops que a citam, e nada sai', async () => {
        const scope = getActiveScope();
        const p = crypto.randomUUID();
        h.resposta = recusa();
        const registrado = await registrarBlob({ imageId: p, blob: blob(), atlasId: scope.atlasId, origem: 'foto-convertida' });
        const feicao = await editarFeicao(scope, [foto(p)]);
        await enviarBlobRegistrado(registrado, blob());
        expect(await prontas()).not.toContain(feicao);
        expect((await operationQueue.countByState()).problemas).toBe(1);
    });

    it('falha do servidor que não é validação fica PENDENTE e a op continua esperando', async () => {
        const scope = getActiveScope();
        const p = crypto.randomUUID();
        h.resposta = falhaDoServidor();
        const registrado = await registrarBlob({ imageId: p, blob: blob(), atlasId: scope.atlasId, origem: 'foto-convertida' });
        const feicao = await editarFeicao(scope, [foto(p)]);
        const final = await enviarBlobRegistrado(registrado, blob());
        expect(final.estado).toBe('pendente');
        expect(await prontas()).not.toContain(feicao);
        expect((await operationQueue.countByState()).problemas).toBe(0);
    });

    it('a foto ANEXADA aqui e recusada (a única cópia) conta como trabalho não enviado', async () => {
        const scope = getActiveScope();
        h.resposta = recusa();
        const registrado = await registrarBlob({ imageId: crypto.randomUUID(), blob: blob(), atlasId: scope.atlasId, origem: 'foto-anexa' });
        await enviarBlobRegistrado(registrado, blob());
        expect(await countPendingOperationsFor(scope.atlasId)).toBe(1);
    });
});

describe('uma subida por vez, e o censo de saída conta a que falta', () => {
    it('duas fotos mandadas em seguida vão ao fio UMA de cada vez', async () => {
        const scope = getActiveScope();
        const r1 = await registrarBlob({ imageId: crypto.randomUUID(), blob: blob(), atlasId: scope.atlasId });
        const r2 = await registrarBlob({ imageId: crypto.randomUUID(), blob: blob(), atlasId: scope.atlasId });
        let soltar;
        h.segurar = new Promise((resolve) => { soltar = resolve; });
        const primeiro = enviarBlobRegistrado(r1, blob());
        // A primeira está NO FIO (o carregador dinâmico da subida já resolveu) quando a segunda sai;
        // ela tem tempo de sobra para chegar ao fio também, se nada a segurar na fila.
        await vi.waitFor(() => expect(h.noFio).toBe(1));
        const segundo = enviarBlobRegistrado(r2, blob());
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(h.maximoNoFio).toBe(1);
        soltar();
        await Promise.all([primeiro, segundo]);
        expect(h.maximoNoFio).toBe(1);
    });

    it('a subida PENDENTE conta como trabalho não enviado do atlas, mesmo sem op nenhuma', async () => {
        const scope = getActiveScope();
        expect(await countPendingOperationsFor(scope.atlasId)).toBe(0);
        await registrarBlob({ imageId: crypto.randomUUID(), blob: blob(), atlasId: scope.atlasId });
        expect(await countPendingOperationsFor(scope.atlasId)).toBe(1);
    });
});
