// Path: tests/integration/limitador-de-diag-registra.test.js
/**
 * @fileoverview O limitador de `POST /diag/erro-cliente` deixou de recusar em silêncio.
 *
 * POR QUE ESTE É O TESTE QUE VALE. `clientErrorLimiter` guarda o único endpoint ANÔNIMO
 * deste servidor que ESCREVE no banco, e até 2026-09-01 ele tinha handler próprio, que
 * respondia 429 e não registrava nada: a recusa era o único sinal de que alguém estava
 * enchendo a tabela, e ela não existia em lugar nenhum. Asserir sobre `limiterDenialPayload`
 * não provaria a dobra, porque a forma do payload já era testada e continuaria verde com
 * este limitador mudo; o que precisa ficar vermelho é ele voltar a montar um handler seu.
 * Daí a requisição REAL contra o limitador REAL, e a captura ANTES do pino, que sob
 * `NODE_ENV=test` sai em `level: 'silent'` (espiar a saída seria medir um cano fechado).
 *
 * O ENVELOPE É CONTRATO (`docs/wiki/erros-api.md`), então o corpo é comparado byte a byte
 * com o literal esperado, e não "tem `code`": a dobra não podia mudar uma vírgula dele.
 *
 * O teto vem do ambiente ANTES do import, porque `diag.rate-limit.js` lê `process.env` no
 * load. Com o default de 60 seriam 61 requisições para chegar à primeira recusa.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import logger from '../../src/utils/logger.js';

process.env.RATE_LIMIT_CLIENT_ERROR_MAX = '1';
// O default em teste é PULAR o limitador (o store em memória acumularia pela rodada
// inteira). Este é o caso dedicado que o religa, lido a cada requisição pelo `skip`.
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
 * desenho de `tests/integration/endereco-e-recusa-no-log.test.js`.
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

describe('a recusa do limitador de erro-de-cliente é registrada', () => {
  let app;

  before(async () => {
    const { clientErrorLimiter } = await import('../../src/modules/diag/diag.rate-limit.js');
    app = express();
    app.post('/api/v1/diag/erro-cliente', clientErrorLimiter, (req, res) => res.status(204).end());
  });

  it('a recusa escreve uma linha que NOMEIA o limitador', async () => {
    const registros = await capturar(async () => {
      await supertest(app).post('/api/v1/diag/erro-cliente').expect(204);
      await supertest(app).post('/api/v1/diag/erro-cliente').expect(429);
    });

    const linha = registros.find(ehRecusa);
    assert.ok(linha, 'a recusa não escreveu nenhuma linha: o limitador voltou a ser mudo');
    assert.equal(linha.obj.limiter, 'client-error');
    assert.equal(linha.obj.method, 'POST');
    assert.equal(linha.obj.url, '/api/v1/diag/erro-cliente');
    assert.equal(linha.obj.limit, 1);
    assert.equal(typeof linha.obj.ip, 'string');
    // A chave deste limitador é só o endereço, então a linha não pode carregar `username`:
    // ele nomearia um recorte por conta que não existe aqui.
    assert.ok(!('username' in linha.obj), 'a chave é por endereço, não por conta');
  });

  it('o envelope 429 não mudou, byte a byte', async () => {
    // Contrato documentado. A dobra tinha de preservá-lo exatamente, e foi conferida antes
    // de ser feita; este caso é o que a mantém conferida.
    await capturar(async () => {
      await supertest(app).post('/api/v1/diag/erro-cliente').expect(429);
    });
    const resposta = await capturar(async () => {
      const r = await supertest(app).post('/api/v1/diag/erro-cliente');
      assert.equal(r.status, 429);
      assert.equal(JSON.stringify(r.body), JSON.stringify(ENVELOPE_429));
      assert.deepEqual(r.body, ENVELOPE_429);
    });
    assert.ok(Array.isArray(resposta));
  });

  it('a enxurrada não vira enxurrada de log: só a PRIMEIRA recusa fala', async () => {
    // `shouldLogDenial` (`middleware/rate-limit.js`) identifica a primeira recusa da janela
    // por `used === limit + 1`, sem estado deste lado. Herdar isso é metade do ganho da
    // dobra: um handler próprio que registrasse tudo trocaria a mudez por um amplificador.
    const registros = await capturar(async () => {
      for (let i = 0; i < 5; i += 1) {
        await supertest(app).post('/api/v1/diag/erro-cliente').expect(429);
      }
    });
    assert.equal(registros.filter(ehRecusa).length, 0, 'depois da primeira, a recusa é muda');
  });
});
