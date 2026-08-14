// Path: tests/integration/config.test.js
// Fase 2: public GET /api/v1/config serves the frozen config.js shape, sourcing
// data from the resources table and URLs from env.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';

const TOP_KEYS = [
  'app', 'features', 'services', 'search', 'basemaps', 'analysisLayers',
  'dataLayers', 'map2d', 'map3d', 'tilesets', 'streetView360', 'basemapStyles',
];

describe('Config endpoint (GET /api/v1/config)', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('is public (no auth) and returns the full frozen shape', async () => {
    const res = await supertest(app).get('/api/v1/config').expect(200);
    const cfg = res.body.data;
    for (const k of TOP_KEYS) {
      assert.ok(k in cfg, `missing top-level key: ${k}`);
    }
  });

  // ---------------------------------------------------------------------------
  // The alias is the endpoint that actually matters at boot.
  //
  // Every contract assertion in this file is made against /api/v1/config, while
  // the frontend's fail-fast boot calls the ALIAS /api/config — of which only
  // `.expect(200)` was ever asserted. If the alias were pointed at another
  // router, left behind in a refactor, or started answering a different shape,
  // the contract suite would stay green and the app would refuse to start, one
  // package away from the cause.
  // ---------------------------------------------------------------------------
  it('the /api/config alias serves the SAME body as /api/v1/config', async () => {
    // Same run, same DB state: any difference is the routing, not the data.
    const [alias, canonical] = await Promise.all([
      supertest(app).get('/api/config').expect(200),
      supertest(app).get('/api/v1/config').expect(200),
    ]);
    // Guard: comparing two empty bodies would be a vacuous pass.
    assert.ok(
      Object.keys(alias.body.data ?? {}).length >= TOP_KEYS.length,
      'guard: the alias body must carry the full config, not an empty object'
    );
    assert.deepEqual(alias.body, canonical.body, 'the alias must not drift from the canonical route');
  });

  it('the alias carries the same security and caching headers', async () => {
    const res = await supertest(app).get('/api/config').expect(200);
    assert.match(res.headers['content-security-policy'] ?? '', /default-src 'none'/);
    assert.match(res.headers['cache-control'] ?? '', /no-cache/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });

  it('the alias does not widen the write surface: POST /api/config is 404', async () => {
    const res = await supertest(app).post('/api/config').send({ hacked: true });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // ---------------------------------------------------------------------------
  // flexibleAuth is GLOBAL and non-blocking: a bad credential must never break a
  // public route.
  //
  // Every existing assertion about an invalid/expired token targets a STRICT
  // route and expects 401. None states the opposite, which is the anonymous path
  // the whole product rests on: with a stale token left in localStorage,
  // GET /api/config has to keep answering 200 or every returning user meets
  // "EBGeo indisponível" at boot — a cross-package failure with no backend error.
  // ---------------------------------------------------------------------------
  describe('public config survives every malformed credential (flexibleAuth)', () => {
    const badCredentials = [
      ['a token that is not a JWT at all', { Authorization: 'Bearer nao.e.um.jwt' }],
      ['a well-formed JWT signed with another secret', {
        Authorization: `Bearer ${jwt.sign({ sub: randomUUID() }, 'outro-segredo-completamente-diferente')}`,
      }],
      ['an EXPIRED JWT signed with the right secret', {
        Authorization: `Bearer ${jwt.sign(
          { sub: randomUUID(), exp: Math.floor(Date.now() / 1000) - 3600 },
          config.jwt.secret
        )}`,
      }],
      ['a non-UUID x-api-key', { 'x-api-key': 'nao-uuid' }],
      ['a syntactically valid but unknown x-api-key', { 'x-api-key': randomUUID() }],
    ];

    for (const [label, headers] of badCredentials) {
      it(`GET /api/config still answers 200 with ${label}`, async () => {
        const res = await supertest(app).get('/api/config').set(headers).expect(200);
        assert.ok(res.body.data, 'the anonymous boot must receive the config payload');
        assert.ok('features' in res.body.data, 'and it must be the real config, not an empty stub');
      });

      it(`GET /api/v1/auth/me still answers 401 with ${label} (the pair)`, async () => {
        // Without this half, "always 200" would pass even if the strict routes had
        // accidentally become public — which is the opposite bug, and worse.
        await supertest(app).get('/api/v1/auth/me').set(headers).expect(401);
      });
    }
  });

  it('basemaps is an object keyed by id, sourced from resources', async () => {
    const cfg = (await supertest(app).get('/api/v1/config').expect(200)).body.data;
    assert.equal(typeof cfg.basemaps, 'object');
    assert.ok(!Array.isArray(cfg.basemaps));
    assert.deepEqual(cfg.basemaps['carta-topografica'], {
      name: 'Topográfica',
      enabled: true,
      image: './images/layers/carta-topografica-thumb.png',
      priority: 1,
    });
  });

  it('tilesets é um array, e o catálogo NÃO nasce prometendo tileset nenhum', async () => {
    // O contrato congelado exige o campo `tilesets` como ARRAY: o cliente itera
    // sobre ele no boot, e trocar array vazio por ausente quebraria a página do
    // mapa. Vazio é resposta legítima; ausente não é.
    //
    // Este caso já afirmou o OPOSTO: que o catálogo trazia um `PCL` semeado pela
    // migração 003, com url `/3d/PCL/tileset.json`. O asset nunca esteve no
    // repositório (`public/3d/` é ignorado pelo versionamento), então toda
    // instalação limpa prometia um modelo que o servidor não serve, e abrir o
    // visualizador 3D nele dava 404 que o cliente engolia de volta para o 2D.
    // A migração 015 removeu o registro, por decisão de produto: o catálogo é
    // ponto de CONFIGURAÇÃO, e conteúdo entra pelo Painel do Administrador ou
    // pelo import de acervo 3D, apontando para uma URL que existe.
    //
    // A expectativa mudou porque o comportamento anterior era o defeito, e não
    // para acomodar regressão.
    const cfg = (await supertest(app).get('/api/v1/config').expect(200)).body.data;
    assert.ok(Array.isArray(cfg.tilesets), 'tilesets precisa existir como array');

    // Repare que a asserção é sobre o REGISTRO SEMEADO, e não sobre o tamanho da
    // coleção. Contagem absoluta aqui seria coberta vazia ao contrário: a tabela
    // é COMPARTILHADA com outros testes da suíte, e `catalog-tables.test.js` cria
    // um tileset por HTTP sem removê-lo. Um `length === 0` passa isolado e
    // reprova em conjunto, que foi exatamente o que aconteceu na primeira versão
    // deste caso, e é a armadilha que o livro-razão registra como "contagem
    // absoluta de tabela que outro teste escreve".
    const semeado = cfg.tilesets.find((t) => t.id === 'PCL');
    assert.equal(semeado, undefined,
      'migração não pode voltar a semear tileset: o catálogo é ponto de configuração');
  });

  it('analysisLayers only exposes layers with valid bounds; the placeholder hillshade is excluded', async () => {
    const cfg = (await supertest(app).get('/api/v1/config').expect(200)).body.data;
    assert.equal(cfg.analysisLayers.enabled, true);
    assert.ok(Array.isArray(cfg.analysisLayers.layers));
    // The seeded `hillshade` analysis_layer has an empty config (no bounds) — serving
    // it would violate the frozen contract and break the frontend boot, so it is filtered.
    assert.ok(!cfg.analysisLayers.layers.some((l) => l.id === 'hillshade'),
      'placeholder hillshade (no bounds) must not be served');
    // Every served analysis layer carries valid bounds. The seed ships
    // declividade + hipsometria with bounds, so an empty list here would mean
    // the filter ate everything — and would make the loop below assert nothing.
    assert.ok(cfg.analysisLayers.layers.length > 0, 'the seeded layers with bounds must still be served');
    for (const l of cfg.analysisLayers.layers) {
      assert.ok(Array.isArray(l.bounds) && l.bounds.length === 4, `analysis layer ${l.id} missing valid bounds`);
    }
  });

  it('serves an analysis layer once its config is completed with valid bounds (resources-driven)', async () => {
    const before = await db.query(`SELECT config FROM analysis_layers WHERE id = 'hillshade'`);
    try {
      await db.query(`UPDATE analysis_layers SET config = $1 WHERE id = 'hillshade'`,
        [JSON.stringify({ bounds: [-74, -34, -34, 6] })]);
      const cfg = (await supertest(app).get('/api/v1/config').expect(200)).body.data;
      const hs = cfg.analysisLayers.layers.find((l) => l.id === 'hillshade');
      assert.ok(hs, 'hillshade with valid bounds should now be served');
      assert.deepEqual(hs.bounds, [-74, -34, -34, 6]);
    } finally {
      await db.query(`UPDATE analysis_layers SET config = $1 WHERE id = 'hillshade'`, [before.rows[0].config]);
    }
  });

  it('basemapStyles serves 5 valid MapLibre styles with env-injected URLs', async () => {
    const cfg = (await supertest(app).get('/api/v1/config').expect(200)).body.data;
    for (const id of ['carta-topografica', 'osm', 'bdgex', 'imagens', 'carta-ortoimagem']) {
      assert.equal(cfg.basemapStyles[id].version, 8, `style ${id}`);
      assert.ok(cfg.basemapStyles[id].sources);
      assert.ok(Array.isArray(cfg.basemapStyles[id].layers));
    }
    // env-injected tile URL (default applied in test env)
    assert.ok(cfg.basemapStyles.osm.sources.osm.tiles[0].includes('{z}/{x}/{y}'));
  });

  it('exposes env-injected service URLs (defaults applied in test)', async () => {
    const cfg = (await supertest(app).get('/api/v1/config').expect(200)).body.data;
    // `search.apiUrl` foi REMOVIDO: a busca de topônimos é servida por este mesmo
    // backend (GET /nomes/busca) e o cliente resolve a rota a partir da base da API.
    // O default antigo apontava para um :3001 que nunca existiu.
    assert.equal(cfg.search?.apiUrl, undefined, 'search.apiUrl não deve mais ser publicado');
    // Fase 9: 360 absorbed → serviceUrl is the in-backend mount, not an external :8081 upstream.
    // RELATIVO por default (como assets3dBaseUrl): o sv360 vive neste backend. O default
    // absoluto anterior (`http://localhost:3000/...`) só funcionava por acidente — :3000 é o
    // Vite, que faz proxy de /api para cá.
    assert.equal(cfg.streetView360.serviceUrl, '/api/v1/sv360');
    // Fase 9 (Tarefa 7): the 360 overlay is a server-rendered VECTOR source (MVT
    // tiles), NOT GeoJSON/PMTiles. Both layers share the same tile template.
    const expectedTiles = ['/api/v1/sv360/tiles/{z}/{x}/{y}.pbf'];
    assert.equal(cfg.streetView360.pointsSource.type, 'vector');
    assert.deepEqual(cfg.streetView360.pointsSource.tiles, expectedTiles);
    assert.equal(cfg.streetView360.pointsSourceLayer, 'fotos');
    assert.equal(cfg.streetView360.linesSource.type, 'vector');
    assert.deepEqual(cfg.streetView360.linesSource.tiles, expectedTiles);
    assert.equal(cfg.streetView360.linesSourceLayer, 'fotos_linha');
    assert.equal(cfg.map3d.providers.terrain.type, 'Cesium');
    assert.equal(cfg.map2d.terrainSource.type, 'raster-dem');
  });

  it('exposes assets3dBaseUrl for resolving relative 3D asset URLs (Fase 4)', async () => {
    const cfg = (await supertest(app).get('/api/v1/config').expect(200)).body.data;
    assert.equal(cfg.assets3dBaseUrl, '/api/v1/assets3d');
  });

  it('reflects edits to the resources table without code changes', async () => {
    // Mutate a seed basemap, assert reflection, then restore (sequential test files).
    const before = await db.query(`SELECT config FROM basemaps WHERE id = 'osm'`);
    try {
      await db.query(`UPDATE basemaps SET config = jsonb_set(config, '{enabled}', 'true') WHERE id = 'osm'`);
      const cfg = (await supertest(app).get('/api/v1/config').expect(200)).body.data;
      assert.equal(cfg.basemaps.osm.enabled, true);
    } finally {
      await db.query(`UPDATE basemaps SET config = $1 WHERE id = 'osm'`, [before.rows[0].config]);
    }
  });
});
