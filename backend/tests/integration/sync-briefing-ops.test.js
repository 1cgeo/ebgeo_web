// Path: tests/integration/sync-briefing-ops.test.js
// Tests for briefing update/delete operations via Sync API
// Covers: §3 items 2,6-9 (delete briefing, edit slides, camera, 3D/360 links)
// Also covers: §22 items 1-11 (briefing editor operations)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createBriefing, createSlide, loginUser,
  seedCatalogRefs, dropCatalogRefs, seedPublic360Photos, drop360Fixture,
} from '../helpers/fixtures.js';

// ============================================================================================
// AS REFERÊNCIAS DE CATÁLOGO QUE AS OPS DESTE ARQUIVO CARREGAM.
//
// Desde que `unseenResourceDenialReason` cobre as CINCO superfícies (e não só a camada de
// catálogo), uma op cujo `tilesetId`/`photoName`/`modelId`/`photoId`/`baseLayer` não resolve
// para um recurso que o autor ENXERGA é recusada POR OPERAÇÃO — e "não existe" conta como "não
// posso ver", para que o ack não vire oráculo de existência sobre o acervo privado.
//
// Este arquivo mede outra coisa (envelope, alias, snapshot, isolamento), então a referência aqui
// é só CENÁRIO: ela existe e é pública. Quem mede o gate em si é
// `tests/integration/sync-referencia-privada.test.js`.
//
// O gancho é de RAIZ (fora de qualquer `describe`) porque o arquivo tem vários blocos e a
// semeadura é do arquivo inteiro; a limpeza é obrigatória porque as tabelas de catálogo e o
// schema `sv360` são compartilhados pela suíte.
// ============================================================================================
const REFS_DE_CATALOGO = { tilesets: ['tileset-abc'] };
const FOTOS_360 = ['foto-panorama-001'];
let refs360Semeadas;

before(async () => {
  const env = await setupTestEnv();
  await seedCatalogRefs(env.db, REFS_DE_CATALOGO);
  refs360Semeadas = await seedPublic360Photos(env.db, FOTOS_360);
  await teardownTestEnv(env.db);
});

after(async () => {
  const env = await setupTestEnv();
  await dropCatalogRefs(env.db, REFS_DE_CATALOGO);
  await drop360Fixture(env.db, refs360Semeadas);
  await teardownTestEnv(env.db);
});

describe('Briefing Operations via Sync', () => {
  let app, db, user, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'briefing_ops_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  function pushSync(operations) {
    return supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations });
  }

  async function getSnapshot() {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data.snapshot;
  }

  describe('Update briefing name (§3 item 6 — rename)', () => {
    it('renames briefing via sync update', async () => {
      const briefing = await createBriefing(db, atlas.id, { name: 'Original Briefing' });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'briefing',
        targetId: briefing.id,
        changes: { name: 'Renamed Briefing' },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM briefings WHERE id = $1', [briefing.id]);
      assert.equal(rows[0].name, 'Renamed Briefing');
    });
  });

  describe('Update briefing description', () => {
    it('updates briefing description via sync', async () => {
      const briefing = await createBriefing(db, atlas.id, { name: 'Desc Briefing' });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'briefing',
        targetId: briefing.id,
        changes: { description: 'New description for briefing' },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM briefings WHERE id = $1', [briefing.id]);
      assert.equal(rows[0].description, 'New description for briefing');
    });
  });

  describe('Update briefing settings (JSONB)', () => {
    it('updates briefing settings via sync', async () => {
      const briefing = await createBriefing(db, atlas.id, { name: 'Settings Briefing' });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'briefing',
        targetId: briefing.id,
        changes: { settings: { panelPosition: 'right', panelWidth: 500, autoPlay: true } },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM briefings WHERE id = $1', [briefing.id]);
      assert.deepEqual(rows[0].settings, { panelPosition: 'right', panelWidth: 500, autoPlay: true });
    });
  });

  describe('Update briefing slide_order (§22 item 4 — reorder slides)', () => {
    it('updates briefing slide_order via sync', async () => {
      const briefing = await createBriefing(db, atlas.id, { name: 'Reorder Briefing' });
      const slide1 = await createSlide(db, briefing.id, { title: 'Slide 1' });
      const slide2 = await createSlide(db, briefing.id, { title: 'Slide 2' });
      const slide3 = await createSlide(db, briefing.id, { title: 'Slide 3' });

      // Reorder: 3, 1, 2
      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'briefing',
        targetId: briefing.id,
        changes: { slide_order: [slide3.id, slide1.id, slide2.id] },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM briefings WHERE id = $1', [briefing.id]);
      assert.deepEqual(rows[0].slide_order, [slide3.id, slide1.id, slide2.id]);
    });
  });

  describe('Delete briefing (§3 item 2)', () => {
    it('soft-deletes briefing via sync', async () => {
      const briefing = await createBriefing(db, atlas.id, { name: 'To Delete Briefing' });

      await pushSync([{
        id: randomUUID(),
        type: 'delete',
        target: 'briefing',
        targetId: briefing.id,
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM briefings WHERE id = $1', [briefing.id]);
      assert.ok(rows[0].deleted_at, 'briefing should be soft-deleted');
    });

    it('deleted briefing is excluded from snapshot', async () => {
      const briefingId = randomUUID();
      const now = Date.now();

      await pushSync([{
        id: randomUUID(),
        type: 'create',
        target: 'briefing',
        targetId: briefingId,
        data: { name: 'Temp Briefing To Delete' },
        timestamp: now,
        clientId: 'test-client',
      }]).expect(200);

      await pushSync([{
        id: randomUUID(),
        type: 'delete',
        target: 'briefing',
        targetId: briefingId,
        timestamp: now + 1,
        clientId: 'test-client',
      }]).expect(200);

      const snapshot = await getSnapshot();
      const found = snapshot.briefings.find(b => b.id === briefingId);
      assert.equal(found, undefined, 'deleted briefing should not appear in snapshot');
    });
  });

  describe('Slide operations — §22 (briefing editor)', () => {
    it('creates slide with map link (§22 item 8 — base layer)', async () => {
      const briefing = await createBriefing(db, atlas.id, { name: 'Slide Map Briefing' });
      const slideId = randomUUID();

      await pushSync([{
        id: randomUUID(),
        type: 'create',
        target: 'slide',
        targetId: slideId,
        data: {
          briefing_id: briefing.id,
          title: 'Map Slide',
          mode: '2d',
          map_id: map.id,
          position: { center: [-43.2, -22.9], zoom: 12 },
        },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [slideId]);
      assert.equal(rows[0].map_id, map.id);
      assert.equal(rows[0].mode, '2d');
    });

    it('creates slide with 3D model link (§22 item 10)', async () => {
      const briefing = await createBriefing(db, atlas.id, { name: 'Slide 3D Briefing' });
      const slideId = randomUUID();

      await pushSync([{
        id: randomUUID(),
        type: 'create',
        target: 'slide',
        targetId: slideId,
        data: {
          briefing_id: briefing.id,
          title: '3D Slide',
          mode: '3d',
          map_id: map.id,
          model_id: 'tileset-abc',
          position: { longitude: -43.2, latitude: -22.9, altitude: 1000 },
          orientation: { heading: 0, pitch: -45, roll: 0 },
        },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [slideId]);
      assert.equal(rows[0].mode, '3d');
      assert.equal(rows[0].model_id, 'tileset-abc');
    });

    it('creates slide with 360 photo link (§22 item 11)', async () => {
      const briefing = await createBriefing(db, atlas.id, { name: 'Slide 360 Briefing' });
      const slideId = randomUUID();

      await pushSync([{
        id: randomUUID(),
        type: 'create',
        target: 'slide',
        targetId: slideId,
        data: {
          briefing_id: briefing.id,
          title: '360 Slide',
          mode: '360',
          map_id: map.id,
          photo_id: 'foto-panorama-001',
          orientation: { longitude: -43.2, latitude: -22.9, fov: 80 },
        },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [slideId]);
      assert.equal(rows[0].mode, '360');
      assert.equal(rows[0].photo_id, 'foto-panorama-001');
    });

    it('updates slide title (§22 item 5)', async () => {
      const briefing = await createBriefing(db, atlas.id, { name: 'Title Edit Briefing' });
      const slide = await createSlide(db, briefing.id, { title: 'Old Title' });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'slide',
        targetId: slide.id,
        changes: { title: 'New Slide Title' },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [slide.id]);
      assert.equal(rows[0].title, 'New Slide Title');
    });

    it('updates slide content — rich text (§22 item 6)', async () => {
      const briefing = await createBriefing(db, atlas.id, { name: 'Content Briefing' });
      const slide = await createSlide(db, briefing.id, { title: 'Content Slide' });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'slide',
        targetId: slide.id,
        changes: { content: '<h1>Situation</h1><p>Enemy forces observed at grid ref XY1234</p>' },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [slide.id]);
      assert.ok(rows[0].content.includes('Enemy forces'));
    });

    it('updates slide camera position (§22 item 7)', async () => {
      const briefing = await createBriefing(db, atlas.id, { name: 'Camera Briefing' });
      const slide = await createSlide(db, briefing.id, { title: 'Camera Slide' });

      const newPosition = { center: [-47.8, -15.5], zoom: 14, bearing: 45, pitch: 30 };

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'slide',
        targetId: slide.id,
        changes: { position: newPosition },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [slide.id]);
      assert.deepEqual(rows[0].position, newPosition);
    });

    it('updates slide orientation (§22 item 15 — 360 orientation)', async () => {
      const briefing = await createBriefing(db, atlas.id, { name: 'Orientation Briefing' });
      const slide = await createSlide(db, briefing.id, { title: 'Orientation Slide', mode: '360' });

      const newOrientation = { longitude: -43.2, latitude: -22.9, fov: 60, heading: 180 };

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'slide',
        targetId: slide.id,
        changes: { orientation: newOrientation },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [slide.id]);
      assert.deepEqual(rows[0].orientation, newOrientation);
    });

    it('marks slide as broken (§22 — validation)', async () => {
      const briefing = await createBriefing(db, atlas.id, { name: 'Broken Briefing' });
      const slide = await createSlide(db, briefing.id, { title: 'Broken Slide' });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'slide',
        targetId: slide.id,
        changes: { is_broken: true, broken_reason: 'Map was deleted' },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [slide.id]);
      assert.equal(rows[0].is_broken, true);
      assert.equal(rows[0].broken_reason, 'Map was deleted');
    });

    it('duplicates slide (§22 item 3) — creates new slide with same data', async () => {
      const briefing = await createBriefing(db, atlas.id, { name: 'Duplicate Briefing' });
      await createSlide(db, briefing.id, {
        title: 'Original Slide',
        content: '<p>Duplicated content</p>',
        mode: '2d',
        map_id: map.id,
        position: { center: [0, 0], zoom: 10 },
      });

      const duplicateId = randomUUID();
      await pushSync([{
        id: randomUUID(),
        type: 'create',
        target: 'slide',
        targetId: duplicateId,
        data: {
          briefing_id: briefing.id,
          title: 'Original Slide (copy)',
          content: '<p>Duplicated content</p>',
          mode: '2d',
          map_id: map.id,
          position: { center: [0, 0], zoom: 10 },
        },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [duplicateId]);
      assert.equal(rows[0].title, 'Original Slide (copy)');
      assert.equal(rows[0].map_id, map.id);
    });

    it('deletes slide (§22 item 2)', async () => {
      const briefing = await createBriefing(db, atlas.id, { name: 'Delete Slide Briefing' });
      const slide = await createSlide(db, briefing.id, { title: 'To Delete Slide' });

      await pushSync([{
        id: randomUUID(),
        type: 'delete',
        target: 'slide',
        targetId: slide.id,
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [slide.id]);
      assert.ok(rows[0].deleted_at, 'slide should be soft-deleted');
    });
  });

  describe('Briefing with slides in snapshot', () => {
    it('snapshot includes briefing with slides ordered', async () => {
      const briefingId = randomUUID();
      const slide1Id = randomUUID();
      const slide2Id = randomUUID();
      const now = Date.now();

      await pushSync([
        {
          id: randomUUID(),
          type: 'create',
          target: 'briefing',
          targetId: briefingId,
          data: { name: 'Snapshot Briefing', slide_order: [slide2Id, slide1Id] },
          timestamp: now,
          clientId: 'test-client',
        },
        {
          id: randomUUID(),
          type: 'create',
          target: 'slide',
          targetId: slide1Id,
          data: { briefing_id: briefingId, title: 'First Created', mode: '2d' },
          timestamp: now + 1,
          clientId: 'test-client',
        },
        {
          id: randomUUID(),
          type: 'create',
          target: 'slide',
          targetId: slide2Id,
          data: { briefing_id: briefingId, title: 'Second Created', mode: '3d' },
          timestamp: now + 2,
          clientId: 'test-client',
        },
      ]).expect(200);

      const snapshot = await getSnapshot();
      const briefing = snapshot.briefings.find(b => b.id === briefingId);
      assert.ok(briefing, 'briefing should be in snapshot');
      assert.ok(Array.isArray(briefing.slides), 'briefing should have slides array');
      assert.equal(briefing.slides.length, 2);
    });
  });

});
