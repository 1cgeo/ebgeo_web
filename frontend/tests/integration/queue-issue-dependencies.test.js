import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { getStoreFor, remoteScope, StoreName } from '../../src/js/store/atlas-namespace.js';
import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';

describe('Pending issue dependencies', () => {
    it('blocks refused parents and descendants while independent work can proceed', async () => {
        const scope = remoteScope('33333333-3333-4333-8333-333333333333');
        await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
        const queue = new OperationQueue(scope);
        const parent = { protocolVersion: 2, id: 'parent', entityId: 'briefing', entityType: 'briefing' };
        await queue.enqueueAll([
            parent,
            { protocolVersion: 2, id: 'slide', entityId: 'slide', entityType: 'slide', data: { briefingId: 'briefing' } },
            { protocolVersion: 2, id: 'child', entityId: 'child', dependsOn: ['slide'] },
            { protocolVersion: 2, id: 'independent', entityId: 'other' },
        ]);
        await queue.recordIssue(parent, { success: false, reason: 'Permissão revogada' });
        expect((await queue.peek()).map(op => op.id)).toEqual(['independent']);
        expect((await queue.getPendingProjection()).map(op => op.id)).toEqual(['independent']);
        // O ENVIAVEL E' UM, e o total continua quatro, agora dito pelos tres estados. Enquanto
        // `count()` respondia quatro, o laco de flush acordava a cada 1,5 s por causa das tres
        // operacoes que ele proprio se recusa a enviar.
        expect(await queue.count()).toBe(1);
        expect(await queue.countByState()).toEqual({ pendentes: 1, preparadas: 0, problemas: 3 });
        expect(await queue.getIssues()).toHaveLength(1);
    });

    // AS TRÊS CLASSES, e a terceira é a que não se grava. `getIssues` lê REGISTROS, e é ele que a
    // quarentena do logout copia; `getProblems` DERIVA, e é o único que enxerga quem está parado
    // atrás de quem. Gravar a dependência criaria uma pendência cuja causa some sozinha assim que
    // a operação da frente for resolvida, e a leitura seguinte anunciaria um problema inexistente.
    it('distingue conflito, recusa e dependência bloqueada', async () => {
        const scope = remoteScope('55555555-5555-4555-8555-555555555555');
        await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
        const queue = new OperationQueue(scope);
        const disputada = { protocolVersion: 2, id: 'disputada', entityId: 'camada', entityType: 'layer', mapId: 'm1' };
        const recusada = { protocolVersion: 2, id: 'recusada', entityId: 'outra', entityType: 'map' };
        await queue.enqueueAll([
            disputada,
            { protocolVersion: 2, id: 'atras', entityId: 'camada', entityType: 'layer', mapId: 'm1' },
            recusada,
            { protocolVersion: 2, id: 'livre', entityId: 'terceira' },
        ]);
        await queue.recordIssue(disputada, {
            rejected: true, status: 'conflict',
            reason: 'Os mesmos campos foram alterados no servidor.',
            conflict: { fields: ['nome'], entityVersion: 8, serverData: null },
        });
        await queue.recordIssue(recusada, { rejected: true, reason: 'Apenas o dono pode excluir um mapa' });

        const problemas = await queue.getProblems();
        expect(problemas.map((p) => [p.operation.id, p.classe])).toEqual([
            ['disputada', 'conflito'],
            ['atras', 'dependencia'],
            ['recusada', 'recusa'],
        ]);
        // A dependência nomeia quem a segura e não guarda resultado nenhum: ela não foi recusada.
        expect(problemas[1].bloqueadaPor).toBe('disputada');
        expect(problemas[1].result).toBeNull();
        // Os campos em disputa viajam com o problema, que é o que uma reaplicação vai precisar.
        expect(problemas[0].result.conflict.fields).toEqual(['nome']);

        // `getIssues` continua sendo só o que foi ESCRITO, agora com a classe.
        expect((await queue.getIssues()).map((i) => [i.operation.id, i.classe]))
            .toEqual([['disputada', 'conflito'], ['recusada', 'recusa']]);
        // E as duas leituras somam o mesmo que o censo: três problemas, um enviável.
        expect(await queue.countByState()).toEqual({ pendentes: 1, preparadas: 0, problemas: 3 });
    });

    it('acknowledges opaque IDs beginning with twelve digits without truncation', async () => {
        const scope = remoteScope('44444444-4444-4444-8444-444444444444');
        await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
        const queue = new OperationQueue(scope);
        const id = '123456789012_opaque';
        await queue.enqueue({ id, entityId: 'one' });
        expect(await queue.dequeue([id])).toBe(1);
        expect(await queue.count()).toBe(0);
    });
});
