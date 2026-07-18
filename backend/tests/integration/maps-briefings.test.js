// Path: tests/integration/maps-briefings.test.js
// Integration tests for read-only Maps and Briefings endpoints

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, loginUser,
  createFeature, createLayer, createGroup,
  createBriefing, createSlide, createShare,
} from '../helpers/fixtures.js';

describe('Maps & Briefings API', () => {
  let app, db;
  let owner, reader, stranger;
  let ownerToken, readerToken, strangerToken;
  let atlas, map1, map2, lockedMap;
  let briefing1;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    // Create users
    owner = await createUser(db, { username: 'mb_owner' });
    reader = await createUser(db, { username: 'mb_reader' });
    stranger = await createUser(db, { username: 'mb_stranger' });

    ownerToken = await loginUser(app, owner.username, owner.password);
    readerToken = await loginUser(app, reader.username, reader.password);
    strangerToken = await loginUser(app, stranger.username, stranger.password);

    // Create atlas with maps
    atlas = await createAtlas(db, owner.id, { name: 'Maps Briefings Atlas' });

    map1 = await createMap(db, atlas.id, { name: 'Map Alpha' });
    map2 = await createMap(db, atlas.id, { name: 'Map Beta' });
    lockedMap = await createMap(db, atlas.id, { name: 'Locked Map' });

    // Set locked = true on the locked map
    await db.query('UPDATE maps SET locked = true WHERE id = $1', [lockedMap.id]);

    // Add features, layers, groups to map1
    await createFeature(db, map1.id, {
      feature_type: 'point',
      geometry: { coordinates: [-43.2, -22.9] },
      properties: { name: 'Feature A' },
    });
    await createFeature(db, map1.id, {
      feature_type: 'polygon',
      geometry: { coordinates: [[[-43.3, -22.9], [-43.2, -22.9], [-43.2, -22.8], [-43.3, -22.9]]] },
      properties: { name: 'Feature B' },
    });
    await createLayer(db, map1.id, { name: 'Layer 1' });
    await createGroup(db, map1.id, { name: 'Group 1' });

    // Create briefings with slides
    briefing1 = await createBriefing(db, atlas.id, { name: 'Briefing One' });
    await createBriefing(db, atlas.id, { name: 'Briefing Two', description: 'Second briefing' });

    await createSlide(db, briefing1.id, { title: 'Slide 1', map_id: map1.id });
    await createSlide(db, briefing1.id, { title: 'Slide 2', map_id: map2.id });

    // Share atlas with reader (read permission)
    await createShare(db, atlas.id, reader.id, 'read', owner.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // =========
  // Maps
  // =========
  describe('GET /atlas/:atlasId/maps — List Maps', () => {
    it('returns array of maps for the atlas', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/maps`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length >= 3); // map1, map2, lockedMap

      const names = res.body.data.map(m => m.name);
      assert.ok(names.includes('Map Alpha'));
      assert.ok(names.includes('Map Beta'));
      assert.ok(names.includes('Locked Map'));
    });

    it('reader can list maps', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/maps`)
        .set('Authorization', `Bearer ${readerToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length >= 3);
    });

    it('stranger cannot list maps of private atlas', async () => {
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/maps`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
    });
  });

  describe('GET /atlas/:atlasId/maps/:mapId — Get Single Map', () => {
    it('returns a single map by ID', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/maps/${map1.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      assert.equal(res.body.data.id, map1.id);
      assert.equal(res.body.data.name, 'Map Alpha');
      assert.ok(res.body.data.center_lat !== undefined);
      assert.ok(res.body.data.center_long !== undefined);
      assert.ok(res.body.data.zoom !== undefined);
    });

    it('returns 404 for nonexistent map ID', async () => {
      const fakeMapId = randomUUID();

      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/maps/${fakeMapId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('returns 404 for map belonging to a different atlas', async () => {
      // Create a second atlas with a map
      const otherAtlas = await createAtlas(db, owner.id, { name: 'Other Atlas' });
      const otherMap = await createMap(db, otherAtlas.id, { name: 'Other Map' });

      // Try to access otherMap via the first atlas
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/maps/${otherMap.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('stranger cannot access map of private atlas', async () => {
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/maps/${map1.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
    });

    it('locked map returns locked field as true', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/maps/${lockedMap.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      assert.equal(res.body.data.id, lockedMap.id);
      assert.equal(res.body.data.locked, true);
    });

    it('unlocked map returns locked field as false', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/maps/${map1.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      assert.equal(res.body.data.locked, false);
    });

    it('reader can access single map', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/maps/${map1.id}`)
        .set('Authorization', `Bearer ${readerToken}`)
        .expect(200);

      assert.equal(res.body.data.id, map1.id);
    });
  });

  // =========
  // Briefings
  // =========
  describe('GET /atlas/:atlasId/briefings — List Briefings', () => {
    it('returns array of briefings for the atlas', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/briefings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length >= 2);

      const names = res.body.data.map(b => b.name);
      assert.ok(names.includes('Briefing One'));
      assert.ok(names.includes('Briefing Two'));
    });

    it('reader can list briefings', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/briefings`)
        .set('Authorization', `Bearer ${readerToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length >= 2);
    });

    it('stranger cannot list briefings of private atlas', async () => {
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/briefings`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
    });
  });

  describe('GET /atlas/:atlasId/briefings/:briefingId — Get Single Briefing', () => {
    it('returns a briefing with slides', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/briefings/${briefing1.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      assert.equal(res.body.data.id, briefing1.id);
      assert.equal(res.body.data.name, 'Briefing One');
      assert.ok(Array.isArray(res.body.data.slides));
      assert.ok(res.body.data.slides.length >= 2);

      const slideTitles = res.body.data.slides.map(s => s.title);
      assert.ok(slideTitles.includes('Slide 1'));
      assert.ok(slideTitles.includes('Slide 2'));
    });

    it('slides contain expected fields', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/briefings/${briefing1.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const firstSlide = res.body.data.slides.find(s => s.title === 'Slide 1');
      assert.ok(firstSlide);
      assert.ok(firstSlide.id);
      assert.equal(firstSlide.map_id, map1.id);
      assert.ok(firstSlide.mode);
    });

    it('returns 404 for nonexistent briefing ID', async () => {
      const fakeBriefingId = randomUUID();

      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/briefings/${fakeBriefingId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('returns 404 for briefing belonging to a different atlas', async () => {
      const otherAtlas = await createAtlas(db, owner.id, { name: 'Other Briefing Atlas' });
      const otherBriefing = await createBriefing(db, otherAtlas.id, { name: 'Other Briefing' });

      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/briefings/${otherBriefing.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('stranger cannot access briefing of private atlas', async () => {
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/briefings/${briefing1.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
    });

    it('reader can access single briefing with slides', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/briefings/${briefing1.id}`)
        .set('Authorization', `Bearer ${readerToken}`)
        .expect(200);

      assert.equal(res.body.data.id, briefing1.id);
      assert.ok(Array.isArray(res.body.data.slides));
      assert.ok(res.body.data.slides.length >= 2);
    });

    it('briefing without slides returns empty slides array', async () => {
      const emptyBriefing = await createBriefing(db, atlas.id, { name: 'Empty Briefing' });

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/briefings/${emptyBriefing.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      assert.equal(res.body.data.id, emptyBriefing.id);
      assert.ok(Array.isArray(res.body.data.slides));
      assert.equal(res.body.data.slides.length, 0);
    });
  });
});
