// Path: tests/integration/sv360-tiles-cache-scope.test.js
// Item 46 (testes-backend.md) — P6 on the TILE routes.
//
// The image route already scoped its cache to its access (IMMUTABLE_PRIVATE + Vary,
// pinned by sv360-cache-scope.test.js) and `tilesGeojson` had been given the same
// split, but `mvtTile` still emitted `Cache-Control: public, max-age=60`
// UNCONDITIONALLY while its BODY varies by req.user: the MVT query embeds
// isAdmin/orgId and includes `disabled` projects for a caller allowed to see them.
// A shared proxy could therefore store one org member's tile — disabled-project
// photos inside — and replay it to an anonymous caller for 60s, with the app never
// consulted. sv360-mvt.test.js only asserted `max-age=60` and not-immutable, which
// is true in both the broken and the fixed version.
//
// The tile is DECODED, not just status-checked: a header assertion over a tile that
// happens to be empty would prove nothing about leaking restricted content.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, createProducerUser } from '../helpers/fixtures.js';

const RID = crypto.randomUUID().slice(0, 8);
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing-purposes-only-32chars';

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
      sub, username: `tcache_${RID}_${sub.slice(0, 8)}`, role,
      organization_id: orgId, org_role: 'viewer', producer_org_id: producerOrgId,
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' }
  );
}

function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

// A location of its own, so this file's tile never mixes with another suite's seeds.
const LON = 10.25;
const LAT = 45.75;
const Z = 12;
const { x: TX, y: TY } = lonLatToTile(LON, LAT, Z);

const DISABLED_SLUG = `tcache-disabled-${RID}`;
const disabledPhotoId = uuidv5(`tcache/${DISABLED_SLUG}/secret.jpg`);

/** Fetches the tile as a raw Buffer (supertest would otherwise stringify it). */
function fetchTile(app, token) {
  const req = supertest(app).get(`/api/v1/sv360/tiles/${Z}/${TX}/${TY}.pbf`);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req
    .buffer()
    .parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);
}

/** Photo ids present in the 'fotos' layer of an MVT buffer. */
function photoIdsIn(buf) {
  if (!buf || buf.length === 0) return [];
  const tile = new VectorTile(new PbfReader(buf));
  const layer = tile.layers.fotos;
  if (!layer) return [];
  const ids = [];
  for (let i = 0; i < layer.length; i++) ids.push(layer.feature(i).properties.id);
  return ids;
}

describe('sv360 tiles — cache scope follows access scope (P6)', () => {
  let app, db, otherOrgId, memberToken, adminToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla) VALUES ($1, $2, 'TCH') RETURNING id`,
      [`Tile Cache OM ${RID}`, `tcache-om-${RID}`]
    );
    otherOrgId = org.rows[0].id;

    const produtorOutra = await createProducerUser(db, otherOrgId, { username: `tcache_p_${RID}` });
    const administrador = await createAdminUser(db, { username: `tcache_a_${RID}` });
    memberToken = mintToken({ orgId: otherOrgId, producerOrgId: otherOrgId, sub: produtorOutra.id });
    adminToken = mintToken({ orgId: otherOrgId, role: 'admin', sub: administrador.id });

    const proj = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, $3, $4, $5, $6, 'disabled', 1) RETURNING id`,
      [otherOrgId, DISABLED_SLUG, `Tile Cache Disabled ${RID}`, LAT, LON, `${otherOrgId}__${DISABLED_SLUG}.db`]
    );

    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
          full_size_bytes, preview_size_bytes)
       VALUES ($1, $2, 'secret.jpg', 'Secret', 1, $3, $4, 100, 10, 5)`,
      [disabledPhotoId, proj.rows[0].id, LAT, LON]
    );
  });

  after(async () => {
    await db.query('DELETE FROM sv360.photos WHERE id = $1', [disabledPhotoId]);
    await db.query('DELETE FROM sv360.projects WHERE slug = $1', [DISABLED_SLUG]);
    // O PRODUTOR PRECISA CAIR ANTES DA OM: `users.producer_org_id` é FK sem ON DELETE,
    // então apagar a organização com um produtor de pé levanta 23503 dentro do `after`
    // — uma suíte inteiramente verde que termina vermelha por limpeza.
    await db.query('DELETE FROM public.users WHERE producer_org_id = $1', [otherOrgId]);
    await db.query('DELETE FROM public.organizations WHERE id = $1', [otherOrgId]);
    await teardownTestEnv(db);
  });

  it('the fixture really leaks restricted content into a credentialed tile (premise)', async () => {
    // Without this the header assertions below could be green over an empty tile.
    const member = await fetchTile(app, memberToken);
    assert.ok(
      photoIdsIn(member.body).includes(disabledPhotoId),
      'the member tile must actually contain the disabled-project photo',
    );

    const anon = await fetchTile(app, null);
    assert.ok(
      !photoIdsIn(anon.body).includes(disabledPhotoId),
      'the anonymous tile must NOT contain it (the access rule itself is unchanged)',
    );
  });

  it('a credentialed MVT tile is NOT publicly cacheable and varies by credential', async () => {
    const res = await fetchTile(app, memberToken);
    assert.doesNotMatch(
      res.headers['cache-control'],
      /public/,
      'a tile whose body depends on the caller must never be marked publicly cacheable',
    );
    assert.match(res.headers['cache-control'], /private/);
    assert.match(res.headers['cache-control'], /max-age=60/);
    assert.match(res.headers['vary'] || '', /Authorization/i);
  });

  it('the same tile fetched by a global admin is private too', async () => {
    const res = await fetchTile(app, adminToken);
    assert.ok(
      photoIdsIn(res.body).includes(disabledPhotoId),
      'a global admin does see the disabled project',
    );
    assert.doesNotMatch(res.headers['cache-control'], /public/);
    assert.match(res.headers['vary'] || '', /Authorization/i);
  });

  it('the ANONYMOUS MVT tile stays publicly cacheable (the fix did not kill the CDN)', async () => {
    const res = await fetchTile(app, null);
    assert.match(res.headers['cache-control'], /public/);
    assert.match(res.headers['cache-control'], /max-age=60/);
    assert.ok(!/immutable/.test(res.headers['cache-control']), 'tiles are still not immutable');
  });

  it('GET /tiles/fotos.geojson follows the same rule on both sides', async () => {
    const withToken = await supertest(app)
      .get('/api/v1/sv360/tiles/fotos.geojson')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
    assert.ok(
      withToken.body.features.some((f) => f.properties.id === disabledPhotoId),
      'the credentialed feed really carries the restricted photo',
    );
    assert.doesNotMatch(withToken.headers['cache-control'], /public/);
    assert.match(withToken.headers['vary'] || '', /Authorization/i);

    const anon = await supertest(app).get('/api/v1/sv360/tiles/fotos.geojson').expect(200);
    assert.ok(
      !anon.body.features.some((f) => f.properties.id === disabledPhotoId),
      'the anonymous feed still excludes it',
    );
    assert.match(anon.headers['cache-control'], /public/);
  });
});
