#!/usr/bin/env node
// Path: scripts/run-tests.js
// Complete test runner: creates DB, runs migrations, runs tests, drops DB
// Usage: node scripts/run-tests.js [--coverage] [--keep-db] [test-pattern]

import { spawn } from 'child_process';
import pgPromise from 'pg-promise';
import { runMigrations } from '../src/database/migrate.js';

// Configuration
const TEST_DB_NAME = process.env.TEST_DB_NAME || 'ebgeo_test';
const DB_USER = process.env.DB_USER || 'ebgeo';
const DB_PASSWORD = process.env.DB_PASSWORD || 'ebgeo_secret';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '5432';

const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL || `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postgres`;
const TEST_DB_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${TEST_DB_NAME}`;

// Parse arguments
const args = process.argv.slice(2);
const withCoverage = args.includes('--coverage');
const keepDb = args.includes('--keep-db');
const testPattern = args.find(a => !a.startsWith('--')) || 'tests/**/*.test.js';

let pgp = null;

async function createDatabase() {
  pgp = pgPromise();
  const adminDb = pgp(ADMIN_DB_URL);

  try {
    // Check if database exists
    const exists = await adminDb.oneOrNone(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [TEST_DB_NAME]
    );

    if (exists) {
      console.log(`📦 Database "${TEST_DB_NAME}" already exists, resetting...`);
      // Terminate connections and drop. pg_terminate_backend RETURNS rows, so use
      // .any (not .none, which throws "No return data was expected").
      await adminDb.any(`
        SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
        WHERE pg_stat_activity.datname = $1
          AND pid <> pg_backend_pid()
      `, [TEST_DB_NAME]);
      await adminDb.none(`DROP DATABASE ${TEST_DB_NAME}`);
    }

    // Create fresh database
    await adminDb.none(`CREATE DATABASE ${TEST_DB_NAME}`);
    console.log(`✅ Created database "${TEST_DB_NAME}"`);
  } finally {
    await pgp.end();
    pgp = null;
  }
}

// PostGIS is an UNTRUSTED extension: it must be created by a superuser. In CI
// the postgis/postgis image already enables it in template1 (new DBs inherit
// it). Locally the app role (ebgeo) is not a superuser, so we pre-create the
// spatial extensions with a superuser connection. Best-effort: if no superuser
// is reachable, migrations still try CREATE EXTENSION as the app role (works
// where the app role is a superuser, e.g. the CI image).
async function ensureExtensions() {
  const superUrl =
    process.env.SUPERUSER_DATABASE_URL ||
    `postgresql://postgres:postgres@${DB_HOST}:${DB_PORT}/${TEST_DB_NAME}`;
  const sp = pgPromise();
  const sdb = sp(superUrl);
  try {
    for (const ext of ['postgis', 'pg_trgm', 'unaccent', 'pgcrypto']) {
      await sdb.none(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
    }
    console.log('✅ Spatial extensions ensured (superuser)');
  } catch (err) {
    console.warn(`⚠️  Could not pre-create extensions as superuser: ${err.message}`);
    console.warn('   Migrations will attempt CREATE EXTENSION as the app role.');
  } finally {
    await sp.end();
  }
}

async function migrate() {
  console.log('📋 Running migrations...');
  await runMigrations(TEST_DB_URL);
  console.log('✅ Migrations completed');
}

async function runTests() {
  console.log(`\n🧪 Running tests${withCoverage ? ' with coverage' : ''}...\n`);

  const nodeArgs = ['--test', '--test-force-exit', '--test-concurrency=1', '--test-timeout=30000'];

  // Coverage is collected out-of-band by c8 (via NODE_V8_COVERAGE), which the spawned
  // `node --test` child inherits and writes on exit — `npm run test:coverage` wraps this
  // script in c8. Node's built-in --experimental-test-coverage is deliberately NOT used:
  // combined with --test-force-exit it cancels in-flight tests (understating coverage),
  // and without force-exit the suite hangs on open ws/pg handles.
  void withCoverage;

  nodeArgs.push(testPattern);

  return new Promise((resolve, reject) => {
    const testProcess = spawn('node', nodeArgs, {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: TEST_DB_URL,
        JWT_SECRET: 'test-secret-key-for-testing-purposes-only-32chars',
        IMAGES_DIR: './data/test-images',
      },
    });

    testProcess.on('close', (code) => {
      resolve(code);
    });

    testProcess.on('error', (err) => {
      reject(err);
    });
  });
}

async function dropDatabase() {
  pgp = pgPromise();
  const adminDb = pgp(ADMIN_DB_URL);

  try {
    // Terminate connections. pg_terminate_backend RETURNS rows, so use .any
    // (not .none, which throws "No return data was expected").
    await adminDb.any(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1
        AND pid <> pg_backend_pid()
    `, [TEST_DB_NAME]);

    // Drop database
    await adminDb.none(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
    console.log(`\n🗑️  Dropped database "${TEST_DB_NAME}"`);
  } finally {
    await pgp.end();
    pgp = null;
  }
}

async function main() {
  let exitCode = 0;

  console.log('═'.repeat(60));
  console.log('  EBGeo Backend - Test Runner');
  console.log('═'.repeat(60));
  console.log(`  Database: ${TEST_DB_NAME}`);
  console.log(`  Coverage: ${withCoverage ? 'Yes' : 'No'}`);
  console.log(`  Keep DB:  ${keepDb ? 'Yes' : 'No'}`);
  console.log(`  Pattern:  ${testPattern}`);
  console.log('═'.repeat(60));
  console.log('');

  try {
    // Step 1: Create database
    await createDatabase();

    // Step 1b: Ensure spatial extensions (PostGIS needs a superuser)
    await ensureExtensions();

    // Step 2: Run migrations
    await migrate();

    // Step 3: Run tests
    exitCode = await runTests();

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    exitCode = 1;
  } finally {
    // Step 4: Drop database (unless --keep-db)
    if (!keepDb) {
      try {
        await dropDatabase();
      } catch (err) {
        console.error('Warning: Failed to drop test database:', err.message);
      }
    } else {
      console.log(`\n📦 Database "${TEST_DB_NAME}" preserved (--keep-db)`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(exitCode === 0 ? '  ✅ All tests passed!' : '  ❌ Some tests failed');
  console.log('═'.repeat(60));

  process.exit(exitCode);
}

main();
