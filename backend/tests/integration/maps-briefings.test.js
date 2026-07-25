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

    // A SECOND atlas of the same owner, with its own map and briefing. It is
    // never asked for by any test here: it exists solely so that "returns exactly
    // this atlas's rows" has something to fail on. Without a foreign row present,
    // a listing that dropped its `atlas_id` filter entirely would still answer
    // with the right set, and the scope assertion would be unfalsifiable.
    const foreignAtlas = await createAtlas(db, owner.id, { name: 'Foreign Scope Atlas' });
    await createMap(db, foreignAtlas.id, { name: 'Foreign Map' });
    await createBriefing(db, foreignAtlas.id, { name: 'Foreign Briefing' });

    // Share atlas with reader (read permission)
    await createShare(db, atlas.id, reader.id, 'read', owner.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // Every list assertion in this file used `>= n` with the exact number of
  // fixtures the setup creates — the `// map1, map2, lockedMap` comment proves
  // the author knew the number. `>=` was chosen because helpers/setup.js commits
  // its data and never rolls back, so an unrelated file could in principle add
  // rows. The cost is that the tests are blind in the DANGEROUS direction: a GET
  // that started leaking another atlas's maps (a scope failure) only makes the
  // count LARGER, and `>=` stays green.
  //
  // The set is compared instead of the size, and against a scoped query rather
  // than a hard-coded list, so the assertion catches an extra row and a missing
  // one at once without depending on which tests ran before.
  /** Ids the DB says belong to this atlas, sorted — the answer the route must give. */
  async function expectedMapIds() {
    const { rows } = await db.query(
      'SELECT id FROM maps WHERE atlas_id = $1 AND deleted_at IS NULL ORDER BY id',
      [atlas.id]
    );
    return rows.map((r) => r.id);
  }

  // =========
  // Maps
  // =========
  describe('GET /atlas/:atlasId/maps — List Maps', () => {
    it('returns exactly the maps of this atlas, no more and no fewer', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/maps`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.data));
      const expected = await expectedMapIds();
      assert.ok(expected.length >= 3, 'guard: the three fixture maps must exist');
      assert.deepEqual(
        res.body.data.map((m) => m.id).sort(),
        expected,
        'the listing must match the atlas scope exactly — an extra id is a leak, a missing one is a filter bug'
      );

      const names = res.body.data.map(m => m.name);
      assert.ok(names.includes('Map Alpha'));
      assert.ok(names.includes('Map Beta'));
      assert.ok(names.includes('Locked Map'));
    });

    it('reader sees exactly the same set as the owner', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/maps`)
        .set('Authorization', `Bearer ${readerToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.data));
      assert.deepEqual(
        res.body.data.map((m) => m.id).sort(),
        await expectedMapIds(),
        'read access must not change WHICH maps are listed'
      );
    });

    it('stranger cannot list maps of private atlas, and cannot tell it from a nonexistent one', async () => {
      // The stranger holds no share here (only `reader` does), so the gate answers 404,
      // the same reply as an atlas id that was never created. Asserting the pair is what
      // makes "cannot list" also mean "cannot enumerate".
      const negado = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/maps`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);

      const inexistente = await supertest(app)
        .get(`/api/v1/atlas/${randomUUID()}/maps`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);

      // Anti-vacuity anchor: two bodies with no `error` field would compare equal.
      assert.equal(negado.body.error.code, 'NOT_FOUND');
      assert.equal(negado.body.error.code, inexistente.body.error.code);
      assert.equal(negado.body.error.message, inexistente.body.error.message);
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
      // `!== undefined` accepts null, 0, 'abc' and NaN for a coordinate — every
      // shape that breaks the map view — while claiming to check the viewport.
      // The fixture values are known, so assert them, and assert they are usable
      // numbers (`?? 0` does not guard NaN; Number.isFinite does).
      const { center_lat: lat, center_long: lng, zoom } = res.body.data;
      assert.equal(typeof Number(lat), 'number');
      assert.ok(Number.isFinite(Number(lat)), `center_lat must be a real number, got ${lat}`);
      assert.ok(Number.isFinite(Number(lng)), `center_long must be a real number, got ${lng}`);
      assert.equal(Number(lat), -22.9, 'the fixture viewport must round-trip unchanged');
      assert.equal(Number(lng), -43.2);
      assert.equal(Number(zoom), 10);
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
      // 404 (no share on this atlas), matching the two cases above that answer 404 for a
      // map that does not exist: the stranger learns nothing about either the atlas or
      // the map from the status.
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/maps/${map1.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
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
    /** Ids the DB says belong to this atlas, sorted. */
    async function expectedBriefingIds() {
      const { rows } = await db.query(
        'SELECT id FROM briefings WHERE atlas_id = $1 AND deleted_at IS NULL ORDER BY id',
        [atlas.id]
      );
      return rows.map((r) => r.id);
    }

    it('returns exactly the briefings of this atlas', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/briefings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.data));
      const expected = await expectedBriefingIds();
      assert.ok(expected.length >= 2, 'guard: the two fixture briefings must exist');
      assert.deepEqual(res.body.data.map((b) => b.id).sort(), expected);

      const names = res.body.data.map(b => b.name);
      assert.ok(names.includes('Briefing One'));
      assert.ok(names.includes('Briefing Two'));
    });

    it('reader sees exactly the same set as the owner', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/briefings`)
        .set('Authorization', `Bearer ${readerToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.data));
      assert.deepEqual(res.body.data.map((b) => b.id).sort(), await expectedBriefingIds());
    });

    it('stranger cannot list briefings of private atlas', async () => {
      // No share on this atlas → 404, indistinguishable from an atlas that never existed.
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/briefings`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
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
      // Exactly the two slides created for THIS briefing: `>= 2` would not
      // notice another briefing's slides being attached to this one.
      assert.deepEqual(
        res.body.data.slides.map((s) => s.title).sort(),
        ['Slide 1', 'Slide 2']
      );
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
      // No share on this atlas → 404, the same reply the two cases above get for a
      // briefing that does not exist or belongs elsewhere.
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/briefings/${briefing1.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
    });

    it('reader can access single briefing with slides', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/briefings/${briefing1.id}`)
        .set('Authorization', `Bearer ${readerToken}`)
        .expect(200);

      assert.equal(res.body.data.id, briefing1.id);
      assert.ok(Array.isArray(res.body.data.slides));
      assert.deepEqual(
        res.body.data.slides.map((s) => s.title).sort(),
        ['Slide 1', 'Slide 2'],
        'a reader must receive the same slide set, not merely "some" slides'
      );
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
