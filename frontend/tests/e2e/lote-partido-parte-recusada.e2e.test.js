// Path: tests/e2e/lote-partido-parte-recusada.e2e.test.js

/**
 * @fileoverview B6.1 (decisao do dono, 2026-09-24): o lote acima do teto parte em blocos ENCADEADOS,
 * contra o servidor REAL.
 *
 * Acima de `LOTE_MAX_OPS` (200) um lote parte em blocos de ate 200, e a primeira op de cada bloco
 * depende (`dependsOn`) da ultima do bloco anterior (`createBatchOperations`). O preco declarado e a
 * perda da atomicidade no servidor, e este arquivo mede o pior caso: o mapa e travado no meio do
 * envio. O que se afirma, com o servidor de verdade:
 *
 *  1. IMPORTACAO de 450: a primeira parte fica no servidor; a segunda e recusada e SEGURA a
 *     terceira (que nunca e enviada); a pessoa ouve qual parte e quanto ja chegou; a rodada
 *     seguinte nao volta ao servidor.
 *  2. GRUPO de 450 membros com a trava ANTES do primeiro envio: o grupo e recusado e NENHUM
 *     `group_feature` sai. O insert de membro sem grupo escreve zero linhas e volta confirmado como
 *     sucesso, entao um membro que saisse depois de um grupo recusado seria o sucesso mudo.
 *  3. GRUPO de 450 com a trava depois do primeiro bloco: o grupo e os 199 primeiros membros ficam,
 *     o resto fica nas pendencias, e o servidor nao tem membro nenhum alem desses.
 *  4. O servidor IGNORA `dependsOn`: uma op com um elo para um id que nao existe e aplicada igual.
 *  5. ESTILO EM MASSA INDEPENDENTE (decisao do dono de 2026-09-24, que refina o B6.1): 250 UPDATEs
 *     marcados `independent` e UMA feicao apagada por outro cliente antes do envio. O servidor
 *     aplica 249 e recusa so aquela; nada fica retido atras dela.
 *
 * A trava entra pelo proprio protocolo, pelo `pushOperations` original, entre duas chamadas do
 * flush: e o instante em que a trava de um colega chega no meio do envio.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const avisos = vi.hoisted(() => []);
vi.mock('../../src/js/utilities/toast_service.js', async (importOriginal) => ({
    ...(await importOriginal()),
    showWarning: (mensagem) => { avisos.push(mensagem); },
}));

import { getBaseUrl, E2E_SKIP } from './helpers/harness.js';
import { pendingVerificationToken } from './helpers/db.js';
import { activateRemoteAtlas } from '../../src/js/store/remote-atlas.api.js';
import { syncEngine } from '../../src/js/store/sync/sync-engine.js';
import { apiClient } from '../../src/js/store/sync/api-client.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { createOperation, createBatchOperations } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

const QUANTAS = 450;

describe.skipIf(E2E_SKIP)('e2e: lote acima do teto em blocos encadeados (B6.1)', () => {
    let atlasId;
    /** One map per case, created BEFORE the connect so the snapshot shapes them on this client. */
    const mapas = {};

    const ponto = (id, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.2 + (i % 30) * 0.001, -22.9 + Math.floor(i / 30) * 0.001] },
        properties: { source: 'point', id },
    });

    /** A map of its own per case: a lock is destructive state and must not leak to the next case. */
    async function criarMapa(nome) {
        const id = generateUUID();
        await apiClient.pushOperations(atlasId, [createOperation('map', 'create', id, null, { name: nome })]);
        return id;
    }

    async function retratoDoMapa(mapId) {
        const { snapshot } = await apiClient.pullSync(atlasId, 0);
        return snapshot.maps.find((m) => m.id === mapId);
    }

    async function noServidor(mapId, ids) {
        const mapa = await retratoDoMapa(mapId);
        // O retrato agrupa as feicoes por tipo de armazenamento (`transformFeaturesToFrontend`).
        const todas = Object.values(mapa?.features ?? {}).filter(Array.isArray).flat();
        const presentes = new Set(todas.map((f) => f.properties?.id ?? f.id));
        return ids.filter((id) => presentes.has(id)).length;
    }

    /** Runs one flush with the map locked by the protocol just before push number `antesDoPush`. */
    async function flushTravandoAntesDo(antesDoPush, mapId) {
        const original = apiClient.pushOperations.bind(apiClient);
        const chamadas = [];
        const espiao = vi.spyOn(apiClient, 'pushOperations').mockImplementation(async (id, lote, opcoes) => {
            chamadas.push(lote.length);
            if (chamadas.length === antesDoPush) {
                await original(atlasId, [createOperation('map', 'update', mapId, null, { locked: true })]);
            }
            return original(id, lote, opcoes);
        });
        try {
            await syncEngine.flush();
        } finally {
            espiao.mockRestore();
        }
        return chamadas;
    }

    beforeAll(async () => {
        syncEngine.configure({ baseUrl: `${getBaseUrl()}/api/v1` });
        const username = `e2e_${generateUUID().replace(/-/g, '').slice(0, 16)}`;
        const password = 'Sup3r-Secret-Pw!';
        await syncEngine.register({ username, password, nome: 'Dono do Lote Partido', email: `${username}@example.mil` });
        await apiClient.verifyEmail(await pendingVerificationToken(username));
        expect(await syncEngine.login({ username, password })).toBeTruthy();

        const atlas = await apiClient.createAtlas({ name: 'Atlas do lote partido' });
        atlasId = atlas.id;
        for (const caso of ['importacao', 'grupoRecusado', 'grupoPartido', 'elo', 'independentes']) mapas[caso] = await criarMapa(caso);

        await activateRemoteAtlas(atlasId);
        expect(await syncEngine.connect(atlasId, { initialPull: false })).toBeTruthy();
    }, 60000);

    afterAll(async () => {
        syncEngine.disconnect();
        await operationQueue.clear();
    });

    it('1) importacao: a parte recusada segura a seguinte, e o aviso diz quanto chegou', async () => {
        await operationQueue.clear();
        avisos.length = 0;
        const mapId = mapas.importacao;
        const ids = Array.from({ length: QUANTAS }, () => generateUUID());
        const ops = createBatchOperations(ids.map((id, i) => ({
            entityType: 'feature', operationType: 'create', entityId: id, mapId, data: ponto(id, i),
        })));
        // PISO: sem a particao, tudo abaixo mediria a recusa local de sempre.
        expect([...new Set(ops.map((op) => op.batchId))]).toHaveLength(3);
        await operationQueue.enqueueAll(ops);

        const chamadas = await flushTravandoAntesDo(2, mapId);
        // A terceira parte nunca foi enviada: o elo a segurou atras da recusada.
        expect(chamadas).toEqual([200, 200]);
        expect(await noServidor(mapId, ids)).toBe(200);
        expect(await noServidor(mapId, ids.slice(0, 200))).toBe(200);

        expect(await operationQueue.getAll()).toHaveLength(250);
        const problemas = await operationQueue.getIssues();
        expect(problemas).toHaveLength(200);
        for (const { result } of problemas) expect(result.reason).toMatch(/bloqueado/);
        expect(await operationQueue.countByState()).toEqual({ pendentes: 0, preparadas: 0, problemas: 250 });

        expect(avisos.filter((texto) => texto.startsWith('O servidor recusou a parte'))).toEqual([
            'O servidor recusou a parte 2 de 3 desta ação. 200 de 450 alterações já chegaram; '
            + 'as outras 250 estão nas pendências para revisão.',
        ]);

        const antes = chamadas.length;
        expect((await syncEngine.flush()).pushed).toBe(0);
        expect(chamadas).toHaveLength(antes);
    }, 120000);

    /**
     * Seeds `quantas` points on `mapId` straight through the API, in pushes the server accepts.
     * @returns {Promise<string[]>}
     */
    async function semearPontos(mapId, quantas) {
        const ids = Array.from({ length: quantas }, () => generateUUID());
        for (let inicio = 0; inicio < quantas; inicio += 150) {
            await apiClient.pushOperations(atlasId, ids.slice(inicio, inicio + 150)
                .map((id, k) => createOperation('feature', 'create', id, mapId, ponto(id, inicio + k))));
        }
        return ids;
    }

    function gestoDeGrupo(mapId, groupId, ids) {
        return createBatchOperations([
            { entityType: 'group', operationType: 'create', entityId: groupId, mapId,
                data: { name: 'Grupo grande', visible: true, locked: false, features: [] } },
            ...ids.map((fid) => ({ entityType: 'group_feature', operationType: 'create', entityId: generateUUID(), mapId,
                data: { group_id: groupId, feature_id: fid, feature_type: 'point' } })),
        ]);
    }

    async function membrosNoServidor(mapId, groupId) {
        const mapa = await retratoDoMapa(mapId);
        const grupo = mapa?.groups?.find((g) => g.id === groupId);
        return grupo ? (grupo.features ?? []).length : null;
    }

    it('2) grupo recusado no primeiro bloco: NENHUM membro sai, nem confirmado mudo', async () => {
        await operationQueue.clear();
        const mapId = mapas.grupoRecusado;
        const ids = await semearPontos(mapId, QUANTAS);
        const groupId = generateUUID();
        const ops = gestoDeGrupo(mapId, groupId, ids);
        expect([...new Set(ops.map((op) => op.batchId))]).toHaveLength(3);
        await operationQueue.enqueueAll(ops);

        const chamadas = await flushTravandoAntesDo(1, mapId);
        expect(chamadas).toEqual([200]);
        expect(await membrosNoServidor(mapId, groupId)).toBeNull();
        expect(await operationQueue.getAll()).toHaveLength(QUANTAS + 1);
        expect(await operationQueue.countByState()).toEqual({ pendentes: 0, preparadas: 0, problemas: QUANTAS + 1 });
    }, 120000);

    it('3) grupo recusado no segundo bloco: ficam o grupo e os 199 membros do primeiro, nada mais', async () => {
        await operationQueue.clear();
        const mapId = mapas.grupoPartido;
        const ids = await semearPontos(mapId, QUANTAS);
        const groupId = generateUUID();
        await operationQueue.enqueueAll(gestoDeGrupo(mapId, groupId, ids));

        const chamadas = await flushTravandoAntesDo(2, mapId);
        expect(chamadas).toEqual([200, 200]);
        expect(await membrosNoServidor(mapId, groupId)).toBe(199);
        expect(await operationQueue.getAll()).toHaveLength(QUANTAS + 1 - 200);
        expect(await operationQueue.countByState()).toEqual({ pendentes: 0, preparadas: 0, problemas: QUANTAS + 1 - 200 });
    }, 120000);

    it('4) o servidor ignora `dependsOn`: um elo para um id que nao existe nao muda nada', async () => {
        const mapId = mapas.elo;
        const id = generateUUID();
        const op = { ...createOperation('feature', 'create', id, mapId, ponto(id, 0)), dependsOn: [generateUUID()] };
        const resposta = await apiClient.pushOperations(atlasId, [op]);
        const [resultado] = resposta.results ?? resposta.acks ?? [];
        expect(resultado?.success).toBe(true);
        expect(await noServidor(mapId, [id])).toBe(1);
    }, 60000);

    it('5) estilo em massa independente: uma feicao apagada custa so ela, as outras 249 chegam', async () => {
        await operationQueue.clear();
        const mapId = mapas.independentes;
        const ids = await semearPontos(mapId, 250);
        const vitima = ids[100];
        // A base confirmada que o servidor exige de toda edição de feição (a versão 1 da criação).
        const base = (id, i) => { const f = ponto(id, i); return { ...f, properties: { ...f.properties, confirmedVersion: 1 } }; };
        // O colega apaga uma delas ANTES de o estilo sair.
        const apagou = await apiClient.pushOperations(atlasId, [createOperation('feature', 'delete', vitima, mapId, null, base(vitima, 100))]);
        expect((apagou.results ?? apagou.acks ?? [])[0]?.success, 'a exclusao do colega foi aplicada').toBe(true);

        const ops = createBatchOperations(ids.map((id, i) => {
            const antes = base(id, i);
            return {
                entityType: 'feature', operationType: 'update', entityId: id, mapId,
                data: { ...antes, properties: { ...antes.properties, fillColor: '#00aa00' } },
                previousData: antes,
                independent: true,
            };
        }));
        // PISO: independentes de verdade, sem lote e sem elo.
        expect(ops.filter((op) => op.batchId !== undefined || op.dependsOn)).toEqual([]);
        await operationQueue.enqueueAll(ops);
        await syncEngine.flush();

        const mapa = await retratoDoMapa(mapId);
        const todas = Object.values(mapa?.features ?? {}).filter(Array.isArray).flat();
        const verdes = todas.filter((f) => ids.includes(f.properties?.id ?? f.id) && f.properties?.fillColor === '#00aa00');
        expect(verdes).toHaveLength(249);
        expect(todas.some((f) => (f.properties?.id ?? f.id) === vitima)).toBe(false);
        const problemas = await operationQueue.getIssues();
        expect(problemas).toHaveLength(1);
        expect(problemas[0].operation.entityId).toBe(vitima);
        expect(await operationQueue.countByState()).toEqual({ pendentes: 0, preparadas: 0, problemas: 1 });
    }, 180000);
});
