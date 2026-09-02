// Path: tests/integration/diag-erro-de-cliente.test.js
// `POST /diag/erro-cliente` (anônimo, escreve) e `GET /diag/erros-cliente` (administrador,
// lê). É a metade da evidência que o incidente de 2026-08-30 não tinha: o erro do
// navegador só existia no console de quem estava com a tela aberta.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - trocar o `ON CONFLICT (assinatura) DO UPDATE` por um INSERT simples: o caso do laço
//    passa a criar duas linhas em vez de somar em `ocorrencias`, que é literalmente o
//    defeito de origem (dezenove ocorrências idênticas em segundos) transformado em
//    dezenove mil linhas;
//  - ler `userId` do corpo em vez de `req.user`: o caso "anônimo tentando se passar por
//    outro" passa a gravar o id que o corpo mandou, e a telemetria vira falsificável;
//  - montar `auth` estrito no POST: o caso do anônimo passa a 401, e o app deslogado — que
//    é onde ninguém vê o erro — deixa de reportar qualquer coisa;
//  - tirar os tetos do Joi: o corpo gigante deixa de ser 422 e vai morrer no driver, ou
//    seja, a rota que existe para registrar falhas produz a sua;
//  - trocar o LEFT JOIN por JOIN: as linhas anônimas somem da listagem, sem erro nenhum e
//    com uma lista plausível na tela.
//
// O PAR COMPLETO da leitura está aqui: anônimo 401, usuário comum 403, administrador 200
// vendo exatamente as linhas semeadas.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('Erro do navegador — POST /diag/erro-cliente e GET /diag/erros-cliente', () => {
  let app, db, comum, comumToken, admin, adminToken;
  const marca = randomUUID().slice(0, 8);
  const assinaturas = [];

  /** Uma assinatura irrepetível: a tabela é compartilhada pela rodada inteira. */
  function assinatura(nome) {
    const a = `TypeError | ${nome} | ${marca}`;
    assinaturas.push(a);
    return a;
  }

  const linhaDe = (a) => db.query('SELECT * FROM defeitos WHERE assinatura = $1', [a])
    .then((r) => r.rows[0]);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    comum = await createUser(db, { username: `ce_user_${randomUUID().slice(0, 6)}` });
    admin = await createAdminUser(db, { username: `ce_adm_${randomUUID().slice(0, 6)}` });
    comumToken = await loginUser(app, comum.username, comum.password);
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await db.query('DELETE FROM defeitos WHERE assinatura = ANY($1::text[])', [assinaturas]);
    await teardownTestEnv(db);
  });

  // ── a escrita, anônima por desenho ──
  it('o ANÔNIMO passa: 204 e a linha nasce sem usuário', async () => {
    const a = assinatura('anonimo');
    await supertest(app)
      .post('/api/v1/diag/erro-cliente')
      .send({
        assinatura: a,
        mensagem: 'Cannot read properties of undefined (reading nome)',
        stack: 'TypeError: ...\n    at render',
        url: 'https://ebgeo/atlas.html',
        pagina: 'atlas',
        release: 'dev',
      })
      .expect(204);

    const linha = await linhaDe(a);
    assert.ok(linha, 'a linha precisa existir');
    assert.equal(linha.user_id, null);
    assert.equal(linha.ocorrencias, 1);
    assert.equal(linha.pagina, 'atlas');
    assert.equal(linha.mensagem, 'Cannot read properties of undefined (reading nome)');
    // Sem cabeçalho e sem campo no corpo, a coluna fica NULL em vez de string vazia: os
    // dois se leem igual numa tela e só um é distinguível de "o cliente mandou vazio".
    assert.equal(linha.user_agent, null);
  });

  it('o user-agent vem do CABEÇALHO quando ele existe, e do corpo só na falta dele', async () => {
    const doCabecalho = assinatura('ua-cabecalho');
    await supertest(app)
      .post('/api/v1/diag/erro-cliente')
      .set('User-Agent', 'Mozilla/5.0 (navegador de verdade)')
      .send({ assinatura: doCabecalho, mensagem: 'x', userAgent: 'eu-digo-que-sou-outro' })
      .expect(204);
    assert.equal(
      (await linhaDe(doCabecalho)).user_agent,
      'Mozilla/5.0 (navegador de verdade)',
      'o que o navegador diz de si vence o que o corpo escolheu dizer'
    );

    const doCorpo = assinatura('ua-corpo');
    await supertest(app)
      .post('/api/v1/diag/erro-cliente')
      .send({ assinatura: doCorpo, mensagem: 'x', userAgent: 'agente informado pelo cliente' })
      .expect(204);
    assert.equal((await linhaDe(doCorpo)).user_agent, 'agente informado pelo cliente');
  });

  it('a repetição INCREMENTA em vez de duplicar (o defeito em laço não enche a tabela)', async () => {
    const a = assinatura('em-laco');
    const corpo = { assinatura: a, mensagem: 'quebrou no laço' };

    for (let i = 0; i < 19; i += 1) {
      await supertest(app).post('/api/v1/diag/erro-cliente').send(corpo).expect(204);
    }

    const { rows } = await db.query('SELECT * FROM defeitos WHERE assinatura = $1', [a]);
    assert.equal(rows.length, 1, 'dezenove ocorrências, UMA linha');
    assert.equal(rows[0].ocorrencias, 19);
    assert.ok(
      new Date(rows[0].ultima_em).getTime() >= new Date(rows[0].primeira_em).getTime(),
      'ultima_em avança, primeira_em não'
    );
  });

  it('o UPSERT preserva o contexto que o relato novo não trouxe', async () => {
    const a = assinatura('contexto');
    await supertest(app).post('/api/v1/diag/erro-cliente')
      .send({ assinatura: a, mensagem: 'primeira', stack: 'a pilha original', url: 'https://ebgeo/index.html' })
      .expect(204);
    await supertest(app).post('/api/v1/diag/erro-cliente')
      .send({ assinatura: a, mensagem: 'segunda' })
      .expect(204);

    const linha = await linhaDe(a);
    assert.equal(linha.ocorrencias, 2);
    assert.equal(linha.mensagem, 'segunda', 'a mensagem mais recente vence');
    assert.equal(linha.stack, 'a pilha original', 'a pilha sobrevive ao relato mais pobre');
    assert.equal(linha.url, 'https://ebgeo/index.html');
  });

  // ── a identidade sai do token, nunca do corpo ──
  it('autenticado: `user_id` é o do TOKEN', async () => {
    const a = assinatura('com-sessao');
    await supertest(app)
      .post('/api/v1/diag/erro-cliente')
      .set('Authorization', `Bearer ${comumToken}`)
      .send({ assinatura: a, mensagem: 'com sessão' })
      .expect(204);

    const linha = await linhaDe(a);
    assert.equal(linha.user_id, comum.id);
  });

  it('anônimo que MANDA um userId no corpo continua anônimo', async () => {
    const a = assinatura('forjado');
    await supertest(app)
      .post('/api/v1/diag/erro-cliente')
      .send({ assinatura: a, mensagem: 'tentando se passar por outro', userId: admin.id, user_id: admin.id })
      .expect(204);

    const linha = await linhaDe(a);
    assert.equal(linha.user_id, null, 'o corpo não decide identidade');
  });

  it('autenticado que manda OUTRO userId no corpo grava o do token', async () => {
    const a = assinatura('forjado-com-sessao');
    await supertest(app)
      .post('/api/v1/diag/erro-cliente')
      .set('Authorization', `Bearer ${comumToken}`)
      .send({ assinatura: a, mensagem: 'me atribua ao admin', userId: admin.id })
      .expect(204);

    const linha = await linhaDe(a);
    assert.equal(linha.user_id, comum.id);
  });

  // ── os tetos ──
  it('corpo acima dos tetos é 422, não 500, e não escreve nada', async () => {
    const a = assinatura('gigante');
    const res = await supertest(app)
      .post('/api/v1/diag/erro-cliente')
      .send({ assinatura: a, mensagem: 'x'.repeat(501), stack: 'y'.repeat(5000) })
      .expect(422);

    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(await linhaDe(a), undefined, 'nada foi escrito');
  });

  it('corpo sem os obrigatórios é 422', async () => {
    await supertest(app).post('/api/v1/diag/erro-cliente').send({}).expect(422);
    await supertest(app).post('/api/v1/diag/erro-cliente').send({ mensagem: 'sem assinatura' }).expect(422);
  });

  it('atlasId que não é UUID é 422 (a coluna é UUID, sem FK)', async () => {
    await supertest(app)
      .post('/api/v1/diag/erro-cliente')
      .send({ assinatura: `${marca}-atlas-invalido`, mensagem: 'x', atlasId: 'Principal' })
      .expect(422);
  });

  it('atlasId de um atlas que NÃO EXISTE é aceito: a coluna não tem FK de propósito', async () => {
    const a = assinatura('atlas-fantasma');
    const fantasma = randomUUID();
    await supertest(app)
      .post('/api/v1/diag/erro-cliente')
      .send({ assinatura: a, mensagem: 'o atlas já foi apagado', atlasId: fantasma })
      .expect(204);

    const linha = await linhaDe(a);
    assert.equal(linha.atlas_id, fantasma);
  });

  // ── a leitura: quem não pode não vê, quem pode vê ──
  it('anônimo leva 401 e usuário comum leva 403 na listagem', async () => {
    await supertest(app).get('/api/v1/diag/erros-cliente').expect(401);
    await supertest(app).get('/api/v1/diag/erros-cliente')
      .set('Authorization', `Bearer ${comumToken}`).expect(403);
  });

  it('o administrador vê as linhas, com username por LEFT JOIN e nulo para o anônimo', async () => {
    const res = await supertest(app)
      .get('/api/v1/diag/erros-cliente?desde=1h&limite=200')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const itens = res.body.data.itens.filter((i) => i.assinatura.includes(marca));
    assert.ok(itens.length >= 2, `esperava as linhas semeadas, vieram ${itens.length}`);

    const comSessao = itens.find((i) => i.assinatura.includes('com-sessao'));
    assert.equal(comSessao.userId, comum.id);
    assert.equal(comSessao.username, comum.username, 'o LEFT JOIN traz o nome');

    const anonimo = itens.find((i) => i.assinatura.includes('| anonimo |'));
    assert.equal(anonimo.userId, null);
    assert.equal(anonimo.username, null, 'anônimo aparece, sem nome');
    assert.equal(anonimo.pagina, 'atlas');
    assert.equal(anonimo.release, 'dev');
    assert.equal(typeof anonimo.primeiraEm, 'number');
    assert.equal(typeof anonimo.ultimaEm, 'number');

    const emLaco = itens.find((i) => i.assinatura.includes('em-laco'));
    assert.equal(emLaco.ocorrencias, 19);
  });

  it('a listagem vem da mais RECENTE para a mais antiga', async () => {
    const primeira = assinatura('ordem-1');
    const segunda = assinatura('ordem-2');
    await supertest(app).post('/api/v1/diag/erro-cliente')
      .send({ assinatura: primeira, mensagem: 'primeira' }).expect(204);
    await supertest(app).post('/api/v1/diag/erro-cliente')
      .send({ assinatura: segunda, mensagem: 'segunda' }).expect(204);

    const res = await supertest(app)
      .get('/api/v1/diag/erros-cliente?desde=1h&limite=200')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const meus = res.body.data.itens.map((i) => i.assinatura).filter((a) => a.includes(marca));
    assert.ok(meus.indexOf(segunda) < meus.indexOf(primeira), 'a mais recente vem antes');
  });

  it('a janela corta pelo `ultima_em`: uma janela de um minuto não alcança o relato antigo', async () => {
    const a = assinatura('antigo');
    await supertest(app).post('/api/v1/diag/erro-cliente')
      .send({ assinatura: a, mensagem: 'antigo' }).expect(204);
    await db.query(
      `UPDATE defeitos SET primeira_em = NOW() - INTERVAL '2 days',
                                ultima_em   = NOW() - INTERVAL '2 days'
        WHERE assinatura = $1`,
      [a]
    );

    const perto = await supertest(app).get('/api/v1/diag/erros-cliente?desde=1h')
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    assert.equal(perto.body.data.itens.some((i) => i.assinatura === a), false);

    const longe = await supertest(app).get('/api/v1/diag/erros-cliente?desde=7d&limite=200')
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    assert.equal(longe.body.data.itens.some((i) => i.assinatura === a), true);
  });
});
