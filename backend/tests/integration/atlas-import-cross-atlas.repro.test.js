// Path: tests/integration/atlas-import-cross-atlas.repro.test.js
// Regression: POST /atlas/import let any authenticated user write into somebody
// else's atlas.
//
// The import loops inserted client-supplied foreign keys verbatim — `gf.group_id` /
// `gf.feature_id` (atlas.service.js:667-674), `group.parent_id` (:643) and
// `slide.map_id` (:743) — without checking they belong to the atlas being imported.
// The only barrier was the FK constraint, which requires the referenced row to EXIST,
// not to be yours.
//
// The sibling function does it correctly: `cloneMapSubEntities` (:230-236) filters
// group-feature pairs through `groupIdMapping[...] && featureIdMapping[...]`, so only
// entities created by that same operation can be linked. The import path simply never
// got that guard.
//
// The write is observable BY THE VICTIM, which is what makes it more than
// tidiness: `GET_GROUP_FEATURES` (sync.queries.js:87-92) joins
// `groups g ON g.id = gf.group_id WHERE g.map_id = $1`, so the injected row comes back
// in the victim's own snapshot and the feature appears inside the attacker's chosen
// group. A user with 'read' on a shared or public atlas already knows those UUIDs from
// the snapshot they are entitled to, so the precondition is ordinary access.
//
// The route requires only `auth` and no `requireAtlasPermission` — correctly, since it
// creates a NEW atlas. That is exactly why the payload's references have to be
// constrained to the payload itself: there is no atlas-scoped gate to lean on.
//
// Negative control: drop the id-set filters and the first three tests fail.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createFeature, loginUser,
} from '../helpers/fixtures.js';

describe('atlas import cannot reference another atlas entities (repro)', () => {
  let app, db, attackerTok;
  let victimMap, victimGroupId, victimFeature;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const victim = await createUser(db, { username: `imp_vic_${randomUUID().slice(0, 8)}` });
    const attacker = await createUser(db, { username: `imp_atk_${randomUUID().slice(0, 8)}` });
    attackerTok = await loginUser(app, attacker.username, attacker.password);

    const victimAtlas = await createAtlas(db, victim.id, { name: 'Atlas da Vítima' });
    victimMap = await createMap(db, victimAtlas.id, { name: 'Mapa da Vítima' });
    victimFeature = await createFeature(db, victimMap.id);

    victimGroupId = randomUUID();
    await db.query(
      `INSERT INTO groups (id, map_id, name, visible, locked, style)
       VALUES ($1, $2, 'Grupo da Vítima', true, false, '{}'::jsonb)`,
      [victimGroupId, victimMap.id]
    );
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const importAtlas = (payload) =>
    supertest(app)
      .post('/api/v1/atlas/import')
      .set('Authorization', `Bearer ${attackerTok}`)
      .send(payload);

  /** A minimal, otherwise-valid import payload with one map. */
  const withMap = (mapExtra) => ({
    atlas: { name: `Importado ${randomUUID().slice(0, 6)}` },
    maps: [{ id: randomUUID(), name: 'mapa', ...mapExtra }],
  });

  it('does not link a foreign group to a foreign feature', async () => {
    const res = await importAtlas(withMap({
      groupFeatures: [{ group_id: victimGroupId, feature_id: victimFeature.id }],
    }));
    assert.ok(res.status < 500, `should not blow up, got ${res.status}`);

    const { rows } = await db.query(
      'SELECT 1 FROM group_features WHERE group_id = $1 AND feature_id = $2',
      [victimGroupId, victimFeature.id]
    );
    assert.equal(rows.length, 0, 'no row was written into the victim atlas');
  });

  it('the victim snapshot is unchanged — the write was observable there', async () => {
    // The mechanism that made this a real defect rather than sloppiness: the injected
    // row surfaces in the victim's own snapshot via GET_GROUP_FEATURES.
    const { rows } = await db.query(
      `SELECT gf.feature_id FROM group_features gf
       JOIN groups g ON g.id = gf.group_id
       WHERE g.map_id = $1`,
      [victimMap.id]
    );
    assert.equal(rows.length, 0, 'the victim map has no group memberships it did not create');
  });

  it('does not parent an imported group under a foreign group', async () => {
    const newGroupId = randomUUID();
    await importAtlas(withMap({
      groups: [{ id: newGroupId, name: 'meu grupo', parent_id: victimGroupId }],
    }));

    const { rows } = await db.query('SELECT parent_id FROM groups WHERE id = $1', [newGroupId]);
    assert.equal(rows.length, 1, 'the group IS imported (the defense is on parent_id, not on dropping the row)');
    assert.notEqual(
      rows[0].parent_id, victimGroupId,
      'an imported group must not hang off a group in someone else atlas'
    );
  });

  it('does not point an imported slide at a foreign map', async () => {
    const briefingId = randomUUID();
    const slideId = randomUUID();
    await importAtlas({
      atlas: { name: `Importado ${randomUUID().slice(0, 6)}` },
      maps: [{ id: randomUUID(), name: 'mapa' }],
      briefings: [{
        id: briefingId,
        name: 'briefing',
        slides: [{ id: slideId, title: 'slide', map_id: victimMap.id }],
      }],
    });

    const { rows } = await db.query('SELECT map_id FROM slides WHERE id = $1', [slideId]);
    assert.equal(rows.length, 1, 'the slide IS imported (the defense is on map_id, not on dropping the row)');
    assert.notEqual(rows[0].map_id, victimMap.id, 'a slide must not reference a foreign map');
  });

  // ---- the feature must keep working for legitimate payloads ----

  it('still imports group-feature links declared WITHIN the same payload', async () => {
    const mapId = randomUUID();
    const groupId = randomUUID();
    const featureId = randomUUID();

    const res = await importAtlas({
      atlas: { name: `Legítimo ${randomUUID().slice(0, 6)}` },
      maps: [{
        id: mapId,
        name: 'mapa',
        groups: [{ id: groupId, name: 'grupo' }],
        features: [{
          id: featureId,
          feature_type: 'point',
          geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
          properties: { id: featureId, nome: 'ponto' },
        }],
        groupFeatures: [{ group_id: groupId, feature_id: featureId }],
      }],
    }).expect(201);
    assert.ok(res.body.data, 'the import succeeds');

    const { rows } = await db.query(
      'SELECT 1 FROM group_features WHERE group_id = $1 AND feature_id = $2',
      [groupId, featureId]
    );
    assert.equal(rows.length, 1, 'a self-consistent payload still links its own entities');
  });

  it('still nests groups declared within the same payload', async () => {
    const mapId = randomUUID();
    const parentId = randomUUID();
    const childId = randomUUID();

    await importAtlas({
      atlas: { name: `Legítimo ${randomUUID().slice(0, 6)}` },
      maps: [{
        id: mapId,
        name: 'mapa',
        groups: [
          { id: parentId, name: 'pai' },
          { id: childId, name: 'filho', parent_id: parentId },
        ],
      }],
    }).expect(201);

    const { rows } = await db.query('SELECT parent_id FROM groups WHERE id = $1', [childId]);
    assert.equal(rows[0].parent_id, parentId, 'legitimate nesting survives the guard');
  });
});
