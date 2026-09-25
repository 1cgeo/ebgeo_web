// Path: tests/integration/recusa-de-foto-convertida-no-atlas-certo.repro.test.js
//
// A RECUSA DE UMA FOTO CONVERTIDA PRENDE A EDIÇÃO NO ATLAS DA FOTO, E TAMBÉM A QUE NASCE DEPOIS
// (terceira revisão das fotos anexas, 2026-09-25, item 1).
//
// O DEFEITO. Quando o servidor recusa de vez os bytes de uma foto que uma edição CONVERTEU (inline
// para referência), a edição não pode sair: o servidor ainda guarda a foto inline, e a op trocaria a
// cópia dele por uma referência a bytes que ele recusou. `assentar` recebia o escopo do registro, mas
// `marcarProblema` e `liberarOperacoes` usavam a fila SINGLETON, que resolve o atlas ATIVO. Com a
// subida demorando (minutos a 40 kbps) e a pessoa trocando de atlas no meio, a recusa procurava as ops
// na fila do OUTRO atlas, não marcava nada, e a edição ficava preparada na fila certa até o retrato
// seguinte soltá-la. E uma op nascida DEPOIS da recusa, citando a mesma foto (uma cópia colada da
// feição), só era conferida contra a recusa quando ela mesma era uma feição de imagem.
//
// Mesmo arnês de `op-espera-a-foto.repro.test.js`: IndexedDB de verdade (`fake-indexeddb`), a fila
// REAL, o transporte dublado acima de `buildImageUploads`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { activateScope, getActiveScope, remoteScope } from '@store/atlas-namespace.js';
import { operationQueue } from '@store/sync/operation-queue.js';
import { enableOperationLogging, persistOperationIntents } from '@store/sync/operation-dispatcher.js';
import { EntityType, OperationType } from '@store/sync/operation-types.js';

const h = vi.hoisted(() => ({ resposta: null, segurar: null }));

vi.mock('@js/import_export/atlas-image-upload.js', () => ({
    buildImageUploads: async (pares) => ({
        uploads: pares.map(([id]) => ({ localId: id, filename: `${id}.jpg`, mimeType: 'image/jpeg', data: 'ZmFsc28=' })),
        skipped: [],
    }),
    uploadImagesInChunks: async (_apiClient, atlasId, uploads) => {
        if (h.segurar) await h.segurar;
        return h.resposta(atlasId, uploads);
    },
}));

import { registrarBlob, enviarBlobRegistrado, esquecerPendenciasEmMemoria } from '@store/sync/blob-upload-queue.js';

const recusa = () => (_a, uploads) => ({ mapping: {}, failed: uploads.map(u => ({ localId: u.localId, error: 'Invalid file type', permanent: true })), transportErrors: 0 });
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

beforeEach(() => {
    const memoria = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (k) => memoria.get(k) ?? null, setItem: (k, v) => memoria.set(k, String(v)), removeItem: (k) => memoria.delete(k),
    });
    h.resposta = recusa();
    h.segurar = null;
    esquecerPendenciasEmMemoria();
    activateScope(remoteScope(crypto.randomUUID()));
    enableOperationLogging();
});

describe('a recusa de uma foto convertida', () => {
    it('REPRO: chegando com OUTRO atlas aberto, vira problema na fila do atlas da foto', async () => {
        const atlasDaFoto = getActiveScope();
        const p = crypto.randomUUID();
        const registrado = await registrarBlob({ imageId: p, blob: blob(), atlasId: atlasDaFoto.atlasId, origem: 'foto-convertida' });
        const feicao = await editarFeicao(atlasDaFoto, [foto(p)]);

        // A subida fica no fio, e a pessoa abre outro atlas antes de o servidor responder.
        let soltar;
        h.segurar = new Promise((r) => { soltar = r; });
        const envio = enviarBlobRegistrado(registrado, blob());
        activateScope(remoteScope(crypto.randomUUID()));
        soltar();
        await envio;

        const filaDaFoto = operationQueue.forScope(atlasDaFoto);
        expect((await filaDaFoto.countByState()).problemas, 'a edição virou problema na fila do atlas da foto').toBe(1);
        expect((await filaDaFoto.peek(50)).map(op => op.entityId)).not.toContain(feicao);
    });

    it('REPRO: a op que nasce DEPOIS da recusa e cita a foto vira problema ao nascer, e não sai', async () => {
        const scope = getActiveScope();
        const p = crypto.randomUUID();
        const registrado = await registrarBlob({ imageId: p, blob: blob(), atlasId: scope.atlasId, origem: 'foto-convertida' });
        await enviarBlobRegistrado(registrado, blob());

        // Uma cópia colada da feição, nascida depois da recusa, com a mesma foto.
        const copia = await editarFeicao(scope, [foto(p)]);

        expect(await (async () => (await operationQueue.peek(50)).map(op => op.entityId))()).not.toContain(copia);
        expect((await operationQueue.countByState()).problemas).toBe(1);
    });

    it('CONTROLE: a foto ANEXADA recusada não prende a op nascida depois (ela sai com a referência)', async () => {
        const scope = getActiveScope();
        const p = crypto.randomUUID();
        const registrado = await registrarBlob({ imageId: p, blob: blob(), atlasId: scope.atlasId, origem: 'foto-anexa' });
        await enviarBlobRegistrado(registrado, blob());

        const outra = await editarFeicao(scope, [foto(p)]);

        expect((await operationQueue.peek(50)).map(op => op.entityId)).toContain(outra);
        expect((await operationQueue.countByState()).problemas).toBe(0);
    });
});
