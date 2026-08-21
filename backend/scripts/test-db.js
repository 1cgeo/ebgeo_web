#!/usr/bin/env node
// Path: scripts/test-db.js
// Script to create/drop test database
// Usage: node scripts/test-db.js create|drop

import pgPromise from 'pg-promise';

// Test database configuration
const TEST_DB_NAME = process.env.TEST_DB_NAME || 'ebgeo_test';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL || 'postgresql://ebgeo:ebgeo_secret@localhost:5432/postgres';

const pgp = pgPromise();

async function createTestDb() {
  const adminDb = pgp(ADMIN_DB_URL);

  try {
    // Check if database exists
    const exists = await adminDb.oneOrNone(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [TEST_DB_NAME]
    );

    if (exists) {
      console.log(`Database "${TEST_DB_NAME}" already exists`);
      return;
    }

    // Create database
    await adminDb.none(`CREATE DATABASE ${TEST_DB_NAME}`);
    console.log(`✓ Created database "${TEST_DB_NAME}"`);
  } catch (err) {
    if (err.code === '42P04') {
      // Database already exists (race condition)
      console.log(`Database "${TEST_DB_NAME}" already exists`);
    } else {
      throw err;
    }
  } finally {
    await pgp.end();
  }
}

async function dropTestDb() {
  const adminDb = pgp(ADMIN_DB_URL);

  try {
    // Terminate existing connections
    await adminDb.none(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = $1
        AND pid <> pg_backend_pid() AND backend_type = 'client backend'
    `, [TEST_DB_NAME]);

    // Drop database
    await adminDb.none(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
    console.log(`✓ Dropped database "${TEST_DB_NAME}"`);
  } finally {
    await pgp.end();
  }
}

async function resetTestDb() {
  await dropTestDb();
  // Re-initialize pg-promise since we ended it
  const pgpNew = pgPromise();
  const adminDb = pgpNew(ADMIN_DB_URL);

  try {
    await adminDb.none(`CREATE DATABASE ${TEST_DB_NAME}`);
    console.log(`✓ Created fresh database "${TEST_DB_NAME}"`);
  } finally {
    await pgpNew.end();
  }
}

// CLI
const command = process.argv[2];

switch (command) {
  case 'create':
    createTestDb()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error('Failed to create test database:', err.message);
        process.exit(1);
      });
    break;

  case 'drop':
    dropTestDb()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error('Failed to drop test database:', err.message);
        process.exit(1);
      });
    break;

  case 'reset':
    resetTestDb()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error('Failed to reset test database:', err.message);
        process.exit(1);
      });
    break;

  default:
    console.log('Usage: node scripts/test-db.js <create|drop|reset>');
    process.exit(1);
}
