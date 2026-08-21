// Path: tests/integration/auth.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, confirmRegistrationEmail } from '../helpers/fixtures.js';

describe('Auth API', () => {
  let app, db, user;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('POST /auth/login — returns access + refresh tokens', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: user.password })
      .expect(200);

    assert.ok(res.body.data.accessToken);
    assert.ok(res.body.data.refreshToken);
    assert.equal(res.body.data.user.username, user.username);
  });

  it('POST /auth/login — rejects wrong password', async () => {
    await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: 'WrongPassword123' })
      .expect(401);
  });

  it('POST /auth/login — rejects non-existent user', async () => {
    await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: 'nonexistent', password: 'password' })
      .expect(401);
  });

  it('POST /auth/login — a SHORT wrong password is a failed login, not a policy lecture', async () => {
    // Until 2026-08-16 the login schema carried the registration minimum, so a five-character
    // guess was refused with 422 `"password" length must be at least 6 characters long`. The
    // user reads that as "my account needs a longer password" instead of "wrong password", and
    // the differing status leaks the policy to an anonymous caller. See `auth.schemas.js`.
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: '123' })
      .expect(401);

    assert.equal(res.body.error.code, 'UNAUTHORIZED');
    assert.ok(
      !/caracteres|characters/i.test(JSON.stringify(res.body)),
      `the refusal must not name the length policy: ${JSON.stringify(res.body)}`
    );
  });

  it('POST /auth/login — an ABSENT password is still a malformed request (422)', async () => {
    // The negative half of the case above: dropping `min(6)` must not drop `required()`.
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username })
      .expect(422);

    assert.equal(res.body.error.details[0].field, 'password');
  });

  it('POST /auth/refresh — rotates refresh token', async () => {
    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: user.password });

    const res = await supertest(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.data.refreshToken })
      .expect(200);

    assert.ok(res.body.data.accessToken);
    assert.ok(res.body.data.refreshToken);
    // Old refresh token should be revoked (new one is different)
    assert.notEqual(res.body.data.refreshToken, login.body.data.refreshToken);
  });

  it('POST /auth/logout — revokes refresh token', async () => {
    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: user.password });

    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send({ refreshToken: login.body.data.refreshToken })
      .expect(204);

    // Trying to use the revoked token should fail
    await supertest(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.data.refreshToken })
      .expect(401);
  });

  it('GET /auth/me — returns current user profile', async () => {
    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: user.password });

    const res = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(200);

    assert.equal(res.body.data.username, user.username);
    assert.equal(res.body.data.nome, user.nome);
  });

  it('rejects invalid access token', async () => {
    await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid.token.here')
      .expect(401);
  });

  it('rejects missing authorization header', async () => {
    await supertest(app)
      .get('/api/v1/auth/me')
      .expect(401);
  });

  it('GET /auth/me — authenticates via the `token` cookie (no Authorization header)', async () => {
    // flexibleAuth resolves the JWT from req.cookies.token BEFORE the Bearer header
    // (the frontend uses httpOnly cookie sessions). A regression in cookie parsing or
    // precedence would silently break browser auth, which Bearer-only tests never catch.
    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: user.password });
    const accessToken = login.body.data.accessToken;

    const ok = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Cookie', `token=${accessToken}`)
      .expect(200);
    assert.equal(ok.body.data.username, user.username);
  });

  it('GET /auth/me — a garbage `token` cookie is treated as anonymous → 401 on a strict route', async () => {
    await supertest(app)
      .get('/api/v1/auth/me')
      .set('Cookie', 'token=garbage.jwt.value')
      .expect(401);
  });

  describe('POST /auth/register — Self-registration', () => {
    // The response body carries NO account data (same 201, same body, whether the
    // account was created or already existed — see auth-register-verification-oracle),
    // so what registration produced is asserted against the users table.
    async function userByUsername(username) {
      const { rows } = await db.query(
        'SELECT id, username, nome, role FROM users WHERE LOWER(username) = LOWER($1)', [username]
      );
      return rows[0];
    }

    it('registers a new user with valid data', async () => {
      const res = await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'new_register_user',
          password: 'ValidPass@123',
          nome: 'Novo Usuario Registrado',
          email: 'new_register_user@example.mil',
          posto_graduacao: 'Cap',
          organizacao_militar: 'OM Teste',
        })
        .expect(201);

      assert.deepEqual(res.body, { data: { success: true } });

      const row = await userByUsername('new_register_user');
      assert.ok(row.id);
      assert.equal(row.username, 'new_register_user');
      assert.equal(row.nome, 'Novo Usuario Registrado');
      assert.equal(row.role, 'user');
      // No credential material leaves the endpoint.
      assert.ok(!JSON.stringify(res.body).includes('password'));

      // Verify user can login
      // The account is born PENDING (e-mail is mandatory on self-registration), so this
      // login only passes once the verification token is spent through the public route.
      // Before that it is 401 EMAIL_NOT_VERIFIED — see auto-cadastro-exige-email.test.js.
      await confirmRegistrationEmail(app, db, 'new_register_user');

      const loginRes = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: 'new_register_user', password: 'ValidPass@123' })
        .expect(200);

      assert.ok(loginRes.body.data.accessToken);
    });

    it('registers a user with the minimal required fields — and e-mail is one of them', async () => {
      // This case was named "minimal required fields" with no e-mail in the payload; the
      // minimum now includes it, and that IS the change.
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'minimal_user',
          password: 'Pass123',
          nome: 'Usuario Minimo',
          email: 'minimal_user@example.mil',
        })
        .expect(201);

      const row = await userByUsername('minimal_user');
      assert.ok(row.id);
      assert.equal(row.username, 'minimal_user');
    });

    it('a duplicate username answers the SAME 201 and creates nothing', async () => {
      // This used to expect 409, which made /register an account-existence oracle for
      // anyone. The refusal is real (nothing is written); it is just no longer told to
      // the caller. Full contract in auth-register-verification-oracle.test.js.
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'duplicate_user',
          password: 'Pass123',
          nome: 'First User',
          email: 'duplicate_user@example.mil',
        })
        .expect(201);

      const res = await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'duplicate_user',
          password: 'Pass456',
          nome: 'Second User',
          email: 'duplicate_user_other@example.mil',
        })
        .expect(201);

      assert.deepEqual(res.body, { data: { success: true } });

      const { rows } = await db.query(
        'SELECT nome FROM users WHERE LOWER(username) = LOWER($1)', ['duplicate_user']
      );
      assert.equal(rows.length, 1, 'no second row');
      assert.equal(rows[0].nome, 'First User', 'and the first account is untouched');

      // The original password still works — the second attempt did not overwrite it.
      await confirmRegistrationEmail(app, db, 'duplicate_user');
      await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: 'duplicate_user', password: 'Pass123' })
        .expect(200);
    });

    it('rejects password shorter than 6 characters, in pt-BR', async () => {
      const res = await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'short_pwd_user',
          password: '12345', // Too short
          nome: 'Short Password User',
          email: 'short_pwd_user@example.mil',
        })
        .expect(422);

      // REGISTRATION is where the minimum belongs, and the message is what the user reads:
      // the web client folds `details[].message` into the text it shows (`buildApiErrorMessage`).
      assert.equal(res.body.error.details[0].field, 'password');
      assert.equal(
        res.body.error.details[0].message,
        'Senha deve ter ao menos 6 caracteres.'
      );
    });

    it('rejects username shorter than 3 characters', async () => {
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'ab', // Too short
          password: 'ValidPass',
          nome: 'Short Username',
          email: 'short_username@example.mil',
        })
        .expect(422);
    });

    it('rejects username with invalid characters', async () => {
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'invalid user!@#', // Invalid chars
          password: 'ValidPass',
          nome: 'Invalid Username',
          email: 'invalid_username@example.mil',
        })
        .expect(422);
    });

    it('rejects missing required fields', async () => {
      // Each payload omits exactly ONE field and carries all the others, e-mail included.
      // Leaving e-mail out of them as well would make every case 422 BECAUSE of the
      // e-mail, and all three would keep passing with the other rules deleted.

      // Missing username
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          password: 'ValidPass',
          nome: 'No Username',
          email: 'no_username@example.mil',
        })
        .expect(422);

      // Missing password
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'no_pwd_user',
          nome: 'No Password',
          email: 'no_pwd_user@example.mil',
        })
        .expect(422);

      // Missing nome
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'no_nome_user',
          password: 'ValidPass',
          email: 'no_nome_user@example.mil',
        })
        .expect(422);

      // Missing e-mail — the field that became required.
      const semEmail = await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'no_email_user',
          password: 'ValidPass',
          nome: 'No Email',
        })
        .expect(422);
      assert.equal(semEmail.body.error.details[0].field, 'email');
    });

    it('always creates user with role "user" regardless of input', async () => {
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'try_admin_user',
          password: 'ValidPass',
          nome: 'Try Admin',
          email: 'try_admin_user@example.mil',
          role: 'admin', // Should be ignored
        })
        .expect(201);

      assert.equal((await userByUsername('try_admin_user')).role, 'user');
    });
  });
});
