// Path: tests/integration/sv360-admin-authz.test.js
// Item 45 (testes-backend.md) — the NEGATIVE half of the two most destructive
// routes in the sv360 module.
//
// `loadWritableProject` (sv360.admin.service.js:110-148) is the ONLY gate on
// PATCH /admin/projects/:slug/status, PATCH /admin/projects/:slug (METADADO, desde
// 2026-08-21) and DELETE /admin/projects/:slug — the last being a HARD delete with
// CASCADE plus an rmSync of the {orgId}__{slug}.db. A TERCEIRA irma entrou aqui um
// commit depois de nascer: enquanto so duas das tres estavam presas, o comportamento
// estava certo e um refactor de `loadWritableProject` abriria a nova com a suite
// verde — que e exatamente a razao de este arquivo existir. Before
// this file both routes were exercised exclusively through their happy path with the
// owner (sv360-ingest.test.js:931-989); the only 403s in the module covered upload.
// Loosening canWriteProject, or dropping the organization_id scope from
// GET_PROJECT_FOR_ADMIN, left every test green while any editor of any OM deleted
// another OM's project. CLAUDE.md: every access filter needs a test with a user that
// does NOT have permission.
//
// The status codes encode a deliberate distinction and are asserted as such:
//   anon                        -> 401 (strict `auth`)
//   LOTADO na OM dona, sem cracha -> 403 (existe, voce pode olhar, nao pode escrever)
//   produtor de OUTRA OM          -> 404 (escopo de producao; a existencia nao vaza)
//
// O EIXO MUDOU NESTA FASE e a fixture com ele: quem autoriza deixou de ser
// `organization_id` + `org_role` (lotacao AUTO-DECLARADA no auto-cadastro) e passou a
// ser `producer_org_id`, o escopo de producao, que so um administrador concede. O ator
// do 403 e justamente o que o modelo antigo deixava ESCREVER.
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
import { createAdminUser, createProducerUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';

const RID = crypto.randomUUID().slice(0, 8);
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing-purposes-only-32chars';

function mintToken({ orgId, role = 'user', producerOrgId = null, sub = crypto.randomUUID() }) {
  return jwt.sign(
    {
      sub, username: `aauth_${RID}_${sub.slice(0, 8)}`, role,
      organization_id: orgId, producer_org_id: producerOrgId,
    },
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

    // O PRODUTOR e o ADMINISTRADOR precisam de LINHA EM `users`, e nao so de claim:
    // a listagem administrativa recorta por `fn_can_produce_resource`, que resolve
    // papel e escopo a partir do UUID no banco. Um `sub` sintetico escreve (o gate de
    // escrita e JS) e nao LE nada, o que produziria um 404 que parece autorizacao e e
    // fixture.
    const produtor = await createProducerUser(db, defaultOrgId, { username: `aauth_prod_${RID}` });
    const administrador = await createAdminUser(db, { username: `aauth_admin_${RID}` });

    ownerToken = mintToken({ orgId: defaultOrgId, producerOrgId: defaultOrgId, sub: produtor.id });
    viewerToken = mintToken({ orgId: defaultOrgId });
    foreignEditorToken = mintToken({ orgId: otherOrgId, producerOrgId: otherOrgId });
    adminToken = mintToken({ orgId: otherOrgId, role: 'admin', sub: administrador.id });

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

  it('LOTADO na OM dona, sem cracha, PATCH status -> 403, status inalterado', async () => {
    const res = await supertest(app)
      .patch(url(`/admin/projects/${SLUG}/status`))
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ status: 'disabled' })
      .expect(403);
    assert.equal(typeof res.body.error, 'string');
    assert.equal(await statusOf(), 'enabled', 'lotacao auto-declarada nao vira visibilidade');
  });

  it('produtor de OUTRA OM PATCH status -> 404 (escopo de producao, sem vazar existencia)', async () => {
    // 404 rather than 403 is deliberate: a foreign OM must not learn the slug exists.
    await supertest(app)
      .patch(url(`/admin/projects/${SLUG}/status`))
      .set('Authorization', `Bearer ${foreignEditorToken}`)
      .send({ status: 'disabled' })
      .expect(404);
    assert.equal(await statusOf(), 'enabled');
  });

  it('o PRODUTOR da OM dona vira o status — controle positivo, para os negativos nao serem sobre rota morta', async () => {
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

  // --- PATCH /admin/projects/:slug (METADADO) --------------------------------
  //
  // O POSITIVO DO PAR nao mora aqui, e de proposito: ele e o produtor da OM dona
  // gravando o video em `tests/integration/catalogo-video-de-previa.test.js`. Sem ele,
  // estes tres negativos passariam identicos se a rota nao existisse.

  /** O `preview_video` gravado, ou null. O efeito que os negativos NAO podem ter. */
  async function previewVideoOf() {
    const { rows } = await db.query('SELECT preview_video FROM sv360.projects WHERE id = $1', [projectId]);
    return rows[0]?.preview_video ?? null;
  }

  it('anonymous PATCH metadado -> 401; o video NAO e gravado', async () => {
    assert.equal(await previewVideoOf(), null, 'piso: o projeto comeca sem video');
    await supertest(app)
      .patch(url(`/admin/projects/${SLUG}`))
      .send({ previewVideo: '/3d/videos/invasor.webm' })
      .expect(401);
    assert.equal(await previewVideoOf(), null);
  });

  it('LOTADO na OM dona, sem cracha, PATCH metadado -> 403; o video NAO e gravado', async () => {
    await supertest(app)
      .patch(url(`/admin/projects/${SLUG}`))
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ previewVideo: '/3d/videos/invasor.webm' })
      .expect(403);
    assert.equal(await previewVideoOf(), null, 'lotacao auto-declarada nao vira escrita');
  });

  it('produtor de OUTRA OM PATCH metadado -> 404 (escopo de producao, sem vazar existencia)', async () => {
    await supertest(app)
      .patch(url(`/admin/projects/${SLUG}`))
      .set('Authorization', `Bearer ${foreignEditorToken}`)
      .send({ previewVideo: '/3d/videos/invasor.webm' })
      .expect(404);
    assert.equal(await previewVideoOf(), null);
  });

  // --- PATCH /admin/projects/:slug/owner-org (TRANSFERÊNCIA DE OM, só-admin) ----

  async function orgDe() {
    const { rows } = await db.query('SELECT organization_id FROM sv360.projects WHERE id = $1', [projectId]);
    return rows[0]?.organization_id ?? null;
  }

  it('produtor NÃO transfere de OM (requireAdmin) -> 403; a OM não muda', async () => {
    assert.equal(await orgDe(), defaultOrgId, 'piso: começa na OM default');
    await supertest(app)
      .patch(url(`/admin/projects/${SLUG}/owner-org`))
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ owner_org_id: otherOrgId })
      .expect(403);
    assert.equal(await orgDe(), defaultOrgId);
  });

  it('o ADMINISTRADOR transfere por TROCA DE COLUNA, e o arquivo NÃO é renomeado', async () => {
    assert.equal(existsSync(dbPath), true, 'piso: o arquivo existe antes');
    await supertest(app)
      .patch(url(`/admin/projects/${SLUG}/owner-org`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ owner_org_id: otherOrgId })
      .expect(200);
    assert.equal(await orgDe(), otherOrgId, 'a OM mudou');
    assert.equal(existsSync(dbPath), true, 'o arquivo {orgOrig}__{slug}.db continua no lugar');

    // OM inexistente é 400, não 500 de FK crua. (Já está na otherOrg; desambigua por ?orgId.)
    await supertest(app)
      .patch(url(`/admin/projects/${SLUG}/owner-org?orgId=${otherOrgId}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ owner_org_id: crypto.randomUUID() })
      .expect(400);

    // RESTAURA à OM default, para os casos de DELETE abaixo partirem do piso.
    await supertest(app)
      .patch(url(`/admin/projects/${SLUG}/owner-org?orgId=${otherOrgId}`))
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ owner_org_id: defaultOrgId })
      .expect(200);
    assert.equal(await orgDe(), defaultOrgId, 'restaurada à OM default');
  });

  it('o SLUG é único GLOBAL: nem dá para plantar o mesmo slug em outra OM (a colisão é impossível)', async () => {
    // Desde 2026-08-29 o slug é `UNIQUE(slug)` global, como no ebgeo_360, porque o arquivo é
    // `{slug}_tiles.db` sem prefixo de OM. Então a "colisão de transferência" que este caso media
    // não pode nem existir: criar um segundo projeto com o mesmo slug em QUALQUER OM viola a
    // restrição. É a invariante que torna a transferência de OM sempre segura (não há para onde
    // colidir).
    await assert.rejects(
      db.query(
        `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, photo_count)
         VALUES ($1, $2, $3, $4, 0)`,
        [otherOrgId, SLUG, `Colisao ${RID}`, `${SLUG}.db`],
      ),
      /projects_slug_key|unicidade|unique/i,
      'o UNIQUE(slug) recusa um segundo projeto com o mesmo slug',
    );
    assert.equal(await orgDe(), defaultOrgId, 'e o projeto original segue na OM default');
  });

  // --- POST /admin/projects/:slug/thumbnail (TROCA DE THUMBNAIL) ---------------

  // WebP 1x1 real (magic bytes RIFF....WEBP), o mesmo dos testes de capa de atlas.
  const WEBP_1X1 = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64');

  it('anonymous troca de thumbnail -> 401', async () => {
    await supertest(app)
      .post(url(`/admin/projects/${SLUG}/thumbnail`))
      .attach('thumbnail', WEBP_1X1, { filename: 't.webp', contentType: 'image/webp' })
      .expect(401);
  });

  it('o produtor da OM troca a thumbnail com um WebP válido -> 200, e o arquivo é gravado', async () => {
    const thumbPath = dbPath.replace(/\.db$/i, '.webp');
    if (existsSync(thumbPath)) rmSync(thumbPath, { force: true });
    await supertest(app)
      .post(url(`/admin/projects/${SLUG}/thumbnail`))
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('thumbnail', WEBP_1X1, { filename: 't.webp', contentType: 'image/webp' })
      .expect(200);
    assert.equal(existsSync(thumbPath), true, 'a thumbnail org-keyed foi escrita');
    rmSync(thumbPath, { force: true });
  });

  it('uma imagem que NÃO é WebP (por magic bytes) -> 400', async () => {
    // PNG 1x1 rotulado como webp: o mime declarado não é evidência, os bytes decidem.
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    await supertest(app)
      .post(url(`/admin/projects/${SLUG}/thumbnail`))
      .set('Authorization', `Bearer ${ownerToken}`)
      .attach('thumbnail', PNG, { filename: 'fake.webp', contentType: 'image/webp' })
      .expect(400);
  });

  // --- DELETE /admin/projects/:slug ------------------------------------------

  it('anonymous DELETE -> 401; the row AND the {orgId}__{slug}.db survive', async () => {
    const res = await supertest(app).delete(url(`/admin/projects/${SLUG}`)).expect(401);
    assert.equal(typeof res.body.error, 'string');
    assert.notEqual(await statusOf(), null, 'the project row must survive');
    assert.equal(existsSync(dbPath), true, 'the SQLite file must survive');
  });

  it('LOTADO na OM dona, sem cracha, DELETE -> 403; linha e arquivo intactos', async () => {
    await supertest(app)
      .delete(url(`/admin/projects/${SLUG}`))
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);
    assert.notEqual(await statusOf(), null);
    assert.equal(existsSync(dbPath), true);
  });

  it('produtor de OUTRA OM DELETE -> 404; linha e arquivo intactos', async () => {
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
    //
    // O `_tiles.db` (o arquivo GRANDE, única fonte de pixel do acervo só-tiles) e a thumbnail
    // org-keyed são plantados aqui: até 2026-08-29 o hard-delete só apagava o `{slug}.db` e
    // deixava esses dois órfãos em disco. Este par prova que os três somem juntos.
    const tilesPath = dbPath.replace(/\.db$/i, '_tiles.db');
    const thumbPath = dbPath.replace(/\.db$/i, '.webp');
    writeFileSync(tilesPath, Buffer.from('SQLite format 3\0'));
    writeFileSync(thumbPath, Buffer.from('RIFF'));

    await supertest(app)
      .delete(url(`/admin/projects/${SLUG}`))
      .query({ orgSlug: 'default' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    assert.equal(await statusOf(), null, 'the row is hard-deleted');
    assert.equal(existsSync(dbPath), false, 'the SQLite file is removed with it');
    assert.equal(existsSync(tilesPath), false, 'o {slug}_tiles.db (o arquivo grande) também é removido');
    assert.equal(existsSync(thumbPath), false, 'a thumbnail org-keyed também é removida');
  });
});
