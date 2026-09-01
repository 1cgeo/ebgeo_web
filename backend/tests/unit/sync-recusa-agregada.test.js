// Path: tests/unit/sync-recusa-agregada.test.js
// A recusa POR OPERACAO era o unico caminho em que este produto joga fora trabalho do
// usuario DE PROPOSITO e nao escreve nada em lugar nenhum: `operationDenialReason`,
// `lockedMapDenialReason`, `foreignAtlasDenialReason`, `unknownTargetDenialReason` e
// `unseenResourceDenialReason` descartam a op, o lote responde 200 e o servidor nao guarda
// traco. O SyncLedger cobriria isso e morre em producao por gate de ambiente, entao em
// producao nao havia evidencia nenhuma: um usuario que relatasse "a fila congelou" ou "a
// edicao sumiu" nao podia ser confirmado nem desmentido.
//
// A ASSERCAO E SOBRE O OBJETO QUE O CODIGO MONTA, nunca sobre a saida do pino. Sob
// NODE_ENV=test o logger esta em level 'silent', entao um teste que espiasse o stream
// passaria verde com a linha nunca sendo montada. E o mesmo motivo pelo qual
// `queryLogPayload` e `dbErrorLogPayload` existem separados dos seus hooks em
// src/database/index.js, e este arquivo copia a forma de proposito.
//
// A DECISAO DE NIVEL E TESTADA CONTRA A FUNCAO REAL, nao contra a prosa dela: o caso
// "fica fora do relatorio de erros" importa `ehErro` de src/utils/diag-consulta.js e o
// executa sobre o registro que o pino escreveria. Ele vem com controle proprio no mesmo
// bloco (o mesmo registro COM `err` volta verdadeiro), senao o falso seria indistinguivel
// de um `ehErro` que negasse tudo.
//
// O IRMAO DE INTEGRACAO e tests/integration/sync-recusa-agregada.test.js, que dirige o
// `pushOperations` de verdade contra o banco: este arquivo prova a MONTAGEM, aquele prova a
// FIACAO (que a recusa chega ao acumulador e que o acumulador vira a linha).
//
// CONTROLE NEGATIVO (2026-09-01), revertido peca por peca, uma de cada vez, com a
// contagem e a mensagem COMO OBSERVADAS:
//   - `refusedOpsLogPayload` devolvendo `null` incondicionalmente (o estado ANTERIOR a esta
//     mudanca, em que nada era registrado): 11 dos 13 casos vermelhos, o primeiro em
//     «uma op recusada tem de produzir a linha». Os dois que sobrevivem sao justamente os
//     do lote LIMPO, que esperam `null`, e essa e a razao de eles existirem: sozinhos, eles
//     passariam verde num codigo que nunca registra nada.
//   - a agregacao trocada por uma linha por recusa (`grupo.total = 1` fixo): 3 vermelhos, o
//     primeiro «tres recusas do mesmo motivo sao UM grupo com total 3», que e a propriedade
//     que impede o log de virar alvo do proprio defeito.
//   - o corte de grupos (`RECUSAS_MAX_GRUPOS`) desligado: 1 vermelho, «a cota de grupos
//     corta e ANUNCIA o corte», mensagem «a lista de grupos e limitada».
//   - `statusCode: 400` acrescentado ao payload: 1 vermelho, «a linha fica FORA do
//     relatorio de erros», mensagem «a linha agregada nao pode entrar em `diag -- erros`».

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  refusedOpsLogPayload,
  logRefusedOps,
  MSG_RECUSA_DE_LOTE,
} from '../../src/modules/sync/sync.service.js';
import { ehErro } from '../../src/utils/diag-consulta.js';

const recusa = (over = {}) => ({
  reason: 'O mapa está bloqueado e não aceita edições',
  target: 'feature',
  type: 'update',
  mapId: 'map-1',
  clientId: 'cli-1',
  ...over,
});

describe('a linha agregada de recusa por operação', () => {
  it('a recusa unica vira uma linha, com o motivo, o alvo e o denominador do lote', () => {
    const p = refusedOpsLogPayload({
      atlasId: 'atlas-9',
      userId: 'user-7',
      via: 'rest',
      batchSize: 4,
      refusals: [recusa()],
    });

    assert.ok(p, 'uma op recusada tem de produzir a linha');
    assert.equal(p.atlasId, 'atlas-9');
    assert.equal(p.userId, 'user-7');
    assert.equal(p.via, 'rest');
    assert.equal(p.recusadas, 1, 'a contagem de recusadas');
    assert.equal(p.doLote, 4, 'o denominador: 1 de 4 e outro fato que 4 de 4');
    assert.deepEqual(p.clientes, ['cli-1']);
    assert.equal(p.grupos.length, 1, 'um motivo, um grupo');
    assert.deepEqual(p.grupos[0], {
      motivo: 'O mapa está bloqueado e não aceita edições',
      alvo: 'feature',
      operacao: 'update',
      total: 1,
      mapas: ['map-1'],
    });
    assert.equal(p.gruposOmitidos, 0);
  });

  it('tres recusas do mesmo motivo sao UM grupo com total 3, nao tres linhas', () => {
    const p = refusedOpsLogPayload({
      atlasId: 'atlas-9',
      batchSize: 3,
      refusals: [
        recusa({ mapId: 'map-1' }),
        recusa({ mapId: 'map-2' }),
        recusa({ mapId: 'map-1' }),
      ],
    });

    assert.ok(p, 'o lote com recusa produz linha');
    assert.equal(p.recusadas, 3, 'as tres entram na contagem');
    assert.equal(p.grupos.length, 1, 'e num grupo so: agrupar por motivo e o que impede a enxurrada');
    assert.equal(p.grupos[0].total, 3);
    assert.deepEqual(p.grupos[0].mapas, ['map-1', 'map-2'], 'mapas distintos, sem repetir');
  });

  it('motivos diferentes no mesmo lote saem em grupos separados, do mais frequente ao menos', () => {
    const p = refusedOpsLogPayload({
      atlasId: 'atlas-9',
      batchSize: 5,
      refusals: [
        recusa({ reason: 'Apenas o dono do atlas pode bloquear ou desbloquear um mapa', target: 'map', type: 'update' }),
        recusa(),
        recusa(),
        recusa(),
      ],
    });

    assert.ok(p, 'o lote com recusa produz linha');
    assert.equal(p.recusadas, 4);
    assert.equal(p.grupos.length, 2, 'dois motivos, dois grupos');
    assert.equal(p.grupos[0].total, 3, 'o mais frequente vem primeiro');
    assert.equal(p.grupos[0].alvo, 'feature');
    assert.equal(p.grupos[1].total, 1);
    assert.equal(p.grupos[1].alvo, 'map');
    assert.equal(p.grupos[1].operacao, 'update');
    assert.match(p.grupos[1].motivo, /bloquear ou desbloquear/);
  });

  it('o lote LIMPO nao produz linha nenhuma', () => {
    assert.equal(
      refusedOpsLogPayload({ atlasId: 'atlas-9', batchSize: 12, refusals: [] }),
      null,
      'lote sem recusa nao escreve nada'
    );
    assert.equal(
      logRefusedOps({ atlasId: 'atlas-9', batchSize: 12, refusals: [] }),
      null,
      'e o escritor devolve null, ou seja, nada foi para o log'
    );
    assert.equal(
      refusedOpsLogPayload({ atlasId: 'atlas-9', batchSize: 12 }),
      null,
      'sem a lista tambem nao'
    );
  });

  it('o escritor devolve o MESMO objeto que o montador, para o lote que teve recusa', () => {
    const args = { atlasId: 'atlas-9', batchSize: 1, refusals: [recusa()] };
    assert.deepEqual(logRefusedOps(args), refusedOpsLogPayload(args));
    assert.equal(MSG_RECUSA_DE_LOTE, 'sync: operacoes recusadas no lote');
  });

  it('a linha fica FORA do relatorio de erros, e o `ehErro` real e quem diz isso', () => {
    const p = refusedOpsLogPayload({ atlasId: 'atlas-9', batchSize: 1, refusals: [recusa()] });
    assert.ok(p, 'a linha existe');
    // O registro como o pino o escreveria: nivel 40 (`warn`) mais o payload.
    const registro = { level: 40, time: Date.now(), msg: MSG_RECUSA_DE_LOTE, ...p };

    assert.equal(
      ehErro(registro),
      false,
      'a linha agregada nao pode entrar em `diag -- erros`: recusar escrita em mapa travado '
      + 'e o produto funcionando, e afogar o 500 raro nisso inverte o relatorio'
    );
    assert.equal(p.err, undefined, 'sem `err`: e o segundo termo de ehErro');
    assert.equal(p.statusCode, undefined, 'sem `statusCode`: e o terceiro');

    // CONTROLE do proprio controle: o mesmo registro COM `err` volta verdadeiro. Sem isto,
    // o `false` acima seria indistinguivel de um `ehErro` que negasse qualquer coisa.
    assert.equal(
      ehErro({ ...registro, err: { type: 'Error', message: 'x' } }),
      true,
      'ehErro discrimina de verdade'
    );
    assert.equal(ehErro({ ...registro, level: 50 }), true, 'e reage ao nivel');
  });

  it('nao carrega payload: so identificador, motivo e contagem', () => {
    const p = refusedOpsLogPayload({
      atlasId: 'atlas-9',
      batchSize: 1,
      refusals: [{
        ...recusa(),
        // O que o chamador tem em maos na hora da recusa, e que NAO pode viajar.
        data: { geometry: { type: 'Point', coordinates: [-47.9, -15.8] } },
        changes: { texto: 'posicao do 2o Pelotao', nome: 'PC do Batalhao' },
      }],
    });

    assert.ok(p, 'a linha existe');
    const serializado = JSON.stringify(p);
    assert.equal(serializado.includes('2o Pelotao'), false, 'texto de comentario nao vai ao log');
    assert.equal(serializado.includes('PC do Batalhao'), false, 'nome de feicao nao vai ao log');
    assert.equal(serializado.includes('coordinates'), false, 'geometria nao vai ao log');
    assert.deepEqual(
      Object.keys(p.grupos[0]).sort(),
      ['alvo', 'mapas', 'motivo', 'operacao', 'total'],
      'o grupo tem exatamente os campos declarados'
    );
  });

  it('a cota de grupos corta e ANUNCIA o corte', () => {
    // Quinze motivos distintos, que e a forma que um cliente hostil produz de graca:
    // `unknownTargetDenialReason` interpola o entityType que ele mesmo escreveu.
    const refusals = Array.from({ length: 15 }, (_, i) => recusa({
      reason: `Alteração descartada: este servidor não conhece o tipo de entidade "t${i}".`,
      target: `t${i}`,
      type: 'create',
    }));
    const p = refusedOpsLogPayload({ atlasId: 'atlas-9', batchSize: 15, refusals });

    assert.ok(p, 'a linha existe');
    assert.equal(p.recusadas, 15, 'a contagem TOTAL nao e cortada, so a lista');
    assert.equal(p.grupos.length, 12, 'a lista de grupos e limitada');
    assert.equal(p.gruposOmitidos, 3, 'e o corte e declarado, nunca silencioso');
  });

  it('trunca texto vindo do cliente e limita a lista de mapas', () => {
    const alvoLongo = 'x'.repeat(200);
    const refusals = Array.from({ length: 8 }, (_, i) => recusa({
      target: alvoLongo,
      mapId: `map-${i}`,
    }));
    const p = refusedOpsLogPayload({ atlasId: 'atlas-9', batchSize: 8, refusals });

    assert.ok(p, 'a linha existe');
    assert.equal(p.grupos[0].alvo.length, 63, 'alvo cortado em 60 mais as reticencias');
    assert.equal(p.grupos[0].alvo.endsWith('...'), true, 'e o corte e visivel na string');
    assert.equal(p.grupos[0].mapas.length, 5, 'no maximo cinco mapas por grupo');
    assert.equal(p.grupos[0].mapasOmitidos, 3, 'os demais sao contados');
    assert.equal(p.grupos[0].total, 8, 'e a contagem do grupo nao e afetada pela cota de mapas');
  });

  it('o MOTIVO tem teto proprio: a frase do servidor cabe inteira, e a absurda ainda e cortada', () => {
    // O motivo real mais longo deste arquivo, com a parte controlada pelo cliente ja
    // truncada em 40 pelo proprio `unknownTargetDenialReason`. Cortar isto em 60 entregava
    // «este servidor nao conhece o tipo de en...» a quem investiga.
    const motivoReal = 'Alteração descartada: este servidor não conhece o tipo de entidade "camadaInventada".';
    const p = refusedOpsLogPayload({
      atlasId: 'a',
      batchSize: 2,
      refusals: [
        recusa({ reason: motivoReal }),
        recusa({ reason: 'z'.repeat(300), target: 'layer' }),
      ],
    });

    assert.ok(p, 'a linha existe');
    assert.equal(p.grupos.length, 2, 'dois motivos distintos');
    const inteiro = p.grupos.find((g) => g.motivo === motivoReal);
    assert.ok(inteiro, 'a frase do servidor viaja inteira, sem reticencias');
    const cortado = p.grupos.find((g) => g.alvo === 'layer');
    assert.ok(cortado, 'o grupo do motivo absurdo existe');
    assert.equal(cortado.motivo.length, 203, 'e ele e cortado em 200 mais as reticencias');
  });

  it('resiste a op sem mapa, sem cliente e sem tipo', () => {
    const p = refusedOpsLogPayload({
      atlasId: 'atlas-9',
      userId: null,
      batchSize: 1,
      refusals: [{ reason: 'Alteração descartada: ela pertence a outro projeto.' }],
    });

    assert.ok(p, 'a linha existe mesmo com a op quase vazia');
    assert.equal(p.userId, null, 'anonimo sai como null, nao como a string "null"');
    assert.deepEqual(p.clientes, []);
    assert.equal(p.clientesOmitidos, 0);
    assert.deepEqual(p.grupos[0].mapas, []);
    assert.equal(p.grupos[0].alvo, '(sem alvo)');
    assert.equal(p.grupos[0].operacao, '(sem tipo)');
  });

  it('e DETERMINISTICA: empate de contagem desempata pela chave, nao pela ordem de chegada', () => {
    const a = recusa({ reason: 'aaa', target: 'feature', type: 'create' });
    const b = recusa({ reason: 'bbb', target: 'layer', type: 'delete' });
    const base = { atlasId: 'atlas-9', batchSize: 2 };

    const p1 = refusedOpsLogPayload({ ...base, refusals: [a, b] });
    const p2 = refusedOpsLogPayload({ ...base, refusals: [b, a] });
    assert.ok(p1 && p2, 'as duas linhas existem');
    assert.deepEqual(p1.grupos, p2.grupos, 'a mesma falha produz a mesma linha nas duas ordens');
    assert.equal(p1.grupos[0].motivo, 'aaa', 'e o desempate e pela chave');
  });

  it('a porta viaja na linha, porque a investigacao precisa saber por onde a fila empurrava', () => {
    const rest = refusedOpsLogPayload({ atlasId: 'a', batchSize: 1, refusals: [recusa()] });
    const ws = refusedOpsLogPayload({ atlasId: 'a', via: 'ws', batchSize: 1, refusals: [recusa()] });
    assert.ok(rest && ws, 'as duas linhas existem');
    assert.equal(rest.via, 'rest', 'o default e a porta HTTP');
    assert.equal(ws.via, 'ws');
  });
});
