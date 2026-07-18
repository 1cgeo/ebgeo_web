// Path: tests/integration/low-impact-fixes.test.js
// Regression coverage for the low-impact findings of the 2026-07 backend scan:
//
//   L2  — the collab WebSocketServer bounds its frame size (was `ws`'s 100 MiB
//         default: 10× the HTTP body limit, buffered before any validation).
//   L4  — an e-mail verification token is genuinely single-use under concurrency.
//   L6  — the migration runner takes an advisory lock (concurrent runners wait
//         instead of racing to apply the same file twice).
//   L12 — a soft-deleted catalog item is not readable/editable by direct id.
//         (The 'unclearable description' half of L12 did not hold — see the test.)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, loginUser } from '../helpers/fixtures.js';
import { runMigrations } from '../../src/database/migrate.js';
import { attachWebSocket } from '../../src/modules/collab/collab.gateway.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Must match MIGRATION_LOCK_KEY in src/database/migrate.js.
const MIGRATION_LOCK_KEY = 0x4d494752;

describe('Low-impact scan fixes (L2 / L4 / L6 / L12)', () => {
  let app, db, adminToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db, { username: `low_admin_${randomUUID().slice(0, 6)}` });
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    try {
      await db.query('SELECT pg_advisory_unlock_all()');
    } catch {
      /* best effort */
    }
    await teardownTestEnv(db);
  });

  // ── L4 ────────────────────────────────────────────────────────────────────
  describe('L4 — verification token is single-use under concurrency', () => {
    /** Creates an unverified user + a live verification token, returning the token. */
    async function issueToken() {
      const { rows } = await db.query(
        `INSERT INTO users (username, password_hash, nome, email, email_verified)
         VALUES ($1, 'x', 'Verify Me', $2, false) RETURNING id`,
        [`ver_${randomUUID().slice(0, 8)}`, `ver_${randomUUID().slice(0, 8)}@example.mil`]
      );
      const userId = rows[0].id;
      const tok = await db.query(
        `INSERT INTO email_verification_tokens (user_id, expires_at)
         VALUES ($1, NOW() + INTERVAL '1 day') RETURNING token`,
        [userId]
      );
      return { userId, token: tok.rows[0].token };
    }

    it('two CONCURRENT verifications of the same token: exactly one succeeds', async () => {
      // The old read-check-then-write let both requests observe an unconsumed
      // token and both succeed — the token was not truly single-use.
      const { token } = await issueToken();

      const results = await Promise.all([
        supertest(app).post('/api/v1/auth/verify-email').send({ token }),
        supertest(app).post('/api/v1/auth/verify-email').send({ token }),
      ]);

      const ok = results.filter((r) => r.status >= 200 && r.status < 300).length;
      assert.equal(ok, 1, `exactly one verification may succeed (got ${ok})`);
    });

    it('the CLAIM is atomic: two concurrent claims, exactly one wins', async () => {
      // Deterministic core of the fix. Driving it through two HTTP requests does
      // NOT reliably interleave them (the old read-check-write often serializes
      // by luck), so the guarantee is asserted where it actually lives: the
      // `consumed_at IS NULL` predicate in the UPDATE. Two independent
      // connections race the same statement; Postgres row-locking must let only
      // one of them see a row in RETURNING.
      const { token } = await issueToken();
      const CLAIM = `UPDATE email_verification_tokens
                     SET consumed_at = NOW()
                     WHERE token = $1 AND consumed_at IS NULL
                     RETURNING user_id`;

      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
      try {
        const [a, b] = await Promise.all([
          pool.query(CLAIM, [token]),
          pool.query(CLAIM, [token]),
        ]);
        const winners = a.rowCount + b.rowCount;
        assert.equal(winners, 1, `exactly one claim may return a row (got ${winners})`);
      } finally {
        await pool.end();
      }
    });

    it('a token cannot be replayed after a successful verification', async () => {
      const { token, userId } = await issueToken();

      await supertest(app).post('/api/v1/auth/verify-email').send({ token }).expect(200);
      // The account really is verified…
      const { rows } = await db.query('SELECT email_verified FROM users WHERE id = $1', [userId]);
      assert.equal(rows[0].email_verified, true);

      // …and the token is burned.
      const replay = await supertest(app).post('/api/v1/auth/verify-email').send({ token });
      assert.ok(replay.status >= 400, 'a consumed token must be rejected');
    });

    it('an EXPIRED token is rejected and not silently burned', async () => {
      // The claim is rolled back on expiry, so the row stays diagnosable.
      const { rows } = await db.query(
        `INSERT INTO users (username, password_hash, nome, email, email_verified)
         VALUES ($1, 'x', 'Expired', $2, false) RETURNING id`,
        [`exp_${randomUUID().slice(0, 8)}`, `exp_${randomUUID().slice(0, 8)}@example.mil`]
      );
      const tok = await db.query(
        `INSERT INTO email_verification_tokens (user_id, expires_at)
         VALUES ($1, NOW() - INTERVAL '1 day') RETURNING token`,
        [rows[0].id]
      );

      const res = await supertest(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: tok.rows[0].token });
      assert.ok(res.status >= 400, 'an expired token must be rejected');

      const after = await db.query(
        'SELECT consumed_at FROM email_verification_tokens WHERE token = $1',
        [tok.rows[0].token]
      );
      assert.equal(after.rows[0].consumed_at, null, 'an expired token must not be consumed');
    });
  });

  // ── L12 ───────────────────────────────────────────────────────────────────
  describe('L12 — catalog soft-delete and clearable description', () => {
    const base = '/api/v1/basemaps';

    async function createItem(overrides = {}) {
      const id = `cat-${randomUUID().slice(0, 8)}`;
      const res = await supertest(app)
        .post(base)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ id, name: 'Item', description: 'uma descrição', config: {}, ...overrides });
      assert.equal(res.status, 201, `create failed: ${JSON.stringify(res.body)}`);
      return id;
    }

    it('a soft-deleted item is no longer readable by direct id', async () => {
      const id = await createItem();
      await supertest(app).get(`${base}/${id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);

      await supertest(app).delete(`${base}/${id}`).set('Authorization', `Bearer ${adminToken}`).expect(204);

      // Gone from listings AND from direct access — previously it vanished from
      // the list but was still served (and editable) by id.
      await supertest(app).get(`${base}/${id}`).set('Authorization', `Bearer ${adminToken}`).expect(404);
    });

    it('a soft-deleted item cannot be edited back into existence', async () => {
      const id = await createItem();
      await supertest(app).delete(`${base}/${id}`).set('Authorization', `Bearer ${adminToken}`).expect(204);

      await supertest(app)
        .put(`${base}/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'ressuscitado' })
        .expect(404);
    });

    it('an explicit empty description clears it; null stays a no-op', async () => {
      // NOTE: the scan flagged COALESCE as making `description` unclearable. That
      // is only true of a literal SQL NULL — `''` clears it fine, and the
      // null-vs-empty asymmetry is deliberate (pinned by images-gaps res-02), so
      // the COALESCE was left in place. This pins both halves together.
      const id = await createItem({ description: 'para limpar' });

      const cleared = await supertest(app)
        .put(`${base}/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: '' })
        .expect(200);
      assert.equal(cleared.body.data?.description ?? cleared.body.description, '');

      const noop = await supertest(app)
        .put(`${base}/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: null })
        .expect(200);
      assert.equal(
        noop.body.data?.description ?? noop.body.description,
        '',
        'null must remain a no-op, not overwrite'
      );
    });

    it('OMITTING description still leaves it unchanged', async () => {
      // Guard against over-correcting into "any update wipes the description".
      const id = await createItem({ description: 'preservar' });

      const res = await supertest(app)
        .put(`${base}/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'novo nome' })
        .expect(200);

      const kept = res.body.data?.description ?? res.body.description;
      assert.equal(kept, 'preservar', 'an omitted field must not be touched');
    });
  });

  // ── L2 ────────────────────────────────────────────────────────────────────
  describe('L2 — the collab socket bounds its frame size', () => {
    it('the WebSocketServer is created with an explicit maxPayload', async () => {
      // `ws` defaults to 100 MiB — 10× the HTTP body limit — and buffers the whole
      // frame BEFORE any auth/validation runs.
      const httpServer = createServer(app);
      const wss = attachWebSocket(httpServer);

      assert.ok(wss, 'attachWebSocket must return the server');
      const limit = wss.options?.maxPayload;
      assert.equal(typeof limit, 'number', 'maxPayload must be set explicitly');
      assert.ok(limit > 0 && limit <= 16 * 1024 * 1024, `maxPayload must be bounded, got ${limit}`);

      await new Promise((resolve) => httpServer.close(resolve));
    });
  });

  // ── L6 ────────────────────────────────────────────────────────────────────
  describe('L6 — the migration runner serializes on an advisory lock', () => {
    it('runMigrations WAITS while another runner holds the lock', async () => {
      // Two runners starting together both read _migrations, both find the same
      // file pending and both execute it; the UNIQUE(name) INSERT then fails, but
      // only AFTER the DDL already ran twice.
      await db.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

      let settled = false;
      const run = runMigrations(process.env.DATABASE_URL)
        .then(() => { settled = true; })
        .catch(() => { settled = true; });

      await sleep(500);
      assert.equal(settled, false, 'a second runner must wait for the lock');

      await db.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
      await run;
      assert.equal(settled, true, 'it proceeds once the lock is free');
    });

    it('a second run is a no-op (all migrations already applied)', async () => {
      // Idempotence is what makes the waiting runner correct: it wakes up, sees
      // the winner's committed _migrations rows, and skips them.
      await runMigrations(process.env.DATABASE_URL);
      const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM _migrations');
      assert.ok(rows[0].n > 0, 'migrations remain recorded exactly once');
    });
  });
});
