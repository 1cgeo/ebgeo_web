// Path: tests/integration/sessao-de-navegador-no-log.test.js
// O CABEÇALHO `X-EBGeo-Sessao` ATRAVESSA O CAMINHO INTEIRO: ele é aceito pelo CORS, é lido
// pelo `requestLogger`, é ecoado pelo `errorHandler` e sobrevive à fusão do relatório.
//
// AS DUAS METADES DESTE ARQUIVO, e por que elas moram juntas. A primeira é o CORS: um
// cabeçalho customizado que o preflight recuse não chega a lugar nenhum, e a recusa acontece
// no NAVEGADOR, não aqui, ou seja, nenhum teste de servidor comum a veria. A segunda é a
// jornada da linha de log, sobre um app express montado à mão.
//
// POR QUE UM APP LOCAL PARA O `requestLogger`: `src/app.js` o monta atrás de
// `if (!config.isTest)`, então o `createApp()` da suíte NUNCA o instala — a mesma razão
// (e o mesmo desenho) de `tests/integration/request-logger-redaction.test.js`. O
// `errorHandler` é montado igual ao real, por último.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - acrescentar `allowedHeaders` ao `cors()` de `src/app.js` sem incluir este cabeçalho: o
//    caso do preflight fica vermelho, que é a única forma de perceber a quebra sem abrir um
//    navegador;
//  - tirar `req.sessaoId` do `requestLogger`: a linha do `errorHandler` perde a sessão;
//  - tirar o eco do `errorHandler`: a linha de erro perde a sessão, e como é ELA que a
//    fusão mantém, o campo sumiria de todo grupo do relatório;
//  - aceitar o cabeçalho sem validar: o caso do lixo passa a escrevê-lo no log.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';
import logger from '../../src/utils/logger.js';
import { CABECALHO_DE_SESSAO, requestLogger } from '../../src/middleware/request-logger.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { fundirPorRequisicao } from '../../src/utils/diag-consulta.js';

const isRequestLog = (r) => r.msg === 'request' || r.msg === 'request error';
const isErrorLog = (r) => r.msg === 'Request error';

/**
 * Replaces the logger's level methods with collectors for the duration of `fn`, then waits
 * (bounded) for the records the caller needs.
 *
 * A espera não é enfeite: o `requestLogger` escreve de dentro de `res.on('finish')`, que é
 * evento do servidor e não tem ordem garantida contra a promessa do supertest. Esperar pelo
 * registro ESPECÍFICO (e não por "algum registro") é o que impede a linha do `errorHandler`
 * de satisfazer a espera e esconder uma linha de requisição que não veio.
 */
async function capturar(fn, quantos = 1) {
  const records = [];
  const saved = [];
  for (const level of ['info', 'warn', 'error']) {
    saved.push([level, Object.getOwnPropertyDescriptor(logger, level)]);
    Object.defineProperty(logger, level, {
      configurable: true, writable: true, enumerable: false,
      value: (obj, msg) => { records.push({ level, obj, msg }); },
    });
  }
  try {
    await fn();
    const prazo = Date.now() + 3000;
    while (records.length < quantos && Date.now() < prazo) {
      await new Promise((r) => setTimeout(r, 5));
    }
  } finally {
    for (const [level, desc] of saved) {
      if (desc) Object.defineProperty(logger, level, desc);
      else delete logger[level];
    }
  }
  return records;
}

describe('A sessão do navegador atravessa CORS, log e fusão', () => {
  let realApp, db, harness;

  before(async () => {
    const env = await setupTestEnv();
    realApp = env.app;
    db = env.db;

    harness = express();
    harness.use(requestLogger);
    harness.get('/api/v1/probe', (req, res) => res.json({ ok: true }));
    harness.get('/api/v1/explode', () => { throw new Error('explosão proposital'); });
    harness.use(errorHandler);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ── o CORS, que é onde um cabeçalho customizado morre sem ninguém ver ──
  it('o preflight ACEITA `X-EBGeo-Sessao`', async () => {
    // `cors({ origin, credentials: true })` não declara `allowedHeaders`, e por isso
    // REFLETE o que o navegador pediu. É uma propriedade do default, não uma decisão
    // escrita, e é justamente por isso que ela precisa de guarda: um `allowedHeaders`
    // acrescentado depois (por segurança, por arrumação) fecharia este cabeçalho em
    // silêncio, e o sintoma seria o campo sumindo do log em produção, jamais em teste.
    const res = await supertest(realApp)
      .options('/api/v1/diag/erro-cliente')
      .set('Origin', config.cors.origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'X-EBGeo-Sessao, Content-Type')
      .expect(204);

    const permitidos = String(res.headers['access-control-allow-headers'] || '').toLowerCase();
    assert.match(permitidos, /x-ebgeo-sessao/);
    assert.equal(res.headers['access-control-allow-origin'], config.cors.origin);
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
  });

  it('a requisição REAL com o cabeçalho passa pelo CORS e é atendida', async () => {
    // O par positivo do preflight: um preflight verde sobre uma rota que recusasse a
    // requisição de verdade não provaria nada.
    const sessao = randomUUID();
    await supertest(realApp)
      .post('/api/v1/diag/erro-cliente')
      .set('Origin', config.cors.origin)
      .set(CABECALHO_DE_SESSAO, sessao)
      .send({ assinatura: `sessao-cors-${sessao}`, mensagem: 'x', sessaoId: sessao })
      .expect(204);

    await db.query('DELETE FROM client_errors WHERE assinatura = $1', [`sessao-cors-${sessao}`]);
  });

  // ── a jornada da linha ──
  it('requisição bem-sucedida: a linha de requisição carrega a sessão', async () => {
    const sessao = randomUUID();
    const records = await capturar(async () => {
      await supertest(harness).get('/api/v1/probe').set(CABECALHO_DE_SESSAO, sessao).expect(200);
    });

    const linha = records.find(isRequestLog);
    assert.ok(linha, 'o requestLogger não escreveu nada');
    assert.equal(linha.obj.sessaoId, sessao);
    assert.equal(linha.obj.statusCode, 200);
  });

  it('requisição FALHA: as DUAS linhas carregam a sessão, e a fusão a mantém', async () => {
    const sessao = randomUUID();
    const records = await capturar(async () => {
      await supertest(harness).get('/api/v1/explode').set(CABECALHO_DE_SESSAO, sessao).expect(500);
    }, 2);

    assert.equal(records.length, 2, 'uma requisição falha escreve duas linhas');
    const daRequisicao = records.find(isRequestLog);
    const doErro = records.find(isErrorLog);
    assert.ok(daRequisicao, 'faltou a linha do requestLogger');
    assert.ok(doErro, 'faltou a linha do errorHandler');

    assert.equal(daRequisicao.obj.sessaoId, sessao);
    assert.equal(doErro.obj.sessaoId, sessao, 'o eco é o que faz o campo sobreviver à fusão');
    assert.equal(daRequisicao.obj.reqId, doErro.obj.reqId, 'as duas são da mesma requisição');

    // E o desfecho que o relatório vê: uma linha só, com a sessão e com o status.
    const fundidos = fundirPorRequisicao([doErro.obj, daRequisicao.obj]);
    assert.equal(fundidos.length, 1);
    assert.equal(fundidos[0].sessaoId, sessao);
    assert.equal(fundidos[0].statusCode, 500);
    assert.match(fundidos[0].err.stack, /explosão proposital/);
  });

  it('cabeçalho com LIXO não vira campo em nenhuma das duas linhas', async () => {
    // Um UUID com sufixo colado, que é o que uma regex sem âncora aceitaria. A forma com
    // quebra de linha (a que forjaria um segundo registro no `.jsonl`) fica no caso de
    // unidade: o cliente HTTP do Node se RECUSA a enviá-la (ERR_INVALID_CHAR), então ela
    // não é exercível por aqui, e essa recusa é do transporte, não deste servidor.
    const records = await capturar(async () => {
      await supertest(harness)
        .get('/api/v1/explode')
        .set(CABECALHO_DE_SESSAO, `${randomUUID()}-extra`)
        .expect(500);
    }, 2);

    assert.equal(records.length, 2);
    for (const r of records) {
      assert.equal(Object.hasOwn(r.obj, 'sessaoId'), false, `linha ${r.msg}`);
    }
  });

  it('sem o cabeçalho, nada muda no que já se escrevia', async () => {
    const records = await capturar(async () => {
      await supertest(harness).get('/api/v1/probe').expect(200);
    });
    const linha = records.find(isRequestLog);
    assert.ok(linha);
    assert.equal(Object.hasOwn(linha.obj, 'sessaoId'), false);
    assert.equal(linha.obj.statusCode, 200);
    assert.equal(typeof linha.obj.duration, 'number');
  });
});
