// Path: tests/integration/app-mount-gates.test.js
// The two environment-conditional branches of createApp() that the in-process
// suite can never reach, because `config.isProd` is frozen when config.js is
// first imported and every test runs with NODE_ENV=test:
//
//   1. `if (isTraceEnabled() && !config.isProd)` — the SyncLedger debug router.
//      I14 says no tracing path may be reachable in production, and the
//      `!config.isProd` clause is the ONLY thing that holds when EBGEO_TRACE=1
//      leaks into a production environment. Nothing tested it: deleting the
//      clause exposed the per-atlas ring in production with the suite green.
//
//   2. `hsts: config.isProd ? {…} : false` — the existing coverage asserted only
//      the ABSENCE of the header under test, which stays true if the whole
//      option is deleted. That half is kept (in config-infra-gaps) and this file
//      supplies the other one, asserting the VALUES, since helmet's own default
//      (180 days, no subdomains) would otherwise satisfy a presence check.
//
// Both halves matter: a "404 in production" assertion on its own would pass even
// if the router were never mounted anywhere, so a development spawn asserts the
// router DOES exist outside production. If all spawns answered alike the file
// would be verifying nothing.
//
// The probe runs in a child process because those branches are decided at import
// time. The child prints ONE marked JSON line; everything else it may log
// (pino in production is not silent) is ignored.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import supertest from 'supertest';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setupTestEnv } from '../helpers/setup.js';
import { createApp } from '../../src/app.js';
import { isTraceEnabled, setTraceEnabled } from '../../src/utils/sync-trace.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = pathToFileURL(path.resolve(HERE, '../../src/app.js')).href;
const MARK = 'EBGEO_PROBE ';

/**
 * Boots createApp() in a child with the given env and returns the probe results.
 * The child never touches the database: every request it makes is answered
 * before any query (401 from `auth`, 404 from the unmatched-route handler).
 * @param {Record<string,string>} env - env overrides for the child
 * @returns {Promise<{debugGet:object, debugDelete:object, unknown:object}>}
 */
function probeApp(env) {
  const atlasId = randomUUID();
  const script = `
    const { createApp } = await import(${JSON.stringify(APP_URL)});
    const supertest = (await import('supertest')).default;
    const app = createApp();
    const grab = (res) => ({
      status: res.status,
      code: res.body?.error?.code ?? null,
      hsts: res.headers['strict-transport-security'] ?? null,
      corp: res.headers['cross-origin-resource-policy'] ?? null,
    });
    const out = {
      debugGet: grab(await supertest(app).get('/api/v1/debug/trace?atlasId=${atlasId}')),
      debugDelete: grab(await supertest(app).delete('/api/v1/debug/trace?atlasId=${atlasId}')),
      unknown: grab(await supertest(app).get('/api/v1/rota-que-nao-existe')),
    };
    process.stdout.write('\\n${MARK}' + JSON.stringify(out) + '\\n');
  `;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, ...env },
      cwd: path.resolve(HERE, '../..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      const line = stdout.split('\n').find((l) => l.startsWith(MARK));
      if (!line) {
        reject(new Error(`child produced no probe line (exit ${code})\nstdout: ${stdout}\nstderr: ${stderr}`));
        return;
      }
      resolve(JSON.parse(line.slice(MARK.length)));
    });
  });
}

// A production-shaped environment: canonical CORS origin and a long secret, so
// the app is refused for the reason under test and never for a config detail.
const PROD_ENV = Object.freeze({
  NODE_ENV: 'production',
  EBGEO_TRACE: '1',
  CORS_ORIGIN: 'https://ebgeo.example.mil.br',
  JWT_SECRET: 'x'.repeat(40),
});

describe('app mount gates — the debug router and HSTS across environments', () => {
  let app;
  let prod;
  let dev;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    // Both spawns in parallel: they are independent processes.
    [prod, dev] = await Promise.all([
      probeApp(PROD_ENV),
      probeApp({ NODE_ENV: 'development', EBGEO_TRACE: '1', CORS_ORIGIN: 'http://localhost:3000' }),
    ]);
  });

  // -------------------------------------------------------------------------
  // The debug router
  // -------------------------------------------------------------------------

  it('in-process (NODE_ENV=test): the debug route EXISTS — 401, not 404', async () => {
    // 401 comes from the strict `auth` middleware inside the router, i.e. the
    // router was reached. Without this case, everything below could be green
    // with the router mounted nowhere at all.
    const res = await supertest(app).get(`/api/v1/debug/trace?atlasId=${randomUUID()}`);
    assert.equal(res.status, 401, 'the SyncLedger route must be mounted with the tracer on');
    assert.notEqual(res.status, 404, 'a 404 here would mean the router is not mounted');
  });

  it('development + EBGEO_TRACE=1: still mounted (401)', () => {
    assert.equal(dev.debugGet.status, 401, 'dev with the tracer on must expose the route');
  });

  it('production + EBGEO_TRACE=1: NOT mounted — 404 NOT_FOUND, never 401', () => {
    // The distinction is the whole point: 401 would mean the router exists in
    // production and is merely asking for a token.
    assert.equal(prod.debugGet.status, 404, 'the tracer flag must not be able to mount it in production');
    assert.equal(prod.debugGet.code, 'NOT_FOUND', 'it falls through to the generic route 404');
  });

  it('production: the destructive DELETE is unmounted too', () => {
    assert.equal(prod.debugDelete.status, 404);
    assert.equal(prod.debugDelete.code, 'NOT_FOUND');
  });

  // The mount gate is a CONJUNCTION — `isTraceEnabled() && !config.isProd` — and the
  // spawns above only ever exercise the SECOND operand (they all run with
  // EBGEO_TRACE=1). Deleting `isTraceEnabled() &&` would leave every case in this
  // file green while mounting the ring in any non-production environment whose
  // operator never asked for tracing. The first operand is reachable in-process
  // because setTraceEnabled() is exported and createApp() reads it at mount time.
  it('tracer OFF (same process, same env): the router is NOT mounted — 404, not 401', async () => {
    setTraceEnabled(false);
    try {
      const off = createApp();
      const res = await supertest(off).get(`/api/v1/debug/trace?atlasId=${randomUUID()}`);
      assert.equal(res.status, 404, 'with the tracer off the route must not exist at all');
      assert.equal(res.body?.error?.code, 'NOT_FOUND');

      const del = await supertest(off).delete(`/api/v1/debug/trace?atlasId=${randomUUID()}`);
      assert.equal(del.status, 404, 'the destructive DELETE is gated by the same flag');
    } finally {
      setTraceEnabled(true);
    }
  });

  it('and flipping the flag back on remounts it (the pair that makes the case above mean something)', async () => {
    // Without this, "404 with the tracer off" would also be satisfied by a broken
    // path or a router that never mounts under any condition.
    assert.equal(isTraceEnabled(), true, 'the finally above must have restored the flag');
    const on = createApp();
    const res = await supertest(on).get(`/api/v1/debug/trace?atlasId=${randomUUID()}`);
    assert.equal(res.status, 401, 'tracer on ⇒ mounted ⇒ auth answers');
  });

  it('the three environments really do differ (guard against a vacuous green)', () => {
    // If a mistake made every spawn answer 404, each assertion above would still
    // read plausibly. Stating the difference makes that failure mode impossible.
    assert.notEqual(
      prod.debugGet.status, dev.debugGet.status,
      'production and development answered identically — the gate is not being exercised'
    );
  });

  // -------------------------------------------------------------------------
  // HSTS (app.js `hsts: config.isProd ? … : false`)
  // -------------------------------------------------------------------------

  it('production emits HSTS with the CONFIGURED values, not helmet defaults', () => {
    // Values, not presence: helmet's default is max-age=15552000 too but WITHOUT
    // includeSubDomains, and a bare presence check would accept a deleted option
    // if a future helmet version turned it back on by default.
    assert.match(prod.unknown.hsts ?? '', /max-age=15552000/, 'the configured 180-day max-age');
    assert.match(prod.unknown.hsts ?? '', /includeSubDomains/, 'subdomains must be covered');
  });

  it('development and test do NOT emit HSTS (the pair that gives the assertion meaning)', async () => {
    assert.equal(dev.unknown.hsts, null, 'no HSTS outside production');
    const res = await supertest(app).get('/api/v1/rota-que-nao-existe').expect(404);
    assert.equal(res.headers['strict-transport-security'], undefined);
  });

  it('cross-origin-resource-policy stays cross-origin in production as well', () => {
    // The frontend is served from another origin in the deployed setup; helmet's
    // default (same-origin) would block every atlas image, 3D asset and 360 tile.
    assert.equal(prod.unknown.corp, 'cross-origin');
    assert.equal(dev.unknown.corp, 'cross-origin');
  });
});
