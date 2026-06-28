// Path: tests/integration/config-admin.test.js
// F4: admin system-config overrides. The STATIC/ENV parts of GET /api/v1/config (app/features/
// map2d/map3d/service URLs) have no `resources` row; an admin edits them via PUT /config/admin,
// which stores a partial override that getAppConfig deep-merges OVER the assembled payload (admin
// wins). A partial save merges into the stored document (never wipes untouched sections).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('Config — admin overrides (F4)', () => {
  let app, db, adminTok, userTok;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db);
    const user = await createUser(db);
    adminTok = await loginUser(app, admin.username, admin.password);
    userTok = await loginUser(app, user.username, user.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('GET/PUT /config/admin require a GLOBAL admin (403 for a regular user)', async () => {
    await supertest(app)
      .get('/api/v1/config/admin')
      .set('Authorization', `Bearer ${userTok}`)
      .expect(403);
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${userTok}`)
      .send({ app: { title: 'Hack' } })
      .expect(403);
  });

  it('an override wins over the STATIC default in the public GET /config', async () => {
    // Baseline: the static app.title.
    const before = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(before.body.data.app.title, 'EBGeo');

    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ app: { title: 'Meu EBGeo' } })
      .expect(200);

    const after = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(after.body.data.app.title, 'Meu EBGeo');

    // The admin read echoes the stored override (prefills the editor).
    const adminView = await supertest(app)
      .get('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    assert.equal(adminView.body.data.overrides.app.title, 'Meu EBGeo');
    assert.equal(adminView.body.data.effective.app.title, 'Meu EBGeo');
  });

  it('a partial save MERGES into the stored overrides (untouched sections survive)', async () => {
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ features: { grid: true } })
      .expect(200);

    const cfg = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(cfg.body.data.features.grid, true);
    // The earlier app.title override must still be there (the merge did not wipe it).
    assert.equal(cfg.body.data.app.title, 'Meu EBGeo');
  });

  it('validation rejects bad types, unknown keys, and empty payloads (422)', async () => {
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ map2d: { maxZoom: 'not-a-number' } })
      .expect(422);
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ bogusSection: { x: 1 } })
      .expect(422);
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({})
      .expect(422);
  });

  it('allows ADVANCED overrides for keys with no form field (everything is configurable)', async () => {
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({
        map3d: { initialCamera: { longitude: -44, latitude: -22, height: 500 } },
        streetView360: { serviceUrl: '/custom-360' },
        map2d: { terrainSource: { type: 'raster-dem', tiles: ['/x/{z}/{x}/{y}'] } },
      })
      .expect(200);
    const cfg = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(cfg.body.data.map3d.initialCamera.height, 500);
    assert.equal(cfg.body.data.streetView360.serviceUrl, '/custom-360');
    assert.deepEqual(cfg.body.data.map2d.terrainSource.tiles, ['/x/{z}/{x}/{y}']);
  });

  it('a basemap resource config.style overrides the static basemapStyles (F6)', async () => {
    const style = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background' }] };
    await supertest(app)
      .post('/api/v1/basemaps')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ id: 'bm-custom', name: 'Custom BM', config: { enabled: true, priority: 9, style } })
      .expect(201);

    const cfg = await supertest(app).get('/api/v1/config').expect(200);
    // The style is emitted in basemapStyles, and stripped from the basemaps metadata.
    assert.deepEqual(cfg.body.data.basemapStyles['bm-custom'], style);
    assert.equal(cfg.body.data.basemaps['bm-custom'].style, undefined);
    assert.equal(cfg.body.data.basemaps['bm-custom'].priority, 9);
  });

  it('rejects map2d.minZoom greater than maxZoom (cross-field validation)', async () => {
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ map2d: { minZoom: 20, maxZoom: 5 } })
      .expect(422);
  });

  // Runs LAST: clears ALL overrides set by the tests above.
  it('DELETE /config/admin clears all overrides (revert to STATIC default)', async () => {
    await supertest(app)
      .put('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ app: { title: 'Temporário' } })
      .expect(200);
    let cfg = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(cfg.body.data.app.title, 'Temporário');

    await supertest(app)
      .delete('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);

    cfg = await supertest(app).get('/api/v1/config').expect(200);
    assert.equal(cfg.body.data.app.title, 'EBGeo'); // back to the STATIC default
  });
});
