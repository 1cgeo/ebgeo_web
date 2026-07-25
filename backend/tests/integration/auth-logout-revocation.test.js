// Path: tests/integration/auth-logout-revocation.test.js
// Item 156 (testes-backend.md, fatia be-auth): logout() revoga por hash sem
// checar dono nem linhas afetadas.
//
// O que existia antes: auth.test.js:63-79 e auth-edge-cases.test.js:178-203
// encadeavam 204 + 401 no refresh seguinte. Nenhum dos dois olha a tabela. Se
// REVOKE_REFRESH_TOKEN deixasse de casar (hash trocado, coluna renomeada), o 204
// continuaria vindo (o controller nao le rowCount, auth.controller.js:17-21) e o
// 401 seguinte poderia vir por qualquer outro motivo do caminho de rotacao. O
// 204 sozinho nao distingue "revoguei" de "nao revoguei nada".
//
// Aqui a assercao e contra a AUTORIDADE: a linha de refresh_tokens identificada
// pelo sha256 do token apresentado. As invariantes fixadas:
//   1. logout normal marca revoked_at na linha DAQUELE token, e so nela;
//   2. token nunca emitido e um no-op silencioso (204, zero linhas mudadas);
//   3. o token de OUTRO usuario NAO e revogado (o dono vem do JWT, nao do corpo);
//   4. logout repetido nao mexe no carimbo (revogacao idempotente);
//   5. e a consequencia do (4): o alarme de reuso continua armado depois de
//      quantos logouts o usuario apertar.
//
// ATUALIZADO em 2026-07-25. Os casos 3 e 4 nasceram como CARACTERIZACAO de dois
// defeitos e agora afirmam o comportamento corrigido; um caso 5 novo foi somado.
// O que mudou em REVOKE_REFRESH_TOKEN (auth.queries.js) e por que:
//
//   (a) `AND user_id = $2`, com o $2 vindo de req.user.id (JWT verificado), nunca
//       do corpo. Antes a query casava so por token_hash e o service nem recebia o
//       id do chamador: conhecer o refresh token de alguem ERA a credencial
//       suficiente para derrubar a sessao dele. O caso 3 invertei: A apresenta o
//       token de B, recebe 204, e a sessao de B segue viva e utilizavel.
//
//   (b) `AND revoked_at IS NULL`. Sem isso o segundo logout reescrevia revoked_at
//       com NOW(). Como refresh() separa "duplicata concorrente" de "roubo" pela
//       IDADE do carimbo (REFRESH_RACE_GRACE_MS = 10s, auth.service.js), re-carimbar
//       mantinha o token gasto para sempre DENTRO da janela de graca, onde um replay
//       e lido como duplicata e a deteccao de reuso nunca dispara. O caso 4 agora
//       exige carimbo IDENTICO no segundo logout, e o caso 5 prova a consequencia
//       que da sentido ao caso 4: apos logout repetido, um replay tardio ainda
//       revoga a familia inteira.
//
// A resposta continua 204 nos tres tipos de erro (token de outro, ja revogado,
// inexistente) — de proposito, e a justificativa esta no comentario do
// auth.controller.js. Por isso NENHUM caso aqui distingue os casos pelo status:
// todos distinguem pelo ESTADO DO BANCO, que e onde a diferenca existe.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser } from '../helpers/fixtures.js';

const uname = (p) => `lgr_${p}_${randomUUID().slice(0, 8)}`;

const hashOf = (token) => crypto.createHash('sha256').update(token).digest('hex');

describe('Auth — logout revoga (item 156)', () => {
  let app, db, userA, userB;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    userA = await createUser(db, { username: uname('a') });
    userB = await createUser(db, { username: uname('b') });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Faz login e devolve { accessToken, refreshToken }. */
  async function login(user) {
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: user.password })
      .expect(200);
    return res.body.data;
  }

  /** Le a linha de refresh_tokens correspondente ao token cru (ou undefined). */
  async function tokenRow(refreshToken) {
    const { rows } = await db.query(
      'SELECT user_id, revoked_at FROM refresh_tokens WHERE token_hash = $1',
      [hashOf(refreshToken)]
    );
    return rows[0];
  }

  /**
   * revoked_at COMO TEXTO (microssegundos), nao como Date.
   *
   * Um `new Date(...).getTime()` trunca para milissegundos, e dois logouts
   * separados por menos de 1ms colidiriam no mesmo valor — o teste de
   * idempotencia passaria com a query defeituosa. `::text` preserva a resolucao
   * de microssegundo do timestamptz, que nenhum par de round-trips empata.
   */
  async function revokedAtText(refreshToken) {
    const { rows } = await db.query(
      'SELECT revoked_at::text AS ts FROM refresh_tokens WHERE token_hash = $1',
      [hashOf(refreshToken)]
    );
    return rows[0]?.ts ?? null;
  }

  /** Quantas linhas do usuario estao revogadas agora. */
  async function revokedCount(userId) {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NOT NULL',
      [userId]
    );
    return rows[0].n;
  }

  it('logout normal: 204 E a linha do token apresentado fica com revoked_at NOT NULL', async () => {
    const { accessToken, refreshToken } = await login(userA);

    const antes = await tokenRow(refreshToken);
    assert.ok(antes, 'a linha do refresh token precisa existir apos o login');
    assert.equal(antes.revoked_at, null, 'token recem-emitido nasce nao revogado');
    assert.equal(antes.user_id, userA.id, 'a linha pertence a A');

    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(204);

    // A assercao que o 204 nao faz: o estado no banco mudou.
    const depois = await tokenRow(refreshToken);
    assert.notEqual(depois.revoked_at, null, 'revoked_at precisa ter sido carimbado pelo logout');
  });

  it('logout so toca a linha do token apresentado, nao a familia inteira', async () => {
    // Duas sessoes vivas do mesmo usuario (dois dispositivos).
    const sessao1 = await login(userA);
    const sessao2 = await login(userA);
    assert.notEqual(sessao1.refreshToken, sessao2.refreshToken, 'dois logins, dois tokens distintos');

    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${sessao1.accessToken}`)
      .send({ refreshToken: sessao1.refreshToken })
      .expect(204);

    const r1 = await tokenRow(sessao1.refreshToken);
    const r2 = await tokenRow(sessao2.refreshToken);
    assert.notEqual(r1.revoked_at, null, 'a sessao deslogada esta revogada');
    assert.equal(r2.revoked_at, null, 'a outra sessao do mesmo usuario continua viva');

    // E o efeito observavel pelo cliente concorda com o banco.
    await supertest(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: sessao2.refreshToken })
      .expect(200);
  });

  it('refreshToken nunca emitido: 204 e NENHUMA linha muda de revoked_at (no-op silencioso)', async () => {
    const { accessToken } = await login(userA);

    const { rows: antes } = await db.query(
      'SELECT token_hash, revoked_at FROM refresh_tokens ORDER BY token_hash'
    );

    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken: 'never-issued-token' })
      .expect(204);

    const { rows: depois } = await db.query(
      'SELECT token_hash, revoked_at FROM refresh_tokens ORDER BY token_hash'
    );

    assert.equal(depois.length, antes.length, 'nenhuma linha criada nem removida');
    assert.deepEqual(
      depois.map((r) => `${r.token_hash}:${r.revoked_at === null ? 'live' : 'revoked'}`),
      antes.map((r) => `${r.token_hash}:${r.revoked_at === null ? 'live' : 'revoked'}`),
      'o 204 de um token inexistente nao pode ter mudado o estado de revogacao de ninguem'
    );
  });

  it('A apresenta o refreshToken de B: 204, mas a sessao de B NAO e tocada (dono vem do JWT)', async () => {
    const sessaoA = await login(userA);
    const sessaoB = await login(userB);

    const revogadasA_antes = await revokedCount(userA.id);
    const revogadasB_antes = await revokedCount(userB.id);

    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${sessaoA.accessToken}`)
      .send({ refreshToken: sessaoB.refreshToken })
      .expect(204);

    // O 204 aqui e deliberado (nao vaza se o token existe / e de quem); a diferenca
    // entre "revoguei" e "nao revoguei" tem que ser lida no banco, e e o que segue.
    const rB = await tokenRow(sessaoB.refreshToken);
    assert.equal(rB.revoked_at, null, 'o token de B nao pode ser revogado por A');
    assert.equal(rB.user_id, userB.id, 'a linha inspecionada e mesmo de B');
    assert.equal(await revokedCount(userB.id), revogadasB_antes, 'nenhuma linha de B mudou');

    // E o proprio token de A segue vivo: apresentar o token de outro nao derruba
    // a sessao de ninguem, nem a do chamador.
    const rA = await tokenRow(sessaoA.refreshToken);
    assert.equal(rA.revoked_at, null, 'a sessao de A continua viva');
    assert.equal(await revokedCount(userA.id), revogadasA_antes, 'nenhuma linha de A mudou');

    // Prova de ponta a ponta para B: a sessao dele continua utilizavel.
    await supertest(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: sessaoB.refreshToken })
      .expect(200);
  });

  it('logout repetido e idempotente: o segundo NAO mexe no carimbo de revoked_at', async () => {
    const { accessToken, refreshToken } = await login(userA);

    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(204);
    const primeiro = await revokedAtText(refreshToken);
    assert.notEqual(primeiro, null, 'primeiro logout carimbou');

    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(204);
    const segundo = await revokedAtText(refreshToken);

    // `AND revoked_at IS NULL` na REVOKE_REFRESH_TOKEN: a linha ja revogada nao
    // casa mais, entao o segundo logout e um no-op de banco. Igualdade EXATA, nao
    // `>=`: um `>=` passaria tambem com a query antiga, que e precisamente o que
    // este caso existe para reprovar.
    assert.equal(
      segundo,
      primeiro,
      `o segundo logout re-carimbou revoked_at: ${primeiro} -> ${segundo}`
    );
  });

  it('depois de logout repetido, o alarme de reuso da familia continua armado', async () => {
    // A razao de ser da idempotencia, medida no efeito e nao na coluna. Usuario
    // proprio para que "familia" aqui seja so estes dois tokens.
    const dono = await createUser(db, { username: uname('fam') });
    const sessao1 = await login(dono); // sera deslogada
    const sessao2 = await login(dono); // fica viva: e a familia a proteger

    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${sessao1.accessToken}`)
      .send({ refreshToken: sessao1.refreshToken })
      .expect(204);

    // Envelhece o carimbo para fora da janela de graca (10s) sem dormir 10s: a
    // decisao de refresh() le `revoked_at`, entao recuar a coluna e a mesma entrada
    // que o relogio daria. Mesmo recurso de auth-refresh-race.repro.test.js:137.
    await db.query(
      "UPDATE refresh_tokens SET revoked_at = NOW() - INTERVAL '1 hour' WHERE token_hash = $1",
      [hashOf(sessao1.refreshToken)]
    );
    const envelhecido = await revokedAtText(sessao1.refreshToken);

    // O gesto que desarmava o alarme: apertar "sair" de novo. Com a query antiga
    // isto reescrevia revoked_at para NOW() e devolvia o token para dentro da
    // janela de graca, onde o replay abaixo seria lido como duplicata concorrente.
    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${sessao1.accessToken}`)
      .send({ refreshToken: sessao1.refreshToken })
      .expect(204);
    assert.equal(
      await revokedAtText(sessao1.refreshToken),
      envelhecido,
      'o segundo logout nao pode ter rejuvenescido o carimbo'
    );

    // Replay tardio do token deslogado = evidencia de comprometimento.
    await supertest(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: sessao1.refreshToken })
      .expect(401);

    // E o alarme e isto: a familia INTEIRA cai, inclusive a sessao viva.
    const r2 = await tokenRow(sessao2.refreshToken);
    assert.notEqual(r2.revoked_at, null, 'a deteccao de reuso revogou a familia toda');
    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
      [dono.id]
    );
    assert.equal(rows[0].n, 0, 'nenhum token vivo sobra apos a deteccao de reuso');

    await supertest(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: sessao2.refreshToken })
      .expect(401);
  });

  it('POST /auth/logout sem Authorization: 401 (middleware `auth` estrito da rota)', async () => {
    const { refreshToken } = await login(userA);

    const res = await supertest(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken })
      .expect(401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');

    // E o token segue vivo: o gate decide ANTES de qualquer escrita.
    const row = await tokenRow(refreshToken);
    assert.equal(row.revoked_at, null, 'um 401 nao pode ter revogado nada');
  });
});
