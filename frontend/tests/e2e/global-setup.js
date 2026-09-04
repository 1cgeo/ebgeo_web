// Path: tests/e2e/global-setup.js

/**
 * @fileoverview Vitest globalSetup for the E2E suite. Brings up the REAL backend
 * (`ebgeo_backend`) ONCE for the whole run against a throwaway PostgreSQL DB.
 *
 * Steps (mirrors `ebgeo_backend/scripts/run-tests.js`):
 *   1. Create a fresh DB (`ebgeo_e2e`) via a superuser admin connection.
 *   2. Ensure the spatial/text extensions (postgis, pg_trgm, unaccent, pgcrypto)
 *      — PostGIS is UNTRUSTED, so a superuser connection creates them.
 *   3. Run the backend migrations (reusing `runMigrations` from the backend).
 *   4. Spawn `node src/index.js` (NODE_ENV=test) on an ephemeral port, pointed at
 *      the e2e DB, and poll `/api/v1/health` until it reports `{status:'ok'}`.
 *   5. Publish the origin via `process.env.EBGEO_E2E_BASE_URL` and the throwaway DB's
 *      connection string via `process.env.EBGEO_E2E_DB_URL`.
 *
 * If any prerequisite is missing (no Postgres reachable, no superuser, backend
 * fails to boot), `process.env.EBGEO_E2E_SKIP` is set to '1' so individual tests
 * `describe.skipIf(E2E_SKIP)` instead of failing the run.
 *
 * The returned function tears everything down: kills the backend and drops the DB.
 */

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

// Resolved FROM THIS REPO — the backend lives in `backend/` of this same monorepo.
// Was a hardcoded machine-specific path, so this whole E2E layer only ran on one
// developer's computer. `EBGEO_BACKEND_DIR` overrides it if the backend is elsewhere.
// Tres niveis: tests/e2e/ -> tests/ -> frontend/ -> raiz do monorepo. Eram dois
// ate o pacote web virar frontend/ (2026-07-18).
const BACKEND_DIR =
    process.env.EBGEO_BACKEND_DIR ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../backend');
const MIGRATE_URL = pathToFileURL(`${BACKEND_DIR}/src/database/migrate.js`).href;

// `pg-promise` is a backend dependency (not a frontend one), so resolve it from
// the backend's node_modules rather than the web project's.
const backendRequire = createRequire(pathToFileURL(`${BACKEND_DIR}/package.json`).href);
const pgPromise = backendRequire('pg-promise');

const DB_NAME = process.env.EBGEO_E2E_DB_NAME || 'ebgeo_e2e';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '5432';
const DB_USER = process.env.DB_USER || 'ebgeo';
const DB_PASSWORD = process.env.DB_PASSWORD || 'ebgeo_secret';
const PORT = parseInt(process.env.EBGEO_E2E_PORT || '3911', 10);

// Admin (create/drop DB) and app (migrate/run) connection strings.
const ADMIN_DB_URL =
    process.env.ADMIN_DATABASE_URL ||
    `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postgres`;
const E2E_DB_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
// Superuser conn into the freshly created DB (PostGIS is untrusted).
const SUPERUSER_DB_URL =
    process.env.SUPERUSER_DATABASE_URL ||
    `postgresql://postgres:postgres@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

const HEALTH_TIMEOUT_MS = 30000;
const HEALTH_INTERVAL_MS = 250;

/** Marks the run as skipped and returns a no-op teardown. */
function skip(reason) {
    process.env.EBGEO_E2E_SKIP = '1';
    console.warn(`[e2e] skipping E2E suite: ${reason}`);
    return async () => {};
}

/** Drops & recreates the e2e DB via the admin connection. */
async function createDatabase() {
    const pgp = pgPromise();
    const adminDb = pgp(ADMIN_DB_URL);
    try {
        const exists = await adminDb.oneOrNone(
            'SELECT 1 FROM pg_database WHERE datname = $1',
            [DB_NAME]
        );
        if (exists) {
            await adminDb.any(
                `SELECT pg_terminate_backend(pid)
                 FROM pg_stat_activity
                 WHERE datname = $1 AND pid <> pg_backend_pid() AND backend_type = 'client backend'`,
                [DB_NAME]
            );
            await adminDb.none(`DROP DATABASE ${DB_NAME}`);
        }
        await adminDb.none(`CREATE DATABASE ${DB_NAME}`);
    } finally {
        await pgp.end();
    }
}

/** Ensures spatial/text extensions exist (superuser; PostGIS is untrusted). */
async function ensureExtensions() {
    const sp = pgPromise();
    const sdb = sp(SUPERUSER_DB_URL);
    try {
        for (const ext of ['postgis', 'pg_trgm', 'unaccent', 'pgcrypto']) {
            await sdb.none(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
        }
    } finally {
        await sp.end();
    }
}

/** Drops the e2e DB via the admin connection (best-effort). */
async function dropDatabase() {
    const pgp = pgPromise();
    const adminDb = pgp(ADMIN_DB_URL);
    try {
        await adminDb.any(
            `SELECT pg_terminate_backend(pid)
             FROM pg_stat_activity
             WHERE datname = $1 AND pid <> pg_backend_pid() AND backend_type = 'client backend'`,
            [DB_NAME]
        );
        await adminDb.none(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    } finally {
        await pgp.end();
    }
}

/** Polls the health endpoint until ok or timeout. */
async function waitForHealth(origin) {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${origin}/api/v1/health`);
            if (res.ok) {
                const body = await res.json();
                if (body?.status === 'ok') return true;
            }
        } catch {
            // Server not up yet — keep polling.
        }
        await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS));
    }
    return false;
}

/**
 * Vitest globalSetup entry. Returns the teardown function.
 * @returns {Promise<() => Promise<void>>}
 */
export default async function setup() {
    // 1-3: provision DB + extensions + migrations. Any failure → skip.
    try {
        await createDatabase();
    } catch (err) {
        return skip(`could not create database (${err.message})`);
    }
    try {
        await ensureExtensions();
    } catch (err) {
        return skip(`could not ensure extensions as superuser (${err.message})`);
    }
    try {
        const { runMigrations } = await import(MIGRATE_URL);
        await runMigrations(E2E_DB_URL);
    } catch (err) {
        await dropDatabase().catch(() => {});
        return skip(`migrations failed (${err.message})`);
    }

    // 4: spawn the backend.
    const origin = `http://127.0.0.1:${PORT}`;
    const child = spawn('node', ['src/index.js'], {
        cwd: BACKEND_DIR,
        env: {
            ...process.env,
            NODE_ENV: 'test',
            DATABASE_URL: E2E_DB_URL,
            JWT_SECRET: 'e2e-secret-key-32-chars-minimum-aaa',
            PORT: String(PORT),
            ALLOW_SELF_REGISTRATION: 'true',
            CORS_ORIGIN: origin,
            IMAGES_DIR: './data/e2e-images',
            // The GET /api/config memo is off under NODE_ENV=test by default (the backend
            // unit suite writes to the catalog tables with raw SQL, which no service-level
            // invalidation can see). Here it is turned ON deliberately: this harness boots
            // the REAL server and every spec's boot goes through that endpoint, so it is the
            // only place where the memo — and the invalidation that keeps admin edits
            // immediate — is exercised the way a deployment runs it.
            CONFIG_CACHE_FORCE: '1',
            // The frozen `/config` contract exposes `services.tileServerUrl` as a
            // non-empty URL string; it is env-driven (defaults to '' in the backend),
            // so set it for the spawned server like a real deployment would.
            TILE_SERVER_URL: 'http://127.0.0.1:9/tiles/{z}/{x}/{y}.png',
            SEARCH_API_URL: 'http://127.0.0.1:9/busca',
        },
        stdio: ['ignore', 'inherit', 'inherit'],
    });

    let exited = false;
    child.on('exit', () => {
        exited = true;
    });

    const healthy = await waitForHealth(origin);
    if (!healthy || exited) {
        try {
            child.kill('SIGKILL');
        } catch {
            // already gone
        }
        await dropDatabase().catch(() => {});
        return skip('backend did not become healthy within timeout');
    }

    // 5: publish base URL for the harness, plus the DB connection string.
    //
    // The DB URL is not a shortcut around the API. Self-registration now REQUIRES an
    // e-mail and the account is born pending, so `registerAndLogin` has to consume a
    // real verification token before it can log in — and that token only exists as a row
    // in `email_verification_tokens` (it is delivered by e-mail, and there is no relay
    // here). The helper reads the row and then confirms through the PUBLIC route
    // `POST /auth/verify-email`, so the route stays exercised by every spec instead of
    // being bypassed by a hand-written `email_verified = true`. Same reason the
    // Playwright leg already opens pg-promise against its throwaway DB.
    process.env.EBGEO_E2E_BASE_URL = origin;
    process.env.EBGEO_E2E_DB_URL = E2E_DB_URL;
    process.env.EBGEO_E2E_SKIP = '0';

    // Teardown: kill backend, then drop DB.
    return async () => {
        await new Promise((resolve) => {
            if (exited) return resolve();
            child.once('exit', () => resolve());
            try {
                child.kill('SIGTERM');
            } catch {
                return resolve();
            }
            // Hard kill if it lingers.
            setTimeout(() => {
                try {
                    child.kill('SIGKILL');
                } catch {
                    // already gone
                }
                resolve();
            }, 5000);
        });
        await dropDatabase().catch(() => {});
        // Remove the throwaway uploaded-image files this run created (kept out of git
        // via the backend .gitignore, but cleaned here so the working tree stays tidy).
        try {
            rmSync(`${BACKEND_DIR}/data/e2e-images`, { recursive: true, force: true });
        } catch {
            // best-effort cleanup
        }
    };
}
