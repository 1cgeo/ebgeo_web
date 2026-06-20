// Path: tests/integration/nomes-access.test.js
// Fase 6: geographic access control. A private name/building only surfaces for
// admins or users whose zone (ST_Contains) covers it. NEGATIVE case is mandatory.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

// A square zone around (-43.2, -22.9).
const ZONE = {
  type: 'Polygon',
  coordinates: [[[-43.3, -22.95], [-43.1, -22.95], [-43.1, -22.85], [-43.3, -22.85], [-43.3, -22.95]]],
};

describe('Geographic access control (nomes + feicoes + zones admin)', () => {
  let app, db, withUser, withoutUser, admin, withTok, withoutTok, adminTok;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    withUser = await createUser(db, { username: 'geo_with' });
    withoutUser = await createUser(db, { username: 'geo_without' });
    admin = await createAdminUser(db, { username: 'geo_admin' });
    withTok = await loginUser(app, withUser.username, withUser.password);
    withoutTok = await loginUser(app, withoutUser.username, withoutUser.password);
    adminTok = await loginUser(app, admin.username, admin.password);

    // A public and a private name at the same spot (inside the zone).
    await db.query(
      `INSERT INTO ng.nomes_geograficos (nome, tipo, access_level, geom)
       VALUES ('Praca Publica', 'Cidade', 'public', ST_SetSRID(ST_MakePoint(-43.2,-22.9),4674)),
              ('Base Secreta', 'Cidade', 'private', ST_SetSRID(ST_MakePoint(-43.2,-22.9),4674))`
    );
    await db.query('SELECT ng.refresh_busca()');

    // A private building inside the zone.
    await db.query(
      `INSERT INTO ng.edificacoes (nome, tipo, altitude_base, altitude_topo, access_level, geom)
       VALUES ('Bunker', 'edificacao', 0, 50, 'private',
         ST_GeomFromText('POLYGON((-43.2001 -22.9001,-43.1999 -22.9001,-43.1999 -22.8999,-43.2001 -22.8999,-43.2001 -22.9001))', 4326))`
    );

    // Create a zone and grant only `withUser` access to it.
    const created = await supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'Area Restrita', geom: ZONE })
      .expect(201);
    const zoneId = created.body.data.id;
    await supertest(app)
      .put(`/api/v1/zones/${zoneId}/permissions`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ users: [withUser.id] })
      .expect(200);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const busca = (token, q) =>
    supertest(app)
      .get('/api/v1/nomes/busca')
      .query({ q, lat: -22.9, lon: -43.2 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

  it('public names are visible to everyone', async () => {
    const res = await busca(withoutTok, 'Praca Publica');
    assert.ok(res.body.some((r) => r.nome === 'Praca Publica'));
  });

  it('a private name is HIDDEN from a user without the zone (negative case)', async () => {
    const res = await busca(withoutTok, 'Base Secreta');
    assert.ok(!res.body.some((r) => r.nome === 'Base Secreta'));
  });

  it('a private name is visible to a user whose zone covers it', async () => {
    const res = await busca(withTok, 'Base Secreta');
    assert.ok(res.body.some((r) => r.nome === 'Base Secreta'));
  });

  it('admin sees private names regardless of zones', async () => {
    const res = await busca(adminTok, 'Base Secreta');
    assert.ok(res.body.some((r) => r.nome === 'Base Secreta'));
  });

  it('identify (/feicoes) respects zone access', async () => {
    const q = { lat: -22.9, lon: -43.2, z: 25 };
    const withRes = await supertest(app).get('/api/v1/nomes/feicoes').query(q).set('Authorization', `Bearer ${withTok}`).expect(200);
    assert.equal(withRes.body.nome, 'Bunker');

    const withoutRes = await supertest(app).get('/api/v1/nomes/feicoes').query(q).set('Authorization', `Bearer ${withoutTok}`).expect(200);
    assert.ok(withoutRes.body.message); // not found for them
  });

  it('zones admin is admin-only and audits permission changes', async () => {
    await supertest(app).get('/api/v1/zones').set('Authorization', `Bearer ${withoutTok}`).expect(403);
    const audit = await db.query(`SELECT COUNT(*)::int AS n FROM audit_trail WHERE action='PERMISSION_GRANT' AND target_type='ZONE'`);
    assert.ok(audit.rows[0].n >= 1);
  });

  it('zone access via GROUP membership — positive AND negative (fn_user_zone_geoms group branch)', async () => {
    // A user with NO direct zone permission but who BELONGS to a group holding a
    // zone permission must see the private name/building. The architecture mandates
    // a negative test for every SQL-embedded access filter; the group branch had none.
    const memberUser = await createUser(db, { username: 'geo_group_member' });
    const memberTok = await loginUser(app, memberUser.username, memberUser.password);

    const { rows: grp } = await db.query(
      `INSERT INTO ng.groups (name) VALUES ('Grupo Restrito') RETURNING id`
    );
    const groupId = grp[0].id;
    await db.query('INSERT INTO ng.user_groups (user_id, group_id) VALUES ($1, $2)', [memberUser.id, groupId]);

    const { rows: z } = await db.query(`SELECT id FROM ng.geographic_access_zones WHERE name = 'Area Restrita'`);
    const zoneId = z[0].id;

    // Before granting the group: the member sees nothing private (negative baseline).
    const before = await busca(memberTok, 'Base Secreta');
    assert.ok(!before.body.some((r) => r.nome === 'Base Secreta'), 'no access before the group is granted');

    // Grant the zone to the GROUP (preserve the existing direct-user grant via replace-set).
    await supertest(app)
      .put(`/api/v1/zones/${zoneId}/permissions`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ users: [withUser.id], groups: [groupId] })
      .expect(200);

    // Positive: the group member now sees the private name AND identifies the building.
    const nameRes = await busca(memberTok, 'Base Secreta');
    assert.ok(nameRes.body.some((r) => r.nome === 'Base Secreta'), 'group member must see the private name');
    const feic = await supertest(app)
      .get('/api/v1/nomes/feicoes').query({ lat: -22.9, lon: -43.2, z: 25 })
      .set('Authorization', `Bearer ${memberTok}`).expect(200);
    assert.equal(feic.body.nome, 'Bunker', 'group member must identify the private building');

    // Negative: removing the membership revokes access on the next query.
    await db.query('DELETE FROM ng.user_groups WHERE user_id = $1 AND group_id = $2', [memberUser.id, groupId]);
    const after = await busca(memberTok, 'Base Secreta');
    assert.ok(!after.body.some((r) => r.nome === 'Base Secreta'), 'removing group membership revokes access');
  });
});
