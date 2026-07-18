// Path: tests/integration/maps-coverage.test.js
// Coverage tests for the read-only Maps endpoints, focused on the access-filter
// edges not covered by maps-briefings.test.js (which only exercises owner /
// read-shared / stranger). Maps are GET-only; writes go through sync.
// Genuine gaps asserted here:
//  - a WRITE-shared user (not just a read-shared one) can read maps (list+detail)
//  - REVOKING the share observably flips a 200 read to 403 (no leak after revoke)
//  - the access filter is enforced PER ATLAS: a user shared on atlas A cannot
//    read maps of an unrelated private atlas B (no share leak across atlases)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, loginUser, createShare,
} from '../helpers/fixtures.js';

const uniq = () => `mapc_${randomUUID().slice(0, 8)}`;

describe('Maps — read-access coverage', () => {
  let app, db, owner, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: uniq() });
    atlas = await createAtlas(db, owner.id, { name: `mapc atlas ${uniq()}` });
    map = await createMap(db, atlas.id, { name: 'mapc-map' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('a WRITE-shared user can list and read maps (write satisfies the read filter)', async () => {
    const writer = await createUser(db, { username: uniq() });
    const writerToken = await loginUser(app, writer.username, writer.password);
    await createShare(db, atlas.id, writer.id, 'write', owner.id);

    const list = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/maps`)
      .set('Authorization', `Bearer ${writerToken}`)
      .expect(200);
    assert.ok(list.body.data.some((m) => m.id === map.id));

    const detail = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/maps/${map.id}`)
      .set('Authorization', `Bearer ${writerToken}`)
      .expect(200);
    assert.equal(detail.body.data.id, map.id);
  });

  it('NEGATIVE: revoking a read share flips map reads from 200 to 403 (no leak after revoke)', async () => {
    const reader = await createUser(db, { username: uniq() });
    const readerToken = await loginUser(app, reader.username, reader.password);
    await createShare(db, atlas.id, reader.id, 'read', owner.id);

    // While shared: reads succeed.
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/maps`)
      .set('Authorization', `Bearer ${readerToken}`)
      .expect(200);
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/maps/${map.id}`)
      .set('Authorization', `Bearer ${readerToken}`)
      .expect(200);

    // Revoke the share (what DELETE /sharing/users/:id does under the hood).
    await db.query('DELETE FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2', [atlas.id, reader.id]);

    // NEGATIVE: list and detail are now forbidden.
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/maps`)
      .set('Authorization', `Bearer ${readerToken}`)
      .expect(403);
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/maps/${map.id}`)
      .set('Authorization', `Bearer ${readerToken}`)
      .expect(403);
  });

  it('NEGATIVE: a user shared on atlas A cannot read maps of an unrelated private atlas B (per-atlas filter)', async () => {
    // shared user has access to atlas (A) above.
    const sharedUser = await createUser(db, { username: uniq() });
    const sharedToken = await loginUser(app, sharedUser.username, sharedUser.password);
    await createShare(db, atlas.id, sharedUser.id, 'read', owner.id);

    // Sanity: they can read A.
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/maps`)
      .set('Authorization', `Bearer ${sharedToken}`)
      .expect(200);

    // A separate owner's private atlas B with its own map.
    const ownerB = await createUser(db, { username: uniq() });
    const atlasB = await createAtlas(db, ownerB.id, { name: `mapc atlasB ${uniq()}` });
    const mapB = await createMap(db, atlasB.id, { name: 'mapc-mapB' });

    // NEGATIVE: the share on A confers nothing on B.
    await supertest(app)
      .get(`/api/v1/atlas/${atlasB.id}/maps`)
      .set('Authorization', `Bearer ${sharedToken}`)
      .expect(403);
    await supertest(app)
      .get(`/api/v1/atlas/${atlasB.id}/maps/${mapB.id}`)
      .set('Authorization', `Bearer ${sharedToken}`)
      .expect(403);
  });

  it('NEGATIVE: a logged-in stranger (no share) cannot read maps and the response leaks nothing', async () => {
    const stranger = await createUser(db, { username: uniq() });
    const strangerToken = await loginUser(app, stranger.username, stranger.password);

    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/maps`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(403);

    // The forbidden body must not carry map data.
    assert.ok(!res.body.data, 'no data leaked in a 403');
  });
});
