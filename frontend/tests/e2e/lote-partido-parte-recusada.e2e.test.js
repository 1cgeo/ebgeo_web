// Path: tests/e2e/lote-partido-parte-recusada.e2e.test.js

/**
 * @fileoverview B6.1 (owner decision, 2026-09-24): a parte recusada de uma importacao partida, contra
 * o servidor REAL.
 *
 * O que a decisao B6.1 do dono (2026-09-24) troca: uma transacao de mais de 200 criacoes independentes sobe em lotes de ate
 * 200 (`createBatchOperations`) em vez de ser recusada inteira no cliente. O preco declarado e a perda da
 * atomicidade do import no servidor, e este arquivo mede esse preco no pior caso: o mapa e travado
 * DEPOIS de a primeira parte entrar. O que se afirma:
 *
 *  1. a primeira parte fica no servidor e sai da fila;
 *  2. as partes seguintes sao recusadas pelo servidor, ficam no disco como pendencia e nao
 *     reentram na rodada seguinte;
 *  3. a pessoa ouve QUAL parte foi recusada e QUANTAS feicoes ja chegaram, uma frase por parte.
 *
 * A trava entra pelo proprio protocolo, pelo `pushOperations` original, entre a primeira e a
 * segunda chamada do flush: e o instante em que a trava de um colega chega no meio do envio.
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

describe.skipIf(E2E_SKIP)('e2e: parte recusada de uma importacao partida (B6.1)', () => {
    let atlasId;
    let mapId;

    const ponto = (id, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.2 + (i % 30) * 0.001, -22.9 + Math.floor(i / 30) * 0.001] },
        properties: { source: 'point', id },
    });

    async function noServidor(ids) {
        const { snapshot } = await apiClient.pullSync(atlasId, 0);
        const mapa = snapshot.maps.find((m) => m.id === mapId);
        // O retrato agrupa as feicoes por tipo de armazenamento (`transformFeaturesToFrontend`).
        const todas = Object.values(mapa?.features ?? {}).filter(Array.isArray).flat();
        const presentes = new Set(todas.map((f) => f.properties?.id ?? f.id));
        return ids.filter((id) => presentes.has(id)).length;
    }

    beforeAll(async () => {
        syncEngine.configure({ baseUrl: `${getBaseUrl()}/api/v1` });
        const username = `e2e_${generateUUID().replace(/-/g, '').slice(0, 16)}`;
        const password = 'Sup3r-Secret-Pw!';
        await syncEngine.register({ username, password, nome: 'Dono do Import Partido', email: `${username}@example.mil` });
        await apiClient.verifyEmail(await pendingVerificationToken(username));
        expect(await syncEngine.login({ username, password })).toBeTruthy();

        const atlas = await apiClient.createAtlas({ name: 'Atlas do import partido' });
        atlasId = atlas.id;
        mapId = generateUUID();
        await apiClient.pushOperations(atlasId, [createOperation('map', 'create', mapId, null, { name: 'Mapa do import' })]);

        await activateRemoteAtlas(atlasId);
        expect(await syncEngine.connect(atlasId, { initialPull: false })).toBeTruthy();
    }, 60000);

    afterAll(async () => {
        syncEngine.disconnect();
        await operationQueue.clear();
    });

    it('a primeira parte fica, as seguintes viram pendencia, e cada uma diz quanto ja chegou', async () => {
        await operationQueue.clear();
        const ids = Array.from({ length: QUANTAS }, () => generateUUID());
        const ops = createBatchOperations(ids.map((id, i) => ({
            entityType: 'feature', operationType: 'create', entityId: id, mapId, data: ponto(id, i),
        }))).map((op) => ({ ...op, traceId: 'import-partido' }));
        const lotes = [...new Set(ops.map((op) => op.batchId))];
        // PISO: sem a particao, tudo abaixo mediria a recusa local de sempre.
        expect(lotes).toHaveLength(3);
        await operationQueue.enqueueAll(ops);

        const original = apiClient.pushOperations.bind(apiClient);
        let chamadas = 0;
        const espiao = vi.spyOn(apiClient, 'pushOperations').mockImplementation(async (id, lote, opcoes) => {
            chamadas += 1;
            if (chamadas === 2) {
                await original(atlasId, [createOperation('map', 'update', mapId, null, { locked: true })]);
            }
            return original(id, lote, opcoes);
        });
        try {
            await syncEngine.flush();
        } finally {
            espiao.mockRestore();
        }

        const primeira = ops.filter((op) => op.batchId === lotes[0]).map((op) => op.entityId);
        expect(await noServidor(primeira)).toBe(200);
        expect(await noServidor(ids)).toBe(200);

        const guardadas = await operationQueue.getAll();
        expect(guardadas).toHaveLength(QUANTAS - 200);
        const problemas = await operationQueue.getIssues();
        expect(problemas).toHaveLength(QUANTAS - 200);
        for (const { result } of problemas) expect(result.reason).toMatch(/bloqueado/);

        const frases = avisos.filter((texto) => texto.startsWith('O servidor recusou a parte'));
        expect(frases).toEqual([
            'O servidor recusou a parte 2 de 3 desta ação (200 feições). 200 de 450 já chegaram; a parte recusada está nas pendências para revisão.',
            'O servidor recusou a parte 3 de 3 desta ação (50 feições). 200 de 450 já chegaram; a parte recusada está nas pendências para revisão.',
        ]);

        // E a rodada seguinte nao volta ao servidor com o que ficou guardado.
        const antes = chamadas;
        expect((await syncEngine.flush()).pushed).toBe(0);
        expect(chamadas).toBe(antes);
    }, 120000);
});
