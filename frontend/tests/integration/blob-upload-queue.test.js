// Path: tests/integration/blob-upload-queue.test.js
//
// B8/F6, metade do cliente: o blob de imagem viaja por porta PRÓPRIA (não existe op de bytes), e
// até esta fila existir a falha dessa porta era invisível. O upload avisava uma vez, o chamador caía
// para um id só-local e nada retentava: o autor via a figura e todo colaborador recebia 404 para
// sempre.
//
// O QUE ESTE ARQUIVO MEDE, e por que contra IndexedDB de verdade (`fake-indexeddb`) e com a
// `operationQueue` REAL: as quatro propriedades do desenho são todas sobre ORDEM e DURABILIDADE, e
// um duplo de fila responderia "fui chamado" sem dizer quando nem se ficou gravado.
//
//   1. o registro vai ao disco ANTES do primeiro byte sair;
//   2. falha transitória deixa a pendência PENDENTE, e a op da feição não sai no `peek`;
//   3. a retomada envia sob o MESMO id (é o que faz o servidor reconhecer a retentativa);
//   4. recusa definitiva vira problema durável, e confirmação libera a op.
//
// O TRANSPORTE É DUBLADO no arquivo de upload em lote, não no cliente HTTP, por um motivo medido:
// `buildImageUploads` usa `FileReader`, que não existe em node, então o duplo tem de ficar acima
// dele. O que se mede aqui é a fila; que a rota bulk preserve o `localId` é cobrado no backend
// (tests/integration/imagens-idempotentes.repro.test.js).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
    activateScope,
    getActiveScope,
    remoteScope,
    localScope,
    StoreName,
    getStoreFor
} from '@store/atlas-namespace.js';
import { operationQueue } from '@store/sync/operation-queue.js';
import { enableOperationLogging, persistOperationIntents } from '@store/sync/operation-dispatcher.js';
import { EntityType, OperationType } from '@store/sync/operation-types.js';
import { BLOB_UPLOAD_KEY_PREFIX } from '@store/sync/blob-upload-keys.js';

const h = vi.hoisted(() => ({
    enviados: [],
    resposta: null
}));

// Duplo do lote de upload: `buildImageUploads` converteria o blob em base64 por `FileReader`, que
// não existe em node. Ele registra o que FOI PEDIDO, porque a asserção central da retomada é que o
// id enviado seja o mesmo das tentativas anteriores.
vi.mock('@js/import_export/atlas-image-upload.js', () => ({
    buildImageUploads: async (pares) => {
        const uploads = [];
        for (const [id, blob] of pares) {
            uploads.push({ localId: id, filename: `${id}.png`, mimeType: blob?.type || 'image/png', data: 'ZmFsc28=' });
        }
        return { uploads, skipped: [] };
    },
    uploadImagesInChunks: async (_apiClient, atlasId, uploads) => {
        h.enviados.push({ atlasId, ids: uploads.map(u => u.localId) });
        return h.resposta(atlasId, uploads);
    }
}));

import {
    enfileirarBlob,
    retomarBlobsPendentes,
    listarPendenciasDeBlob,
    blobUploadPending,
    esquecerPendenciasEmMemoria,
    BlobUploadState
} from '@store/sync/blob-upload-queue.js';

/** Desfecho "o servidor aceitou". */
const aceita = () => (_atlasId, uploads) => ({
    mapping: Object.fromEntries(uploads.map(u => [u.localId, u.localId])),
    failed: [],
    transportErrors: 0
});

/** Desfecho "a rede caiu": é o que `uploadImagesInChunks` produz num chunk sem resposta. */
const redeCaiu = () => (_atlasId, uploads) => ({
    mapping: {},
    failed: uploads.map(u => ({ localId: u.localId, error: 'Failed to fetch' })),
    transportErrors: 1
});

/** Desfecho "o servidor recusou este item": 201 com o item em `failed`, sem erro de transporte. */
const recusa = (motivo = 'Invalid file type: image/gif') => (_atlasId, uploads) => ({
    mapping: {},
    failed: uploads.map(u => ({ localId: u.localId, error: motivo })),
    transportErrors: 0
});

const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

/** Registra a intenção de uma feição de imagem pela porta real do despachante. */
async function registrarOpDaFeicao(imageId, scope) {
    const materializar = await persistOperationIntents([{
        entityType: EntityType.FEATURE,
        operationType: OperationType.CREATE,
        entityId: imageId,
        mapId: scope.atlasId,
        data: { properties: { id: imageId } },
        previousData: null
    }], { scope, traceId: 'traco-1' });
    // É o `materialize` que limparia a marca de preparo: rodá-lo é justamente o que a fila de blobs
    // precisa ver sendo RECUSADO para o id cujo blob não chegou.
    if (materializar) await materializar();
}

beforeEach(async () => {
    const storage = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key)
    });
    h.enviados.length = 0;
    h.resposta = aceita();
    esquecerPendenciasEmMemoria();
    activateScope(remoteScope(crypto.randomUUID()));
    enableOperationLogging();
});

describe('fila durável de blobs: registro, retomada e liberação', () => {
    it('o registro vai ao DISCO antes de o transporte ser chamado', async () => {
        const scope = getActiveScope();
        const imageId = crypto.randomUUID();
        let noDiscoQuandoEnviou = null;
        const registros = [];
        const lojaDeImagens = getStoreFor(StoreName.IMAGES, scope);

        // A LEITURA ACONTECE DENTRO DO TRANSPORTE, e é o único instante em que "antes" e "depois"
        // são distinguíveis: conferir o disco depois da chamada não prova ordem nenhuma.
        h.resposta = (atlasId, uploads) => {
            noDiscoQuandoEnviou = lojaDeImagens.keys().then(chaves => {
                registros.push(chaves.filter(k => k.startsWith(BLOB_UPLOAD_KEY_PREFIX)).length);
            });
            return aceita()(atlasId, uploads);
        };

        await enfileirarBlob({ imageId, blob: blob(), atlasId: scope.atlasId });
        await noDiscoQuandoEnviou;

        expect(registros).toEqual([1]);
        const finais = await listarPendenciasDeBlob();
        expect(finais).toHaveLength(1);
        expect(finais[0].estado).toBe(BlobUploadState.CONFIRMADO);
        expect(finais[0].imageId).toBe(imageId);
        expect(finais[0].tentativas).toBe(1);
    });

    it('atlas LOCAL não registra nem envia nada', async () => {
        activateScope(localScope('slot-local-1', 'slot1'));
        const resultado = await enfileirarBlob({
            imageId: crypto.randomUUID(), blob: blob(), atlasId: 'atlas-qualquer'
        });
        expect(resultado).toEqual({ registrado: false, confirmado: false, estado: null, motivo: '' });
        expect(h.enviados).toEqual([]);
    });

    it('a falha de rede vira frase em pt-BR, e a mensagem crua fica só para diagnóstico', async () => {
        // O ACHADO A3, na porta em que ele nasceu: `uploadImagesInChunks` dobra o erro de transporte
        // em `failed[].error`, e aquela string é escrita pelo NAVEGADOR. Ela ia inteira para
        // `ultimoErro`, que é o campo que o painel de pendências desenha.
        const scope = getActiveScope();
        h.resposta = redeCaiu();

        await enfileirarBlob({ imageId: crypto.randomUUID(), blob: blob(), atlasId: scope.atlasId });

        const registro = (await listarPendenciasDeBlob())[0];
        expect(registro.ultimoErro).not.toContain('Failed to fetch');
        expect(registro.ultimoErro).toMatch(/retomado sozinho/i);
        // E o cru não se perde: ele é o que responde "o que exatamente aconteceu" depois.
        expect(registro.ultimoErroCru).toBe('Failed to fetch');
    });

    it('a recusa do servidor mantém o motivo DELE dentro da frase em pt-BR', async () => {
        const scope = getActiveScope();
        h.resposta = recusa('Invalid file type: image/gif');

        await enfileirarBlob({ imageId: crypto.randomUUID(), blob: blob(), atlasId: scope.atlasId });

        const registro = (await listarPendenciasDeBlob())[0];
        expect(registro.estado).toBe(BlobUploadState.RECUSADO);
        // A DISTINÇÃO É O PONTO: a recusa é a única classe em que a mensagem crua é a coisa que diz
        // à pessoa o que mudar na figura, então ela é citada, e não escondida como a de rede.
        expect(registro.ultimoErro).toContain('Invalid file type: image/gif');
        expect(registro.ultimoErro).toMatch(/O servidor recusou/);
        expect(registro.ultimoErroCru).toBe('Invalid file type: image/gif');
    });

    it('falha transitória deixa PENDENTE e a op da feição NÃO sai no peek', async () => {
        const scope = getActiveScope();
        const imageId = crypto.randomUUID();
        h.resposta = redeCaiu();

        const resultado = await enfileirarBlob({ imageId, blob: blob(), atlasId: scope.atlasId });
        expect(resultado.registrado).toBe(true);
        expect(resultado.confirmado).toBe(false);
        expect(resultado.estado).toBe(BlobUploadState.PENDENTE);
        expect(blobUploadPending(imageId)).toBe(true);

        await registrarOpDaFeicao(imageId, scope);

        // A op existe no diário e NÃO é enviável: é a marca de preparo que o despachante recusou a
        // limpar enquanto o blob não chega.
        expect(await operationQueue.getAll()).toHaveLength(1);
        expect(await operationQueue.peek()).toEqual([]);
        expect((await operationQueue.countByState()).preparadas).toBe(1);
    });

    it('CONTROLE NEGATIVO: sem a pendência, a op sai no peek antes do blob', async () => {
        // O par do caso acima, com a MESMA op e sem nada mais mudado: sem o registro do blob o
        // despachante materializa a intenção e o flush a levaria adiante da figura, que é
        // exatamente o buraco no par que a marca existe para impedir.
        const scope = getActiveScope();
        const imageId = crypto.randomUUID();

        await registrarOpDaFeicao(imageId, scope);

        expect(blobUploadPending(imageId)).toBe(false);
        expect(await operationQueue.peek()).toHaveLength(1);
    });

    it('a retomada envia sob o MESMO id e, ao confirmar, libera a op', async () => {
        const scope = getActiveScope();
        const imageId = crypto.randomUUID();
        h.resposta = redeCaiu();
        await enfileirarBlob({ imageId, blob: blob(), atlasId: scope.atlasId });
        await registrarOpDaFeicao(imageId, scope);
        expect(await operationQueue.peek()).toEqual([]);

        // O blob tem de estar no store local: é de lá que a retomada o lê.
        await getStoreFor(StoreName.IMAGES, scope).setItem(imageId, blob());

        h.resposta = aceita();
        const resumo = await retomarBlobsPendentes(scope.atlasId);

        expect(resumo).toEqual({ tentadas: 1, confirmadas: 1, pendentes: 0, recusadas: 0 });
        // A IDENTIDADE É O PONTO: as duas tentativas carregam o mesmo id, e é por ele que o
        // servidor reconhece a retentativa em vez de criar um segundo recurso.
        expect(h.enviados.map(e => e.ids)).toEqual([[imageId], [imageId]]);
        expect(blobUploadPending(imageId)).toBe(false);
        expect(await operationQueue.peek()).toHaveLength(1);
        expect((await operationQueue.countByState()).preparadas).toBe(0);
    });

    it('retomada de OUTRO atlas não toca as pendências deste', async () => {
        const scope = getActiveScope();
        h.resposta = redeCaiu();
        await enfileirarBlob({ imageId: crypto.randomUUID(), blob: blob(), atlasId: scope.atlasId });
        h.enviados.length = 0;

        const resumo = await retomarBlobsPendentes(crypto.randomUUID());
        expect(resumo).toEqual({ tentadas: 0, confirmadas: 0, pendentes: 0, recusadas: 0 });
        expect(h.enviados).toEqual([]);
    });

    it('recusa definitiva na RETOMADA marca RECUSADO e vira problema durável na op', async () => {
        // A ORDEM AQUI É A REAL, e é o que este caso mede: a primeira tentativa cai na rede (a op
        // da feição nasce depois dela e fica retida), e é na retomada que o servidor recusa de
        // vez. Uma recusa na PRIMEIRA tentativa acontece antes de a op existir, então não há o que
        // marcar: o chamador é avisado, a figura fica local e o par desenha o marcador de erro.
        const scope = getActiveScope();
        const imageId = crypto.randomUUID();
        h.resposta = redeCaiu();
        await enfileirarBlob({ imageId, blob: blob(), atlasId: scope.atlasId });
        await registrarOpDaFeicao(imageId, scope);
        await getStoreFor(StoreName.IMAGES, scope).setItem(imageId, blob());

        h.resposta = recusa('Invalid file type: image/gif');
        const resumo = await retomarBlobsPendentes(scope.atlasId);
        expect(resumo).toEqual({ tentadas: 1, confirmadas: 0, pendentes: 0, recusadas: 1 });
        expect((await listarPendenciasDeBlob())[0].estado).toBe(BlobUploadState.RECUSADO);
        // Já não é pendência: nenhuma retomada vai tentar de novo o que não muda por tentar.
        expect(blobUploadPending(imageId)).toBe(false);
        expect((await listarPendenciasDeBlob())[0].ultimoErro).toContain('Invalid file type');

        const problemas = await operationQueue.getIssues();
        expect(problemas).toHaveLength(1);
        expect(problemas[0].result.rejected).toBe(true);
        expect(problemas[0].result.reason).toContain('Invalid file type');
        // Problema NÃO é barreira: a fila segue andando para o resto do atlas, e a op marcada não
        // volta ao `peek`.
        expect(await operationQueue.peek()).toEqual([]);
    });

    it('pendência cujos bytes já não existem fecha como recusada, em vez de retentar para sempre', async () => {
        const scope = getActiveScope();
        const imageId = crypto.randomUUID();
        h.resposta = redeCaiu();
        await enfileirarBlob({ imageId, blob: blob(), atlasId: scope.atlasId });
        h.enviados.length = 0;

        // Nada gravou o blob no store local (o caminho real grava; aqui se mede a ausência).
        const resumo = await retomarBlobsPendentes(scope.atlasId);

        expect(resumo).toEqual({ tentadas: 1, confirmadas: 0, pendentes: 0, recusadas: 1 });
        expect(h.enviados).toEqual([]);
        const final = (await listarPendenciasDeBlob())[0];
        expect(final.estado).toBe(BlobUploadState.RECUSADO);
        expect(final.ultimoErro).toContain('não estão mais neste computador');
    });

    it('a pendência mora no banco de IMAGENS do escopo, sob prefixo próprio', async () => {
        // É o que faz o logout confirmado descartá-la junto com o namespace, sem uma linha de
        // limpeza em lugar nenhum: ela é destruída com os bytes que nomeia.
        const scope = getActiveScope();
        const imageId = crypto.randomUUID();
        await enfileirarBlob({ imageId, blob: blob(), atlasId: scope.atlasId });

        const chaves = await getStoreFor(StoreName.IMAGES, scope).keys();
        const pendencias = chaves.filter(k => k.startsWith(BLOB_UPLOAD_KEY_PREFIX));
        expect(pendencias).toHaveLength(1);
        // E a contagem de imagens do atlas não pode enxergá-la como figura.
        const { countAtlasContents } = await import('@store/atlas-contents.js');
        const conteudo = await countAtlasContents(scope);
        expect(conteudo.images).toBe(0);
    });
});
