// Path: tests/helpers/setup.js
// Provides isolated test database and app instance per test suite.
// Each suite runs in a transaction that is rolled back after all tests.

import pg from 'pg';
import { createApp } from '../../src/app.js';
import { runMigrations } from '../../src/database/migrate.js';

let _app = null;
let _pool = null;
let _migrationsRan = false;

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
 * Runs migrations once, then wraps each suite in a savepoint.
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

  // Run migrations once (skip if already ran by run-tests.js)
  if (!_migrationsRan) {
    try {
      await runMigrations(getTestConnectionString());
    } catch (err) {
      // Migrations might already be applied by run-tests.js
      if (!err.message.includes('already applied')) {
        throw err;
      }
    }
    _migrationsRan = true;
  }

  // Create app if needed
  if (!_app) {
    _app = createApp();
  }

  // Acquire a client and start a transaction for test isolation
  const client = await _pool.connect();
  await client.query('BEGIN');

  return {
    app: _app,
    db: client,
    pool: _pool,
  };
}

/**
 * Rolls back the transaction and releases the client.
 */
export async function teardownTestEnv(client) {
  if (client) {
    try {
      await client.query('ROLLBACK');
    } catch (err) {
      // Ignore rollback errors (connection might be closed)
    }
    try {
      client.release();
    } catch (err) {
      // Ignore release errors
    }
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
  _migrationsRan = false;
}

/**
 * Creates a wrapped query function that uses the test client.
 */
export function createTestQuery(client) {
  return (text, params) => client.query(text, params);
}
