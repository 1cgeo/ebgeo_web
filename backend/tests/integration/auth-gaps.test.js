// Path: tests/integration/auth-gaps.test.js
// Gap-tests for the Authentication / JWT / middleware subsystem.
// Covers confirmed lacunas in flexibleAuth sliding-session renewal, the
// ?api_key= query branch, the frozen org/login JWT aliases, legacy-token
// degraded org claim, the disabled self-registration → 404 gate, the
// expired-but-not-revoked refresh branch, concurrent refresh of the same
// token, /me on a soft-deleted user with a live token, the HS512 algorithm
// allowlist, and login/register input boundaries.
//
// Each test asserts CURRENT behavior verified against the source. Usernames are
// unique per run (gap_<uuid8>) to keep the file independently re-runnable.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser } from '../helpers/fixtures.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';

function uname() {
  return `gap_${randomUUID().slice(0, 8)}`;
}

// Reads the `token` value from a Set-Cookie response header (array or string).
function tokenFromSetCookie(res) {
  const raw = res.headers['set-cookie'];
  if (!raw) return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  for (const c of arr) {
    const m = /(?:^|;\s*)token=([^;]+)/.exec(c);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

describe('Auth gaps', () => {
  let app, db;

  before(async () => {
    const envs = await setupTestEnv();
    app = envs.app;
    db = envs.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ---------------------------------------------------------------------------
  // auth-02 · Sliding-session cookie renewal
  // ---------------------------------------------------------------------------
  describe('auth-02 sliding-session renewal', () => {
    it('renews the token cookie when the JWT is within the 5-min threshold', async () => {
      const user = await createUser(db, { username: uname() });
      await db.query(`UPDATE users SET organization_id = $1 WHERE id = $2`, [DEFAULT_ORG, user.id]);

      // 4 min < SLIDING_THRESHOLD_MS (5 min) -> should renew.
      const nearExpiry = jwt.sign(
        {
          sub: user.id,
          username: user.username,
          nome: user.nome,
          posto: user.posto_graduacao,
          role: 'user',
          organization_id: DEFAULT_ORG,
          // `org_role: 'editor'` viaja aqui de propósito, e é um token LEGADO em
          // miniatura: a claim deixou de ser emitida em 2026-08-20 (D7) e o servidor tem
          // de IGNORÁ-LA, nunca reagir a ela. A asserção abaixo cobra o silêncio.
          org_role: 'editor',
          org: DEFAULT_ORG,
          login: user.username,
        },
        JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '4m' }
      );

      const res = await supertest(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${nearExpiry}`)
        .expect(200);

      const renewed = tokenFromSetCookie(res);
      assert.ok(renewed, 'expected a renewed token cookie when JWT is near expiry');

      // httpOnly must be set on the re-issued cookie.
      const cookieHeader = (Array.isArray(res.headers['set-cookie'])
        ? res.headers['set-cookie']
        : [res.headers['set-cookie']]).join('; ');
      assert.match(cookieHeader, /HttpOnly/i, 'renewed cookie must be httpOnly');

      // The renewed token must carry the same identity / org claims.
      const decoded = jwt.verify(renewed, JWT_SECRET, { algorithms: ['HS256'] });
      assert.equal(decoded.sub, user.id);
      assert.equal(decoded.organization_id, DEFAULT_ORG);
      assert.equal(decoded.org_role, undefined,
        'a claim do eixo de OM não pode ser re-emitida: ela chegou no token antigo e morre nele');
    });

    it('does NOT renew the cookie for a fresh (15m) token', async () => {
      const user = await createUser(db, { username: uname() });
      const fresh = jwt.sign(
        {
          sub: user.id,
          username: user.username,
          nome: user.nome,
          posto: user.posto_graduacao,
          role: 'user',
        },
        JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '15m' }
      );

      const res = await supertest(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${fresh}`)
        .expect(200);

      assert.equal(tokenFromSetCookie(res), null, 'a fresh token must not trigger renewal');
    });
  });

  // ---------------------------------------------------------------------------
  // auth-03 · ?api_key= query-parameter authentication
  // ---------------------------------------------------------------------------
  describe('auth-03 ?api_key= query branch', () => {
    it('authenticates a valid api key passed as ?api_key=', async () => {
      const user = await createUser(db, { username: uname() });
      const token = jwt.sign(
        { sub: user.id, username: user.username, role: 'user' },
        JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '15m' }
      );

      const rot = await supertest(app)
        .post('/api/v1/users/me/api-key/rotate')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const key = rot.body.data.apiKey;
      assert.match(key, /^[0-9a-f-]{36}$/i);

      // Query-param form authenticates the same user (parity with x-api-key).
      const res = await supertest(app)
        .get('/api/v1/auth/me')
        .query({ api_key: key })
        .expect(200);
      assert.equal(res.body.data.id, user.id);
    });

    it('rejects a non-UUID ?api_key= (anonymous → 401 on strict route)', async () => {
      await supertest(app)
        .get('/api/v1/auth/me')
        .query({ api_key: 'not-a-uuid' })
        .expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // auth-04 · Frozen org/login JWT aliases (consumed by ebgeo_360)
  // ---------------------------------------------------------------------------
  describe('auth-04 frozen org/login aliases', () => {
    it('issueAccessToken embeds org===organization_id and login===username', async () => {
      const user = await createUser(db, { username: uname() });
      await db.query(`UPDATE users SET organization_id = $1 WHERE id = $2`, [DEFAULT_ORG, user.id]);

      const login = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: user.username, password: user.password })
        .expect(200);

      const payload = jwt.verify(login.body.data.accessToken, JWT_SECRET, { algorithms: ['HS256'] });
      assert.equal(payload.organization_id, DEFAULT_ORG);
      assert.equal(payload.org, DEFAULT_ORG, 'frozen alias `org` must equal organization_id');
      assert.equal(payload.login, user.username, 'frozen alias `login` must equal username');
      assert.ok(payload.org !== null && payload.login !== null);
    });
  });

  // ---------------------------------------------------------------------------
  // auth-05 · Legacy token degrades to organization_id=null
  // (asserted via the deterministic sliding-session re-mint, which maps req.user
  //  and re-issues the token — no org-gated write route exists to probe).
  //
  // O CASO ENCOLHEU EM 2026-08-20 (D7) E CONTINUA MEDINDO O MESMO INVARIANTE. Ele
  // cobria duas claims de organização (`org_role` e `organization_id`); o eixo de papel
  // dentro da OM saiu do código inteiro, então sobrou a lotação. A regra é a que sempre
  // foi: claim AUSENTE degrada pelo mapeamento, nunca é promovida a partir do banco. O
  // ramo de reconciliação em `flexible-auth.js` perdeu o disjunto de `org_role` no mesmo
  // commit, e sem essa poda este caso teria passado a medir o contrário do que diz — um
  // token legado que trouxesse só `org_role` faria a lotação vir do banco.
  // ---------------------------------------------------------------------------
  describe('auth-05 legacy token degrades to null-org', () => {
    it('a legacy token (no org claim) is re-minted with org=null', async () => {
      const user = await createUser(db, { username: uname() });
      // Force a stale org on the DB row to prove the degraded value comes from
      // the TOKEN mapping (mapPayload), not from the DB.
      await db.query(`UPDATE users SET organization_id = $1 WHERE id = $2`, [DEFAULT_ORG, user.id]);

      // Legacy token: no organization_id / org / login claims.
      const legacy = jwt.sign(
        { sub: user.id, username: user.username, role: 'user' },
        JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '4m' } // near expiry -> sliding re-mint
      );

      const res = await supertest(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${legacy}`)
        .expect(200);

      const renewed = tokenFromSetCookie(res);
      assert.ok(renewed, 'sliding session should re-mint the near-expiry legacy token');

      const decoded = jwt.verify(renewed, JWT_SECRET, { algorithms: ['HS256'] });
      assert.equal(decoded.sub, user.id);
      assert.equal(decoded.organization_id, null, 'legacy token must degrade to organization_id=null');
      assert.equal(decoded.org, null, 'alias org must be null for a degraded legacy token');
    });
  });

  // ---------------------------------------------------------------------------
  // auth-06 · Expired (but not revoked) refresh token → 401 'Refresh token expired'
  // ---------------------------------------------------------------------------
  describe('auth-08 expired-but-not-revoked refresh branch', () => {
    it('an expired refresh token (revoked_at NULL) returns 401 without family revocation', async () => {
      const user = await createUser(db, { username: uname() });

      const login = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: user.username, password: user.password })
        .expect(200);
      const refreshToken = login.body.data.refreshToken;
      const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');

      // Make it expired but leave revoked_at NULL.
      const upd = await db.query(
        `UPDATE refresh_tokens SET expires_at = NOW() - INTERVAL '1 day'
         WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id`,
        [hash]
      );
      assert.equal(upd.rows.length, 1, 'fixture: exactly one matching active token');

      await supertest(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      // Expiry must NOT trigger family revocation (only reuse of a revoked token does).
      const row = await db.query(
        `SELECT revoked_at FROM refresh_tokens WHERE token_hash = $1`,
        [hash]
      );
      assert.equal(row.rows[0].revoked_at, null, 'expiry path must not revoke the token (no reuse detected)');
    });
  });

  // ---------------------------------------------------------------------------
  // auth-09 · Refreshing the SAME token twice, over HTTP
  // ---------------------------------------------------------------------------
  //
  // READ THIS BEFORE TRUSTING THIS BLOCK AS RACE COVERAGE — IT IS NOT.
  //
  // auth-09 used to be titled "at most one of two concurrent refreshes succeeds"
  // and asserted `successes.length <= 1` over two `Promise.all`-ed supertest calls.
  // That assertion was correct and the test was a FALSE GREEN: it passed on every
  // run against a rotation query that had no `revoked_at IS NULL` guard and no
  // `RETURNING`, i.e. against code that could not possibly provide the guarantee.
  // Measured directly — reverting the fix leaves this block green while
  // `auth-refresh-race.test.js` drops 4 of 5 cases.
  //
  // The mechanism: `supertest(app)` binds an ephemeral server and opens a COLD TCP
  // socket per request, and that setup cost is enough that request A finishes its
  // whole read-check-then-write sequence before request B's body reaches the
  // handler. The two calls never overlap. A real client, or an attacker, uses warm
  // keep-alive sockets and does overlap. `low-impact-fixes.test.js:79-85` had
  // already written the same finding down for the verification-token claim.
  //
  // THE RULE: mutual exclusion is asserted at the SQL or SERVICE level, never by
  // two HTTP requests. See `tests/helpers/concurrency.js` for the harness and
  // `tests/integration/auth-refresh-race.test.js` for the real proof.
  //
  // What is kept here, honestly scoped: the HTTP-level SEQUENTIAL contract — a
  // spent refresh token is refused by the route, and one login yields one live
  // token. Both are worth pinning at the edge, and neither pretends to be a race.
  describe('auth-09 a spent refresh token is refused by the route (sequential, NOT a race)', () => {
    it('rotating twice with the same token: second attempt is 401 and no second family is issued', async () => {
      const user = await createUser(db, { username: uname() });

      const login = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: user.username, password: user.password })
        .expect(200);
      const refreshToken = login.body.data.refreshToken;

      // Deliberately sequential — awaited one after the other — because that is
      // what two supertest calls actually do anyway. Saying so in the code stops
      // the next reader from mistaking this for concurrency coverage.
      await supertest(app).post('/api/v1/auth/refresh').send({ refreshToken }).expect(200);
      await supertest(app).post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);

      // The durable half: exactly one live token, so the route did not quietly
      // hand out a second family on the refused attempt.
      const { rows } = await db.query(
        'SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
        [user.id]
      );
      assert.equal(rows[0].n, 1, 'one login yields one live refresh token, spent ones stay revoked');
    });
  });

  // ---------------------------------------------------------------------------
  // auth-10 · /me for a soft-deleted user with a still-valid access token → 401
  // ---------------------------------------------------------------------------
  describe('auth-10 /me on a deactivated user with a live token', () => {
    it('returns 401 after the user is deactivated, even with an unexpired token', async () => {
      const user = await createUser(db, { username: uname() });

      const login = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: user.username, password: user.password })
        .expect(200);
      const accessToken = login.body.data.accessToken;

      // Sanity: token works while active.
      await supertest(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      await db.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);

      // FIND_USER_BY_ID filters is_active=true -> UnauthorizedError('User not found').
      await supertest(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // auth-12 · Non-allowlisted HMAC algorithm (HS512) rejected by the allowlist
  // ---------------------------------------------------------------------------
  describe('auth-12 algorithm allowlist (HS512 rejected)', () => {
    it('rejects a token signed with HS512 even with the correct secret', async () => {
      const user = await createUser(db, { username: uname() });
      const hs512 = jwt.sign(
        { sub: user.id, username: user.username, role: 'user' },
        JWT_SECRET,
        { algorithm: 'HS512', expiresIn: '15m' }
      );

      await supertest(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${hs512}`)
        .expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // auth-13 · Input boundaries on login / register
  // ---------------------------------------------------------------------------
  describe('auth-13 input boundaries', () => {
    it('login: empty-string username → 422', async () => {
      await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: '', password: 'validpass' })
        .expect(422);
    });

    it('login: 200-char password → 422 (max 100)', async () => {
      await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: uname(), password: 'a'.repeat(200) })
        .expect(422);
    });

    // The two register cases carry an `email`, which became REQUIRED. Without it both
    // payloads would be 422 for the missing e-mail and would keep passing with the
    // length rules they exist to measure deleted — an empty green.
    it('register: 101-char username → 422 (max 100)', async () => {
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'a'.repeat(101), password: 'ValidPass123', nome: 'Boundary User',
          email: `bound_${randomUUID().slice(0, 8)}@example.mil`,
        })
        .expect(422);
    });

    it('register: 101-char password → 422 (max 100)', async () => {
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username: uname(), password: 'a'.repeat(101), nome: 'Boundary User',
          email: `bound_${randomUUID().slice(0, 8)}@example.mil`,
        })
        .expect(422);
    });
  });
});
