// Path: tests/integration/auth-register-verification-oracle.test.js
//
// Itens 79, 80 e 81 — as três propriedades anti-oráculo / de resiliência do cadastro,
// todas declaradas em comentário no serviço e nenhuma delas afirmada por teste.
//
//   79 — `register()` não pode ser oráculo de existência.
//
//        MUDOU EM 2026-07-25. A versão anterior deste bloco afirmava que as duas
//        colisões devolviam a MESMA mensagem 409, e tratava isso como a propriedade
//        anti-oráculo. Era caracterização de um bug: a mensagem era uniforme, o STATUS
//        não — 409 para conta existente contra 201 para conta nova enumera qualquer
//        e-mail, uma requisição por vez, sem precisar ler mensagem nenhuma. O comentário
//        do serviço afirmava a propriedade ("o atacante não sabe se um e-mail está
//        cadastrado") que o código nunca teve.
//
//        Agora o contrato é: **201 sempre, com corpo idêntico**, nada é criado quando
//        username ou e-mail já existem, e a colisão é contada por e-mail ao dono da
//        caixa (`sendAccountExistsEmail`). O 409 foi embora, e com ele o corpo com o
//        usuário criado — devolver a conta num ramo e nada no outro seria o mesmo
//        oráculo vestido de 201.
//
//        A parte que status nenhum resolve, e que este arquivo passa a prender, é o
//        TEMPO: criar conta custa `bcrypt.hash` custo 12 (centenas de ms) e o ramo "já
//        existe" custaria duas queries. É a classe de oráculo já registrada aqui (item 8
//        do relatório de testes, 2,2 ms contra 250 ms no login). O serviço hasheia ANTES
//        de saber se vai usar o hash; o teste de tempo abaixo mede, e traz seu próprio
//        controle (um 422, que não hasheia) para provar que a medição sabe distinguir.
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
import logger from '../../src/utils/logger.js';

const SFX = randomUUID().slice(0, 8);
const CORPO_201 = { data: { success: true } };

/** Captures everything pino is asked to write, at any level. */
function captureLogs() {
  const entries = [];
  const levels = ['info', 'warn', 'error', 'debug'];
  const originals = {};
  for (const lvl of levels) {
    originals[lvl] = logger[lvl];
    logger[lvl] = (obj, msg) => { entries.push({ lvl, obj, msg }); };
  }
  return {
    entries,
    restore: () => { for (const lvl of levels) logger[lvl] = originals[lvl]; },
    text: () => JSON.stringify(entries),
  };
}

/** Median of a sample, in ms. */
function mediana(valores) {
  const ord = [...valores].sort((a, b) => a - b);
  return ord[Math.floor(ord.length / 2)];
}

/** Wall time of one awaited call, in ms. */
async function medir(fn) {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

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
  // 79 — 201 sempre, corpo idêntico, e o mesmo custo de tempo nos dois ramos
  // ==========================================================================
  describe('79 — /register is not an existence oracle', () => {
    let base;

    before(async () => {
      base = payload({ username: `rg_base_${SFX}`, email: `rg_base_${SFX}@example.mil` });
      await register(base).expect(201);
    });

    it('conta nova, colisão de USERNAME e colisão de E-MAIL: mesmo status e MESMO corpo', async () => {
      const nova = await register(payload({ email: `rg_dist_${SFX}@example.mil` })).expect(201);
      const porUsername = await register(payload({ username: base.username })).expect(201);
      const porEmail = await register(payload({ email: base.email })).expect(201);

      assert.deepEqual(nova.body, CORPO_201, 'o corpo não pode carregar a conta criada');
      assert.deepEqual(porUsername.body, nova.body, 'as respostas têm de ser indistinguíveis');
      assert.deepEqual(porEmail.body, nova.body, 'as respostas têm de ser indistinguíveis');
    });

    it('nenhum 201 vaza id, username ou e-mail (nem o do caminho feliz)', async () => {
      const res = await register(payload({ email: `rg_leak_${SFX}@example.mil` })).expect(201);
      const texto = JSON.stringify(res.body);
      assert.ok(!texto.includes('"id"'), texto);
      assert.ok(!texto.includes('email'), texto);
      assert.ok(!texto.includes('username'), texto);
      // Controle: o 422 de validação REALMENTE detalha, senão os asserts acima
      // passariam mesmo num errorHandler mudo.
      const inval = await register({ username: 'x', password: '1', nome: '' }).expect(422);
      assert.ok(inval.body.error.details, 'o 422 do Joi precisa detalhar — é o contraste');
    });

    it('E-MAIL em caixa diferente colide e nada é criado (prende o LOWER() de CHECK_EMAIL_EXISTS)', async () => {
      // Sem o LOWER(), a colisão escaparia até o índice único idx_users_email_lower e o
      // errorHandler devolveria 409 'Resource already exists' — o oráculo de volta, e por
      // um caminho que nenhum comentário do serviço menciona.
      const { rows: antes } = await db.query('SELECT COUNT(*)::int AS n FROM users');
      const res = await register(payload({ email: base.email.toUpperCase() })).expect(201);
      assert.deepEqual(res.body, CORPO_201);
      const { rows: depois } = await db.query('SELECT COUNT(*)::int AS n FROM users');
      assert.equal(depois[0].n, antes[0].n, 'e-mail em caixa alta não pode criar uma segunda conta');
    });

    it('USERNAME em caixa diferente colide e nada é criado (prende o LOWER() de CHECK_USERNAME_EXISTS)', async () => {
      const { rows: antes } = await db.query('SELECT COUNT(*)::int AS n FROM users');
      const res = await register(payload({ username: base.username.toUpperCase() })).expect(201);
      assert.deepEqual(res.body, CORPO_201);
      const { rows: depois } = await db.query('SELECT COUNT(*)::int AS n FROM users');
      assert.equal(depois[0].n, antes[0].n);
    });

    it('controle: um par realmente inédito CRIA a conta (o 201 não é resposta vazia para tudo)', async () => {
      const novo = payload({ username: `rg_novo_${SFX}`, email: `rg_novo_${SFX}@example.mil` });
      await register(novo).expect(201);
      const u = await userByEmail(novo.email);
      assert.ok(u?.id, 'sem o id no corpo, a prova de criação é a linha em users');
      assert.equal(u.email_verified, false, 'e ela nasce pendente');
    });

    it('a colisão não deixa linha nova em users (o ramo "já existe" aborta antes do INSERT)', async () => {
      const { rows: antes } = await db.query('SELECT COUNT(*)::int AS n FROM users');
      await register(payload({ username: base.username })).expect(201);
      const { rows: depois } = await db.query('SELECT COUNT(*)::int AS n FROM users');
      assert.equal(depois[0].n, antes[0].n);
    });

    it('a colisão NÃO reescreve a conta existente (nem senha, nem nome, nem token)', async () => {
      // O jeito errado de "sempre 201" é fazer upsert: aí o atacante toma a conta alheia
      // trocando a senha. E emitir token novo aqui faria de /register um mail bomb.
      const dono = await userByEmail(base.email);
      const tokensAntes = await tokenCount(dono.id);

      await register(payload({
        email: base.email, nome: 'Invasor', password: 'Invasor@9999',
      })).expect(201);

      const depois = await userByEmail(base.email);
      assert.equal(depois.password_hash, dono.password_hash, 'a senha do dono não pode mudar');
      assert.equal(depois.nome, dono.nome);
      assert.equal(depois.username, dono.username);
      assert.equal(await tokenCount(dono.id), tokensAntes, 'nem token novo (mail bomb)');
    });

    it('a colisão de E-MAIL dispara o aviso PARA A CAIXA, e só para ela', async () => {
      // É aqui que a informação vai parar agora: não na resposta HTTP, no e-mail do dono.
      // Sem SMTP o mailer loga o evento, que é o canal de entrega em dev.
      const cap = captureLogs();
      try {
        await register(payload({ email: base.email })).expect(201);
      } finally {
        cap.restore();
      }
      const aviso = cap.entries.find((e) => String(e.msg).includes('account-exists notice'));
      assert.ok(aviso, `o aviso não foi emitido: ${cap.text()}`);
      assert.equal(aviso.obj.to, base.email, 'endereçado ao dono do e-mail');
    });

    it('TIMING: os dois ramos custam o mesmo (o bcrypt roda antes de saber se será usado)', async () => {
      // Fechar o oráculo pelo status não basta se o relógio ainda distingue. O ramo de
      // criação paga bcrypt custo 12; o ramo "já existe" pagaria duas queries. A
      // diferença é medível de fora — é literalmente o item 8 do relatório de testes
      // (2,2 ms contra 250 ms no login).
      const AMOSTRAS = 5;
      const novos = [];
      const colisoes = [];
      const invalidos = [];

      for (let i = 0; i < AMOSTRAS; i++) {
        // Alterna os três para diluir ruído de máquina (GC, cache do Postgres) igualmente.
        novos.push(await medir(() => register(payload({ email: `rg_t${i}_${SFX}@example.mil` })).expect(201)));
        colisoes.push(await medir(() => register(payload({ email: base.email })).expect(201)));
        // CONTROLE NEGATIVO DA MEDIÇÃO: o 422 do Joi não hasheia nada. Se ele medir o
        // mesmo que os outros dois, a medição não sabe distinguir e o verde acima não
        // estaria provando coisa alguma.
        invalidos.push(await medir(() => register({ username: 'x', password: '1', nome: '' }).expect(422)));
      }

      const mNovo = mediana(novos);
      const mColisao = mediana(colisoes);
      const mInvalido = mediana(invalidos);
      const contexto = `novo=${mNovo.toFixed(1)}ms colisao=${mColisao.toFixed(1)}ms invalido=${mInvalido.toFixed(1)}ms`;

      // A propriedade em si vem primeiro, para que a mensagem de falha nomeie o defeito
      // real (medido com o hash movido para depois da checagem: colisão caiu de 163 ms
      // para 2,4 ms).
      assert.ok(
        mColisao > 50,
        `o ramo "já existe" precisa pagar o bcrypt (senão o tempo denuncia a conta): ${contexto}`
      );
      const razao = Math.max(mNovo, mColisao) / Math.min(mNovo, mColisao);
      assert.ok(razao < 1.5, `os dois ramos precisam custar o mesmo (razão ${razao.toFixed(2)}): ${contexto}`);
      // E por último o controle da própria medição: se um caminho sem bcrypt medir o
      // mesmo que os dois de cima, os asserts anteriores não estavam provando nada.
      assert.ok(
        mInvalido < 0.5 * Math.min(mNovo, mColisao),
        `a medição precisa distinguir um caminho sem bcrypt: ${contexto}`
      );
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
      assert.deepEqual(res.body, CORPO_201);
      assert.ok(await userByEmail(email), 'e a conta foi mesmo criada (o corpo não diz mais)');
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
      await register(novo).expect(201);
      const u = await userByEmail(novo.email);
      assert.equal(await tokenCount(u.id), 1, 'o caminho feliz não regrediu');
    });
  });
});
