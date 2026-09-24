// Path: tests/integration/pendencias-recusada-junto.repro.test.js
//
// O MOTIVO FALSO NAS PENDÊNCIAS: a irmã de uma parte recusada mostrava o motivo da CULPADA como se
// fosse dela.
//
// Medido em 2026-09-24 (Chromium, dois navegadores, Postgres): 1000 estilos numa ação, o colega
// apaga UMA feição no meio. O servidor recusa a parte inteira em que ela estava (200 operações) e
// devolve todas com o MESMO `reason` e com `batchFailedOperationId` nomeando a culpada
// (`recusarLoteInteiro`, `backend/src/modules/sync/sync.service.js`). O painel mostrava 199 linhas
// "Feição «P595» ... O item foi excluido no servidor.", falso para 199 delas, e "Aceitar o
// servidor" numa linha levava só aquela: decidir o grupo exigia 199 cliques.
//
// Isto vale para toda parte recusada do B6.1 já integrada (importar, colar, mover), e por isso roda
// contra a FILA DE VERDADE (`fake-indexeddb`) com os recibos na forma que o servidor devolve.
//
// CONTROLE NEGATIVO: sem o agrupamento em `pendencias-rows.js` e `pendencias-acoes.js`, os casos de
// motivo, de contagem e de "saem junto" reprovam (o motivo da irmã é o da culpada; aceitar numa
// irmã tira 1).

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { StoreName, getStoreFor, remoteScope } from '@store/atlas-namespace.js';
import { OperationQueue } from '@store/sync/operation-queue.js';
import { createBatchOperations } from '@store/sync/operation-factory.js';
import { montarPendencias } from '@js/account/pendencias/pendencias-rows.js';
import {
    PendenciaClasse,
    confirmacaoDeAceitar,
    contadoresVisiveis,
    juntoResumo,
} from '@js/account/pendencias/pendencias-phrases.js';
import { aceitarOServidor, acoesDaLinha, idsQueSaemJunto } from '@js/account/pendencias/pendencias-acoes.js';

const ATLAS = '55555555-5555-4555-8555-555555555555';
const scope = remoteScope(ATLAS);
const MOTIVO_DA_CULPADA = 'O item foi excluido no servidor.';

/**
 * 450 estilos numa ação: três partes (200, 200, 50). A primeira foi aplicada; a segunda voltou
 * recusada por causa de UMA feição (P300, apagada pelo colega); a terceira ficou retida atrás.
 */
async function cenario() {
    await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
    const ops = createBatchOperations(Array.from({ length: 450 }, (_, i) => ({
        entityType: 'feature', operationType: 'update', entityId: `f${i}`, mapId: 'mapa-1',
        data: { type: 'Feature', properties: { id: `f${i}`, source: 'point', nome: `P${i}`, fillColor: '#00aa00' } },
        previousData: { type: 'Feature', properties: { id: `f${i}`, source: 'point', nome: `P${i}` } },
    }))).map((op) => ({ ...op, scopeSuffix: scope.dbSuffix }));
    const partes = [...new Set(ops.map((op) => op.batchId))];
    expect(partes).toHaveLength(3);
    const parte = (k) => ops.filter((op) => op.batchId === partes[k]);
    const culpada = parte(1).find((op) => op.entityId === 'f300');

    const queue = new OperationQueue(scope);
    await queue.enqueueAll(ops);
    for (const op of parte(1)) {
        // A forma do recibo que o servidor devolve para um lote recusado: o MESMO motivo em todas,
        // o envelope de conflito só na culpada, e a culpada nomeada em todas.
        const propria = op.id === culpada.id;
        await queue.recordIssue(op, {
            operationId: op.id,
            rejected: true,
            status: propria ? 'conflict' : 'rejected',
            reason: MOTIVO_DA_CULPADA,
            batchId: partes[1],
            batchFailedOperationId: culpada.id,
            ...(propria ? { conflict: { fields: ['*'], deleted: true, entityVersion: 3, serverData: null } } : {}),
        });
    }
    await queue.dequeue(parte(0).map((op) => op.id));
    const modelo = montarPendencias({ problemas: await queue.getProblems(), nomeDoMapa: () => 'Mapa Tático' });
    return { queue, ops, partes, parte, culpada, modelo };
}

const motorFalso = () => ({ resync: async () => {}, flush: async () => {} });

describe('a irmã de uma parte recusada não carrega o motivo da culpada', () => {
    beforeEach(async () => {
        await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
    });

    it('a irmã diz que foi recusada JUNTO, nomeando a culpada; a culpada mantém o motivo dela', async () => {
        const { modelo, culpada } = await cenario();
        const irmas = modelo.linhas.filter((l) => l.recusadaJuntoCom);
        expect(irmas).toHaveLength(199);
        for (const irma of irmas) {
            expect(irma.motivo).not.toBe(MOTIVO_DA_CULPADA);
            expect(irma.motivo).toContain('Feição «P300»');
            expect(irma.recusadaJuntoCom.operationId).toBe(culpada.id);
            expect(irma.classe).toBe(PendenciaClasse.JUNTO);
        }
        const daCulpada = modelo.linhas.find((l) => l.operationId === culpada.id);
        expect(daCulpada.motivo).toBe(MOTIVO_DA_CULPADA);
        expect(daCulpada.classe).toBe(PendenciaClasse.CONFLITO);
        expect(daCulpada.levouJunto).toBe(199);
        expect(daCulpada.recusadaJuntoCom).toBeFalsy();
    });

    it('os contadores e o resumo dizem quantas foram recusadas por causa de uma só', async () => {
        const { modelo } = await cenario();
        expect(contadoresVisiveis(modelo.contadores)).toEqual([
            { classe: PendenciaClasse.CONFLITO, label: 'Conflito', quantidade: 1 },
            { classe: PendenciaClasse.JUNTO, label: 'Recusada junto', quantidade: 199 },
            { classe: PendenciaClasse.DEPENDENCIA, label: 'Aguardando outra', quantidade: 50 },
        ]);
        expect(modelo.juntos).toEqual({ recusadas: 199, culpadas: 1, paradas: 50 });
        const resumo = juntoResumo(modelo.juntos);
        expect(resumo).toContain('199 alterações foram recusadas só por irem junto com 1');
        expect(resumo).toContain('50');
    });

    it('a parada atrás da parte recusada nomeia a feição, nunca o id da operação', async () => {
        const { modelo } = await cenario();
        const paradas = modelo.linhas.filter((l) => l.classe === PendenciaClasse.DEPENDENCIA);
        expect(paradas).toHaveLength(50);
        for (const parada of paradas) {
            expect(parada.bloqueio).toBe('Parada atrás de Feição «P399», no mapa «Mapa Tático».');
            expect(parada.bloqueio).not.toContain(parada.bloqueadaPor);
        }
    });

    it('aceitar o servidor numa irmã decide o GRUPO INTEIRO: culpada, irmãs e paradas', async () => {
        const { queue, modelo, culpada } = await cenario();
        const irma = modelo.linhas.find((l) => l.recusadaJuntoCom);
        const ids = idsQueSaemJunto(irma, modelo.linhas);
        expect(ids).toHaveLength(250);
        expect(ids[0]).toBe(irma.operationId);
        expect(ids).toContain(culpada.id);
        // E o mesmo grupo pela culpada.
        const daCulpada = modelo.linhas.find((l) => l.operationId === culpada.id);
        expect(new Set(idsQueSaemJunto(daCulpada, modelo.linhas))).toEqual(new Set(ids));
        // A pergunta diz o tamanho e de onde ele vem.
        const pergunta = confirmacaoDeAceitar(ids.length, { doGrupo: true });
        expect(pergunta.confirmar).toBe('Descartar 250 alterações');
        expect(pergunta.mensagem).toContain('249');
        expect(pergunta.mensagem).toContain('voltaram junto');

        await aceitarOServidor(irma, modelo.linhas, { queue, engine: motorFalso() });

        expect(await queue.getProblems()).toEqual([]);
        expect(await queue.countByState()).toMatchObject({ pendentes: 0, problemas: 0 });
    });

    it('a irmã tem "Aceitar o servidor" e não "Reaplicar": ela não foi recusada por ela mesma', async () => {
        const { modelo } = await cenario();
        const irma = modelo.linhas.find((l) => l.recusadaJuntoCom);
        const acoes = acoesDaLinha(irma, { online: true, permissao: () => ({ allowed: true }) }).map((a) => a.acao);
        expect(acoes).toEqual(['exportar', 'aceitar']);
    });

    it('CONTROLE: recusa sem lote (sem batchFailedOperationId) continua uma linha só, com o próprio motivo', () => {
        const op = {
            id: 'op-solta', entityType: 'feature', entityId: 'f-solta', operationType: 'update', mapId: 'mapa-1',
            data: { properties: { id: 'f-solta', nome: 'Solta' } },
        };
        const modelo = montarPendencias({
            problemas: [{ operation: op, result: { rejected: true, reason: 'Recusada.' }, classe: 'recusa', bloqueadaPor: null }],
        });
        expect(modelo.linhas[0].motivo).toBe('Recusada.');
        expect(modelo.linhas[0].classe).toBe(PendenciaClasse.RECUSA);
        expect(modelo.juntos).toEqual({ recusadas: 0, culpadas: 0, paradas: 0 });
        expect(juntoResumo(modelo.juntos)).toBeNull();
        expect(idsQueSaemJunto(modelo.linhas[0], modelo.linhas)).toEqual(['op-solta']);
    });
});
