// Path: tests/integration/auto-cadastro-exige-email.test.js
//
// O CASO QUE PROVA A ONDA: `email` é obrigatório no auto-cadastro.
//
// PISO, medido no código anterior a esta mudança: `POST /auth/register` com
// `{username, password, nome}` respondia **201**, gravava a linha com `is_active = true`
// e `email_verified = false`, e o `POST /auth/login` seguinte respondia **200** com
// `accessToken`. Duas chamadas HTTP e existia uma conta utilizável que ninguém podia
// contatar, revogar por posse de caixa nem correlacionar.
//
// POR QUE AS DUAS METADES DO PRIMEIRO CASO. O 422 sozinho passaria verde se a rota
// tivesse sido DESMONTADA (o 404 não é 422, mas um 422 de outro campo é indistinguível),
// e a contagem sozinha passaria verde se a rota respondesse 500. As duas juntas só
// passam se a validação recusar o campo E nada tiver sido escrito.
//
// A DISCRIMINAÇÃO, e é ela que impede o conserto errado: o gate de `login()` é
// `user.email && !user.email_verified`, condicional ao e-mail de propósito. Conta criada
// pelo caminho ADMINISTRATIVO (`POST /api/v1/users`, cujo `createUserAdminSchema` não tem
// campo `email`) continua nascendo sem endereço e logando NA HORA. Se alguém
// "simplificar" o gate para `!user.email_verified`, esse caso fica vermelho sozinho e o
// resto do arquivo continua verde — que é exatamente o que separa "a porta fechou" de "a
// porta fechou junto com o admin semeado, as contas legadas e as M2M".

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, loginUser, confirmRegistrationEmail } from '../helpers/fixtures.js';
import config from '../../src/config.js';

const SFX = randomUUID().slice(0, 8);
const PW = 'Sup3r-Secret-Pw!';

describe('auto-cadastro exige e-mail (e a conta de admin continua entrando na hora)', () => {
  let app, db;

  const register = (body) => supertest(app).post('/api/v1/auth/register').send(body);
  const login = (username, password) =>
    supertest(app).post('/api/v1/auth/login').send({ username, password });

  const contarUsuarios = async (username) => {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM users WHERE LOWER(username) = LOWER($1)', [username]
    );
    return rows[0].n;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    assert.equal(
      config.security.allowSelfRegistration, true,
      'fixture: o auto-cadastro está ligado em NODE_ENV=test, senão a rota nem é montada e tudo daria 404'
    );
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('cadastro SEM e-mail é 422 nomeando o campo, E não cria linha nenhuma', async () => {
    const username = `semmail_${SFX}`;

    const res = await register({ username, password: PW, nome: 'Sem Email' });

    assert.equal(res.status, 422, `esperado 422, obtive ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(
      res.body.error.details[0].field, 'email',
      'o 422 tem de ser SOBRE o e-mail: um 422 de outro campo passaria idêntico nesta linha'
    );

    assert.equal(
      await contarUsuarios(username), 0,
      'e nada foi escrito: um 422 que ainda insere passaria na asserção acima'
    );

    // E a conta não existe mesmo pela porta da frente (401 de credencial inválida,
    // não 200 nem EMAIL_NOT_VERIFIED — que indicaria uma linha criada).
    const entrada = await login(username, PW);
    assert.equal(entrada.status, 401);
    assert.notEqual(entrada.body.error.code, 'EMAIL_NOT_VERIFIED');
  });

  it('com e-mail a conta nasce PENDENTE, e o login só passa depois de confirmar', async () => {
    const username = `commail_${SFX}`;
    await register({ username, password: PW, nome: 'Com Email', email: `${username}@example.mil` })
      .expect(201);

    const { rows } = await db.query(
      'SELECT is_active, email_verified FROM users WHERE LOWER(username) = LOWER($1)', [username]
    );
    assert.equal(rows.length, 1, 'a linha existe');
    assert.equal(rows[0].is_active, true, 'a conta é ativa...');
    assert.equal(rows[0].email_verified, false, '...e mesmo assim pendente: quem barra é o e-mail');

    const bloqueado = await login(username, PW);
    assert.equal(bloqueado.status, 401);
    assert.equal(bloqueado.body.error.code, 'EMAIL_NOT_VERIFIED');

    await confirmRegistrationEmail(app, db, username);

    const ok = await login(username, PW).expect(200);
    assert.ok(ok.body.data.accessToken);
  });

  it('DISCRIMINAÇÃO — conta criada por ADMINISTRADOR não tem e-mail e loga NA HORA', async () => {
    // Este é o vizinho que NÃO pode mudar. `createUserAdminSchema` não tem campo
    // `email`, então a conta nasce com `email = NULL` e `email_verified = false`, e o
    // gate condicional de login() a deixa passar. Trocar o gate por
    // `!user.email_verified` deixa ESTE caso vermelho e nenhum outro.
    const admin = await createAdminUser(db, { username: `adm_${SFX}` });
    const adminToken = await loginUser(app, admin.username, admin.password);

    const username = `porAdmin_${SFX}`;
    await supertest(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username, password: PW, nome: 'Criada por admin' })
      .expect(201);

    const { rows } = await db.query(
      'SELECT email, email_verified FROM users WHERE LOWER(username) = LOWER($1)', [username]
    );
    assert.equal(rows[0].email, null, 'o caminho administrativo não tem campo de e-mail');
    assert.equal(rows[0].email_verified, false, 'e a flag continua falsa — não é ela que abre a porta');

    const ok = await login(username, PW).expect(200);
    assert.ok(ok.body.data.accessToken, 'e a conta entra sem confirmar coisa nenhuma');
  });

  it('DISCRIMINAÇÃO — o 422 novo não vira um segundo canal de distinção ao lado do 201 uniforme',
    async () => {
      // O 201 é idêntico para conta nova e para colisão (anti-enumeração, 2026-07-25).
      // A obrigatoriedade acrescenta um status novo à rota, e ele não pode depender de
      // nada sobre a conta, senão a enumeração volta pela porta da validação.
      const email = `uniforme_${SFX}@example.mil`;
      const primeiro = await register({
        username: `unif_a_${SFX}`, password: PW, nome: 'Primeiro', email,
      }).expect(201);

      // Mesmo e-mail, username inédito: colisão. Corpo idêntico.
      const colisao = await register({
        username: `unif_b_${SFX}`, password: PW, nome: 'Segundo', email,
      }).expect(201);
      assert.deepEqual(colisao.body, primeiro.body, 'colisão de e-mail responde igual a conta nova');
      assert.equal(await contarUsuarios(`unif_b_${SFX}`), 0, 'e nada foi criado');

      // Sem e-mail contra username LIVRE e contra username TOMADO: mesmo 422, mesmo corpo.
      const livre = await register({
        username: `unif_c_${SFX}`, password: PW, nome: 'Sem Mail',
      }).expect(422);
      const tomado = await register({
        username: `unif_a_${SFX}`, password: PW, nome: 'Sem Mail',
      }).expect(422);
      assert.deepEqual(tomado.body, livre.body, 'o 422 não pode variar com a existência da conta');
    });
});
