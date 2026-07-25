// Path: tests/integration/config-infra-gaps.test.js
// Gap coverage for the "Config + infra" subsystem: body-size limits & bulk
// parser selection (app.js), createSemaphore (utils), security headers
// (helmet/CORS), the GET /config frozen Cache-Control header, resources->config
// spread precedence, empty-category shapes, migration-runner idempotency, and
// the authLimiter keyGenerator edges (case-folding + empty-username collapse).
//
// Each test asserts CURRENT behavior verified against the source. Where the
// HTTP response shape is incidental we prefer asserting status / DB state.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';
import { createSemaphore } from '../../src/utils/semaphore.js';
import { runMigrations } from '../../src/database/migrate.js';
import config from '../../src/config.js';

const uniq = () => `gap_${randomUUID().slice(0, 8)}`;

describe('Config + infra — gap coverage', () => {
  let app, db, bulkToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const bulkUser = await createUser(db, { username: uniq() });
    bulkToken = await loginUser(app, bulkUser.username, bulkUser.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ---------------------------------------------------------------------------
  // infra-01 — global 10mb JSON limit + bulk-parser path selection (app.js:56-63)
  // ---------------------------------------------------------------------------
  describe('infra-01 — JSON body limits & bulk parser selection', () => {
    it('rejects a >10mb body on a normal JSON route with 413', async () => {
      // ~11mb of payload on /auth/login (uses the default 10mb parser).
      const big = 'a'.repeat(11 * 1024 * 1024);
      const res = await supertest(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ username: 'x', password: big }));
      assert.equal(res.status, 413, 'normal route should cap at 10mb');
      // Standard error envelope (not a raw text body).
      assert.ok(res.body.error, 'expected { error } envelope');
      assert.ok(res.body.error.code, 'expected error.code');
    });

    it('does NOT reject a ~12mb body on the /images/bulk path for size (bulk parser wins)', async () => {
      // The bulk parser (50mb) must be selected for POST .../images/bulk, and only
      // for an AUTHENTICATED caller: this test used to send NO token and assert 401,
      // which asserted the defect (12mb buffered + parsed before any credential was
      // checked) as if it were the contract — see bugs-backend.md #37 and
      // bulk-parser-scope.repro.test.js. Not-413 is what proves the enlarged parser
      // ran; the 403/404 that follows comes from the atlas authorization gate.
      const atlasId = randomUUID();
      const body = JSON.stringify({ filler: 'a'.repeat(12 * 1024 * 1024) });
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlasId}/images/bulk`)
        .set('Authorization', `Bearer ${bulkToken}`)
        .set('Content-Type', 'application/json')
        .send(body);
      assert.notEqual(res.status, 413, 'bulk parser should accept a 12mb body');
      // Exactly 404, not "403 or 404": `atlasId` is a fresh UUID, so
      // requireAtlasPermission finds no row and raises NotFoundError. The
      // difference is a disclosure decision (403 would confirm the atlas exists),
      // so a test that accepts either cannot notice it flipping.
      assert.equal(res.status, 404, `expected 404 (atlas does not exist), got ${res.status}`);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    it('rejects a >50mb body on /images/bulk with 413 (bulk cap enforced)', async () => {
      const atlasId = randomUUID();
      const limitMb = config.images.maxBulkUploadMb; // 50 by default
      const body = JSON.stringify({ filler: 'a'.repeat((limitMb + 2) * 1024 * 1024) });
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlasId}/images/bulk`)
        // Authenticated on purpose: without a token the request never reaches the
        // enlarged parser, so the 413 would prove the 10mb cap, not the bulk cap.
        .set('Authorization', `Bearer ${bulkToken}`)
        .set('Content-Type', 'application/json')
        .send(body);
      assert.equal(res.status, 413, 'over the bulk cap should be 413');
      assert.ok(res.body.error, 'expected { error } envelope on bulk 413');
    });
  });

  // ---------------------------------------------------------------------------
  // infra-04 — createSemaphore (utils/semaphore.js:4-26)
  // ---------------------------------------------------------------------------
  describe('infra-04 — createSemaphore', () => {
    it('blocks acquire() beyond max until a release()', async () => {
      const sem = createSemaphore(2);
      await sem.acquire(); // 1
      await sem.acquire(); // 2 (at cap)
      const third = sem.acquire();

      let resolved = false;
      third.then(() => { resolved = true; });
      await Promise.resolve();
      assert.equal(resolved, false, '3rd acquire must be pending at cap');

      sem.release(); // hands slot to the waiter
      await third; // should now resolve
      assert.equal(resolved, true);
    });

    it('release() with no waiter decrements active so the next acquire resolves immediately', async () => {
      const sem = createSemaphore(1);
      await sem.acquire(); // at cap, no waiter
      sem.release();       // empty queue → active-- back to 0

      let resolved = false;
      const p = sem.acquire().then(() => { resolved = true; });
      await Promise.resolve();
      await p;
      assert.equal(resolved, true, 'acquire after release should resolve immediately');
    });

    it('hands slots to waiters in FIFO order', async () => {
      const sem = createSemaphore(1);
      await sem.acquire(); // holder

      const order = [];
      const a = sem.acquire().then(() => order.push('a'));
      const b = sem.acquire().then(() => order.push('b'));

      sem.release(); // → a
      await a;
      sem.release(); // → b
      await b;

      assert.deepEqual(order, ['a', 'b'], 'waiters resolve in enqueue order');
    });

    it('current behavior: over-release drives active negative, silently raising the effective cap', async () => {
      // This pins the DOCUMENTED current behavior (no over-release guard) so a
      // future regression is caught. With max=1 and a stray extra release(),
      // `active` goes to -1, allowing 2 immediate acquires past the nominal cap.
      const sem = createSemaphore(1);
      await sem.acquire(); // active=1
      sem.release();       // active=0
      sem.release();       // BUG/behavior: active=-1 (no outstanding acquire)

      let r1 = false; let r2 = false;
      const p1 = sem.acquire().then(() => { r1 = true; }); // active=0
      const p2 = sem.acquire().then(() => { r2 = true; }); // active=1 (cap raised)
      await Promise.resolve();
      await Promise.all([p1, p2]);
      assert.ok(r1 && r2, 'over-release currently lets acquires exceed the nominal cap');
    });
  });

  // ---------------------------------------------------------------------------
  // infra-05 — security headers (helmet CSP / CORS) (app.js:34-46)
  // ---------------------------------------------------------------------------
  describe('infra-05 — security headers', () => {
    it('serves a strict CSP and nosniff on the public config route', async () => {
      const res = await supertest(app).get('/api/v1/config').expect(200);
      const csp = res.headers['content-security-policy'];
      assert.ok(csp, 'CSP header present');
      assert.match(csp, /default-src 'none'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
    });

    it('does NOT emit HSTS in the test env (hsts gated on isProd)', async () => {
      const res = await supertest(app).get('/api/v1/config').expect(200);
      assert.equal(res.headers['strict-transport-security'], undefined);
    });

    it('reflects the configured CORS origin with credentials (not "*")', async () => {
      const res = await supertest(app)
        .get('/api/v1/config')
        .set('Origin', config.cors.origin)
        .expect(200);
      assert.equal(res.headers['access-control-allow-origin'], config.cors.origin);
      assert.notEqual(res.headers['access-control-allow-origin'], '*');
      assert.equal(res.headers['access-control-allow-credentials'], 'true');
    });

    it('does NOT echo a foreign Origin back (string mode, not reflect mode)', async () => {
      // The assertion above is true for ANY configured string, because with a string
      // origin the `cors` package compares nothing and echoes what it was given — so
      // on its own it could not tell a working configuration from a broken one
      // (bugs-backend.md #39). Sending a DIFFERENT Origin is what discriminates:
      // reflect-mode would answer with the attacker's origin here.
      const foreign = 'https://origem-nao-autorizada.example';
      const res = await supertest(app)
        .get('/api/v1/config')
        .set('Origin', foreign)
        .expect(200);
      assert.notEqual(res.headers['access-control-allow-origin'], foreign);
      assert.equal(res.headers['access-control-allow-origin'], config.cors.origin);
    });

    it('a PREFLIGHT from a foreign origin is not authorized either', async () => {
      // The GET path above is only half of CORS. The browser asks permission with
      // an OPTIONS preflight before any non-simple request, and a preflight that
      // echoed the attacker's origin (with credentials allowed) would hand over
      // authenticated writes regardless of what the GET path answers.
      const foreign = 'https://origem-nao-autorizada.example';
      const res = await supertest(app)
        .options(`/api/v1/atlas/${randomUUID()}`)
        .set('Origin', foreign)
        .set('Access-Control-Request-Method', 'POST');

      const acao = res.headers['access-control-allow-origin'];
      assert.notEqual(acao, foreign, 'the preflight must never authorize an unknown origin');
      assert.notEqual(acao, '*', 'a wildcard is incompatible with credentials:true');
      assert.equal(acao, config.cors.origin, 'the configured origin is echoed verbatim, whoever asks');
    });

    it('a request with NO Origin header is never answered with "*"', async () => {
      // `origin: true` (reflect mode) and `origin: '*'` both look harmless in a
      // server-side test, but with credentials:true a browser REJECTS '*' — the
      // symptom would be the cross-origin boot of the E2E dying while every
      // backend assertion stayed green.
      const res = await supertest(app).get('/api/v1/config').expect(200);
      assert.notEqual(res.headers['access-control-allow-origin'], '*');
    });

    it('cross-origin-resource-policy is cross-origin on JSON and on BINARY responses', async () => {
      // Helmet's default is same-origin, which would block every atlas image, 3D
      // asset and 360 tile the moment the frontend is served from another origin —
      // a backend-green, frontend-broken failure. The binary route is checked too:
      // asserting only the JSON one would miss a per-route header override.
      const json = await supertest(app).get('/api/v1/config').expect(200);
      assert.equal(json.headers['cross-origin-resource-policy'], 'cross-origin');

      const dir = join(resolve('./data/assets3d'), `corp_${randomUUID().slice(0, 8)}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'model.glb'), Buffer.from('glb-binary-bytes-here'));
      try {
        const binary = await supertest(app).get(`/api/v1/assets3d/${basename(dir)}/model.glb`);
        assert.equal(binary.status, 200, 'guard: the asset must really be served, or the header check is vacuous');
        assert.equal(binary.headers['content-type'], 'model/gltf-binary');
        assert.equal(
          binary.headers['cross-origin-resource-policy'],
          'cross-origin',
          'a binary asset without CORP is exactly the case that breaks the deployed frontend'
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('the configured origin is one a browser can match (canonical, no trailing slash)', async () => {
      // The browser compares its own origin against the echoed header verbatim, and
      // its `Origin` never carries a path or a trailing slash. A non-canonical value
      // passes every server-side assertion and still blocks every request.
      assert.equal(config.cors.origin, new URL(config.cors.origin).origin);
    });
  });

  // ---------------------------------------------------------------------------
  // infra-07 — GET /config Cache-Control: no-cache (config.controller.js:8-10)
  // ---------------------------------------------------------------------------
  describe('infra-07 — config Cache-Control header', () => {
    it('sends Cache-Control: no-cache on /api/v1/config', async () => {
      const res = await supertest(app).get('/api/v1/config').expect(200);
      assert.match(res.headers['cache-control'], /no-cache/);
    });

    it('sends Cache-Control: no-cache on the /api/config alias', async () => {
      const res = await supertest(app).get('/api/config').expect(200);
      assert.match(res.headers['cache-control'], /no-cache/);
    });
  });

  // ---------------------------------------------------------------------------
  // infra-08 — resources JSONB config spread precedence (config.service.js:16-31)
  // ---------------------------------------------------------------------------
  describe('infra-08 — config spread overrides id/name', () => {
    it('tileset config.id currently OVERRIDES the DB id (spread-after precedence pinned)', async () => {
      const realId = uniq();
      await db.query(
        `INSERT INTO tilesets (id, name, config, active, sort_order)
         VALUES ($1, $2, $3::jsonb, true, 999)`,
        [realId, 'Spoof Tileset', JSON.stringify({ id: 'SPOOFED', url: '/3d/x/tileset.json' })]
      );
      try {
        const cfg = (await supertest(app).get('/api/v1/config').expect(200)).body.data;
        const byReal = cfg.tilesets.find((t) => t.id === realId);
        const bySpoof = cfg.tilesets.find((t) => t.id === 'SPOOFED');
        // Current behavior: r.config spread AFTER { id: r.id } wins → id == SPOOFED.
        assert.equal(byReal, undefined, 'DB id is shadowed by config.id today');
        assert.ok(bySpoof, 'config.id overrides the column id (precedence pinned)');
      } finally {
        await db.query(`DELETE FROM tilesets WHERE id = $1`, [realId]);
      }
    });

    it('basemap config.name currently OVERRIDES the column name', async () => {
      const realId = uniq();
      await db.query(
        `INSERT INTO basemaps (id, name, config, active, sort_order)
         VALUES ($1, 'ColumnName', $2::jsonb, true, 999)`,
        [realId, JSON.stringify({ name: 'ConfigName', enabled: true })]
      );
      try {
        const cfg = (await supertest(app).get('/api/v1/config').expect(200)).body.data;
        assert.ok(cfg.basemaps[realId], 'basemap keyed by DB id');
        // basemaps spread: { name: r.name, ...r.config } → config.name wins.
        assert.equal(cfg.basemaps[realId].name, 'ConfigName');
      } finally {
        await db.query(`DELETE FROM basemaps WHERE id = $1`, [realId]);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // infra-09 — empty-category shapes (config.service.js:14-32)
  // ---------------------------------------------------------------------------
  describe('infra-09 — empty category shapes', () => {
    it('empty tileset category is [] (array) and empty basemap category is {} (object)', async () => {
      // Deactivate all tileset + basemap rows inside this test, then restore.
      await db.query(`UPDATE tilesets SET active = false`);
      await db.query(`UPDATE basemaps SET active = false`);
      try {
        const cfg = (await supertest(app).get('/api/v1/config').expect(200)).body.data;
        assert.ok(Array.isArray(cfg.tilesets), 'tilesets must be an array');
        assert.equal(cfg.tilesets.length, 0);
        assert.equal(typeof cfg.basemaps, 'object');
        assert.ok(!Array.isArray(cfg.basemaps), 'basemaps must be an object, not array');
        assert.deepEqual(cfg.basemaps, {});
      } finally {
        await db.query(`UPDATE tilesets SET active = true`);
        await db.query(`UPDATE basemaps SET active = true`);
      }
    });

    it('empty data_layer category serves the {enabled:true, layers:[]} shape', async () => {
      // Deactivate the seeded data_layer rows inside this test, then restore.
      await db.query(`UPDATE data_layers SET active = false`);
      try {
        const cfg = (await supertest(app).get('/api/v1/config').expect(200)).body.data;
        assert.deepEqual(cfg.dataLayers, { enabled: true, layers: [] });
      } finally {
        await db.query(`UPDATE data_layers SET active = true`);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // infra-10 — migration runner idempotency (migrate.js:46-62)
  // ---------------------------------------------------------------------------
  describe('infra-10 — migration runner idempotency', () => {
    // This is the single guard of runner idempotency in the suite. It used to be
    // two: an identical, weaker copy lived in low-impact-fixes.test.js ('a second
    // run is a no-op'), whose whole verification was `assert.ok(n > 0)` — a
    // statement that `_migrations` is not empty, which was true before the fix
    // too. That copy is gone; this one survives because it compares STATE across
    // the second run, and because it sits in the file dedicated to the runner.
    //
    // "No-op" is asserted as three separate properties, since the migrations are
    // `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN` and re-running them all would
    // NOT throw: the same set of names, each exactly once, and business data
    // still there afterwards.
    it('re-running migrations on the already-migrated DB changes nothing (idempotent, not merely quiet)', async () => {
      const before = await db.query(`SELECT name FROM _migrations ORDER BY name`);
      const beforeNames = before.rows.map((r) => r.name);
      assert.ok(
        beforeNames.length >= 5,
        `baseline guard: migrations 001..005 must be recorded, found ${beforeNames.length}`
      );

      // A sentinel in a BUSINESS table: this is what catches the failure mode a
      // count of _migrations cannot see — an edited migration re-creating a table
      // and taking its rows with it.
      const sentinelId = uniq();
      await db.query(
        `INSERT INTO basemaps (id, name, description, config, sort_order)
         VALUES ($1, 'Migration Sentinel', '', '{}'::jsonb, 998)`,
        [sentinelId]
      );

      try {
        // runMigrations opens its own pg-promise connection from DATABASE_URL.
        await runMigrations(process.env.DATABASE_URL);

        const after = await db.query(`SELECT name FROM _migrations ORDER BY name`);
        assert.deepEqual(
          after.rows.map((r) => r.name),
          beforeNames,
          'the second run must record exactly the same migrations, no more and no fewer'
        );

        const dupes = await db.query(
          `SELECT name FROM _migrations GROUP BY name HAVING COUNT(*) > 1`
        );
        assert.deepEqual(dupes.rows, [], 'a migration recorded twice means the DDL ran twice');

        const survived = await db.query(`SELECT name FROM basemaps WHERE id = $1`, [sentinelId]);
        assert.equal(survived.rows.length, 1, 'business data must survive a re-run');
        assert.equal(survived.rows[0].name, 'Migration Sentinel');
      } finally {
        await db.query(`DELETE FROM basemaps WHERE id = $1`, [sentinelId]);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // infra-13 — authLimiter keyGenerator edges (rate-limit.js:32)
  // ---------------------------------------------------------------------------
  describe('infra-13 — authLimiter keyGenerator', () => {
    before(() => { process.env.RATE_LIMIT_FORCE = '1'; });
    after(() => { delete process.env.RATE_LIMIT_FORCE; });

    it('case-folds the username into the same bucket (CaseVictim == casevictim)', async () => {
      // Distinct casing of the same name must share the per-IP+username key.
      const base = uniq(); // unique stem avoids cross-test bleed
      const upper = `Case${base}`;
      const lower = `case${base}`.toLowerCase();
      const max = config.rateLimit.authMax;

      // Exhaust the limit using the upper-cased name.
      let last;
      for (let i = 0; i < max; i++) {
        await supertest(app)
          .post('/api/v1/auth/login')
          .send({ username: upper, password: 'wrong-password' });
      }
      // The next request with the lower-cased name must be throttled (same key).
      last = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username: lower, password: 'wrong-password' });
      assert.equal(last.status, 429, 'case-folded name shares the bucket');
      assert.equal(last.body.error.code, 'TOO_MANY_REQUESTS');
    });

    it('collapses missing-username requests to the per-IP ":" bucket and throttles them', async () => {
      // No username field → key is `${ip}:` for every such request from one IP.
      const max = config.rateLimit.authMax;
      let last;
      for (let i = 0; i < max + 1; i++) {
        last = await supertest(app)
          .post('/api/v1/auth/login')
          .send({ password: 'wrong-password' }); // no username
      }
      assert.equal(last.status, 429, 'no-username flood collapses to one IP bucket');
      assert.equal(last.body.error.code, 'TOO_MANY_REQUESTS');
    });
  });
});
