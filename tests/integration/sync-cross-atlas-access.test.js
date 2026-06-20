// Path: tests/integration/sync-cross-atlas-access.test.js
// Negative access tests: a user with write permission on atlas A must NOT be able
// to mutate slide / group_feature entities that belong to atlas B by pushing sync
// operations to atlas A's endpoint (cross-atlas IDOR via the shared UUID space).
// Slides are scoped through their parent briefing; group_features through the
// group's map — both must resolve to the route's atlas or the write is dropped.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createGroup, createFeature,
  createBriefing, createSlide, loginUser,
} from '../helpers/fixtures.js';

describe('Sync cross-atlas access (negative)', () => {
  let app, db;
  let userA, tokenA, atlasA;
  let atlasB, mapB, briefingB, slideB, groupB, featureB;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    userA = await createUser(db, { username: 'cross_atlas_attacker' });
    tokenA = await loginUser(app, userA.username, userA.password);
    atlasA = await createAtlas(db, userA.id);

    // Victim atlas owned by a different user.
    const userB = await createUser(db, { username: 'cross_atlas_victim' });
    atlasB = await createAtlas(db, userB.id);
    mapB = await createMap(db, atlasB.id);
    briefingB = await createBriefing(db, atlasB.id, { name: 'Victim Briefing' });
    slideB = await createSlide(db, briefingB.id, { title: 'Victim Slide' });
    groupB = await createGroup(db, mapB.id);
    featureB = await createFeature(db, mapB.id);
    await db.query(
      'INSERT INTO group_features (group_id, feature_id) VALUES ($1, $2)',
      [groupB.id, featureB.id]
    );
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  function pushToAtlasA(operations) {
    return supertest(app)
      .post(`/api/v1/atlas/${atlasA.id}/sync`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ operations });
  }

  it('cannot UPDATE a slide of another atlas', async () => {
    await pushToAtlasA([{
      id: randomUUID(), type: 'update', target: 'slide', targetId: slideB.id,
      changes: { title: 'HACKED' }, timestamp: Date.now(), clientId: 'attacker',
    }]).expect(200);

    const { rows } = await db.query('SELECT title FROM slides WHERE id = $1', [slideB.id]);
    assert.equal(rows[0].title, 'Victim Slide', 'slide of atlas B must be untouched');
  });

  it('cannot soft-DELETE a slide of another atlas', async () => {
    await pushToAtlasA([{
      id: randomUUID(), type: 'delete', target: 'slide', targetId: slideB.id,
      timestamp: Date.now(), clientId: 'attacker',
    }]).expect(200);

    const { rows } = await db.query('SELECT deleted_at FROM slides WHERE id = $1', [slideB.id]);
    assert.equal(rows[0].deleted_at, null, 'slide of atlas B must not be deleted');
  });

  it('cannot CREATE a slide attached to another atlas briefing', async () => {
    const slideId = randomUUID();
    await pushToAtlasA([{
      id: randomUUID(), type: 'create', target: 'slide', targetId: slideId,
      data: { briefing_id: briefingB.id, title: 'Injected', mode: '2d' },
      timestamp: Date.now(), clientId: 'attacker',
    }]).expect(200);

    const { rows } = await db.query('SELECT id FROM slides WHERE id = $1', [slideId]);
    assert.equal(rows.length, 0, 'slide must not be created against a cross-atlas briefing');
  });

  it('cannot DELETE a group_feature link of another atlas', async () => {
    await pushToAtlasA([{
      id: randomUUID(), type: 'delete', target: 'group_feature', targetId: randomUUID(),
      mapId: mapB.id, data: { group_id: groupB.id, feature_id: featureB.id },
      timestamp: Date.now(), clientId: 'attacker',
    }]).expect(200);

    const { rows } = await db.query(
      'SELECT 1 FROM group_features WHERE group_id = $1 AND feature_id = $2',
      [groupB.id, featureB.id]
    );
    assert.equal(rows.length, 1, 'group_feature link of atlas B must survive');
  });

  it('cannot CREATE a group_feature link across atlases', async () => {
    const group2 = await createGroup(db, mapB.id);
    const feature2 = await createFeature(db, mapB.id);

    await pushToAtlasA([{
      id: randomUUID(), type: 'create', target: 'group_feature', targetId: randomUUID(),
      mapId: mapB.id, data: { group_id: group2.id, feature_id: feature2.id },
      timestamp: Date.now(), clientId: 'attacker',
    }]).expect(200);

    const { rows } = await db.query(
      'SELECT 1 FROM group_features WHERE group_id = $1 AND feature_id = $2',
      [group2.id, feature2.id]
    );
    assert.equal(rows.length, 0, 'cross-atlas group_feature link must not be created');
  });

  it('POSITIVE control: owner can still update a slide in their OWN atlas', async () => {
    const briefingA = await createBriefing(db, atlasA.id, { name: 'Own Briefing' });
    const slideA = await createSlide(db, briefingA.id, { title: 'Own Slide' });

    await pushToAtlasA([{
      id: randomUUID(), type: 'update', target: 'slide', targetId: slideA.id,
      changes: { title: 'Own Slide Renamed' }, timestamp: Date.now(), clientId: 'owner',
    }]).expect(200);

    const { rows } = await db.query('SELECT title FROM slides WHERE id = $1', [slideA.id]);
    assert.equal(rows[0].title, 'Own Slide Renamed', 'same-atlas update must still work');
  });
});
