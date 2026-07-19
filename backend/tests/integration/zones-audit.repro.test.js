// Path: tests/integration/zones-audit.repro.test.js
// Regression: creating, redrawing and deleting an access zone left no audit trail.
//
// A zone's GEOMETRY is an access boundary, not decoration: whether a private place
// name is visible depends on whether it falls inside a zone the caller holds
// permission on (the access filter lives in the SQL, per the ng/sv360 rule in
// CLAUDE.md). Redrawing a polygon therefore changes who can see what, with the same
// practical effect as granting or revoking access.
//
// `setZonePermissions` already audited (PERMISSION_GRANT with a before/after diff),
// which is exactly what made the gap easy to miss: the permission LIST was tracked
// while the SHAPE it applies to was not. Someone could quietly enlarge a zone to
// cover a region and nothing would record it.
//
// Migration 007 widens the audit_trail.action CHECK with ZONE_CREATE/UPDATE/DELETE
// rather than reusing PERMISSION_GRANT (a create is not a grant) or SHARING_CHANGE
// (atlas vocabulary), so the trail stays filterable.
//
// Negative control: remove the createAudit calls from zones.service.js and the first
// three tests fail.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, loginUser } from '../helpers/fixtures.js';

const square = (offset = 0) => ({
  type: 'Polygon',
  coordinates: [[
    [-47.9 + offset, -15.8], [-47.8 + offset, -15.8],
    [-47.8 + offset, -15.7], [-47.9 + offset, -15.7],
    [-47.9 + offset, -15.8],
  ]],
});

describe('access zone changes are audited (repro)', () => {
  let app, db, admin, adminTok;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    admin = await createAdminUser(db);
    adminTok = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const as = (m, p) => supertest(app)[m](p).set('Authorization', `Bearer ${adminTok}`);

  const auditFor = async (zoneId) => {
    const { rows } = await db.query(
      `SELECT action, actor_id, target_type, target_name FROM audit_trail
       WHERE target_id = $1 ORDER BY created_at`,
      [zoneId]
    );
    return rows;
  };

  const newZone = async (name) => {
    const res = await as('post', '/api/v1/zones')
      .send({ name, description: 'zona de teste', geom: square() })
      .expect(201);
    return res.body.data;
  };

  it('creating a zone records ZONE_CREATE', async () => {
    const zone = await newZone(`Zona ${randomUUID().slice(0, 8)}`);

    const rows = await auditFor(zone.id);
    assert.equal(rows.length, 1, 'exactly one row for a create');
    assert.equal(rows[0].action, 'ZONE_CREATE');
    assert.equal(rows[0].actor_id, admin.id, 'attributed to whoever created it');
    assert.equal(rows[0].target_type, 'ZONE');
  });

  it('redrawing the polygon records ZONE_UPDATE — the access boundary moved', async () => {
    const zone = await newZone(`Zona ${randomUUID().slice(0, 8)}`);

    await as('put', `/api/v1/zones/${zone.id}`)
      .send({ name: zone.name, description: 'redesenhada', geom: square(5) })
      .expect(200);

    const rows = await auditFor(zone.id);
    assert.ok(rows.some((r) => r.action === 'ZONE_UPDATE'), 'the redraw is recorded');
  });

  it('deleting a zone records ZONE_DELETE', async () => {
    const zone = await newZone(`Zona ${randomUUID().slice(0, 8)}`);

    await as('delete', `/api/v1/zones/${zone.id}`).expect(204);

    const rows = await auditFor(zone.id);
    assert.ok(rows.some((r) => r.action === 'ZONE_DELETE'), 'the deletion is recorded');
  });

  it('a FAILED update records nothing', async () => {
    // The audit shares the transaction, so an operation that did not happen must not
    // leave a row claiming it did.
    const ghost = randomUUID();
    await as('put', `/api/v1/zones/${ghost}`)
      .send({ name: 'fantasma', geom: square() })
      .expect(404);

    assert.equal((await auditFor(ghost)).length, 0, 'no audit row for a 404');
  });

  it('permission changes are still audited (the part that already worked)', async () => {
    // Guards against the new audits displacing the existing one.
    const zone = await newZone(`Zona ${randomUUID().slice(0, 8)}`);

    await as('put', `/api/v1/zones/${zone.id}/permissions`)
      .send({ users: [admin.id], groups: [] })
      .expect(200);

    const rows = await auditFor(zone.id);
    assert.ok(
      rows.some((r) => r.action === 'PERMISSION_GRANT'),
      'setZonePermissions still audits as before'
    );
    assert.ok(rows.some((r) => r.action === 'ZONE_CREATE'), 'alongside the new create row');
  });
});
