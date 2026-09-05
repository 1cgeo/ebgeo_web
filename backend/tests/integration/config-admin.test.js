// Path: tests/integration/config-admin.test.js
// F4: admin system-config overrides. The STATIC/ENV parts of GET /api/v1/config (app/features/
// map2d/map3d/service URLs) have no `resources` row; an admin edits them via PUT /config/admin,
// which stores a partial override that getAppConfig deep-merges OVER the assembled payload (admin
// wins). A partial save merges into the stored document (never wipes untouched sections).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('Config — admin overrides (F4)', () => {
  let app, db, adminTok, userTok;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db);
    const user = await createUser(db);
    adminTok = await loginUser(app, admin.username, admin.password);
    userTok = await loginUser(app, user.username, user.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('GET/PUT /config/admin require a GLOBAL admin (403 for a regular user)', async () => {
    await supertest(app)
      .get('/api/v1/config/admin')
      .set('Authorization', `Bearer ${userTok}`)
      .expect(403);
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${userTok}`)
      .send({ app: { title: 'Hack' } })
      .expect(403);
  });

  it('an override wins over the STATIC default in the public GET /config', async () => {
    // Baseline: the static app.title.
    const before = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(before.body.data.app.title, 'EBGeo');

    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ app: { title: 'Meu EBGeo' } })
      .expect(200);

    const after = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(after.body.data.app.title, 'Meu EBGeo');

    // The admin read echoes the stored override (prefills the editor).
    const adminView = await supertest(app)
      .get('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    assert.equal(adminView.body.data.overrides.app.title, 'Meu EBGeo');
    assert.equal(adminView.body.data.effective.app.title, 'Meu EBGeo');
  });

  it('a partial save MERGES into the stored overrides (untouched sections survive)', async () => {
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ features: { grid: true } })
      .expect(200);

    const cfg = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(cfg.body.data.features.grid, true);
    // The earlier app.title override must still be there (the merge did not wipe it).
    assert.equal(cfg.body.data.app.title, 'Meu EBGeo');
  });

  it('validation rejects bad types and empty payloads (422)', async () => {
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ map2d: { maxZoom: 'not-a-number' } })
      .expect(422);
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({})
      .expect(422);
  });

  it('uma seção desconhecida MISTURADA com uma conhecida derruba o PUT inteiro (422, nada gravado)', async () => {
    // O caso que este arquivo tinha antes — `{ bogusSection: { x: 1 } }` sozinho — passava
    // com a chave desconhecida sendo DESCARTADA em silêncio: o corpo ficava `{}` e o 422
    // vinha do `.min(1)` do schema, não da chave inválida. Era um verde que provaria
    // exatamente a mesma coisa se a validação de chave desconhecida não existisse.
    //
    // O único payload que distingue "rejeitar" de "descartar" tem as DUAS coisas. Com o
    // descarte silencioso (stripUnknown do middleware), este PUT respondia 200 e gravava
    // a metade conhecida; com a rejeição, responde 422 e não grava nada.
    const antes = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(antes.body.data.features.grid, true, 'pré-condição: o override anterior está de pé');

    const res = await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ features: { grid: false }, bogusSection: { x: 1 } })
      .expect(422);
    assert.match(JSON.stringify(res.body), /bogusSection/, 'o erro precisa NOMEAR a seção recusada');

    const depois = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(
      depois.body.data.features.grid,
      true,
      'a metade conhecida do payload recusado não pode ter sido aplicada'
    );
  });

  it('allows ADVANCED overrides for keys with no form field (everything is configurable)', async () => {
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({
        map3d: { initialCamera: { longitude: -44, latitude: -22, height: 500 } },
        streetView360: { serviceUrl: '/custom-360' },
        map2d: { terrainSource: { type: 'raster-dem', tiles: ['/x/{z}/{x}/{y}'] } },
      })
      .expect(200);
    const cfg = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(cfg.body.data.map3d.initialCamera.height, 500);
    assert.equal(cfg.body.data.streetView360.serviceUrl, '/custom-360');
    assert.deepEqual(cfg.body.data.map2d.terrainSource.tiles, ['/x/{z}/{x}/{y}']);
  });

  // A SEGUNDA PORTA DA BASE DO 360. `optionalBase` (src/config.js) limpa a
  // variável de ambiente, mas o override avançado aceita `streetView360` como
  // objeto livre e VENCE o valor da env no deepMerge, então uma barra digitada
  // aqui chegaria ao browser e toda URL do 360 sairia com `//`. Por isso a
  // normalização de config.service.js roda DEPOIS do merge, e é isso que este
  // caso prende. A porta da env é coberta em tests/unit/config-base-trailing-slash.
  it('an ADVANCED override of the 360 base is stripped of its trailing slash', async () => {
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ streetView360: { serviceUrl: '/api/v1/sv360/' } })
      .expect(200);
    const cfg = await supertest(app).get('/api/v1/config').expect(200);
    const base = cfg.body.data.streetView360.serviceUrl;
    assert.equal(base, '/api/v1/sv360', 'a barra final do override precisa sumir');
    // O que o cliente realmente monta: sem esta linha o caso mede uma string
    // e não o defeito (frontend concatena `${serviceUrl}${path}` com path em '/').
    const url = `${base}/photos/abc/tiles.json`;
    assert.ok(!url.includes('//'), `barra dupla na URL do cliente: ${url}`);
  });

  it('a basemap resource config.style overrides the static basemapStyles (F6)', async () => {
    const style = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background' }] };
    await supertest(app)
      .post('/api/v1/basemaps')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ id: 'bm-custom', name: 'Custom BM', config: { enabled: true, priority: 9, style } })
      .expect(201);

    const cfg = await supertest(app).get('/api/v1/config').expect(200);
    // The style is emitted in basemapStyles, and stripped from the basemaps metadata.
    assert.deepEqual(cfg.body.data.basemapStyles['bm-custom'], style);
    assert.equal(cfg.body.data.basemaps['bm-custom'].style, undefined);
    assert.equal(cfg.body.data.basemaps['bm-custom'].priority, 9);
  });

  it('rejects map2d.minZoom greater than maxZoom (cross-field validation)', async () => {
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ map2d: { minZoom: 20, maxZoom: 5 } })
      .expect(422);
  });

  // O LOD de tiles com a câmera inclinada (2026-09-04). A forma e os pisos estão presos em
  // `tests/unit/config-lod-de-tiles.test.js`; o que se mede AQUI é a rota: que a recusa chega
  // como 422 com o campo nomeado, e que o valor recusado NÃO fica gravado. A distinção importa
  // porque `map2d` é `.unknown(true)` e o middleware roda com `stripUnknown`: antes da
  // declaração este PUT respondia 200 e gravava o par, e um `[1, 10]` salvo pedia cerca de doze
  // vezes os tiles do padrão a 60 graus, em todo navegador, para sempre.
  it('o LOD de tiles inválido morre em 422 na rota, e o servido continua null', async () => {
    const resposta = await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ map2d: { sourceTileLodParams: [1, 10.0] } })
      .expect(422);
    assert.match(JSON.stringify(resposta.body), /sourceTileLodParams/);

    const cfg = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(cfg.body.data.map2d.sourceTileLodParams, null);
  });

  it('o LOD de tiles VÁLIDO é gravado e chega ao cliente, e `null` volta atrás', async () => {
    // CONTROLE POSITIVO da recusa acima: sem ele, uma borda que recusasse TUDO passaria.
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ map2d: { sourceTileLodParams: [5, 6.0] } })
      .expect(200);
    let cfg = await supertest(app).get('/api/v1/config').expect(200);
    assert.deepEqual(cfg.body.data.map2d.sourceTileLodParams, [5, 6.0]);

    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ map2d: { sourceTileLodParams: null } })
      .expect(200);
    cfg = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(cfg.body.data.map2d.sourceTileLodParams, null);
  });

  // A BASE PREFERIDA COM O TERRENO LIGADO (2026-09-05). A forma está presa em
  // `tests/unit/config-base-preferida-do-terreno.test.js`; o que se mede AQUI é o payload
  // SERVIDO: que as duas chaves chegam ao cliente, que um recorte invertido morre em 422 sem
  // ficar gravado, e que declarar as duas não apagou as vizinhas de `map2d` no caminho.
  it('a base preferida do terreno é servida nula e chega ao cliente quando o admin a aponta', async () => {
    let cfg = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(cfg.body.data.map2d.terrainPreferredBasemap, null);
    assert.equal(cfg.body.data.map2d.terrainPreferredBasemapBounds, null);

    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({
        map2d: {
          terrainPreferredBasemap: 'carta-ortoimagem',
          terrainPreferredBasemapBounds: [-58.1, -33.4, -48.7, -27.1],
        },
      })
      .expect(200);

    cfg = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(cfg.body.data.map2d.terrainPreferredBasemap, 'carta-ortoimagem');
    assert.deepEqual(cfg.body.data.map2d.terrainPreferredBasemapBounds, [-58.1, -33.4, -48.7, -27.1]);
    // AS VIZINHAS, no mesmo fôlego: o override é deep-merge sobre o documento montado, e uma
    // seção que perdesse o `.unknown(true)` gravaria o objeto podado com 200.
    assert.equal(cfg.body.data.map2d.minZoom, 2);
    assert.equal(cfg.body.data.map2d.maxZoom, 21);
    assert.equal(typeof cfg.body.data.map2d.hillshade, 'object');
  });

  it('o recorte invertido morre em 422 na rota, e o servido não muda', async () => {
    // Oeste a leste do leste: a caixa que cruza o antimeridiano, que nenhuma das duas linhas
    // trata. Gravá-la desligaria a troca em silêncio, com o painel exibindo o valor salvo.
    const antes = await supertest(app).get('/api/v1/config').expect(200);
    const resposta = await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ map2d: { terrainPreferredBasemapBounds: [170, -20, -170, 20] } })
      .expect(422);
    assert.match(JSON.stringify(resposta.body), /terrainPreferredBasemapBounds/);

    const depois = await supertest(app).get('/api/v1/config').expect(200);
    assert.deepEqual(
      depois.body.data.map2d.terrainPreferredBasemapBounds,
      antes.body.data.map2d.terrainPreferredBasemapBounds,
    );
  });

  // Item 16 (testes-backend.md) — the gate on the DESTRUCTIVE verb.
  //
  // The first test of this file checks 403 for GET and PUT and was treated as if it
  // covered the set (pattern C2b). DELETE — the valve that wipes EVERY system override
  // of the deployment in one call — had no gate test at all: dropping `requireAdmin`
  // from that one route line let any authenticated user reset the whole config, with
  // this suite fully green. And since /api/config is the single source the frontend
  // boot is fail-fast on, that is a deployment-wide effect.
  describe('the /config/admin gate on all three verbs', () => {
    it('a regular user cannot DELETE the overrides — status AND effect', async () => {
      await supertest(app)
        .put('/api/v1/config/admin')
        .set('Authorization', `Bearer ${adminTok}`)
        .send({ app: { title: 'Sentinela' } })
        .expect(200);

      await supertest(app)
        .delete('/api/v1/config/admin')
        .set('Authorization', `Bearer ${userTok}`)
        .expect(403);

      // The refusal must have had no effect: a 403-that-still-cleared would pass a
      // status-only assertion.
      const cfg = await supertest(app).get('/api/config').expect(200);
      assert.equal(cfg.body.data.app.title, 'Sentinela');
    });

    it('an anonymous caller gets 401 UNAUTHORIZED on all three verbs (auth fires before requireAdmin)', async () => {
      // Ordering matters: a requireAdmin that read req.user.role without `auth` in front
      // would throw a 500 here instead of refusing.
      const anonGet = await supertest(app).get('/api/v1/config/admin').expect(401);
      assert.equal(anonGet.body.error.code, 'UNAUTHORIZED');

      const anonPut = await supertest(app)
        .put('/api/v1/config/admin')
        .send({ app: { title: 'x' } })
        .expect(401);
      assert.equal(anonPut.body.error.code, 'UNAUTHORIZED');

      const anonDel = await supertest(app).delete('/api/v1/config/admin').expect(401);
      assert.equal(anonDel.body.error.code, 'UNAUTHORIZED');

      const cfg = await supertest(app).get('/api/config').expect(200);
      assert.equal(cfg.body.data.app.title, 'Sentinela', 'no anonymous call may have taken effect');
    });

    // Item 92 — the schema must not let the catalog in through the override door.
    it('rejects TOP-LEVEL catalog keys (they have their own CRUD, 422)', async () => {
      const forbidden = [
        { basemaps: { osm: { name: 'x' } } },
        { tilesets: [{ id: 'x' }] },
        { basemapStyles: { osm: { version: 8, sources: {}, layers: [] } } },
        { postos: [{ id: 'x', name: 'Cap' }] },
        { organizacoesMilitares: [{ id: 'x', name: 'OM' }] },
      ];
      assert.equal(forbidden.length, 5, 'the rejection table must not be empty');

      for (const body of forbidden) {
        await supertest(app)
          .put('/api/v1/config/admin')
          .set('Authorization', `Bearer ${adminTok}`)
          .send(body)
          .expect(422);
      }

      // And nothing leaked into the effective payload.
      const cfg = await supertest(app).get('/api/config').expect(200);
      assert.ok(!Array.isArray(cfg.body.data.basemaps), 'basemaps stays the object keyed by id');
      assert.ok(Array.isArray(cfg.body.data.postos), 'postos stays the server-derived list');
    });

    // Item 95 — deepMerge semantics against the frozen shape: arrays REPLACE, they do
    // not concatenate, and an open Joi section cannot produce a payload that breaks boot.
    it('an override ARRAY replaces the base array instead of merging into it', async () => {
      await supertest(app)
        .put('/api/v1/config/admin')
        .set('Authorization', `Bearer ${adminTok}`)
        .send({ map2d: { terrainSource: { type: 'raster-dem', tiles: ['/a/{z}/{x}/{y}'], tileSize: 256 } } })
        .expect(200);
      await supertest(app)
        .put('/api/v1/config/admin')
        .set('Authorization', `Bearer ${adminTok}`)
        .send({ map2d: { terrainSource: { tiles: ['/b/{z}/{x}/{y}'] } } })
        .expect(200);

      const cfg = await supertest(app).get('/api/config').expect(200);
      assert.deepEqual(
        cfg.body.data.map2d.terrainSource.tiles,
        ['/b/{z}/{x}/{y}'],
        'the array is replaced, never concatenated',
      );
      assert.equal(cfg.body.data.map2d.terrainSource.type, 'raster-dem', 'sibling keys still merge');
    });

    it('the frozen top-level shape survives an override of every open section', async () => {
      await supertest(app)
        .put('/api/v1/config/admin')
        .set('Authorization', `Bearer ${adminTok}`)
        .send({
          app: { title: 'Sentinela' },
          features: { grid: false },
          search: { qualquer: 1 },
          streetView360: { serviceUrl: '/sv' },
          analysisLayers: { enabled: false },
          dataLayers: { enabled: false },
          assets3dBaseUrl: '/assets',
        })
        .expect(200);

      const cfg = await supertest(app).get('/api/config').expect(200);
      const REQUIRED = [
        'app', 'features', 'services', 'search', 'basemaps', 'analysisLayers', 'dataLayers',
        'map2d', 'map3d', 'tilesets', 'postos', 'organizacoesMilitares', 'streetView360',
        'basemapStyles', 'assets3dBaseUrl',
      ];
      assert.equal(REQUIRED.length, 15, 'the frozen key list must not be empty');
      for (const key of REQUIRED) {
        assert.ok(key in cfg.body.data, `GET /api/config lost the frozen key "${key}"`);
      }
      // The sections the admin turned off keep their SHAPE (the frontend reads .layers).
      assert.ok(Array.isArray(cfg.body.data.analysisLayers.layers));
      assert.ok(Array.isArray(cfg.body.data.dataLayers.layers));
    });
  });

  // Runs LAST: clears ALL overrides set by the tests above.
  it('DELETE /config/admin clears all overrides (revert to STATIC default)', async () => {
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ app: { title: 'Temporário' } })
      .expect(200);
    let cfg = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(cfg.body.data.app.title, 'Temporário');

    await supertest(app)
      .delete('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);

    cfg = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(cfg.body.data.app.title, 'EBGeo'); // back to the STATIC default
  });
});
