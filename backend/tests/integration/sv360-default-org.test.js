// Path: tests/integration/sv360-default-org.test.js
// DEFAULT_ORG_ID (sv360.merge.js) versus the organization the MIGRATION actually
// seeds. The constant is a literal uuid duplicated from 001_core.sql; nothing binds
// the two. sv360-gaps.test.js sv360-11 covers an UNKNOWN orgSlug (409) and a
// cross-org attempt (403) — never the default/legacy branch, which is the one a
// global admin hits whenever a manifest omits project.orgSlug (the ETL backfill's
// normal shape).
//
// If the seed ever changes, resolveOrgIdBySlug keeps returning a uuid that no
// organization row carries, and UPSERT_PROJECT fails on the FK with an opaque 500 at
// upload time. The assertion here is deliberately NOT `DEFAULT_ORG_ID === '0000…1'`
// — that would be the constant restating itself. It is the PERSISTED
// organization_id compared against a live SELECT of the org whose slug is 'default'.

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
import { resolveOrgIdBySlug } from '../../src/modules/streetview360/sv360.merge.js';

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

// One slug per marker so the three uploads cannot mask one another via the
// "last upload wins" upsert.
const SLUGS = {
  ausente: `defaultorg-ausente-${RID}`,
  vazio: `defaultorg-vazio-${RID}`,
  legacy: `defaultorg-legacy-${RID}`,
};

const full = Buffer.from('RIFFxxxxWEBP-default-org-full-payload');
const prev = Buffer.from('RIFFxxxxWEBP-prev');

const url = (p) => `/api/v1/sv360${p}`;

describe('StreetView 360 — a org default do merge é a org que a migração semeia', () => {
  let app, db, tmpRoot, adminToken, seededDefaultOrgId, otherOrgId;
  const criados = [];

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

  function writeManifest(name, obj) {
    const p = path.join(tmpRoot, name);
    writeFileSync(p, JSON.stringify(obj));
    return p;
  }

  function manifestFor(slug, photoId, projectExtra) {
    return {
      schemaVersion: 1,
      project: { slug, name: `Projeto ${slug}`, center_lat: -23.5, center_long: -46.6, ...projectExtra },
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
  }

  /** Uploads a bundle as the GLOBAL admin and returns the 201 body. */
  async function upload(slug, projectExtra) {
    const photoId = uuidv5(`default/${slug}/foto.jpg`);
    const imagesDbPath = buildImagesDb(`${slug}.images.db`, [photoId]);
    const manifestPath = writeManifest(`${slug}.manifest.json`, manifestFor(slug, photoId, projectExtra));
    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(201);
    criados.push({ slug, photoId, dbFilename: res.body.dbFilename });
    return res.body;
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    // A org semeada pela migração, lida do BANCO — nunca da constante.
    const seeded = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    assert.equal(seeded.rows.length, 1, 'guard: a migração precisa semear exatamente uma org `default`');
    seededDefaultOrgId = seeded.rows[0].id;

    const other = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla)
       VALUES ('Outra OM DefaultOrg', $1, 'ODOR')
       ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`,
      [`sv360-defaultorg-other-${RID}`]
    );
    otherOrgId = other.rows[0].id;

    // Admin GLOBAL cuja org de lotação é a OUTRA: assim, se a resolução caísse para
    // `user.organization_id` em vez da org default, o teste veria a diferença.
    adminToken = jwt.sign(
      {
        sub: crypto.randomUUID(),
        username: `sv360admin_${RID}`,
        role: 'admin',
        organization_id: otherOrgId,
        org_role: 'viewer',
      },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );

    tmpRoot = path.join(os.tmpdir(), `sv360-defaultorg-${RID}`);
    mkdirSync(tmpRoot, { recursive: true });
    mkdirSync(config.sv360.dbDir, { recursive: true });
  });

  after(async () => {
    await closeStore();
    for (const c of criados) {
      if (!c.dbFilename) continue;
      const dest = path.resolve(config.sv360.dbDir, c.dbFilename);
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
    await db.query(`DELETE FROM sv360.deleted_photos WHERE photo_id = ANY($1::text[])`, [
      criados.map((c) => c.photoId),
    ]);
    await db.query(`DELETE FROM sv360.projects WHERE slug = ANY($1::text[])`, [
      Object.values(SLUGS),
    ]);
    await db.query(`DELETE FROM public.organizations WHERE id = $1`, [otherOrgId]);
    await teardownTestEnv(db);
  });

  it('upload de admin global SEM orgSlug cai na org que a migração semeou como `default`', async () => {
    const body = await upload(SLUGS.ausente, {});
    assert.equal(body.slug, SLUGS.ausente);

    const { rows } = await db.query(
      `SELECT organization_id, db_filename FROM sv360.projects WHERE slug = $1`,
      [SLUGS.ausente]
    );
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0].organization_id,
      seededDefaultOrgId,
      'a constante DEFAULT_ORG_ID e a semente da migração divergiram'
    );
    // E não a org de lotação do admin: o ramo default não pode ser confundido com
    // "a org de quem enviou".
    assert.notEqual(rows[0].organization_id, otherOrgId);
  });

  it('o db_filename persistido é prefixado por ESSA mesma org, e o arquivo existe em disco', async () => {
    // Prova que a derivação do nome e o merge concordaram sobre a org: se o merge
    // resolvesse uma org e a derivação outra, o Postgres apontaria para um arquivo
    // que a ingestão nunca escreveu.
    const { rows } = await db.query(`SELECT db_filename FROM sv360.projects WHERE slug = $1`, [
      SLUGS.ausente,
    ]);
    assert.equal(rows[0].db_filename, `${seededDefaultOrgId}__${SLUGS.ausente}.db`);
    assert.ok(
      existsSync(path.resolve(config.sv360.dbDir, rows[0].db_filename)),
      'o {orgId}__{slug}.db precisa existir em SV360_DB_DIR'
    );
  });

  it("o marcador legado 'org-legacy' resolve para a MESMA org default", async () => {
    // LEGACY_ORG_SLUGS é uma lista fechada; se um marcador sair dela, o upload
    // passa a 409 ("Unknown organization slug") em vez de cair no default.
    await upload(SLUGS.legacy, { orgSlug: 'org-legacy' });

    const { rows } = await db.query(
      `SELECT organization_id FROM sv360.projects WHERE slug = $1`,
      [SLUGS.legacy]
    );
    assert.equal(rows.length, 1, 'o upload legado precisa ter criado projeto');
    assert.equal(rows[0].organization_id, seededDefaultOrgId, 'o marcador legado não caiu no default');
  });

  it("orgSlug '' NÃO é alcançável por HTTP (o Joi barra antes) — só pela ETL", async () => {
    // REFUTA a expectativa de que os dois marcadores legados sejam equivalentes na
    // rota: projectSchema declara orgSlug com .min(1), então a string vazia morre
    // como 422 na borda e nunca chega a resolveOrgIdBySlug. O ramo LEGACY_ORG_SLUGS
    // para '' existe para o backfill da ETL, que chama a função direto. Registrado
    // aqui para que ninguém "corrija" um dos dois lados achando que discordam.
    const slug = SLUGS.vazio;
    const photoId = uuidv5(`default/${slug}/foto.jpg`);
    const imagesDbPath = buildImagesDb(`${slug}.images.db`, [photoId]);
    const manifestPath = writeManifest(`${slug}.manifest.json`, manifestFor(slug, photoId, { orgSlug: '' }));

    await supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(422);

    // O caminho da ETL: a função pura resolve os marcadores SEM consultar o banco
    // (o task passado explode se for usado), e o valor devolvido é a org semeada.
    const explode = {
      oneOrNone() {
        throw new Error('um marcador legado não pode consultar organizations');
      },
    };
    for (const marker of ['', 'default', 'org-legacy', null, undefined, '  ']) {
      const resolved = await resolveOrgIdBySlug(explode, marker);
      assert.equal(resolved, seededDefaultOrgId, `marcador ${JSON.stringify(marker)} não caiu no default`);
    }
  });

  it("contraste: um orgSlug DESCONHECIDO não vira default — 409, e nenhum projeto é criado", async () => {
    // Sem este caso, tudo acima passaria com um resolveOrgIdBySlug que ignorasse o
    // slug e devolvesse a org default para QUALQUER entrada.
    const slug = `defaultorg-desconhecido-${RID}`;
    const photoId = uuidv5(`default/${slug}/foto.jpg`);
    const imagesDbPath = buildImagesDb(`${slug}.images.db`, [photoId]);
    const manifestPath = writeManifest(
      `${slug}.manifest.json`,
      manifestFor(slug, photoId, { orgSlug: `nao-existe-${RID}` })
    );

    const res = await supertest(app)
      .post(url('/admin/projects/upload'))
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('manifest', manifestPath)
      .attach('imagesDb', imagesDbPath)
      .expect(409);
    assert.match(res.body.error, /Unknown organization slug/);

    const { rows } = await db.query(`SELECT 1 FROM sv360.projects WHERE slug = $1`, [slug]);
    assert.equal(rows.length, 0, 'um slug de org inexistente não pode criar projeto em lugar nenhum');
  });
});
