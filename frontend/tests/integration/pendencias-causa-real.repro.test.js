// Path: tests/integration/pendencias-causa-real.repro.test.js
//
// "ACEITAR O SERVIDOR" DESCARTAVA A EDIÇÃO DE OUTRA FEIÇÃO, DE OUTRO GESTO (achado da revisão do
// lote em massa, 2026-09-24).
//
// `getProblems` gravava em `bloqueadaPor` a ÚLTIMA recusa lida na ordem da fila, não a que de fato
// segura aquela operação. Cenário: estilo em 1000 com o colega tendo mudado F10 e F20 (duas recusas
// independentes, I10 e I20); depois a pessoa move F10 (Z, encadeada em I10). O painel dizia que Z
// estava "parada atrás de F20", e "Aceitar o servidor" em F20 descartava o movimento de F10. As
// operações independentes (decisão do dono de 2026-09-24) tornam isso frequente: são N recusas soltas
// numa fila só.
//
// O conserto: `PendingBlockade` registra a CAUSA (entidade -> recusa, operação -> recusa), e
// `getProblems` devolve essa causa. Roda contra a FILA DE VERDADE (`fake-indexeddb`).
//
// CONTROLE NEGATIVO: com a causa trocada pela última recusa lida (o comportamento anterior), os três
// casos reprovam.

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { StoreName, getStoreFor, remoteScope } from '@store/atlas-namespace.js';
import { OperationQueue } from '@store/sync/operation-queue.js';
import { montarPendencias } from '@js/account/pendencias/pendencias-rows.js';
import { aceitarOServidor, idsQueSaemJunto } from '@js/account/pendencias/pendencias-acoes.js';

const scope = remoteScope('77777777-7777-4777-8777-777777777777');
const MAPA = '88888888-8888-4888-8888-888888888888';
const recusa = { rejected: true, status: 'conflict', reason: 'O item mudou no servidor.', conflict: { fields: ['estilo'], entityVersion: 4 } };

let seq = 0;
function estilo(entityId, extra = {}) {
    seq += 1;
    return {
        protocolVersion: 2, id: `op-${entityId}-${seq}`, entityType: 'feature', operationType: 'update',
        entityId, mapId: MAPA, timestamp: 1_700_000_000_000 + seq, lamportTimestamp: seq,
        data: { type: 'Feature', properties: { id: entityId, nome: entityId, fillColor: '#00aa00' } },
        previousData: { type: 'Feature', properties: { id: entityId, nome: entityId, confirmedVersion: 3 } },
        scopeSuffix: scope.dbSuffix,
        ...extra,
    };
}

async function cenario() {
    await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
    const queue = new OperationQueue(scope);
    const i10 = estilo('F10');
    const i20 = estilo('F20');
    const outras = [estilo('F30'), estilo('F40')];
    // Z: a pessoa MOVE F10 depois; a edição encadeia na anterior da mesma entidade.
    const z = estilo('F10', { dependsOn: [i10.id], baseOperationId: i10.id });
    await queue.enqueueAll([i10, i20, ...outras, z]);
    await queue.recordIssue(i10, recusa);
    await queue.recordIssue(i20, recusa);
    await queue.dequeue(outras.map((op) => op.id));
    return { queue, i10, i20, z };
}

describe('a pendência nomeia a recusa que DE FATO a segura', () => {
    beforeEach(() => { seq = 0; });

    it('getProblems: Z está parada atrás de I10 (mesma feição), não da última recusa lida (I20)', async () => {
        const { queue, i10, z } = await cenario();
        const problemas = await queue.getProblems();
        expect(problemas.find((p) => p.operation.id === z.id).bloqueadaPor).toBe(i10.id);
    });

    it('o painel diz "parada atrás de" F10', async () => {
        const { queue, z } = await cenario();
        const { linhas } = montarPendencias({ problemas: await queue.getProblems(), nomeDoMapa: () => 'Principal' });
        expect(linhas.find((l) => l.operationId === z.id).bloqueio).toBe('Parada atrás de Feição «F10», no mapa «Principal».');
    });

    it('"Aceitar o servidor" em F20 NÃO descarta o movimento de F10; em F10 leva Z junto', async () => {
        const { queue, i10, i20, z } = await cenario();
        const { linhas } = montarPendencias({ problemas: await queue.getProblems() });
        expect(idsQueSaemJunto(linhas.find((l) => l.operationId === i20.id), linhas)).toEqual([i20.id]);
        expect(idsQueSaemJunto(linhas.find((l) => l.operationId === i10.id), linhas)).toEqual([i10.id, z.id]);

        await aceitarOServidor(linhas.find((l) => l.operationId === i20.id), linhas,
            { queue, engine: { resync: async () => {} } });
        expect((await queue.getAll()).map((op) => op.id).sort()).toEqual([i10.id, z.id].sort());
    });
});
