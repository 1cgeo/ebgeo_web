// Path: tests/integration/pendencias-acoes.test.js
//
// AS AÇÕES DO PAINEL DE PENDÊNCIAS, dirigidas contra a FILA DE VERDADE (`fake-indexeddb`) e contra
// o registro global de quarentena, e não contra dublês: o que se está afirmando é o efeito em
// disco, e um duplo de fila concordaria com qualquer implementação.
//
// O que cada bloco prova, e o controle negativo que o acompanha:
//  - aceitar o servidor tira a tentativa E os dependentes dela (controle: tirar só o alvo deixa o
//    dependente na fila, que é o defeito que o ajudante existe para impedir);
//  - reaplicar cria op NOVA com a base que o servidor informou e DEIXA a antiga (controle: sem a
//    recarimbagem, a op nova declara a base velha, que é a que já perdeu a disputa);
//  - exportar carrega o envelope inteiro (controle: um resumo sem `envelope` perde o `data`, que é
//    o trabalho da pessoa);
//  - a tabela de afordância: o POSTO some, o ESTADO desenha e recusa.

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    GlobalKey,
    StoreName,
    getGlobalStore,
    getStoreFor,
    remoteScope,
} from '@store/atlas-namespace.js';
import { OperationQueue } from '@store/sync/operation-queue.js';
import { listQuarantinedOperations } from '@store/sync/quarantine-registry.js';
import { montarPendencias } from '@js/account/pendencias/pendencias-rows.js';
import {
    PendenciaAcao,
    PendenciaBloqueio,
    PendenciaClasse,
    PendenciaOrigem,
} from '@js/account/pendencias/pendencias-phrases.js';
import {
    aceitarOServidor,
    acoesDaLinha,
    baseReobservada,
    conteudoDeExportacao,
    descartarTentativa,
    idsQueSaemJunto,
    podeReaplicar,
    reaplicarComNovaBase,
} from '@js/account/pendencias/pendencias-acoes.js';

const ATLAS = '44444444-4444-4444-8444-444444444444';
const scope = remoteScope(ATLAS);

const conflito = (entityVersion = 8) => ({
    rejected: true,
    status: 'conflict',
    reason: 'Os mesmos campos foram alterados no servidor.',
    conflict: { fields: ['nome'], entityVersion, serverData: null },
});

/** Uma fila real, no escopo de um atlas de servidor, com o conteúdo pedido. */
async function filaCom(operacoes, problemas = []) {
    await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
    const queue = new OperationQueue(scope);
    await queue.enqueueAll(operacoes);
    for (const [operacao, resultado] of problemas) await queue.recordIssue(operacao, resultado);
    return queue;
}

/** As linhas do painel a partir de uma fila real. */
async function linhasDe(queue) {
    return montarPendencias({ problemas: await queue.getProblems() }).linhas;
}

const opDeCamada = (extra = {}) => ({
    protocolVersion: 2,
    id: 'op-conflito',
    entityType: 'layer',
    entityId: 'camada-1',
    operationType: 'update',
    mapId: 'mapa-1',
    timestamp: 1_700_000_000_000,
    lamportTimestamp: 1,
    data: { id: 'camada-1', name: 'Talhão 3', visible: true },
    previousData: { id: 'camada-1', name: 'Talhão 2', visible: true, confirmedVersion: 5 },
    ...extra,
});

const motorFalso = () => {
    const chamadas = { resync: 0, flush: 0 };
    return {
        chamadas,
        resync: async () => { chamadas.resync += 1; },
        flush: async () => { chamadas.flush += 1; },
    };
};

describe('aceitar o servidor', () => {
    beforeEach(async () => {
        await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
    });

    it('remove a tentativa E o que estava parado atrás dela, e pede o estado atual', async () => {
        const alvo = opDeCamada();
        const queue = await filaCom(
            [
                alvo,
                { ...opDeCamada(), id: 'op-dependente', lamportTimestamp: 2, data: { name: 'Talhão 4' } },
                { protocolVersion: 2, id: 'op-livre', entityId: 'outra', entityType: 'map', lamportTimestamp: 3 },
            ],
            [[alvo, conflito()]],
        );
        const linhas = await linhasDe(queue);
        expect(linhas.map((linha) => [linha.operationId, linha.classe])).toEqual([
            ['op-conflito', PendenciaClasse.CONFLITO],
            ['op-dependente', PendenciaClasse.DEPENDENCIA],
        ]);

        const engine = motorFalso();
        const resultado = await aceitarOServidor(linhas[0], linhas, { queue, engine });

        expect(resultado).toEqual({ removidas: 2, ressincronizou: true });
        expect(engine.chamadas.resync).toBe(1);
        expect(await queue.getIssues()).toHaveLength(0);
        expect((await queue.peek()).map((op) => op.id)).toEqual(['op-livre']);
    });

    it('CONTROLE NEGATIVO: tirar só o alvo deixa o dependente parado na fila', async () => {
        const alvo = opDeCamada();
        const queue = await filaCom(
            [alvo, { ...opDeCamada(), id: 'op-dependente', lamportTimestamp: 2 }],
            [[alvo, conflito()]],
        );
        // É exatamente o que uma implementação sem `idsQueSaemJunto` faria.
        await queue.dequeue(['op-conflito']);
        const sobrou = await queue.getAll();
        expect(sobrou.map((op) => op.id)).toEqual(['op-dependente']);
    });

    it('não some com nada quando a linha não tem operação', async () => {
        const queue = await filaCom([opDeCamada()]);
        const engine = motorFalso();
        const resultado = await aceitarOServidor({ operationId: null }, [], { queue, engine });
        expect(resultado).toEqual({ removidas: 0, ressincronizou: false });
        expect(engine.chamadas.resync).toBe(0);
        expect(await queue.getAll()).toHaveLength(1);
    });

    it('a remoção vale mesmo quando o resync falha, e diz que não ressincronizou', async () => {
        const alvo = opDeCamada();
        const queue = await filaCom([alvo], [[alvo, conflito()]]);
        const engine = { resync: async () => { throw new Error('sem rede'); } };
        const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const resultado = await aceitarOServidor(
            (await linhasDe(queue))[0], await linhasDe(queue), { queue, engine }
        );
        expect(resultado).toEqual({ removidas: 1, ressincronizou: false });
        expect(await queue.getAll()).toHaveLength(0);
        aviso.mockRestore();
    });
});

describe('reaplicar como operação nova', () => {
    it('enfileira uma op NOVA com a base que o servidor informou e DEIXA a antiga', async () => {
        const alvo = opDeCamada();
        const queue = await filaCom([alvo], [[alvo, conflito(8)]]);
        const linha = (await linhasDe(queue))[0];
        expect(podeReaplicar(linha)).toBe(true);

        const engine = motorFalso();
        const { operacao, enviou } = await reaplicarComNovaBase(linha, { queue, engine, online: true });

        expect(enviou).toBe(true);
        expect(engine.chamadas).toEqual({ flush: 1, resync: 1 });
        expect(operacao.id).not.toBe(alvo.id);
        // A BASE NOVA é a revisão do recibo, e não a que a tentativa tinha observado.
        expect(operacao.baseVersion).toBe(8);
        expect(alvo.previousData.confirmedVersion).toBe(5);
        // O PATCH continua descrevendo o que a PESSOA mexeu, calculado contra o que ela via.
        expect(operacao.patch).toEqual([{ op: 'set', path: ['name'], value: 'Talhão 3' }]);
        expect(operacao.data).toEqual(alvo.data);

        // A antiga fica onde está, com o problema dela: apagá-la aqui perderia o conteúdo se a
        // nova também for recusada.
        const naFila = await queue.getAll();
        expect(naFila.map((op) => op.id).sort()).toEqual([operacao.id, 'op-conflito'].sort());
        expect((await queue.getIssues()).map((registro) => registro.operation.id)).toEqual(['op-conflito']);
    });

    it('CONTROLE NEGATIVO: sem a recarimbagem, a op nova declara a base que já perdeu', () => {
        const envelope = opDeCamada();
        expect(baseReobservada(envelope, 8).confirmedVersion).toBe(8);
        // Sem `baseReobservada`, o `previousData` guardado entra como está.
        expect(envelope.previousData.confirmedVersion).toBe(5);
    });

    it('carimba a revisão dentro de properties quando a entidade é feição', () => {
        const feicao = {
            entityType: 'feature',
            previousData: { properties: { nome: 'Ponto A', confirmedVersion: 2 }, geometry: null },
        };
        const base = baseReobservada(feicao, 9);
        expect(base.properties.confirmedVersion).toBe(9);
        expect(base.confirmedVersion).toBeUndefined();
        // Clonado: mexer na base não pode mexer na tentativa guardada.
        expect(feicao.previousData.properties.confirmedVersion).toBe(2);
    });

    it('sem conexão, ela fica na fila e NÃO chama o motor', async () => {
        const alvo = opDeCamada();
        const queue = await filaCom([alvo], [[alvo, conflito()]]);
        const engine = motorFalso();
        const { enviou } = await reaplicarComNovaBase(
            (await linhasDe(queue))[0], { queue, engine, online: false }
        );
        expect(enviou).toBe(false);
        expect(engine.chamadas).toEqual({ flush: 0, resync: 0 });
        expect(await queue.getAll()).toHaveLength(2);
    });

    it('recusa reaplicar o que não é disputa de atualização com base', async () => {
        const recusada = { ...opDeCamada(), id: 'op-recusa' };
        const queue = await filaCom([recusada], [[recusada, { rejected: true, reason: 'Sem permissão' }]]);
        const linhaDeRecusa = (await linhasDe(queue))[0];
        expect(podeReaplicar(linhaDeRecusa)).toBe(false);
        await expect(reaplicarComNovaBase(linhaDeRecusa, { queue })).rejects.toThrow(/não pode ser reaplicada/);

        // Create não tem patch por contrato; entidade sem unidade de disputa não declara base;
        // recibo sem `entityVersion` não tem base a declarar; e a quarentena não tem fila.
        const semContrato = { ...opDeCamada(), entityType: 'groupFeature' };
        const base = { classe: PendenciaClasse.CONFLITO, origem: PendenciaOrigem.FILA };
        expect(podeReaplicar({ ...base, envelope: { ...opDeCamada(), operationType: 'create' }, resultado: conflito() })).toBe(false);
        expect(podeReaplicar({ ...base, envelope: semContrato, resultado: conflito() })).toBe(false);
        expect(podeReaplicar({ ...base, envelope: opDeCamada(), resultado: { conflict: {} } })).toBe(false);
        expect(podeReaplicar({ ...base, origem: PendenciaOrigem.QUARENTENA, envelope: opDeCamada(), resultado: conflito() })).toBe(false);
    });

    // OS ATRIBUTOS POR CHAVE (decisão do dono em 2026-09-24). A tentativa foi gravada na fila no
    // formato ANTIGO, com o objeto `attributes` inteiro, e recusada porque o colega excluiu "x" da
    // mesma feição. Reaplicada, ela levava o objeto inteiro de novo, com "x" dentro, e ressuscitava
    // o atributo que o colega tinha excluído. O patch da op nova é recalculado pela diferença entre
    // o que a pessoa viu e o que ela gravou, e agora sai só com a chave que ela mexeu.
    it('reaplicar uma edição de atributo leva só a chave que a pessoa mexeu, e não ressuscita a excluída', async () => {
        const feicao = (attributes, confirmedVersion) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
            properties: { id: 'feicao-1', source: 'point', nome: 'Posto', attributes, confirmedVersion },
        });
        const antiga = {
            protocolVersion: 2,
            id: 'op-atributo',
            entityType: 'feature',
            operationType: 'update',
            entityId: 'feicao-1',
            mapId: 'mapa-1',
            timestamp: 1,
            lamportTimestamp: 1,
            clientId: 'c1',
            baseVersion: 3,
            previousData: feicao({ x: 'um', y: 'um' }, 3),
            data: feicao({ x: 'um', y: 'dois' }, 3),
            patch: [{ op: 'set', path: ['properties', 'attributes'], value: { x: 'um', y: 'dois' } }],
        };
        const queue = await filaCom([antiga], [[antiga, {
            rejected: true,
            status: 'conflict',
            reason: 'Os mesmos campos foram alterados no servidor.',
            conflict: { fields: [['properties', 'attributes']], entityVersion: 4, serverData: null },
        }]]);
        const linha = (await linhasDe(queue))[0];
        expect(podeReaplicar(linha)).toBe(true);

        const { operacao } = await reaplicarComNovaBase(linha, { queue, online: false });
        expect(operacao.baseVersion).toBe(4);
        expect(operacao.patch).toEqual([{ op: 'set', path: ['properties', 'attributes', 'y'], value: 'dois' }]);
    });
});

describe('exportar', () => {
    it('leva o envelope inteiro e o motivo, não um resumo', async () => {
        const alvo = opDeCamada();
        const queue = await filaCom([alvo], [[alvo, conflito()]]);
        const linhas = await linhasDe(queue);

        const documento = conteudoDeExportacao(linhas, Date.UTC(2026, 8, 13));
        expect(documento.formato).toBe('ebgeo-pendencias');
        expect(documento.exportadoEm).toBe('2026-09-13T00:00:00.000Z');
        expect(documento.tentativas).toHaveLength(1);

        const [tentativa] = documento.tentativas;
        expect(tentativa.classe).toBe(PendenciaClasse.CONFLITO);
        expect(tentativa.motivo).toBe('Os mesmos campos foram alterados no servidor.');
        expect(tentativa.unidades).toEqual(['nome']);
        // CONTROLE NEGATIVO DO FORMATO: é o `data` do envelope que carrega o trabalho da pessoa, e
        // um resumo que o omitisse exportaria a existência da pendência, não o conteúdo dela.
        expect(tentativa.envelope.data).toEqual({ id: 'camada-1', name: 'Talhão 3', visible: true });
        expect(tentativa.resultado.conflict.entityVersion).toBe(8);
        expect(() => JSON.stringify(documento)).not.toThrow();
    });

    it('o documento é uma cópia: mexer nele não mexe na fila em memória', async () => {
        const alvo = opDeCamada();
        const queue = await filaCom([alvo], [[alvo, conflito()]]);
        const linhas = await linhasDe(queue);
        const documento = conteudoDeExportacao(linhas);
        documento.tentativas[0].envelope.data.name = 'mexido';
        expect(linhas[0].envelope.data.name).toBe('Talhão 3');
    });
});

describe('descartar', () => {
    it('esquece UMA operação da quarentena preservada e apaga o registro quando ele esvazia', async () => {
        const globalStore = getGlobalStore();
        const chave = `${GlobalKey.QUARANTINE_PREFIX}${ATLAS}`;
        await globalStore.setItem(chave, {
            version: 1,
            atlasId: ATLAS,
            savedAt: 500,
            operations: [
                { operation: { ...opDeCamada(), id: 'q1' }, issue: conflito(), recordedAt: 400 },
                { operation: { ...opDeCamada(), id: 'q2' }, issue: { rejected: true, status: 'review' }, recordedAt: 401 },
            ],
        });

        const modelo = montarPendencias({ quarentena: await listQuarantinedOperations(ATLAS) });
        expect(modelo.linhas).toHaveLength(2);
        const primeira = modelo.linhas.find((linha) => linha.operationId === 'q1');

        expect(await descartarTentativa(primeira, modelo.linhas)).toEqual({ removidas: 1 });
        const sobrou = await listQuarantinedOperations(ATLAS);
        expect(sobrou.map((entrada) => entrada.operation.id)).toEqual(['q2']);

        const segunda = montarPendencias({ quarentena: sobrou }).linhas[0];
        expect(await descartarTentativa(segunda, [segunda])).toEqual({ removidas: 1 });
        expect(await listQuarantinedOperations(ATLAS)).toEqual([]);
        expect(await globalStore.getItem(chave)).toBeNull();
    });

    it('descartar da FILA tira a tentativa e os dependentes, sem falar com o servidor', async () => {
        const alvo = { ...opDeCamada(), protocolVersion: 1, id: 'op-antiga' };
        const queue = await filaCom(
            [alvo, { ...opDeCamada(), id: 'op-atras', lamportTimestamp: 2 }],
            [[alvo, { rejected: true, status: 'review', reason: 'Versão incompatível.' }]],
        );
        const linhas = await linhasDe(queue);
        expect(linhas[0].classe).toBe(PendenciaClasse.REVISAO);

        expect(await descartarTentativa(linhas[0], linhas, { queue })).toEqual({ removidas: 2 });
        expect(await queue.getAll()).toHaveLength(0);
    });
});

describe('a tabela de afordância: o POSTO some, o ESTADO recusa o clique', () => {
    const permiteTudo = () => ({ allowed: true });
    const negaTudo = () => ({ allowed: false, required: 'canEdit' });

    const linhaDeConflito = () => ({
        classe: PendenciaClasse.CONFLITO,
        origem: PendenciaOrigem.FILA,
        operationId: 'op-conflito',
        mapa: { id: 'mapa-1', nome: 'Principal' },
        envelope: opDeCamada(),
        resultado: conflito(),
    });

    const nomes = (acoes) => acoes.map((item) => item.acao);

    it('conflito com conexão e sem trava desenha exportar, aceitar e reaplicar', () => {
        const acoes = acoesDaLinha(linhaDeConflito(), { online: true, permissao: permiteTudo });
        expect(nomes(acoes)).toEqual([
            PendenciaAcao.EXPORTAR, PendenciaAcao.ACEITAR, PendenciaAcao.REAPLICAR,
        ]);
        expect(acoes.every((item) => item.bloqueio === null)).toBe(true);
    });

    it('sem conexão, "aceitar" continua DESENHADO e recusa o clique nomeando o estado', () => {
        const acoes = acoesDaLinha(linhaDeConflito(), { online: false, permissao: permiteTudo });
        const aceitar = acoes.find((item) => item.acao === PendenciaAcao.ACEITAR);
        expect(aceitar).toBeDefined();
        expect(aceitar.bloqueio).toBe(PendenciaBloqueio.OFFLINE);
        expect(aceitar.recusa).toMatch(/Sem conexão com o servidor/);
    });

    it('com o mapa travado, "reaplicar" é desenhado e recusa nomeando a trava', () => {
        const acoes = acoesDaLinha(linhaDeConflito(), {
            online: true,
            permissao: permiteTudo,
            mapaTravado: (id) => id === 'mapa-1',
        });
        const reaplicar = acoes.find((item) => item.acao === PendenciaAcao.REAPLICAR);
        expect(reaplicar.bloqueio).toBe(PendenciaBloqueio.MAPA_TRAVADO);
        expect(reaplicar.recusa).toMatch(/bloqueado/);
    });

    it('sem posto para escrever, "reaplicar" NÃO é desenhado', () => {
        const acoes = acoesDaLinha(linhaDeConflito(), { online: true, permissao: negaTudo });
        expect(nomes(acoes)).toEqual([PendenciaAcao.EXPORTAR, PendenciaAcao.ACEITAR]);
    });

    it('dependência bloqueada só exporta: ela não foi recusada por ninguém', () => {
        const acoes = acoesDaLinha({
            classe: PendenciaClasse.DEPENDENCIA,
            origem: PendenciaOrigem.FILA,
            operationId: 'op-atras',
            bloqueadaPor: 'op-conflito',
            envelope: opDeCamada(),
        }, { online: true, permissao: permiteTudo });
        expect(nomes(acoes)).toEqual([PendenciaAcao.EXPORTAR]);
    });

    it('quarentena exporta e descarta; figura só exporta', () => {
        const daQuarentena = acoesDaLinha({
            classe: PendenciaClasse.CONFLITO,
            origem: PendenciaOrigem.QUARENTENA,
            operationId: 'q1',
            envelope: opDeCamada(),
            resultado: conflito(),
        }, { online: true, permissao: permiteTudo });
        expect(nomes(daQuarentena)).toEqual([PendenciaAcao.EXPORTAR, PendenciaAcao.DESCARTAR]);

        for (const classe of [PendenciaClasse.UPLOAD_PENDENTE, PendenciaClasse.UPLOAD_RECUSADO]) {
            const acoes = acoesDaLinha(
                { classe, origem: PendenciaOrigem.UPLOAD, envelope: {} },
                { online: true, permissao: permiteTudo },
            );
            expect(nomes(acoes)).toEqual([PendenciaAcao.EXPORTAR]);
        }
    });

    it('a foto ANEXA recusada ganha "Descartar", que tira a foto da entidade (dono, 2026-09-26)', () => {
        const linha = (envelope) => ({ classe: PendenciaClasse.UPLOAD_RECUSADO, origem: PendenciaOrigem.UPLOAD, envelope });
        const foto = { estado: 'recusado', origem: 'foto-anexa', imageId: 'f1' };

        expect(nomes(acoesDaLinha(linha(foto), { online: true, permissao: permiteTudo })))
            .toEqual([PendenciaAcao.EXPORTAR, PendenciaAcao.DESCARTAR]);
        // O POSTO SOME: quem não edita a entidade não tem o que descartar daqui.
        expect(nomes(acoesDaLinha(linha(foto), { online: true, permissao: () => ({ allowed: false }) })))
            .toEqual([PendenciaAcao.EXPORTAR]);
        // A figura de uma feição de imagem recusada virou problema da operação, e a foto ainda a subir
        // não foi recusada: nenhuma das duas tem esse comando.
        expect(nomes(acoesDaLinha(linha({ estado: 'recusado', origem: 'desenho', imageId: 'i1' }), { online: true, permissao: permiteTudo })))
            .toEqual([PendenciaAcao.EXPORTAR]);
        expect(nomes(acoesDaLinha(
            { classe: PendenciaClasse.UPLOAD_PENDENTE, origem: PendenciaOrigem.UPLOAD, envelope: { ...foto, estado: 'pendente' } },
            { online: true, permissao: permiteTudo },
        ))).toEqual([PendenciaAcao.EXPORTAR]);
    });

    it('quarentena de protocolo na fila exporta e descarta, e nunca reaplica', () => {
        const acoes = acoesDaLinha({
            classe: PendenciaClasse.REVISAO,
            origem: PendenciaOrigem.FILA,
            operationId: 'op-antiga',
            envelope: { ...opDeCamada(), protocolVersion: 1 },
            resultado: { rejected: true, status: 'review' },
        }, { online: true, permissao: permiteTudo });
        expect(nomes(acoes)).toEqual([PendenciaAcao.EXPORTAR, PendenciaAcao.DESCARTAR]);
    });

    it('exportar nunca é bloqueado, em nenhuma classe: é a saída de quem vai descartar', () => {
        const classes = Object.values(PendenciaClasse);
        for (const classe of classes) {
            const acoes = acoesDaLinha(
                { classe, origem: PendenciaOrigem.FILA, operationId: 'x', envelope: opDeCamada() },
                { online: false, permissao: negaTudo },
            );
            const exportar = acoes.find((item) => item.acao === PendenciaAcao.EXPORTAR);
            expect(exportar).toBeDefined();
            expect(exportar.bloqueio).toBeNull();
        }
    });

    it('os dependentes que somem junto são exatamente os que a fila nomeia', () => {
        const linhas = [
            { operationId: 'a', bloqueadaPor: null },
            { operationId: 'b', bloqueadaPor: 'a' },
            { operationId: 'c', bloqueadaPor: 'a' },
            { operationId: 'd', bloqueadaPor: 'outra' },
        ];
        expect(idsQueSaemJunto(linhas[0], linhas)).toEqual(['a', 'b', 'c']);
        expect(idsQueSaemJunto({ operationId: null }, linhas)).toEqual([]);
    });
});

/**
 * B6.1: "Aceitar o servidor" sobre uma PARTE recusada de um lote partido.
 *
 * O DEFEITO (achado de leitura na revisao de 2026-09-24, provado aqui). Acima de 200 o lote parte em
 * blocos e so a PRIMEIRA op do bloco seguinte dependia (`dependsOn`) da ultima do anterior; as
 * outras eram seguradas pelo envenenamento por `batchId` do carregador, que o painel nao ve. Entao
 * aceitar o servidor na op recusada levava so ela e aquela primeira op, e as outras 49 do bloco
 * seguinte saiam no proximo flush, sem a parte recusada.
 */
describe('aceitar o servidor sobre uma parte recusada de um lote partido (B6.1)', () => {
    beforeEach(async () => {
        await getStoreFor(StoreName.OPERATION_QUEUE, scope).clear();
    });

    it('nada do bloco seguinte sai depois de aceitar o servidor numa op da parte recusada', async () => {
        const { createBatchOperations } = await import('@store/sync/operation-factory.js');
        const ops = createBatchOperations(Array.from({ length: 450 }, (_, i) => ({
            entityType: 'feature', operationType: 'create', entityId: `f${i}`, mapId: 'mapa-1',
            data: { type: 'Feature', properties: { id: `f${i}`, source: 'point' } },
        }))).map((op) => ({ ...op, scopeSuffix: scope.dbSuffix }));
        const partes = [...new Set(ops.map((op) => op.batchId))];
        expect(partes).toHaveLength(3);
        const parte = (k) => ops.filter((op) => op.batchId === partes[k]);
        const recusa = { rejected: true, reason: 'O mapa está bloqueado e não aceita edições', batchId: partes[1] };

        // A parte 1 foi aplicada (saiu da fila); a parte 2 foi recusada inteira; a 3 esta retida.
        const queue = await filaCom(ops, parte(1).map((op) => [op, recusa]));
        await queue.dequeue(parte(0).map((op) => op.id));
        expect(await queue.peek(25)).toEqual([]);

        const linhas = await linhasDe(queue);
        const ultimaRecusada = parte(1).at(-1).id;
        const linha = linhas.find((l) => l.operationId === ultimaRecusada);
        await aceitarOServidor(linha, linhas, { queue, engine: motorFalso() });

        // O que sobrou nao pode sair sem a parte recusada: nem as irmas recusadas, nem a parte 3.
        const livres = await queue.peek(25);
        expect(livres.filter((op) => op.batchId === partes[2])).toEqual([]);
        expect(await queue.countByState()).toMatchObject({ pendentes: 0 });
    });

    it('o painel mostra o bloco seguinte INTEIRO como parado atras da parte recusada', async () => {
        const { createBatchOperations } = await import('@store/sync/operation-factory.js');
        const ops = createBatchOperations(Array.from({ length: 450 }, (_, i) => ({
            entityType: 'feature', operationType: 'create', entityId: `g${i}`, mapId: 'mapa-1',
            data: { type: 'Feature', properties: { id: `g${i}`, source: 'point' } },
        }))).map((op) => ({ ...op, scopeSuffix: scope.dbSuffix }));
        const partes = [...new Set(ops.map((op) => op.batchId))];
        const recusa = { rejected: true, reason: 'O mapa está bloqueado e não aceita edições', batchId: partes[1] };
        const queue = await filaCom(ops, ops.filter((op) => op.batchId === partes[1]).map((op) => [op, recusa]));
        await queue.dequeue(ops.filter((op) => op.batchId === partes[0]).map((op) => op.id));
        const problemas = await queue.getProblems();
        expect(problemas).toHaveLength(250);
    });
});
