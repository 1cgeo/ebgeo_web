// Path: tests/integration/endereco-e-recusa-no-log.test.js
// A outra metade de `tests/unit/log-de-endereco-e-recusa.test.js`: aquele arquivo prova a
// FORMA do payload, este prova que os middlewares o CONSTROEM a partir de uma requisicao
// real. Apagar `ip: clientAddress(req)` de `request-logger.js` ou o `logger.warn` de
// `makeLimiterHandler` deixa o unitario inteiro verde; e daqui que sai o vermelho.
//
// O modelo e `tests/integration/request-logger-redaction.test.js`, que ja argumenta por
// que a assercao tem de estar no PONTO DE CHAMADA. A intercepcao acontece ANTES do pino, e
// nao na saida dele, porque sob `NODE_ENV=test` o logger sai em `level: 'silent'`: espiar a
// saida seria medir um cano fechado.
//
// `trust proxy` E O SUJEITO DE METADE DESTE ARQUIVO, e nao cenario. O app real roda
// `app.set('trust proxy', config.trustProxy)` (`src/app.js`, default 1 hop via
// `TRUST_PROXY_HOPS`), que e o que faz `req.ip` ser o CLIENTE e nao o nginx. O app local
// abaixo repete essa linha e manda um `X-Forwarded-For` conhecido: se alguem trocar
// `req.ip` pelo `req.socket.remoteAddress`, o registro passa a trazer o loopback e o caso
// fica vermelho. Sem isso, um teste em loopback nao distingue as duas leituras.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import supertest from 'supertest';
import config from '../../src/config.js';
import logger from '../../src/utils/logger.js';
import { requestLogger, UNKNOWN_ADDRESS } from '../../src/middleware/request-logger.js';
import { authLimiter } from '../../src/middleware/rate-limit.js';

const CLIENTE = '203.0.113.9';

const ehLinhaDeRequisicao = (r) => r.msg === 'request' || r.msg === 'request error';
const ehLinhaDeRecusa = (r) => r.msg === 'rate limit denied';

/**
 * Substitui logger.info/logger.warn por coletores enquanto `fn` roda, e depois espera
 * (com prazo) ate `until` ser satisfeito.
 *
 * A espera nao e cosmetica: `request-logger.js` escreve de dentro de `res.on('finish')`,
 * que e evento do servidor sem ordem garantida contra a promessa do supertest. A linha de
 * recusa, ao contrario, e escrita de dentro do handler, antes do `res.status()`, e ja esta
 * la quando a resposta chega.
 *
 * Os descritores originais sao restaurados: o pino define os metodos de nivel no
 * prototipo, entao reatribuir deixaria uma propriedade propria sombreando.
 */
async function capturar(fn, until) {
  const registros = [];
  const salvos = [];

  for (const nivel of ['info', 'warn']) {
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
    if (until) {
      const prazo = Date.now() + 3000;
      while (!until(registros) && Date.now() < prazo) {
        await new Promise((r) => setTimeout(r, 5));
      }
    }
  } finally {
    for (const [nivel, descritor] of salvos) {
      if (descritor) Object.defineProperty(logger, nivel, descritor);
      else delete logger[nivel];
    }
  }

  return registros;
}

describe('endereco do cliente na linha de requisicao', () => {
  let app;

  before(() => {
    app = express();
    // A MESMA linha do app real. Sem ela, `req.ip` seria o loopback do supertest e o
    // `X-Forwarded-For` abaixo seria ignorado.
    app.set('trust proxy', config.trustProxy);
    app.use(requestLogger);
    app.get('/qualquer-rota', (req, res) => res.json({ ok: true }));
    app.post('/api/v1/auth/login', (req, res) => res.status(401).json({ ok: false }));
    // Simula o unico modo real de o endereco nao ser determinavel: o socket sem endereco.
    // `req.ip` e getter do prototipo do Express, entao uma propriedade propria o sombreia.
    app.get('/sem-endereco', (req, res) => res.json({ ok: true }));
  });

  it('carimba o endereco do cliente, e nao o do proxy', async () => {
    const registros = await capturar(
      () => supertest(app).get('/qualquer-rota').set('X-Forwarded-For', CLIENTE).expect(200),
      (rs) => rs.some(ehLinhaDeRequisicao)
    );

    const linha = registros.find(ehLinhaDeRequisicao);
    assert.ok(linha, 'nenhuma linha de requisicao foi escrita');
    assert.equal(linha.obj.ip, CLIENTE);
    // Controle: o endereco do socket em loopback NAO pode ser o que foi registrado, senao
    // o caso passaria verde com `req.socket.remoteAddress` no lugar de `req.ip`.
    assert.ok(!String(linha.obj.ip).includes('127.0.0.1'), linha.obj.ip);
  });

  it('carimba o endereco tambem na requisicao que falha, que e a que interessa', async () => {
    // 401 de login e o evento que NAO existe em `audit_trail` (o `actor_id` e NOT NULL e
    // numa tentativa falha nao ha ator). Esta linha e a unica evidencia dele.
    const registros = await capturar(
      () => supertest(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', CLIENTE)
        .send({ username: 'alguem', password: 'errada' })
        .expect(401),
      (rs) => rs.some((r) => r.msg === 'request error')
    );

    const linha = registros.find((r) => r.msg === 'request error');
    assert.ok(linha, 'nenhuma linha de erro de requisicao foi escrita');
    assert.equal(linha.obj.ip, CLIENTE);
    assert.equal(linha.obj.statusCode, 401);
  });

  it('sem endereco determinavel escreve o sentinela, nunca vazio nem undefined', async () => {
    const semIp = express();
    semIp.set('trust proxy', config.trustProxy);
    semIp.use((req, res, next) => {
      Object.defineProperty(req, 'ip', { value: undefined, configurable: true });
      next();
    });
    semIp.use(requestLogger);
    semIp.get('/sem-endereco', (req, res) => res.json({ ok: true }));

    const registros = await capturar(
      () => supertest(semIp).get('/sem-endereco').expect(200),
      (rs) => rs.some(ehLinhaDeRequisicao)
    );

    const linha = registros.find(ehLinhaDeRequisicao);
    assert.ok(linha, 'nenhuma linha de requisicao foi escrita');
    assert.equal(linha.obj.ip, UNKNOWN_ADDRESS);
    assert.notEqual(linha.obj.ip, '');
    assert.notEqual(linha.obj.ip, undefined);
    assert.ok('ip' in linha.obj, 'a chave nao pode sumir');
  });
});

describe('a recusa por limitador fala, e fala UMA vez por janela', () => {
  let app;

  before(() => {
    // O limitador e pulado em teste por default; `RATE_LIMIT_FORCE` o religa (lido a cada
    // requisicao). A chave do `authLimiter` e `${ip}:${username}`, entao o par abaixo isola
    // o balde do resto da suite.
    process.env.RATE_LIMIT_FORCE = '1';

    app = express();
    app.set('trust proxy', config.trustProxy);
    app.use(express.json());
    app.use(requestLogger);
    app.post('/api/v1/auth/login', authLimiter, (req, res) => res.status(401).json({ ok: false }));
  });

  after(() => {
    delete process.env.RATE_LIMIT_FORCE;
  });

  it('registra a primeira recusa, e nao as seguintes', async () => {
    const max = config.rateLimit.authMax;
    const excedentes = 3;
    const username = 'recusa_registrada_unica';
    let ultima;

    const registros = await capturar(async () => {
      for (let i = 0; i < max + excedentes; i++) {
        ultima = await supertest(app)
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', CLIENTE)
          .send({ username, password: 'errada' });
      }
    }, (rs) => rs.filter((r) => r.msg === 'request error' && r.obj.statusCode === 429).length
      >= excedentes);

    assert.equal(ultima.status, 429);

    const recusas = registros.filter(ehLinhaDeRecusa);
    // O CONTRATO DA DECISAO: tres requisicoes foram recusadas, UMA linha dedicada saiu.
    // Uma linha por recusa devolveria a rajada para dentro do arquivo de log, e o limitador
    // viraria o amplificador. O volume nao se perde: o firehose abaixo tem as tres.
    assert.equal(recusas.length, 1, `esperava 1 linha de recusa, veio ${recusas.length}`);

    const r = recusas[0].obj;
    assert.equal(r.limiter, 'auth');
    assert.equal(r.ip, CLIENTE);
    assert.equal(r.username, username);
    assert.equal(r.url, '/api/v1/auth/login');
    assert.equal(r.limit, max);
    assert.equal(r.used, max + 1, 'a linha tem de ser a da PRIMEIRA recusa');
    assert.ok(r.reqId, 'sem reqId a linha nao junta com a do request-logger');

    const negados = registros.filter(
      (x) => x.msg === 'request error' && x.obj.statusCode === 429
    );
    assert.equal(negados.length, excedentes, 'o firehose e quem conta a rajada');
    for (const n of negados) {
      assert.equal(n.obj.ip, CLIENTE);
    }
    // A juncao entre as duas linhas e o `reqId`, e ela tem de fechar de verdade.
    assert.ok(
      negados.some((n) => n.obj.reqId === r.reqId),
      'a linha de recusa nao casa com nenhuma linha de requisicao'
    );
  });
});
