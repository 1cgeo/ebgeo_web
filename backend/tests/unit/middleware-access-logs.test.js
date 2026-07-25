// Path: tests/unit/middleware-access-logs.test.js
//
// Itens 114 e 115 — os dois middlewares que só produzem LOG, e por isso são os dois
// cujo comportamento nenhum status code revela.
//
//   114 — `nomes-access-log.js` declara, num comentário, uma decisão de segurança
//         explícita: num gazetteer militar o termo de busca e a coordenada clicada são
//         sensíveis e não podem cair no log operacional (que costuma ser embarcado para
//         agregador). Essa decisão vive INTEIRA em `queryKeys: Object.keys(req.query)`.
//         Trocar por `query: req.query` — refatoração que parece inofensiva e até
//         "mais útil" — despeja termo e coordenada em todo request de /busca, /feicoes e
//         /catalogo3d. Nada na suíte reagia: `nomesAccessLog` roda de verdade durante os
//         testes de nomes e nenhum assert jamais olhou o que ele escreve.
//
//   115 — `request-logger.js`. A redação de credencial na URL já é afirmada no ponto de
//         chamada por `tests/integration/request-logger-redaction.test.js` (item 60).
//         O que aquele arquivo NÃO cobre são as propriedades estruturais do middleware:
//         que `next()` é chamado uma vez, SINCRONAMENTE e ANTES de qualquer log (inverter
//         para logar no next faz `duration` ser sempre ~0, silenciosamente); que uma
//         conexão abortada, que nunca emite 'finish', não loga nem lança; e que um request
//         anônimo não estoura em `req.user.id`.
//
// Ambos são testados com um espião sobre a MESMA instância ESM de `logger` que os
// middlewares importam — é o único caminho alcançável, já que a saída do pino sai em
// `level: 'silent'` sob teste.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import logger from '../../src/utils/logger.js';
import { nomesAccessLog } from '../../src/middleware/nomes-access-log.js';
import { requestLogger } from '../../src/middleware/request-logger.js';

/**
 * Replaces logger.info/warn/error with collectors. Restores the ORIGINAL property
 * descriptors: pino defines the level methods on the prototype, so a plain
 * re-assignment would leave an own-property shadow behind.
 */
function spyLogger() {
  const records = [];
  const saved = [];
  for (const level of ['info', 'warn', 'error']) {
    saved.push([level, Object.getOwnPropertyDescriptor(logger, level)]);
    Object.defineProperty(logger, level, {
      configurable: true, writable: true, enumerable: false,
      value: (obj, msg) => { records.push({ level, obj, msg }); },
    });
  }
  return {
    records,
    restore() {
      for (const [level, d] of saved) {
        if (d) Object.defineProperty(logger, level, d);
        else delete logger[level];
      }
    },
  };
}

describe('nomesAccessLog — logs WHICH filters, never their values (114)', () => {
  let spy;

  beforeEach(() => { spy = spyLogger(); });
  afterEach(() => { spy.restore(); });

  /** Runs the middleware over a fake req and returns { rec, nextCalls }. */
  function run(req) {
    const calls = [];
    nomesAccessLog(req, {}, (...args) => calls.push(args));
    return { rec: spy.records[0], calls };
  }

  it('a sensitive query is reduced to its KEYS — no term, no coordinate', () => {
    const req = {
      query: { q: 'Quartel General Sul', lat: '-15.79', lon: '-47.88' },
      ip: '10.0.0.7',
      path: '/api/v1/nomes/busca',
      user: { id: 'u-1' },
    };
    const { rec } = run(req);

    assert.ok(rec, 'the middleware must log exactly one record');
    assert.deepEqual(rec.obj.queryKeys, ['q', 'lat', 'lon']);

    // A afirmação que importa, feita sobre o registro INTEIRO: nenhum dos valores
    // sensíveis está em lugar nenhum do objeto entregue ao pino.
    const flat = JSON.stringify(rec.obj);
    for (const secret of ['Quartel General Sul', '-15.79', '-47.88']) {
      assert.ok(!flat.includes(secret), `o valor ${secret} vazou para o log: ${flat}`);
    }
  });

  it('the audit fields are passed through unchanged', () => {
    const req = { query: { q: 'x' }, ip: '203.0.113.9', path: '/api/v1/nomes/feicoes', user: { id: 'u-9' } };
    const { rec } = run(req);
    assert.equal(rec.obj.category, 'nomes_access');
    assert.equal(rec.obj.ip, '203.0.113.9');
    assert.equal(rec.obj.path, '/api/v1/nomes/feicoes');
    assert.equal(rec.obj.userId, 'u-9');
    assert.equal(rec.msg, 'nomes access');
    assert.equal(rec.level, 'info');
  });

  it('an anonymous request logs userId === null, not undefined', () => {
    // O `?? null` é deliberado: `undefined` some do JSON e a linha de auditoria fica
    // sem o campo, em vez de dizer explicitamente "sem principal".
    const { rec } = run({ query: {}, ip: '::1', path: '/api/v1/nomes/busca' });
    assert.equal(rec.obj.userId, null);
    assert.ok('userId' in rec.obj, 'o campo tem de existir mesmo anônimo');
  });

  it('req.query undefined -> queryKeys === [] and no throw (the `?? {}`)', () => {
    const { rec, calls } = run({ ip: '::1', path: '/api/v1/nomes/busca' });
    assert.deepEqual(rec.obj.queryKeys, []);
    assert.equal(calls.length, 1);
  });

  it('next() is called exactly once and with no argument', () => {
    const { calls } = run({ query: { q: 'x' }, ip: '::1', path: '/p' });
    assert.equal(calls.length, 1, 'next chamado uma única vez');
    assert.deepEqual(calls[0], [], 'next() sem argumento — nunca next(err)');
  });

  it('control: a key that IS present shows up (o assert de ausência não é vacuous)', () => {
    // Sem isto, "o valor não aparece" passaria também com um middleware que loga {}.
    const { rec } = run({ query: { q: 'Base', bbox: '1,2,3,4' }, ip: '::1', path: '/p' });
    assert.deepEqual(rec.obj.queryKeys, ['q', 'bbox']);
    assert.ok(JSON.stringify(rec.obj).includes('bbox'), 'a CHAVE é registrada de propósito');
  });
});

describe('requestLogger — ordering, level choice and the no-finish path (115)', () => {
  let spy;

  beforeEach(() => { spy = spyLogger(); });
  afterEach(() => { spy.restore(); });

  /** A minimal res: an EventEmitter with a mutable statusCode, like the real one. */
  function fakeRes(statusCode = 200) {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    return res;
  }

  it('next() runs synchronously and BEFORE any log is written', () => {
    // Se alguém inverter (logar no next em vez de no 'finish'), `duration` vira sempre
    // ~0 e o log passa a sair antes da resposta — sem nada quebrar.
    const res = fakeRes(200);
    let nextCalls = 0;
    requestLogger({ method: 'GET', url: '/p' }, res, () => { nextCalls++; });

    assert.equal(nextCalls, 1, 'next() precisa ser síncrono');
    assert.equal(spy.records.length, 0, 'nada pode ter sido logado antes do finish');

    res.emit('finish');
    assert.equal(spy.records.length, 1, 'o log sai no finish');
  });

  it('a 2xx logs at info with the message "request"', () => {
    const res = fakeRes(204);
    requestLogger({ method: 'DELETE', url: '/api/v1/x' }, res, () => {});
    res.emit('finish');

    const [rec] = spy.records;
    assert.equal(rec.level, 'info');
    assert.equal(rec.msg, 'request');
    assert.equal(rec.obj.method, 'DELETE');
    assert.equal(rec.obj.statusCode, 204);
    assert.equal(typeof rec.obj.duration, 'number');
    assert.ok(rec.obj.duration >= 0);
  });

  it('4xx and 5xx log at WARN — the middleware never uses logger.error (o corte é >= 400)', () => {
    for (const status of [400, 401, 404, 422, 500, 503]) {
      const spyLocal = spyLogger();
      try {
        const res = fakeRes(status);
        requestLogger({ method: 'GET', url: '/p' }, res, () => {});
        res.emit('finish');
        const [rec] = spyLocal.records;
        assert.equal(rec.level, 'warn', `status ${status} devia logar em warn`);
        assert.equal(rec.msg, 'request error');
      } finally {
        spyLocal.restore();
      }
    }
  });

  it('399 is still info and 400 is already warn (a fronteira exata)', () => {
    for (const [status, level] of [[399, 'info'], [400, 'warn']]) {
      const spyLocal = spyLogger();
      try {
        const res = fakeRes(status);
        requestLogger({ method: 'GET', url: '/p' }, res, () => {});
        res.emit('finish');
        assert.equal(spyLocal.records[0].level, level, `status ${status}`);
      } finally {
        spyLocal.restore();
      }
    }
  });

  it('a connection that never emits "finish" logs nothing and throws nothing', () => {
    // Cliente que aborta: `res.on('finish')` nunca dispara. Um middleware que logasse
    // no `close` ou fora do listener produziria linha aqui.
    const res = fakeRes(200);
    requestLogger({ method: 'GET', url: '/p' }, res, () => {});
    res.emit('close');
    assert.equal(spy.records.length, 0);
  });

  it('an anonymous request carries userId undefined without a TypeError', () => {
    const res = fakeRes(200);
    assert.doesNotThrow(() => {
      requestLogger({ method: 'GET', url: '/p' }, res, () => {});
      res.emit('finish');
    });
    assert.equal(spy.records[0].obj.userId, undefined);
  });

  it('the URL is redacted at the call site (the field, not the function)', () => {
    // `tests/unit/redact-url.test.js` prova a FUNÇÃO; este assert prova a CHAMADA.
    const res = fakeRes(200);
    requestLogger(
      { method: 'GET', url: '/api/v1/x?page=2&api_key=3f2a1b4c-0000-4000-8000-000000000000' },
      res,
      () => {}
    );
    res.emit('finish');

    const { obj } = spy.records[0];
    assert.match(obj.url, /api_key=REDACTED/);
    assert.match(obj.url, /page=2/, 'a redação não pode ser "descartar a query string"');
    assert.ok(!JSON.stringify(obj).includes('3f2a1b4c-0000-4000-8000-000000000000'));
  });

  it('the listener is registered on "finish" specifically, exactly once', () => {
    const res = fakeRes(200);
    requestLogger({ method: 'GET', url: '/p' }, res, () => {});
    assert.equal(res.listenerCount('finish'), 1);
    assert.equal(res.listenerCount('close'), 0, 'não pode duplicar o log num segundo evento');
  });
});
