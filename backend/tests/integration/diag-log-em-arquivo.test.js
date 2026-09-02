// Path: tests/integration/diag-log-em-arquivo.test.js
// As três rotas que leem o log em ARQUIVO (`GET /diag/erros|lento|status`): o gate de
// administrador, a fiação até `config.log.dir` e o teto da janela.
//
// POR QUE O `import` É DINÂMICO AQUI. `config.js` é um singleton congelado na avaliação do
// módulo, e `src/app.js` o puxa transitivamente. Para que estas rotas leiam um diretório
// SEMEADO por este arquivo em vez do `./data/logs` da máquina, `LOG_DIR` precisa estar no
// ambiente ANTES daquela avaliação — e um `import` estático de `helpers/setup.js` roda
// antes de qualquer linha do corpo. O runner dá um processo por arquivo de teste, então a
// variável não vaza para os vizinhos.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - tirar `requireAdmin` das rotas: o caso do usuário comum passa a devolver 200, e a
//    trilha de requisições do servidor inteiro (com URLs de todo mundo) vira leitura
//    pública para qualquer conta;
//  - tirar `auth`: o anônimo passa a receber 200 no lugar de 401;
//  - remover o teto de 7d do schema: `?desde=30d` deixa de ser 422 e a requisição volta a
//    poder abrir trinta arquivos de log dentro do ciclo HTTP;
//  - trocar `config.log.dir` por um caminho fixo no controller: o caso que confere o grupo
//    semeado passa a devolver zero grupos, porque estaria lendo outro diretório.
//
// O PAR COMPLETO É OBRIGATÓRIO e está aqui: para cada rota, quem NÃO pode não vê (401/403)
// e quem PODE vê (200 com o conteúdo semeado). Só o negativo passaria idêntico se a rota
// não existisse.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import supertest from 'supertest';
import { randomUUID } from 'crypto';

const DIR_DE_LOG = fs.mkdtempSync(path.join(os.tmpdir(), 'ebgeo-diag-http-'));
process.env.LOG_DIR = DIR_DE_LOG;

const { setupTestEnv, teardownTestEnv } = await import('../helpers/setup.js');
const { createUser, createAdminUser, loginUser } = await import('../helpers/fixtures.js');

/** O dia local em AAAA-MM-DD, o mesmo formato que `log-diario.js` escreve. */
function diaLocal(data) {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const d = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${d}`;
}

const AS_QUATRO_ROTAS = [
  '/api/v1/diag/erros',
  '/api/v1/diag/lento',
  '/api/v1/diag/status',
  '/api/v1/diag/erros-cliente',
];

describe('GET /diag/{erros,lento,status} — log em arquivo', () => {
  let app, db, comum, comumToken, admin, adminToken;
  const rotaDoErro = `/api/v1/atlas/${randomUUID()}/sync`;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    comum = await createUser(db, { username: `diag_user_${randomUUID().slice(0, 6)}` });
    admin = await createAdminUser(db, { username: `diag_adm_${randomUUID().slice(0, 6)}` });
    comumToken = await loginUser(app, comum.username, comum.password);
    adminToken = await loginUser(app, admin.username, admin.password);

    // O arquivo do DIA DE HOJE, porque a rota usa o relógio real. Duas linhas por
    // requisição falha, como o servidor de verdade escreve: a do errorHandler (com `err`)
    // e a do requestLogger (com `statusCode` e `duration`).
    const agora = Date.now();
    const reqId = randomUUID();
    const linhas = [
      { level: 50, time: agora - 120_000, reqId, method: 'POST', url: rotaDoErro, msg: 'Request error',
        err: { type: 'ValidationError', message: 'op de sync inválida', stack: 'ValidationError: op de sync inválida\n    at aqui' } },
      { level: 40, time: agora - 119_000, reqId, method: 'POST', url: rotaDoErro, statusCode: 400, duration: 33, msg: 'request error' },
      { level: 30, time: agora - 60_000, reqId: randomUUID(), method: 'GET', url: '/api/v1/config', statusCode: 200, duration: 7, msg: 'request' },
      // Uma linha velha, para provar que a janela corta: 3 dias atrás, no arquivo de hoje.
      { level: 30, time: agora - 3 * 86_400_000, reqId: randomUUID(), method: 'GET', url: '/api/v1/velho', statusCode: 200, duration: 5, msg: 'request' },
    ];
    fs.writeFileSync(
      path.join(DIR_DE_LOG, `ebgeo-${diaLocal(new Date())}.jsonl`),
      `${linhas.map((l) => JSON.stringify(l)).join('\n')}\n`
    );
  });

  after(async () => {
    await teardownTestEnv(db);
    fs.rmSync(DIR_DE_LOG, { recursive: true, force: true });
  });

  // ── quem não pode, não vê ──
  it('anônimo leva 401 nas quatro rotas de leitura', async () => {
    for (const rota of AS_QUATRO_ROTAS) {
      await supertest(app).get(rota).expect(401);
    }
  });

  it('usuário comum leva 403 nas quatro rotas de leitura', async () => {
    for (const rota of AS_QUATRO_ROTAS) {
      await supertest(app).get(rota).set('Authorization', `Bearer ${comumToken}`).expect(403);
    }
  });

  it('o 403 do papel vem ANTES do 422 da query: quem não pode não descobre a forma dela', async () => {
    await supertest(app)
      .get('/api/v1/diag/erros?desde=isto-nao-e-uma-janela')
      .set('Authorization', `Bearer ${comumToken}`)
      .expect(403);
  });

  // ── quem pode, vê ──
  it('o administrador recebe os erros agrupados por assinatura, com o exemplo', async () => {
    const res = await supertest(app)
      .get('/api/v1/diag/erros?desde=1h')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const d = res.body.data;
    assert.equal(d.diretorioAusente, false);
    assert.equal(d.arquivos, 1);
    assert.equal(d.linhas, 3, 'a linha de três dias atrás ficou fora da janela de 1h');
    assert.equal(typeof d.desde, 'number');
    assert.equal(d.assinaturas, 1);
    assert.equal(d.grupos.length, 1);

    const g = d.grupos[0];
    assert.equal(g.total, 1);
    assert.match(g.assinatura, /:id\/sync/, 'a rota entra normalizada, sem o uuid');
    assert.equal(typeof g.primeira, 'number');
    assert.equal(typeof g.ultima, 'number');
    assert.equal(g.exemplo.method, 'POST');
    assert.equal(g.exemplo.statusCode, 400, 'veio da OUTRA linha, pela fusão por reqId');
    assert.match(g.exemplo.stack, /^ValidationError: op de sync inválida/);
  });

  it('o administrador recebe a latência por rota', async () => {
    const res = await supertest(app)
      .get('/api/v1/diag/lento?desde=1h')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const d = res.body.data;
    assert.ok(Array.isArray(d.rotas));
    const sync = d.rotas.find((r) => r.rota.includes('/sync'));
    assert.ok(sync, 'a rota do erro tem duração e precisa aparecer');
    assert.equal(sync.n, 1);
    assert.equal(sync.p50, 33);
    assert.equal(sync.max, 33);
    assert.ok(d.rotas.some((r) => r.rota === 'GET /api/v1/config'));
  });

  it('o administrador recebe a contagem por faixa de status', async () => {
    const res = await supertest(app)
      .get('/api/v1/diag/status?desde=1h')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const d = res.body.data;
    assert.equal(d.total, 2, 'duas linhas com statusCode dentro da janela');
    assert.deepEqual(d.porFaixa, { '2xx': 1, '4xx': 1 });
    // UM, e não dois. O pulso conta REQUISIÇÃO desde 2026-09-02: a requisição falha escreveu
    // DUAS linhas (a do `errorHandler`, com `err` e sem `statusCode` no topo, e a do
    // `request-logger`), e só a segunda entra. Enquanto `erros` contava REGISTRO e `total`
    // contava requisição, a razão ia a 2 com tudo falhando, e a aba mostrou "taxa de erro
    // 200,0%". Quem quer o número de DEFEITOS pergunta a /erros, que funde por requisição
    // antes de agrupar; aquele número segue diferente, e agora por um motivo explicável.
    assert.equal(d.erros, 1);
    assert.ok(d.erros <= d.total, 'a taxa fica entre 0 e 100');
  });

  it('a janela padrão de cada rota é aplicada quando `desde` não vem', async () => {
    const res = await supertest(app)
      .get('/api/v1/diag/erros')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    // O padrão de /erros é 24h, e a linha velha (3 dias) continua fora; a de 2 min entra.
    assert.equal(res.body.data.linhas, 3);
    assert.equal(res.body.data.assinaturas, 1);
  });

  // ── a borda da janela ──
  it('janela mal formada é 422 em pt-BR, não um default silencioso', async () => {
    const res = await supertest(app)
      .get('/api/v1/diag/erros?desde=24hs')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.match(JSON.stringify(res.body.error.details), /Janela inválida/);
  });

  it('janela acima do teto é 422 e aponta o comando do servidor', async () => {
    const res = await supertest(app)
      .get('/api/v1/diag/status?desde=30d')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(422);
    assert.match(JSON.stringify(res.body.error.details), /npm run diag/);
  });

  it('o limite tem teto próprio: 999 é 422', async () => {
    await supertest(app)
      .get('/api/v1/diag/erros?limite=999')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(422);
  });

  it('não há `?dir=`: um diretório vindo do chamador é descartado, não obedecido', async () => {
    // `stripUnknown` derruba o parâmetro; o que se afirma é que a resposta continua vindo
    // do diretório CONFIGURADO. Sem esta asserção, um `?dir=` acrescentado por engano
    // viraria leitor de arquivo arbitrário do servidor atrás de um gate de administrador.
    const res = await supertest(app)
      .get(`/api/v1/diag/erros?dir=${encodeURIComponent(os.tmpdir())}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    assert.equal(res.body.data.diretorio, path.resolve(DIR_DE_LOG));
  });
});
