// Path: tests/integration/senha-redefinicao-por-email.test.js
//
// REDEFINIÇÃO DE SENHA PELO E-MAIL, e a metade deste arquivo que mais importa é a última:
// o token de conta NÃO CRUZA DE PROPÓSITO.
//
// O ESTADO ANTERIOR, medido: as rotas de `auth` eram register, verify-email,
// resend-verification, login, refresh, logout e me. Não existia redefinição nenhuma; a única
// era `POST /users/:userId/reset-password`, com `requireAdmin`, e a única orientação do produto
// inteiro sobre isso vivia dentro de um e-mail (`sendAccountExistsEmail`, `src/utils/mailer.js`).
//
// POR QUE UMA TABELA SÓ, E O QUE A TORNA SEGURA. O mecanismo de token de verificação foi
// REUSADO em vez de duplicado: mesma tabela, mesmo resgate atômico de uso único, mesmo prazo por
// linha. O que o reúso exigiu foi um discriminador — `email_verification_tokens.purpose` —, e é
// ele que impede a confusão de propósito clássica: sem ele, um link de confirmação (que sai em
// TODO cadastro e em todo reenvio, e que fora de produção é ESCRITO NO LOG) seria resgatável na
// rota que troca a senha. O último caso deste arquivo é esse controle negativo, nas duas
// direções, e ele é a razão pela qual a decisão de reusar pôde ser tomada.
//
// AS ROTAS SÓ EXISTEM ONDE A MENSAGEM PODE CHEGAR (`canDeliverAccountMail`, montagem condicional
// em `src/modules/auth/auth.routes.js`). Na suíte não há SMTP, e é justamente por isso que elas
// estão montadas aqui: fora de produção o mailer ESCREVE o código no log, e o log é o canal.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

const PW = 'Sup3r-Secret-Pw!';
const PW_NOVA = 'Outr4-Senha-Nov4!';
const uniq = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

describe('Senha — redefinição por e-mail', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Cria uma conta pelo auto-cadastro e a deixa CONFIRMADA. */
  async function contaConfirmada(prefixo) {
    const username = `${prefixo}_${uniq()}`;
    const email = `${username}@example.mil`;
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username, password: PW, nome: 'Titular Teste', email })
      .expect(201);

    const { rows } = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const userId = rows[0]?.id;
    assert.ok(userId, 'a conta recém-cadastrada precisa existir');
    await db.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [userId]);
    return { userId, username, email };
  }

  /** O código de redefinição ainda de pé desta conta, se houver. */
  async function codigoDeRedefinicao(userId) {
    const { rows } = await db.query(
      `SELECT token, expires_at FROM email_verification_tokens
       WHERE user_id = $1 AND purpose = 'reset_password' AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return rows[0] ?? null;
  }

  it('pede o código, redefine, entra com a senha nova e a antiga deixa de valer', async () => {
    const conta = await contaConfirmada('reset');

    const pedido = await supertest(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: conta.email })
      .expect(200);
    assert.deepEqual(pedido.body.data, { success: true });

    const codigo = await codigoDeRedefinicao(conta.userId);
    assert.ok(codigo, 'um endereço confirmado precisa render um código');

    // PRAZO CURTO, e a asserção é ABSOLUTA e não "existe uma data": o valor padrão é 60 minutos
    // (`AUTH_PASSWORD_RESET_TTL_MINUTES`), e um TTL que silenciosamente virasse as 48 horas da
    // confirmação de conta passaria verde num teste que só olhasse se `expires_at` foi gravado.
    const minutos = (new Date(codigo.expires_at).getTime() - Date.now()) / 60000;
    assert.ok(minutos > 50 && minutos <= 60, `esperava um prazo de ~60 min, medi ${minutos}`);

    await supertest(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: codigo.token, newPassword: PW_NOVA })
      .expect(200);

    await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: conta.username, password: PW_NOVA })
      .expect(200);

    // CONTROLE NEGATIVO da escrita: a senha ANTIGA precisa ter deixado de valer. Sem isto, um
    // serviço que não escrevesse nada passaria verde acima (a nova senha nunca teria sido
    // testada contra o hash certo... e a antiga continuaria entrando).
    await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: conta.username, password: PW })
      .expect(401);
  });

  it('redefinir CORTA as sessões abertas da conta', async () => {
    const conta = await contaConfirmada('sessao');

    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: conta.username, password: PW })
      .expect(200);
    const accessToken = login.body.data.accessToken;

    // A sessão está viva ANTES, e isto é asserido: sem esta metade, um 401 depois não
    // distinguiria "a redefinição cortou" de "este token nunca serviu".
    await supertest(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    await supertest(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: conta.email })
      .expect(200);
    const codigo = await codigoDeRedefinicao(conta.userId);
    assert.ok(codigo, 'o pedido precisa render um código');

    await supertest(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: codigo.token, newPassword: PW_NOVA })
      .expect(200);

    await supertest(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });

  it('o código serve UMA vez, e pedir de novo invalida o anterior', async () => {
    const conta = await contaConfirmada('unico');

    await supertest(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: conta.email })
      .expect(200);
    const primeiro = await codigoDeRedefinicao(conta.userId);
    assert.ok(primeiro, 'o primeiro pedido precisa render um código');

    // Pedir de novo derruba o anterior: dois códigos vivos dobram a janela sem dar nada a ninguém.
    await supertest(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: conta.email })
      .expect(200);
    const segundo = await codigoDeRedefinicao(conta.userId);
    assert.ok(segundo, 'o segundo pedido precisa render um código');
    assert.notEqual(segundo.token, primeiro.token);

    await supertest(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: primeiro.token, newPassword: PW_NOVA })
      .expect(400);

    // O segundo funciona, e depois de usado não funciona mais.
    await supertest(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: segundo.token, newPassword: PW_NOVA })
      .expect(200);
    await supertest(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: segundo.token, newPassword: 'Terce1ra-Senha!' })
      .expect(400);
  });

  it('código EXPIRADO é recusado, e a senha continua a mesma', async () => {
    const conta = await contaConfirmada('expira');

    await supertest(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: conta.email })
      .expect(200);
    const codigo = await codigoDeRedefinicao(conta.userId);
    assert.ok(codigo, 'o pedido precisa render um código');

    await db.query(
      "UPDATE email_verification_tokens SET expires_at = NOW() - INTERVAL '1 hour' WHERE token = $1",
      [codigo.token]
    );

    await supertest(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: codigo.token, newPassword: PW_NOVA })
      .expect(400);

    await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: conta.username, password: PW })
      .expect(200);
  });

  it('e-mail desconhecido e e-mail NÃO CONFIRMADO respondem igual, e nada é cunhado', async () => {
    // Desconhecido: mesmo 200, mesmo corpo.
    const desconhecido = await supertest(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: `ninguem_${uniq()}@example.mil` })
      .expect(200);
    assert.deepEqual(desconhecido.body.data, { success: true });

    // Não confirmado: um endereço que ninguém provou possuir não recebe credencial de senha.
    const username = `pendente_${uniq()}`;
    const email = `${username}@example.mil`;
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username, password: PW, nome: 'Pendente', email })
      .expect(201);
    const { rows } = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const userId = rows[0]?.id;
    assert.ok(userId, 'a conta pendente precisa existir');

    const pendente = await supertest(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email })
      .expect(200);
    assert.deepEqual(pendente.body.data, { success: true });
    assert.equal(
      await codigoDeRedefinicao(userId),
      null,
      'endereço não confirmado não pode render código de senha'
    );

    // Desativada: mesma regra, e este ramo passa pelo `is_active` da consulta.
    const inativa = await contaConfirmada('inativa');
    await db.query('UPDATE users SET is_active = FALSE WHERE id = $1', [inativa.userId]);
    await supertest(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: inativa.email })
      .expect(200);
    assert.equal(await codigoDeRedefinicao(inativa.userId), null);

    // CONTROLE NEGATIVO: a MESMA rota, sobre uma conta ativa e confirmada, cunha. Sem isto, um
    // serviço que nunca cunhasse nada passaria verde nas três asserções acima.
    const boa = await contaConfirmada('boa');
    await supertest(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: boa.email })
      .expect(200);
    assert.ok(await codigoDeRedefinicao(boa.userId), 'conta ativa e confirmada precisa render código');
  });

  it('O TOKEN NÃO CRUZA DE PROPÓSITO, nas duas direções', async () => {
    // Direção 1: um token de CONFIRMAÇÃO de conta não redefine senha.
    const username = `cruza_${uniq()}`;
    const email = `${username}@example.mil`;
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username, password: PW, nome: 'Cruza Teste', email })
      .expect(201);
    const { rows } = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const userId = rows[0]?.id;
    assert.ok(userId, 'a conta precisa existir');

    const { rows: confirmacao } = await db.query(
      `SELECT token FROM email_verification_tokens
       WHERE user_id = $1 AND purpose = 'verify' AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    const tokenDeConfirmacao = confirmacao[0]?.token;
    assert.ok(tokenDeConfirmacao, 'o cadastro precisa ter cunhado um token de confirmação');

    await supertest(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: tokenDeConfirmacao, newPassword: PW_NOVA })
      .expect(400);

    // E ele NÃO FOI QUEIMADO pela tentativa: continua servindo para o que foi cunhado. Esta é a
    // metade que separa "o resgate recusou por propósito" de "o resgate consumiu e depois
    // reclamou", que teria transformado a tentativa numa negação de serviço sobre o cadastro.
    await supertest(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: tokenDeConfirmacao })
      .expect(200);
    await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username, password: PW })
      .expect(200);

    // Direção 2: um token de REDEFINIÇÃO não confirma e-mail. A ordem aqui é forçada pelo
    // desenho e não por conveniência: `FIND_RESETTABLE_USER_BY_EMAIL` só cunha para endereço
    // CONFIRMADO, então o código é pedido primeiro e a confirmação é derrubada depois, para que
    // haja o que confirmar quando o token for apresentado na rota errada.
    const conta = await contaConfirmada('cruza2');
    await supertest(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: conta.email })
      .expect(200);
    const codigo = await codigoDeRedefinicao(conta.userId);
    assert.ok(codigo, 'o pedido precisa render um código');
    await db.query('UPDATE users SET email_verified = FALSE WHERE id = $1', [conta.userId]);

    await supertest(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: codigo.token })
      .expect(400);

    const { rows: depois } = await db.query('SELECT email_verified FROM users WHERE id = $1', [conta.userId]);
    assert.equal(depois.length, 1, 'a conta precisa continuar existindo');
    assert.equal(
      depois[0].email_verified,
      false,
      'um código de senha não pode confirmar endereço nenhum'
    );

    // E ele também não foi queimado: continua redefinindo a senha, que é o que foi cunhado para
    // fazer.
    await supertest(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: codigo.token, newPassword: PW_NOVA })
      .expect(200);
  });
});
