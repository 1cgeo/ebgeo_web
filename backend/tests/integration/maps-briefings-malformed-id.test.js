// Path: tests/integration/maps-briefings-malformed-id.test.js
// Item 167. None of the four GET routes of the maps/briefings slice validates
// :mapId/:briefingId with Joi (maps.routes.js:13-14, briefings.routes.js:10-11), so
// the raw string reaches Postgres inside FIND_MAP_BY_ID / FIND_BRIEFING_BY_ID and the
// only thing standing between the caller and a 500 with driver text is one entry of
// PG_ERROR_MAP ('22P02' -> 400, error-handler.js). That entry is an INVISIBLE
// dependency from inside this module: delete it and all four routes start leaking
// 500s while every existing test of the slice stays green.
//
// The last case pins the ordering that makes the 400 safe: authorization decides
// BEFORE the malformed id is parsed, so a clean 400 never becomes an existence oracle
// for someone who has no access.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createBriefing, loginUser } from '../helpers/fixtures.js';

// Fragments the driver emits and the handler promises never to forward.
const DRIVER_LEAKS = ['invalid input syntax', 'uuid', 'map_id', 'briefing_id', 'SELECT'];

describe('malformed :mapId / :briefingId is a clean 4xx, never a raw 500', () => {
  let app, db, owner, ownerToken, stranger, strangerToken, atlas;

  const assertCleanBadRequest = (res) => {
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    const message = String(res.body.error.message);
    for (const leak of DRIVER_LEAKS) {
      assert.ok(
        !message.toLowerCase().includes(leak.toLowerCase()),
        `the response must not echo driver/schema text, found "${leak}" in: ${message}`
      );
    }
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const tag = randomUUID().slice(0, 8);
    owner = await createUser(db, { username: `p167_owner_${tag}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    stranger = await createUser(db, { username: `p167_stranger_${tag}` });
    strangerToken = await loginUser(app, stranger.username, stranger.password);

    atlas = await createAtlas(db, owner.id, { name: `P167 ${tag}` });
    await createMap(db, atlas.id);
    await createBriefing(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('GET /maps/not-a-uuid -> 400 BAD_REQUEST with a generic message', async () => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/maps/not-a-uuid`)
      .set('Authorization', `Bearer ${ownerToken}`);

    assertCleanBadRequest(res);
  });

  it('GET /briefings/not-a-uuid -> 400 BAD_REQUEST with a generic message', async () => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/briefings/not-a-uuid`)
      .set('Authorization', `Bearer ${ownerToken}`);

    assertCleanBadRequest(res);
  });

  it('a malformed :atlasId is caught by the permission gate, before any module query', async () => {
    const maps = await supertest(app)
      .get('/api/v1/atlas/not-a-uuid/maps')
      .set('Authorization', `Bearer ${ownerToken}`);
    assertCleanBadRequest(maps);

    const briefings = await supertest(app)
      .get('/api/v1/atlas/not-a-uuid/briefings')
      .set('Authorization', `Bearer ${ownerToken}`);
    assertCleanBadRequest(briefings);
  });

  it('authorization runs FIRST: a stranger gets 404 even with a malformed id', async () => {
    // The stranger holds no share on this atlas, so the gate answers 404 (the escada of
    // requireAtlasPermission, 2026-07-25). Two things are pinned at once: a 400 here
    // would confirm the atlas exists to an outsider, and so would a 403 — the reply must
    // be the SAME one a nonexistent atlas gets, asserted below rather than assumed.
    const outroAtlas = randomUUID();

    const map = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/maps/not-a-uuid`)
      .set('Authorization', `Bearer ${strangerToken}`);
    assert.equal(map.status, 404, 'a 400 here would confirm the atlas exists to an outsider');

    const briefing = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/briefings/not-a-uuid`)
      .set('Authorization', `Bearer ${strangerToken}`);
    assert.equal(briefing.status, 404);

    const mapInexistente = await supertest(app)
      .get(`/api/v1/atlas/${outroAtlas}/maps/not-a-uuid`)
      .set('Authorization', `Bearer ${strangerToken}`);
    assert.equal(mapInexistente.status, 404);
    // Anti-vacuity anchor: two bodies without an `error` field would compare equal.
    assert.equal(map.body.error.code, 'NOT_FOUND');
    assert.equal(map.body.error.code, mapInexistente.body.error.code);
    assert.equal(map.body.error.message, mapInexistente.body.error.message);
  });
});
