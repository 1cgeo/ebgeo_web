// Path: tests/integration/atlas-clone-ordem.repro.test.js
// Copying an atlas must preserve the user's explicit map and slide order, not SQL row order.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createBriefing, createSlide, loginUser } from '../helpers/fixtures.js';

describe('atlas copy keeps explicit ordering', () => {
  let app, db, owner, token;
  before(async () => {
    ({ app, db } = await setupTestEnv());
    owner = await createUser(db);
    token = await loginUser(app, owner.username, owner.password);
  });
  after(async () => { await teardownTestEnv(db); });

  async function clone(id) {
    const response = await supertest(app).post(`/api/v1/atlas/${id}/clone`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    return response.body.data.id;
  }

  it('map order follows the source, omits stale entries and appends unlisted maps once', async () => {
    const atlas = await createAtlas(db, owner.id);
    const a = await createMap(db, atlas.id, { name: 'A' });
    const b = await createMap(db, atlas.id, { name: 'B' });
    await createMap(db, atlas.id, { name: 'C' });
    await db.query('UPDATE atlas SET map_order=$2 WHERE id=$1', [atlas.id, [b.id, a.id, randomUUID(), b.id]]);
    const id = await clone(atlas.id);
    const { rows } = await db.query(`SELECT m.name FROM atlas a
      CROSS JOIN LATERAL unnest(a.map_order) WITH ORDINALITY AS o(id, rank)
      JOIN maps m ON m.id=o.id WHERE a.id=$1 ORDER BY o.rank`, [id]);
    assert.deepEqual(rows.map(row => row.name), ['B', 'A', 'C']);
  });

  it('each briefing keeps its slide sequence and remaps slide map references', async () => {
    const atlas = await createAtlas(db, owner.id);
    const map = await createMap(db, atlas.id, { name: 'Contexto' });
    const briefing = await createBriefing(db, atlas.id);
    const a = await createSlide(db, briefing.id, { title: 'A', map_id: map.id });
    const b = await createSlide(db, briefing.id, { title: 'B', map_id: map.id });
    const c = await createSlide(db, briefing.id, { title: 'C', map_id: map.id });
    // Two different permutations of the SAME rows: unordered SQL cannot pass by
    // accidentally returning one of the requested orders on this database layout.
    for (const order of [[c, a, b], [b, c, a]]) {
      await db.query('UPDATE briefings SET slide_order=$2 WHERE id=$1', [briefing.id, order.map(slide => slide.id)]);
      const id = await clone(atlas.id);
      const { rows } = await db.query(`SELECT s.title, m.name AS map_name, m.atlas_id FROM briefings b
        CROSS JOIN LATERAL unnest(b.slide_order) WITH ORDINALITY AS o(id, rank)
        JOIN slides s ON s.id=o.id JOIN maps m ON m.id=s.map_id WHERE b.atlas_id=$1 ORDER BY o.rank`, [id]);
      assert.deepEqual(rows.map(row => row.title), order.map(slide => slide.title));
      assert.ok(rows.every(row => row.map_name === 'Contexto' && row.atlas_id === id));
    }
  });
});
