// Path: tests/integration/maps-merge.test.js
// Fase 1 Tarefa 6: atomic merge of map sub-entities into a destination map.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createFeature, loginUser } from '../helpers/fixtures.js';

describe('Maps — atomic merge', () => {
  let app, db, owner, token, atlas, dest, src1, src2;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: 'merge_owner' });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Merge Atlas' });
    dest = await createMap(db, atlas.id, { name: 'Destination' });
    src1 = await createMap(db, atlas.id, { name: 'Source 1' });
    src2 = await createMap(db, atlas.id, { name: 'Source 2' });
    await createFeature(db, src1.id, { properties: { name: 'F1' } });
    await createFeature(db, src1.id, { properties: { name: 'F2' } });
    await createFeature(db, src2.id, { properties: { name: 'F3' } });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('moves sub-entities of source maps into the destination', async () => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${dest.id}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceMapIds: [src1.id, src2.id] })
      .expect(200);

    assert.equal(res.body.data.moved.features, 3);

    const inDest = await db.query('SELECT COUNT(*)::int AS n FROM features WHERE map_id = $1', [dest.id]);
    assert.equal(inDest.rows[0].n, 3);

    const leftInSources = await db.query(
      'SELECT COUNT(*)::int AS n FROM features WHERE map_id = ANY($1::uuid[])',
      [[src1.id, src2.id]]
    );
    assert.equal(leftInSources.rows[0].n, 0);
  });

  it('rejects source maps from another atlas (no cross-atlas move)', async () => {
    const otherOwner = await createUser(db, { username: 'merge_other' });
    const otherAtlas = await createAtlas(db, otherOwner.id, { name: 'Other Atlas' });
    const otherMap = await createMap(db, otherAtlas.id, { name: 'Other Map' });
    await createFeature(db, otherMap.id, { properties: { name: 'OtherF' } });

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${dest.id}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceMapIds: [otherMap.id] })
      .expect(404);

    // The other atlas's feature did not move
    const stillThere = await db.query('SELECT COUNT(*)::int AS n FROM features WHERE map_id = $1', [otherMap.id]);
    assert.equal(stillThere.rows[0].n, 1);
  });

  it('requires write permission and a valid body', async () => {
    const reader = await createUser(db, { username: 'merge_reader' });
    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'read', $3)`,
      [atlas.id, reader.id, owner.id]
    );
    const readerToken = await loginUser(app, reader.username, reader.password);

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${dest.id}/merge`)
      .set('Authorization', `Bearer ${readerToken}`)
      .send({ sourceMapIds: [src1.id] })
      .expect(403);

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${dest.id}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceMapIds: ['not-a-uuid'] })
      .expect(422);

    // Unknown destination map -> 404
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${randomUUID()}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceMapIds: [src1.id] })
      .expect(404);
  });
});
