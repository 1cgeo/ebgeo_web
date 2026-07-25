// Path: tests/integration/nomes-catalogo3d-gaps.test.js
// Audit gap-tests for the "Nomes (gazetteer) + Catálogo 3D" subsystem.
// Covers: catalogo3d pagination math + count/data alignment across page
// boundaries (nomes-03); the /feicoes building-identify admin override
// (nomes-04); the frozen RELATIVE url/thumbnail contract (nomes-06); the
// /feicoes 200-with-{message} + z<altitude_base branch (nomes-07); assets3d
// suffix/open-ended Range parsing on FS + SQLite (assets3d-08); SQLite store
// shadows the filesystem (assets3d-09); Content-Type-by-extension table
// (assets3d-10); and path-traversal 403 + public-no-auth contract (assets3d-11).
//
// The test DB is SHARED across files, so every assertion that depends on a
// COUNT/total isolates its own rows via a UNIQUE search keyword (q=...), and
// every username is suffixed with a random UUID to avoid cross-file collisions.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';
import { openWritable, putAsset, closeStore } from '../../src/modules/nomes/assets3d.store.js';

const u = (p) => `gap_${p}_${randomUUID().slice(0, 8)}`;

// supertest/superagent JSON-parses bodies by content-type, which corrupts binary
// asset bytes. This forces raw-Buffer collection so we can byte-compare slices.
function rawBody(req) {
  return req.buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

const ROOT = resolve(process.env.ASSETS_3D_DIR || './data/assets3d');
const SQLITE = resolve(process.env.ASSETS_3D_SQLITE || './data/assets3d.sqlite');

async function cleanupStore() {
  await closeStore();
  for (const f of [SQLITE, `${SQLITE}-wal`, `${SQLITE}-shm`, `${SQLITE}-journal`]) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
}

describe('Nomes + Catálogo 3D — audit gaps', () => {
  let app, db, adminTok;
  // Unique tag isolates THIS file's catalog rows in a shared DB.
  const TAG = `gaptag${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const fsDirs = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db, { username: u('admin') });
    adminTok = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await db.query(`DELETE FROM ng.catalogo_3d WHERE name LIKE $1`, [`%${TAG}%`]);
    await db.query(`DELETE FROM ng.edificacoes WHERE nome LIKE $1`, [`%${TAG}%`]);
    await cleanupStore();
    for (const d of fsDirs) if (existsSync(d)) rmSync(d, { recursive: true, force: true });
    await teardownTestEnv(db);
  });

  // ---------------------------------------------------------------------------
  // nomes-03 — /catalogo3d pagination math + count/data alignment.
  //
  // ⚠️ FIXTURE CONTRACT (achado 50). This block used to seed its rows with
  //     data_criacao = now() + (i || ' seconds')::interval
  // — a DISTINCT instant per row. That made `ORDER BY rank DESC, c.data_criacao DESC`
  // (nomes.queries.js CATALOGO_SELECT) a TOTAL order, which is precisely the condition
  // production never has: the column is `DEFAULT NOW()` and NOW() is per-TRANSACTION, so a
  // batch load gives every row the SAME instant. With the order total, the "page 2 must not
  // repeat page-1 rows" assert passed identically with or without a unique tie-breaker in
  // the ORDER BY: it proved nothing about the code, only about the fixture.
  //
  // The rows below are now seeded the way production does it — ONE transaction, no explicit
  // data_criacao — so they TIE, and `q` is a single repeated keyword so ts_rank ties too.
  // ---------------------------------------------------------------------------
  describe('nomes-03 · pagination across page boundaries', () => {
    const cat = (q, page, nr) =>
      supertest(app)
        .get('/api/v1/nomes/catalogo3d')
        .query({ q, page, nr_records: nr })
        .set('Authorization', `Bearer ${adminTok}`)
        .expect(200);

    /** Seeds `n` public models in ONE statement → identical data_criacao (production shape). */
    const seedTied = async (name, n) => {
      const values = [];
      const params = [];
      for (let i = 0; i < n; i++) {
        params.push(name);
        values.push(`($${i + 1}, 'Tiles 3D', 'public')`);
      }
      await db.query(
        `INSERT INTO ng.catalogo_3d (name, type, access_level) VALUES ${values.join(',')}`,
        params
      );
    };

    before(async () => {
      // 3 public models sharing a unique keyword so q=TAG returns EXACTLY these 3, regardless
      // of other files' rows. Identical name → identical rank; single statement → identical
      // data_criacao. Both sort keys tie, as they do in a real bulk load.
      await seedTied(`Model ${TAG}`, 3);
      const { rows } = await db.query(
        `SELECT COUNT(DISTINCT data_criacao)::int AS n FROM ng.catalogo_3d WHERE name = $1`,
        [`Model ${TAG}`]
      );
      assert.equal(rows[0].n, 1, 'fixture guard: the seeded rows MUST share one data_criacao');
    });

    it('page=1 echoes page/nr_records, total counts ALL matches (not the page)', async () => {
      const res = await cat(TAG, 1, 2);
      assert.equal(res.body.total, 3, 'total must count all 3 visible matches');
      assert.equal(res.body.page, 1, 'page echo');
      assert.equal(res.body.nr_records, 2, 'nr_records echo');
      assert.equal(res.body.data.length, 2, 'a single page holds nr_records rows');
      // total > nr_records here, so total !== data.length — the alignment proven
      // elsewhere only because the dataset fit one page is NOT assumed here.
      assert.ok(res.body.total > res.body.data.length);
    });

    it('page=2 returns the remainder and the two pages COVER the result set', async () => {
      const p1 = await cat(TAG, 1, 2);
      const p2 = await cat(TAG, 2, 2);
      assert.equal(p2.body.total, 3, 'total is stable across pages');
      assert.equal(p2.body.page, 2);
      assert.equal(p2.body.data.length, 1, 'remainder is 3 - 2 = 1 row');

      // The real invariant: walking the pages visits every row exactly once. "No overlap"
      // alone is satisfiable by a paginator that SKIPS rows, which is the other half of the
      // same defect.
      const ids = [...p1.body.data, ...p2.body.data].map((m) => m.id);
      assert.equal(new Set(ids).size, 3, 'the two pages must cover exactly `total` distinct ids');
    });

    it('an out-of-range page returns [] with total unchanged', async () => {
      const res = await cat(TAG, 99, 2);
      assert.equal(res.body.total, 3, 'total still reflects all matches');
      assert.deepEqual(res.body.data, [], 'beyond the last page yields an empty page');
      assert.equal(res.body.page, 99, 'page echo even when empty');
    });

    // -------------------------------------------------------------------------
    // The case the old fixture hid, at the scale where it actually bites.
    //
    // With both sort keys tied, `ORDER BY rank DESC, c.data_criacao DESC LIMIT n OFFSET k`
    // has NO unique tie-breaker, so the row order is not defined ACROSS queries: the planner
    // picks a top-N heapsort for a small k and a full sort for a large one, and the two
    // disagree about which tied rows come first. Rows are then repeated on one page and
    // skipped on another. Measured on this schema: at 120 tied rows / 10 per page the walk
    // duplicates 4 rows and loses 4; at 200/10 it duplicates 8 and loses 8. Below ~40 rows
    // one single plan serves every page and the defect stays hidden — which is why the
    // 3-row block above cannot catch it, and why this case exists.
    //
    // MARKED `todo`: the one-line fix is `ORDER BY rank DESC, c.data_criacao DESC, c.id DESC`
    // in CATALOGO_SELECT (src/modules/nomes/nomes.queries.js) — a file outside the change
    // scope of the batch that wrote this test. Verified negative control: with `, c.id DESC`
    // this walk reports 0 duplicates and 0 missing; without it, 4 and 4. Delete the `todo`
    // flag in the same commit that adds the tie-breaker.
    // -------------------------------------------------------------------------
    describe('nomes-03b · a full page walk over TIED rows visits each row once', () => {
      const BIG_TAG = `${TAG}big`;
      const TOTAL = 120;
      const PAGE = 10;

      before(async () => {
        await seedTied(`Modelo ${BIG_TAG}`, TOTAL);
      });

      it('every page walk covers exactly `total` distinct ids', async () => {
        const seen = new Set();
        let duplicates = 0;

        for (let page = 1; page <= TOTAL / PAGE; page++) {
          const res = await cat(BIG_TAG, page, PAGE);
          assert.equal(res.body.total, TOTAL, 'total is stable across pages');
          for (const model of res.body.data) {
            if (seen.has(model.id)) duplicates += 1;
            seen.add(model.id);
          }
        }

        assert.equal(duplicates, 0, `no row may be repeated across pages (repeated ${duplicates})`);
        assert.equal(seen.size, TOTAL, `no row may be skipped (missing ${TOTAL - seen.size})`);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // nomes-04 — global admin override on /feicoes (building identify).
  // ---------------------------------------------------------------------------
  describe('nomes-04 · /feicoes admin override (private building)', () => {
    const NAME = `Bunker ${TAG}`;
    before(async () => {
      // A PRIVATE building, far from everything else, identified by its TAG name.
      await db.query(
        `INSERT INTO ng.edificacoes (nome, tipo, altitude_base, altitude_topo, access_level, geom)
         VALUES ($1, 'edificacao', 0, 50, 'private',
           ST_GeomFromText('POLYGON((-50.0001 -25.0001,-49.9999 -25.0001,-49.9999 -24.9999,-50.0001 -24.9999,-50.0001 -25.0001))', 4326))`,
        [NAME]
      );
    });

    it('a global admin identifies the private building regardless of zones', async () => {
      const res = await supertest(app)
        .get('/api/v1/nomes/feicoes')
        .query({ lat: -25.0, lon: -50.0, z: 25 })
        .set('Authorization', `Bearer ${adminTok}`)
        .expect(200);
      assert.equal(res.body.nome, NAME, 'admin sees the private building (FEICOES admin branch)');
    });

    it('a plain user without a covering zone gets the 200-with-{message} miss', async () => {
      const plain = await createUser(db, { username: u('feic_noaccess') });
      const tok = await loginUser(app, plain.username, plain.password);
      const res = await supertest(app)
        .get('/api/v1/nomes/feicoes')
        .query({ lat: -25.0, lon: -50.0, z: 25 })
        .set('Authorization', `Bearer ${tok}`)
        .expect(200);
      assert.ok(!res.body.nome, 'private building hidden from a user without the zone');
      assert.ok(res.body.message, 'a miss is a {message} object');
    });
  });

  // ---------------------------------------------------------------------------
  // nomes-06 — frozen RELATIVE url/thumbnail contract (no server-side prefix).
  // ---------------------------------------------------------------------------
  describe('nomes-06 · catalog url/thumbnail are served verbatim (relative)', () => {
    const NAME = `Relurl ${TAG}`;
    before(async () => {
      await db.query(
        `INSERT INTO ng.catalogo_3d (name, type, access_level, url, thumbnail)
         VALUES ($1, 'Tiles 3D', 'public', '/aman/tileset.json', '/aman/thumb.png')`,
        [NAME]
      );
    });

    it('url and thumbnail equal the stored relative strings and are NOT prefixed with /api/v1', async () => {
      const res = await supertest(app)
        .get('/api/v1/nomes/catalogo3d')
        .query({ q: NAME })
        .set('Authorization', `Bearer ${adminTok}`)
        .expect(200);
      const item = res.body.data.find((m) => m.name === NAME);
      assert.ok(item, 'the seeded row is returned');
      assert.equal(item.url, '/aman/tileset.json', 'url verbatim (relative)');
      assert.equal(item.thumbnail, '/aman/thumb.png', 'thumbnail verbatim (relative)');
      assert.ok(!item.url.startsWith('/api/v1'), 'no server-side prefixing of url');
      assert.ok(!item.thumbnail.startsWith('/api/v1'), 'no server-side prefixing of thumbnail');
    });
  });

  // ---------------------------------------------------------------------------
  // nomes-07 — /feicoes z<altitude_base branch + 200/{message}/not-array contract.
  // ---------------------------------------------------------------------------
  describe('nomes-07 · /feicoes z<base branch and not-found contract', () => {
    const NAME = `BelowBase ${TAG}`;
    let userTok;
    before(async () => {
      // A PUBLIC building so any authenticated user sees it; base=20, topo=60.
      await db.query(
        `INSERT INTO ng.edificacoes (nome, tipo, altitude_base, altitude_topo, access_level, geom)
         VALUES ($1, 'edificacao', 20, 60, 'public',
           ST_GeomFromText('POLYGON((-51.0001 -26.0001,-50.9999 -26.0001,-50.9999 -25.9999,-51.0001 -25.9999,-51.0001 -26.0001))', 4326))`,
        [NAME]
      );
      const plain = await createUser(db, { username: u('feic_below') });
      userTok = await loginUser(app, plain.username, plain.password);
    });

    it('z below altitude_base yields z_distance = altitude_base - z', async () => {
      const res = await supertest(app)
        .get('/api/v1/nomes/feicoes')
        .query({ lat: -26.0, lon: -51.0, z: -10 })
        .set('Authorization', `Bearer ${userTok}`)
        .expect(200);
      assert.equal(res.body.nome, NAME);
      // base=20, z=-10 → 20 - (-10) = 30 (the z < altitude_base branch).
      assert.equal(Number(res.body.z_distance), 30);
    });

    it('a not-found identify is 200 with a {message} OBJECT (not 404, not an array)', async () => {
      const res = await supertest(app)
        .get('/api/v1/nomes/feicoes')
        .query({ lat: 0, lon: 0, z: 0 }) // open ocean — nothing within 3m
        .set('Authorization', `Bearer ${userTok}`)
        .expect(200);
      assert.equal(res.status, 200, 'frozen: 200, never 404');
      assert.equal(typeof res.body, 'object');
      assert.ok(!Array.isArray(res.body), 'frozen: an object, never an array');
      assert.ok(res.body.message, 'frozen: { message }');
    });
  });

  // ---------------------------------------------------------------------------
  // assets3d-08 — suffix (bytes=-N) and open-ended (bytes=N-) Range parsing.
  // assets3d-09 — SQLite store shadows the filesystem (same rel_path in both).
  // assets3d-10 — Content-Type-by-extension table + unknown-ext default.
  // assets3d-11 — path-traversal 403 + public no-auth + 404-for-missing.
  // (Grouped: all need the FS dir / SQLite store fixtures.)
  // ---------------------------------------------------------------------------
  describe('assets3d · Range, store-precedence, content-types, traversal', () => {
    // 30-byte deterministic payload for precise Range slicing.
    const PAYLOAD = Buffer.from('0123456789abcdefghijABCDEFGHIJ'); // length 30
    const SIZE = PAYLOAD.length;
    const fsBase = `gapfs_${randomUUID().slice(0, 8)}`;
    const fsDir = join(ROOT, fsBase);
    const dupBase = `gapdup_${randomUUID().slice(0, 8)}`;
    const dupRel = `${dupBase}/tileset.json`;
    const dupSqliteBytes = Buffer.from('SQLITE-WINS-BYTES');

    before(async () => {
      // 1) Filesystem fixtures.
      mkdirSync(fsDir, { recursive: true });
      fsDirs.push(fsDir);
      writeFileSync(join(fsDir, 'range.glb'), PAYLOAD); // known-size FS asset for Range
      writeFileSync(join(fsDir, 'x.b3dm'), Buffer.from('b3dm'));
      writeFileSync(join(fsDir, 'x.pnts'), Buffer.from('pnts'));
      writeFileSync(join(fsDir, 'x.terrain'), Buffer.from('terr'));
      writeFileSync(join(fsDir, 'x.gltf'), Buffer.from('{"asset":{}}'));
      writeFileSync(join(fsDir, 'x.unknownext'), Buffer.from('weird'));
      // Shadow target: SAME rel_path exists on disk AND (below) in SQLite.
      const dupDir = join(ROOT, dupBase);
      mkdirSync(dupDir, { recursive: true });
      fsDirs.push(dupDir);
      writeFileSync(join(dupDir, 'tileset.json'), Buffer.from('FILESYSTEM-BYTES'));

      // 2) SQLite fixtures (fresh store).
      await cleanupStore();
      const w = openWritable();
      // Same rel-path as on disk, but DIFFERENT bytes → store must WIN.
      putAsset(w, dupRel, dupSqliteBytes, 'application/json');
      // A known-size SQLite asset for Range tests.
      putAsset(w, `${fsBase}/sqrange.glb`, PAYLOAD, 'model/gltf-binary');
      w.close();
    });

    // ---- assets3d-08: Range parsing on the FILESYSTEM path ----
    it('FS suffix Range bytes=-5 → last 5 bytes (206, Content-Range, Content-Length)', async () => {
      const res = await rawBody(
        supertest(app).get(`/api/v1/assets3d/${fsBase}/range.glb`).set('Range', 'bytes=-5')
      ).expect(206);
      assert.equal(res.headers['content-range'], `bytes ${SIZE - 5}-${SIZE - 1}/${SIZE}`);
      assert.equal(res.headers['content-length'], '5');
      assert.equal(res.body.toString(), PAYLOAD.subarray(SIZE - 5).toString());
    });

    it('FS open-ended Range bytes=2- → offset 2..end (206, Content-Length size-2)', async () => {
      const res = await rawBody(
        supertest(app).get(`/api/v1/assets3d/${fsBase}/range.glb`).set('Range', 'bytes=2-')
      ).expect(206);
      assert.equal(res.headers['content-range'], `bytes 2-${SIZE - 1}/${SIZE}`);
      assert.equal(res.headers['content-length'], String(SIZE - 2));
      assert.equal(res.body.toString(), PAYLOAD.subarray(2).toString());
    });

    // ---- assets3d-08: Range parsing on the SQLITE path ----
    it('SQLite suffix Range bytes=-5 → last 5 bytes (206)', async () => {
      const res = await rawBody(
        supertest(app).get(`/api/v1/assets3d/${fsBase}/sqrange.glb`).set('Range', 'bytes=-5')
      ).expect(206);
      assert.equal(res.headers['content-range'], `bytes ${SIZE - 5}-${SIZE - 1}/${SIZE}`);
      assert.equal(res.headers['content-length'], '5');
      assert.equal(res.body.toString(), PAYLOAD.subarray(SIZE - 5).toString());
    });

    it('SQLite open-ended Range bytes=2- → offset 2..end (206)', async () => {
      const res = await rawBody(
        supertest(app).get(`/api/v1/assets3d/${fsBase}/sqrange.glb`).set('Range', 'bytes=2-')
      ).expect(206);
      assert.equal(res.headers['content-range'], `bytes 2-${SIZE - 1}/${SIZE}`);
      assert.equal(res.headers['content-length'], String(SIZE - 2));
      assert.equal(res.body.toString(), PAYLOAD.subarray(2).toString());
    });

    // ---- assets3d-09: SQLite shadows the filesystem ----
    it('SQLite store WINS over the filesystem for the same rel_path (body + sha1 ETag)', async () => {
      const res = await rawBody(supertest(app).get(`/api/v1/assets3d/${dupRel}`)).expect(200);
      assert.equal(res.body.toString(), dupSqliteBytes.toString(), 'served the SQLite bytes, not the FS bytes');
      assert.notEqual(res.body.toString(), 'FILESYSTEM-BYTES');
      // The store ETag is a quoted sha1 hex (40 hex chars) — not the fs size-mtime tag.
      assert.match(res.headers['etag'], /^"[0-9a-f]{40}"$/, 'strong sha1-style ETag from the store');
    });

    // ---- assets3d-10: Content-Type table ----
    it('Content-Type maps by extension (.b3dm/.pnts/.terrain → octet-stream, .gltf → gltf+json, unknown → octet-stream)', async () => {
      const expect = async (file, ct) => {
        const res = await supertest(app).get(`/api/v1/assets3d/${fsBase}/${file}`).expect(200);
        assert.equal(res.headers['content-type'], ct, `${file} → ${ct}`);
      };
      await expect('x.b3dm', 'application/octet-stream');
      await expect('x.pnts', 'application/octet-stream');
      await expect('x.terrain', 'application/octet-stream');
      await expect('x.gltf', 'model/gltf+json');
      await expect('x.unknownext', 'application/octet-stream');
    });

    // ---- assets3d-11: traversal is denied + public no-auth + 404 ----
    it('a path that tries to escape ROOT is denied and never leaks the file', async () => {
      // URL-encoded backslashes (%5C) decode to '\'. On Windows path.resolve
      // treats '\' as a separator → the target escapes ROOT → 403 Forbidden. On
      // POSIX '\' is an ordinary filename char, so the segment stays inside ROOT
      // and simply doesn't exist → 404. Both outcomes deny access; the security
      // invariant is that the out-of-ROOT file is NEVER served (no 200, no body).
      const res = await supertest(app).get('/api/v1/assets3d/..%5C..%5Cpackage.json');
      // Both outcomes deny access, but WHICH one is decided by the platform, not
      // by chance: assert the one this platform must produce.
      const denied = process.platform === 'win32' ? 403 : 404;
      assert.equal(res.status, denied, `escape must be denied with ${denied}, got ${res.status}`);
      assert.notEqual(res.status, 200, 'a path escaping ROOT must never be served');
    });

    it('the asset route is PUBLIC (no Authorization header → 200, never 401)', async () => {
      const res = await supertest(app).get(`/api/v1/assets3d/${fsBase}/range.glb`).expect(200);
      assert.notEqual(res.status, 401);
      assert.notEqual(res.status, 403);
    });

    it('a missing asset is 404 (never 401 — public route, no auth gate)', async () => {
      const res = await supertest(app).get(`/api/v1/assets3d/${fsBase}/does-not-exist.json`);
      assert.equal(res.status, 404);
    });
  });
});
