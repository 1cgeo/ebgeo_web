// Path: tests/integration/uso-eventos-limitador.test.js
/**
 * @fileoverview O limitador de `POST /uso/eventos` recusa, e a recusa NÃO é muda.
 *
 * POR QUE ESTE É O TESTE QUE VALE, e é o mesmo argumento de
 * `limitador-de-diag-registra.test.js`: asserir sobre `limiterDenialPayload` não provaria
 * nada, porque a forma do payload já é testada e continuaria verde com este limitador mudo ou
 * com ele montando um handler próprio. O que precisa ficar vermelho é ele deixar de usar o
 * `makeLimiterHandler` compartilhado. Daí a requisição REAL contra o limitador REAL, e a
 * captura ANTES do pino, que sob `NODE_ENV=test` sai em `level: 'silent'` (espiar a saída
 * seria medir um cano fechado).
 *
 * O ENVELOPE 429 É CONTRATO (`docs/wiki/erros-api.md`), então o corpo é comparado byte a byte
 * com o literal esperado: este limitador nasceu depois da dobra, e não pode reintroduzir um
 * envelope próprio.
 *
 * O TETO VEM DO AMBIENTE ANTES DO IMPORT, porque `uso.rate-limit.js` lê `process.env` no load.
 * Com o default de 30 seriam 31 requisições para chegar à primeira recusa.
 *
 * A ROTA NÃO É MONTADA AQUI: o app inteiro traz `flexibleAuth`, o parser e o Joi, e nenhum
 * deles é o sujeito. O que se mede é o middleware.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import logger from '../../src/utils/logger.js';

process.env.RATE_LIMIT_USO_EVENTOS_MAX = '1';
// O default em teste é PULAR o limitador (o store em memória acumularia pela rodada inteira).
// Este é o caso dedicado que o religa, lido a cada requisição pelo `skip`.
process.env.RATE_LIMIT_FORCE = '1';

const ENVELOPE_429 = {
  error: { code: 'TOO_MANY_REQUESTS', message: 'Muitas tentativas. Tente novamente mais tarde.' },
};

const ehRecusa = (r) => r.msg === 'rate limit denied';

/**
 * Troca `logger.warn` por um coletor enquanto `fn` roda.
 *
 * Restaura o DESCRITOR original: o pino define os métodos de nível no protótipo, então uma
 * reatribuição deixaria uma propriedade própria sombreando para o resto do processo. Mesmo
 * desenho de `limitador-de-diag-registra.test.js`.
 */
async function capturar(fn) {
  const registros = [];
  const descritor = Object.getOwnPropertyDescriptor(logger, 'warn');
  Object.defineProperty(logger, 'warn', {
    configurable: true,
    writable: true,
    enumerable: false,
    value: (obj, msg) => { registros.push({ obj, msg }); },
  });
  try {
    await fn();
  } finally {
    if (descritor) Object.defineProperty(logger, 'warn', descritor);
    else delete logger.warn;
  }
  return registros;
}

describe('a recusa do limitador de uso/eventos é registrada e nomeia o limitador', () => {
  let app;

  before(async () => {
    const { usoEventosLimiter } = await import('../../src/modules/uso/uso.rate-limit.js');
    app = express();
    app.post('/api/v1/uso/eventos', usoEventosLimiter, (req, res) => res.status(204).end());
  });

  it('passado o teto, a rota responde 429 e a recusa escreve UMA linha', async () => {
    const registros = await capturar(async () => {
      await supertest(app).post('/api/v1/uso/eventos').expect(204);
      await supertest(app).post('/api/v1/uso/eventos').expect(429);
    });

    const linha = registros.find(ehRecusa);
    assert.ok(linha, 'a recusa não escreveu nenhuma linha: o limitador é mudo');
    assert.equal(linha.obj.limiter, 'uso-eventos',
      'o nome é o que separa este limitador de todo outro na leitura do log');
    assert.equal(linha.obj.method, 'POST');
    assert.equal(linha.obj.url, '/api/v1/uso/eventos');
    assert.equal(linha.obj.limit, 1);
    assert.equal(typeof linha.obj.ip, 'string');
    // A chave deste limitador é só o endereço, então a linha não pode carregar `username`:
    // ele nomearia um recorte por conta que não existe aqui.
    assert.ok(!('username' in linha.obj), 'a chave é por endereço, não por conta');
  });

  it('o envelope 429 é o da casa, byte a byte', async () => {
    const r = await supertest(app).post('/api/v1/uso/eventos').expect(429);
    assert.deepEqual(r.body, ENVELOPE_429);
  });
});
