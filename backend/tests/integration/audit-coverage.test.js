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
          `INSERT INTO access_groups (id, name) VALUES ($1, $2)`,
          [targetId, 'rollback-zone']
        );
        // action must be in the audit_trail_action_check allowlist; PERMISSION_GRANT
        // is the real zones-permission action. We isolate THIS row by its unique
        // target_id (a random UUID nothing else uses).
        await createAudit({ ip: '9.9.9.9' }, {
          action: 'PERMISSION_GRANT', actorId: admin.id, targetType: 'ATLAS', targetId,
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
      `SELECT COUNT(*)::int AS n FROM access_groups WHERE id = $1`,
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
        `INSERT INTO access_groups (id, name) VALUES ($1, $2)`,
        [targetId, 'commit-zone']
      );
      await createAudit({ ip: '8.8.8.8' }, {
        action: 'PERMISSION_GRANT', actorId: admin.id, targetType: 'ATLAS', targetId,
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
      `SELECT COUNT(*)::int AS n FROM access_groups WHERE id = $1`,
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
    // A rota que dirige a mutação auditada mudou em 2026-08-19: era `/zones`, que
    // saiu com o sistema de zonas. O que este caso mede não é a rota, é o caminho
    // req -> createAudit (ip e user-agent VIVOS), então qualquer mutação auditada
    // serve, e `ORG_CREATE` é a mais simples que existe.
    const criada = await supertest(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${adminTok}`)
      .set('User-Agent', 'EBGeoCovProbe/1.0')
      .send({ nome: uname('OM Cov'), slug: uname('om-cov').toLowerCase().replace(/[^a-z0-9-]/g, '-'), sigla: 'OMC' })
      .expect(201);
    const orgId = criada.body.data.id;

    const audit = await db.query(
      `SELECT actor_id, ip, user_agent FROM audit_trail
       WHERE action = 'ORG_CREATE' AND target_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [orgId]
    );
    assert.equal(audit.rows.length, 1, 'linha de auditoria escrita pela requisição viva');
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
      action: 'PERMISSION_REVOKE', actorId: admin.id, targetType: 'ATLAS', targetId,
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

  // ---------------------------------------------------------------------------
  // audit-cov-06..08 — the BORDER of ?actorId / ?page / ?limit.
  //
  // LIST_AUDIT/COUNT_AUDIT bind `$2::uuid`, and the ONLY thing standing between a
  // query string and that cast is `Joi.string().uuid()` on the route. Relaxing it to
  // Joi.string() — or moving the filter into the controller — turns ?actorId=abc into
  // a Postgres cast error. Nothing exercised a malformed value; org-identity-gaps
  // audit-03 only ever passes a well-formed uuid.
  //
  // The pair matters: a 422 assertion alone would also be satisfied by a route that
  // rejected EVERY actorId, so the well-formed value must be shown to work.
  // ---------------------------------------------------------------------------
  it('audit-cov-06: ?actorId malformado -> 422 na borda, e sem texto do Postgres no corpo', async () => {
    const res = await supertest(app)
      .get('/api/v1/audit?actorId=abc')
      .set('Authorization', `Bearer ${adminTok}`);

    assert.equal(res.status, 422, 'o Joi da borda precisa barrar antes do cast ::uuid');
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    const corpo = JSON.stringify(res.body);
    assert.doesNotMatch(corpo, /invalid input syntax/i, 'mensagem do driver não pode vazar');
    assert.doesNotMatch(corpo, /::uuid/, 'nem o SQL');
  });

  it('audit-cov-07: ?actorId BEM formado passa e filtra de fato (o par que dá sentido ao 422)', async () => {
    const alvo = randomUUID();
    await createAudit({ ip: '7.7.7.7' }, {
      actorId: admin.id,
      action: 'PERMISSION_GRANT',
      targetType: 'ATLAS',
      targetId: alvo,
    });

    const meu = await supertest(app)
      .get(`/api/v1/audit?actorId=${admin.id}&limit=200`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    assert.ok(meu.body.data.data.length > 0, 'o ator que acabou de escrever precisa aparecer');
    assert.ok(
      meu.body.data.data.every((r) => r.actor_id === admin.id),
      'toda linha devolvida tem de ser do ator filtrado'
    );
    assert.ok(
      meu.body.data.data.some((r) => r.target_id === alvo),
      'a linha recém-semeada precisa estar entre elas'
    );

    // E um ator SEM linhas devolve lista vazia — não erro, não a lista inteira.
    const outro = await supertest(app)
      .get(`/api/v1/audit?actorId=${user.id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    assert.equal(outro.body.data.data.length, 0, 'um filtro que não filtra devolveria as linhas do admin');
    assert.equal(outro.body.data.total, 0);
  });

  it('audit-cov-08: bordas INFERIORES de page/limit -> 422 (a superior, limit=201, já é coberta)', async () => {
    for (const qs of ['page=0', 'limit=0', 'page=-1', 'limit=-5']) {
      const res = await supertest(app)
        .get(`/api/v1/audit?${qs}`)
        .set('Authorization', `Bearer ${adminTok}`);
      assert.equal(res.status, 422, `?${qs} deveria ser rejeitado na borda`);
    }
    // Contraste: os valores mínimos LEGÍTIMOS passam. Sem isso, um schema que
    // rejeitasse toda paginação satisfaria o laço acima.
    await supertest(app)
      .get('/api/v1/audit?page=1&limit=1')
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
  });

  it('audit-cov-09: ?action sem correspondência -> 200 com total 0 e data [] (não é erro)', async () => {
    const res = await supertest(app)
      .get('/api/v1/audit?action=ACAO_QUE_NAO_EXISTE')
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    assert.deepEqual(res.body.data.data, []);
    assert.equal(res.body.data.total, 0, 'lista vazia com total 0 — não um erro');
  });
});
