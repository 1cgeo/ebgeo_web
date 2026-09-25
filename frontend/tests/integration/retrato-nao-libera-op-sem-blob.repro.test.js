// Path: tests/integration/retrato-nao-libera-op-sem-blob.repro.test.js

/**
 * @fileoverview REPRO: o retrato do servidor LIBERAVA a op de uma feição de imagem cujos bytes
 * ainda não tinham subido, e o par desenhava o placeholder de erro sob aquele id, para sempre.
 *
 * A CADEIA. `applyRemoteSnapshot` reconstrói a projeção local de toda intenção pendente (é a
 * recuperação write-ahead: o wipe de entrada apagou as entidades, e o payload da op é o que as
 * traz de volta) e, no fim, marca todas como MATERIALIZADAS. Essa marca é justamente o que segura
 * a op de uma feição de imagem enquanto o blob dela não chega ao servidor, porque não existe op de
 * bytes: uma op que chegue na frente vira 404 no par. Medido em navegador três vezes em três
 * (`frontend/tests/e2e-ui/browser-collab-imagem-retomada.spec.js`, caso do F5): o par buscava a
 * imagem cerca de 1 s ANTES de a retomada terminar, tomava 404, instalava o ícone de erro, e nunca
 * mais o trocava, porque `loadSingleImage` só adiciona imagem quando ainda não há uma sob o id.
 *
 * O CONSERTO é o MESMO filtro que `operation-dispatcher.js` já aplicava no outro caminho de
 * materialização, com uma diferença que não se adivinha: aqui a pergunta é feita ao DISCO
 * (`idsComBlobPendente`) e não ao espelho em memória, porque este bloco roda dentro do mesmo
 * `connect` que dispara a retomada e, depois de um recarregamento, o espelho ainda está vazio.
 *
 * O QUE ESTE VERDE PROVARIA SE O CÓDIGO ESTIVESSE ERRADO: o primeiro caso exige que a op continue
 * FORA do `peek` depois do retrato, e o controle negativo exige que a op SEM pendência de blob
 * passe a sair nele. Sem o segundo, "nada é liberado nunca" passaria nos dois, e a recuperação
 * write-ahead inteira (que é o que devolve o trabalho de quem recarregou) estaria desligada.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
    activateScope,
    getActiveScope,
    remoteScope,
    StoreName,
    getStoreFor
} from '@store/atlas-namespace.js';
import { operationQueue } from '@store/sync/operation-queue.js';
import { enableOperationLogging, persistOperationIntents } from '@store/sync/operation-dispatcher.js';
import { EntityType, OperationType } from '@store/sync/operation-types.js';
import { BLOB_UPLOAD_KEY_PREFIX } from '@store/sync/blob-upload-keys.js';
import { esquecerPendenciasEmMemoria } from '@store/sync/blob-upload-queue.js';
import { applyRemoteSnapshot, setRemoteHandlerEventBus } from '@store/sync/remote-operation-handler.js';

/** Barramento mudo: o retrato emite eventos de ciclo de vida e nada aqui os observa. */
const barramentoMudo = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };

/**
 * Registra a intenção de uma feição pela porta real do despachante, deixando-a PREPARADA.
 *
 * O passo de materialização é o que limparia a marca, e não chamá-lo é exatamente o estado em que
 * um recarregamento encontra a op cujo blob ficou pendente.
 * @param {string} featureId
 * @param {string} mapId - O mapa em que a feição nasce; o retrato tem de trazê-lo.
 * @param {Object} scope
 * @returns {Promise<void>}
 */
async function intencaoPreparada(featureId, mapId, scope) {
    await persistOperationIntents([{
        entityType: EntityType.FEATURE,
        operationType: OperationType.CREATE,
        entityId: featureId,
        mapId,
        data: { properties: { id: featureId, source: 'image' } },
        previousData: null
    }], { scope, traceId: `traco-${featureId}` });
}

/**
 * Grava no banco de IMAGENS a pendência que diz "o servidor ainda não tem estes bytes".
 * @param {string} imageId
 * @param {Object} scope
 * @returns {Promise<void>}
 */
async function pendenciaDeBlob(imageId, scope) {
    await getStoreFor(StoreName.IMAGES, scope).setItem(`${BLOB_UPLOAD_KEY_PREFIX}t-${imageId}`, {
        tentativaId: `t-${imageId}`,
        imageId,
        atlasId: scope.atlasId,
        estado: 'pendente',
        tentativas: 1,
        criadoEm: Date.now(),
        atualizadoEm: Date.now()
    });
}

/**
 * O retrato COMPLETO de um atlas com UM mapa vazio, que é a forma que `validateSnapshot` exige.
 *
 * O MAPA PRECISA ESTAR NELE, e não é decoração: a reprojeção de uma intenção de feição grava
 * dentro do documento daquele mapa, e sem ele `applyRemoteOperationInner` devolve falso, a op não
 * entra na lista de materializadas e os dois controles abaixo passariam a verde pelo motivo
 * errado (nada é liberado porque nada foi projetado).
 * @param {string} mapId
 * @param {Object} scope
 * @returns {Object}
 */
const retratoComMapa = (mapId, scope) => ({
    atlas: { id: scope.atlasId },
    maps: [{ id: mapId, name: 'Mapa Tático', features: {} }],
    briefings: [],
    currentVersion: 0
});

/** Os ids que o flush enviaria AGORA. Uma op preparada não aparece aqui. @returns {Promise<string[]>} */
const idsProntos = async () => (await operationQueue.peek(50)).map(op => op.entityId);

beforeEach(async () => {
    const memoria = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key) => memoria.get(key) ?? null,
        setItem: (key, value) => memoria.set(key, String(value)),
        removeItem: (key) => memoria.delete(key)
    });
    esquecerPendenciasEmMemoria();
    activateScope(remoteScope(crypto.randomUUID()));
    enableOperationLogging();
    setRemoteHandlerEventBus(barramentoMudo);
});

describe('o retrato do servidor e a op que ainda espera bytes', () => {
    it('REPRO: a op de uma feição com blob pendente continua FORA do peek depois do retrato', async () => {
        const scope = getActiveScope();
        const mapId = crypto.randomUUID();
        const imageId = crypto.randomUUID();
        await intencaoPreparada(imageId, mapId, scope);
        await pendenciaDeBlob(imageId, scope);

        await applyRemoteSnapshot(retratoComMapa(mapId, scope));

        expect(await idsProntos()).not.toContain(imageId);
    });

    it('CONTROLE NEGATIVO: sem pendência de blob, o MESMO retrato materializa e a op sai', async () => {
        const scope = getActiveScope();
        const mapId = crypto.randomUUID();
        const featureId = crypto.randomUUID();
        await intencaoPreparada(featureId, mapId, scope);

        await applyRemoteSnapshot(retratoComMapa(mapId, scope));

        expect(await idsProntos()).toContain(featureId);
    });

    // A FOTO ANEXA (revisão das fases 2b e 2c, 2026-09-24): a feição comum que CITA uma foto com
    // bytes pendentes também fica fora do peek depois do retrato, pelo mesmo filtro lido do disco.
    it('REPRO: a op de uma feição que CITA uma foto pendente continua FORA do peek depois do retrato', async () => {
        const scope = getActiveScope();
        const mapId = crypto.randomUUID();
        const featureId = crypto.randomUUID();
        const fotoId = crypto.randomUUID();
        await persistOperationIntents([{
            entityType: EntityType.FEATURE,
            operationType: OperationType.CREATE,
            entityId: featureId,
            mapId,
            data: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
                properties: { id: featureId, source: 'point', images: [{ id: fotoId, name: 'f.jpg', thumbnail: 'data:image/jpeg;base64,/9j/' }] } },
            previousData: null
        }], { scope, traceId: `traco-${featureId}` });
        await pendenciaDeBlob(fotoId, scope);

        await applyRemoteSnapshot(retratoComMapa(mapId, scope));

        expect(await idsProntos()).not.toContain(featureId);
    });
    // A FOTO CONVERTIDA JÁ RECUSADA (terceira revisão das fotos anexas, 2026-09-25, item 1): um F5 entre
    // a recusa gravada e a marcação das ops deixa a op preparada, e o retrato a soltava, porque só a
    // pendência segurava. A recusa de foto CONVERTIDA vira problema aqui também, lida do disco: o
    // servidor ainda guarda a foto inline, e a op a trocaria por uma referência a bytes recusados.
    it('REPRO: a op que cita uma foto CONVERTIDA recusada vira problema no retrato, e não sai', async () => {
        const scope = getActiveScope();
        const mapId = crypto.randomUUID();
        const featureId = crypto.randomUUID();
        const fotoId = crypto.randomUUID();
        await persistOperationIntents([{
            entityType: EntityType.FEATURE,
            operationType: OperationType.UPDATE,
            entityId: featureId,
            mapId,
            data: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
                properties: { id: featureId, source: 'point', images: [{ id: fotoId, name: 'f.jpg', thumbnail: 'data:image/jpeg;base64,/9j/' }] } },
            previousData: null
        }], { scope, traceId: `traco-${featureId}` });
        await getStoreFor(StoreName.IMAGES, scope).setItem(`${BLOB_UPLOAD_KEY_PREFIX}t-${fotoId}`, {
            tentativaId: `t-${fotoId}`, imageId: fotoId, atlasId: scope.atlasId, origem: 'foto-convertida',
            estado: 'recusado', ultimoErro: 'O servidor recusou a foto.', ultimoStatus: 415,
            tentativas: 1, criadoEm: Date.now(), atualizadoEm: Date.now()
        });

        await applyRemoteSnapshot(retratoComMapa(mapId, scope));

        expect(await idsProntos()).not.toContain(featureId);
        expect((await operationQueue.countByState()).problemas).toBe(1);
    });
    it('CONTROLE: a pendência de OUTRA imagem não segura esta op', async () => {
        const scope = getActiveScope();
        const mapId = crypto.randomUUID();
        const featureId = crypto.randomUUID();
        await intencaoPreparada(featureId, mapId, scope);
        await pendenciaDeBlob(crypto.randomUUID(), scope);

        await applyRemoteSnapshot(retratoComMapa(mapId, scope));

        expect(await idsProntos()).toContain(featureId);
    });
});
