// Path: tests/integration/sv360-tiles.test.js
// Fase 9 (stage 3b): StreetView 360 TILES + THUMBNAILS + previewThumbnail. Covers:
//  (a) GET /sv360/tiles/fotos.geojson — valid GeoJSON FeatureCollection; anon sees
//      photos of an ENABLED project, NOT of a DISABLED one (no access leak); the
//      owning org / a global admin DOES see the disabled project's photos; a
//      tombstoned photo is excluded.
//  (b) GET /sv360/thumbnails/:slug.webp — served from the FS with ETag + 304 +
//      Content-Type image/webp; a disabled project's thumbnail → 404 for anon;
//      a '../' slug does not escape (no traversal); an absent file → 404.
//  (c) GET /sv360/photos/:uuid — previewThumbnail present and RELATIVE (no /api/v1).
//
// Fixture mirrors sv360-contract.test.js: seed Postgres rows + write small {slug}.db
// blobs AND a small {slug}.webp thumbnail into config.sv360.dbDir. TEARDOWN order
// (Windows EBUSY): closeStore() before deleting the .db, then files, then rows.

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createProducerUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';

// Deterministic UUID v5 (node:crypto, no dependency), fixed namespace.
const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const SLUG = 'proj-tiles-sv360';
const DB_FILENAME = `${SLUG}.db`;
const DISABLED_SLUG = 'proj-tiles-disabled-sv360';
const DISABLED_DB_FILENAME = `${DISABLED_SLUG}.db`;

const fullBuf = Buffer.from('RIFFxxxxWEBPfakefull-tiles');
const previewBuf = Buffer.from('RIFFxxxxWEBPfakeprev-tiles');
const thumbBuf = Buffer.from('RIFFxxxxWEBPfakethumbnail-0123456789'); // {slug}.webp

const photoId = uuidv5('default/proj-tiles-sv360/foto001.jpg');
const tombId = uuidv5('default/proj-tiles-sv360/tomb.jpg');
const disabledPhotoId = uuidv5('other/proj-tiles-disabled-sv360/foto001.jpg');

describe('StreetView 360 — tiles + thumbnails (stage 3b)', () => {
  let app, db, dbPath, disabledDbPath, thumbPath, disabledThumbPath;
  let defaultOrgId, secondOrgId, enabledProjectId, disabledProjectId;
  let adminToken, otherOrgToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    defaultOrgId = org.rows[0].id;

    const org2 = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla) VALUES ('Outra OM Tiles', 'sv360-tiles-other-om', 'OUTRAT')
       ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`
    );
    secondOrgId = org2.rows[0].id;

    // Enabled project (public) owned by the default org.
    const proj = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Proj Tiles', -23.5, -46.6, $3, 'enabled', 2) RETURNING id`,
      [defaultOrgId, SLUG, DB_FILENAME]
    );
    enabledProjectId = proj.rows[0].id;

    // Disabled project owned by the OTHER org (hidden from anon).
    const dis = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Proj Tiles Disabled', -10, -50, $3, 'disabled', 1) RETURNING id`,
      [secondOrgId, DISABLED_SLUG, DISABLED_DB_FILENAME]
    );
    disabledProjectId = dis.rows[0].id;

    // Enabled project: one visible photo + one tombstoned photo.
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
          heading, full_size_bytes, preview_size_bytes, calibration_reviewed, capture_date)
       VALUES ($1, $2, 'foto001.jpg', 'Foto 001', 1, -23.5, -46.6, 720,
               33, $3, $4, true, '2024-01-15T10:00:00Z')`,
      [photoId, enabledProjectId, fullBuf.length, previewBuf.length]
    );
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele)
       VALUES ($1, $2, 'tomb.jpg', 'Tombstoned', 2, -23.51, -46.61, 700)`,
      [tombId, enabledProjectId]
    );
    await db.query(`INSERT INTO sv360.deleted_photos (photo_id) VALUES ($1)`, [tombId]);

    // Disabled project: one photo (must NOT leak to anon via tiles).
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele)
       VALUES ($1, $2, 'secret.jpg', 'Secret', 1, -10, -50, 100)`,
      [disabledPhotoId, disabledProjectId]
    );

    // Tokens: a GLOBAL admin and a member of the OTHER (owning) org.
    // O ADMIN PRECISA EXISTIR NO BANCO, e essa exigencia e nova (fase F6).
    // O predicado de leitura do 360 deixou de receber um `isAdmin` calculado no JS
    // e passou a resolver o papel a partir do UUID (`fn_has_global_data_access`).
    // Um token forjado com `sub` sem linha em `users` continua sendo um token
    // valido e deixou de ser um admin — que e exatamente a propriedade desejada:
    // o token sozinho nao concede mais nada.
    const adminId = crypto.randomUUID();
    await db.query(
      `INSERT INTO users (id, username, password_hash, nome, role, organization_id)
       VALUES ($1, $2, 'x', 'Admin 360', 'admin', $3)`,
      [adminId, `sv360_admin_${adminId.slice(0, 8)}`, defaultOrgId]
    );
    adminToken = jwt.sign(
      { sub: adminId, role: 'admin', organization_id: defaultOrgId },
      config.jwt.secret,
      { algorithm: 'HS256', expiresIn: '5m' }
    );
    // A OM QUE VE O PROJETO OCULTO E A PRODUTORA, nao a de LOTACAO: `organization_id`
    // e auto-declarado no auto-cadastro, entao escolher a OM na tela de cadastro
    // entregava o acervo oculto dela. `producer_org_id` so um administrador concede, e
    // o predicado o resolve NO SQL a partir do UUID — dai o usuario de verdade.
    const produtorSegunda = await createProducerUser(db, secondOrgId, { username: `tiles_prod_${crypto.randomUUID().slice(0, 8)}` });
    otherOrgToken = jwt.sign(
      {
        sub: produtorSegunda.id, role: 'producer',
        organization_id: secondOrgId, producer_org_id: secondOrgId,
      },
      config.jwt.secret,
      { algorithm: 'HS256', expiresIn: '5m' }
    );

    // Build the per-project {slug}.db with the WebP blobs (for the enabled project).
    mkdirSync(config.sv360.dbDir, { recursive: true });
    dbPath = path.join(config.sv360.dbDir, DB_FILENAME);
    if (existsSync(dbPath)) rmSync(dbPath, { force: true });
    const sdb = new Database(dbPath);
    sdb.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    sdb.prepare('INSERT INTO images VALUES (?,?,?)').run(photoId, fullBuf, previewBuf);
    sdb.close();
    disabledDbPath = path.join(config.sv360.dbDir, DISABLED_DB_FILENAME);

    // Write the per-project thumbnails ({slug}.webp) into the same dir.
    thumbPath = path.join(config.sv360.dbDir, `${SLUG}.webp`);
    disabledThumbPath = path.join(config.sv360.dbDir, `${DISABLED_SLUG}.webp`);
    writeFileSync(thumbPath, thumbBuf);
    writeFileSync(disabledThumbPath, thumbBuf);
  });

  after(async () => {
    await closeStore();
    for (const f of [
      dbPath,
      `${dbPath}-wal`,
      `${dbPath}-shm`,
      `${dbPath}-journal`,
      disabledDbPath,
      thumbPath,
      disabledThumbPath,
    ]) {
      if (f && existsSync(f)) rmSync(f, { force: true });
    }
    await db.query(`DELETE FROM sv360.deleted_photos WHERE photo_id = $1`, [tombId]);
    await db.query(`DELETE FROM sv360.photos WHERE project_id = ANY($1::uuid[])`, [
      [enabledProjectId, disabledProjectId],
    ]);
    await db.query(`DELETE FROM sv360.projects WHERE id = ANY($1::uuid[])`, [
      [enabledProjectId, disabledProjectId],
    ]);
    // O PRODUTOR PRECISA CAIR ANTES DA OM: `users.producer_org_id` é FK sem ON DELETE,
    // então apagar a organização com um produtor de pé levanta 23503 dentro do `after`
    // — uma suíte inteiramente verde que termina vermelha por limpeza.
    await db.query('DELETE FROM public.users WHERE producer_org_id = $1', [secondOrgId]);
    await db.query(`DELETE FROM public.organizations WHERE id = $1`, [secondOrgId]);
    await teardownTestEnv(db);
  });

  // --- (a) tiles fotos.geojson ----------------------------------------------

  it('returns a valid GeoJSON FeatureCollection (anon)', async () => {
    const res = await supertest(app).get('/api/v1/sv360/tiles/fotos.geojson').expect(200);
    assert.equal(res.body.type, 'FeatureCollection');
    assert.ok(Array.isArray(res.body.features));
    // The enabled project's photo is visible to anon (asserted in the next
    // test), so an empty collection here would mean the shape loop below is
    // checking the shape of nothing.
    assert.ok(res.body.features.length > 0, 'anon must see the enabled project photos');
    for (const f of res.body.features) {
      assert.equal(f.type, 'Feature');
      assert.equal(f.geometry.type, 'Point');
      assert.equal(f.geometry.coordinates.length, 2);
      assert.equal(typeof f.geometry.coordinates[0], 'number'); // lon
      assert.equal(typeof f.geometry.coordinates[1], 'number'); // lat
    }
  });

  it('includes an enabled project photo but excludes the tombstoned one (anon)', async () => {
    const res = await supertest(app).get('/api/v1/sv360/tiles/fotos.geojson').expect(200);
    const ids = res.body.features.map((f) => f.properties.id);
    assert.ok(ids.includes(photoId), 'visible enabled photo present');
    assert.ok(!ids.includes(tombId), 'tombstoned photo excluded');
  });

  it('does NOT leak a disabled project photo to anon (access embedded in SQL)', async () => {
    const res = await supertest(app).get('/api/v1/sv360/tiles/fotos.geojson').expect(200);
    const ids = res.body.features.map((f) => f.properties.id);
    assert.ok(!ids.includes(disabledPhotoId), 'disabled-project photo hidden from anon');
  });

  it('shows the disabled project photo to a global admin', async () => {
    const res = await supertest(app)
      .get('/api/v1/sv360/tiles/fotos.geojson')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const ids = res.body.features.map((f) => f.properties.id);
    assert.ok(ids.includes(disabledPhotoId), 'admin sees disabled-project photo');
  });

  it('shows the disabled project photo to a member of the owning org', async () => {
    const res = await supertest(app)
      .get('/api/v1/sv360/tiles/fotos.geojson')
      .set('Authorization', `Bearer ${otherOrgToken}`)
      .expect(200);
    const ids = res.body.features.map((f) => f.properties.id);
    assert.ok(ids.includes(disabledPhotoId), 'owning-org member sees disabled-project photo');
  });

  it('feature properties carry the photo identity (projectSlug, img, sequence)', async () => {
    const res = await supertest(app).get('/api/v1/sv360/tiles/fotos.geojson').expect(200);
    const f = res.body.features.find((x) => x.properties.id === photoId);
    assert.ok(f);
    assert.equal(f.properties.projectSlug, SLUG);
    assert.equal(f.properties.img, 'foto001.jpg');
    assert.equal(f.properties.sequence_number, 1);
  });

  // --- (b) thumbnails -------------------------------------------------------

  it('serves the project thumbnail with ETag + Content-Type image/webp (anon)', async () => {
    const res = await supertest(app).get(`/api/v1/sv360/thumbnails/${SLUG}.webp`).expect(200);
    assert.equal(res.headers['content-type'], 'image/webp');
    assert.ok(res.headers['etag']);
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.match(res.headers['cache-control'], /immutable/);
    assert.ok(Buffer.isBuffer(res.body));
    assert.equal(res.body.length, thumbBuf.length);
    assert.ok(res.body.equals(thumbBuf));
  });

  it('304s on a matching If-None-Match for the thumbnail', async () => {
    const first = await supertest(app).get(`/api/v1/sv360/thumbnails/${SLUG}.webp`).expect(200);
    const etag = first.headers['etag'];
    assert.ok(etag);
    await supertest(app)
      .get(`/api/v1/sv360/thumbnails/${SLUG}.webp`)
      .set('If-None-Match', etag)
      .expect(304);
  });

  it('hides a DISABLED project thumbnail from anon (404, no leak)', async () => {
    const res = await supertest(app)
      .get(`/api/v1/sv360/thumbnails/${DISABLED_SLUG}.webp`)
      .expect(404);
    assert.equal(typeof res.body.error, 'string'); // frozen flat { error }
  });

  it('serves the DISABLED project thumbnail to the owning org', async () => {
    await supertest(app)
      .get(`/api/v1/sv360/thumbnails/${DISABLED_SLUG}.webp`)
      .set('Authorization', `Bearer ${otherOrgToken}`)
      .expect(200);
  });

  it('404s for a thumbnail of a non-existent project', async () => {
    await supertest(app).get('/api/v1/sv360/thumbnails/no-such-project.webp').expect(404);
  });

  it('does not escape via a traversal slug (no path escape)', async () => {
    // The route schema rejects the non-kebab slug before any filesystem access.
    const res = await supertest(app).get('/api/v1/sv360/thumbnails/..%2f..%2fetc.webp');
    assert.equal(res.status, 422, `a traversal slug must be rejected by the schema, got ${res.status}`);
    assert.notEqual(res.status, 200);
  });

  // --- (c) previewThumbnail in the frozen photo shape -----------------------

  it('exposes previewThumbnail RELATIVE (no /api/v1) in GET /photos/:uuid', async () => {
    const res = await supertest(app).get(`/api/v1/sv360/photos/${photoId}`).expect(200);
    assert.equal(typeof res.body.previewThumbnail, 'string');
    assert.equal(res.body.previewThumbnail, `/thumbnails/${SLUG}.webp`);
    assert.ok(!res.body.previewThumbnail.startsWith('/api/v1'), 'must be relative, no /api/v1');
  });
});

// Cross-org thumbnail isolation: a slug is UNIQUE only per org, so two orgs can
// share a slug. The thumbnail file is ORG-KEYED ({orgId}__{slug}.webp, like the
// {slug}.db), and the read lookup is access-filtered + deterministic — so an anon
// caller served `/thumbnails/{sharedSlug}.webp` gets the ENABLED org's thumbnail
// and NEVER the DISABLED org's (the confidentiality leak this guards against).
describe('StreetView 360 — cross-org thumbnail isolation (stage 3b)', () => {
  let app, db, orgBId, projAId, projBId, thumbA, thumbB, otherOrgToken;
  const SHARED = 'shared-thumb-sv360';
  const enabledThumb = Buffer.from('RIFFxxxxWEBP-ENABLED-orgA-thumbnail');
  const secretThumb = Buffer.from('RIFFxxxxWEBP-DISABLED-orgB-SECRET-thumb');

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    const orgAId = org.rows[0].id;
    const org2 = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla) VALUES ('XOrg Thumb', 'sv360-xorg-thumb', 'XORGT')
       ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`
    );
    orgBId = org2.rows[0].id;

    // SAME slug in both orgs; org-keyed db_filename (matches deriveDbFilename).
    const dbA = `${orgAId}__${SHARED}.db`;
    const dbB = `${orgBId}__${SHARED}.db`;
    const a = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'A enabled', -23, -46, $3, 'enabled', 0) RETURNING id`,
      [orgAId, SHARED, dbA]
    );
    projAId = a.rows[0].id;
    const b = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'B disabled', -10, -50, $3, 'disabled', 0) RETURNING id`,
      [orgBId, SHARED, dbB]
    );
    projBId = b.rows[0].id;

    mkdirSync(config.sv360.dbDir, { recursive: true });
    thumbA = path.join(config.sv360.dbDir, `${orgAId}__${SHARED}.webp`);
    thumbB = path.join(config.sv360.dbDir, `${orgBId}__${SHARED}.webp`);
    writeFileSync(thumbA, enabledThumb);
    writeFileSync(thumbB, secretThumb);

    // A OM QUE VE O PROJETO OCULTO E A PRODUTORA, nao a de LOTACAO: `organization_id`
    // e auto-declarado no auto-cadastro, entao escolher a OM na tela de cadastro
    // entregava o acervo oculto dela. `producer_org_id` so um administrador concede, e
    // o predicado o resolve NO SQL a partir do UUID — dai o usuario de verdade.
    const produtorB = await createProducerUser(db, orgBId, { username: `tiles_prodb_${crypto.randomUUID().slice(0, 8)}` });
    otherOrgToken = jwt.sign(
      {
        sub: produtorB.id, role: 'producer',
        organization_id: orgBId, producer_org_id: orgBId,
      },
      config.jwt.secret,
      { algorithm: 'HS256', expiresIn: '5m' }
    );
  });

  after(async () => {
    for (const f of [thumbA, thumbB]) if (f && existsSync(f)) rmSync(f, { force: true });
    await db.query(`DELETE FROM sv360.projects WHERE id = ANY($1::uuid[])`, [[projAId, projBId]]);
    await db.query('DELETE FROM public.users WHERE producer_org_id = $1', [orgBId]);
    await db.query(`DELETE FROM public.organizations WHERE id = $1`, [orgBId]);
    await teardownTestEnv(db);
  });

  it('anon gets the ENABLED org thumbnail, NEVER the disabled org secret', async () => {
    const res = await supertest(app).get(`/api/v1/sv360/thumbnails/${SHARED}.webp`).expect(200);
    assert.ok(res.body.equals(enabledThumb), 'served the enabled org thumbnail');
    assert.ok(!res.body.equals(secretThumb), 'did NOT serve the disabled org secret thumbnail');
  });

  it('the disabled org member gets THEIR own thumbnail for the shared slug', async () => {
    const res = await supertest(app)
      .get(`/api/v1/sv360/thumbnails/${SHARED}.webp`)
      .set('Authorization', `Bearer ${otherOrgToken}`)
      .expect(200);
    assert.ok(res.body.equals(secretThumb), 'owning-org member sees their own org thumbnail');
  });
});

// ---------------------------------------------------------------------------
// `previewThumbnail` SÓ QUANDO O ARQUIVO EXISTE — e a checagem DEPOIS do gate.
//
// O DEFEITO CONSERTADO: o campo era interpolação pura (`/thumbnails/${slug}.webp`)
// em `publicProjectView` e em `buildPhotoMetadata`, emitida para TODO projeto. Mas
// a miniatura sempre foi OPCIONAL do lado do escritor (`sv360.admin.service.js` só
// a copia `if (thumbnailPath && existsSync(thumbnailPath))`, e engole a falha de
// propósito), então projeto sem miniatura é caso NORMAL. O catálogo pedia uma
// imagem que respondia 404 em cada um deles.
//
// A ARMADILHA, e é ela que o último caso guarda: as quatro camadas do gate de
// leitura da rota de miniatura (basename, predicado no SQL, isProjectReadable,
// existsSync) desabam no MESMO 404. "Projeto não existe", "existe mas você não o
// alcança" e "existe, você o alcança, mas não tem arquivo" são INDISTINGUÍVEIS
// para o cliente, e essa indistinguibilidade é propriedade de segurança, não
// acidente. Um `hasThumbnail` calculado ANTES do gate viraria canal lateral: o
// disco denunciaria a existência de projeto privado.
//
// Por isso a checagem roda sobre linha que o predicado do SQL JÁ entregou. Quem
// alcança o projeto descobre se ele tem miniatura; quem não alcança continua vendo
// exatamente o mesmo nada — com ou sem arquivo em disco.
// ---------------------------------------------------------------------------
describe('StreetView 360 — previewThumbnail só quando o arquivo existe', () => {
  let app, db, orgOutraId, produtorToken;
  let idComThumb, idSemThumb, idPrivado;
  let thumbComPath, thumbPrivadoPath;
  const sufixo = crypto.randomUUID().slice(0, 8);
  const SLUG_COM = `thumb-com-${sufixo}`;
  const SLUG_SEM = `thumb-sem-${sufixo}`;
  const SLUG_PRIV = `thumb-priv-${sufixo}`;
  const bufComThumb = Buffer.from('RIFFxxxxWEBP-tem-miniatura');
  const bufPrivado = Buffer.from('RIFFxxxxWEBP-miniatura-de-projeto-privado');

  // A resposta que o anônimo vê, inteira: lista + projeto por slug + miniatura.
  // É a superfície ONDE o canal lateral apareceria, então o controle negativo
  // compara as três de uma vez, e não só a que ele lembrou de olhar.
  const respostaAnonima = async () => {
    const lista = await supertest(app).get('/api/v1/sv360/projects').expect(200);
    const porSlug = await supertest(app).get(`/api/v1/sv360/projects/${SLUG_PRIV}`);
    const miniatura = await supertest(app).get(`/api/v1/sv360/thumbnails/${SLUG_PRIV}.webp`);
    return {
      lista: lista.body,
      statusPorSlug: porSlug.status,
      corpoPorSlug: porSlug.body,
      statusMiniatura: miniatura.status,
    };
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    const orgDefaultId = org.rows[0].id;
    const org2 = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla) VALUES ($1, $2, 'THUMBO')
       ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`,
      [`OM Thumb ${sufixo}`, `sv360-thumb-om-${sufixo}`]
    );
    orgOutraId = org2.rows[0].id;

    const inserir = async (orgId, slug, nome, accessLevel) => {
      const { rows } = await db.query(
        `INSERT INTO sv360.projects
           (organization_id, slug, name, center_lat, center_long, db_filename,
            status, photo_count, access_level)
         VALUES ($1, $2, $3, -23, -46, $4, 'enabled', 0, $5) RETURNING id`,
        [orgId, slug, nome, `${orgId}__${slug}.db`, accessLevel]
      );
      return rows[0].id;
    };

    idComThumb = await inserir(orgDefaultId, SLUG_COM, 'Com miniatura', 'public');
    idSemThumb = await inserir(orgDefaultId, SLUG_SEM, 'Sem miniatura', 'public');
    // ENABLED + PRIVATE de OUTRA OM: o anônimo não o alcança, e o eixo é o de
    // PRIVACIDADE (não o de ocultação), que é o que o predicado do SQL resolve.
    idPrivado = await inserir(orgOutraId, SLUG_PRIV, 'Privado', 'private');

    const produtor = await createProducerUser(db, orgOutraId, {
      username: `thumb_prod_${sufixo}`,
    });
    produtorToken = jwt.sign(
      {
        sub: produtor.id, role: 'producer',
        organization_id: orgOutraId, org_role: 'viewer', producer_org_id: orgOutraId,
      },
      config.jwt.secret,
      { algorithm: 'HS256', expiresIn: '5m' }
    );

    // O NOME EM DISCO É ORG-KEYED, derivado do `db_filename`, e a URL é slug-only.
    // Escrever `${slug}.webp` aqui daria um falso negativo com cara de conserto.
    mkdirSync(config.sv360.dbDir, { recursive: true });
    thumbComPath = path.join(config.sv360.dbDir, `${orgDefaultId}__${SLUG_COM}.webp`);
    thumbPrivadoPath = path.join(config.sv360.dbDir, `${orgOutraId}__${SLUG_PRIV}.webp`);
    writeFileSync(thumbComPath, bufComThumb);
    writeFileSync(thumbPrivadoPath, bufPrivado);
    // SLUG_SEM não ganha arquivo nenhum: é o projeto legível SEM miniatura.
  });

  // OS CASOS ALTERNAM O ARQUIVO DO PROJETO PRIVADO, então cada um começa do mesmo
  // estado. Sem isto, um caso que falha no meio deixa o disco sujo e o CONTROLE
  // NEGATIVO seguinte falha por arrasto, escondendo o que ele mede de verdade.
  beforeEach(() => {
    if (!existsSync(thumbPrivadoPath)) writeFileSync(thumbPrivadoPath, bufPrivado);
  });

  after(async () => {
    for (const f of [thumbComPath, thumbPrivadoPath]) {
      if (f && existsSync(f)) rmSync(f, { force: true });
    }
    await db.query(`DELETE FROM sv360.projects WHERE id = ANY($1::uuid[])`, [
      [idComThumb, idSemThumb, idPrivado],
    ]);
    await db.query('DELETE FROM public.users WHERE producer_org_id = $1', [orgOutraId]);
    await db.query(`DELETE FROM public.organizations WHERE id = $1`, [orgOutraId]);
    await teardownTestEnv(db);
  });

  it('projeto legível COM arquivo: o campo continua vindo, relativo e sem /api/v1', async () => {
    const res = await supertest(app).get('/api/v1/sv360/projects').expect(200);
    const p = res.body.find((x) => x.slug === SLUG_COM);
    assert.ok(p, 'o projeto público está listado');
    assert.equal(p.previewThumbnail, `/thumbnails/${SLUG_COM}.webp`);
    assert.ok(!p.previewThumbnail.startsWith('/api/v1'), 'relativo, sem /api/v1');

    // E a URL anunciada RESPONDE. Uma asserção que só olha a string não reprova o
    // defeito consertado: era exatamente uma string bem formada que dava 404.
    const img = await supertest(app).get(`/api/v1/sv360${p.previewThumbnail}`).expect(200);
    assert.ok(img.body.equals(bufComThumb), 'a miniatura anunciada é a que está em disco');
  });

  it('projeto legível SEM arquivo: o campo não promete a imagem', async () => {
    const res = await supertest(app).get('/api/v1/sv360/projects').expect(200);
    const p = res.body.find((x) => x.slug === SLUG_SEM);
    assert.ok(p, 'o projeto público está listado (só a miniatura falta)');
    assert.ok('previewThumbnail' in p, 'a chave não some da forma congelada');
    assert.equal(p.previewThumbnail, null, 'null, e não uma URL que responde 404');

    // A prova de que o null está CERTO: a URL que o código emitia responde 404.
    await supertest(app).get(`/api/v1/sv360/thumbnails/${SLUG_SEM}.webp`).expect(404);

    // O mesmo pelo caminho de projeto por slug, que é outra função (`getProject`)
    // sobre a MESMA view: consertar uma e esquecer a outra é o erro provável.
    const um = await supertest(app).get(`/api/v1/sv360/projects/${SLUG_SEM}`).expect(200);
    assert.equal(um.body.previewThumbnail, null);
  });

  it('quem ALCANÇA o projeto privado descobre a miniatura (a descoberta é pós-gate)', async () => {
    const res = await supertest(app)
      .get(`/api/v1/sv360/projects/${SLUG_PRIV}`)
      .set('Authorization', `Bearer ${produtorToken}`)
      .expect(200);
    assert.equal(res.body.previewThumbnail, `/thumbnails/${SLUG_PRIV}.webp`);

    // Sem o arquivo, o MESMO chamador passa a ver null. É esta diferença — visível
    // a quem pode ver o projeto — que o caso seguinte exige ser INVISÍVEL ao anônimo.
    rmSync(thumbPrivadoPath, { force: true });
    const semArquivo = await supertest(app)
      .get(`/api/v1/sv360/projects/${SLUG_PRIV}`)
      .set('Authorization', `Bearer ${produtorToken}`)
      .expect(200);
    assert.equal(semArquivo.body.previewThumbnail, null);
    writeFileSync(thumbPrivadoPath, bufPrivado);
  });

  // O CONTROLE NEGATIVO QUE IMPEDE O CONSERTO DE VIRAR CANAL LATERAL.
  //
  // Ele REPROVA qualquer implementação que anuncie a existência antes do gate: se
  // a miniatura em disco mudasse UM byte da resposta anônima, o disco de uma OM
  // estaria respondendo perguntas sobre um projeto privado de outra.
  it('projeto PRIVADO fora do alcance: a MESMA resposta, com ou sem miniatura em disco', async () => {
    assert.ok(existsSync(thumbPrivadoPath), 'o caso começa COM a miniatura em disco');
    const comArquivo = await respostaAnonima();

    rmSync(thumbPrivadoPath, { force: true });
    const semArquivo = await respostaAnonima();

    assert.deepEqual(
      semArquivo,
      comArquivo,
      'a presença do arquivo em disco não move um byte da resposta ao anônimo'
    );
    // E as duas continuam sendo o mesmo NADA de antes do conserto.
    assert.equal(comArquivo.statusPorSlug, 404, 'o projeto privado é 404 para o anônimo');
    assert.equal(comArquivo.statusMiniatura, 404, 'e a miniatura dele também');
    assert.ok(
      !comArquivo.lista.some((p) => p.slug === SLUG_PRIV),
      'e ele não aparece na listagem anônima'
    );

    writeFileSync(thumbPrivadoPath, bufPrivado);
  });
});
