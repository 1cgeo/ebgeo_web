// Path: tests/integration/auth-email-verification.test.js
// F2: self-registration e-mail confirmation. An account registered WITH an e-mail is created
// PENDING (email_verified=false) and a verification token is issued; login is blocked until the
// token is confirmed. An account registered WITHOUT an e-mail stays immediately active (the login
// key is the username) — this keeps every existing username-only flow working unchanged.

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

    const reg = await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username, password: PW, nome: 'Verif Tester', email })
      .expect(201);
    const userId = reg.body.data.id;
    assert.equal(reg.body.data.email_verified, false);

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

  it('register WITHOUT e-mail → immediately active (login works right away)', async () => {
    const username = `noemail_${uniq()}`;
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username, password: PW, nome: 'No Email' })
      .expect(201);
    await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username, password: PW })
      .expect(200);
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
    const reg = await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username, password: PW, nome: 'Expired', email })
      .expect(201);
    // Force the token into the past.
    await db.query(
      `UPDATE email_verification_tokens SET expires_at = NOW() - INTERVAL '1 hour' WHERE user_id = $1`,
      [reg.body.data.id]
    );
    const token = await latestToken(reg.body.data.id);
    await supertest(app).post('/api/v1/auth/verify-email').send({ token }).expect(400);
  });

  it('duplicate e-mail registration is rejected (409)', async () => {
    const email = `dup_${uniq()}@example.mil`;
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username: `dupa_${uniq()}`, password: PW, nome: 'Dup A', email })
      .expect(201);
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username: `dupb_${uniq()}`, password: PW, nome: 'Dup B', email })
      .expect(409);
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
    const reg = await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username, password: PW, nome: 'Resend', email })
      .expect(201);
    const before = await latestToken(reg.body.data.id);
    await supertest(app).post('/api/v1/auth/resend-verification').send({ email }).expect(200);
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM email_verification_tokens WHERE user_id = $1',
      [reg.body.data.id]
    );
    assert.ok(rows[0].n >= 2, 'resend issues an additional token');
    assert.ok(before, 'the original token existed');
  });
});
