// Path: src/database/migrate.js
// Migration runner: reads all *.sql files from migrations/ sorted by filename.
// Creates a _migrations table to track which have been applied.
// Runs inside a transaction per file.
// Usage: node src/database/migrate.js

import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pgPromise from 'pg-promise';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

// Single-int advisory lock key guarding the whole migration run (L6). Constant
// and database-wide: any process running migrations against this DB contends for
// exactly this key. Value is ASCII 'MIGR' read as int32.
const MIGRATION_LOCK_KEY = 0x4d494752;

async function runMigrations(connectionString) {
  const connStr = connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const pgp = pgPromise();
  const db = pgp(connStr);
  let lockHeld = false;

  try {
    // Create migrations tracking table if not exists
    await db.none(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // L6 — only one migration runner at a time.
    //
    // Two instances starting together (a rolling deploy, or a container restart
    // racing its replacement) both read `_migrations`, both find the same file
    // pending, and both execute it. The UNIQUE(name) index makes the second
    // INSERT fail, but only AFTER its copy of the DDL already ran — so the
    // migration's side effects can be applied twice and the process exits 1.
    //
    // This session lock makes the loser WAIT and then observe the winner's
    // committed `_migrations` rows, so it correctly skips them. Held for the
    // whole run and released in `finally` (and by Postgres if the process dies).
    await db.one('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    lockHeld = true;

    // Get list of applied migrations
    const applied = await db.any('SELECT name FROM _migrations ORDER BY name');
    const appliedNames = new Set(applied.map(r => r.name));

    // Get migration files
    const files = await readdir(MIGRATIONS_DIR);
    const sqlFiles = files
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`Found ${sqlFiles.length} migration files`);

    for (const file of sqlFiles) {
      if (appliedNames.has(file)) {
        console.log(`  ✓ ${file} (already applied)`);
        continue;
      }

      console.log(`  → Applying ${file}...`);
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');

      // Run migration in a transaction
      await db.tx(async (t) => {
        await t.none(sql);
        await t.none('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      });

      console.log(`  ✓ ${file} applied`);
    }

    console.log('All migrations completed successfully');
  } catch (err) {
    console.error('Migration failed:', err.message);
    throw err;
  } finally {
    if (lockHeld) {
      // Best-effort: pgp.end() below drops the session anyway, which releases it.
      await db.one('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    }
    await pgp.end();
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

export { runMigrations };
