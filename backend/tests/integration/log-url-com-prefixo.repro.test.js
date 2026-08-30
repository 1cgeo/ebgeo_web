// Path: tests/integration/log-url-com-prefixo.repro.test.js
//
// REPRO — o log gravava o caminho RELATIVO AO ROUTER, e não a URL que o cliente pediu.
//
// A CAUSA, e ela é mais estreita do que a primeira leitura sugeriu. `request-logger.js` e
// `error-handler.js` liam `req.url`, que o Express REESCREVE ao entrar num router montado,
// tirando o prefixo do mount (`/api/v1/auth`). A restauração acontece quando a pilha
// DESENROLA, isto é, quando o router chama o `done` dele — o que só ocorre se a requisição
// CAI FORA do router (`next()`) ou vira ERRO (`next(err)`). Numa rota que CASA e RESPONDE, o
// handler nunca chama `next`, a pilha não desenrola, e `req.url` fica trimado até o fim da
// requisição. Ou seja: o caminho FELIZ é o que perde o prefixo, e o de erro não perde.
//
// ISSO IMPORTA PARA COMO ESTE ARQUIVO É ESCRITO. A primeira versão dele media um 401 e
// passava verde COM E SEM o conserto (controle negativo rodado: 4 de 4 verdes nos dois
// estados), porque o caminho de erro restaura sozinho. Era um teste que não prendia nada,
// exatamente a classe que a constituição chama de cobertura vazia. O caso que prende é o de
// SUCESSO através de um router montado.
//
// POR QUE ISSO IMPORTA MAIS DO QUE PARECE. O log é a fonte do relatório (`npm run diag`) e da
// aba Diagnóstico, e as duas AGRUPAM por rota. Com o prefixo perdido de forma intermitente
// (depende de qual router estava em pé quando a resposta terminou), a MESMA rota vira duas
// assinaturas e a contagem se parte. Foi assim que o defeito apareceu: na primeira captura de
// tela da aba, `POST /erro-cliente` (3 chamadas) e `POST /api/v1/diag/erro-cliente` (1)
// estavam lado a lado na tabela de latência, que é a mesma rota contada duas vezes. E `POST
// /login` é indistinguível de qualquer outro `/login` montado sob outro prefixo.
//
// Nenhum teste pegava isso porque todos os testes de log afirmavam sobre o REDATOR de
// credencial (`redactUrl`), nunca sobre o prefixo — a URL entrava neles já sem mount.
//
// O QUE ESTE ARQUIVO PRENDE: as DUAS linhas que uma requisição falha produz carregam a URL
// COMPLETA, a mesma que o cliente pediu, e carregam a MESMA URL uma que a outra (senão o
// `reqId` costura duas linhas que se contradizem).
//
// Controle negativo (RODADO, não prometido): troque `req.originalUrl || req.url` por
// `req.url` em `request-logger.js` e o caso de SUCESSO cai, com `/` no lugar de
// `/api/v1/config`. Os casos de erro NÃO caem, e isso está dito neles: é a assimetria acima.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import logger from '../../src/utils/logger.js';

/** Espia a MESMA instância ESM de logger que os middlewares importam. */
function spyLogger() {
  const registros = [];
  const salvos = [];
  for (const nivel of ['info', 'warn', 'error']) {
    salvos.push([nivel, Object.getOwnPropertyDescriptor(logger, nivel)]);
    Object.defineProperty(logger, nivel, {
      configurable: true, writable: true, enumerable: false,
      value: (obj, msg) => { registros.push({ nivel, obj, msg }); },
    });
  }
  return {
    registros,
    restaurar() {
      for (const [nivel, d] of salvos) {
        if (d) Object.defineProperty(logger, nivel, d);
        else delete logger[nivel];
      }
    },
  };
}

describe('O log grava a URL que o cliente pediu, com o prefixo do mount', () => {
  let app, db, spy;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  beforeEach(() => { spy = spyLogger(); });
  afterEach(() => { spy.restaurar(); });

  it('SUCESSO através de um router montado: a linha carrega o caminho completo', async () => {
    // ESTE é o caso que prende, e a escolha da rota não é indiferente: `/api/v1/config` casa
    // dentro de um router montado em `/api/v1/config` e RESPONDE 200 sem chamar `next`, então
    // a pilha não desenrola e `req.url` fica em `/` até o fim. Com o defeito, esta linha era
    // gravada como `GET /` — e foi assim que ela apareceu na tabela de latência da aba
    // Diagnóstico, com 27 chamadas, indistinguível da raiz do site.
    await supertest(app).get('/api/v1/config').expect(200);

    const requisicao = spy.registros.find((r) => r.msg === 'request');
    assert.ok(requisicao, 'a linha de requisição tem de existir');
    assert.equal(requisicao.obj.url, '/api/v1/config');
    assert.equal(requisicao.obj.statusCode, 200);
  });

  it('a linha de REQUISIÇÃO de um 401 também carrega o caminho completo', async () => {
    // Controle de contraste: aqui o Express restaura sozinho (o `next(err)` desenrola a
    // pilha), então este caso passa COM e SEM o conserto. Ele fica porque documenta a
    // assimetria — quem ler só o caso acima pode concluir que erro e sucesso se comportam
    // igual, e é justamente por acreditar nisso que a primeira versão deste arquivo mediu o
    // caminho errado.
    await supertest(app).get('/api/v1/auth/me').expect(401);

    const requisicao = spy.registros.find((r) => r.msg === 'request error');
    assert.ok(requisicao, 'a linha de requisição tem de existir');
    assert.equal(requisicao.obj.url, '/api/v1/auth/me');
    assert.equal(requisicao.obj.statusCode, 401);
  });

  it('a linha de ERRO carrega a MESMA URL completa, e o mesmo reqId', async () => {
    await supertest(app).get('/api/v1/auth/me').expect(401);

    const requisicao = spy.registros.find((r) => r.msg === 'request error');
    const erro = spy.registros.find((r) => r.msg === 'Request error');
    assert.ok(erro, 'a linha do errorHandler tem de existir');
    assert.equal(erro.obj.url, '/api/v1/auth/me');
    // As duas descrevem a MESMA requisição: URLs divergentes fariam a fusão por `reqId`
    // juntar dois relatos que se contradizem, e a assinatura sairia com a URL de um deles.
    assert.equal(erro.obj.url, requisicao.obj.url);
    assert.equal(erro.obj.reqId, requisicao.obj.reqId);
    assert.ok(erro.obj.reqId, 'e o reqId não pode ser undefined nos dois');
  });

  it('a query string sobrevive (é metade do diagnóstico), e o redator continua agindo', async () => {
    await supertest(app).get('/api/v1/auth/me?aba=perfil').expect(401);

    const requisicao = spy.registros.find((r) => r.msg === 'request error');
    assert.equal(requisicao.obj.url, '/api/v1/auth/me?aba=perfil');
  });

  it('rota de PRIMEIRO nível (sem router montado) continua correta', async () => {
    // Controle positivo: o caminho que já funcionava antes do conserto não pode ter
    // quebrado. `/api/v1/health` é servido direto no app, sem router.
    await supertest(app).get('/api/v1/health').expect(200);

    const requisicao = spy.registros.find((r) => r.msg === 'request');
    assert.ok(requisicao, 'requisição bem-sucedida loga em info com msg "request"');
    assert.equal(requisicao.obj.url, '/api/v1/health');
  });
});
