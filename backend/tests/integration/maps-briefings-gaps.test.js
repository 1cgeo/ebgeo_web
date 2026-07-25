// Path: tests/integration/maps-briefings-gaps.test.js
// Audit gap-tests for the Maps + Briefings (GET / merge) subsystem.
// Mirrors tests/integration/maps-merge.test.js style.
// Findings covered: merge-01..06, maps-01..05, brief-01.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser,
  createAtlas,
  createMap,
  createFeature,
  createGroup,
  createLayer,
  createCesium3dData,
  createStreetview360Data,
  createBriefing,
  createSlide,
  loginUser,
  makeAtlasPublic,
  getPublicToken,
} from '../helpers/fixtures.js';

const U = () => `gap_${randomUUID().slice(0, 8)}`;

// catalog_layers has a client-supplied UUID PK and no `name` column.
async function createCatalogLayer(db, mapId) {
  const { rows } = await db.query(
    `INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb) RETURNING *`,
    [randomUUID(), mapId, JSON.stringify({ name: 'CL' })]
  );
  return rows[0];
}

describe('Maps + Briefings — audit gaps', () => {
  let app, db, owner, token, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: U() });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: `Gaps Atlas ${U()}` });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ---------------------------------------------------------------------------
  // merge-01: all 6 whitelisted child tables move (not just features)
  // ---------------------------------------------------------------------------
  it('merge-01: moves all six child entity types into the destination', async () => {
    const dest = await createMap(db, atlas.id, { name: 'd1' });
    const src = await createMap(db, atlas.id, { name: 's1' });

    await createFeature(db, src.id, { properties: { name: 'f' } });
    await createFeature(db, src.id, { properties: { name: 'f2' } });
    await createGroup(db, src.id);
    await createLayer(db, src.id);
    await createCesium3dData(db, src.id);
    await createStreetview360Data(db, src.id);
    await createCatalogLayer(db, src.id);

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${dest.id}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceMapIds: [src.id] })
      .expect(200);

    const moved = res.body.data.moved;
    assert.equal(moved.features, 2);
    assert.equal(moved.groups, 1);
    assert.equal(moved.layers, 1);
    assert.equal(moved.cesium3d_data, 1);
    assert.equal(moved.streetview360_data, 1);
    assert.equal(moved.catalog_layers, 1);

    const tables = ['features', 'groups', 'layers', 'cesium3d_data', 'streetview360_data', 'catalog_layers'];
    for (const tbl of tables) {
      const inDest = await db.query(`SELECT COUNT(*)::int n FROM ${tbl} WHERE map_id = $1`, [dest.id]);
      const inSrc = await db.query(`SELECT COUNT(*)::int n FROM ${tbl} WHERE map_id = $1`, [src.id]);
      assert.ok(inDest.rows[0].n >= 1, `${tbl} should have rows in dest`);
      assert.equal(inSrc.rows[0].n, 0, `${tbl} should have zero rows left in source`);
    }
  });

  // ---------------------------------------------------------------------------
  // merge-02: soft-deleted child rows are NOT moved
  // ---------------------------------------------------------------------------
  it('merge-02: does not move (resurrect) soft-deleted child rows', async () => {
    const dest = await createMap(db, atlas.id, { name: 'd2' });
    const src = await createMap(db, atlas.id, { name: 's2' });

    await createFeature(db, src.id, { properties: { name: 'a' } });
    await createFeature(db, src.id, { properties: { name: 'b' } });
    const del = await createFeature(db, src.id, { properties: { name: 'c' } });
    await db.query('UPDATE features SET deleted_at = NOW() WHERE id = $1', [del.id]);

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${dest.id}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceMapIds: [src.id] })
      .expect(200);

    assert.equal(res.body.data.moved.features, 2);

    const delRow = await db.query('SELECT map_id FROM features WHERE id = $1', [del.id]);
    assert.equal(delRow.rows[0].map_id, src.id, 'soft-deleted feature must stay in source');
  });

  // ---------------------------------------------------------------------------
  // merge-03: soft-deleted destination -> 404; soft-deleted source -> 404
  // ---------------------------------------------------------------------------
  it('merge-03a: merge into a soft-deleted destination map returns 404 and moves nothing', async () => {
    const dest = await createMap(db, atlas.id, { name: 'd3' });
    const src = await createMap(db, atlas.id, { name: 's3' });
    await createFeature(db, src.id, { properties: { name: 'x' } });
    await db.query('UPDATE maps SET deleted_at = NOW() WHERE id = $1', [dest.id]);

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${dest.id}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceMapIds: [src.id] })
      .expect(404);

    const left = await db.query('SELECT COUNT(*)::int n FROM features WHERE map_id = $1', [src.id]);
    assert.equal(left.rows[0].n, 1);
  });

  it('merge-03b: a soft-deleted source map id is treated as not-belonging (404)', async () => {
    const dest = await createMap(db, atlas.id, { name: 'd3b' });
    const src = await createMap(db, atlas.id, { name: 's3b' });
    await createFeature(db, src.id, { properties: { name: 'y' } });
    await db.query('UPDATE maps SET deleted_at = NOW() WHERE id = $1', [src.id]);

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${dest.id}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceMapIds: [src.id] })
      .expect(404);

    const left = await db.query('SELECT COUNT(*)::int n FROM features WHERE map_id = $1', [src.id]);
    assert.equal(left.rows[0].n, 1, 'features of a soft-deleted source must not move');
  });

  // ---------------------------------------------------------------------------
  // merge-04: moved entity gets version+1 and updated_at advanced
  // ---------------------------------------------------------------------------
  it('merge-04: bumps version by exactly 1 and refreshes updated_at on moved entities', async () => {
    const dest = await createMap(db, atlas.id, { name: 'd4' });
    const src = await createMap(db, atlas.id, { name: 's4' });
    const feat = await createFeature(db, src.id, { properties: { name: 'v' } });

    const before = await db.query('SELECT version, updated_at FROM features WHERE id = $1', [feat.id]);
    const v0 = before.rows[0].version;
    const u0 = new Date(before.rows[0].updated_at).getTime();

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${dest.id}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceMapIds: [src.id] })
      .expect(200);

    const after = await db.query('SELECT version, updated_at, map_id FROM features WHERE id = $1', [feat.id]);
    assert.equal(after.rows[0].version, v0 + 1);
    assert.equal(after.rows[0].map_id, dest.id);
    assert.ok(new Date(after.rows[0].updated_at).getTime() >= u0, 'updated_at must advance');
  });

  // ---------------------------------------------------------------------------
  // merge-05: self-merge (sources == [dest]) early-return, no rows touched
  // ---------------------------------------------------------------------------
  it('merge-05: self-merge returns 200 with empty result and touches no rows', async () => {
    const dest = await createMap(db, atlas.id, { name: 'd5' });
    const feat = await createFeature(db, dest.id, { properties: { name: 'self' } });
    const before = await db.query('SELECT version, map_id FROM features WHERE id = $1', [feat.id]);

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${dest.id}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceMapIds: [dest.id] })
      .expect(200);

    assert.deepEqual(res.body.data.sourceMapIds, []);
    assert.deepEqual(res.body.data.moved, {});

    const after = await db.query('SELECT version, map_id FROM features WHERE id = $1', [feat.id]);
    assert.equal(after.rows[0].version, before.rows[0].version, 'no version bump on self-merge');
    assert.equal(after.rows[0].map_id, dest.id);
  });

  // ---------------------------------------------------------------------------
  // merge-06: transaction atomicity — induced mid-loop failure -> zero partial moves
  // ---------------------------------------------------------------------------
  it('merge-06: a mid-transaction failure rolls back all moves (no partial move)', async () => {
    const dest = await createMap(db, atlas.id, { name: 'd6' });
    const src = await createMap(db, atlas.id, { name: 's6' });
    await createFeature(db, src.id, { properties: { name: 'tx-f' } });
    await createGroup(db, src.id);

    // Trigger fails on UPDATE of `groups`. `features` is processed first in the
    // MAP_CHILD_TABLES loop, so if moves were non-atomic the feature would move
    // before the group update raises.
    await db.query(`
      CREATE OR REPLACE FUNCTION gap_fail_groups() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'gap induced failure'; END;
      $$ LANGUAGE plpgsql;
    `);
    await db.query(`
      CREATE TRIGGER gap_fail_groups_trg BEFORE UPDATE ON groups
      FOR EACH ROW EXECUTE FUNCTION gap_fail_groups();
    `);

    try {
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/maps/${dest.id}/merge`)
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceMapIds: [src.id] });
      assert.ok(res.status >= 400, `expected error status, got ${res.status}`);
    } finally {
      await db.query('DROP TRIGGER IF EXISTS gap_fail_groups_trg ON groups');
      await db.query('DROP FUNCTION IF EXISTS gap_fail_groups()');
    }

    const featInDest = await db.query('SELECT COUNT(*)::int n FROM features WHERE map_id = $1', [dest.id]);
    const featInSrc = await db.query('SELECT COUNT(*)::int n FROM features WHERE map_id = $1', [src.id]);
    assert.equal(featInDest.rows[0].n, 0, 'feature must NOT have moved (rolled back)');
    assert.equal(featInSrc.rows[0].n, 1, 'feature must remain in source after rollback');
  });

  // ---------------------------------------------------------------------------
  // maps-01: strict-auth boundary — no token => 401 on every route
  // ---------------------------------------------------------------------------
  it('maps-01: maps & briefings routes reject with 401 when no token is provided', async () => {
    const map = await createMap(db, atlas.id, { name: 'auth-map' });
    const brief = await createBriefing(db, atlas.id);

    await supertest(app).get(`/api/v1/atlas/${atlas.id}/maps`).expect(401);
    await supertest(app).get(`/api/v1/atlas/${atlas.id}/maps/${map.id}`).expect(401);
    await supertest(app).get(`/api/v1/atlas/${atlas.id}/briefings`).expect(401);
    await supertest(app).get(`/api/v1/atlas/${atlas.id}/briefings/${brief.id}`).expect(401);
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${map.id}/merge`)
      .send({ sourceMapIds: [randomUUID()] })
      .expect(401);
  });

  // ---------------------------------------------------------------------------
  // maps-02: public/anonymous token read access + IDOR + merge 403
  // ---------------------------------------------------------------------------
  it('maps-02: public read token can read maps & briefings; merge with it is forbidden', async () => {
    const pubOwner = await createUser(db, { username: U() });
    const pubAtlas = await createAtlas(db, pubOwner.id, { name: `Pub ${U()}` });
    const map = await createMap(db, pubAtlas.id, { name: 'pub-map' });
    await createBriefing(db, pubAtlas.id);
    const link = await makeAtlasPublic(db, pubAtlas.id);
    const pubToken = await getPublicToken(app, link);

    // (a) public token reads maps & briefings of its atlas
    const mapsRes = await supertest(app)
      .get(`/api/v1/atlas/${pubAtlas.id}/maps`)
      .set('Authorization', `Bearer ${pubToken}`)
      .expect(200);
    assert.ok(Array.isArray(mapsRes.body.data));
    assert.ok(mapsRes.body.data.some((m) => m.id === map.id));

    await supertest(app)
      .get(`/api/v1/atlas/${pubAtlas.id}/briefings`)
      .set('Authorization', `Bearer ${pubToken}`)
      .expect(200);

    // (c) public (read) token cannot merge -> 403, not 500
    await supertest(app)
      .post(`/api/v1/atlas/${pubAtlas.id}/maps/${map.id}/merge`)
      .set('Authorization', `Bearer ${pubToken}`)
      .send({ sourceMapIds: [randomUUID()] })
      .expect(403);
  });

  // Was: "a public token reads OTHER public atlases (current cross-atlas behavior)",
  // asserting a 200 — a characterization test that recorded the defect as behaviour.
  // Its own comment named the mechanism exactly ("never matches the token's embedded
  // atlasId"), so the gap was described and then frozen into an assertion instead of
  // being reported. Since 2026-07-19 the HTTP path enforces the token's atlasId
  // claim, as the WS gateway always did; full rationale in
  // public-token-atlas-scope.repro.test.js.
  it('maps-02b: a public token CANNOT read other public atlases (scoped to its own)', async () => {
    // Atlas A public + token
    const oa = await createUser(db, { username: U() });
    const atlasA = await createAtlas(db, oa.id, { name: `A ${U()}` });
    await createMap(db, atlasA.id, { name: 'a-map' });
    const linkA = await makeAtlasPublic(db, atlasA.id);
    const tokenA = await getPublicToken(app, linkA);

    // Atlas B public, with its own map
    const ob = await createUser(db, { username: U() });
    const atlasB = await createAtlas(db, ob.id, { name: `B ${U()}` });
    const mapB = await createMap(db, atlasB.id, { name: 'b-map' });
    await makeAtlasPublic(db, atlasB.id);

    // A's token is scoped to A: requireAtlasPermission compares the token's
    // atlasId claim against the requested atlas before resolving anything.
    await supertest(app)
      .get(`/api/v1/atlas/${atlasB.id}/maps`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);

    // ...and it still works for the atlas it WAS issued for, so the guard is a
    // scope check and not a blanket refusal of public tokens.
    const own = await supertest(app)
      .get(`/api/v1/atlas/${atlasA.id}/maps`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    assert.ok(own.body.data.some((m) => m.name === 'a-map'), 'own atlas still readable');
    assert.ok(mapB, 'fixture guard: atlas B really has a map that stayed unreachable');
  });

  // ---------------------------------------------------------------------------
  // maps-03: soft-deleted map excluded from list and detail (404)
  // ---------------------------------------------------------------------------
  it('maps-03: soft-deleted map is absent from GET maps and 404 on GET detail', async () => {
    const keep = await createMap(db, atlas.id, { name: 'keep' });
    const gone = await createMap(db, atlas.id, { name: 'gone' });
    await db.query('UPDATE maps SET deleted_at = NOW() WHERE id = $1', [gone.id]);

    const list = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/maps`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const ids = list.body.data.map((m) => m.id);
    assert.ok(ids.includes(keep.id));
    assert.ok(!ids.includes(gone.id), 'soft-deleted map must not appear in list');

    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/maps/${gone.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  // ---------------------------------------------------------------------------
  // brief-01: soft-deleted slide excluded; soft-deleted briefing -> 404
  // ---------------------------------------------------------------------------
  it('brief-01: soft-deleted slide is omitted and soft-deleted briefing returns 404', async () => {
    const brief = await createBriefing(db, atlas.id, { name: `Brf ${U()}` });
    await createSlide(db, brief.id, { title: 'keep-slide' });
    const delSlide = await createSlide(db, brief.id, { title: 'del-slide' });
    await db.query('UPDATE slides SET deleted_at = NOW() WHERE id = $1', [delSlide.id]);

    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/briefings/${brief.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(res.body.data.slides.length, 1);
    assert.ok(!res.body.data.slides.some((s) => s.id === delSlide.id));

    const gone = await createBriefing(db, atlas.id, { name: `Gone ${U()}` });
    await db.query('UPDATE briefings SET deleted_at = NOW() WHERE id = $1', [gone.id]);
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/briefings/${gone.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  // ---------------------------------------------------------------------------
  // maps-04: ascending created_at ordering of list endpoints
  // ---------------------------------------------------------------------------
  it('maps-04: maps, briefings and slides are returned in ascending created_at order', async () => {
    const ordAtlas = await createAtlas(db, owner.id, { name: `Ord ${U()}` });

    // Maps with controlled created_at.
    const m1 = await createMap(db, ordAtlas.id, { name: 'om1' });
    const m2 = await createMap(db, ordAtlas.id, { name: 'om2' });
    const m3 = await createMap(db, ordAtlas.id, { name: 'om3' });
    await db.query('UPDATE maps SET created_at = $2 WHERE id = $1', [m1.id, '2020-01-03T00:00:00Z']);
    await db.query('UPDATE maps SET created_at = $2 WHERE id = $1', [m2.id, '2020-01-01T00:00:00Z']);
    await db.query('UPDATE maps SET created_at = $2 WHERE id = $1', [m3.id, '2020-01-02T00:00:00Z']);

    const mapsRes = await supertest(app)
      .get(`/api/v1/atlas/${ordAtlas.id}/maps`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const mapOrder = mapsRes.body.data.map((m) => m.id);
    assert.deepEqual(mapOrder, [m2.id, m3.id, m1.id]);

    // Briefings.
    const b1 = await createBriefing(db, ordAtlas.id, { name: 'ob1' });
    const b2 = await createBriefing(db, ordAtlas.id, { name: 'ob2' });
    await db.query('UPDATE briefings SET created_at = $2 WHERE id = $1', [b1.id, '2020-02-02T00:00:00Z']);
    await db.query('UPDATE briefings SET created_at = $2 WHERE id = $1', [b2.id, '2020-02-01T00:00:00Z']);

    const brfRes = await supertest(app)
      .get(`/api/v1/atlas/${ordAtlas.id}/briefings`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const brfOrder = brfRes.body.data.map((b) => b.id);
    const i1 = brfOrder.indexOf(b1.id);
    const i2 = brfOrder.indexOf(b2.id);
    assert.ok(i2 < i1, 'b2 (earlier created_at) must come before b1');

    // Slides inside one briefing.
    const s1 = await createSlide(db, b1.id, { title: 'os1' });
    const s2 = await createSlide(db, b1.id, { title: 'os2' });
    const s3 = await createSlide(db, b1.id, { title: 'os3' });
    await db.query('UPDATE slides SET created_at = $2 WHERE id = $1', [s1.id, '2020-03-03T00:00:00Z']);
    await db.query('UPDATE slides SET created_at = $2 WHERE id = $1', [s2.id, '2020-03-01T00:00:00Z']);
    await db.query('UPDATE slides SET created_at = $2 WHERE id = $1', [s3.id, '2020-03-02T00:00:00Z']);

    const detail = await supertest(app)
      .get(`/api/v1/atlas/${ordAtlas.id}/briefings/${b1.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const slideOrder = detail.body.data.slides.map((s) => s.id);
    assert.deepEqual(slideOrder, [s2.id, s3.id, s1.id]);
  });

  // ---------------------------------------------------------------------------
  // maps-05: malformed (non-UUID) :mapId destination -> clean 4xx, not 500
  // ---------------------------------------------------------------------------
  it('maps-05: merge with a non-UUID destination mapId returns a clean 4xx (not 500)', async () => {
    const src = await createMap(db, atlas.id, { name: 'm5-src' });
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/not-a-uuid/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceMapIds: [src.id] });

    // A range assertion cannot notice 400 turning into 404 or the reverse, and in
    // this codebase that difference is a decision rather than cosmetics: 404 hides
    // whether a resource exists from a caller not entitled to know, 400 says the
    // REQUEST was malformed. 'not-a-uuid' can never be an id, so it is refused at
    // the border by the param validator, before any lookup — which is why the
    // answer is 400 and not the 404 of "no such map". Pinned exactly, body
    // included, so that moving the refusal deeper (and leaking existence through
    // the status) is visible here.
    assert.equal(res.status, 400, `a malformed id must be refused at the border, got ${res.status}`);
    assert.ok(res.body.error, 'the standard error envelope');
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    // The message is deliberately generic ('Malformed value (invalid id or type)'):
    // it must not confirm which id shape the server considers valid. Pinned as it
    // is so that a future version leaking the parameter or the expected format
    // shows up here.
    assert.equal(res.body.error.message, 'Malformed value (invalid id or type)');
  });
});
