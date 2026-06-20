// Path: tests/integration/identity.test.js
// Fase 5: JWT org claims, legacy-token compatibility, and API-key rotation
// consumed via the global flexibleAuth (x-api-key).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';

describe('Identity: JWT org claims & API keys', () => {
  let app, db, user, token;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'identity_user' });
    await db.query(`UPDATE users SET organization_id = $1, org_role = 'editor' WHERE id = $2`, [DEFAULT_ORG, user.id]);
    token = await loginUser(app, user.username, user.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('emits organization_id and org_role in the access token', () => {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    assert.equal(payload.organization_id, DEFAULT_ORG);
    assert.equal(payload.org_role, 'editor');
  });

  it('accepts legacy tokens without the org claim (falls back)', async () => {
    const legacy = jwt.sign(
      { sub: user.id, username: user.username, role: 'user' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );
    const res = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${legacy}`)
      .expect(200);
    assert.equal(res.body.data.id, user.id);
  });

  it('rotates the API key atomically and authenticates via x-api-key', async () => {
    const r1 = await supertest(app)
      .post('/api/v1/users/me/api-key/rotate')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const key1 = r1.body.data.apiKey;
    assert.match(key1, /^[0-9a-f-]{36}$/i);

    // The api key authenticates on a strict route via flexibleAuth.
    await supertest(app).get('/api/v1/auth/me').set('x-api-key', key1).expect(200);

    // Rotate again -> old key archived, no longer valid.
    const r2 = await supertest(app)
      .post('/api/v1/users/me/api-key/rotate')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const key2 = r2.body.data.apiKey;
    assert.notEqual(key1, key2);

    await supertest(app).get('/api/v1/auth/me').set('x-api-key', key1).expect(401);
    await supertest(app).get('/api/v1/auth/me').set('x-api-key', key2).expect(200);

    // History has exactly one revoked entry (the first key); two audit rows.
    const hist = await db.query('SELECT COUNT(*)::int AS n FROM api_key_history WHERE user_id = $1', [user.id]);
    assert.equal(hist.rows[0].n, 1);
    const audit = await db.query(`SELECT COUNT(*)::int AS n FROM audit_trail WHERE action='API_KEY_ROTATE' AND actor_id=$1`, [user.id]);
    assert.equal(audit.rows[0].n, 2);
  });

  it('a malformed x-api-key does not authenticate (anonymous)', async () => {
    await supertest(app).get('/api/v1/auth/me').set('x-api-key', 'not-a-uuid').expect(401);
  });
});
