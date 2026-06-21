// Path: tests/integration/sync-atlas-settings-app-state.test.js
// datamodel-13/14: app-level state that used to be local-only (mapBadgeColors,
// colorUsage, customIcons) now syncs through the SAME `setting` op + whitelist as
// terrainExaggeration, shallow-merged into atlas.settings and round-tripped in the
// snapshot. The payload SHAPE here mirrors exactly what the frontend logger emits
// (logSettingOperation puts the patch in `data`):
//   - mapBadgeColors → data: { mapBadgeColors: { [mapName]: color } }  (full object)
//   - colorUsage     → data: { colorUsage: { [mapName]: { color: count } } }  (per-map)
//   - customIcons    → data: { customIcons: [ { id, name, ... } ] }    (full registry)
// Resource-availability keys (features/basemaps/...) MUST stay rejected. An editor
// (write share) may do it (§24.8 is editor-allowed, not owner-only).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';

describe('Sync atlas-level app-state settings (datamodel-13/14)', () => {
  let app, db, owner, editor, ownerTok, editorTok, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: 'appstate_owner' });
    editor = await createUser(db, { username: 'appstate_editor' });
    ownerTok = await loginUser(app, owner.username, owner.password);
    editorTok = await loginUser(app, editor.username, editor.password);
    atlas = await createAtlas(db, owner.id);
    await createShare(db, atlas.id, editor.id, 'write', owner.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // Mirrors the frontend logger output: logSettingOperation(UPDATE, atlasId, patch)
  // puts the whitelisted patch in `data`.
  const pushSetting = (token, data) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [{
        id: randomUUID(), entityType: 'setting', operationType: 'update',
        entityId: atlas.id, data, timestamp: Date.now(), clientId: 's-client',
      }] });

  const settings = async () => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .expect(200);
    return res.body.data.snapshot.atlas.settings;
  };

  it('datamodel-13: merges mapBadgeColors (full map→color object) into atlas.settings and round-trips', async () => {
    const mapBadgeColors = { Alfa: '#3b82f6', Bravo: '#f59e0b' };
    await pushSetting(ownerTok, { mapBadgeColors }).expect(200);
    const s = await settings();
    assert.deepEqual(s.mapBadgeColors, mapBadgeColors, 'mapBadgeColors persisted and surfaced in snapshot');
  });

  it('datamodel-13: a later mapBadgeColors write accumulates (deep-merge, does not clobber siblings)', async () => {
    await pushSetting(ownerTok, { mapBadgeColors: { Charlie: '#10b981' } }).expect(200);
    const s = await settings();
    assert.equal(s.mapBadgeColors.Alfa, '#3b82f6', 'existing map color preserved');
    assert.equal(s.mapBadgeColors.Charlie, '#10b981', 'new map color added');
  });

  it('datamodel-13: merges colorUsage as a per-map nested object ({ [mapName]: counts }) and accumulates', async () => {
    await pushSetting(ownerTok, { colorUsage: { Alfa: { '#ff0000': 3, '#00ff00': 1 } } }).expect(200);
    await pushSetting(ownerTok, { colorUsage: { Bravo: { '#0000ff': 5 } } }).expect(200);
    const s = await settings();
    assert.deepEqual(s.colorUsage.Alfa, { '#ff0000': 3, '#00ff00': 1 }, 'Alfa color usage persisted');
    assert.deepEqual(s.colorUsage.Bravo, { '#0000ff': 5 }, 'Bravo color usage accumulated (sibling not clobbered)');
  });

  it('datamodel-14: merges customIcons (the icon registry list) into atlas.settings and round-trips', async () => {
    const customIcons = [
      { id: 'icon-1', name: 'Tank', thumbnail: 'data:img', type: 'image/png', createdAt: 1718900000000 },
      { id: 'icon-2', name: 'Jet', thumbnail: 'data:img2', type: 'image/png', createdAt: 1718900000001 },
    ];
    await pushSetting(ownerTok, { customIcons }).expect(200);
    const s = await settings();
    assert.deepEqual(s.customIcons, customIcons, 'customIcons registry persisted and surfaced in snapshot');
  });

  it('datamodel-14: customIcons is replaced wholesale (a list, not deep-merged)', async () => {
    await pushSetting(ownerTok, { customIcons: [{ id: 'icon-9', name: 'Only', type: 'image/png', createdAt: 1 }] }).expect(200);
    const s = await settings();
    assert.equal(s.customIcons.length, 1, 'registry list replaced, not merged');
    assert.equal(s.customIcons[0].id, 'icon-9');
  });

  it('NEGATIVE: a resource-availability key (basemaps/features) is NOT merged', async () => {
    await pushSetting(ownerTok, {
      mapBadgeColors: { Delta: '#ec4899' },
      basemaps: ['evil'],
      features: { map_3d: false },
      malicious: 'x',
    }).expect(200);
    const s = await settings();
    assert.equal(s.mapBadgeColors.Delta, '#ec4899', 'whitelisted key rode along fine');
    assert.deepEqual(s.basemaps, [], 'resource key (basemaps) NOT overwritten — default [] preserved');
    assert.deepEqual(s.features, { map_3d: true, panoramic_images: true, terrain_3d: true },
      'resource key (features) NOT overwritten — default preserved');
    assert.ok(!('malicious' in s), 'non-whitelisted key dropped');
  });

  it('a write-share editor can sync app-state settings (§24.8 is editor-allowed)', async () => {
    await pushSetting(editorTok, { mapBadgeColors: { Echo: '#84cc16' } }).expect(200);
    const s = await settings();
    assert.equal(s.mapBadgeColors.Echo, '#84cc16');
  });
});
