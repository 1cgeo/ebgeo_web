// Path: tests/integration/maps-merge-orphans.test.js
// Items 109 and 111 — what the merge does NOT move, and how it counts its inputs.
//
// 109. MAP_CHILD_TABLES (maps.service.js) is a literal whitelist. merge-01
//      (maps-briefings-gaps.test.js) asserts the COUNT under each key but never that the
//      key set IS that whitelist, so adding or dropping a table passes green. The test
//      below pins the SET, so the day someone edits the whitelist the decision has to be
//      made on purpose. It also pins the observable consequence for group_features,
//      features.layer_id and slides.map_id.
//
//      UPDATED 2026-07-25 (bugs-backend #84): the list is SEVEN tables now. `comments` had
//      the same shape as the other six (map_id NOT NULL REFERENCES maps + version +
//      updated_at + deleted_at) and was simply missing, so a merge separated a spatial
//      comment from the feature it annotates. This file pinned that as CHARACTERIZATION —
//      "named as characterization, not endorsed as correct" — which is exactly what a
//      characterization pin is for: it held the defect still until the owner decided. The
//      decision was taken (comments follow their features) and the two pins that reproved
//      were updated in the same commit as the fix, not reverted onto it.
//
// 111. `sources` is built without dedupe and then compared by LENGTH against
//      `SELECT ... WHERE id = ANY($1)`, which returns one row per DISTINCT id. So a
//      repeated (perfectly valid, perfectly accessible) map id turns into
//      NotFoundError('Source map') — a 404 that says "your map does not exist" about a
//      map that does. mergeMapsSchema has no .unique().

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createFeature, createLayer, createGroup,
  createBriefing, createSlide, loginUser,
} from '../helpers/fixtures.js';

// The tables mergeMaps re-parents, sorted. Kept as a literal here on purpose: importing
// MAP_CHILD_TABLES and comparing it to itself would be a tautology, the same empty-coverage
// shape this file exists to close.
const MERGED_TABLES = [
  'catalog_layers', 'cesium3d_data', 'comments', 'features', 'groups', 'layers',
  'streetview360_data',
];

describe('what a map merge leaves behind, and how it counts its sources', () => {
  let app, db, owner, ownerToken, atlas;

  const merge = (destId, sourceMapIds) => supertest(app)
    .post(`/api/v1/atlas/${atlas.id}/maps/${destId}/merge`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ sourceMapIds });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const tag = randomUUID().slice(0, 8);
    owner = await createUser(db, { username: `p109_owner_${tag}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: `P109 ${tag}` });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('`moved` reports exactly the whitelisted tables — not one fewer, not one more', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);
    await createFeature(db, src.id);

    const res = await merge(dest.id, [src.id]).expect(200);

    assert.deepEqual(
      Object.keys(res.body.data.moved).sort(),
      MERGED_TABLES,
      'editing MAP_CHILD_TABLES must be a deliberate act, visible here'
    );
  });

  // DECIDED 2026-07-25 (bugs-backend #84). This assertion used to say the opposite and was
  // labelled CHARACTERIZATION: the comments stayed on the emptied source map while their
  // feature moved, so the pin vanished from the destination view. The owner decided the
  // annotation follows what it annotates, `comments` joined MAP_CHILD_TABLES, and the pin
  // was inverted here in the same commit.
  it('a spatial comment FOLLOWS its feature to the destination, replies included', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);
    const feature = await createFeature(db, src.id);

    const { rows: [root] } = await db.query(
      `INSERT INTO comments (atlas_id, map_id, lng, lat, data)
       VALUES ($1, $2, -43.2, -22.9, '{"text":"pin"}'::jsonb) RETURNING id`,
      [atlas.id, src.id]
    );
    const { rows: [reply] } = await db.query(
      `INSERT INTO comments (atlas_id, map_id, parent_id, data)
       VALUES ($1, $2, $3, '{"text":"re"}'::jsonb) RETURNING id`,
      [atlas.id, src.id, root.id]
    );

    const res = await merge(dest.id, [src.id]).expect(200);
    assert.equal(res.body.data.moved.comments, 2, 'root and reply both counted as moved');

    const { rows } = await db.query(
      'SELECT id, map_id, version FROM comments WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[root.id, reply.id]]
    );
    assert.equal(rows.length, 2, 'both comment rows survive the merge');
    assert.equal(await featureMap(db, feature.id), dest.id, 'the feature DID move');
    for (const row of rows) {
      assert.equal(
        row.map_id, dest.id,
        'the pin lands on the same map as the feature it annotates'
      );
      assert.equal(row.version, 2, 'and is versioned like every other moved child row');
    }
  });

  // A REPLY carries no lng/lat and is only reachable through its root; moving the root
  // without the reply would leave a thread whose answers live on another map. Both rows go
  // through the same table UPDATE, so this is really a guard against someone later scoping
  // the comment move to root pins only (`lng IS NOT NULL`).
  it('a reply is not left behind on the source map when its root moves', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);

    const { rows: [root] } = await db.query(
      `INSERT INTO comments (atlas_id, map_id, lng, lat, data)
       VALUES ($1, $2, -43.1, -22.8, '{"text":"root"}'::jsonb) RETURNING id`,
      [atlas.id, src.id]
    );
    const { rows: [reply] } = await db.query(
      `INSERT INTO comments (atlas_id, map_id, parent_id, data)
       VALUES ($1, $2, $3, '{"text":"answer"}'::jsonb) RETURNING id`,
      [atlas.id, src.id, root.id]
    );

    await merge(dest.id, [src.id]).expect(200);

    const { rows } = await db.query(
      `SELECT r.map_id AS reply_map, p.map_id AS root_map
       FROM comments r JOIN comments p ON p.id = r.parent_id WHERE r.id = $1`,
      [reply.id]
    );
    assert.equal(rows[0].root_map, dest.id);
    assert.equal(rows[0].reply_map, dest.id, 'thread stays on ONE map');
  });

  it('a soft-deleted comment is not resurrected by the merge', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);

    const { rows: [dead] } = await db.query(
      `INSERT INTO comments (atlas_id, map_id, lng, lat, data, deleted_at)
       VALUES ($1, $2, -43.0, -22.7, '{"text":"gone"}'::jsonb, NOW()) RETURNING id`,
      [atlas.id, src.id]
    );

    const res = await merge(dest.id, [src.id]).expect(200);
    assert.equal(res.body.data.moved.comments, 0);

    const { rows } = await db.query('SELECT map_id, deleted_at FROM comments WHERE id = $1', [dead.id]);
    assert.equal(rows[0].map_id, src.id, 'stays where it died');
    assert.notEqual(rows[0].deleted_at, null);
  });

  it('a group-feature association survives the merge (both ends move together)', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);
    const group = await createGroup(db, src.id);
    const feature = await createFeature(db, src.id);
    await db.query(
      'INSERT INTO group_features (group_id, feature_id) VALUES ($1, $2)',
      [group.id, feature.id]
    );

    await merge(dest.id, [src.id]).expect(200);

    const { rows } = await db.query(
      `SELECT g.map_id AS group_map, f.map_id AS feature_map
       FROM group_features gf
       JOIN groups g ON g.id = gf.group_id
       JOIN features f ON f.id = gf.feature_id
       WHERE gf.group_id = $1 AND gf.feature_id = $2`,
      [group.id, feature.id]
    );
    assert.equal(rows.length, 1, 'the join row is untouched (it carries no map_id)');
    assert.equal(rows[0].group_map, dest.id);
    assert.equal(rows[0].feature_map, dest.id, 'both ends land in the same map, so the link stays valid');
  });

  it('features.layer_id still resolves to a layer of the SAME map after the merge', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);
    const layer = await createLayer(db, src.id);
    const feature = await createFeature(db, src.id);
    await db.query('UPDATE features SET layer_id = $1 WHERE id = $2', [layer.id, feature.id]);

    await merge(dest.id, [src.id]).expect(200);

    const { rows } = await db.query(
      `SELECT f.map_id AS feature_map, l.map_id AS layer_map
       FROM features f JOIN layers l ON l.id = f.layer_id WHERE f.id = $1`,
      [feature.id]
    );
    assert.equal(rows.length, 1, 'the feature still points at a live layer');
    assert.equal(rows[0].feature_map, dest.id);
    assert.equal(rows[0].layer_map, dest.id, 'no cross-map dangling layer reference');
  });

  it('CHARACTERIZATION: a slide keeps pointing at the source map, which the merge emptied', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);
    await createFeature(db, src.id);
    const briefing = await createBriefing(db, atlas.id);
    const slide = await createSlide(db, briefing.id, { map_id: src.id });

    await merge(dest.id, [src.id]).expect(200);

    const { rows } = await db.query(
      'SELECT map_id, is_broken FROM slides WHERE id = $1', [slide.id]
    );
    assert.equal(rows[0].map_id, src.id, 'slides are not in MAP_CHILD_TABLES either');
    assert.equal(rows[0].is_broken, false, 'and nothing marks the slide as pointing at an emptied map');

    const { rows: left } = await db.query(
      'SELECT count(*)::int AS n FROM features WHERE map_id = $1 AND deleted_at IS NULL', [src.id]
    );
    assert.equal(left[0].n, 0, 'the slide now renders an empty map');
  });

  // ── item 111 · duplicate source ids ────────────────────────────────────────
  // A repeated id used to be indistinguishable from a missing one: `sources` was not
  // deduped, so [src, src] compared 2 against the 1 row `id = ANY($1)` returns, and
  // the caller was told "Source map" not found about a map they can read.
  it('a REPEATED source id merges once, and is not mistaken for a missing map', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);
    const feature = await createFeature(db, src.id);

    const res = await merge(dest.id, [src.id, src.id]).expect(200);

    assert.equal(res.body.data.moved.features, 1, 'moved once, not twice');
    assert.deepEqual(res.body.data.sourceMapIds, [src.id], 'the echo is normalized too');
    assert.equal(await featureMap(db, feature.id), dest.id);
  });

  it('the same call without the repetition is identical — the repetition is not a delta', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);
    const feature = await createFeature(db, src.id);

    const res = await merge(dest.id, [src.id]).expect(200);

    assert.equal(res.body.data.moved.features, 1);
    assert.equal(await featureMap(db, feature.id), dest.id);
  });

  it('[dest, src, src] drops the destination and dedupes the rest', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);
    const feature = await createFeature(db, src.id);

    const res = await merge(dest.id, [dest.id, src.id, src.id]).expect(200);

    assert.deepEqual(res.body.data.sourceMapIds, [src.id]);
    assert.equal(await featureMap(db, feature.id), dest.id);
  });

  it('one repetition no longer poisons an otherwise legitimate batch of two sources', async () => {
    const dest = await createMap(db, atlas.id);
    const src1 = await createMap(db, atlas.id);
    const src2 = await createMap(db, atlas.id);
    const f1 = await createFeature(db, src1.id);
    const f2 = await createFeature(db, src2.id);

    const res = await merge(dest.id, [src1.id, src2.id, src1.id]).expect(200);

    assert.equal(res.body.data.moved.features, 2);
    assert.equal(await featureMap(db, f1.id), dest.id);
    assert.equal(await featureMap(db, f2.id), dest.id);
  });

  it('a genuinely absent source id is STILL a 404 — the dedupe did not widen the check', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);
    const feature = await createFeature(db, src.id);

    const res = await merge(dest.id, [src.id, randomUUID()]);

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.equal(
      await featureMap(db, feature.id), src.id,
      'the refusal happens before any UPDATE, inside the transaction'
    );
  });
});

async function featureMap(db, featureId) {
  const { rows } = await db.query('SELECT map_id FROM features WHERE id = $1', [featureId]);
  return rows[0].map_id;
}
