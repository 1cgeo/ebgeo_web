// Path: tests/unit/middleware-error-handler-headers-sent.test.js
// Item 168 (testes-backend.md, fatia be-middleware): errorHandler sem guarda de
// res.headersSent.
//
// CONFIRMADO no codigo lido em 2026-07-25: error-handler.js chamava
// res.status().json() incondicionalmente. Toda a bateria de
// middleware-error-handler.test.js usa um mockRes cujos headers estao sempre
// abertos, entao o ramo "erro chegou tarde demais" nunca era exercitado.
//
// Por que importa: o errorHandler e o ULTIMO da cadeia. Se ele lanca, o express
// entrega o novo erro ao finalhandler, que so sabe destruir o socket — o cliente
// recebe corpo truncado e o erro ORIGINAL desaparece, substituido por um
// ERR_HTTP_HEADERS_SENT que nao diz nada sobre a causa.
//
// Refutacao parcial do relatorio: o gatilho que ele cita (`createReadStream().pipe(res)`
// nos controllers de assets3d/sv360) ja nao existe — os dois passam por
// utils/stream-file.js, que trata `res.headersSent` sozinho (stream-file.js:41-45).
// A guarda continua necessaria porque o handler global e alcancavel por outros
// caminhos pos-flush (res.sendFile com erro tardio, qualquer next(err) depois de
// uma resposta ja enviada) e porque um handler terminal que pode lancar nao tem
// rede embaixo.
//
// Aqui a assercao e sobre o mock: `res.status` / `res.json` sao contadores que
// PARAM a chamada, entao "nao foi chamado" e verificavel, e o `setHeader` do mock
// lanca ERR_HTTP_HEADERS_SENT como o Node real lancaria.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { NotFoundError, BadRequestError, ValidationError } from '../../src/utils/errors.js';

function mockReq() {
  return { method: 'GET', url: '/stream/asset.glb', user: { id: 'u1' } };
}

/**
 * Um `res` que se comporta como o do Node depois do flush: `setHeader` lanca, e
 * `status`/`json` registram a chamada (para provar que NAO foram usados).
 * @param {boolean} headersSent
 */
function mockRes(headersSent) {
  const calls = { status: [], json: [], setHeader: [] };
  return {
    headersSent,
    calls,
    status(code) {
      calls.status.push(code);
      return this;
    },
    json(body) {
      calls.json.push(body);
      // Espelha o Node real: escrever o envelope depois do flush passa por
      // setHeader('Content-Type'), que lanca.
      if (this.headersSent) {
        const err = new Error('Cannot set headers after they are sent to the client');
        err.code = 'ERR_HTTP_HEADERS_SENT';
        throw err;
      }
      return this;
    },
    setHeader(name, value) {
      calls.setHeader.push([name, value]);
      if (this.headersSent) {
        const err = new Error('Cannot set headers after they are sent to the client');
        err.code = 'ERR_HTTP_HEADERS_SENT';
        throw err;
      }
    },
  };
}

/** Coletor de `next`, para provar delegacao com o erro ORIGINAL. */
function mockNext() {
  const seen = [];
  const next = (err) => { seen.push(err); };
  next.seen = seen;
  return next;
}

describe('errorHandler — resposta ja iniciada (item 168)', () => {
  it('nao lanca quando headersSent=true (antes: ERR_HTTP_HEADERS_SENT vindo do proprio handler)', () => {
    const res = mockRes(true);
    const next = mockNext();

    assert.doesNotThrow(
      () => errorHandler(new NotFoundError('3D asset'), mockReq(), res, next),
      'o ultimo handler da cadeia nao pode lancar: nao ha quem pegue'
    );
  });

  it('delega o erro ORIGINAL para o next que recebeu', () => {
    const res = mockRes(true);
    const next = mockNext();
    const original = new NotFoundError('3D asset');

    errorHandler(original, mockReq(), res, next);

    assert.equal(next.seen.length, 1, 'next(err) chamado exatamente uma vez');
    assert.equal(next.seen[0], original, 'o erro delegado e o mesmo objeto, nao um ERR_HTTP_HEADERS_SENT');
  });

  it('nao chama res.status nem res.json nenhuma vez', () => {
    const res = mockRes(true);

    errorHandler(new BadRequestError('malformed'), mockReq(), res, mockNext());

    assert.equal(res.calls.status.length, 0, 'res.status nao pode ser tocado depois do flush');
    assert.equal(res.calls.json.length, 0, 'res.json nao pode ser tocado depois do flush');
    assert.equal(res.calls.setHeader.length, 0, 'nenhum header pode ser escrito depois do flush');
  });

  it('vale para TODA a arvore de decisao do handler, nao so para AppError', () => {
    // Cada um destes entra por um ramo diferente (Joi 422, AppError, mapa
    // SQLSTATE, statusCode 4xx nu de http-errors, 500 desconhecido). A guarda
    // esta antes de todos, entao nenhum pode escrever.
    const casos = [
      ['Joi', { isJoi: true, details: [{ path: ['body', 'x'], message: 'x obrigatorio' }] }],
      ['AppError', new ValidationError('invalido', [{ field: 'x' }])],
      ['SQLSTATE 23505', Object.assign(new Error('dup'), { code: '23505' })],
      ['SQLSTATE 22P02', Object.assign(new Error('bad uuid'), { code: '22P02' })],
      ['http-errors 413', Object.assign(new Error('too large'), { statusCode: 413, expose: true })],
      ['erro desconhecido', new Error('boom')],
    ];

    for (const [nome, err] of casos) {
      const res = mockRes(true);
      const next = mockNext();

      assert.doesNotThrow(() => errorHandler(err, mockReq(), res, next), `${nome}: nao pode lancar`);
      assert.equal(res.calls.status.length, 0, `${nome}: res.status nao foi chamado`);
      assert.equal(res.calls.json.length, 0, `${nome}: res.json nao foi chamado`);
      assert.equal(next.seen[0], err, `${nome}: delegou o erro original`);
    }
  });

  it('CONTROLE: headersSent=false mantem o caminho normal intacto (a guarda nao desvia nada)', () => {
    const res = mockRes(false);
    const next = mockNext();

    errorHandler(new NotFoundError('Atlas'), mockReq(), res, next);

    assert.deepEqual(res.calls.status, [404], 'status do AppError preservado');
    assert.equal(res.calls.json.length, 1, 'envelope escrito uma vez');
    assert.equal(res.calls.json[0].error.code, 'NOT_FOUND');
    assert.equal(res.calls.json[0].error.message, 'Atlas not found');
    assert.equal(next.seen.length, 0, 'sem headers enviados, o handler RESPONDE em vez de delegar');
  });

  it('CONTROLE: headersSent=false com erro desconhecido continua virando 500 INTERNAL_ERROR', () => {
    const res = mockRes(false);
    const next = mockNext();

    errorHandler(new Error('boom'), mockReq(), res, next);

    assert.deepEqual(res.calls.status, [500]);
    assert.equal(res.calls.json[0].error.code, 'INTERNAL_ERROR');
    assert.equal(next.seen.length, 0);
  });

  it('headersSent ausente (undefined) e tratado como resposta aberta', () => {
    // Todo mockRes das suites existentes omite a propriedade. A guarda nao pode
    // transformar "nao sei" em "ja respondi", o que silenciaria o handler inteiro.
    const res = mockRes(false);
    delete res.headersSent;
    const next = mockNext();

    errorHandler(new BadRequestError('sem corpo'), mockReq(), res, next);

    assert.deepEqual(res.calls.status, [400]);
    assert.equal(res.calls.json[0].error.code, 'BAD_REQUEST');
    assert.equal(next.seen.length, 0);
  });
});
