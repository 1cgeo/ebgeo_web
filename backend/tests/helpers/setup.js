// Path: tests/helpers/setup.js
// Provides test database and app instance per test suite.
// The test database is created fresh by run-tests.js and dropped after all tests,
// so no per-suite transaction isolation is needed. Each test file creates
// unique data (via UUID-based names) to avoid conflicts with parallel files.

import pg from 'pg';
import { createApp } from '../../src/app.js';

let _app = null;
let _pool = null;

/**
 * Gets the database connection string for tests.
 */
function getTestConnectionString() {
  return process.env.DATABASE_URL || 'postgresql://ebgeo:ebgeo_secret@localhost:5432/ebgeo_test';
}

/**
 * Sets required environment variables for tests if not already set.
 */
function ensureTestEnv() {
  process.env.NODE_ENV = 'test';

  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = getTestConnectionString();
  }

  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
  }

  if (!process.env.IMAGES_DIR) {
    process.env.IMAGES_DIR = './data/test-images';
  }
}

/**
 * Initializes the test environment.
 * Migrations are handled by run-tests.js (or must be applied manually for test:quick).
 * Returns a pool client for direct DB access in tests.
 */
export async function setupTestEnv() {
  ensureTestEnv();

  // Initialize pool if needed
  if (!_pool) {
    _pool = new pg.Pool({
      connectionString: getTestConnectionString(),
      max: 10,
    });
  }

  // Create app if needed
  if (!_app) {
    _app = createApp();
  }

  // Acquire a client (no transaction — data is committed so the app can see it)
  const client = await _pool.connect();

  return {
    app: _app,
    db: client,
    pool: _pool,
  };
}

/**
 * Releases the client back to the pool.
 *
 * The catch used to swallow EVERY error with the comment "Ignore release
 * errors". The pool is capped at `max: 10` and shared by every suite in the
 * process, so a leaked or double-released connection shows up much later as an
 * unexplained timeout in an unrelated file — and this catch erased the one local
 * signal that named the file responsible. (Connection exhaustion by a held
 * client is not hypothetical here: the advisory-lock incident did exactly that.)
 *
 * Exactly one error is genuinely benign and is named rather than assumed: pg
 * throws when `release()` is called twice on the same client, which is a
 * double-teardown in a test, not a broken connection. Anything else is re-thrown.
 * @param {import('pg').PoolClient} client
 * @throws {Error} on any release failure other than an already-released client.
 */
export async function teardownTestEnv(client) {
  if (!client) return;
  try {
    client.release();
  } catch (err) {
    if (/already been released/i.test(err?.message ?? '')) return;
    throw err;
  }
}

/**
 * Destroys the pool (call once after all suites).
 */
export async function destroyTestEnv() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
  _app = null;
}

/**
 * Creates a wrapped query function that uses the test client.
 */
export function createTestQuery(client) {
  return (text, params) => client.query(text, params);
}
