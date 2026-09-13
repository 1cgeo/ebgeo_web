// Path: src/database/migrate.js
// Migration runner: reads all *.sql files from migrations/ sorted by filename.
// Creates a _migrations table to track which have been applied, by name AND by
// checksum of the content, so an already applied file that changed on disk is refused.
// Runs inside a transaction per file.
// Usage: node src/database/migrate.js

import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import pgPromise from 'pg-promise';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

/**
 * sha256 (hex) of a migration file's content, with CRLF folded to LF.
 *
 * The normalization is not cosmetic: this repository mixes line endings and Git may
 * rewrite them on checkout, so hashing the raw bytes would report drift for a file
 * nobody edited, on a machine that merely cloned it differently.
 *
 * @param {string} sql raw file content
 * @returns {string} hex digest
 */
function checksumOf(sql) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

// Single-int advisory lock key guarding the whole migration run (L6). Constant
// and database-wide: any process running migrations against this DB contends for
// exactly this key. Value is ASCII 'MIGR' read as int32.
const MIGRATION_LOCK_KEY = 0x4d494752;

/**
 * Applies every pending migration and guards the ones already applied.
 *
 * @param {string} [connectionString] defaults to DATABASE_URL
 * @param {string} [migrationsDir] directory holding the *.sql files. Injected ONLY by
 *   tests, which need a copy of the baselines they can edit without touching the
 *   repository; production and `npm run migrate` always take the default.
 */
async function runMigrations(connectionString, migrationsDir = MIGRATIONS_DIR) {
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

    // The tracking table belongs to the RUNNER, not to the baselines, so it grows here
    // and not in a numbered file: a baseline that altered `_migrations` would have to be
    // applied before the runner could read the very column that decides whether to apply
    // it. Nullable on purpose, so a database tracked before 2026-09-13 is adopted below
    // instead of refused.
    await db.none('ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum TEXT');

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
    const applied = await db.any('SELECT name, checksum FROM _migrations ORDER BY name');
    const appliedNames = new Set(applied.map(r => r.name));
    const appliedChecksums = new Map(applied.map(r => [r.name, r.checksum]));

    // Get migration files
    const files = await readdir(migrationsDir);
    const sqlFiles = files
      .filter(f => f.endsWith('.sql'))
      .sort();

    // A pre-release baseline replaces the old history; silently skipping rewritten
    // files would leave a partially upgraded database. Never erase or relabel it.
    const desconhecidas = [...appliedNames].filter(name => !sqlFiles.includes(name));
    if (desconhecidas.length) {
      throw new Error('Histórico de migrações incompatível com esta versão: '
        + desconhecidas.join(', ') + '. Preserve um backup e use um banco novo para a baseline consolidada; '
        + 'nenhuma migração pendente foi aplicada.');
    }

    // DRIFT OF AN ALREADY APPLIED FILE (decision D6, 2026-09-13).
    //
    // Tracking by NAME alone skips a baseline whose CONTENT changed after it ran, so a
    // column added to an applied file exists in the repository and never in the database,
    // and nothing says so. The consolidated baselines stay editable until the first
    // deployment; from the deployed SHA on, this comparison IS the freeze.
    //
    // The whole pass runs BEFORE any pending file is applied, and it collects every
    // offender before throwing, so one run names all of them and `_migrations` is left
    // untouched on refusal.
    const derivaram = [];
    const adotar = [];
    for (const file of sqlFiles) {
      if (!appliedNames.has(file)) continue;
      const atual = checksumOf(await readFile(join(migrationsDir, file), 'utf8'));
      const gravado = appliedChecksums.get(file);
      // A row tracked before this column existed carries no checksum, and refusing it
      // would only create work: this line was never deployed, so there is no production
      // database whose drift such a row could be hiding. Adopt the current content as the
      // reference and say so out loud.
      if (!gravado) { adotar.push({ file, atual }); continue; }
      if (gravado !== atual) derivaram.push({ file, gravado, atual });
    }

    if (derivaram.length) {
      throw new Error('Migração já aplicada teve o conteúdo alterado em disco: '
        + derivaram.map(d => `${d.file} (gravado ${d.gravado}, atual ${d.atual})`).join('; ')
        + '. Em desenvolvimento, recrie o banco a partir das bases atuais; '
        + 'em produção, nunca edite uma baseline já aplicada: toda mudança de schema '
        + 'entra por um arquivo numerado novo. Nenhuma migração pendente foi aplicada.');
    }

    for (const { file, atual } of adotar) {
      await db.none('UPDATE _migrations SET checksum = $1 WHERE name = $2', [atual, file]);
      console.log(`  ~ ${file} (checksum adotado: ${atual})`);
    }

    console.log(`Found ${sqlFiles.length} migration files`);

    for (const file of sqlFiles) {
      if (appliedNames.has(file)) {
        console.log(`  ✓ ${file} (already applied)`);
        continue;
      }

      console.log(`  → Applying ${file}...`);
      const sql = await readFile(join(migrationsDir, file), 'utf8');

      // Run migration in a transaction
      await db.tx(async (t) => {
        await t.none(sql);
        await t.none('INSERT INTO _migrations (name, checksum) VALUES ($1, $2)',
          [file, checksumOf(sql)]);
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
