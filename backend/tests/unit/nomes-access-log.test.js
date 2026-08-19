// Path: tests/unit/nomes-access-log.test.js
// Item 116 — o log de acesso do gazetteer registra apenas as CHAVES da query.
//
// O invariante está declarado em prosa no próprio arquivo ("Log WHICH filters were
// used, not their values: for a military gazetteer the raw search terms and click
// coordinates are sensitive"), e tinha ZERO asserções: o middleware roda em
// /busca e /feicoes e não era referenciado por nenhum teste. Trocar
// `queryKeys: Object.keys(req.query)` por `query: req.query` passaria verde e
// mandaria termo de busca e coordenada de clique para o pipeline de log.
//
// A asserção é sobre o OBJETO QUE O MIDDLEWARE MONTA. Sob NODE_ENV=test o pino
// está em level 'silent', então espiar o stream de saída passaria verde mesmo com
// o vazamento intacto.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import logger from '../../src/utils/logger.js';
import { nomesAccessLog } from '../../src/middleware/nomes-access-log.js';

/** Roda o middleware capturando o que ele entrega ao logger. */
function rodar(req) {
  const original = logger.info;
  const capturado = [];
  let chamadasDeNext = 0;
  try {
    logger.info = (obj, msg) => { capturado.push([obj, msg]); };
    nomesAccessLog(req, {}, () => { chamadasDeNext += 1; });
  } finally {
    logger.info = original;
  }
  assert.equal(capturado.length, 1, 'o middleware loga exatamente uma vez');
  return { payload: capturado[0][0], msg: capturado[0][1], chamadasDeNext };
}

const TERMO = 'Base Secreta';

describe('nomesAccessLog registra chaves, nunca valores (item 116)', () => {
  it('loga queryKeys e category, e chama next() uma vez', () => {
    const { payload, msg, chamadasDeNext } = rodar({
      user: { id: 'u1' },
      ip: '1.2.3.4',
      path: '/busca',
      query: { q: TERMO, lat: -22.9, lon: -43.2 },
    });

    assert.equal(payload.category, 'nomes_access');
    assert.deepEqual(payload.queryKeys, ['q', 'lat', 'lon']);
    assert.equal(payload.userId, 'u1');
    assert.equal(payload.ip, '1.2.3.4');
    assert.equal(payload.path, '/busca');
    assert.equal(msg, 'nomes access');
    assert.equal(chamadasDeNext, 1);
  });

  it('nenhum VALOR de query vaza — nem por um campo novo que alguém acrescente', () => {
    const { payload } = rodar({
      user: { id: 'u1' },
      ip: '1.2.3.4',
      path: '/busca',
      query: { q: TERMO, lat: -22.9, lon: -43.2 },
    });
    // Guarda de vazamento por QUALQUER campo, presente ou futuro: serializa o
    // payload inteiro e procura os valores sensíveis.
    const serializado = JSON.stringify(payload);
    assert.ok(!serializado.includes(TERMO), 'o termo de busca não pode ir para o log');
    assert.ok(!serializado.includes('-22.9'), 'a latitude do clique não pode ir para o log');
    assert.ok(!serializado.includes('-43.2'), 'a longitude do clique não pode ir para o log');
  });

  it('requisição anônima: userId é null e next() ainda é chamado', () => {
    const { payload, chamadasDeNext } = rodar({
      ip: '9.9.9.9',
      path: '/busca',
      query: { q: TERMO, lat: 0, lon: 0 },
    });
    assert.equal(payload.userId, null);
    assert.equal(chamadasDeNext, 1);
    assert.deepEqual(payload.queryKeys, ['q', 'lat', 'lon']);
  });

  it('req.query ausente: queryKeys é [] e o middleware não lança (o `?? {}` é guarda real)', () => {
    const { payload, chamadasDeNext } = rodar({ ip: '9.9.9.9', path: '/feicoes' });
    assert.deepEqual(payload.queryKeys, []);
    assert.equal(chamadasDeNext, 1);
  });
});
