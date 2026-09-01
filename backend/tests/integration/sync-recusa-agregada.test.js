// Path: tests/integration/sync-recusa-agregada.test.js
// A FIACAO da linha agregada de recusa, contra o banco e pela rota de verdade.
//
// O irmao de unidade (tests/unit/sync-recusa-agregada.test.js) prova a MONTAGEM: dada uma
// lista de recusas, a linha sai agrupada, contada e sem payload. Ele passaria verde com o
// `pushOperations` nunca alimentando essa lista, que e justamente o defeito que existia
// antes: as recusas aconteciam e ninguem as registrava. Este arquivo fecha o outro lado.
//
// COMO ELE OLHA A LINHA, e por que nao pelo stream do pino: sob NODE_ENV=test o logger
// esta em level 'silent', entao nao ha saida para espiar. O que se troca e o METODO
// `logger.warn` do singleton, que e o mesmo objeto que sync.service.js importou, e o que se
// asserta e o objeto que o codigo entregou a ele. O filtro por `MSG_RECUSA_DE_LOTE` e
// necessario porque a recusa por VIOLACAO DE INTEGRIDADE tem um `logger.warn` proprio, com
// o erro cru, que continua existindo de proposito.
//
// CONTROLE NEGATIVO (2026-09-01), com a contagem e a mensagem COMO OBSERVADAS. Retirar a
// chamada de `logRefusedOps` do fim de `pushOperations`: 4 dos 4 casos vermelhos, o
// primeiro com «o servidor tem de registrar a recusa, e UMA vez». Retirar o `recusas.push`
// de dentro de `recusarOperacao` (mantendo a chamada de pe): os MESMOS 4 vermelhos, com a
// mesma primeira mensagem, por outro caminho, porque a lista chega vazia. As duas metades
// precisam estar de pe, e nenhuma delas e observavel pela resposta HTTP, que e 200 nos dois
// casos. Repare que ate o caso do lote LIMPO fica vermelho nas duas reversoes: ele so
// termina depois de conferir que a linha de recusa AINDA sai, e e isso que o impede de ser
// o teste vazio que passa verde quando nada e registrado.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import logger from '../../src/utils/logger.js';
import { MSG_RECUSA_DE_LOTE } from '../../src/modules/sync/sync.service.js';

describe('o servidor DIZ quando descarta trabalho do usuário', () => {
  let app, db, owner, ownerToken, atlas, mapaTravado, mapaLivre;
  let linhas;
  let warnOriginal;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `recusa_own_${randomUUID().slice(0, 8)}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Atlas da Recusa' });
    mapaTravado = await createMap(db, atlas.id, { name: 'Mapa Travado' });
    mapaLivre = await createMap(db, atlas.id, { name: 'Mapa Livre' });
    await db.query('UPDATE maps SET locked = true WHERE id = $1', [mapaTravado.id]);

    warnOriginal = logger.warn.bind(logger);
    logger.warn = (obj, msg) => {
      if (msg === MSG_RECUSA_DE_LOTE) linhas.push(obj);
      return warnOriginal(obj, msg);
    };
  });

  after(async () => {
    logger.warn = warnOriginal;
    await teardownTestEnv(db);
  });

  beforeEach(() => { linhas = []; });

  const push = (operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ operations });

  const feicao = (mapId) => {
    const id = randomUUID();
    return {
      id: randomUUID(),
      entityType: 'feature',
      operationType: 'create',
      entityId: id,
      mapId,
      data: {
        feature_type: 'point',
        geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
        properties: { id, nome: 'PC do Batalhao', descricao: 'posicao do 2o Pelotao' },
      },
      timestamp: Date.now(),
      clientId: 'cli-recusa',
    };
  };

  it('uma op recusada produz exatamente uma linha, com a contagem e o denominador', async () => {
    const res = await push([feicao(mapaTravado.id), feicao(mapaLivre.id)]).expect(200);

    // O contrato NAO muda: 200, um ack por op, a recusada com `rejected`.
    const results = res.body.data.results;
    assert.equal(results.length, 2, 'um ack por operação');
    assert.equal(results.filter((r) => r.success === false).length, 1, 'uma recusada');

    assert.equal(linhas.length, 1, 'o servidor tem de registrar a recusa, e UMA vez');
    const linha = linhas[0];
    assert.equal(linha.atlasId, atlas.id);
    assert.equal(linha.userId, owner.id);
    assert.equal(linha.via, 'rest', 'a porta por onde o lote entrou');
    assert.equal(linha.recusadas, 1);
    assert.equal(linha.doLote, 2, 'o denominador é o lote inteiro');
    assert.equal(linha.grupos.length, 1);
    assert.equal(linha.grupos[0].total, 1);
    assert.equal(linha.grupos[0].alvo, 'feature');
    assert.equal(linha.grupos[0].operacao, 'create');
    assert.match(linha.grupos[0].motivo, /bloqueado/, 'o motivo é o do mapa travado');
    assert.deepEqual(linha.grupos[0].mapas, [mapaTravado.id], 'e nomeia o mapa');
    assert.deepEqual(linha.clientes, ['cli-recusa']);
  });

  it('tres recusas do mesmo motivo saem numa linha so, com a contagem tres', async () => {
    await push([feicao(mapaTravado.id), feicao(mapaTravado.id), feicao(mapaTravado.id)])
      .expect(200);

    assert.equal(linhas.length, 1, 'uma linha por LOTE, nunca uma por operação');
    assert.equal(linhas[0].recusadas, 3);
    assert.equal(linhas[0].grupos.length, 1, 'mesmo motivo, mesmo alvo: um grupo');
    assert.equal(linhas[0].grupos[0].total, 3, 'a contagem é o que substitui as três linhas');
  });

  it('motivos diferentes no mesmo lote saem agrupados a parte', async () => {
    await push([
      feicao(mapaTravado.id),
      feicao(mapaTravado.id),
      {
        id: randomUUID(),
        entityType: 'tipoQueNaoExiste',
        operationType: 'create',
        entityId: randomUUID(),
        mapId: mapaLivre.id,
        data: { qualquer: 'coisa' },
        timestamp: Date.now(),
        clientId: 'cli-recusa',
      },
    ]).expect(200);

    assert.equal(linhas.length, 1, 'ainda uma linha por lote');
    const g = linhas[0].grupos;
    assert.equal(linhas[0].recusadas, 3);
    assert.equal(g.length, 2, 'dois motivos, dois grupos');
    assert.equal(g[0].total, 2, 'o mais frequente primeiro: o mapa travado');
    assert.match(g[0].motivo, /bloqueado/);
    assert.equal(g[1].total, 1);
    assert.match(g[1].motivo, /não conhece o tipo de entidade/, 'o alvo desconhecido é o outro');
    assert.equal(g[1].alvo, 'tipoQueNaoExiste');
  });

  it('o lote LIMPO nao escreve linha nenhuma, e a linha nunca carrega payload', async () => {
    await push([feicao(mapaLivre.id), feicao(mapaLivre.id)]).expect(200);
    assert.equal(linhas.length, 0, 'sem recusa, sem linha: o log não conta o que deu certo');

    linhas = [];
    await push([feicao(mapaTravado.id)]).expect(200);
    assert.equal(linhas.length, 1, 'e a de recusa continua saindo');
    const serializado = JSON.stringify(linhas[0]);
    assert.equal(serializado.includes('PC do Batalhao'), false, 'nome de feição não vai ao log');
    assert.equal(serializado.includes('2o Pelotao'), false, 'texto do usuário não vai ao log');
    assert.equal(serializado.includes('coordinates'), false, 'geometria não vai ao log');
  });
});
