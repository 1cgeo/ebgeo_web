// Path: tests/integration/sharing-flow-e2e.test.js
// END-TO-END sharing/authorization FLOW test.
//
// This is a single multi-step story (not isolated checks): it follows the full
// permission lifecycle of one atlas through BOTH the sharing endpoints AND the
// sync write gate (requireAtlasPermission). State is intentionally carried
// between `it()` blocks — each step builds on the previous one.
//
// The value is proving the permission model holds end to end:
//   - editor (write) can push CRDT ops; viewer (read) cannot, and gets blocked
//     at the gate WITHOUT leaking a write into the DB;
//   - viewer can still read (atlas + maps + snapshot) and sees the editor's work;
//   - a stranger with no grant is denied entirely (no data leaked);
//   - a downgrade (PUT share) and a revoke (DELETE share) take effect on the
//     very next request;
//   - the public link grants anonymous read.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

const API = '/api/v1';

describe('E2E: sharing + sync authorization lifecycle', () => {
  let app, db;

  // Actors (registered via the API so registration is part of the flow).
  const owner = { username: `e2e_owner_${randomUUID().slice(0, 8)}`, password: 'Owner@1234' };
  const editor = { username: `e2e_editor_${randomUUID().slice(0, 8)}`, password: 'Editor@1234' };
  const viewer = { username: `e2e_viewer_${randomUUID().slice(0, 8)}`, password: 'Viewer@1234' };
  const stranger = { username: `e2e_stranger_${randomUUID().slice(0, 8)}`, password: 'Stranger@1234' };

  // State carried across steps.
  let atlasId;
  let mapId; // created via sync (map create op)
  const editorFeatureId = randomUUID(); // the feature the editor will create

  // --- helpers -------------------------------------------------------------

  async function register(actor) {
    await supertest(app)
      .post(`${API}/auth/register`)
      .send({
        username: actor.username,
        password: actor.password,
        nome: 'E2E Actor',
        posto_graduacao: 'Cap',
        organizacao_militar: 'OM Teste',
      })
      .expect(201);
    // /auth/register answers an account-free body (it must be identical whether the
    // account was created or already existed), so the id comes from the table.
    const { rows } = await db.query('SELECT id FROM users WHERE username = $1', [actor.username]);
    actor.id = rows[0].id;
    return actor;
  }

  async function login(actor) {
    const res = await supertest(app)
      .post(`${API}/auth/login`)
      .send({ username: actor.username, password: actor.password })
      .expect(200);
    actor.token = res.body.data.accessToken;
    return actor;
  }

  // A sync push as a given actor. Returns the supertest response (caller asserts).
  function pushOp(actor, op) {
    return supertest(app)
      .post(`${API}/atlas/${atlasId}/sync`)
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ operations: [op] });
  }

  function featureCreateOp(targetId) {
    return {
      id: randomUUID(),
      type: 'create',
      target: 'feature',
      targetId,
      mapId,
      data: {
        feature_type: 'point',
        geometry: { coordinates: [-43.18, -22.95] },
        properties: { name: 'Editor Point' },
      },
      timestamp: Date.now(),
      clientId: 'e2e-client',
    };
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    // Register + login all four actors up front.
    await register(owner);
    await register(editor);
    await register(viewer);
    await register(stranger);
    await login(owner);
    await login(editor);
    await login(viewer);
    await login(stranger);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // -------------------------------------------------------------------------
  // STEP 1 — Owner creates an atlas, then creates a map via the sync API.
  // Proves: ownership is established and the ONLY write path for collaborative
  // entities (sync) works for the owner.
  // -------------------------------------------------------------------------
  it('1. owner creates an atlas and a map (map create op via sync)', async () => {
    const atlasRes = await supertest(app)
      .post(`${API}/atlas`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'E2E Sharing Lifecycle Atlas' })
      .expect(201);

    atlasId = atlasRes.body.data.id;
    assert.ok(atlasId, 'atlas id returned');

    // DB: owner is recorded as owner_id.
    const ownerRow = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlasId]);
    assert.equal(ownerRow.rows[0].owner_id, owner.id);

    // Create the map via a sync map-create op (NOT a REST write — there is none).
    mapId = randomUUID();
    const syncRes = await pushOp(owner, {
      id: randomUUID(),
      type: 'create',
      target: 'map',
      targetId: mapId,
      data: { name: 'E2E Map', base_layer: 'osm', center_lat: -22.9, center_long: -43.2, zoom: 12 },
      timestamp: Date.now(),
      clientId: 'e2e-client',
    }).expect(200);

    assert.equal(syncRes.body.data.acks.length, 1);
    assert.ok(syncRes.body.data.acks[0].serverVersion > 0);

    // DB: the map exists and belongs to this atlas.
    const mapRow = await db.query('SELECT atlas_id, name FROM maps WHERE id = $1', [mapId]);
    assert.equal(mapRow.rows.length, 1);
    assert.equal(mapRow.rows[0].atlas_id, atlasId);
    assert.equal(mapRow.rows[0].name, 'E2E Map');
  });

  // -------------------------------------------------------------------------
  // STEP 2 — Owner shares with editor (write) and viewer (read).
  // Proves: grants persist with the exact permission requested.
  // -------------------------------------------------------------------------
  it('2. owner shares with editor (write) and viewer (read)', async () => {
    const editorShare = await supertest(app)
      .post(`${API}/atlas/${atlasId}/sharing/users`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: editor.id, permission: 'write' })
      .expect(201);
    assert.equal(editorShare.body.data.permission, 'write');

    const viewerShare = await supertest(app)
      .post(`${API}/atlas/${atlasId}/sharing/users`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: viewer.id, permission: 'read' })
      .expect(201);
    assert.equal(viewerShare.body.data.permission, 'read');

    // DB: both grants persisted with the right permission and added_by = owner.
    const shares = await db.query(
      'SELECT user_id, permission, added_by FROM atlas_shares WHERE atlas_id = $1 ORDER BY permission',
      [atlasId]
    );
    assert.equal(shares.rows.length, 2);
    const byUser = Object.fromEntries(shares.rows.map((r) => [r.user_id, r]));
    assert.equal(byUser[editor.id].permission, 'write');
    assert.equal(byUser[editor.id].added_by, owner.id);
    assert.equal(byUser[viewer.id].permission, 'read');
    assert.equal(byUser[viewer.id].added_by, owner.id);

    // Sanity: the owner-only sharing config endpoint also reflects both shares.
    const cfg = await supertest(app)
      .get(`${API}/atlas/${atlasId}/sharing`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    assert.equal(cfg.body.data.shares.length, 2);
  });

  // -------------------------------------------------------------------------
  // STEP 3 — Editor (write) pushes a feature op via sync. POSITIVE.
  // Proves: the write gate ADMITS a write-permission share through the sync path.
  // -------------------------------------------------------------------------
  it('3. editor pushes a feature op via sync -> 200, feature persisted', async () => {
    const res = await pushOp(editor, featureCreateOp(editorFeatureId)).expect(200);
    assert.equal(res.body.data.acks.length, 1);
    assert.ok(res.body.data.acks[0].serverVersion > 0);

    // DB: feature persisted under the right map, not soft-deleted.
    const row = await db.query('SELECT map_id, feature_type, deleted_at FROM features WHERE id = $1', [
      editorFeatureId,
    ]);
    assert.equal(row.rows.length, 1);
    assert.equal(row.rows[0].map_id, mapId);
    assert.equal(row.rows[0].feature_type, 'point');
    assert.equal(row.rows[0].deleted_at, null);
  });

  // -------------------------------------------------------------------------
  // STEP 4 — Viewer (read) pushes an op via sync. NEGATIVE.
  // Proves: the write gate REJECTS a read-only share at the sync path (403) and
  // — critically — the rejected op never reaches the DB (no partial write,
  // no leaked feature row). This is the core "read != write" guarantee.
  // -------------------------------------------------------------------------
  it('4. viewer push -> 403, and NO feature is written', async () => {
    const viewerFeatureId = randomUUID();
    await pushOp(viewer, featureCreateOp(viewerFeatureId)).expect(403);

    // DB: the viewer's feature must NOT exist (not even soft-deleted).
    const row = await db.query('SELECT id FROM features WHERE id = $1', [viewerFeatureId]);
    assert.equal(row.rows.length, 0, 'viewer write must not have hit the DB');

    // DB: the op must NOT have been logged either (gate is before the write).
    const ops = await db.query('SELECT count(*)::int AS n FROM operations WHERE atlas_id = $1 AND user_id = $2', [
      atlasId,
      viewer.id,
    ]);
    assert.equal(ops.rows[0].n, 0, 'no operation should be logged for a denied viewer');
  });

  // -------------------------------------------------------------------------
  // STEP 5 — Viewer reads atlas + maps + snapshot. POSITIVE.
  // Proves: read permission grants the full read surface, AND the viewer sees
  // the editor's feature (collaboration is visible to readers).
  // -------------------------------------------------------------------------
  it('5. viewer reads atlas + maps + snapshot -> 200, sees the editor feature', async () => {
    // GET atlas
    const atlasRes = await supertest(app)
      .get(`${API}/atlas/${atlasId}`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(200);
    assert.equal(atlasRes.body.data.id, atlasId);

    // GET maps
    const mapsRes = await supertest(app)
      .get(`${API}/atlas/${atlasId}/maps`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(200);
    assert.ok(mapsRes.body.data.some((m) => m.id === mapId), 'viewer sees the map');

    // GET snapshot (sync version 0). The editor's point lives under features.points.
    const snapRes = await supertest(app)
      .get(`${API}/atlas/${atlasId}/sync/0`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(200);
    assert.equal(snapRes.body.data.isSnapshot, true);
    const mapData = snapRes.body.data.snapshot.maps.find((m) => m.id === mapId);
    assert.ok(mapData, 'snapshot includes the map');
    // Snapshot features are GeoJSON Features; the entity id lives under properties.id.
    const seesFeature = mapData.features.points.some((f) => f.properties?.id === editorFeatureId);
    assert.ok(seesFeature, 'viewer sees the editor-created feature in the snapshot');
  });

  // -------------------------------------------------------------------------
  // STEP 6 — Stranger (no share) reads the atlas. NEGATIVE.
  // Proves: a user with no grant on a private atlas is denied (404, the rung of the
  // escada for "no relation at all") and gets NO atlas payload — nothing leaks
  // through the read endpoint, not even that the atlas is there.
  // -------------------------------------------------------------------------
  it('6. stranger GET atlas -> 404, no data leaked', async () => {
    const res = await supertest(app)
      .get(`${API}/atlas/${atlasId}`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);

    // The error envelope must not carry atlas data.
    assert.ok(!res.body.data, 'no data field on a denied read');

    // "Nothing leaks" has to include existence: same envelope as an id never created.
    const inexistente = await supertest(app)
      .get(`${API}/atlas/${randomUUID()}`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);
    // Anti-vacuity anchor: two bodies with no `error` field would compare equal.
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.equal(res.body.error.code, inexistente.body.error.code);
    assert.equal(res.body.error.message, inexistente.body.error.message);

    // And the stranger is likewise blocked from the snapshot read path.
    await supertest(app)
      .get(`${API}/atlas/${atlasId}/sync/0`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);
  });

  // -------------------------------------------------------------------------
  // STEP 7 — Owner downgrades editor to read-only (PUT share).
  // Proves: a permission downgrade takes effect on the editor's VERY NEXT push
  // — write is now blocked (403), proving the gate reads live share state, and
  // the (now read-only) editor's attempted feature is not written.
  // -------------------------------------------------------------------------
  it('7. owner downgrades editor to read -> editor push now 403', async () => {
    const put = await supertest(app)
      .put(`${API}/atlas/${atlasId}/sharing/users/${editor.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ permission: 'read' })
      .expect(200);
    assert.equal(put.body.data.permission, 'read');

    // DB: the downgrade persisted.
    const share = await db.query(
      'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
      [atlasId, editor.id]
    );
    assert.equal(share.rows[0].permission, 'read');

    // The editor's next write is now blocked.
    const blockedFeatureId = randomUUID();
    await pushOp(editor, featureCreateOp(blockedFeatureId)).expect(403);

    // DB: nothing written.
    const row = await db.query('SELECT id FROM features WHERE id = $1', [blockedFeatureId]);
    assert.equal(row.rows.length, 0, 'downgraded editor write must not hit the DB');

    // But the downgraded editor can STILL read (now equivalent to the viewer).
    await supertest(app)
      .get(`${API}/atlas/${atlasId}`)
      .set('Authorization', `Bearer ${editor.token}`)
      .expect(200);
  });

  // -------------------------------------------------------------------------
  // STEP 8 — Owner revokes the viewer entirely (DELETE share).
  // Proves: revocation takes effect immediately — the viewer's next read is denied
  // (404: with the share row gone there is no relation left, so the atlas goes back
  // to being invisible, not merely closed), and the row is gone from the DB.
  // Contrast with STEP 7, which stays 403: a DOWNGRADED editor still holds a share.
  // -------------------------------------------------------------------------
  it('8. owner revokes viewer -> viewer read now 404', async () => {
    await supertest(app)
      .delete(`${API}/atlas/${atlasId}/sharing/users/${viewer.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(204);

    // DB: the share row is gone.
    const share = await db.query(
      'SELECT 1 FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
      [atlasId, viewer.id]
    );
    assert.equal(share.rows.length, 0, 'revoked share row removed');

    // The viewer's next read is denied.
    await supertest(app)
      .get(`${API}/atlas/${atlasId}`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(404);

    // And the snapshot read path is denied too.
    await supertest(app)
      .get(`${API}/atlas/${atlasId}/sync/0`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(404);
  });

  // -------------------------------------------------------------------------
  // STEP 9 (bonus) — Public link grants ANONYMOUS read.
  // Proves: the public-link path is a real read grant — an unauthenticated
  // caller resolves the atlas and receives a read-scoped public token; once the
  // owner disables the link, the previously-revoked viewer is STILL denied
  // (public read did not silently re-grant the viewer's private access either).
  // -------------------------------------------------------------------------
  it('9. public link grants anonymous read; disabling it revokes that read', async () => {
    const enable = await supertest(app)
      .post(`${API}/atlas/${atlasId}/sharing/public`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    const publicLink = enable.body.data.publicLink || enable.body.data.public_link;
    assert.ok(publicLink, 'public link returned');

    // Anonymous (NO Authorization header) can resolve the public atlas + token.
    const anon = await supertest(app).get(`${API}/atlas/public/${publicLink}`).expect(200);
    assert.equal(anon.body.data.id, atlasId);
    assert.ok(anon.body.data.publicToken, 'anonymous gets a read-scoped public token');

    // The previously-revoked viewer can now read the atlas via the public flag.
    await supertest(app)
      .get(`${API}/atlas/${atlasId}`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(200);

    // Owner disables the public link.
    await supertest(app)
      .delete(`${API}/atlas/${atlasId}/sharing/public`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(204);

    // The link no longer resolves anonymously.
    await supertest(app).get(`${API}/atlas/public/${publicLink}`).expect(404);

    // And the still-unshared viewer is denied again (back to private) — 404, since
    // with the public flag off this viewer once more has no relation to the atlas.
    await supertest(app)
      .get(`${API}/atlas/${atlasId}`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(404);
  });
});
