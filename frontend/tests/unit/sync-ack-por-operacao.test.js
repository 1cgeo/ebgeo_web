// Path: tests/unit/sync-ack-por-operacao.test.js

/**
 * DUAS REGRAS DE SAÍDA DA FILA, as duas puras e as duas sobre a mesma pergunta: quando é
 * legítimo esquecer o trabalho que o usuário fez.
 *
 * 1. `acknowledgedOperationIds` — o que sai da fila é o que o SERVIDOR mencionou, nunca o
 *    lote inteiro por o lote ter dado 2xx. Uma op que ele não mencionou não foi aplicada,
 *    não foi recusada e não tem versão: tirá-la da fila porque as vizinhas foram aceitas é
 *    como uma feição some de uma máquina sem nunca aparecer em nenhuma outra.
 * 2. `classifyFlushFailure` — 404/410 (o atlas sumiu do servidor) é uma classe própria. Sem
 *    ela o caso caía em "rede", e a mensagem prometia ao usuário um envio que nunca ia
 *    acontecer.
 */

import { describe, it, expect } from 'vitest';
import { acknowledgedOperationIds } from '../../src/js/store/sync/sync-engine.js';
import { classifyFlushFailure } from '../../src/js/store/sync/sync-flush.js';

/** @returns {Object[]} n ops with predictable ids. */
function ops(...ids) {
    return ids.map(id => ({ id, entityType: 'feature', entityId: `e-${id}` }));
}

/** @returns {Error} An ApiError-shaped error (the client stamps `status`). */
function apiError(status) {
    return Object.assign(new Error('boom'), { status });
}

describe('acknowledgedOperationIds — só sai da fila o que o servidor confirmou', () => {
    it('devolve só as ops mencionadas, deixando as demais na fila', () => {
        const enviadas = ops('a', 'b', 'c');
        const resp = { results: [{ operationId: 'a', success: true }, { operationId: 'c', success: true }] };

        expect(acknowledgedOperationIds(resp, enviadas)).toEqual(['a', 'c']);
    });

    it('op RECUSADA por operação sai da fila (a recusa é permanente e já foi comunicada)', () => {
        const enviadas = ops('a', 'b');
        const resp = {
            results: [
                { operationId: 'a', success: true },
                { operationId: 'b', success: false, rejected: true, reason: 'Mapa bloqueado' },
            ],
        };

        // Se ela ficasse, o lote voltaria idêntico a cada 1,5 s para sempre.
        expect(acknowledgedOperationIds(resp, enviadas)).toEqual(['a']);
    });

    it('aceita a forma alternativa do ack (`acks` com `opId`)', () => {
        expect(acknowledgedOperationIds({ acks: [{ opId: 'b', status: 'applied' }] }, ops('a', 'b'))).toEqual(['b']);
    });

    it('recibos sem resultado, desconhecidos ou contraditórios preservam o trabalho', () => {
        for (const receipt of [{ opId: 'a' }, { opId: 'a', status: 'pending' },
            { opId: 'a', status: 'conflict', success: true }]) {
            expect(acknowledgedOperationIds({ acks: [receipt] }, ops('a'))).toEqual([]);
        }
        expect(acknowledgedOperationIds({ results: [
            { operationId: 'a', success: true }, { operationId: 'a', success: false }
        ] }, ops('a'))).toEqual([]);
    });

    it('recibo incompleto mantém o lote inteiro para repetir com os mesmos ids', () => {
        const sent = [...ops('a', 'b').map(op => ({ ...op, batchId: 'gesto' })), ...ops('c')];
        expect(acknowledgedOperationIds({ results: [
            { operationId: 'a', success: true }, { operationId: 'c', success: true }
        ] }, sent)).toEqual(['c']);
        expect(acknowledgedOperationIds({ acks: sent.map(op => ({
            opId: op.id, status: 'already_applied'
        })) }, sent)).toEqual(['a', 'b', 'c']);
    });

    it('resposta que não identifica NENHUMA op: nada sai, o lote inteiro fica na fila', () => {
        const enviadas = ops('a', 'b');
        for (const resp of [{}, { results: [] }, { acks: [], serverVersion: 7 }, { results: [{}, {}] }]) {
            expect(acknowledgedOperationIds(resp, enviadas)).toEqual([]);
        }
    });

    it('borda: resposta nula, e ids que o cliente não enviou são ignorados', () => {
        expect(acknowledgedOperationIds(null, ops('a'))).toEqual([]);
        expect(acknowledgedOperationIds({ results: [{ operationId: 'z' }] }, ops('a'))).toEqual([]);
    });

    // O LOTE LÓGICO, e por que este caso NÃO se escreve contra o servidor de verdade. Ele aplica
    // ou recusa o gesto inteiro num savepoint só e responde todos os membros com o mesmo status,
    // então um irmão acked como APLICADO dentro de um lote recusado é, por construção, um servidor
    // que quebrou o contrato: o e2e não consegue produzi-lo. A guarda existe justamente para esse
    // caso, porque deixar o irmão sair deixaria o gesto meio enfileirado, que é a forma que nada a
    // jusante conserta.
    it('membro de lote RECUSADO não sai da fila nem quando o ack diz que foi aplicado', () => {
        const enviadas = ops('a', 'b', 'c').map(op => ({ ...op, batchId: 'gesto-1' }));
        const avulsa = { id: 'd', entityType: 'feature', entityId: 'e-d' };
        const resp = {
            results: [
                { operationId: 'a', success: true, batchId: 'gesto-1' },
                { operationId: 'b', success: false, rejected: true, batchId: 'gesto-1', reason: 'x' },
                { operationId: 'c', success: true, batchId: 'gesto-1' },
                { operationId: 'd', success: true },
            ],
        };

        // A avulsa do MESMO push continua saindo: a unidade é o lote, não a resposta inteira.
        expect(acknowledgedOperationIds(resp, [...enviadas, avulsa])).toEqual(['d']);
    });

    it('lote APLICADO inteiro sai inteiro (o controle do caso acima)', () => {
        const enviadas = ops('a', 'b').map(op => ({ ...op, batchId: 'gesto-2' }));
        const resp = {
            results: [
                { operationId: 'a', success: true, batchId: 'gesto-2' },
                { operationId: 'b', success: true, batchId: 'gesto-2' },
            ],
        };

        expect(acknowledgedOperationIds(resp, enviadas)).toEqual(['a', 'b']);
    });

    it('o `batchId` é lido do ENVELOPE quando o recibo não o ecoa', () => {
        // Um servidor que recusa sem repetir o carimbo continua derrubando o gesto inteiro, porque
        // quem sempre sabe a que gesto a op pertence é a op.
        const enviadas = ops('a', 'b').map(op => ({ ...op, batchId: 'gesto-3' }));
        const resp = {
            results: [
                { operationId: 'a', success: true },
                { operationId: 'b', success: false, rejected: true, reason: 'x' },
            ],
        };

        expect(acknowledgedOperationIds(resp, enviadas)).toEqual([]);
    });
});

describe('classifyFlushFailure — o atlas que sumiu não é uma falha de rede', () => {
    it('404 e 410 viram a classe `gone`, com mensagem própria', () => {
        for (const status of [404, 410]) {
            const out = classifyFlushFailure(apiError(status));
            expect(out.kind).toBe('gone');
            expect(out.message).not.toBe(classifyFlushFailure(apiError(503)).message);
        }
    });

    it('a mensagem não promete envio futuro (que é o que a de rede promete)', () => {
        expect(classifyFlushFailure(apiError(404)).message).not.toMatch(/quando a conexão voltar/i);
        expect(classifyFlushFailure(apiError(503)).message).toMatch(/quando a conexão voltar/i);
    });

    it('não invade as classes vizinhas: 401, 403 e 5xx seguem como eram', () => {
        expect(classifyFlushFailure(apiError(401)).kind).toBe('session');
        expect(classifyFlushFailure(apiError(403)).kind).toBe('permission');
        expect(classifyFlushFailure(apiError(500)).kind).toBe('network');
        expect(classifyFlushFailure(apiError(409)).kind).toBe('network');
    });
});
