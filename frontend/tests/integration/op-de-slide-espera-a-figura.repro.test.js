// Path: tests/integration/op-de-slide-espera-a-figura.repro.test.js
//
// A OP DO SLIDE QUE CITA UMA FIGURA ESPERA OS BYTES DELA (figura de slide por referência, decisão do
// dono de 2026-09-26).
//
// O DEFEITO QUE A REFERÊNCIA TROCA. A figura morava dentro do HTML do slide como data URL, então todo
// autosave do slide (três palavras ao lado dela) reenviava a figura inteira, e num link de 40 kbps o
// colega esperava minutos pelo texto. A figura agora sobe UMA vez pela fila de blob, e o HTML leva só
// o sentinela `https://figura.ebgeo/<id>`. O risco que a troca cria é o da foto anexa: a op do slide
// sai em um segundo e os bytes levam minutos, e o colega recebe uma referência para bytes que o
// servidor não tem. A regra é a mesma da foto (`op-espera-a-foto.repro.test.js`): a op nasce
// PREPARADA e só sai quando a figura for confirmada.
//
// As três formas que citam uma figura: a op de SLIDE (o slide, com `content`), a de BRIEFING (o
// documento inteiro, com `slides[].content`) e a de NOTAS DO MAPA (`description`, onde uma figura de
// slide pode ser colada).
//
// Mesmo arnês de `op-espera-a-foto.repro.test.js`: IndexedDB de verdade, a fila REAL, o transporte
// dublado acima de `buildImageUploads` (que usa `FileReader`, ausente em node).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { activateScope, getActiveScope, remoteScope } from '@store/atlas-namespace.js';
import { operationQueue } from '@store/sync/operation-queue.js';
import { enableOperationLogging, persistOperationIntents } from '@store/sync/operation-dispatcher.js';
import { EntityType, OperationType } from '@store/sync/operation-types.js';
import { srcDaFigura } from '@js/briefing/figura-de-slide.js';

const h = vi.hoisted(() => ({ resposta: null }));

vi.mock('@js/import_export/atlas-image-upload.js', () => ({
    buildImageUploads: async (pares) => ({
        uploads: pares.map(([id]) => ({ localId: id, filename: `${id}.jpg`, mimeType: 'image/jpeg', data: 'ZmFsc28=' })),
        skipped: [],
    }),
    uploadImagesInChunks: async (_apiClient, atlasId, uploads) => h.resposta(atlasId, uploads),
}));

import {
    registrarBlob,
    enviarBlobRegistrado,
    esquecerPendenciasEmMemoria,
} from '@store/sync/blob-upload-queue.js';

const aceita = () => (_a, uploads) => ({ mapping: Object.fromEntries(uploads.map(u => [u.localId, u.localId])), failed: [], transportErrors: 0 });
const blob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
const comFigura = (id) => `<p>legenda</p><p><img src="${srcDaFigura(id)}" width="320"></p>`;

/** Registra, pela porta real do despachante, uma op com estes dados. */
async function registrarOp(scope, entityType, data, entityId = crypto.randomUUID()) {
    const materializar = await persistOperationIntents([{
        entityType, operationType: OperationType.UPDATE, entityId, mapId: scope.atlasId, data, previousData: null,
    }], { scope, traceId: `traco-${entityType}` });
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
    esquecerPendenciasEmMemoria();
    activateScope(remoteScope(crypto.randomUUID()));
    enableOperationLogging();
});

describe('a op que cita uma figura de slide pendente espera os bytes', () => {
    it('REPRO: a op de SLIDE que cita uma figura registrada e não enviada nasce PREPARADA', async () => {
        const scope = getActiveScope();
        const figura = crypto.randomUUID();
        await registrarBlob({ imageId: figura, blob: blob(), atlasId: scope.atlasId, origem: 'figura-de-slide' });
        const slide = await registrarOp(scope, EntityType.SLIDE, { id: 's1', title: 'Um', content: comFigura(figura) });
        expect(await prontas()).not.toContain(slide);
        expect((await operationQueue.countByState()).preparadas).toBe(1);
    });

    it('a confirmação da figura libera a op do slide', async () => {
        const scope = getActiveScope();
        const figura = crypto.randomUUID();
        const registrado = await registrarBlob({ imageId: figura, blob: blob(), atlasId: scope.atlasId, origem: 'figura-de-slide' });
        const slide = await registrarOp(scope, EntityType.SLIDE, { id: 's1', title: 'Um', content: comFigura(figura) });
        await enviarBlobRegistrado(registrado, blob());
        expect(await prontas()).toContain(slide);
    });

    it('a op de BRIEFING (o documento com todos os slides) também espera', async () => {
        const scope = getActiveScope();
        const figura = crypto.randomUUID();
        await registrarBlob({ imageId: figura, blob: blob(), atlasId: scope.atlasId, origem: 'figura-de-slide' });
        const briefing = await registrarOp(scope, EntityType.BRIEFING, {
            id: 'b1', slides: [{ id: 's0', content: '<p>sem figura</p>' }, { id: 's1', content: comFigura(figura) }],
        });
        expect(await prontas()).not.toContain(briefing);
    });

    it('as NOTAS DO MAPA com uma figura de slide colada também esperam', async () => {
        const scope = getActiveScope();
        const figura = crypto.randomUUID();
        await registrarBlob({ imageId: figura, blob: blob(), atlasId: scope.atlasId, origem: 'figura-de-slide' });
        const notas = await registrarOp(scope, EntityType.MAP_NOTES, { title: 'Notas', description: comFigura(figura) });
        expect(await prontas()).not.toContain(notas);
    });

    it('CONTROLE: a figura inline antiga (data URL) e a figura já confirmada não seguram nada', async () => {
        const scope = getActiveScope();
        const inline = await registrarOp(scope, EntityType.SLIDE, {
            id: 's1', content: '<p><img src="data:image/jpeg;base64,/9j/4AAQ"></p>',
        });
        const confirmada = await registrarOp(scope, EntityType.SLIDE, { id: 's2', content: comFigura(crypto.randomUUID()) });
        const lista = await prontas();
        expect(lista).toContain(inline);
        expect(lista).toContain(confirmada);
    });
});
