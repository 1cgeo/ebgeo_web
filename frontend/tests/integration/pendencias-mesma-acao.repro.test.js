// Path: tests/integration/pendencias-mesma-acao.repro.test.js
//
// MIL RECUSAS IGUAIS DA MESMA AÇÃO ERAM MIL LINHAS E MIL CLIQUES (achado da revisão do lote em
// massa, 2026-09-24).
//
// Desde a decisão do dono de 2026-09-24 as operações de excluir e estilizar em massa saem
// independentes, sem lote, e por isso sem `batchFailedOperationId`: não há culpada a nomear. Um mapa
// travado, ou um papel rebaixado, no meio de 1000 exclusões devolve 1000 recusas com o MESMO motivo,
// e o painel pedia uma decisão por linha. Agora as recusas da mesma ação (mesmo `traceId`, que
// `runTransaction` cunha por transação) e do mesmo motivo formam um grupo, com uma ação só.
//
// CONTROLE NEGATIVO: sem o agrupamento, "Aceitar o servidor" leva uma linha e o resumo some.

import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { StoreName, getStoreFor, remoteScope } from '@store/atlas-namespace.js';
import { OperationQueue } from '@store/sync/operation-queue.js';
import { montarPendencias } from '@js/account/pendencias/pendencias-rows.js';
import { confirmacaoDeAceitar, mesmaAcaoResumo } from '@js/account/pendencias/pendencias-phrases.js';
import { aceitarOServidor, idsQueSaemJunto, linhasParaExportar } from '@js/account/pendencias/pendencias-acoes.js';

const scope = remoteScope('99999999-9999-4999-8999-999999999999');
const MAPA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TRAVADO = 'O mapa está bloqueado e não aceita edições.';

let seq = 0;
function exclusao(entityId, traceId) {
    seq += 1;
    return {
        protocolVersion: 2, id: `op-${seq}`, entityType: 'feature', operationType: 'delete', entityId,
        mapId: MAPA, timestamp: 1_700_000_000_000 + seq, lamportTimestamp: seq, traceId,
        data: null, previousData: { type: 'Feature', properties: { id: entityId, nome: entityId } },
        scopeSuffix: scope.dbSuffix,
    };
}

async function cenario() {
    seq = 0;
    await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
    const queue = new OperationQueue(scope);
    const daAcao = Array.from({ length: 300 }, (_, i) => exclusao(`F${i}`, 'gesto-1'));
    const outraAcao = [exclusao('G1', 'gesto-2'), exclusao('G2', 'gesto-2')];
    const outroMotivo = exclusao('F999', 'gesto-1');
    await queue.enqueueAll([...daAcao, ...outraAcao, outroMotivo]);
    for (const op of [...daAcao, ...outraAcao]) await queue.recordIssue(op, { rejected: true, reason: TRAVADO });
    await queue.recordIssue(outroMotivo, { rejected: true, reason: 'Sem permissão para excluir.' });
    const modelo = montarPendencias({ problemas: await queue.getProblems() });
    return { queue, daAcao, outraAcao, outroMotivo, modelo };
}

describe('as recusas da mesma ação e do mesmo motivo são um grupo, com uma ação só', () => {
    it('as 300 da mesma ação e do mesmo motivo formam UM grupo; as outras ficam fora', async () => {
        const { modelo, daAcao, outraAcao, outroMotivo } = await cenario();
        const linha = (id) => modelo.linhas.find((l) => l.operationId === id);
        expect(daAcao.every((op) => linha(op.id).mesmaAcao?.total === 300)).toBe(true);
        expect(linha(outraAcao[0].id).mesmaAcao?.total).toBe(2);
        expect(linha(outroMotivo.id).mesmaAcao).toBeFalsy();
        // O motivo de cada uma continua o dela, que é verdadeiro para todas.
        expect(linha(daAcao[7].id).motivo).toBe(TRAVADO);
        // Uma exclusão se nomeia pelo que foi excluído, nunca pelo id.
        expect(linha(daAcao[7].id).entidade.nome).toBe('F7');
    });

    it('o resumo diz quantas foram recusadas pelo mesmo motivo, e o que fazer', async () => {
        const { modelo } = await cenario();
        const frases = mesmaAcaoResumo(modelo.mesmaAcao);
        expect(frases).toHaveLength(2);
        expect(frases[0]).toBe(`300 alterações da mesma ação foram recusadas pelo mesmo motivo: ${TRAVADO} `
            + 'Aceitar o servidor ou Exportar em qualquer uma delas vale para todas.');
    });

    it('o motivo do servidor sem ponto final não emenda na frase seguinte', () => {
        const [frase] = mesmaAcaoResumo([{ total: 3, motivo: 'O mapa está bloqueado e não aceita edições' }]);
        expect(frase).toContain('edições. Aceitar o servidor');
    });

    it('"Aceitar o servidor" em qualquer uma leva as 300, e só elas', async () => {
        const { queue, modelo, daAcao, outraAcao, outroMotivo } = await cenario();
        const uma = modelo.linhas.find((l) => l.operationId === daAcao[150].id);
        const ids = idsQueSaemJunto(uma, modelo.linhas);
        expect(ids).toHaveLength(300);
        expect(ids[0]).toBe(daAcao[150].id);
        expect(linhasParaExportar(uma, modelo.linhas)).toHaveLength(300);
        const pergunta = confirmacaoDeAceitar(ids.length, { mesmoMotivo: true });
        expect(pergunta.confirmar).toBe('Descartar 300 alterações');
        expect(pergunta.mensagem).toContain('pelo mesmo motivo');

        await aceitarOServidor(uma, modelo.linhas, { queue, engine: { resync: async () => {} } });
        expect((await queue.getAll()).map((op) => op.id).sort())
            .toEqual([...outraAcao.map((op) => op.id), outroMotivo.id].sort());
    });
});
