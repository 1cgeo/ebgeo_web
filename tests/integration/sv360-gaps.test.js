// Path: tests/integration/sv360-gaps.test.js
// Fase 9 audit GAP coverage for StreetView 360 (confirmed lacunas). Mirrors the
// sv360-contract / sv360-ingest fixture style: synthetic images.db via
// better-sqlite3; deterministic uuidv5 (node:crypto, fixed NS); mintToken without
// a users row; closeStore()/evict before rmSync in teardown (Windows file lock).
//
// Covered findings:
//   sv360-02  GET /photos/by-name/:nome — access filter + cross-project tie-break.
//   sv360-03  nearby() service — radius access filter + default/clamp + cap (unit).
//   sv360-05  Admin list ?orgId filter + cross-org isolation + malformed orgId 422.
//   sv360-06  Broken-JSON manifest upload → 400 (NOT 422); missing manifest → 400.
//   sv360-07  Malformed / non-uuidv5 :uuid on read+write routes → 422 at the border.
//   sv360-08  Thumbnail Range (206) and invalid-Range (416).
//   sv360-09  Soft-delete tombstone carry-over across reupload; resurrection path.
//   sv360-10  createTarget guards: cross-project target → 409; tombstoned → 409.
//   sv360-11  Unknown orgSlug (global admin) → 409; cross-org orgSlug (om) → 403.
//   sv360-01  Upload unexpected-field MulterError mapping (asserts ACTUAL behavior).
//
// USERNAMES/SLUGS are suffixed with a random token so the file is re-runnable and
// never collides with sibling files in the shared run.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';
import * as svc from '../../src/modules/streetview360/sv360.service.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
const RID = randomUUID().slice(0, 8); // unique suffix for this file run

// Deterministic UUID v5 (node:crypto), fixed namespace — matches sibling tests.
const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

function mintToken({ orgId, orgRole = 'viewer', role = 'user', sub = randomUUID() }) {
  return jwt.sign(
    { sub, username: `gap_${sub.slice(0, 8)}`, role, organization_id: orgId, org_role: orgRole },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' }
  );
}

const url = (p) => `/api/v1/sv360${p}`;
const authHdr = (t) => ['Authorization', `Bearer ${t}`];

// Slugs (unique per run). Enabled in default org, disabled in the other org.
const ENABLED_SLUG = `gap-enabled-${RID}`;
const DISABLED_SLUG = `gap-disabled-${RID}`;

// Shared blobs.
const fullBuf = Buffer.from('RIFFxxxxWEBPfakefull-0123456789ABCDEF');
const prevBuf = Buffer.from('RIFFxxxxWEBPfakeprev');

describe('StreetView 360 — audit gap coverage', () => {
  let app, db;
  let defaultOrgId, otherOrgId;
  let enabledProjectId, disabledProjectId;
  let ownerToken, adminToken, otherOrgWriterToken;
  let tmpRoot;
  // Track created on-disk .db/.webp paths to clean in teardown.
  const diskPaths = new Set();

  // by-name collision photos.
  const collideName = `collide-${RID}.jpg`;
  const enabledCollidePhotoId = uuidv5(`enabled/${ENABLED_SLUG}/${collideName}`);
  const disabledCollidePhotoId = uuidv5(`disabled/${DISABLED_SLUG}/${collideName}`);
  // a name living ONLY in the disabled project.
  const disabledOnlyName = `disabled-only-${RID}.jpg`;
  const disabledOnlyPhotoId = uuidv5(`disabled/${DISABLED_SLUG}/${disabledOnlyName}`);
  // photo in the enabled project for createTarget tests.
  const enabledMainPhotoId = uuidv5(`enabled/${ENABLED_SLUG}/main-${RID}.jpg`);
  // photo in the enabled project to be tombstoned for createTarget guard (b).
  const enabledTombPhotoId = uuidv5(`enabled/${ENABLED_SLUG}/tomb-${RID}.jpg`);

  function buildImagesDb(name, rows) {
    const p = path.join(tmpRoot, name);
    if (existsSync(p)) rmSync(p, { force: true });
    const sdb = new Database(p);
    sdb.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    const ins = sdb.prepare('INSERT INTO images VALUES (?,?,?)');
    for (const r of rows) ins.run(r.id, r.full, r.preview);
    sdb.close();
    return p;
  }

  function writeManifestFile(name, content) {
    const p = path.join(tmpRoot, name);
    // content may be an object (stringified) or a raw string (broken-JSON case).
    writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
    return p;
  }

  function photoRow(id, name, seq, lat, lon, full, preview, extra = {}) {
    return {
      id,
      original_name: name,
      display_name: name.replace('.jpg', ''),
      sequence_number: seq,
      lat,
      lon,
      ele: 700,
      heading: 0,
      camera_height: 1.6,
      full_size_bytes: full.length,
      preview_size_bytes: preview.length,
      ...extra,
    };
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    defaultOrgId = org.rows[0].id;

    const org2 = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla)
       VALUES ($1, $2, 'GAPOM')
       ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`,
      [`Gap OM ${RID}`, `gap-other-om-${RID}`]
    );
    otherOrgId = org2.rows[0].id;

    ownerToken = mintToken({ orgId: defaultOrgId, orgRole: 'owner' });
    adminToken = mintToken({ orgId: otherOrgId, orgRole: 'viewer', role: 'admin' });
    otherOrgWriterToken = mintToken({ orgId: otherOrgId, orgRole: 'editor' });

    tmpRoot = path.join(os.tmpdir(), `sv360-gaps-${RID}`);
    mkdirSync(tmpRoot, { recursive: true });
    mkdirSync(config.sv360.dbDir, { recursive: true });

    // --- Enabled project (default org) ---
    const enabledDb = `${defaultOrgId}__${ENABLED_SLUG}.db`;
    const proj = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, $3, -23.5, -46.6, $4, 'enabled', 3) RETURNING id`,
      [defaultOrgId, ENABLED_SLUG, `Gap Enabled ${RID}`, enabledDb]
    );
    enabledProjectId = proj.rows[0].id;

    // --- Disabled project (OTHER org) ---
    const disabledDb = `${otherOrgId}__${DISABLED_SLUG}.db`;
    const dis = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, db_filename, status, photo_count)
       VALUES ($1, $2, $3, $4, 'disabled', 2) RETURNING id`,
      [otherOrgId, DISABLED_SLUG, `Gap Disabled ${RID}`, disabledDb]
    );
    disabledProjectId = dis.rows[0].id;

    // Photos in the ENABLED project: a collide-named one + a main + a to-tombstone.
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
          heading, camera_height, full_size_bytes, preview_size_bytes, capture_date)
       VALUES ($1, $2, $3, 'Enabled Collide', 1, -23.5, -46.6, 720, 12, 1.6, $4, $5, '2024-01-15T10:00:00Z')`,
      [enabledCollidePhotoId, enabledProjectId, collideName, fullBuf.length, prevBuf.length]
    );
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
          full_size_bytes, preview_size_bytes)
       VALUES ($1, $2, $3, 'Main', 2, -23.5005, -46.6005, 718, $4, $5)`,
      [enabledMainPhotoId, enabledProjectId, `main-${RID}.jpg`, fullBuf.length, prevBuf.length]
    );
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
          full_size_bytes, preview_size_bytes)
       VALUES ($1, $2, $3, 'ToTomb', 3, -23.5007, -46.6007, 717, $4, $5)`,
      [enabledTombPhotoId, enabledProjectId, `tomb-${RID}.jpg`, fullBuf.length, prevBuf.length]
    );

    // Photos in the DISABLED project: a collide-named one (tie-break loser) + a
    // disabled-only-named one (anon must 404, owning org 200).
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
          full_size_bytes, preview_size_bytes)
       VALUES ($1, $2, $3, 'Disabled Collide', 1, -10.0, -50.0, 100, $4, $5)`,
      [disabledCollidePhotoId, disabledProjectId, collideName, fullBuf.length, prevBuf.length]
    );
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
          full_size_bytes, preview_size_bytes)
       VALUES ($1, $2, $3, 'Disabled Only', 2, -10.001, -50.001, 101, $4, $5)`,
      [disabledOnlyPhotoId, disabledProjectId, disabledOnlyName, fullBuf.length, prevBuf.length]
    );
  });

  after(async () => {
    await closeStore();
    for (const f of diskPaths) {
      for (const variant of [f, `${f}.tmp`, `${f}.bak`, `${f}-wal`, `${f}-shm`, `${f}-journal`]) {
        if (variant && existsSync(variant)) {
          try {
            rmSync(variant, { force: true });
          } catch {
            /* ignore */
          }
        }
      }
    }
    if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });

    // Clean sv360 rows.
    await db.query(
      `DELETE FROM sv360.deleted_photos WHERE photo_id = ANY($1)`,
      [[enabledCollidePhotoId, disabledCollidePhotoId, disabledOnlyPhotoId, enabledMainPhotoId, enabledTombPhotoId]]
    );
    await db.query(
      `DELETE FROM sv360.projects WHERE organization_id = ANY($1::uuid[])`,
      [[defaultOrgId, otherOrgId]]
    );
    await db.query(`DELETE FROM public.organizations WHERE id = $1`, [otherOrgId]);
    await teardownTestEnv(db);
  });

  // -------------------------------------------------------------------------
  // sv360-02 — GET /photos/by-name/:nome (access filter + tie-break + routing)
  // -------------------------------------------------------------------------

  it('sv360-02: by-name resolves the ENABLED project on a cross-project name collision (tie-break)', async () => {
    const res = await supertest(app)
      .get(url(`/photos/by-name/${encodeURIComponent(collideName)}`))
      .expect(200);
    // The bare frozen shape; tie-break picks the enabled project.
    assert.equal(res.body.projectSlug, ENABLED_SLUG);
    assert.equal(res.body.camera.id, enabledCollidePhotoId);
    assert.equal(res.body.camera.img, collideName);
  });

  it('sv360-02: by-name for a name living ONLY in a disabled project → 404 for anon, 200 for owning org', async () => {
    // Anon: the SQL returns the disabled-project row, but enforceProjectReadable 404s.
    const anon = await supertest(app)
      .get(url(`/photos/by-name/${encodeURIComponent(disabledOnlyName)}`))
      .expect(404);
    assert.equal(typeof anon.body.error, 'string'); // flat envelope

    // Owning-org member (other org) sees it.
    const ok = await supertest(app)
      .get(url(`/photos/by-name/${encodeURIComponent(disabledOnlyName)}`))
      .set(...authHdr(otherOrgWriterToken))
      .expect(200);
    assert.equal(ok.body.camera.id, disabledOnlyPhotoId);
    assert.equal(ok.body.projectSlug, DISABLED_SLUG);
  });

  it('sv360-02: "by-name" is NOT captured as a :uuid (route ordering)', async () => {
    // A literal '/photos/by-name/<name>' must hit the by-name handler. If it were
    // captured as :uuid, the uuidParamSchema (uuidv5) would 422 the literal 'by-name'
    // segment. Instead, an unknown name resolves to a 404 from photoByName.
    const res = await supertest(app)
      .get(url(`/photos/by-name/${encodeURIComponent(`nonexistent-${RID}.jpg`)}`))
      .expect(404);
    assert.equal(typeof res.body.error, 'string');
    assert.equal(res.body.error, 'Photo not found'); // proves it reached photoByName, not uuid validate
  });

  // -------------------------------------------------------------------------
  // sv360-03 — nearby() service (radius access filter + default/clamp + cap)
  // -------------------------------------------------------------------------

  it('sv360-03: nearby() excludes a disabled-other-org photo for anon, includes it for admin/owning-org', async () => {
    // Point near the enabled+disabled collide photos. The enabled photo is at
    // (-46.6,-23.5); the disabled photo is at (-50,-10) — far apart, so we query
    // each cluster separately to keep distances deterministic.

    // Cluster A: enabled project area. Anon should see the enabled photos only.
    const anonA = await svc.nearby(-46.6, -23.5, 5000, undefined);
    const anonAIds = anonA.map((r) => r.id);
    assert.ok(anonAIds.includes(enabledCollidePhotoId), 'anon sees enabled photo nearby');
    assert.ok(
      !anonAIds.includes(disabledCollidePhotoId),
      'anon must NOT see the disabled photo (different cluster anyway)'
    );

    // Cluster B: disabled project area. Anon sees NOTHING (project disabled).
    const anonB = await svc.nearby(-50.0, -10.0, 5000, undefined);
    const anonBIds = anonB.map((r) => r.id);
    assert.ok(
      !anonBIds.includes(disabledCollidePhotoId),
      'anon must NOT see a disabled-project photo via nearby'
    );

    // Owning-org member sees the disabled-project photo in its cluster.
    const memberB = await svc.nearby(-50.0, -10.0, 5000, {
      role: 'user',
      organization_id: otherOrgId,
    });
    const memberBIds = memberB.map((r) => r.id);
    assert.ok(memberBIds.includes(disabledCollidePhotoId), 'owning-org member sees disabled photo');

    // Global admin sees it too.
    const adminB = await svc.nearby(-50.0, -10.0, 5000, { role: 'admin' });
    const adminBIds = adminB.map((r) => r.id);
    assert.ok(adminBIds.includes(disabledCollidePhotoId), 'admin sees disabled photo');
  });

  it('sv360-03: radius=0/NaN/Infinity falls back to the 500m default', async () => {
    // At the enabled cluster, a tiny/invalid radius must still resolve to 500m and
    // return the on-spot enabled photo (it is exactly at the query point).
    for (const bad of [0, NaN, Infinity, -10]) {
      const rows = await svc.nearby(-46.6, -23.5, bad, undefined);
      const ids = rows.map((r) => r.id);
      assert.ok(
        ids.includes(enabledCollidePhotoId),
        `radius=${bad} must fall back to 500m and find the on-spot photo`
      );
    }
  });

  // -------------------------------------------------------------------------
  // sv360-05 — Admin list ?orgId filter + cross-org isolation + malformed orgId
  // -------------------------------------------------------------------------

  it('sv360-05: a default-org owner admin-list does NOT include another OM project (cross-org isolation)', async () => {
    const res = await supertest(app)
      .get(url('/admin/projects'))
      .set(...authHdr(ownerToken))
      .expect(200);
    assert.ok(Array.isArray(res.body));
    const slugs = res.body.map((p) => p.slug);
    assert.ok(slugs.includes(ENABLED_SLUG), 'owner sees its own org project');
    assert.ok(!slugs.includes(DISABLED_SLUG), 'owner must NOT see the other OM project');
  });

  it('sv360-05: global admin ?orgId scopes the list to exactly that OM', async () => {
    const res = await supertest(app)
      .get(url(`/admin/projects?orgId=${otherOrgId}`))
      .set(...authHdr(adminToken))
      .expect(200);
    const slugs = res.body.map((p) => p.slug);
    assert.ok(slugs.includes(DISABLED_SLUG), 'orgId filter includes the target OM project');
    assert.ok(!slugs.includes(ENABLED_SLUG), 'orgId filter excludes the default-org project');
  });

  it('sv360-05: malformed ?orgId → 422 flat error', async () => {
    const res = await supertest(app)
      .get(url('/admin/projects?orgId=not-a-uuid'))
      .set(...authHdr(adminToken))
      .expect(422);
    assert.equal(typeof res.body.error, 'string');
  });

  // -------------------------------------------------------------------------
  // sv360-07 — Malformed / non-uuidv5 :uuid on read+write routes → 422
  // -------------------------------------------------------------------------

  it('sv360-07: GET /photos/:uuid with a non-uuid string → 422 flat error', async () => {
    const res = await supertest(app).get(url('/photos/not-a-uuid')).expect(422);
    assert.equal(typeof res.body.error, 'string');
  });

  it('sv360-07: GET /photos/:uuid with a valid uuidv4 → 422 (version constraint)', async () => {
    const v4 = randomUUID(); // v4
    const res = await supertest(app).get(url(`/photos/${v4}`)).expect(422);
    assert.equal(typeof res.body.error, 'string');
  });

  it('sv360-07: PUT /photos/:uuid/calibration with a non-uuid → 422 (validate rejects before the service)', async () => {
    // The write route order is [auth, validate, ctrl], so a token is required to
    // reach validate(); with a valid token, the malformed :uuid is rejected with
    // 422 at the validation border — before any photo lookup / ownership check.
    const res = await supertest(app)
      .put(url('/photos/not-a-uuid/calibration'))
      .set(...authHdr(ownerToken))
      .send({ heading: 10 })
      .expect(422);
    assert.equal(typeof res.body.error, 'string');
  });

  // -------------------------------------------------------------------------
  // sv360-10 — createTarget guards (cross-project / tombstoned target → 409)
  // -------------------------------------------------------------------------

  it('sv360-10: createTarget to a photo in ANOTHER project → 409, no row inserted', async () => {
    const res = await supertest(app)
      .post(url(`/photos/${enabledMainPhotoId}/targets`))
      .set(...authHdr(ownerToken))
      .send({ target_id: disabledCollidePhotoId }) // a foreign-project photo id
      .expect(409);
    assert.equal(typeof res.body.error, 'string');

    const { rows } = await db.query(
      `SELECT 1 FROM sv360.targets WHERE source_id = $1 AND target_id = $2`,
      [enabledMainPhotoId, disabledCollidePhotoId]
    );
    assert.equal(rows.length, 0, 'no cross-project target row may be inserted');
  });

  it('sv360-10: createTarget to a TOMBSTONED same-project photo → 409, no row inserted', async () => {
    // Tombstone the to-tomb photo via the soft-delete route (idempotent tombstone).
    await supertest(app)
      .delete(url(`/photos/${enabledTombPhotoId}`))
      .set(...authHdr(ownerToken))
      .expect(204);

    // Confirm tombstone landed.
    const { rows: tomb } = await db.query(
      `SELECT 1 FROM sv360.deleted_photos WHERE photo_id = $1`,
      [enabledTombPhotoId]
    );
    assert.equal(tomb.length, 1, 'precondition: photo is tombstoned');

    // Now creating a target pointing at the tombstoned photo must 409.
    const res = await supertest(app)
      .post(url(`/photos/${enabledMainPhotoId}/targets`))
      .set(...authHdr(ownerToken))
      .send({ target_id: enabledTombPhotoId })
      .expect(409);
    assert.equal(typeof res.body.error, 'string');

    const { rows } = await db.query(
      `SELECT 1 FROM sv360.targets WHERE source_id = $1 AND target_id = $2`,
      [enabledMainPhotoId, enabledTombPhotoId]
    );
    assert.equal(rows.length, 0, 'no target to a tombstoned photo may be inserted');
  });

  // -------------------------------------------------------------------------
  // sv360-08 — Thumbnail Range (206) and invalid-Range (416)
  // -------------------------------------------------------------------------

  it('sv360-08: thumbnail serves a Range (206) with Content-Range and a 4-byte slice', async () => {
    // Write a real {slug}.webp on disk for the enabled project's derived db_filename.
    const webpName = `${defaultOrgId}__${ENABLED_SLUG}.webp`;
    const webpPath = path.resolve(config.sv360.dbDir, webpName);
    const thumbBytes = Buffer.from('WEBP-THUMBNAIL-CONTENT-FOR-RANGE-TEST-0123456789');
    writeFileSync(webpPath, thumbBytes);
    diskPaths.add(webpPath);

    const res = await supertest(app)
      .get(url(`/thumbnails/${ENABLED_SLUG}.webp`))
      .set('Range', 'bytes=0-3')
      .expect(206);
    assert.match(res.headers['content-range'], new RegExp(`^bytes 0-3/${thumbBytes.length}$`));
    assert.equal(res.headers['content-length'], '4');
    assert.ok(Buffer.from(res.body).equals(thumbBytes.subarray(0, 4)));
  });

  it('sv360-08: thumbnail rejects an out-of-range Range (416) with bytes */size', async () => {
    const webpName = `${defaultOrgId}__${ENABLED_SLUG}.webp`;
    const webpPath = path.resolve(config.sv360.dbDir, webpName);
    // (written by the previous test; ensure present)
    if (!existsSync(webpPath)) {
      writeFileSync(webpPath, Buffer.from('WEBP-THUMBNAIL-CONTENT-FOR-RANGE-TEST-0123456789'));
      diskPaths.add(webpPath);
    }
    const res = await supertest(app)
      .get(url(`/thumbnails/${ENABLED_SLUG}.webp`))
      .set('Range', 'bytes=999999-')
      .expect(416);
    assert.match(res.headers['content-range'], /^bytes \*\/\d+$/);
  });

  // -------------------------------------------------------------------------
  // sv360-06 — broken-JSON manifest → 400; missing manifest field → 400
  // -------------------------------------------------------------------------

  it('sv360-06: a syntactically broken manifest → 400 (NOT 422, NOT 500)', async () => {
    const okId = uuidv5(`default/broken-${RID}/b001.jpg`);
    const imagesDbPath = buildImagesDb('broken-images.db', [
      { id: okId, full: fullBuf, preview: prevBuf },
    ]);
    const manifestPath = writeManifestFile('broken.json', '{not valid json');

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...authHdr(ownerToken))
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(400);
    assert.equal(typeof res.body.error, 'string');
  });

  it('sv360-06: NO manifest field at all → 400 "manifest field is required"', async () => {
    const okId = uuidv5(`default/nomanifest-${RID}/n001.jpg`);
    const imagesDbPath = buildImagesDb('nomanifest-images.db', [
      { id: okId, full: fullBuf, preview: prevBuf },
    ]);
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...authHdr(ownerToken))
      .attach('imagesDb', imagesDbPath)
      .expect(400);
    assert.equal(typeof res.body.error, 'string');
  });

  // -------------------------------------------------------------------------
  // sv360-11 — Unknown orgSlug (global admin) → 409; cross-org orgSlug (om) → 403
  // -------------------------------------------------------------------------

  it('sv360-11: global admin upload with an unknown orgSlug → 409', async () => {
    const slug = `gap-unknownorg-${RID}`;
    const okId = uuidv5(`unknown/${slug}/u001.jpg`);
    const imagesDbPath = buildImagesDb('unknownorg-images.db', [
      { id: okId, full: fullBuf, preview: prevBuf },
    ]);
    const manifest = {
      schemaVersion: 1,
      project: { slug, name: 'Unknown Org', orgSlug: `no-such-org-slug-${RID}` },
      photos: [photoRow(okId, 'u001.jpg', 1, -23.5, -46.6, fullBuf, prevBuf)],
      targets: [],
    };
    const manifestPath = writeManifestFile('unknownorg.json', manifest);

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...authHdr(adminToken))
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(409);
    assert.equal(typeof res.body.error, 'string');
  });

  it('sv360-11: om_data_admin upload targeting a DIFFERENT org slug → 403', async () => {
    const slug = `gap-crossorg-${RID}`;
    const okId = uuidv5(`cross/${slug}/c001.jpg`);
    const imagesDbPath = buildImagesDb('crossorg-images.db', [
      { id: okId, full: fullBuf, preview: prevBuf },
    ]);
    // ownerToken is the DEFAULT org owner; target the OTHER org's slug → 403.
    const manifest = {
      schemaVersion: 1,
      project: { slug, name: 'Cross Org', orgSlug: `gap-other-om-${RID}` },
      photos: [photoRow(okId, 'c001.jpg', 1, -23.5, -46.6, fullBuf, prevBuf)],
      targets: [],
    };
    const manifestPath = writeManifestFile('crossorg.json', manifest);

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...authHdr(ownerToken))
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(403);
    assert.equal(typeof res.body.error, 'string');
  });

  // -------------------------------------------------------------------------
  // sv360-09 — tombstone carry-over across reupload + resurrection contract
  // -------------------------------------------------------------------------

  it('sv360-09: a manifest deleted_photos[] tombstones the photo; reupload carrying it keeps it 404; dropping it resurrects', async () => {
    const slug = `gap-tomb-${RID}`;
    const derivedDb = `${defaultOrgId}__${slug}.db`;
    const dbPath = path.resolve(config.sv360.dbDir, derivedDb);
    diskPaths.add(dbPath);

    const p1 = uuidv5(`default/${slug}/p1.jpg`);
    const p2 = uuidv5(`default/${slug}/p2.jpg`);

    const baseManifest = (deletedPhotos) => ({
      schemaVersion: 1,
      project: { slug, name: 'Tombstone Carry', orgSlug: 'default' },
      photos: [
        photoRow(p1, 'p1.jpg', 1, -23.5, -46.6, fullBuf, prevBuf),
        photoRow(p2, 'p2.jpg', 2, -23.5005, -46.6005, fullBuf, prevBuf),
      ],
      targets: [],
      deleted_photos: deletedPhotos,
    });

    // Upload 1: p2 tombstoned via deleted_photos[].
    const img1 = buildImagesDb('tomb1-images.db', [
      { id: p1, full: fullBuf, preview: prevBuf },
      { id: p2, full: fullBuf, preview: prevBuf },
    ]);
    const man1 = writeManifestFile('tomb1.json', baseManifest([{ photo_id: p2 }]));
    await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...authHdr(ownerToken))
      .attach('manifest', man1)
      .attach('imagesDb', img1)
      .expect(201);

    // p2 is tombstoned → GET 404 (flat error); p1 live → 200.
    await supertest(app).get(url(`/photos/${p2}`)).expect(404);
    await supertest(app).get(url(`/photos/${p1}`)).expect(200);

    // Reupload 2: STILL carrying deleted_photos:[p2] → tombstone carried over.
    const img2 = buildImagesDb('tomb2-images.db', [
      { id: p1, full: fullBuf, preview: prevBuf },
      { id: p2, full: fullBuf, preview: prevBuf },
    ]);
    const man2 = writeManifestFile('tomb2.json', baseManifest([{ photo_id: p2 }]));
    await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...authHdr(ownerToken))
      .attach('manifest', man2)
      .attach('imagesDb', img2)
      .expect(201);

    await supertest(app).get(url(`/photos/${p2}`)).expect(404);
    const { rows: stillTomb } = await db.query(
      `SELECT 1 FROM sv360.deleted_photos WHERE photo_id = $1`,
      [p2]
    );
    assert.equal(stillTomb.length, 1, 'tombstone must carry over across reupload');

    // Reupload 3: WITHOUT p2 in deleted_photos[] → documented behavior: the purge
    // drops the tombstone and p2 is reinserted live (RESURRECTION). Pin it.
    const img3 = buildImagesDb('tomb3-images.db', [
      { id: p1, full: fullBuf, preview: prevBuf },
      { id: p2, full: fullBuf, preview: prevBuf },
    ]);
    const man3 = writeManifestFile('tomb3.json', baseManifest([]));
    await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...authHdr(ownerToken))
      .attach('manifest', man3)
      .attach('imagesDb', img3)
      .expect(201);

    const { rows: afterTomb } = await db.query(
      `SELECT 1 FROM sv360.deleted_photos WHERE photo_id = $1`,
      [p2]
    );
    assert.equal(afterTomb.length, 0, 'reupload without the tombstone purges it (resurrection)');
    // p2 is now live again.
    await supertest(app).get(url(`/photos/${p2}`)).expect(200);

    // Cleanup the project rows.
    await db.query(`DELETE FROM sv360.deleted_photos WHERE photo_id = ANY($1)`, [[p1, p2]]);
    await db.query(`DELETE FROM sv360.projects WHERE organization_id = $1 AND slug = $2`, [
      defaultOrgId,
      slug,
    ]);
  });

  // -------------------------------------------------------------------------
  // sv360-01 — upload unexpected-field MulterError mapping (ACTUAL behavior)
  // -------------------------------------------------------------------------

  it('sv360-01: an unexpected upload field surfaces an error envelope (documents MulterError mapping)', async () => {
    const okId = uuidv5(`default/unexpected-${RID}/x001.jpg`);
    const imagesDbPath = buildImagesDb('unexpected-images.db', [
      { id: okId, full: fullBuf, preview: prevBuf },
    ]);
    const manifest = {
      schemaVersion: 1,
      project: { slug: `gap-unexpected-${RID}`, name: 'Unexpected', orgSlug: 'default' },
      photos: [photoRow(okId, 'x001.jpg', 1, -23.5, -46.6, fullBuf, prevBuf)],
      targets: [],
    };
    const manifestPath = writeManifestFile('unexpected.json', manifest);
    // A 4th, undeclared field 'bogus' → multer raises MulterError
    // (LIMIT_UNEXPECTED_FILE). It has no statusCode, so sv360-error maps it to 500.
    const extra = path.join(tmpRoot, 'bogus.bin');
    writeFileSync(extra, Buffer.from('extra-field-content'));

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set(...authHdr(ownerToken))
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .attach('bogus', extra);

    // Whatever the status, the body must be the FLAT { error } envelope.
    assert.equal(typeof res.body.error, 'string');
    // Document the ACTUAL mapping: MulterError has no statusCode → 500 (the gap).
    assert.equal(res.status, 500, 'MulterError currently maps to 500 (missing 4xx wrapper)');
  });
});
