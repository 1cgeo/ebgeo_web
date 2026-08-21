// Path: tests/integration/auth-email-verification.test.js
// F2: self-registration e-mail confirmation. E-MAIL IS MANDATORY on `POST /auth/register`,
// so every self-registered account is created PENDING (email_verified=false) with a
// verification token issued, and login is blocked until that token is confirmed.
//
// This header used to end with "an account registered WITHOUT an e-mail stays immediately
// active", and the case below asserted it. That was the written form of an accepted risk:
// two HTTP calls produced a usable account nobody could contact, revoke by mailbox
// ownership, or correlate. The case was INVERTED rather than joined by a new one, because
// leaving both would make this suite contract the two opposite behaviours at once.
//
// The e-mail-less account did not disappear from the product — it moved to the path that
// always owned it, `POST /api/v1/users` (admin), whose schema has no e-mail field. That is
// why the gate in login() is `user.email && !user.email_verified` and must stay
// conditional; the discrimination for it lives in auto-cadastro-exige-email.test.js.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

const PW = 'Sup3r-Secret-Pw!';
const uniq = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

describe('Auth — e-mail verification (F2)', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /**
   * Reads the id of a just-registered account. POST /auth/register answers a body with
   * no account data in it — identical whether it created the account or found one
   * already there — so the id is fetched from the table instead of the response
   * (see auth-register-verification-oracle.test.js).
   */
  async function userIdByUsername(username) {
    const { rows } = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    return rows[0]?.id;
  }

  /** Reads the latest unconsumed verification token for a user id. */
  async function latestToken(userId) {
    const { rows } = await db.query(
      `SELECT token FROM email_verification_tokens
       WHERE user_id = $1 AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return rows[0]?.token ?? null;
  }

  it('register WITH e-mail → pending; login blocked until verified; then allowed', async () => {
    const username = `verif_${uniq()}`;
    const email = `${username}@example.mil`;

    await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username, password: PW, nome: 'Verif Tester', email })
      .expect(201);
    const userId = await userIdByUsername(username);
    assert.ok(userId, 'the account row must exist');
    const { rows: novo } = await db.query('SELECT email_verified FROM users WHERE id = $1', [userId]);
    assert.equal(novo[0].email_verified, false);

    // Login is blocked with the specific EMAIL_NOT_VERIFIED code.
    const blocked = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username, password: PW })
      .expect(401);
    assert.equal(blocked.body.error.code, 'EMAIL_NOT_VERIFIED');

    // Confirm via the token issued at registration.
    const token = await latestToken(userId);
    assert.ok(token, 'a verification token must have been issued');
    await supertest(app).post('/api/v1/auth/verify-email').send({ token }).expect(200);

    // Now login succeeds.
    const ok = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username, password: PW })
      .expect(200);
    assert.ok(ok.body.data.accessToken);

    // The token is single-use: re-confirming is rejected.
    await supertest(app).post('/api/v1/auth/verify-email').send({ token }).expect(400);
  });

  it('register WITHOUT e-mail is REFUSED (422) and creates nothing', async () => {
    const username = `noemail_${uniq()}`;
    const res = await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username, password: PW, nome: 'No Email' })
      .expect(422);

    // The status alone is not enough: an unmounted route would answer 404, but a 422 for
    // some OTHER field would read identically here. Name the field.
    assert.equal(res.body.error.details[0].field, 'email');

    // And nothing was written. A 422 that still inserted a row would pass the check above.
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    assert.equal(rows[0].n, 0, 'the refused registration created no row');

    // The account cannot be reached by the front door either.
    await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username, password: PW })
      .expect(401);
  });

  it('verify-email rejects an unknown/invalid token (400)', async () => {
    await supertest(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: crypto.randomUUID() })
      .expect(400);
  });

  it('verify-email rejects an EXPIRED token (400)', async () => {
    const username = `expired_${uniq()}`;
    const email = `${username}@example.mil`;
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username, password: PW, nome: 'Expired', email })
      .expect(201);
    const userId = await userIdByUsername(username);
    // Force the token into the past.
    await db.query(
      `UPDATE email_verification_tokens SET expires_at = NOW() - INTERVAL '1 hour' WHERE user_id = $1`,
      [userId]
    );
    const token = await latestToken(userId);
    await supertest(app).post('/api/v1/auth/verify-email').send({ token }).expect(400);
  });

  it('duplicate e-mail registration creates nothing, and says so only by e-mail (201)', async () => {
    // Was `.expect(409)`. A 409 here answered the question "does this address have an
    // account?" to anyone who asked, which is the enumeration oracle the register path
    // was rewritten to close on 2026-07-25. The refusal still happens; it is reported to
    // the mailbox, not to the caller. Contract: auth-register-verification-oracle.test.js.
    const email = `dup_${uniq()}@example.mil`;
    const usernameB = `dupb_${uniq()}`;
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username: `dupa_${uniq()}`, password: PW, nome: 'Dup A', email })
      .expect(201);
    const res = await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username: usernameB, password: PW, nome: 'Dup B', email })
      .expect(201);

    assert.deepEqual(res.body, { data: { success: true } });
    assert.equal(await userIdByUsername(usernameB), undefined, 'the second account is NOT created');
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    assert.equal(rows[0].n, 1, 'the address still belongs to exactly one account');
  });

  it('resend-verification always succeeds and never leaks account existence', async () => {
    // Unknown e-mail → still 200 (no enumeration oracle).
    await supertest(app)
      .post('/api/v1/auth/resend-verification')
      .send({ email: `ghost_${uniq()}@example.mil` })
      .expect(200);

    // Real, unverified account → 200 and a fresh token is issued.
    const username = `resend_${uniq()}`;
    const email = `${username}@example.mil`;
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username, password: PW, nome: 'Resend', email })
      .expect(201);
    const userId = await userIdByUsername(username);
    const before = await latestToken(userId);
    await supertest(app).post('/api/v1/auth/resend-verification').send({ email }).expect(200);
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM email_verification_tokens WHERE user_id = $1',
      [userId]
    );
    assert.ok(rows[0].n >= 2, 'resend issues an additional token');
    assert.ok(before, 'the original token existed');
  });
});
