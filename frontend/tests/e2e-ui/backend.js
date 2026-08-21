// Path: e2e-ui/backend.js

/**
 * @fileoverview Brings up the REAL ebgeo_backend for the Playwright browser-E2E
 * run, against a throwaway PostgreSQL database. Mirrors the vitest E2E harness
 * (tests/e2e/global-setup.js) but is parameterized by CORS origin + port so the
 * browser at the Vite origin can talk to it cross-origin.
 *
 * pg-promise + the migration runner are backend-only deps, so they are resolved
 * from the backend's node_modules / source via absolute file URLs.
 */

import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { BACKEND_DIR } from './constants.js';

const backendRequire = createRequire(pathToFileURL(`${BACKEND_DIR}/package.json`).href);
/** pg-promise factory, resolved from the backend's node_modules. Exported so the
 *  read-only SQL ground-truth helper (helpers/db.js) reuses the same driver. */
export const pgPromise = backendRequire('pg-promise');
const MIGRATE_URL = pathToFileURL(`${BACKEND_DIR}/src/database/migrate.js`).href;

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '5432';
const DB_USER = process.env.DB_USER || 'ebgeo';
const DB_PASSWORD = process.env.DB_PASSWORD || 'ebgeo_secret';

const ADMIN_DB_URL =
    process.env.ADMIN_DATABASE_URL ||
    `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postgres`;

/** Builds the app-role connection URL for a given throwaway DB (exported for helpers/db.js). */
export const appDbUrl = (dbName) => `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${dbName}`;
const superDbUrl = (dbName) =>
    process.env.SUPERUSER_DATABASE_URL ||
    `postgresql://postgres:postgres@${DB_HOST}:${DB_PORT}/${dbName}`;

const HEALTH_TIMEOUT_MS = 30000;
const HEALTH_INTERVAL_MS = 250;

/** Drops & recreates the throwaway DB via the admin connection. */
async function createDatabase(dbName) {
    const pgp = pgPromise();
    const adminDb = pgp(ADMIN_DB_URL);
    try {
        const exists = await adminDb.oneOrNone('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
        if (exists) {
            await adminDb.any(
                `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                 WHERE datname = $1 AND pid <> pg_backend_pid() AND backend_type = 'client backend'`,
                [dbName]
            );
            await adminDb.none(`DROP DATABASE ${dbName}`);
        }
        await adminDb.none(`CREATE DATABASE ${dbName}`);
    } finally {
        await pgp.end();
    }
}

/** Ensures spatial/text extensions exist (superuser — PostGIS is untrusted). */
async function ensureExtensions(dbName) {
    const sp = pgPromise();
    const sdb = sp(superDbUrl(dbName));
    try {
        for (const ext of ['postgis', 'pg_trgm', 'unaccent', 'pgcrypto']) {
            await sdb.none(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
        }
    } finally {
        await sp.end();
    }
}

/** Drops the throwaway DB (best-effort; used by globalTeardown). */
export async function dropDatabase(dbName) {
    const pgp = pgPromise();
    const adminDb = pgp(ADMIN_DB_URL);
    try {
        await adminDb.any(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
             WHERE datname = $1 AND pid <> pg_backend_pid() AND backend_type = 'client backend'`,
            [dbName]
        );
        await adminDb.none(`DROP DATABASE IF EXISTS ${dbName}`);
    } finally {
        await pgp.end();
    }
}

/** Kills a backend process by pid (best-effort; runs in globalTeardown). */
export function killPid(pid) {
    if (!pid) return;
    try {
        process.kill(pid);
    } catch {
        // already gone
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
            // not up yet
        }
        await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS));
    }
    return false;
}

/**
 * Provisions the DB, runs migrations, and spawns the backend with CORS allowing
 * the app origin. Throws if the backend never becomes healthy (caller → skip).
 * @param {Object} opts
 * @param {string} opts.corsOrigin - The browser app origin to allow (Vite).
 * @param {number} opts.port - Backend listen port.
 * @param {string} [opts.dbName='ebgeo_ui_e2e']
 * @returns {Promise<{ baseUrl: string, pid: number, dbName: string }>}
 */
export async function startBackend({ corsOrigin, port, dbName = 'ebgeo_ui_e2e' }) {
    await createDatabase(dbName);
    await ensureExtensions(dbName);
    const { runMigrations } = await import(MIGRATE_URL);
    await runMigrations(appDbUrl(dbName));

    const origin = `http://127.0.0.1:${port}`;
    const child = spawn('node', ['src/index.js'], {
        cwd: BACKEND_DIR,
        env: {
            ...process.env,
            NODE_ENV: 'test',
            DATABASE_URL: appDbUrl(dbName),
            JWT_SECRET: 'ui-e2e-secret-key-which-is-well-over-32-chars',
            PORT: String(port),
            ALLOW_SELF_REGISTRATION: 'true',
            CORS_ORIGIN: corsOrigin,
            IMAGES_DIR: './data/ui-e2e-images',
            // Same reason as tests/e2e/global-setup.js: the /api/config memo is off under
            // NODE_ENV=test unless forced, and the browser E2E is where it must be on —
            // the admin panel specs edit the catalog and the config through the real UI and
            // then expect the change to be there, which is the invalidation end to end.
            CONFIG_CACHE_FORCE: '1',
            TILE_SERVER_URL: 'http://127.0.0.1:9/tiles/{z}/{x}/{y}.png',
            SEARCH_API_URL: 'http://127.0.0.1:9/busca',
        },
        stdio: ['ignore', 'inherit', 'inherit'],
    });

    const healthy = await waitForHealth(origin);
    if (!healthy) {
        killPid(child.pid);
        await dropDatabase(dbName).catch(() => {});
        throw new Error('backend did not become healthy within timeout');
    }
    return { baseUrl: origin, pid: child.pid, dbName };
}
