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

/** Uma checagem de saude: true quando ALGUEM responde `ok` naquela origem. */
async function healthOnce(origin) {
    try {
        const res = await fetch(`${origin}/api/v1/health`);
        if (!res.ok) return false;
        const body = await res.json();
        return body?.status === 'ok';
    } catch {
        return false;
    }
}

/**
 * Polls the health endpoint until ok, until the spawned child dies, or until the timeout.
 *
 * O PREDICADO DE MORTE DO FILHO NAO E OTIMIZACAO, E CORRETUDE: a saude e da PORTA, e a porta
 * responde por qualquer processo. Sem ele, um filho que morre no berco (EADDRINUSE) deixa a
 * espera colher o `ok` do OUTRO backend e declarar sucesso.
 * @param {string} origin
 * @param {() => boolean} filhoMorreu
 * @returns {Promise<boolean>}
 */
async function waitForHealth(origin, filhoMorreu) {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (filhoMorreu()) return false;
        if (await healthOnce(origin)) return true;
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
    const origin = `http://127.0.0.1:${port}`;

    // PORTA JA OCUPADA E ERRO, NUNCA "ja esta pronto", e esta guarda existe porque uma rodada
    // inteira foi paga para descobri-la.
    //
    // MEDIDO em 2026-08-21: uma rodada morta por timeout deixou o backend do e2e vivo na porta.
    // Na rodada seguinte o filho novo morreu no berco com EADDRINUSE, e como `waitForHealth`
    // pergunta a PORTA (nunca ao filho), o `ok` do orfao passou por sucesso: o setup gravou o pid
    // de um processo MORTO, os specs falaram com o backend antigo, e este mesmo `startBackend` ja
    // tinha derrubado e recriado o banco por baixo dele. Resultado: 254 casos pulados, 19
    // instaveis e 2 vermelhos, nenhum deles sobre o codigo do app.
    //
    // A checagem vem ANTES de `createDatabase`, e a ordem e o ponto: e o wipe do banco que
    // transforma "porta ocupada" (um estorvo) em "o outro backend agora fala com um banco vazio"
    // (uma rodada inteira medindo o sujeito errado).
    //
    // SONDADA em 2026-08-21, nos dois sentidos, porque guarda vale o que a ultima sondagem provou:
    // com um servidor trivial respondendo `{status:'ok'}` na porta, a rodada morre aqui com exit 1
    // e ZERO migracoes aplicadas (o banco nao foi tocado); com a porta livre, os 4 casos de
    // `toolbar-drawing-tools` passam. Ao re-sondar, anote data e resultado: sem prazo, "sondei" e
    // conselho vencido.
    if (await healthOnce(origin)) {
        const erro = new Error(
            `a porta ${port} ja responde /api/v1/health antes de subirmos: outro backend esta de pe `
            + '(tipicamente orfao de uma rodada anterior interrompida). Encerre-o e rode de novo.',
        );
        erro.fatal = true;
        throw erro;
    }

    await createDatabase(dbName);
    await ensureExtensions(dbName);
    const { runMigrations } = await import(MIGRATE_URL);
    await runMigrations(appDbUrl(dbName));
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

    // A MORTE DO FILHO E SINAL, e sem escuta-la ela e silencio: o `spawn` devolve um pid mesmo
    // quando o processo morre no primeiro tick, e este evento e o unico lugar onde isso aparece.
    let saidaDoFilho = null;
    child.on('exit', (code, signal) => { saidaDoFilho = { code, signal }; });

    const healthy = await waitForHealth(origin, () => saidaDoFilho !== null);
    if (!healthy) {
        killPid(child.pid);
        await dropDatabase(dbName).catch(() => {});
        if (saidaDoFilho) {
            const erro = new Error(
                `o backend do e2e morreu antes de ficar saudavel (code=${saidaDoFilho.code}, `
                + `signal=${saidaDoFilho.signal}): veja o stderr acima. A causa mais comum e a `
                + `porta ${port} ocupada por outra rodada.`,
            );
            erro.fatal = true;
            throw erro;
        }
        throw new Error('backend did not become healthy within timeout');
    }
    return { baseUrl: origin, pid: child.pid, dbName };
}
