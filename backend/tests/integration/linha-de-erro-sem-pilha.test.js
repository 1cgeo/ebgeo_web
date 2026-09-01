// Path: tests/integration/linha-de-erro-sem-pilha.test.js
/**
 * @fileoverview A outra metade de `tests/unit/pilha-so-em-5xx.test.js`.
 *
 * Aquele arquivo prova a FORMA do que `requestErrorLogPayload` monta; apagar a CHAMADA dela
 * dentro de `errorHandler` (voltando a entregar o `err` cru ao pino) deixa o unitário
 * inteiro verde, porque o pino serializaria o erro com pilha e ninguém estaria olhando. É
 * daqui que sai o vermelho: requisição real, handler real, e a captura ANTES do pino, que
 * sob `NODE_ENV=test` sai em `level: 'silent'`.
 *
 * Modelo: `tests/integration/endereco-e-recusa-no-log.test.js`, que argumenta por extenso
 * por que a asserção tem de estar no PONTO DE CHAMADA.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import logger from '../../src/utils/logger.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { NotFoundError } from '../../src/utils/errors.js';

const ehLinhaDeErro = (r) => r.msg === 'Request error';

/**
 * Troca `logger.warn` e `logger.error` por coletores enquanto `fn` roda.
 *
 * Restaura os DESCRITORES: o pino define os métodos de nível no protótipo, então uma
 * reatribuição deixaria uma propriedade própria sombreando para o resto do processo.
 */
async function capturar(fn) {
  const registros = [];
  const salvos = [];
  for (const nivel of ['warn', 'error']) {
    salvos.push([nivel, Object.getOwnPropertyDescriptor(logger, nivel)]);
    Object.defineProperty(logger, nivel, {
      configurable: true,
      writable: true,
      enumerable: false,
      value: (obj, msg) => { registros.push({ nivel, obj, msg }); },
    });
  }
  try {
    await fn();
  } finally {
    for (const [nivel, descritor] of salvos) {
      if (descritor) Object.defineProperty(logger, nivel, descritor);
      else delete logger[nivel];
    }
  }
  return registros;
}

describe('a linha que uma requisição falha escreve de verdade', () => {
  let app;

  before(() => {
    app = express();
    app.use((req, res, next) => { req.id = 'req-real'; next(); });
    app.get('/rota-que-nao-existe', (req, res, next) => next(new NotFoundError('Route')));
    app.get('/quebra-de-verdade', (req, res, next) => next(new TypeError('x is not a function')));
    app.use(errorHandler);
  });

  it('404: a linha sai em `warn` e SEM pilha', async () => {
    const registros = await capturar(
      () => supertest(app).get('/rota-que-nao-existe').expect(404)
    );

    const linha = registros.find(ehLinhaDeErro);
    assert.ok(linha, 'nenhuma linha de erro foi escrita');
    assert.equal(linha.nivel, 'warn');
    assert.ok(!('stack' in linha.obj.err), 'o 404 real chegou ao logger com pilha');
    // E o que o diagnóstico precisa continua na linha.
    assert.equal(linha.obj.err.type, 'NotFoundError');
    assert.equal(linha.obj.err.statusCode, 404);
    assert.equal(linha.obj.reqId, 'req-real');
    assert.equal(linha.obj.url, '/rota-que-nao-existe');
  });

  it('500: a linha sai em `error` e COM pilha', async () => {
    const registros = await capturar(
      () => supertest(app).get('/quebra-de-verdade').expect(500)
    );

    const linha = registros.find(ehLinhaDeErro);
    assert.ok(linha, 'nenhuma linha de erro foi escrita');
    assert.equal(linha.nivel, 'error');
    assert.equal(typeof linha.obj.err.stack, 'string');
    assert.match(linha.obj.err.stack, /TypeError/);
  });

  it('o corpo da resposta não mudou em nenhum dos dois', async () => {
    // A economia é de LOG. O que o cliente recebe é contrato e não podia se mexer.
    const quatro = await supertest(app).get('/rota-que-nao-existe');
    assert.equal(quatro.status, 404);
    assert.equal(quatro.body.error.code, 'NOT_FOUND');

    const cinco = await supertest(app).get('/quebra-de-verdade');
    assert.equal(cinco.status, 500);
    assert.equal(cinco.body.error.code, 'INTERNAL_ERROR');
  });
});
