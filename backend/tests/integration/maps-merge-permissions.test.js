// Path: tests/integration/maps-merge-permissions.test.js
// Item 30: the maps/briefings slice had only ever been exercised at the ENDS of the
// five-level hierarchy (owner, 'write', 'read'). The two levels in the MIDDLE —
// 'comment' (Comentarista) and 'manage' (co-Gestor) — appeared in no test of this
// slice at all, which is the exact shape of the closed-list bug the constitution
// forbids and that has already shipped twice in this repo:
//
//   permission === 'write' || permission === 'owner'    // drops 'manage'
//   ['read', 'write', 'owner'].includes(permission)     // drops 'comment'
//
// Either rewrite leaves maps-merge.test.js, maps-coverage.test.js and
// maps-briefings*.test.js 100% green while the co-Gestor silently loses merge and
// the Comentarista silently loses read.
//
// Every positive case asserts the EFFECT (rows actually re-parented / a body that
// carries the data), never only the status: a 200 that moved nothing must fail too.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createAtlas, createMap, createFeature,
  createBriefing, createSlide, createShare, loginUser,
} from '../helpers/fixtures.js';

describe('maps/briefings authorization across the FIVE permission levels', () => {
  let app, db, owner, atlas, briefing;
  const token = {};

  /** Fresh dest+source pair with one feature in the source, per test. */
  const seedPair = async () => {
    const dest = await createMap(db, atlas.id, { name: `dest ${randomUUID().slice(0, 6)}` });
    const src = await createMap(db, atlas.id, { name: `src ${randomUUID().slice(0, 6)}` });
    const feature = await createFeature(db, src.id);
    return { dest, src, feature };
  };

  const mapIdOf = async (featureId) => {
    const { rows } = await db.query('SELECT map_id FROM features WHERE id = $1', [featureId]);
    return rows[0].map_id;
  };

  const merge = (as, destId, sourceMapIds) => supertest(app)
    .post(`/api/v1/atlas/${atlas.id}/maps/${destId}/merge`)
    .set('Authorization', `Bearer ${token[as]}`)
    .send({ sourceMapIds });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const tag = randomUUID().slice(0, 8);
    owner = await createUser(db, { username: `p30_owner_${tag}` });
    token.owner = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: `P30 ${tag}` });

    // One user per non-owner level, so a closed list cannot hide behind a
    // neighbouring level that happens to pass.
    for (const level of ['read', 'comment', 'write', 'manage']) {
      const user = await createUser(db, { username: `p30_${level}_${tag}` });
      await createShare(db, atlas.id, user.id, level, owner.id);
      token[level] = await loginUser(app, user.username, user.password);
    }

    // A global admin with NO share: permissions.js synthesizes 'owner' for them.
    const admin = await createAdminUser(db, { username: `p30_admin_${tag}` });
    token.admin = await loginUser(app, admin.username, admin.password);

    briefing = await createBriefing(db, atlas.id, { name: `P30 briefing ${tag}` });
    await createSlide(db, briefing.id, { title: 'P30 slide' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('MANAGE can merge (manage=4 >= write=3) and the rows really move', async () => {
    const { dest, src, feature } = await seedPair();

    const res = await merge('manage', dest.id, [src.id]).expect(200);

    assert.equal(res.body.data.moved.features, 1, 'the response claims one feature moved');
    assert.equal(await mapIdOf(feature.id), dest.id, 'and Postgres agrees');
  });

  it('a global ADMIN without any share can merge (owner synthesized by the gate)', async () => {
    const { dest, src, feature } = await seedPair();

    const res = await merge('admin', dest.id, [src.id]).expect(200);

    assert.equal(res.body.data.moved.features, 1);
    assert.equal(await mapIdOf(feature.id), dest.id);
  });

  it('COMMENT can read every maps/briefings GET (comment=2 >= read=1)', async () => {
    const { dest } = await seedPair();
    const auth = { Authorization: `Bearer ${token.comment}` };

    const maps = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/maps`).set(auth).expect(200);
    assert.ok(maps.body.data.some((m) => m.id === dest.id), 'the map list reaches the Comentarista');

    const one = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/maps/${dest.id}`).set(auth).expect(200);
    assert.equal(one.body.data.id, dest.id);

    const briefings = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/briefings`).set(auth).expect(200);
    assert.ok(briefings.body.data.some((b) => b.id === briefing.id));

    const detail = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/briefings/${briefing.id}`).set(auth).expect(200);
    assert.equal(detail.body.data.slides.length, 1, 'slides travel with the briefing');
    assert.equal(detail.body.data.slides[0].title, 'P30 slide');
  });

  it('COMMENT cannot merge — the upper edge of the level (comment=2 < write=3)', async () => {
    const { dest, src, feature } = await seedPair();

    await merge('comment', dest.id, [src.id]).expect(403);

    assert.equal(await mapIdOf(feature.id), src.id, 'a refused merge moves nothing');
  });

  it('READ cannot merge, and nothing moved', async () => {
    const { dest, src, feature } = await seedPair();

    await merge('read', dest.id, [src.id]).expect(403);

    assert.equal(await mapIdOf(feature.id), src.id);
  });

  it('WRITE cannot merge either — merge sits at manage, above the write tier', async () => {
    const { dest, src, feature } = await seedPair();

    await merge('write', dest.id, [src.id]).expect(403);

    assert.equal(await mapIdOf(feature.id), src.id);
  });
});
