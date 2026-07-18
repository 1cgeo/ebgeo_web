// Path: tests/integration/atlas-config-authz.test.js
// Atlas configuration (PATCH /settings) and sharing (/sharing/*) are a co-Gestor ('manage')
// capability — NOT owner-only. permissions.test.js / sharing.test.js exercise the POSITIVES
// only via the OWNER and the NEGATIVES only via a WRITER. This pins the under-tested tiers:
//   - a non-owner MANAGE user (promoted co-Gestor) CAN change settings + manage sharing, but
//     still CANNOT delete the atlas (manage < owner — the owner-only boundary);
//   - a COMMENT-tier user is blocked from settings + sharing (only `write` was covered before).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';

describe('Atlas config & sharing — manage-tier authorization', () => {
  let app, db;
  let owner, manager, commenter, target;
  let managerToken, commenterToken;
  let atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    owner = await createUser(db, { username: `cfg_owner_${randomUUID().slice(0, 6)}` });
    manager = await createUser(db, { username: `cfg_manager_${randomUUID().slice(0, 6)}` });
    commenter = await createUser(db, { username: `cfg_commenter_${randomUUID().slice(0, 6)}` });
    target = await createUser(db, { username: `cfg_target_${randomUUID().slice(0, 6)}` });

    managerToken = await loginUser(app, manager.username, manager.password);
    commenterToken = await loginUser(app, commenter.username, commenter.password);

    atlas = await createAtlas(db, owner.id, { name: 'Config Authz Atlas' });
    await createMap(db, atlas.id);
    await createShare(db, atlas.id, manager.id, 'manage', owner.id);
    await createShare(db, atlas.id, commenter.id, 'comment', owner.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ── manage tier (non-owner co-Gestor): positive ──
  it('a MANAGE user (non-owner) can change atlas settings', async () => {
    await supertest(app)
      .patch(`/api/v1/atlas/${atlas.id}/settings`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ features: { map_3d: true } })
      .expect(200);
  });

  it('a MANAGE user can view sharing config', async () => {
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sharing`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
  });

  it('a MANAGE user can add a user share', async () => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ userId: target.id, permission: 'read' })
      .expect(201);
    assert.ok(res.body.data);
  });

  // ── manage < owner: the owner-only boundary ──
  it('a MANAGE user CANNOT delete the atlas (owner-only) — negative', async () => {
    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(403);
  });

  // ── comment tier blocked from config/sharing ──
  it('a COMMENT user cannot change atlas settings — negative', async () => {
    await supertest(app)
      .patch(`/api/v1/atlas/${atlas.id}/settings`)
      .set('Authorization', `Bearer ${commenterToken}`)
      .send({ features: { map_3d: false } })
      .expect(403);
  });

  it('a COMMENT user cannot view or manage sharing — negative', async () => {
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sharing`)
      .set('Authorization', `Bearer ${commenterToken}`)
      .expect(403);

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
      .set('Authorization', `Bearer ${commenterToken}`)
      .send({ userId: target.id, permission: 'read' })
      .expect(403);
  });
});
