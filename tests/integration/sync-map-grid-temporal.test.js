// Path: tests/integration/sync-map-grid-temporal.test.js
// Fase 1 Tarefas 3 & 5: gridStyle (maps.grid_style) and mapTemporal
// (maps.temporal_config) persist and appear in the snapshot.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('Sync — gridStyle & mapTemporal', () => {
  let app, db, owner, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: 'gridtemp_owner' });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Grid/Temporal Atlas' });
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (entityType, data) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        operations: [{
          id: randomUUID(),
          entityType,
          operationType: 'update',
          entityId: map.id,
          mapId: map.id,
          data,
          timestamp: Date.now(),
          clientId: 'c1',
        }],
      })
      .expect(200);

  it('persists gridStyle to maps.grid_style and into the snapshot', async () => {
    await push('gridStyle', { format: 'utm', visible: true });

    const { rows } = await db.query('SELECT grid_style FROM maps WHERE id = $1', [map.id]);
    assert.deepEqual(rows[0].grid_style, { format: 'utm', visible: true });

    const snap = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const snapMap = snap.body.data.snapshot.maps.find((m) => m.id === map.id);
    assert.deepEqual(snapMap.grid_style, { format: 'utm', visible: true });
  });

  it('persists mapTemporal to maps.temporal_config', async () => {
    await push('mapTemporal', {
      ativo: true,
      unidade: 'HORA',
      inicio: 1000,
      fim: 2000,
      modo: 'absoluto',
      origem: null,
    });

    const { rows } = await db.query('SELECT temporal_config FROM maps WHERE id = $1', [map.id]);
    assert.equal(rows[0].temporal_config.ativo, true);
    assert.equal(rows[0].temporal_config.unidade, 'HORA');
    assert.equal(rows[0].temporal_config.inicio, 1000);
    assert.equal(rows[0].temporal_config.modo, 'absoluto');
  });
});
