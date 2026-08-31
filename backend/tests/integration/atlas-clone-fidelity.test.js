// Path: tests/integration/atlas-clone-fidelity.test.js
// Items 74, 75 and 76 — three ways a whole-entity copy diverged from its source.
//
// 74. `grid_style` and `temporal_config` are part of a map's identity (the UTM grid
//     and the entire temporal module: window, mode, unit, origin). They were added to
//     the table, the sync snapshot and the import schema, but the clone/duplicate
//     column lists were never updated, so a cloned atlas came back with '{}' for both
//     and silently lost its grid and its timeline. Nothing read those columns after a
//     clone, so the loss was invisible.
//
// 75. `atlas.name` and `maps.name` are VARCHAR(255) and the copy suffix adds 8 chars
//     to a name the API accepts at exactly 255 (atlas-gaps.test.js proves the boundary
//     is reachable). The overflow is SQLSTATE 22001, which PG_ERROR_MAP does not list,
//     so a perfectly valid atlas answered 500 INTERNAL_ERROR.
//
// 76. `createAtlas` omits the settings column and inherits the DEFAULT document;
//     import used to write the payload (or '{}') over it, so "save my local atlas to
//     the server" produced a settings shape DIFFERENT from an atlas created on the
//     server — and settings is the overlay that gates 3D/360/layers per atlas.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

const GRID = { espacamento: 1000, cor: '#f00', visivel: true };
const TEMPORAL = { ativo: true, modo: 'relativo', unidade: 'h', inicio: 1000, fim: 2000 };

describe('clone / duplicate / import must not silently alter what they copy', () => {
  let app, db, owner, token;

  const mapRow = async (mapId) => {
    const { rows } = await db.query(
      'SELECT name, grid_style, temporal_config FROM maps WHERE id = $1', [mapId]
    );
    return rows[0];
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `p74_owner_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, owner.username, owner.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ── item 74 · grid_style + temporal_config survive the copy ────────────────
  describe('grid_style and temporal_config', () => {
    const seedMap = async () => {
      const atlas = await createAtlas(db, owner.id, { name: `P74 ${randomUUID().slice(0, 6)}` });
      const map = await createMap(db, atlas.id, { name: 'Origem' });
      await db.query(
        'UPDATE maps SET grid_style = $2::jsonb, temporal_config = $3::jsonb WHERE id = $1',
        [map.id, JSON.stringify(GRID), JSON.stringify(TEMPORAL)]
      );
      return { atlas, map };
    };

    it('a CLONED atlas keeps both columns verbatim', async () => {
      const { atlas } = await seedMap();

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/clone`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      assert.equal(res.body.data.maps.length, 1);
      const cloned = await mapRow(res.body.data.maps[0].id);
      assert.deepEqual(cloned.grid_style, GRID);
      assert.deepEqual(cloned.temporal_config, TEMPORAL);
    });

    it('a DUPLICATED map keeps both columns verbatim', async () => {
      const { atlas, map } = await seedMap();

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/maps/${map.id}/duplicate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const dup = await mapRow(res.body.data.id);
      assert.deepEqual(dup.grid_style, GRID);
      assert.deepEqual(dup.temporal_config, TEMPORAL);
    });

    it('POSITIVE CONTROL: import already carried both, so the assertion matches something real', async () => {
      const mapId = randomUUID();
      const res = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: { name: `P74 import ${randomUUID().slice(0, 6)}` },
          maps: [{ id: mapId, name: 'Importado', grid_style: GRID, temporal_config: TEMPORAL }],
        })
        .expect(201);

      assert.ok(res.body.data.id);
      const imported = await mapRow(mapId);
      assert.deepEqual(imported.grid_style, GRID);
      assert.deepEqual(imported.temporal_config, TEMPORAL);
    });

    it('BORDER: an empty pair clones as {} and never as NULL (both columns are NOT NULL)', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `P74 empty ${randomUUID().slice(0, 6)}` });
      await createMap(db, atlas.id, { name: 'Vazio' });

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/clone`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      const cloned = await mapRow(res.body.data.maps[0].id);
      assert.deepEqual(cloned.grid_style, {});
      assert.deepEqual(cloned.temporal_config, {});
    });
  });

  // ── item 75 · the copy suffix vs VARCHAR(255) ──────────────────────────────
  describe('the "(cópia)" suffix against the 255-char column', () => {
    it('cloning an atlas whose name is already at the 255-char limit is not a 500', async () => {
      const longName = 'A'.repeat(255);
      const created = await supertest(app)
        .post('/api/v1/atlas')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: longName })
        .expect(201);

      const res = await supertest(app)
        .post(`/api/v1/atlas/${created.body.data.id}/clone`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      assert.ok(res.body.data.name.length <= 255, 'the stored name fits the column');
      assert.ok(res.body.data.name.endsWith(' (cópia)'), 'a copy stays distinguishable from its source');
    });

    it('duplicating a map whose name is at the limit is not a 500 either', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `P75 ${randomUUID().slice(0, 6)}` });
      const map = await createMap(db, atlas.id, { name: 'B'.repeat(255) });

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/maps/${map.id}/duplicate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      assert.ok(res.body.data.name.length <= 255);
      assert.ok(res.body.data.name.endsWith(' (cópia)'));
    });

    it('CONTROL: exactly at the seam (247 + 8 = 255) nothing is truncated', async () => {
      const base = 'C'.repeat(247);
      const created = await supertest(app)
        .post('/api/v1/atlas')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: base })
        .expect(201);

      const res = await supertest(app)
        .post(`/api/v1/atlas/${created.body.data.id}/clone`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      assert.equal(res.body.data.name, `${base} (cópia)`);
      assert.equal(res.body.data.name.length, 255);
    });

    it('a chain of clones keeps answering 201 as the name crosses the limit', async () => {
      const created = await supertest(app)
        .post('/api/v1/atlas')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'D'.repeat(250) })
        .expect(201);

      let id = created.body.data.id;
      for (const round of [1, 2, 3]) {
        const res = await supertest(app)
          .post(`/api/v1/atlas/${id}/clone`)
          .set('Authorization', `Bearer ${token}`)
          .send({});
        assert.equal(res.status, 201, `clone #${round} must not be a 500`);
        assert.ok(res.body.data.name.length <= 255);
        id = res.body.data.id;
      }
    });
  });

  // ── item 76 · the settings document an import starts from ──────────────────
  describe('settings shape: created-on-server vs imported', () => {
    const settingsOf = async (atlasId) => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlasId}/settings`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      return res.body.data;
    };

    it('an imported atlas exposes the SAME top-level keys as one created on the server', async () => {
      const created = await supertest(app)
        .post('/api/v1/atlas')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `P76 created ${randomUUID().slice(0, 6)}` })
        .expect(201);
      const baseline = await settingsOf(created.body.data.id);

      assert.ok(Object.keys(baseline).includes('features'), 'the default document is not empty');
      assert.ok(Object.keys(baseline).includes('basemaps'));

      const imported = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({ atlas: { name: `P76 imported ${randomUUID().slice(0, 6)}` }, maps: [] })
        .expect(201);
      const settings = await settingsOf(imported.body.data.id);

      assert.deepEqual(Object.keys(settings).sort(), Object.keys(baseline).sort());
      assert.equal(settings.features.map_3d, true, 'the per-atlas feature gate resolves, not undefined');
    });

    it('a PARTIAL settings payload overrides only its own keys', async () => {
      const imported = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          // A CHAVE DE EXEMPLO ERA `min_zoom` ATÉ 2026-08-31, e o caso passou a certificar o
          // contrário do que se queria: que uma chave REMOVIDA do produto continuava sendo
          // gravada por esta rota. O caso mede a FUSÃO parcial, então ele troca de chave e
          // ganha um irmão logo abaixo, que mede a remoção.
          //
          // `bounds_2d` E NÃO `default_basemap`: medido, não escolhido por gosto. O segundo é
          // REFERÊNCIA DE CATÁLOGO (está no inventário de `resource-reference.registry.js`) e
          // passa pela poda por destinatário, então ele volta `null` e o caso mediria a poda
          // em vez da fusão. `bounds_2d` é geometria pura, inerte como o `min_zoom` era.
          atlas: {
            name: `P76 partial ${randomUUID().slice(0, 6)}`,
            settings: { bounds_2d: [[-45, -23], [-42, -21]] },
          },
          maps: [],
        })
        .expect(201);

      const settings = await settingsOf(imported.body.data.id);
      assert.deepEqual(settings.bounds_2d, [[-45, -23], [-42, -21]], 'the payload wins where it speaks');
      assert.equal(settings.features.map_3d, true, 'and the rest of the default survives');
      assert.deepEqual(settings.available_3d_models, []);
    });

    it('um atlas exportado ANTES da remoção do zoom entra, e o zoom NÃO entra com ele', async () => {
      // As duas metades num caso só, porque separá-las esconde o custo de cada escolha:
      // recusar o import (`forbidden`) protegeria o banco e deixaria a pessoa sem subir o
      // arquivo antigo; aceitar sem descartar subiria o arquivo e gravaria chave morta. O
      // `.strip()` é o par, e é o par que se mede.
      const imported = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: {
            name: `P76 zoom ${randomUUID().slice(0, 6)}`,
            settings: { min_zoom: 5, max_zoom: 15, bounds_2d: [[-45, -23], [-42, -21]] },
          },
          maps: [],
        })
        .expect(201);

      const settings = await settingsOf(imported.body.data.id);
      assert.equal(settings.min_zoom, undefined, 'o zoom de atlas não entra por esta porta');
      assert.equal(settings.max_zoom, undefined);
      assert.deepEqual(settings.bounds_2d, [[-45, -23], [-42, -21]],
        'e o irmão vivo do mesmo payload entra: o descarte é das duas chaves, não do objeto');
    });

    it('PATCH on an imported atlas behaves like PATCH on a created one (same shallow merge)', async () => {
      const imported = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({ atlas: { name: `P76 patch ${randomUUID().slice(0, 6)}` }, maps: [] })
        .expect(201);

      await supertest(app)
        .patch(`/api/v1/atlas/${imported.body.data.id}/settings`)
        .set('Authorization', `Bearer ${token}`)
        .send({ features: { map_3d: false } })
        .expect(200);

      const settings = await settingsOf(imported.body.data.id);
      assert.equal(settings.features.map_3d, false);
      assert.equal(settings.basemaps.length, 0, 'sibling top-level keys are untouched');
    });
  });
});
