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

async function runMigrations(connectionString) {
  const connStr = connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const pgp = pgPromise();
  const db = pgp(connStr);

  try {
    // Create migrations tracking table if not exists
    await db.none(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

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
