// Path: tests/unit/db-query-log-params.test.js
// Item 101 — o hook `initOptions.query` de src/database/index.js logava
// `params` de TODA query.
//
// REFUTAÇÃO PARCIAL do relatório: ele afirma que "o pino não tem redact nenhum".
// Falso contra o HEAD — `utils/logger.js` configura `redact.paths`
// (password/token/apiKey/headers.authorization) e um serializer `err` que faz
// scrub por NOME de campo. O que é verdade, e é o defeito real, é que nenhum dos
// dois alcança um ARRAY POSICIONAL: `params: ['<api key>']` não tem nome de campo
// para casar, então a chave viva ia inteira para o log assim que alguém subisse
// LOG_LEVEL=debug. Os dois portadores concretos são a api_key de
// FIND_USER_BY_API_KEY (middleware/flexible-auth.js) e o hash de refresh token de
// FIND_REFRESH_TOKEN_ANY.
//
// A asserção é sobre o OBJETO QUE O CÓDIGO MONTA (`queryLogPayload`), não sobre a
// saída do logger: sob NODE_ENV=test o pino está em level 'silent', então um teste
// que espiasse o stream passaria verde mesmo com o vazamento intacto — exatamente
// a armadilha que o relatório aponta no seu próprio controle negativo.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import logger from '../../src/utils/logger.js';
import { queryLogPayload, logQueryEvent } from '../../src/database/index.js';

const API_KEY = 'ebgeo_live_7f3c9a1b2d4e5f60718293a4b5c6d7e8';
const TOKEN_HASH = '9c56cc51b374c3ba189210d5b6d4bf57790d351c96c47c02190ecf1e430635ab';
const SENHA_HASH = '$2b$12$KIXQ0kUu9m2QeQ9Xn0hqzuJ2m1Q7Rn3o4p5q6r7s8t9u0v1w2x3y4';

describe('Log de query do pg-promise não carrega valores de parâmetro (item 101)', () => {
  it('a api_key de FIND_USER_BY_API_KEY não aparece no payload', () => {
    const payload = queryLogPayload({
      query: 'SELECT id, username FROM users WHERE api_key = $1 AND is_active = true',
      params: [API_KEY],
    });
    const serializado = JSON.stringify(payload);
    assert.ok(!serializado.includes(API_KEY), 'a chave de API não pode ir para o log');
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'params'), 'o campo params não existe mais');
  });

  it('o hash de refresh token e o password_hash também não aparecem', () => {
    const refresh = JSON.stringify(
      queryLogPayload({ query: 'SELECT * FROM refresh_tokens WHERE token_hash = $1', params: [TOKEN_HASH] })
    );
    assert.ok(!refresh.includes(TOKEN_HASH));

    const insert = JSON.stringify(
      queryLogPayload({
        query: 'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING *',
        params: ['fulano', SENHA_HASH],
      })
    );
    assert.ok(!insert.includes(SENHA_HASH));
    assert.ok(!insert.includes('fulano'), 'nenhum valor de parâmetro, nem os inócuos');
  });

  it('a QUERY continua logada — o conserto não é apagar o log', () => {
    // Sem isto, "remover o logger.debug inteiro" satisfaria os testes acima e o
    // valor de diagnóstico se perderia junto com o vazamento.
    const payload = queryLogPayload({
      query: 'SELECT id, username FROM users WHERE api_key = $1',
      params: [API_KEY],
    });
    assert.equal(payload.query, 'SELECT id, username FROM users WHERE api_key = $1');
    assert.equal(payload.paramCount, 1, 'a ARIDADE é diagnóstico útil e não é segredo');
  });

  it('a query é truncada em 80 caracteres (o comportamento anterior é preservado)', () => {
    const longa = `SELECT ${'a'.repeat(200)} FROM users`;
    const payload = queryLogPayload({ query: longa, params: [] });
    assert.equal(payload.query.length, 80);
    assert.equal(payload.query, longa.substring(0, 80));
    assert.equal(payload.paramCount, 0);
  });

  it('bordas: params ausente, null, e objeto nomeado', () => {
    assert.equal(queryLogPayload({ query: 'SELECT 1' }).paramCount, 0);
    assert.equal(queryLogPayload({ query: 'SELECT 1', params: null }).paramCount, 0);
    // pg-promise também aceita parâmetro nomeado (objeto): conta como 1 e, sobretudo,
    // não é serializado.
    const nomeado = queryLogPayload({ query: 'SELECT ${chave}', params: { chave: API_KEY } });
    assert.equal(nomeado.paramCount, 1);
    assert.ok(!JSON.stringify(nomeado).includes(API_KEY));
    // `query` não-string (pg-promise pode passar um QueryFile) não derruba o hook.
    assert.equal(typeof queryLogPayload({ query: undefined }).query, 'string');
  });

  it('o hook realmente entrega esse payload ao logger (e não outro objeto)', () => {
    // Amarra o hook ao construtor: alguém poderia "consertar" a função pura e
    // continuar logando `e.params` na chamada.
    const original = logger.debug;
    const capturado = [];
    try {
      logger.debug = (obj, msg) => { capturado.push([obj, msg]); };
      logQueryEvent({ query: 'SELECT id FROM users WHERE api_key = $1', params: [API_KEY] });
    } finally {
      logger.debug = original;
    }
    assert.equal(capturado.length, 1, 'o hook chama logger.debug exatamente uma vez');
    const [obj, msg] = capturado[0];
    assert.equal(msg, 'DB Query');
    assert.deepEqual(obj, { query: 'SELECT id FROM users WHERE api_key = $1', paramCount: 1 });
    assert.ok(!JSON.stringify(obj).includes(API_KEY));
  });
});
