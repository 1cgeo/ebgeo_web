// Path: tests/integration/config-cache.test.js
// Coverage for bugs-backend.md #64: GET /api/config fanned out to EIGHT queries on every
// request, on an anonymous route with no ceiling — and it is the one endpoint whose failure
// stops the frontend from booting at all.
//
// The fix is a memo INVALIDATED ON WRITE (not by TTL), so the route keeps the property its
// `Cache-Control: no-cache` exists for: an admin edit shows up on the very next request. This
// file therefore has to prove two different things, and a test that proved only the first
// would be worse than none:
//   (a) the cost really dropped — measured with the pool query counter, never by eye;
//   (b) EVERY writer that can change the payload drops the memo. Partial invalidation is the
//       worst outcome available here: the admin sees the edit vanish and blames the database.
//
// The memo is off under NODE_ENV=test unless CONFIG_CACHE_FORCE=1 (config.cache.js explains
// why: the suite writes to the catalog tables with raw SQL, a path no service-level
// invalidation can see). This file sets the flag, so it is the one place where the cache is
// actually exercised — plus the E2E harness, which boots the real server.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, loginUser } from '../helpers/fixtures.js';
import { installPoolQueryCounter } from '../helpers/query-counter.js';
import { invalidateAppConfigCache } from '../../src/modules/config/config.cache.js';
import config from '../../src/config.js';

const uniq = (p) => `${p}_${randomUUID().slice(0, 8)}`;

/** The measured cost of assembling the payload from scratch (five catalog SELECTs — basemaps
 *  is read twice — plus ranks, organizations and the override document). */
const FULL_BUILD_QUERIES = 8;

describe('GET /api/config — memoization invalidated on write + per-IP ceiling', () => {
  let app, db, adminToken, counter;

  const getConfig = () => supertest(app).get('/api/v1/config').expect(200);
  const admin = (req) => req.set('Authorization', `Bearer ${adminToken}`);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const adminUser = await createAdminUser(db, { username: uniq('cfgcache') });
    adminToken = await loginUser(app, adminUser.username, adminUser.password);
    process.env.CONFIG_CACHE_FORCE = '1';
    counter = installPoolQueryCounter();
  });

  after(async () => {
    counter.restore();
    delete process.env.CONFIG_CACHE_FORCE;
    invalidateAppConfigCache();
    await teardownTestEnv(db);
  });

  beforeEach(() => {
    invalidateAppConfigCache();
    counter.reset();
  });

  // ---------------------------------------------------------------------------
  // Cost — measured, not asserted from the shape of the code.
  // ---------------------------------------------------------------------------
  describe('cost per request', () => {
    it('a cold request costs 8 queries and every request after it costs ZERO', async () => {
      await getConfig();
      assert.equal(
        counter.state.count,
        FULL_BUILD_QUERIES,
        `cold build should cost ${FULL_BUILD_QUERIES} queries, got ${counter.state.count}: `
        + counter.state.statements.join(' | ')
      );

      counter.reset();
      await getConfig();
      await getConfig();
      await getConfig();
      assert.equal(
        counter.state.count,
        0,
        `warm requests must touch the database zero times, got: ${counter.state.statements.join(' | ')}`
      );
    });

    it('serves an IDENTICAL payload warm and cold (the memo must not change the contract)', async () => {
      const cold = (await getConfig()).body.data;
      const warm = (await getConfig()).body.data;
      assert.deepEqual(warm, cold);

      invalidateAppConfigCache();
      const rebuilt = (await getConfig()).body.data;
      assert.deepEqual(rebuilt, cold, 'a rebuild after invalidation must produce the same document');
    });

    it('N concurrent misses on a cold cache cost ONE build, not N', async () => {
      // This is the DoS case itself. Caching the resolved value would leave the burst
      // window uncovered: ten simultaneous requests would each find an empty entry and
      // each issue eight queries against a pool of ten connections. The entry holds the
      // in-flight promise for exactly this reason.
      const burst = 10;
      await Promise.all(Array.from({ length: burst }, getConfig));
      assert.equal(
        counter.state.count,
        FULL_BUILD_QUERIES,
        `${burst} concurrent cold requests must share one build (${FULL_BUILD_QUERIES} queries), `
        + `got ${counter.state.count}`
      );
    });

    it('NEGATIVE CONTROL: with the memo disabled, every request pays the full 8', async () => {
      // Without this case the two above would pass just as happily against a route that
      // never queries at all. This pins the BEFORE number the fix is measured against.
      delete process.env.CONFIG_CACHE_FORCE;
      try {
        await getConfig();
        await getConfig();
        assert.equal(
          counter.state.count,
          FULL_BUILD_QUERIES * 2,
          `unmemoized, two requests cost ${FULL_BUILD_QUERIES * 2} queries — this is the "before" measurement`
        );
      } finally {
        process.env.CONFIG_CACHE_FORCE = '1';
      }
    });

    it('a failed build is NOT remembered (the next request retries)', async () => {
      // Caching a rejection would turn one blip of the database into a TTL-long outage of
      // the endpoint that gates boot.
      const { db: pgDb } = await import('../../src/database/index.js');
      const original = pgDb.query;
      pgDb.query = () => Promise.reject(new Error('simulated database outage'));
      try {
        await supertest(app).get('/api/v1/config').expect(500);
      } finally {
        pgDb.query = original;
      }

      const res = await getConfig();
      assert.ok(res.body.data.basemaps, 'the request after the outage must rebuild, not replay the failure');
    });
  });

  // ---------------------------------------------------------------------------
  // Invalidation — one case per writer that can change the payload.
  // Each asserts the VALUE the next request sees, not merely that a query ran.
  // ---------------------------------------------------------------------------
  describe('every write that changes the payload drops the memo', () => {
    /** Warms the memo so the following write has something to invalidate. */
    const warm = async () => {
      await getConfig();
      counter.reset();
    };

    it('catalog basemaps: create, update and delete each show up on the NEXT request', async () => {
      const id = uniq('bm');
      await warm();

      await admin(supertest(app).post('/api/v1/basemaps'))
        .send({ id, name: 'Base Nova', config: { enabled: true } })
        .expect(201);
      let cfg = (await getConfig()).body.data;
      assert.ok(cfg.basemaps[id], 'created basemap must be visible immediately');
      assert.equal(cfg.basemaps[id].name, 'Base Nova');

      await admin(supertest(app).put(`/api/v1/basemaps/${id}`)).send({ name: 'Base Renomeada' }).expect(200);
      cfg = (await getConfig()).body.data;
      assert.equal(cfg.basemaps[id].name, 'Base Renomeada', 'update must be visible immediately');

      await admin(supertest(app).delete(`/api/v1/basemaps/${id}`)).expect(204);
      cfg = (await getConfig()).body.data;
      assert.equal(cfg.basemaps[id], undefined, 'soft-delete must be visible immediately');
    });

    it('catalog data_layers: a new layer shows up on the NEXT request', async () => {
      const id = uniq('dl');
      await warm();
      await admin(supertest(app).post('/api/v1/data-layers'))
        .send({ id, name: 'Camada de Dados', config: { url: '/x' } })
        .expect(201);
      const cfg = (await getConfig()).body.data;
      assert.ok(cfg.dataLayers.layers.some((l) => l.id === id), 'new data layer must be visible immediately');
    });

    it('catalog analysis_layers: a new layer shows up on the NEXT request', async () => {
      const id = uniq('al');
      await warm();
      await admin(supertest(app).post('/api/v1/analysis-layers'))
        // bounds is mandatory or config.service filters the layer out — without it the
        // assertion below would fail for a reason that has nothing to do with the memo.
        .send({ id, name: 'Camada de Análise', config: { bounds: [-58, -33, -48, -27] } })
        .expect(201);
      const cfg = (await getConfig()).body.data;
      assert.ok(cfg.analysisLayers.layers.some((l) => l.id === id), 'new analysis layer must be visible immediately');
    });

    it('catalog tilesets: a new tileset shows up on the NEXT request', async () => {
      const id = uniq('ts');
      await warm();
      await admin(supertest(app).post('/api/v1/tilesets'))
        .send({ id, name: 'Tileset Novo', config: { url: '/3d/x/tileset.json' } })
        .expect(201);
      const cfg = (await getConfig()).body.data;
      assert.ok(cfg.tilesets.some((t) => t.id === id), 'new tileset must be visible immediately');
    });

    // O caso que morava aqui escrevia numa QUINTA tabela de catálogo,
    // `streetview_markers`, que não alimentava chave nenhuma do payload — o contador
    // de queries era a única testemunha da invalidação. A migração 021 apagou aquela
    // tabela (nenhum consumidor, em lugar nenhum), e com ela o único caso em que
    // "escreveu no catálogo" e "mudou o /api/config" não eram a mesma coisa. As
    // quatro tabelas restantes são todas lidas por `buildAppConfig`, e cada uma já
    // tem acima o caso que prova a invalidação PELO VALOR, que é a testemunha melhor.

    it('ranks: a created posto appears, and deactivating it removes it, both immediately', async () => {
      await warm();
      const created = await admin(supertest(app).post('/api/v1/ranks'))
        .send({ nome: uniq('Posto'), nome_abrev: 'PN', sort_order: 900 })
        .expect(201);
      const rankId = created.body.data.id;

      let cfg = (await getConfig()).body.data;
      assert.ok(cfg.postos.some((p) => p.id === rankId), 'new rank must reach the anonymous signup dropdown immediately');

      await admin(supertest(app).put(`/api/v1/ranks/${rankId}`)).send({ is_active: false }).expect(200);
      cfg = (await getConfig()).body.data;
      assert.ok(!cfg.postos.some((p) => p.id === rankId), 'deactivated rank must disappear immediately');
    });

    it('ranks: DELETE (soft) also drops the memo', async () => {
      const created = await admin(supertest(app).post('/api/v1/ranks'))
        .send({ nome: uniq('PostoDel'), sort_order: 901 })
        .expect(201);
      const rankId = created.body.data.id;
      await warm();
      assert.ok((await getConfig()).body.data.postos.some((p) => p.id === rankId), 'guard: it must be there first');

      await admin(supertest(app).delete(`/api/v1/ranks/${rankId}`)).expect(204);
      const cfg = (await getConfig()).body.data;
      assert.ok(!cfg.postos.some((p) => p.id === rankId), 'soft-deleted rank must disappear immediately');
    });

    it('organizations: a created OM appears, and deactivating it removes it, both immediately', async () => {
      await warm();
      const created = await admin(supertest(app).post('/api/v1/organizations'))
        .send({ nome: 'OM de Teste', slug: uniq('om').replace(/_/g, '-'), sigla: 'OMT' })
        .expect(201);
      const orgId = created.body.data.id;

      let cfg = (await getConfig()).body.data;
      assert.ok(cfg.organizacoesMilitares.some((o) => o.id === orgId), 'new OM must be visible immediately');

      await admin(supertest(app).put(`/api/v1/organizations/${orgId}`)).send({ is_active: false }).expect(200);
      cfg = (await getConfig()).body.data;
      assert.ok(!cfg.organizacoesMilitares.some((o) => o.id === orgId), 'deactivated OM must disappear immediately');
    });

    it('organizations: DELETE (soft) also drops the memo', async () => {
      const created = await admin(supertest(app).post('/api/v1/organizations'))
        .send({ nome: 'OM Removível', slug: uniq('omdel').replace(/_/g, '-') })
        .expect(201);
      const orgId = created.body.data.id;
      await warm();
      assert.ok(
        (await getConfig()).body.data.organizacoesMilitares.some((o) => o.id === orgId),
        'guard: it must be there first'
      );

      await admin(supertest(app).delete(`/api/v1/organizations/${orgId}`)).expect(204);
      const cfg = (await getConfig()).body.data;
      assert.ok(!cfg.organizacoesMilitares.some((o) => o.id === orgId), 'soft-deleted OM must disappear immediately');
    });

    it('config overrides: PUT /config/admin is visible immediately, DELETE reverts immediately', async () => {
      await warm();
      const titulo = `EBGeo ${randomUUID().slice(0, 6)}`;
      await admin(supertest(app).put('/api/v1/config/admin')).send({ app: { title: titulo } }).expect(200);
      assert.equal((await getConfig()).body.data.app.title, titulo, 'admin override must propagate on the next request');

      await admin(supertest(app).delete('/api/v1/config/admin')).expect(200);
      assert.equal((await getConfig()).body.data.app.title, 'EBGeo', 'clearing overrides must propagate on the next request');
    });

    it('the memoized payload cannot be mutated by a caller (no cross-request bleed)', async () => {
      const { configService } = await import('../../src/modules/config/index.js');
      const payload = await configService.getAppConfig();
      assert.throws(
        () => { payload.injected = 'leak'; },
        TypeError,
        'the shared payload is frozen at the top level'
      );
      assert.equal((await getConfig()).body.data.injected, undefined);
    });
  });

  // ---------------------------------------------------------------------------
  // Per-IP ceiling. Last, because exhausting the bucket 429s every later request
  // from this address.
  // ---------------------------------------------------------------------------
  describe('configLimiter', () => {
    it('is NOT applied in the test env unless forced (same convention as every other limiter)', async () => {
      const res = await getConfig();
      assert.equal(
        res.headers['ratelimit-limit'],
        undefined,
        'without RATE_LIMIT_FORCE the limiter must skip — otherwise the suite and the E2E boot storm would 429'
      );
    });

    it('is mounted on the anonymous route with the configured ceiling', async () => {
      process.env.RATE_LIMIT_FORCE = '1';
      try {
        const res = await getConfig();
        assert.equal(
          res.headers['ratelimit-limit'],
          String(config.rateLimit.configMax),
          'the route must advertise the ceiling from config.rateLimit.configMax'
        );
      } finally {
        delete process.env.RATE_LIMIT_FORCE;
      }
    });

    it('answers 429 with the standard envelope past the ceiling, and the ceiling is generous', async () => {
      // A boot costs ONE request, and a failing boot retries three times: the ceiling has to
      // sit far above any plausible burst of honest boots from one NAT egress, or the fix
      // for a denial of service becomes one.
      const max = config.rateLimit.configMax;
      assert.ok(max >= 300, `guard: a ceiling of ${max}/window would throttle honest boots behind NAT`);

      process.env.RATE_LIMIT_FORCE = '1';
      try {
        // The store is per-limiter-instance and keyed by address; the two mount points
        // (/api/v1/config and /api/config) share ONE router, hence one budget — which is
        // what we want, and what this loop incidentally proves by exhausting through one
        // path and being refused on both.
        for (let sent = 0; sent < max; sent += 50) {
          const batch = Math.min(50, max - sent);
          await Promise.all(Array.from({ length: batch }, () => supertest(app).get('/api/v1/config')));
        }
        const over = await supertest(app).get('/api/v1/config');
        assert.equal(over.status, 429, `request ${max + 1} in the window must be refused`);
        assert.equal(over.body.error.code, 'TOO_MANY_REQUESTS');

        const alias = await supertest(app).get('/api/config');
        assert.equal(alias.status, 429, 'the /api/config alias shares the same bucket (same router instance)');
      } finally {
        delete process.env.RATE_LIMIT_FORCE;
      }
    });
  });
});
