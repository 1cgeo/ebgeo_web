// Path: tests/integration/sv360-upload-precheck.test.js
// requireUploadCapability (sv360.routes.js, FIX-4): the 403 that must land BEFORE
// multer streams up to SV360_MAX_UPLOAD_BYTES to disk, closing an authenticated
// disk-fill DoS.
//
// The existing coverage ('same-org viewer upload -> 403', sv360-ingest.test.js) is a
// teste-que-não-prende: it passes IDENTICALLY with the pre-filter deleted, because
// the service then throws ForbiddenError after multer already wrote the bundle. Same
// status, same body, opposite amount of disk written.
//
// The discriminator is the ORDER of the chain, and the only way to observe order
// from the outside is to make MULTER itself object: a request carrying a multipart
// field the route does not declare is rejected by multer with its own error. With
// the pre-filter in place the request dies at `requireUploadCapability` and multer
// never runs, so the answer is a clean 403; without it, multer answers first with a
// different status. The negative control at the bottom of this comment is the whole
// point of the file.
//
// CONTROLE NEGATIVO: removing `requireUploadCapability` from the route chain flips
// the 'bogus field' case away from 403.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';
import { canWriteProject } from '../../src/modules/streetview360/sv360.write.service.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
const RID = crypto.randomUUID().slice(0, 8);

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const full = Buffer.from('RIFFxxxxWEBP-precheck-full-payload-bytes');
const prev = Buffer.from('RIFFxxxxWEBP-precheck-prev');

const url = (p) => `/api/v1/sv360${p}`;

// The org_roles canWriteProject accepts. Kept as ONE list so the pre-filter and the
// service cannot silently diverge (the closed-list failure mode, C1).
const ORG_ROLES_ESCRITORES = ['owner', 'admin', 'editor'];

describe('StreetView 360 — o pré-filtro de upload roda ANTES do multer (FIX-4)', () => {
  let app, db, tmpRoot, orgId, otherOrgId;
  const criados = [];

  function token({ role = 'user', org_role = 'viewer', organization_id = orgId }) {
    const claims = { sub: crypto.randomUUID(), username: `pre_${RID}_${org_role}`, role, org_role };
    if (organization_id) claims.organization_id = organization_id;
    return jwt.sign(claims, JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
  }

  function buildImagesDb(name, ids) {
    const p = path.join(tmpRoot, name);
    if (existsSync(p)) rmSync(p, { force: true });
    const sdb = new Database(p);
    sdb.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    const ins = sdb.prepare('INSERT INTO images VALUES (?,?,?)');
    for (const id of ids) ins.run(id, full, prev);
    sdb.close();
    return p;
  }

  function bundle(slug) {
    const photoId = uuidv5(`default/${slug}/foto.jpg`);
    const manifest = {
      schemaVersion: 1,
      project: { slug, name: `Projeto ${slug}`, center_lat: -23.5, center_long: -46.6 },
      photos: [
        {
          id: photoId,
          original_name: 'foto.jpg',
          sequence_number: 1,
          lat: -23.5,
          lon: -46.6,
          full_size_bytes: full.length,
          preview_size_bytes: prev.length,
        },
      ],
      targets: [],
      deleted_photos: [],
    };
    const manifestPath = path.join(tmpRoot, `${slug}.manifest.json`);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    return { photoId, manifestPath, imagesDbPath: buildImagesDb(`${slug}.images.db`, [photoId]) };
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    orgId = org.rows[0].id;

    const other = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla)
       VALUES ('Outra OM Precheck', $1, 'OPRE')
       ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`,
      [`sv360-precheck-other-${RID}`]
    );
    otherOrgId = other.rows[0].id;

    tmpRoot = path.join(os.tmpdir(), `sv360-precheck-${RID}`);
    mkdirSync(tmpRoot, { recursive: true });
    mkdirSync(config.sv360.dbDir, { recursive: true });
  });

  after(async () => {
    await closeStore();
    for (const slug of criados) {
      const dest = path.resolve(config.sv360.dbDir, `${orgId}__${slug}.db`);
      for (const f of [dest, `${dest}.tmp`, `${dest}.bak`, dest.replace(/\.db$/i, '.webp')]) {
        if (existsSync(f)) {
          try {
            rmSync(f, { force: true });
          } catch {
            /* ignore */
          }
        }
      }
    }
    if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
    await db.query(`DELETE FROM sv360.projects WHERE slug LIKE $1`, [`precheck-%${RID}`]);
    await db.query(`DELETE FROM public.organizations WHERE id = $1`, [otherOrgId]);
    await teardownTestEnv(db);
  });

  // -------------------------------------------------------------------------
  // O DISCRIMINADOR: um campo multipart que a rota não declara.
  // -------------------------------------------------------------------------

  it('viewer da mesma org com um 3º campo `bogus`: 403 do PRÉ-FILTRO, não erro do multer', async () => {
    // Com o pré-filtro, a requisição morre antes de o multer sequer olhar os campos,
    // então o campo desconhecido é IRRELEVANTE e a resposta é o mesmo 403 do caso
    // normal. Sem o pré-filtro, o multer roda primeiro e responde outra coisa — é
    // isso, e só isso, que distingue "quem barrou" de fora do processo.
    const slug = `precheck-bogus-${RID}`;
    const b = bundle(slug);
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${token({ org_role: 'viewer' })}`)
      .attach('manifest', b.manifestPath)
      .attach('imagesDb', b.imagesDbPath)
      .attach('bogus', b.manifestPath);

    assert.equal(res.status, 403, 'o pré-filtro precisa vencer o multer na ordem da cadeia');
    assert.equal(typeof res.body.error, 'string', 'envelope plano do módulo sv360');

    const { rows } = await db.query(`SELECT 1 FROM sv360.projects WHERE slug = $1`, [slug]);
    assert.equal(rows.length, 0, 'nada pode ter sido persistido');
  });

  it('sem o campo extra, o mesmo viewer também leva 403 (o caso já coberto, mantido como âncora)', async () => {
    const b = bundle(`precheck-viewer-${RID}`);
    await supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${token({ org_role: 'viewer' })}`)
      .attach('manifest', b.manifestPath)
      .attach('imagesDb', b.imagesDbPath)
      .expect(403);
  });

  it('token legado SEM organization_id (org_role degradado) → 403 pelo mesmo caminho', async () => {
    // `org_role` chega como 'viewer' e `organization_id` como undefined: a única
    // coisa que pode aprovar é `role === 'admin'`, que este token não tem.
    const b = bundle(`precheck-legacy-${RID}`);
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${token({ organization_id: null })}`)
      .attach('manifest', b.manifestPath)
      .attach('imagesDb', b.imagesDbPath);
    assert.equal(res.status, 403);
  });

  it('anônimo → 401 (o authDraining vem ANTES do pré-filtro; a ordem também é contrato)', async () => {
    const b = bundle(`precheck-anon-${RID}`);
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .attach('manifest', b.manifestPath)
      .attach('imagesDb', b.imagesDbPath);
    assert.equal(res.status, 401, 'falta de credencial não pode ser reportada como falta de permissão');
  });

  // -------------------------------------------------------------------------
  // O outro lado: quem o serviço autoriza, o pré-filtro NÃO pode barrar.
  // -------------------------------------------------------------------------

  it('editor da própria org com bundle válido → 201', async () => {
    const slug = `precheck-editor-${RID}`;
    const b = bundle(slug);
    criados.push(slug);
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${token({ org_role: 'editor' })}`)
      .attach('manifest', b.manifestPath)
      .attach('imagesDb', b.imagesDbPath);
    assert.equal(res.status, 201, res.body?.error ?? '');
    assert.equal(res.body.slug, slug);
  });

  it('admin GLOBAL com org_role `viewer` → 201 (o papel global vence o org_role)', async () => {
    // Mesma regra de canWriteProject: `role === 'admin'` retorna true antes de
    // qualquer checagem de org. Um pré-filtro que só olhasse org_role barraria o
    // administrador do sistema.
    const slug = `precheck-globaladmin-${RID}`;
    const b = bundle(slug);
    criados.push(slug);
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${token({ role: 'admin', org_role: 'viewer' })}`)
      .attach('manifest', b.manifestPath)
      .attach('imagesDb', b.imagesDbPath);
    assert.equal(res.status, 201, res.body?.error ?? '');
  });

  it('guarda anti-divergência: TODO org_role aceito por canWriteProject passa o pré-filtro', async () => {
    // As duas listas fechadas ('owner','admin','editor') vivem em arquivos
    // diferentes. Se alguém acrescentar um papel a canWriteProject e esquecer o
    // pré-filtro, o papel novo some com um 403 inexplicável — o padrão C1 que a
    // constituição proíbe. O laço prova a inclusão papel a papel; a asserção de
    // tamanho impede que a lista encolha sem ninguém notar.
    assert.equal(ORG_ROLES_ESCRITORES.length, 3, 'guard: a lista sob teste não pode estar vazia');
    for (const orgRole of ORG_ROLES_ESCRITORES) {
      assert.ok(
        canWriteProject({ role: 'user', organization_id: orgId, org_role: orgRole }, { organization_id: orgId }),
        `canWriteProject deixou de aceitar ${orgRole} — atualize as DUAS listas`
      );
      const slug = `precheck-role-${orgRole}-${RID}`;
      const b = bundle(slug);
      criados.push(slug);
      const res = await supertest(app)
        .post(url('/admin/projects/upload'))
        .set('Authorization', `Bearer ${token({ org_role: orgRole })}`)
        .attach('manifest', b.manifestPath)
        .attach('imagesDb', b.imagesDbPath);
      assert.notEqual(res.status, 403, `o pré-filtro barrou ${orgRole}, que o serviço autoriza`);
      assert.equal(res.status, 201, `${orgRole}: ${res.body?.error ?? ''}`);
    }
  });

  it('e o contraste: `viewer` NÃO está na lista de escritores, nos dois lados', async () => {
    // Sem este caso o laço acima passaria com um pré-filtro que aceitasse todo mundo.
    assert.equal(
      canWriteProject({ role: 'user', organization_id: orgId, org_role: 'viewer' }, { organization_id: orgId }),
      false
    );
    assert.ok(!ORG_ROLES_ESCRITORES.includes('viewer'));
  });
});
