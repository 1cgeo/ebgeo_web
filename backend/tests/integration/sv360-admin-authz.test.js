// Path: tests/integration/sv360-admin-authz.test.js
// Item 45 (testes-backend.md) — the NEGATIVE half of the two most destructive
// routes in the sv360 module.
//
// `loadWritableProject` (sv360.admin.service.js:110-148) is the ONLY gate on
// PATCH /admin/projects/:slug/status and DELETE /admin/projects/:slug — the latter
// being a HARD delete with CASCADE plus an rmSync of the {orgId}__{slug}.db. Before
// this file both routes were exercised exclusively through their happy path with the
// owner (sv360-ingest.test.js:931-989); the only 403s in the module covered upload.
// Loosening canWriteProject, or dropping the organization_id scope from
// GET_PROJECT_FOR_ADMIN, left every test green while any editor of any OM deleted
// another OM's project. CLAUDE.md: every access filter needs a test with a user that
// does NOT have permission.
//
// The status codes encode a deliberate distinction and are asserted as such:
//   anon                -> 401 (strict `auth`)
//   same-org viewer     -> 403 (it exists, you may look, you may not write)
//   member of ANOTHER org -> 404 (org scoping; existence is not leaked)
// Every negative also asserts the ABSENCE OF EFFECT — the row and the .db file — so
// a "4xx that still deleted" cannot pass.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import path from 'node:path';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';

const RID = crypto.randomUUID().slice(0, 8);
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing-purposes-only-32chars';

function mintToken({ orgId, role = 'user', orgRole = 'viewer' }) {
  return jwt.sign(
    { sub: crypto.randomUUID(), username: `aauth_${RID}_${orgRole}`, role, organization_id: orgId, org_role: orgRole },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' }
  );
}

const SLUG = `aauth-proj-${RID}`;
const url = (p) => `/api/v1/sv360${p}`;

describe('sv360 admin — negative authorization on status + delete', () => {
  let app, db, defaultOrgId, otherOrgId, projectId, dbPath;
  let ownerToken, viewerToken, foreignEditorToken, adminToken;

  /** Re-creates the {orgId}__{slug}.db placeholder so each case starts from a live file. */
  function seedDbFile() {
    mkdirSync(config.sv360.dbDir, { recursive: true });
    writeFileSync(dbPath, Buffer.from('SQLite format 3\0'));
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    defaultOrgId = org.rows[0].id;
    const org2 = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla) VALUES ($1, $2, 'AAU') RETURNING id`,
      [`Admin Authz OM ${RID}`, `aauth-om-${RID}`]
    );
    otherOrgId = org2.rows[0].id;

    ownerToken = mintToken({ orgId: defaultOrgId, orgRole: 'owner' });
    viewerToken = mintToken({ orgId: defaultOrgId, orgRole: 'viewer' });
    foreignEditorToken = mintToken({ orgId: otherOrgId, orgRole: 'editor' });
    adminToken = mintToken({ orgId: otherOrgId, role: 'admin', orgRole: 'admin' });

    const dbFilename = `${defaultOrgId}__${SLUG}.db`;
    dbPath = path.join(config.sv360.dbDir, dbFilename);
    seedDbFile();

    const proj = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, $3, -23.5, -46.6, $4, 'enabled', 0) RETURNING id`,
      [defaultOrgId, SLUG, `Admin Authz ${RID}`, dbFilename]
    );
    projectId = proj.rows[0].id;
  });

  after(async () => {
    await closeStore();
    if (existsSync(dbPath)) {
      try {
        rmSync(dbPath, { force: true });
      } catch {
        /* best effort */
      }
    }
    await db.query('DELETE FROM sv360.projects WHERE slug = $1', [SLUG]);
    await db.query('DELETE FROM public.organizations WHERE id = $1', [otherOrgId]);
    await teardownTestEnv(db);
  });

  /** Current status, or null when the row is gone. */
  async function statusOf() {
    const { rows } = await db.query('SELECT status FROM sv360.projects WHERE id = $1', [projectId]);
    return rows[0]?.status ?? null;
  }

  // --- PATCH /admin/projects/:slug/status ------------------------------------

  it('anonymous PATCH status -> 401 with the flat { error } envelope, status unchanged', async () => {
    const res = await supertest(app)
      .patch(url(`/admin/projects/${SLUG}/status`))
      .send({ status: 'disabled' })
      .expect(401);
    assert.equal(typeof res.body.error, 'string', 'sv360 uses the flat error envelope');
    assert.equal(await statusOf(), 'enabled');
  });

  it('a same-org VIEWER PATCH status -> 403, status unchanged', async () => {
    const res = await supertest(app)
      .patch(url(`/admin/projects/${SLUG}/status`))
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ status: 'disabled' })
      .expect(403);
    assert.equal(typeof res.body.error, 'string');
    assert.equal(await statusOf(), 'enabled', 'a viewer must not flip visibility');
  });

  it('an editor of ANOTHER org PATCH status -> 404 (org scope, no existence leak)', async () => {
    // 404 rather than 403 is deliberate: a foreign OM must not learn the slug exists.
    await supertest(app)
      .patch(url(`/admin/projects/${SLUG}/status`))
      .set('Authorization', `Bearer ${foreignEditorToken}`)
      .send({ status: 'disabled' })
      .expect(404);
    assert.equal(await statusOf(), 'enabled');
  });

  it('the owner CAN flip the status — positive control, so the negatives are not over a dead route', async () => {
    await supertest(app)
      .patch(url(`/admin/projects/${SLUG}/status`))
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'disabled' })
      .expect(200);
    assert.equal(await statusOf(), 'disabled');

    await supertest(app)
      .patch(url(`/admin/projects/${SLUG}/status`))
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'enabled' })
      .expect(200);
    assert.equal(await statusOf(), 'enabled');
  });

  // --- DELETE /admin/projects/:slug ------------------------------------------

  it('anonymous DELETE -> 401; the row AND the {orgId}__{slug}.db survive', async () => {
    const res = await supertest(app).delete(url(`/admin/projects/${SLUG}`)).expect(401);
    assert.equal(typeof res.body.error, 'string');
    assert.notEqual(await statusOf(), null, 'the project row must survive');
    assert.equal(existsSync(dbPath), true, 'the SQLite file must survive');
  });

  it('a same-org VIEWER DELETE -> 403; row and file intact', async () => {
    await supertest(app)
      .delete(url(`/admin/projects/${SLUG}`))
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);
    assert.notEqual(await statusOf(), null);
    assert.equal(existsSync(dbPath), true);
  });

  it('an editor of ANOTHER org DELETE -> 404; row and file intact', async () => {
    await supertest(app)
      .delete(url(`/admin/projects/${SLUG}`))
      .set('Authorization', `Bearer ${foreignEditorToken}`)
      .expect(404);
    assert.notEqual(await statusOf(), null);
    assert.equal(existsSync(dbPath), true);
  });

  it('a global admin disambiguates with ?orgSlug and CAN delete (the orgSlug branch)', async () => {
    // The happy path so far only ever used ?orgId; loadWritableProject's orgSlug
    // resolution had no coverage at all.
    await supertest(app)
      .delete(url(`/admin/projects/${SLUG}`))
      .query({ orgSlug: 'default' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    assert.equal(await statusOf(), null, 'the row is hard-deleted');
    assert.equal(existsSync(dbPath), false, 'the SQLite file is removed with it');
  });
});
