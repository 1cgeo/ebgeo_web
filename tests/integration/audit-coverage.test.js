// Path: tests/integration/audit-coverage.test.js
// Coverage for GENUINELY-UNTESTED audit behavior (not padding). Existing suites
// (org-identity-gaps audit-02/03/04, organizations.test.js) already cover the
// GET /audit filters/pagination/limit-boundary, the system-actor defaults of
// createAudit(null/partial req), and the admin-only 403. The gaps pinned HERE:
//
//   audit-cov-01  ATOMICITY (rollback): the CLAUDE.md invariant that an audit
//                 written with createAudit(req, p, t) inside a tx that THROWS is
//                 rolled back WITH the business write — no orphan audit row. The
//                 commit-together half is covered (zones-11); the rollback half
//                 was untested.
//   audit-cov-02  ATOMICITY (commit): the symmetric positive — the business write
//                 AND its audit row both persist when the tx commits.
//   audit-cov-03  a REAL Express request (HTTP-driven audited mutation) records
//                 the live ip + user-agent (the null/partial-req path is tested,
//                 the real req.get('user-agent') path was not).
//   audit-cov-04  GET /audit `action` filter in isolation + the unfiltered list
//                 surfaces a just-written row.
//   audit-cov-05  GET /audit anonymous (no token) -> 401 (existing tests only
//                 cover the authenticated-non-admin 403).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';
import { tx } from '../../src/database/index.js';
import { createAudit } from '../../src/utils/audit.js';

const uname = (p) => `${p}_${randomUUID().slice(0, 8)}`;

// A valid square zone around (-43.2, -22.9), reused for the HTTP-driven mutation.
const ZONE = {
  type: 'Polygon',
  coordinates: [[[-43.3, -22.95], [-43.1, -22.95], [-43.1, -22.85], [-43.3, -22.85], [-43.3, -22.95]]],
};

describe('Audit coverage (atomicity, live req capture, action filter, anon authz)', () => {
  let app, db, admin, adminTok, user;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    admin = await createAdminUser(db, { username: uname('aud_admin') });
    adminTok = await loginUser(app, admin.username, admin.password);
    user = await createUser(db, { username: uname('aud_user') });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ---------------------------------------------------------------------------
  // audit-cov-01 — ROLLBACK atomicity. createAudit(req, p, t) MUST join the
  // business transaction: if the tx throws after the audit insert, the audit row
  // must NOT survive. This is the CLAUDE.md invariant ("audit created inside a
  // transaction is atomic with the mutation"). We force a rollback by raising
  // AFTER the audit write and assert zero rows for that unique target_id.
  // ---------------------------------------------------------------------------
  it('audit-cov-01: createAudit with `t` rolls back together — throwing tx leaves NO audit row', async () => {
    const targetId = randomUUID();
    const sentinel = new Error('forced rollback after audit');

    await assert.rejects(
      tx(async (t) => {
        // A real business write in the same tx (so we also prove it rolls back).
        await t.none(
          `INSERT INTO ng.geographic_access_zones (id, name, geom)
           VALUES ($1, 'rollback-zone', ST_SetSRID(ST_GeomFromGeoJSON($2), 4674))`,
          [targetId, JSON.stringify(ZONE)]
        );
        // action must be in the audit_trail_action_check allowlist; PERMISSION_GRANT
        // is the real zones-permission action. We isolate THIS row by its unique
        // target_id (a random UUID nothing else uses).
        await createAudit({ ip: '9.9.9.9' }, {
          action: 'PERMISSION_GRANT', actorId: admin.id, targetType: 'ZONE', targetId,
        }, t);
        // Abort the transaction AFTER the audit insert.
        throw sentinel;
      }),
      (err) => err === sentinel
    );

    // The audit row was rolled back with the business write.
    const audit = await db.query(
      `SELECT COUNT(*)::int AS n FROM audit_trail WHERE target_id = $1 AND action = 'PERMISSION_GRANT'`,
      [targetId]
    );
    assert.equal(audit.rows[0].n, 0, 'audit row must NOT survive a rolled-back tx');

    // And the business write rolled back too (atomicity is two-sided).
    const zone = await db.query(
      `SELECT COUNT(*)::int AS n FROM ng.geographic_access_zones WHERE id = $1`,
      [targetId]
    );
    assert.equal(zone.rows[0].n, 0, 'business write must NOT survive the rollback either');
  });

  // ---------------------------------------------------------------------------
  // audit-cov-02 — COMMIT atomicity (the symmetric positive). The SAME pattern
  // that rolls back in cov-01 must persist BOTH rows when the tx commits.
  // ---------------------------------------------------------------------------
  it('audit-cov-02: createAudit with `t` commits together — both the write and the audit row persist', async () => {
    const targetId = randomUUID();

    await tx(async (t) => {
      await t.none(
        `INSERT INTO ng.geographic_access_zones (id, name, geom)
         VALUES ($1, 'commit-zone', ST_SetSRID(ST_GeomFromGeoJSON($2), 4674))`,
        [targetId, JSON.stringify(ZONE)]
      );
      await createAudit({ ip: '8.8.8.8' }, {
        action: 'PERMISSION_GRANT', actorId: admin.id, targetType: 'ZONE', targetId,
        details: { ok: true },
      }, t);
    });

    const audit = await db.query(
      `SELECT actor_id, ip, details FROM audit_trail WHERE target_id = $1 AND action = 'PERMISSION_GRANT'`,
      [targetId]
    );
    assert.equal(audit.rows.length, 1, 'audit row persisted on commit');
    assert.equal(audit.rows[0].actor_id, admin.id);
    assert.equal(audit.rows[0].ip, '8.8.8.8');
    assert.deepEqual(audit.rows[0].details, { ok: true });

    const zone = await db.query(
      `SELECT COUNT(*)::int AS n FROM ng.geographic_access_zones WHERE id = $1`,
      [targetId]
    );
    assert.equal(zone.rows[0].n, 1, 'business write committed alongside the audit row');
  });

  // ---------------------------------------------------------------------------
  // audit-cov-03 — a REAL HTTP-driven audited mutation records the live request's
  // ip and user-agent. The zones PUT /permissions handler calls
  // createAudit(req, ...) with the real Express req, so the captured user_agent
  // must equal the header we sent (the null/partial-req branch is tested
  // elsewhere; the real req.get('user-agent') path was not).
  // ---------------------------------------------------------------------------
  it('audit-cov-03: HTTP-driven audited mutation captures the live ip and user-agent from req', async () => {
    // Create a zone to grant permissions on (drives a PERMISSION_GRANT audit).
    const created = await supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .set('User-Agent', 'EBGeoCovProbe/1.0')
      .send({ name: uname('aud_zone'), geom: ZONE })
      .expect(201);
    const zoneId = created.body.data.id;

    await supertest(app)
      .put(`/api/v1/zones/${zoneId}/permissions`)
      .set('Authorization', `Bearer ${adminTok}`)
      .set('User-Agent', 'EBGeoCovProbe/1.0')
      .send({ users: [user.id] })
      .expect(200);

    const audit = await db.query(
      `SELECT actor_id, ip, user_agent FROM audit_trail
       WHERE action = 'PERMISSION_GRANT' AND target_type = 'ZONE' AND target_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [zoneId]
    );
    assert.equal(audit.rows.length, 1, 'PERMISSION_GRANT audit row written by the live request');
    assert.equal(audit.rows[0].actor_id, admin.id, 'actor is the authenticated admin');
    assert.equal(audit.rows[0].user_agent, 'EBGeoCovProbe/1.0', 'live user-agent captured from req.get');
    assert.ok(audit.rows[0].ip && audit.rows[0].ip !== 'system', 'a real client ip was captured, not the system fallback');
  });

  // ---------------------------------------------------------------------------
  // audit-cov-04 — GET /audit `action` filter branch. `action` is constrained by
  // audit_trail_action_check to a fixed allowlist, so we cannot mint a unique
  // value; instead we seed a PERMISSION_REVOKE row with a unique target_id and
  // assert (a) the action filter returns ONLY PERMISSION_REVOKE rows AND our row
  // is among them, and (b) the unfiltered list also surfaces it. The
  // actorId/targetType filters are tested elsewhere; the action branch was not.
  // ---------------------------------------------------------------------------
  it('audit-cov-04: GET /audit `action` filter returns only that action and includes the seeded row', async () => {
    const targetId = randomUUID();
    await createAudit({ ip: '127.0.0.1' }, {
      action: 'PERMISSION_REVOKE', actorId: admin.id, targetType: 'ZONE', targetId,
    });

    const filtered = await supertest(app)
      .get('/api/v1/audit')
      .query({ action: 'PERMISSION_REVOKE', limit: 200 })
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    assert.ok(filtered.body.data.total >= 1, 'at least the seeded row counted');
    assert.ok(
      filtered.body.data.data.every((r) => r.action === 'PERMISSION_REVOKE'),
      'the action filter restricts every returned row to PERMISSION_REVOKE'
    );
    assert.ok(
      filtered.body.data.data.some((r) => r.target_id === targetId),
      'the seeded PERMISSION_REVOKE row is returned by the action filter'
    );

    // Unfiltered list surfaces it too (presence, not position — robust under
    // parallel files writing other audit rows concurrently).
    const unfiltered = await supertest(app)
      .get('/api/v1/audit')
      .query({ limit: 200 })
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    assert.ok(
      unfiltered.body.data.data.some((r) => r.action === 'PERMISSION_REVOKE' && r.target_id === targetId),
      'the seeded row is present in the unfiltered list'
    );
  });

  // ---------------------------------------------------------------------------
  // audit-cov-05 — NEGATIVE access: GET /audit with NO token is 401 (the route is
  // [auth, requireAdmin]; auth fires first). Existing tests cover the
  // authenticated-non-admin 403; the anonymous 401 was untested.
  // ---------------------------------------------------------------------------
  it('audit-cov-05: GET /audit anonymous (no token) -> 401 UNAUTHORIZED', async () => {
    const res = await supertest(app).get('/api/v1/audit').expect(401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });
});
