// Path: tests/integration/sync-atlas-settings.test.js
// §24.8 atlas-level setting (terrainExaggeration): a `setting` update op merges a
// WHITELISTED patch into atlas.settings and surfaces in the snapshot. Non-whitelisted
// keys (incl. resource-availability keys) are DROPPED. An editor (write share) may do
// it (§24.8 is 🟡, not owner-only). Previously this op was a silent no-op false-success.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';

describe('Sync atlas-level setting (§24.8 terrainExaggeration)', () => {
  let app, db, owner, editor, ownerTok, editorTok, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: 'settings_owner' });
    editor = await createUser(db, { username: 'settings_editor' });
    ownerTok = await loginUser(app, owner.username, owner.password);
    editorTok = await loginUser(app, editor.username, editor.password);
    atlas = await createAtlas(db, owner.id);
    await createShare(db, atlas.id, editor.id, 'write', owner.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

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

  it('merges terrainExaggeration into atlas.settings and DROPS non-whitelisted keys', async () => {
    await pushSetting(ownerTok, { terrainExaggeration: 2.5, basemaps: ['evil'], malicious: 'x' }).expect(200);
    const s = await settings();
    assert.equal(s.terrainExaggeration, 2.5, 'terrainExaggeration merged');
    assert.ok(!('malicious' in s), 'non-whitelisted key dropped');
    assert.deepEqual(s.basemaps, [], 'resource key (basemaps) NOT overwritten — default preserved');
  });

  it('a write-share editor can update terrainExaggeration (§24.8 is editor-allowed)', async () => {
    await pushSetting(editorTok, { terrainExaggeration: 3 }).expect(200);
    const s = await settings();
    assert.equal(s.terrainExaggeration, 3);
  });
});
