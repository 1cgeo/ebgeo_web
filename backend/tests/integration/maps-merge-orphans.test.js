// Path: tests/integration/maps-merge-orphans.test.js
// Items 109 and 111 — what the merge does NOT move, and how it counts its inputs.
//
// 109. MAP_CHILD_TABLES (maps.service.js:21-28) is a literal whitelist of six tables.
//      `comments` has map_id NOT NULL REFERENCES maps(id) plus version + deleted_at —
//      the same shape as the six — and is NOT in the list. merge-01
//      (maps-briefings-gaps.test.js) asserts the COUNT under each of the six keys but
//      never that the key set IS those six, so adding or dropping a table passes green.
//      The test below pins the SET, so the day someone edits the whitelist the decision
//      has to be made on purpose. It also pins the observable consequence for comments,
//      group_features, features.layer_id and slides.map_id — named as characterization,
//      not endorsed as correct.
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

// The six tables mergeMaps re-parents, sorted. Kept as a literal here on purpose:
// importing MAP_CHILD_TABLES and comparing it to itself would be a tautology, the
// same empty-coverage shape this file exists to close.
const MERGED_TABLES = [
  'catalog_layers', 'cesium3d_data', 'features', 'groups', 'layers', 'streetview360_data',
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

  it('`moved` reports exactly the six whitelisted tables — not five, not seven', async () => {
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

  it('CHARACTERIZATION: a spatial comment does NOT follow its feature to the destination', async () => {
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

    await merge(dest.id, [src.id]).expect(200);

    const { rows } = await db.query(
      'SELECT id, map_id FROM comments WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[root.id, reply.id]]
    );
    assert.equal(rows.length, 2, 'both comment rows survive the merge');
    assert.equal(await featureMap(db, feature.id), dest.id, 'the feature DID move');
    for (const row of rows) {
      assert.equal(
        row.map_id, src.id,
        'known debt: comments stay on the emptied source map, so the pin disappears '
        + 'from the destination view. `comments` is not in MAP_CHILD_TABLES.'
      );
    }
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
