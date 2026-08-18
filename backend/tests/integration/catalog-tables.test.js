// Path: tests/integration/catalog-tables.test.js
// Item 14 (testes-backend.md) — the route -> table binding of the four
// makeCatalogRouter mounts in app.js, and the round-trip from an admin write to the
// public GET /api/config.
//
// Before this file NO HTTP write had ever touched three of the routers: the whole
// catalog suite exercises /api/v1/basemaps and treats it as the set (pattern C2b).
// Mounting /api/v1/analysis-layers with makeCatalogRouter('data_layers') — a one-word
// slip — would have made the admin panel edit the wrong catalog, dropped analysis
// layers out of /api/config, and left every test green. The route names are also a
// frozen contract with the frontend (api-client.js maps analysis_layer ->
// analysis-layers).
//
// There were FIVE mounts until migration 021 dropped `streetview_markers`, a table
// that never had a consumer: it fed nothing in /api/config, no frontend code called
// its route, and no seed wrote to it.
//
// The discriminator is what gives this its teeth: after each POST the row must exist
// in its own table AND be absent from the other three. A test that only asserts 201 +
// "row exists somewhere" cannot see a swapped mount.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

/** [HTTP route segment, physical table]. Mirrors the makeCatalogRouter mounts in app.js. */
const MOUNTS = [
  ['basemaps', 'basemaps'],
  ['data-layers', 'data_layers'],
  ['analysis-layers', 'analysis_layers'],
  ['tilesets', 'tilesets'],
];

const ALL_TABLES = MOUNTS.map(([, t]) => t);

describe('catalog — route/table binding and the /api/config round-trip', () => {
  let app, db, adminToken, userToken;
  const suffix = randomUUID().slice(0, 8);
  const idFor = (route) => `ct-${route}-${suffix}`;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db, { username: `ct_admin_${suffix}` });
    const user = await createUser(db, { username: `ct_user_${suffix}` });
    adminToken = await loginUser(app, admin.username, admin.password);
    userToken = await loginUser(app, user.username, user.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const asAdmin = (m, p) => supertest(app)[m](p).set('Authorization', `Bearer ${adminToken}`);
  const asUser = (m, p) => supertest(app)[m](p).set('Authorization', `Bearer ${userToken}`);

  it('each of the FOUR routes writes into its OWN table and into no other', async () => {
    assert.equal(MOUNTS.length, 4, 'all four mounts must be exercised (anti-empty-sweep guard)');
    let exercised = 0;

    for (const [route, table] of MOUNTS) {
      const id = idFor(route);
      await asAdmin('post', `/api/v1/${route}`)
        .send({ id, name: `Catalog ${route}`, config: { url: `/x/${route}` } })
        .expect(201);

      // The discriminator: present here, absent everywhere else.
      for (const t of ALL_TABLES) {
        const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${t} WHERE id = $1`, [id]);
        assert.equal(
          rows[0].n,
          t === table ? 1 : 0,
          `POST /${route} landed in ${t} (expected only ${table})`,
        );
      }
      exercised += 1;
    }

    assert.equal(exercised, 4, 'four route/table pairs were really exercised');
  });

  it('reads on all four routes need only auth; writes need a GLOBAL admin', async () => {
    assert.equal(MOUNTS.length, 4);
    for (const [route] of MOUNTS) {
      const id = idFor(route);
      const got = await asUser('get', `/api/v1/${route}/${id}`).expect(200);
      assert.equal(got.body.data.id, id, `${route}: a non-admin reads the item`);

      await asUser('put', `/api/v1/${route}/${id}`).send({ name: 'hijack' }).expect(403);
      await asUser('delete', `/api/v1/${route}/${id}`).expect(403);

      // The 403 must be a refusal, not a 403-with-effect.
      const still = await asAdmin('get', `/api/v1/${route}/${id}`).expect(200);
      assert.notEqual(still.body.data.name, 'hijack', `${route}: the refused PUT must not have applied`);
    }
  });

  it('an unauthenticated caller cannot even READ the catalog (401 on all four)', async () => {
    assert.equal(MOUNTS.length, 4);
    for (const [route] of MOUNTS) {
      await supertest(app).get(`/api/v1/${route}`).expect(401);
      await supertest(app).get(`/api/v1/${route}/${idFor(route)}`).expect(401);
    }
  });

  it('a data_layer created over HTTP shows up in /api/config dataLayers.layers', async () => {
    const id = `ct-dl-${suffix}`;
    await asAdmin('post', '/api/v1/data-layers')
      .send({ id, name: 'Camada de dados', config: { url: '/x/dl' } })
      .expect(201);

    const cfg = await supertest(app).get('/api/config').expect(200);
    const layers = cfg.body.data.dataLayers.layers;
    assert.ok(Array.isArray(layers) && layers.length > 0, 'dataLayers.layers must be a non-empty array');
    const found = layers.find((l) => l.id === id);
    assert.ok(found, 'the layer created over HTTP must reach the public config');
    assert.equal(found.name, 'Camada de dados');
    assert.equal(found.url, '/x/dl', 'the config object is spread into the payload');
  });

  it('an analysis_layer reaches /api/config only WITH valid bounds (frozen-contract filter)', async () => {
    const good = `ct-al-good-${suffix}`;
    const bad = `ct-al-bad-${suffix}`;
    await asAdmin('post', '/api/v1/analysis-layers')
      .send({ id: good, name: 'Com bounds', config: { bounds: [-50, -30, -40, -20] } })
      .expect(201);
    await asAdmin('post', '/api/v1/analysis-layers')
      .send({ id: bad, name: 'Sem bounds', config: {} })
      .expect(201);

    const cfg = await supertest(app).get('/api/config').expect(200);
    const layers = cfg.body.data.analysisLayers.layers;
    assert.ok(Array.isArray(layers) && layers.length > 0, 'analysisLayers.layers must be non-empty here');
    const ids = layers.map((l) => l.id);
    assert.ok(ids.includes(good), 'a layer with valid bounds is served');
    assert.ok(!ids.includes(bad), 'a layer without bounds must never reach the frozen contract');
  });

  it('a tileset created over HTTP shows up in /api/config tilesets', async () => {
    const id = `ct-ts-${suffix}`;
    await asAdmin('post', '/api/v1/tilesets')
      .send({ id, name: 'Modelo 3D', config: { url: '/3d/t/tileset.json' } })
      .expect(201);

    const cfg = await supertest(app).get('/api/config').expect(200);
    assert.ok(Array.isArray(cfg.body.data.tilesets) && cfg.body.data.tilesets.length > 0);
    const found = cfg.body.data.tilesets.find((t) => t.id === id);
    assert.ok(found, 'the tileset must reach the public config');
    assert.equal(found.url, '/3d/t/tileset.json');
  });

  it('a basemap created over HTTP shows up in /api/config basemaps (keyed by id)', async () => {
    const id = `ct-bm-${suffix}`;
    await asAdmin('post', '/api/v1/basemaps')
      .send({ id, name: 'Base HTTP', config: { url: 'https://x/{z}/{x}/{y}.png' } })
      .expect(201);

    const cfg = await supertest(app).get('/api/config').expect(200);
    assert.ok(cfg.body.data.basemaps[id], 'basemaps is an object keyed by id');
    assert.equal(cfg.body.data.basemaps[id].name, 'Base HTTP');
  });

  it('DELETE closes the cycle — the soft-deleted item leaves the public payload', async () => {
    const dl = `ct-dl-${suffix}`;
    const ts = `ct-ts-${suffix}`;
    const al = `ct-al-good-${suffix}`;

    await asAdmin('delete', `/api/v1/data-layers/${dl}`).expect(204);
    await asAdmin('delete', `/api/v1/tilesets/${ts}`).expect(204);
    await asAdmin('delete', `/api/v1/analysis-layers/${al}`).expect(204);

    const cfg = await supertest(app).get('/api/config').expect(200);
    assert.ok(
      !cfg.body.data.dataLayers.layers.some((l) => l.id === dl),
      'a deleted data layer must leave /api/config',
    );
    assert.ok(
      !cfg.body.data.tilesets.some((t) => t.id === ts),
      'a deleted tileset must leave /api/config',
    );
    assert.ok(
      !cfg.body.data.analysisLayers.layers.some((l) => l.id === al),
      'a deleted analysis layer must leave /api/config',
    );

    // And it is gone from the admin surface too (soft-delete is not "hidden from lists only").
    await asAdmin('get', `/api/v1/data-layers/${dl}`).expect(404);
  });

  // ---------------------------------------------------------------------------
  // A ASSIMETRIA de idempotência do soft-delete. getCatalogItem e updateCatalogItem
  // filtram `AND active = true` (fix L12); deleteCatalogItem NÃO filtra — o UPDATE
  // reencontra a linha já inativa e o RETURNING devolve o id, então o DELETE repetido
  // responde 204 enquanto GET e PUT do MESMO id respondem 404.
  //
  // Não é necessariamente errado (delete idempotente é um contrato defensável), mas
  // não está escrito em lugar nenhum, e a próxima pessoa que "uniformizar os três
  // filtros" muda a resposta pública da API sem que nada acuse. Pinar o
  // comportamento é o que transforma a divergência em decisão.
  // ---------------------------------------------------------------------------
  it('DELETE é idempotente (204 de novo) enquanto GET/PUT do mesmo id já são 404', async () => {
    const id = `ct-idem-${suffix}`;
    await asAdmin('post', '/api/v1/basemaps')
      .send({ id, name: 'Idempotência', config: { url: 'https://x/{z}/{x}/{y}.png' } })
      .expect(201);

    await asAdmin('delete', `/api/v1/basemaps/${id}`).expect(204);

    // As três respostas, lado a lado, no mesmo teste: é a comparação que documenta.
    await asAdmin('delete', `/api/v1/basemaps/${id}`).expect(204);
    await asAdmin('get', `/api/v1/basemaps/${id}`).expect(404);
    await asAdmin('put', `/api/v1/basemaps/${id}`).send({ name: 'Nome novo' }).expect(404);
  });

  it('DELETE de um id que NUNCA existiu é 404 — "já apagado" e "nunca existiu" diferem', async () => {
    // Este é o par que dá sentido ao 204 repetido acima: a rota não devolve 204 para
    // qualquer coisa, só para uma linha que ela de fato encontrou (o RETURNING vazio
    // é o que produz o 404).
    await asAdmin('delete', `/api/v1/basemaps/ct-nunca-existiu-${suffix}`).expect(404);
  });

  it('o segundo DELETE realmente EXECUTA o UPDATE (updated_at avança), não é um no-op', async () => {
    // Se alguém reavaliar essa assimetria, o dado relevante é que o 204 repetido não
    // é gratuito: a linha é reescrita a cada chamada. Um DELETE idempotente "de
    // verdade" (early-return sobre linha inativa) NÃO tocaria em updated_at.
    const id = `ct-idem2-${suffix}`;
    await asAdmin('post', '/api/v1/basemaps')
      .send({ id, name: 'Idempotência 2', config: { url: 'https://x/{z}/{x}/{y}.png' } })
      .expect(201);
    await asAdmin('delete', `/api/v1/basemaps/${id}`).expect(204);

    const antes = await db.query('SELECT active, updated_at FROM basemaps WHERE id = $1', [id]);
    assert.equal(antes.rows.length, 1, 'soft-delete: a linha continua na tabela');
    assert.equal(antes.rows[0].active, false);

    await new Promise((r) => setTimeout(r, 15)); // resolução de now() por statement
    await asAdmin('delete', `/api/v1/basemaps/${id}`).expect(204);

    const depois = await db.query('SELECT updated_at FROM basemaps WHERE id = $1', [id]);
    assert.ok(
      new Date(depois.rows[0].updated_at) > new Date(antes.rows[0].updated_at),
      'o segundo DELETE reescreve a linha — comportamento pinado, não endossado'
    );
  });
});
