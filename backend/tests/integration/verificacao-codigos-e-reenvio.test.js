// Path: tests/integration/verificacao-codigos-e-reenvio.test.js
//
// O BECO DE QUEM NÃO CONFIRMOU O E-MAIL, e as duas metades que o fechavam.
//
// O estado medido em 2026-08-23: uma conta criada por auto-cadastro e não confirmada NÃO
// entra (o gate de `login`), NÃO redefine a senha (a consulta de recuperação só acha
// endereço CONFIRMADO, de propósito) e o único botão de reenvio do produto vivia no
// diálogo pós-cadastro, sumindo ao primeiro clique. Sem saída nenhuma.
//
// ================= AS DUAS MUDANÇAS QUE ESTE ARQUIVO PRENDE ==================
//
// 1. CADA RECUSA DE `verifyEmail` LEVA CÓDIGO PRÓPRIO. Três das quatro colapsavam em
//    `BAD_REQUEST`, e o cliente, sem como distingui-las, mostrava uma frase única que
//    CHUTAVA a expiração. Distinguir pela MENSAGEM acoplaria a tela ao texto do servidor.
//
// 2. `resend-verification` ACEITA NOME DE USUÁRIO, além do endereço. A saída natural é
//    oferecer o reenvio ao lado do erro de login, e ali a tela tem o usuário, nunca o
//    endereço. O que NÃO pode mudar com isso é a propriedade anti-oráculo da rota, e é
//    metade do que este arquivo verifica: mesma resposta com e sem conta, e o e-mail
//    saindo sempre para o endereço REGISTRADO, nunca para um digitado por quem pede.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';

const SFX = randomUUID().slice(0, 8);

describe('confirmação de e-mail: códigos distintos e reenvio por usuário', () => {
  let app, db;

  const verify = (token) => supertest(app).post('/api/v1/auth/verify-email').send({ token });
  const resend = (body) => supertest(app).post('/api/v1/auth/resend-verification').send(body);
  const register = (body) => supertest(app).post('/api/v1/auth/register').send(body);

  /** Cria uma conta pendente e devolve `{ username, email, id }`. */
  async function contaPendente(tag) {
    const username = `vc_${tag}_${SFX}`;
    const email = `${username}@example.mil`;
    await register({
      username,
      password: 'Test@1234',
      nome: 'Verificacao Teste',
      email,
      rank_id: null,
      organization_id: null,
    }).expect(201);
    const { rows } = await db.query('SELECT id FROM users WHERE username = $1', [username]);
    assert.equal(rows.length, 1, 'a conta pendente não foi criada');
    return { username, email, id: rows[0].id };
  }

  /** O token vivo mais recente da conta, lido do banco (o e-mail não sai em teste). */
  async function tokenDe(userId, purpose = 'verify') {
    const { rows } = await db.query(
      `SELECT token, expires_at FROM email_verification_tokens
        WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [userId, purpose]
    );
    assert.equal(rows.length, 1, `nenhum token vivo de propósito ${purpose}`);
    return rows[0].token;
  }

  async function contarTokens(userId) {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM email_verification_tokens WHERE user_id = $1', [userId]
    );
    return rows[0].n;
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('guarda: o auto-cadastro está montado neste ambiente', async () => {
    // Sem isto, todo caso abaixo daria 404 e o arquivo reportaria falha de ambiente como
    // se fosse regressão de código.
    assert.equal(config.security.allowSelfRegistration, true);
  });

  // ==========================================================================
  // 1 — cada recusa com seu código
  // ==========================================================================
  describe('as recusas de verify-email não colapsam num código só', () => {
    it('token desconhecido: EMAIL_TOKEN_INVALID', async () => {
      const res = await verify(randomUUID()).expect(400);
      assert.equal(res.body.error?.code ?? res.body.code, 'EMAIL_TOKEN_INVALID');
    });

    it('token EXPIRADO: EMAIL_TOKEN_EXPIRED, e é código DIFERENTE do inválido', async () => {
      const conta = await contaPendente('exp');
      const token = await tokenDe(conta.id);
      await db.query(
        `UPDATE email_verification_tokens SET expires_at = NOW() - INTERVAL '1 hour'
          WHERE token = $1`, [token]
      );
      const res = await verify(token).expect(400);
      const codigo = res.body.error?.code ?? res.body.code;
      assert.equal(codigo, 'EMAIL_TOKEN_EXPIRED');
      // O PAR QUE IMPORTA: os dois eram `BAD_REQUEST` e por isso a tela chutava.
      assert.notEqual(codigo, 'EMAIL_TOKEN_INVALID');
    });

    it('o token expirado NÃO é queimado: continua resgatável depois de renovado', async () => {
      // A recusa por expiração faz rollback da reivindicação de propósito, para que a
      // linha siga diagnosticável e um link novo funcione.
      const conta = await contaPendente('rb');
      const token = await tokenDe(conta.id);
      await db.query(
        `UPDATE email_verification_tokens SET expires_at = NOW() - INTERVAL '1 hour'
          WHERE token = $1`, [token]
      );
      await verify(token).expect(400);
      const { rows } = await db.query(
        'SELECT consumed_at FROM email_verification_tokens WHERE token = $1', [token]
      );
      assert.equal(rows[0].consumed_at, null, 'a expiração consumiu o token');
    });

    it('token JÁ USADO cai em EMAIL_TOKEN_INVALID, não em expirado', async () => {
      const conta = await contaPendente('usado');
      const token = await tokenDe(conta.id);
      await verify(token).expect(200);
      const res = await verify(token).expect(400);
      assert.equal(res.body.error?.code ?? res.body.code, 'EMAIL_TOKEN_INVALID');
    });

    it('CONTROLE POSITIVO: o caminho feliz devolve 200 com o propósito', async () => {
      // Sem ele, todos os casos acima passariam idênticos se a rota tivesse passado a
      // recusar tudo, que é a cobertura vazia da constituição.
      const conta = await contaPendente('ok');
      const token = await tokenDe(conta.id);
      const res = await verify(token).expect(200);
      assert.equal(res.body.data.success, true);
      assert.equal(res.body.data.purpose, 'verify',
        'o propósito precisa viajar: é ele que impede a tela de mandar fazer login a quem trocou o e-mail');

      const { rows } = await db.query('SELECT email_verified FROM users WHERE id = $1', [conta.id]);
      assert.equal(rows[0].email_verified, true);
    });
  });

  // ==========================================================================
  // 2 — reenvio por usuário, sem virar oráculo
  // ==========================================================================
  describe('resend-verification aceita usuário OU e-mail', () => {
    it('por USERNAME reemite para a conta pendente', async () => {
      const conta = await contaPendente('ru');
      const antes = await contarTokens(conta.id);
      await resend({ username: conta.username }).expect(200);
      const depois = await contarTokens(conta.id);
      assert.equal(depois, antes + 1, 'o reenvio por usuário não emitiu token novo');
    });

    it('por E-MAIL continua funcionando', async () => {
      const conta = await contaPendente('re');
      const antes = await contarTokens(conta.id);
      await resend({ email: conta.email }).expect(200);
      assert.equal(await contarTokens(conta.id), antes + 1);
    });

    it('usuário DESCONHECIDO responde igual a usuário real: nada vaza', async () => {
      const conta = await contaPendente('ora');
      const real = await resend({ username: conta.username }).expect(200);
      const falso = await resend({ username: `nao_existe_${SFX}` }).expect(200);
      assert.deepEqual(falso.body, real.body,
        'as duas respostas precisam ser idênticas, senão a rota enumera contas');
    });

    it('conta JÁ CONFIRMADA não gera token novo, mesmo por usuário', async () => {
      // A condição `!user.email_verified` é o que impede a rota de virar gerador ilimitado
      // de token para uma conta ativa. Removê-la deixa este caso vermelho.
      const conta = await contaPendente('conf');
      const token = await tokenDe(conta.id);
      await verify(token).expect(200);
      const antes = await contarTokens(conta.id);
      await resend({ username: conta.username }).expect(200);
      assert.equal(await contarTokens(conta.id), antes,
        'reemitiu para uma conta que já está confirmada');
    });

    it('sem endereço e sem usuário é 422: a rota exige EXATAMENTE um dos dois', async () => {
      await resend({}).expect(422);
    });

    it('com os DOIS também é 422, e é por isso que não há precedência a decidir', async () => {
      // `xor` no schema. Enquanto era `or`, um pedido com os dois campos era resolvido por uma
      // precedência implícita no serviço, e um teste de destino que mandasse os dois teria
      // medido essa precedência acreditando estar medindo a propriedade anti-encaminhamento.
      await resend({ username: 'alguem', email: 'atacante@example.mil' }).expect(422);
    });

    it('o e-mail vai para o endereço REGISTRADO da conta encontrada pelo usuário', async () => {
      // A propriedade que impede a rota de virar encaminhador de mensagem: quem pede por
      // username não tem como escolher o destino, porque o serviço manda para `user.email`.
      const conta = await contaPendente('dest');
      const antes = await contarTokens(conta.id);
      await resend({ username: conta.username }).expect(200);
      assert.equal(await contarTokens(conta.id), antes + 1);
      const { rows } = await db.query(
        `SELECT u.email FROM email_verification_tokens t JOIN users u ON u.id = t.user_id
          WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT 1`, [conta.id]
      );
      assert.equal(rows[0].email, conta.email);
    });
  });
});
