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
// pelo sha256 do token apresentado. As tres invariantes fixadas:
//   1. logout normal marca revoked_at na linha DAQUELE token, e so nela;
//   2. token nunca emitido e um no-op silencioso (204, zero linhas mudadas);
//   3. o token de OUTRO usuario e revogado sem checagem de dono (caracterizacao
//      do comportamento atual: auth.service.js:239-242 nao recebe req.user.id).
//
// Caracterizacao extra (4): logout repetido sobre um token JA revogado re-carimba
// revoked_at, porque REVOKE_REFRESH_TOKEN nao tem `WHERE revoked_at IS NULL`.

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

  it('CARACTERIZACAO: A apresenta o refreshToken de B — o token de B e revogado, sem checagem de dono', async () => {
    const sessaoA = await login(userA);
    const sessaoB = await login(userB);

    const revogadasA_antes = await revokedCount(userA.id);

    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${sessaoA.accessToken}`)
      .send({ refreshToken: sessaoB.refreshToken })
      .expect(204);

    // Comportamento ATUAL (auth.service.js:239-242 nao recebe o req.user.id):
    // qualquer autenticado desloga a sessao de qualquer outro cujo refresh token
    // ele conheca. Se um dia o servico passar a amarrar o token ao dono, esta
    // assercao inverte e o comentario acima muda com ela.
    const rB = await tokenRow(sessaoB.refreshToken);
    assert.notEqual(rB.revoked_at, null, 'hoje o token de B e revogado por A');
    assert.equal(rB.user_id, userB.id, 'a linha revogada e mesmo de B');

    // E o proprio token de A segue vivo: o logout nao mexeu na sessao do chamador.
    const rA = await tokenRow(sessaoA.refreshToken);
    assert.equal(rA.revoked_at, null, 'a sessao de A continua viva');
    assert.equal(await revokedCount(userA.id), revogadasA_antes, 'nenhuma linha de A mudou');

    // Efeito para B: perdeu a sessao sem ter pedido.
    await supertest(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: sessaoB.refreshToken })
      .expect(401);
  });

  it('CARACTERIZACAO: logout repetido re-carimba revoked_at (query sem `revoked_at IS NULL`)', async () => {
    const { accessToken, refreshToken } = await login(userA);

    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(204);
    const primeiro = (await tokenRow(refreshToken)).revoked_at;
    assert.notEqual(primeiro, null, 'primeiro logout carimbou');

    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(204);
    const segundo = (await tokenRow(refreshToken)).revoked_at;

    // REVOKE_REFRESH_TOKEN (auth.queries.js:48-50) nao filtra por revoked_at IS
    // NULL, entao o segundo logout move o carimbo para frente. Isso mantem o
    // token dentro da janela de graca de rotacao (auth.service.js:175-178)
    // indefinidamente, o que suprime a deteccao de reuso da familia.
    assert.ok(
      new Date(segundo).getTime() > new Date(primeiro).getTime(),
      `revoked_at foi re-carimbado: ${primeiro} -> ${segundo}`
    );
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
