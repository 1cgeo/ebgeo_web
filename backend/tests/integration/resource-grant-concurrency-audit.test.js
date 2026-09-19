import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('resource grants serialize creation with revocation and duplicate requests', () => {
  let app, db, pool, admin, sharer, recipient, adminToken, sharerToken;
  const suffix = randomUUID().replaceAll('-', '');
  const trigger = `audit_grant_${suffix}`;
  const lockId = 913191;
  const grant = (resource, token, granteeId, grantLevel = 'view') => supertest(app)
    .post(`/api/v1/resource-access/tileset/${resource}/grants`)
    .set('Authorization', `Bearer ${token}`).send({ granteeId, grantLevel });
  before(async () => {
    ({ app, db, pool } = await setupTestEnv());
    admin = await createAdminUser(db, { username: `ga_${suffix.slice(0, 8)}` });
    sharer = await createUser(db, { username: `gs_${suffix.slice(0, 8)}` });
    recipient = await createUser(db, { username: `gr_${suffix.slice(0, 8)}` });
    adminToken = await loginUser(app, admin.username, admin.password);
    sharerToken = await loginUser(app, sharer.username, sharer.password);
    // The trigger is scoped to this fixture. It pauses the INSERT after authorization
    // has been read, so a revocation/second grant can reach the disputed boundary.
    await db.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(${lockId}); RETURN NEW; END $$`);
    await db.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON resource_grants
      FOR EACH ROW WHEN (NEW.granted_by = '${sharer.id}'::uuid)
      EXECUTE FUNCTION ${trigger}()`);
  });
  after(async () => {
    await db.query(`DROP TRIGGER IF EXISTS ${trigger} ON resource_grants`);
    await db.query(`DROP FUNCTION IF EXISTS ${trigger}()`);
    await teardownTestEnv(db);
  });
  async function until(check) {
    const end = Date.now() + 5000;
    while (!await check()) {
      if (Date.now() > end) throw new Error('database concurrency boundary was not reached');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  async function pendingLocks() {
    return Number((await db.query(`SELECT count(*) FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`)).rows[0].count);
  }
  async function scenario(label, duplicate) {
    const resource = `${label}-${suffix}`;
    await db.query("INSERT INTO tilesets(id, name, config, access_level) VALUES ($1,$1,'{}','private')", [resource]);
    const parent = (await grant(resource, adminToken, sharer.id, 'view_share').expect(201)).body.data;
    const blocker = await pool.connect();
    let first, second;
    try {
      await blocker.query('SELECT pg_advisory_lock($1)', [lockId]);
      first = grant(resource, sharerToken, recipient.id).then(response => response);
      await until(async () => await pendingLocks() >= 1);
      let secondDone = false;
      second = (duplicate ? grant(resource, sharerToken, recipient.id)
        : supertest(app).delete(`/api/v1/resource-access/grants/${parent.id}`).set('Authorization', `Bearer ${adminToken}`))
        .then(response => { secondDone = true; return response; });
      await until(async () => secondDone || await pendingLocks() >= 2);
    } finally {
      await blocker.query('SELECT pg_advisory_unlock($1)', [lockId]);
      blocker.release();
    }
    return { resource, responses: await Promise.all([first, second]) };
  }

  it('a grant created during parent revocation cannot survive as an orphan with access', async () => {
    const { resource, responses } = await scenario('revoked', false);
    assert.equal(responses[0].status, 201);
    assert.equal(responses[1].status, 200);
    const { rows } = await db.query("SELECT * FROM fn_granted_resource_ids($1::uuid, NULL, 'tileset') WHERE resource_id = $2", [recipient.id, resource]);
    assert.equal(rows.length, 0, 'recipient must lose the delegated access with its source');
  });

  it('two concurrent grants from the same actor to the same recipient create one live path', async () => {
    const { responses } = await scenario('duplicate', true);
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  });

  it('concurrent extensions cannot shorten the winning deadline', async () => {
    const resource = `extension-${suffix}`;
    await db.query("INSERT INTO tilesets(id, name, config, access_level) VALUES ($1,$1,'{}','private')", [resource]);
    const original = (await grant(resource, adminToken, recipient.id).expect(201)).body.data;
    await db.query("UPDATE resource_grants SET expires_at = NOW() + INTERVAL '1 day' WHERE id = $1", [original.id]);
    const longDeadline = new Date(Date.now() + 100 * 86400000).toISOString();
    const shortDeadline = new Date(Date.now() + 50 * 86400000).toISOString();
    const updateTrigger = `${trigger}_extend`;
    await db.query(`CREATE TRIGGER ${updateTrigger} BEFORE UPDATE ON resource_grants
      FOR EACH ROW WHEN (NEW.id = '${original.id}'::uuid) EXECUTE FUNCTION ${trigger}()`);
    const blocker = await pool.connect();
    let first, second;
    const extend = expiresAt => supertest(app).patch(`/api/v1/resource-access/grants/${original.id}`)
      .set('Authorization', `Bearer ${adminToken}`).send({ expiresAt }).then(response => response);
    try {
      await blocker.query('SELECT pg_advisory_lock($1)', [lockId]);
      first = extend(longDeadline);
      await until(async () => await pendingLocks() >= 1);
      second = extend(shortDeadline);
      await until(async () => Number((await db.query(`SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`)).rows[0].count) >= 2);
    } finally {
      await blocker.query('SELECT pg_advisory_unlock($1)', [lockId]);
      blocker.release();
    }
    try {
      const responses = await Promise.all([first, second]);
      assert.deepEqual(responses.map(response => response.status), [200, 409]);
      const { rows } = await db.query('SELECT expires_at FROM resource_grants WHERE id = $1', [original.id]);
      assert.equal(rows[0].expires_at.toISOString(), longDeadline);
    } finally {
      await db.query(`DROP TRIGGER IF EXISTS ${updateTrigger} ON resource_grants`);
    }
  });

  it('removing a group member also revokes a delegation still being created', async () => {
    const resource = `membership-${suffix}`;
    await db.query("INSERT INTO tilesets(id, name, config, access_level) VALUES ($1,$1,'{}','private')", [resource]);
    const group = (await supertest(app).post('/api/v1/access-groups')
      .set('Authorization', `Bearer ${adminToken}`).send({ name: `Race ${suffix}` }).expect(201)).body.data;
    await supertest(app).post(`/api/v1/access-groups/${group.id}/members`)
      .set('Authorization', `Bearer ${adminToken}`).send({ userId: sharer.id }).expect(200);
    await supertest(app).post(`/api/v1/resource-access/tileset/${resource}/grants`)
      .set('Authorization', `Bearer ${adminToken}`).send({ granteeGroupId: group.id, grantLevel: 'view_share' }).expect(201);
    const blocker = await pool.connect();
    let first, second;
    try {
      await blocker.query('SELECT pg_advisory_lock($1)', [lockId]);
      first = grant(resource, sharerToken, recipient.id).then(response => response);
      await until(async () => await pendingLocks() >= 1);
      let secondDone = false;
      second = supertest(app).delete(`/api/v1/access-groups/${group.id}/members/${sharer.id}`)
        .set('Authorization', `Bearer ${adminToken}`).then(response => { secondDone = true; return response; });
      await until(async () => secondDone || Number((await db.query(`SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`)).rows[0].count) >= 2);
    } finally {
      await blocker.query('SELECT pg_advisory_unlock($1)', [lockId]);
      blocker.release();
    }
    const responses = await Promise.all([first, second]);
    assert.deepEqual(responses.map(response => response.status), [201, 200]);
    const { rows } = await db.query("SELECT * FROM fn_granted_resource_ids($1::uuid, NULL, 'tileset') WHERE resource_id = $2", [recipient.id, resource]);
    assert.equal(rows.length, 0, 'membership removal must see delegations committed while it waited');
  });
});
