// Path: tests/integration/refresh-reuse-session-scope.repro.test.js
// Regressão (achado 35): revogação em massa não alcançava quem já segurava um access
// token vivo, e a sessão deslizante o renovava indefinidamente.
//
// O ARQUIVO ANTES. Este era um teste de CARACTERIZAÇÃO: afirmava que o access token
// sobrevivia à revogação (200 em /auth/me) e que a renovação deslizante continuava
// devolvendo Set-Cookie. Ele mesmo dizia, no cabeçalho, que quem implementasse o
// marcador por usuário veria essas duas asserções falharem, e que isso seria o sinal
// para virá-las junto com o comentário. É o que aconteceu em 2026-07-25.
//
// O INVARIANTE AGORA. `REVOKE_ALL_USER_TOKENS` grava, no MESMO statement, o carimbo
// `refresh_tokens.revoked_at` e o corte `users.sessions_valid_from`; todo access token
// com `iat` anterior ao corte é recusado pelo `auth` estrito, tem a renovação
// deslizante negada em `flexibleAuth` e não abre socket de colaboração. Vale para os
// QUATRO chamadores da query: reuso detectado, troca de senha, reset por admin e
// desativação.
//
// A RESOLUÇÃO. `iat` é em SEGUNDOS e o marcador é sub-segundo; o leitor trunca o
// marcador ao segundo e o segundo AMBÍGUO perde (`iat <= floor(corte)`). É por isso
// que este arquivo funciona: login, revogação e replay acontecem todos dentro do mesmo
// segundo de relógio, e com a regra oposta (`<`) cada asserção de 401 aqui voltaria a
// ser 200 — o teste do bug não conseguiria enxergar a correção. Justificativa completa
// e casos-limite puros em tests/unit/sessions-valid-from.test.js.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser } from '../helpers/fixtures.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
const uname = () => `reuse_${randomUUID().slice(0, 8)}`;

function tokenFromSetCookie(res) {
  const raw = res.headers['set-cookie'];
  if (!raw) return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  const cookie = arr.find((c) => c.startsWith('token='));
  return cookie ? cookie.split(';')[0].slice('token='.length) : null;
}

/** Assina um access token para `user`, com `expiresIn` e `iat` controláveis. */
function mintToken(user, { expiresIn = '15m', iat } = {}) {
  const payload = {
    sub: user.id,
    username: user.username,
    nome: user.nome,
    posto: user.posto_graduacao,
    role: user.role || 'user',
    organization_id: user.organization_id,
    org_role: user.org_role || 'viewer',
    org: user.organization_id,
    login: user.username,
  };
  // `iat` no payload é RESPEITADO por jwt.sign (ele só o sobrescreve quando ausente),
  // e o `exp` passa a ser calculado a partir dele. NÃO usar `noTimestamp` aqui: essa
  // opção DELETA o iat, e um token sem iat é justamente o que o corte não julga —
  // o teste passaria verde provando nada.
  if (iat !== undefined) payload.iat = iat;
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn });
}

describe('revogação em massa: o que ela revoga (achado 35)', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const marker = async (userId) => (await db.query(
    'SELECT sessions_valid_from FROM users WHERE id = $1', [userId]
  )).rows[0].sessions_valid_from;

  /** Loga, rotaciona, envelhece a rotação além da janela de graça e replica T1. */
  async function triggerReuseDetection() {
    const user = await createUser(db, { username: uname() });
    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: user.password })
      .expect(200);

    const accessToken = login.body.data.accessToken;
    const t1 = login.body.data.refreshToken;

    await supertest(app).post('/api/v1/auth/refresh').send({ refreshToken: t1 }).expect(200);

    // Empurra a rotação para fora de REFRESH_RACE_GRACE_MS, para o replay ser lido
    // como roubo e não como duplicata concorrente.
    await db.query(
      `UPDATE refresh_tokens SET revoked_at = NOW() - INTERVAL '1 hour'
       WHERE user_id = $1 AND revoked_at IS NOT NULL`,
      [user.id]
    );

    await supertest(app).post('/api/v1/auth/refresh').send({ refreshToken: t1 }).expect(401);

    return { user, accessToken };
  }

  it('revoga todo refresh token do usuário (a garantia que já dava)', async () => {
    const { user } = await triggerReuseDetection();

    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
      [user.id]
    );
    assert.equal(rows[0].n, 0, 'nenhum refresh token sobrevive — a rotação está morta');
  });

  it('ENCERRA a sessão que já segurava um access token vivo', async () => {
    const { accessToken } = await triggerReuseDetection();

    const res = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    assert.equal(
      res.status, 401,
      'o corte de sessão é lido por getLiveAuthState no `auth` estrito; antes disto '
      + 'este mesmo request devolvia 200 e o comentário do serviço prometia o contrário'
    );
  });

  it('a sessão deslizante NÃO renova mais o token cortado, e derruba o cookie', async () => {
    const { user } = await triggerReuseDetection();

    // Token a 4 min de expirar — dentro do limiar de 5 min de flexibleAuth. `/api/config`
    // é anônimo-tolerante, então o request passa e o que se mede é a RENOVAÇÃO.
    const nearExpiry = mintToken(user, { expiresIn: '4m' });

    const res = await supertest(app)
      .get('/api/config')
      .set('Authorization', `Bearer ${nearExpiry}`)
      .expect(200);

    // Atenção ao formato: o cookie de LIMPEZA também é um `Set-Cookie: token=...`,
    // com valor VAZIO. Conferir só a presença do header daria verde nos dois mundos.
    assert.equal(
      tokenFromSetCookie(res) || null, null,
      'nenhum token NOVO é emitido; a renovação indefinida era a metade ILIMITADA do defeito'
    );
    const cleared = (res.headers['set-cookie'] || []).some((c) => c.startsWith('token=;'));
    assert.ok(cleared, 'o cookie morto é explicitamente limpo, como no caso de conta desativada');
  });

  it('desativar a conta continua efetivo', async () => {
    const { user, accessToken } = await triggerReuseDetection();

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);

    const res = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    assert.equal(res.status, 401);
  });

  // ==========================================================================
  // A fronteira de resolução, ponta a ponta
  // ==========================================================================

  it('a fronteira do corte: o segundo ambíguo perde, o seguinte passa', async () => {
    const user = await createUser(db, { username: uname() });

    // Corta a sessão num instante conhecido, COM fração de segundo, e emite tokens de
    // `iat` controlado dos dois lados da fronteira. Sem controlar o `iat` não dá para
    // separar as duas regras: um teste que só loga e revoga cai inteiro no segundo
    // ambíguo e não distingue `<=` de `<`.
    const corteMs = Date.now();
    const corte = new Date(corteMs);
    await db.query('UPDATE users SET sessions_valid_from = $2 WHERE id = $1', [user.id, corte]);
    const segundoDoCorte = Math.floor(corteMs / 1000);

    await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${mintToken(user, { iat: segundoDoCorte, expiresIn: '1h' })}`)
      .expect(401); // ambíguo -> recusado (fail closed)

    await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${mintToken(user, { iat: segundoDoCorte - 1, expiresIn: '1h' })}`)
      .expect(401); // claramente anterior -> recusado

    await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${mintToken(user, { iat: segundoDoCorte + 1, expiresIn: '1h' })}`)
      .expect(200); // claramente posterior -> passa; o corte não mata sessão NOVA
  });

  it('marcador NULL não invalida nada — o caminho de toda conta existente', async () => {
    const user = await createUser(db, { username: uname() });
    assert.equal(await marker(user.id), null, 'conta nova nasce sem corte');

    // Token deliberadamente ANTIGO (emitido há uma hora, ainda dentro do exp).
    const antigo = mintToken(user, { iat: Math.floor(Date.now() / 1000) - 3600, expiresIn: '2h' });
    await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${antigo}`)
      .expect(200);
  });

  it('o caminho anônimo segue intacto (sem token, sem linha em users)', async () => {
    await supertest(app).get('/api/config').expect(200);
  });

  // ==========================================================================
  // Os QUATRO chamadores de REVOKE_ALL_USER_TOKENS
  // ==========================================================================

  describe('os quatro chamadores gravam o corte', () => {
    it('1. reuso de refresh token detectado', async () => {
      const { user, accessToken } = await triggerReuseDetection();
      assert.ok(await marker(user.id), 'o corte foi gravado');
      await supertest(app).get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`).expect(401);
    });

    it('2. troca de senha pelo próprio usuário', async () => {
      const user = await createUser(db, { username: uname(), password: 'Old@Pass123' });
      const login = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: user.username, password: 'Old@Pass123' })
        .expect(200);
      const access = login.body.data.accessToken;

      await supertest(app)
        .put('/api/v1/users/me/password')
        .set('Authorization', `Bearer ${access}`)
        .send({ currentPassword: 'Old@Pass123', newPassword: 'New@Pass456' })
        .expect(200);

      assert.ok(await marker(user.id), 'o corte foi gravado');
      // A conta segue viva; o que morreu foi a SESSÃO.
      await supertest(app).get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${access}`).expect(401);
      await supertest(app).post('/api/v1/auth/login')
        .send({ username: user.username, password: 'New@Pass456' }).expect(200);
    });

    it('3. reset de senha por admin', async () => {
      const admin = await createAdminUser(db, { username: `adm_${randomUUID().slice(0, 8)}` });
      const adminLogin = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: admin.username, password: admin.password })
        .expect(200);

      const alvo = await createUser(db, { username: uname() });
      const alvoLogin = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: alvo.username, password: alvo.password })
        .expect(200);
      const alvoAccess = alvoLogin.body.data.accessToken;

      await supertest(app)
        .post(`/api/v1/users/${alvo.id}/reset-password`)
        .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`)
        .send({ newPassword: 'Reset@Pass789' })
        .expect(200);

      assert.ok(await marker(alvo.id), 'o corte foi gravado');
      await supertest(app).get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${alvoAccess}`).expect(401);
      // E o admin, que não foi alvo, segue com a própria sessão.
      await supertest(app).get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`).expect(200);
    });

    it('4. desativação — o corte é REDUNDANTE aqui e é gravado assim mesmo', async () => {
      const admin = await createAdminUser(db, { username: `adm_${randomUUID().slice(0, 8)}` });
      const adminLogin = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: admin.username, password: admin.password })
        .expect(200);

      const alvo = await createUser(db, { username: uname() });

      await supertest(app)
        .delete(`/api/v1/users/${alvo.id}`)
        .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`)
        .expect(200);

      // `is_active = false` já barrava tudo; o corte existe para o invariante
      // "revogação em massa SEMPRE grava o corte" não ter exceção que alguém precise
      // lembrar. Um invariante com exceção é um invariante em que ninguém confia.
      assert.ok(
        await marker(alvo.id),
        'a desativação grava o corte apesar de is_active já bastar'
      );
    });
  });
});
