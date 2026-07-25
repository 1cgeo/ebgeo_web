// Path: tests/integration/auth-register-verification-oracle.test.js
//
// Itens 79, 80 e 81 — as três propriedades anti-oráculo / de resiliência do cadastro,
// todas declaradas em comentário no serviço e nenhuma delas afirmada por teste.
//
//   79 — `register()` não pode ser oráculo de existência: colisão de USERNAME e colisão
//        de E-MAIL devolvem a MESMA mensagem 409 (auth.service.js:271 e :278).
//        `auth.test.js:194` só afirma `res.body.error` truthy e
//        `auth-email-verification.test.js:118` só o status. "Melhorar a UX" trocando a
//        mensagem do ramo de e-mail por 'Este e-mail já está cadastrado' deixa os dois
//        verdes e transforma /register em oráculo de e-mail para qualquer um.
//
//   80 — `resendVerification()` só reemite para conta REAL e NÃO verificada
//        (auth.service.js:386). O teste existente cobre e-mail desconhecido e conta não
//        verificada; o ramo JÁ VERIFICADO não é tocado, e seu assert final é `n >= 2`,
//        que nada diz sobre vazamento. Removida a condição `!user.email_verified`, tudo
//        segue verde e uma conta confirmada vira gerador ilimitado de token e de e-mail.
//        Além disso o teste se chama "never leaks account existence" e nunca COMPARA as
//        respostas — o nome promete o que os asserts não verificam.
//
//   81 — a emissão do token de verificação é BEST-EFFORT (o try/catch de :323-327): a
//        linha em `users` já está commitada, então uma falha de token/SMTP não pode 500.
//        Nada exercitava isso: em teste o mailer nunca lança (SMTP não configurado, ele
//        só loga). Sem o try/catch, com SMTP instável em produção o usuário recebe 500,
//        a conta fica gravada e ele não consegue nem re-registrar (409) nem logar
//        (EMAIL_NOT_VERIFIED) — conta permanentemente inacessível. A falha aqui é
//        determinística e REAL (um trigger que dá RAISE EXCEPTION no INSERT do token),
//        não um mock do mundo.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';

const SFX = randomUUID().slice(0, 8);
const MENSAGEM_409 = 'Usuário ou e-mail já cadastrado.';

describe('register / resend — existence oracle and best-effort verification (79, 80, 81)', () => {
  let app, db;

  const register = (body) => supertest(app).post('/api/v1/auth/register').send(body);
  const resend = (email) => supertest(app).post('/api/v1/auth/resend-verification').send({ email });

  /** Base payload; caller overrides username/email. */
  const payload = (over) => ({
    username: `rg_${randomUUID().slice(0, 8)}`,
    password: 'Test@1234',
    nome: 'Registro Teste',
    ...over,
  });

  async function tokenCount(userId) {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM email_verification_tokens WHERE user_id = $1', [userId]
    );
    return rows[0].n;
  }

  async function userByEmail(email) {
    const { rows } = await db.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    return rows[0];
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('guard: self-registration is mounted in this env (senão todo caso abaixo daria 404)', async () => {
    assert.equal(config.security.allowSelfRegistration, true);
  });

  // ==========================================================================
  // 79 — a mesma mensagem para as duas colisões
  // ==========================================================================
  describe('79 — /register is not an existence oracle', () => {
    let base;

    before(async () => {
      base = payload({ username: `rg_base_${SFX}`, email: `rg_base_${SFX}@example.mil` });
      await register(base).expect(201);
    });

    it('colisão de USERNAME e colisão de E-MAIL devolvem mensagem IDÊNTICA', async () => {
      const porUsername = await register(payload({ username: base.username })).expect(409);
      const porEmail = await register(payload({ email: base.email })).expect(409);

      assert.equal(porUsername.body.error.message, MENSAGEM_409);
      assert.equal(porEmail.body.error.message, MENSAGEM_409);
      assert.strictEqual(porUsername.body.error.message, porEmail.body.error.message);
      assert.equal(porUsername.body.error.code, porEmail.body.error.code);
      assert.deepEqual(porUsername.body, porEmail.body, 'as respostas têm de ser indistinguíveis');
    });

    it('o 409 não carrega error.details com `field` (o 422 do Joi carrega; este não pode)', async () => {
      const res = await register(payload({ username: base.username })).expect(409);
      assert.equal(res.body.error.details, undefined);
      assert.ok(!JSON.stringify(res.body).includes('"field"'));
      // Controle: o 422 de validação REALMENTE traz details, senão o assert acima
      // passaria mesmo num errorHandler que nunca emite details.
      const inval = await register({ username: 'x', password: '1', nome: '' }).expect(422);
      assert.ok(inval.body.error.details, 'o 422 do Joi precisa detalhar — é o contraste');
    });

    it('E-MAIL em caixa diferente colide com a MESMA mensagem (prende o LOWER() de CHECK_EMAIL_EXISTS)', async () => {
      // Sem o LOWER(), a colisão só seria pega pelo índice único idx_users_email_lower
      // e o errorHandler devolveria 'Resource already exists' — mensagem distinguível,
      // ou seja, oráculo de e-mail de volta.
      const res = await register(payload({ email: base.email.toUpperCase() })).expect(409);
      assert.equal(res.body.error.message, MENSAGEM_409);
    });

    it('USERNAME em caixa diferente colide com a MESMA mensagem (prende o LOWER() de CHECK_USERNAME_EXISTS)', async () => {
      const res = await register(payload({ username: base.username.toUpperCase() })).expect(409);
      assert.equal(res.body.error.message, MENSAGEM_409);
    });

    it('controle: um par realmente inédito cria a conta (o 409 não é a resposta padrão)', async () => {
      const res = await register(payload({ email: `rg_novo_${SFX}@example.mil` })).expect(201);
      assert.ok(res.body.data.id);
    });

    it('a colisão não deixa linha nova em users (o 409 aborta antes do INSERT)', async () => {
      const { rows: antes } = await db.query('SELECT COUNT(*)::int AS n FROM users');
      await register(payload({ username: base.username })).expect(409);
      const { rows: depois } = await db.query('SELECT COUNT(*)::int AS n FROM users');
      assert.equal(depois[0].n, antes[0].n);
    });
  });

  // ==========================================================================
  // 80 — resendVerification e o ramo JÁ VERIFICADO
  // ==========================================================================
  describe('80 — resendVerification never leaks, and never re-arms a verified account', () => {
    let verificado, naoVerificado;

    before(async () => {
      const v = payload({ username: `rg_ver_${SFX}`, email: `rg_ver_${SFX}@example.mil` });
      await register(v).expect(201);
      await db.query('UPDATE users SET email_verified = true WHERE LOWER(email) = LOWER($1)', [v.email]);
      verificado = { ...v, row: await userByEmail(v.email) };

      const n = payload({ username: `rg_pend_${SFX}`, email: `rg_pend_${SFX}@example.mil` });
      await register(n).expect(201);
      naoVerificado = { ...n, row: await userByEmail(n.email) };
    });

    it('conta JÁ VERIFICADA: 200, e a contagem de tokens permanece IDÊNTICA', async () => {
      assert.equal(verificado.row.email_verified, true, 'guard: a conta precisa estar verificada');
      const antes = await tokenCount(verificado.row.id);

      await resend(verificado.email).expect(200);
      await resend(verificado.email).expect(200);
      await resend(verificado.email).expect(200);

      assert.equal(
        await tokenCount(verificado.row.id), antes,
        'uma conta confirmada não pode virar gerador de token (mail bomb)'
      );
    });

    it('as TRÊS respostas são indistinguíveis: verificada, inexistente e pendente', async () => {
      // É isto que "never leaks account existence" significa, e é exatamente o que o
      // teste homônimo existente nunca compara.
      const a = await resend(verificado.email).expect(200);
      const b = await resend(`rg_ninguem_${SFX}@example.mil`).expect(200);
      const c = await resend(naoVerificado.email).expect(200);

      assert.deepEqual(a.body, b.body);
      assert.deepEqual(b.body, c.body);
      assert.deepEqual(a.body, { data: { success: true } });
    });

    it('controle: conta NÃO verificada ganha um token novo (o caminho feliz continua vivo)', async () => {
      const antes = await tokenCount(naoVerificado.row.id);
      await resend(naoVerificado.email).expect(200);
      assert.equal(await tokenCount(naoVerificado.row.id), antes + 1);
    });

    it('conta não verificada, resend em CAIXA DIFERENTE, ainda emite (prende o LOWER() de FIND_USER_BY_EMAIL)', async () => {
      const antes = await tokenCount(naoVerificado.row.id);
      await resend(naoVerificado.email.toUpperCase()).expect(200);
      assert.equal(await tokenCount(naoVerificado.row.id), antes + 1);
    });

    it('e-mail desconhecido não cria nada em lugar nenhum', async () => {
      const { rows: antes } = await db.query('SELECT COUNT(*)::int AS n FROM email_verification_tokens');
      await resend(`rg_fantasma_${SFX}@example.mil`).expect(200);
      const { rows: depois } = await db.query('SELECT COUNT(*)::int AS n FROM email_verification_tokens');
      assert.equal(depois[0].n, antes[0].n);
    });
  });

  // ==========================================================================
  // 81 — verificação best-effort: falhar ao emitir não pode 500 nem orfanar
  // ==========================================================================
  describe('81 — a failing verification issue must not 500 nor orphan the account', () => {
    const email = `rg_trig_${SFX}@example.mil`;
    const username = `rg_trig_${SFX}`;

    before(async () => {
      // Falha determinística e REAL no ponto exato de INSERT_VERIFICATION_TOKEN.
      await db.query(`
        CREATE OR REPLACE FUNCTION test_block_evt_${SFX}() RETURNS trigger AS $fn$
        BEGIN
          RAISE EXCEPTION 'verification token issue blocked by test';
        END;
        $fn$ LANGUAGE plpgsql;
      `);
      await db.query(`
        CREATE TRIGGER trg_block_evt_${SFX}
        BEFORE INSERT ON email_verification_tokens
        FOR EACH ROW EXECUTE FUNCTION test_block_evt_${SFX}();
      `);
    });

    after(async () => {
      await db.query(`DROP TRIGGER IF EXISTS trg_block_evt_${SFX} ON email_verification_tokens`);
      await db.query(`DROP FUNCTION IF EXISTS test_block_evt_${SFX}()`);
    });

    it('guard: o trigger realmente bloqueia (senão o 201 abaixo não prova nada)', async () => {
      await assert.rejects(
        () => db.query(
          `INSERT INTO email_verification_tokens (user_id, expires_at)
           SELECT id, NOW() + interval '1 day' FROM users LIMIT 1`
        ),
        /blocked by test/
      );
    });

    it('register com e-mail responde 201 mesmo com a emissão do token falhando', async () => {
      const res = await register(payload({ username, email }));
      assert.equal(res.status, 201, `esperado 201, obtive ${res.status}: ${JSON.stringify(res.body)}`);
      assert.ok(res.body.data.id);
    });

    it('a conta EXISTE, pendente, e sem nenhum token (nada foi orfanado do outro lado)', async () => {
      const u = await userByEmail(email);
      assert.ok(u, 'a linha em users tem de estar commitada');
      assert.equal(u.email_verified, false);
      assert.equal(await tokenCount(u.id), 0);
    });

    it('a conta pendente não loga (é o estado que torna a recuperação obrigatória)', async () => {
      const res = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username, password: 'Test@1234' });
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'EMAIL_NOT_VERIFIED');
    });

    it('caracterização: o resend NÃO tem o mesmo try/catch e propaga a falha como 500', async () => {
      // O mesmo try/catch não existe em resendVerification — aqui o comportamento é o
      // 500 do errorHandler. Documentado como caracterização: o caminho de recuperação
      // FALHA enquanto a causa persistir, o que é aceitável (o erro é transitório), mas
      // não é silencioso como no register.
      const res = await resend(email);
      assert.equal(res.status, 500, 'caracterização: resend propaga a falha, register não');
    });

    it('removido o obstáculo, o caminho de recuperação funciona ponta a ponta', async () => {
      await db.query(`DROP TRIGGER IF EXISTS trg_block_evt_${SFX} ON email_verification_tokens`);

      const u = await userByEmail(email);
      await resend(email).expect(200);
      assert.equal(await tokenCount(u.id), 1, 'agora o token é emitido');

      const { rows } = await db.query(
        'SELECT token FROM email_verification_tokens WHERE user_id = $1', [u.id]
      );
      await supertest(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: rows[0].token })
        .expect(200);

      const ok = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username, password: 'Test@1234' });
      assert.equal(ok.status, 200, 'a conta não ficou presa');
    });

    it('controle negativo: sem o trigger, register com e-mail cria EXATAMENTE 1 token', async () => {
      const novo = payload({ username: `rg_ok_${SFX}`, email: `rg_ok_${SFX}@example.mil` });
      const res = await register(novo).expect(201);
      assert.equal(await tokenCount(res.body.data.id), 1, 'o caminho feliz não regrediu');
    });
  });
});
