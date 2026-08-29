// Path: tests/integration/sv360-cache-scope.test.js
// P6 — the cache scope of an sv360 binary must match its access scope.
//
// Image and thumbnail responses were emitted with
// `Cache-Control: public, max-age=31536000, immutable` and no `Vary`,
// unconditionally. `public` authorizes a SHARED cache (CDN / corporate proxy) to
// store the response and replay it to anybody. For a `disabled` project — which
// is access-controlled to admins and the owning org — that means one authorized
// fetch can be re-served to an anonymous caller straight from the proxy, with the
// application never consulted.
//
// `enabled` projects are genuinely public, so they keep `public, immutable`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createProducerUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';
import { buildTilesDb } from '../helpers/sv360-tiles.js';

const RID = crypto.randomUUID().slice(0, 8);
const JWT_SECRET = process.env.JWT_SECRET;

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

// A LEITURA DE PROJETO OCULTO/PRIVADO passou de `organization_id` (LOTACAO
// auto-declarada no auto-cadastro) para `producer_org_id` (ESCOPO DE PRODUCAO,
// concedido por administrador) e e resolvida NO SQL, a partir do UUID — por isso o
// `sub` destes tokens precisa ser um usuario de VERDADE.
function mintToken({ orgId, role = 'user', producerOrgId = null, sub = crypto.randomUUID() }) {
  return jwt.sign(
    {
      sub, username: `cache_${RID}_${sub.slice(0, 8)}`, role,
      organization_id: orgId, producer_org_id: producerOrgId,
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' }
  );
}

const ENABLED_SLUG = `cache-enabled-${RID}`;
const DISABLED_SLUG = `cache-disabled-${RID}`;
const url = (p) => `/api/v1/sv360${p}`;

// Minimal but valid WebP-ish payloads (the route never decodes them).
const fullBuf = Buffer.from('RIFFxxxxWEBPfakefull-0123456789ABCDEF');
const prevBuf = Buffer.from('RIFFxxxxWEBPfakeprev');

describe('sv360 cache scope matches access scope (P6)', () => {
  let app, db;
  let defaultOrgId, otherOrgId;
  let enabledPhotoId, disabledPhotoId;
  let ownerToken, otherOrgToken;
  let tmpRoot;
  const diskPaths = new Set();

  // Tiles-only: a rota de imagem saiu, entao a mesma logica de cache (setTileHeaders,
  // dois eixos) e exercitada pela rota de TILE. O arquivo de pixel e o `{slug}_tiles.db`,
  // derivado do db_filename, e cada foto ganha um descritor em `sv360.photo_pyramids`.
  function buildImagesDb(fileName, rows) {
    const p = path.join(config.sv360.dbDir, fileName.replace(/\.db$/i, '_tiles.db'));
    if (existsSync(p)) rmSync(p, { force: true });
    buildTilesDb(p, rows.map((r) => r.id));
    diskPaths.add(p);
    return p;
  }

  async function inserirPiramide(photoId) {
    await db.query(
      `INSERT INTO sv360.photo_pyramids
         (photo_id, tile_size, max_level, width, height, quality, tile_count, total_bytes, razao)
       VALUES ($1, 512, 0, 1024, 512, 80, 1, 24, 2)`,
      [photoId]
    );
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    tmpRoot = path.join(os.tmpdir(), `sv360-cache-${RID}`);
    mkdirSync(tmpRoot, { recursive: true });
    mkdirSync(config.sv360.dbDir, { recursive: true });

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    defaultOrgId = org.rows[0].id;
    const org2 = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla) VALUES ($1, $2, 'CCH') RETURNING id`,
      [`Cache OM ${RID}`, `cache-om-${RID}`]
    );
    otherOrgId = org2.rows[0].id;

    const produtor = await createProducerUser(db, defaultOrgId, { username: `cache_pa_${RID}` });
    const produtorOutra = await createProducerUser(db, otherOrgId, { username: `cache_pb_${RID}` });
    ownerToken = mintToken({ orgId: defaultOrgId, producerOrgId: defaultOrgId, sub: produtor.id });
    otherOrgToken = mintToken({ orgId: otherOrgId, producerOrgId: otherOrgId, sub: produtorOutra.id });

    // ── ENABLED project (public) in the default org ──
    const enabledDb = `${defaultOrgId}__${ENABLED_SLUG}.db`;
    const p1 = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, $3, -23.5, -46.6, $4, 'enabled', 1) RETURNING id`,
      [defaultOrgId, ENABLED_SLUG, `Cache Enabled ${RID}`, enabledDb]
    );
    enabledPhotoId = uuidv5(`enabled/${ENABLED_SLUG}/p.jpg`);
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
          full_size_bytes, preview_size_bytes)
       VALUES ($1, $2, 'p.jpg', 'P', 1, -23.5, -46.6, 700, $3, $4)`,
      [enabledPhotoId, p1.rows[0].id, fullBuf.length, prevBuf.length]
    );
    buildImagesDb(enabledDb, [{ id: enabledPhotoId, full: fullBuf, preview: prevBuf }]);
    await inserirPiramide(enabledPhotoId);

    // ── DISABLED project (access-controlled) in the OTHER org ──
    const disabledDb = `${otherOrgId}__${DISABLED_SLUG}.db`;
    const p2 = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, $3, -10.0, -50.0, $4, 'disabled', 1) RETURNING id`,
      [otherOrgId, DISABLED_SLUG, `Cache Disabled ${RID}`, disabledDb]
    );
    disabledPhotoId = uuidv5(`disabled/${DISABLED_SLUG}/p.jpg`);
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
          full_size_bytes, preview_size_bytes)
       VALUES ($1, $2, 'p.jpg', 'P', 1, -10.0, -50.0, 100, $3, $4)`,
      [disabledPhotoId, p2.rows[0].id, fullBuf.length, prevBuf.length]
    );
    buildImagesDb(disabledDb, [{ id: disabledPhotoId, full: fullBuf, preview: prevBuf }]);
    await inserirPiramide(disabledPhotoId);
  });

  after(async () => {
    for (const p of diskPaths) {
      try {
        rmSync(p, { force: true });
      } catch {
        /* best effort */
      }
    }
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    await teardownTestEnv(db);
  });

  it('an ENABLED project image stays publicly cacheable', async () => {
    // Genuinely public content — a shared cache SHOULD serve it.
    const res = await supertest(app)
      .get(url(`/photos/${enabledPhotoId}/tiles/0/0/0`))
      .expect(200);

    assert.match(res.headers['cache-control'], /public/);
    assert.match(res.headers['cache-control'], /immutable/);
  });

  it('O SEGUNDO EIXO: `enabled + private` também deixa de ser publicamente cacheável', async () => {
    // O EIXO DE PRIVACIDADE NASCEU NA FASE F6 E ESTA DECISÃO NÃO O TINHA APRENDIDO.
    // `setImmutableHeaders` decidia só por `status`, então a imagem de um projeto
    // `enabled + private` — que só alcança quem tem concessão ou empréstimo — saía
    // marcada `public, max-age=31536000, immutable`: um CDN podia guardá-la por um ANO
    // e repor a qualquer um, com a aplicação nunca consultada. Corrigido na F9.
    //
    // A DISCRIMINAÇÃO É O MESMO BYTE. O projeto, a foto e o ETag são os mesmos nas duas
    // metades; a única coisa que muda é a coluna `access_level`. Um caso com dois
    // projetos diferentes não separaria "o eixo passou a contar" de "este projeto sempre
    // foi tratado assim".
    const publico = await supertest(app)
      .get(url(`/photos/${enabledPhotoId}/tiles/0/0/0`))
      .expect(200);
    assert.match(publico.headers['cache-control'], /^public,/, 'piso: enabled+public é público');

    await db.query(
      `UPDATE sv360.projects SET access_level = 'private' WHERE slug = $1`, [ENABLED_SLUG]
    );
    try {
      const privado = await supertest(app)
        .get(url(`/photos/${enabledPhotoId}/tiles/0/0/0`))
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      assert.match(privado.headers['cache-control'], /^private,/);
      assert.match(privado.headers.vary ?? '', /Authorization/);
      assert.equal(privado.headers.etag, publico.headers.etag, 'o ETag é dos BYTES e não muda');
    } finally {
      await db.query(
        `UPDATE sv360.projects SET access_level = 'public' WHERE slug = $1`, [ENABLED_SLUG]
      );
    }
    // E o par de volta: remarcado público, volta a ser publicamente cacheável.
    const devolta = await supertest(app)
      .get(url(`/photos/${enabledPhotoId}/tiles/0/0/0`))
      .expect(200);
    assert.match(devolta.headers['cache-control'], /^public,/);
  });

  it('a DISABLED project image is NOT publicly cacheable', async () => {
    // Authorized fetch by the owning org — the bytes come back…
    const res = await supertest(app)
      .get(url(`/photos/${disabledPhotoId}/tiles/0/0/0`))
      .set('Authorization', `Bearer ${otherOrgToken}`)
      .expect(200);

    // …but a shared cache must not be allowed to keep and replay them.
    assert.doesNotMatch(
      res.headers['cache-control'],
      /public/,
      'an access-controlled image must never be marked publicly cacheable'
    );
    assert.match(res.headers['cache-control'], /private/);
  });

  it('a DISABLED project image varies by credential (proxy belt-and-braces)', async () => {
    const res = await supertest(app)
      .get(url(`/photos/${disabledPhotoId}/tiles/0/0/0`))
      .set('Authorization', `Bearer ${otherOrgToken}`)
      .expect(200);

    const vary = res.headers['vary'] || '';
    assert.match(vary, /Authorization/i, 'response must declare it varies by credential');
  });

  it('the access rule itself is unchanged — a foreign org still gets 404', async () => {
    // Guard: P6 is about cache headers only. It must not have loosened the gate.
    await supertest(app)
      .get(url(`/photos/${disabledPhotoId}/tiles/0/0/0`))
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);

    await supertest(app)
      .get(url(`/photos/${disabledPhotoId}/tiles/0/0/0`))
      .expect(404);
  });

  it('caching still works where it should — the ETag/304 path is intact', async () => {
    const first = await supertest(app)
      .get(url(`/photos/${enabledPhotoId}/tiles/0/0/0`))
      .expect(200);

    const etag = first.headers['etag'];
    assert.ok(etag, 'an ETag must still be emitted');

    await supertest(app)
      .get(url(`/photos/${enabledPhotoId}/tiles/0/0/0`))
      .set('If-None-Match', etag)
      .expect(304);
  });
});
