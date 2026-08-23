// Path: tests/integration/sv360-etl.test.js
// Fase 9 (stage 3a): StreetView 360 OFFLINE ETL (scripts/sv360-import.js).
// Builds a synthetic legacy index.db + a per-project {slug}.db with better-sqlite3
// in a tmp dir, runs importIndexDb(), and asserts the sv360.* rows landed (with
// geom from lon/lat), the {slug}.db was copied to the dest dir, and a rerun is
// idempotent (no duplication). Also checks per-project isolation: a project whose
// source {slug}.db is missing goes to skipped[] without aborting the rest.
//
// OS DOIS FORMATOS DE ACERVO, e é por isso que há quatro projetos na fixture. O
// histórico traz `images(photo_id, full_webp, preview_webp)` e é conferido pelo piso
// de bytes. O SÓ-TILES — o normal desde que a origem rodou `aposentar-full.js` — não
// tem coluna de blob nenhuma, e o `index.db` continua anunciando os *_size_bytes das
// imagens que já não existem, então o piso de bytes reprovaria TODO projeto podado.
// A guarda não foi afrouxada: ela virou a cobertura de pirâmide, e o projeto
// `proj-etl-tiles-parcial` é quem prende isso — com uma foto viva sem pirâmide, ele
// TEM de continuar em skipped[]. Uma versão que só tenha afrouxado o piso o importa.
//
// TEARDOWN: blobPool.closeAll() (release any worker handle) → rmSync tmp dirs →
// DELETE sv360 rows + the extra org → teardownTestEnv.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, existsSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { importIndexDb } from '../../scripts/sv360-import.js';
import { blobPool } from '../../src/utils/sqlite-blob-pool.js';

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const SLUG = 'proj-etl';
const SKIP_SLUG = 'proj-etl-missing-db';
// Acervo podado: `images` sem coluna de blob, pixel só na pirâmide.
const TILES_SLUG = 'proj-etl-so-tiles';
// O mesmo acervo podado, com UMA foto viva fora da pirâmide.
const PARCIAL_SLUG = 'proj-etl-tiles-parcial';
const DB_FILENAME = `${SLUG}.db`;
// FIX-1: the dest filename is the SERVER-DERIVED org-scoped name, not the legacy one.
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

const p1 = uuidv5('default/proj-etl/etl-foto001.jpg');
const p2 = uuidv5('default/proj-etl/etl-foto002.jpg');
const sp1 = uuidv5('default/proj-etl-missing-db/skip-foto001.jpg');
const t1 = uuidv5('default/proj-etl-so-tiles/tiles-foto001.jpg');
const t2 = uuidv5('default/proj-etl-so-tiles/tiles-foto002.jpg');
const x1 = uuidv5('default/proj-etl-tiles-parcial/parcial-foto001.jpg');
const x2 = uuidv5('default/proj-etl-tiles-parcial/parcial-foto002.jpg');

// O que o `index.db` anuncia para uma foto cujo blob a origem já apagou: o número
// permanece lá (o `aposentar-full.js` abre o índice readonly e não zera nada), e é
// alto o bastante para o piso de bytes reprovar o arquivo podado, que é minúsculo.
const BYTES_FANTASMA = 5_000_000;

const full1 = Buffer.from('RIFFxxxxWEBPetl-full-001-payload-zzzzzz');
const prev1 = Buffer.from('RIFFxxxxWEBPetl-prev-001');
const full2 = Buffer.from('RIFFxxxxWEBPetl-full-002-payload-yyyyyy');
const prev2 = Buffer.from('RIFFxxxxWEBPetl-prev-002');
const THUMB_BYTES = Buffer.from('RIFFxxxxWEBPetl-project-thumbnail');

describe('StreetView 360 — offline ETL (importIndexDb)', () => {
  let db, tmpRoot, srcDir, destDir, thumbDir, indexDbPath;
  const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

  // Build the legacy index.db (organizations/projects/photos/targets/deleted_photos).
  function buildIndexDb() {
    const idb = new Database(indexDbPath);
    idb.exec(`
      CREATE TABLE organizations (id INTEGER PRIMARY KEY, slug TEXT, name TEXT);
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY, organization_id INTEGER, slug TEXT, name TEXT,
        center_lat REAL, center_long REAL, entry_photo_id TEXT, photo_count INTEGER,
        db_filename TEXT, status TEXT
      );
      CREATE TABLE photos (
        id TEXT PRIMARY KEY, project_id INTEGER, original_name TEXT, display_name TEXT,
        sequence_number INTEGER, lat REAL, lon REAL, ele REAL, heading REAL,
        camera_height REAL, mesh_rotation_x REAL, mesh_rotation_y REAL, mesh_rotation_z REAL,
        distance_scale REAL, marker_scale REAL, floor_level INTEGER,
        full_size_bytes INTEGER, preview_size_bytes INTEGER, calibration_reviewed INTEGER,
        capture_date TEXT
      );
      CREATE TABLE targets (
        source_id TEXT, target_id TEXT, distance_m REAL, bearing_deg REAL,
        is_next INTEGER, is_original INTEGER, override_bearing REAL,
        override_distance REAL, override_height REAL, hidden INTEGER
      );
      CREATE TABLE deleted_photos (photo_id TEXT PRIMARY KEY, deleted_at TEXT);
    `);

    idb.prepare('INSERT INTO organizations (id, slug, name) VALUES (?,?,?)').run(1, 'default', 'Default');

    // Project A (importable) + Project B (its {slug}.db will be missing → skipped).
    idb.prepare(
      `INSERT INTO projects (id, organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(1, 1, SLUG, 'Projeto ETL', -23.5, -46.6, DB_FILENAME, 'enabled', 2);
    idb.prepare(
      `INSERT INTO projects (id, organization_id, slug, name, db_filename, status, photo_count)
       VALUES (?,?,?,?,?,?,?)`
    ).run(2, 1, SKIP_SLUG, 'Projeto Skip', `${SKIP_SLUG}.db`, 'enabled', 1);
    // Projeto C (só-tiles, tem de importar) e Projeto D (só-tiles com pirâmide
    // incompleta, tem de continuar sendo pulado).
    idb.prepare(
      `INSERT INTO projects (id, organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(3, 1, TILES_SLUG, 'Projeto Podado', -15.8, -47.9, `${TILES_SLUG}.db`, 'enabled', 2);
    idb.prepare(
      `INSERT INTO projects (id, organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(4, 1, PARCIAL_SLUG, 'Projeto Podado Parcial', -15.8, -47.9, `${PARCIAL_SLUG}.db`, 'enabled', 2);

    const insP = idb.prepare(
      `INSERT INTO photos (id, project_id, original_name, sequence_number, lat, lon, ele,
        heading, camera_height, mesh_rotation_x, mesh_rotation_y, mesh_rotation_z,
        distance_scale, marker_scale, floor_level, full_size_bytes, preview_size_bytes,
        calibration_reviewed)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    insP.run(p1, 1, 'etl-foto001.jpg', 1, -23.5, -46.6, 700, 0, 1.6, 0, 0, 0, 1, 1, 0, full1.length, prev1.length, 0);
    insP.run(p2, 1, 'etl-foto002.jpg', 2, -23.5005, -46.6005, 698, 0, 1.6, 0, 0, 0, 1, 1, 0, full2.length, prev2.length, 0);
    insP.run(sp1, 2, 'skip-foto001.jpg', 1, -10, -50, 100, 0, 0, 0, 0, 0, 1, 1, 0, 10, 10, 0);
    // As quatro fotos podadas carregam o tamanho FANTASMA, que é o estado real do
    // acervo: o blob se foi e o número ficou.
    insP.run(t1, 3, 'tiles-foto001.jpg', 1, -15.8, -47.9, 1100, 0, 1.6, 0, 0, 0, 1, 1, 0, BYTES_FANTASMA, 4096, 0);
    insP.run(t2, 3, 'tiles-foto002.jpg', 2, -15.8005, -47.9005, 1101, 0, 1.6, 0, 0, 0, 1, 1, 0, BYTES_FANTASMA, 4096, 0);
    insP.run(x1, 4, 'parcial-foto001.jpg', 1, -15.8, -47.9, 1100, 0, 1.6, 0, 0, 0, 1, 1, 0, BYTES_FANTASMA, 4096, 0);
    insP.run(x2, 4, 'parcial-foto002.jpg', 2, -15.8005, -47.9005, 1101, 0, 1.6, 0, 0, 0, 1, 1, 0, BYTES_FANTASMA, 4096, 0);

    idb.prepare(
      `INSERT INTO targets (source_id, target_id, distance_m, bearing_deg, is_next, is_original, hidden)
       VALUES (?,?,?,?,?,?,?)`
    ).run(p1, p2, 12.5, 90, 1, 1, 0);

    idb.close();
  }

  // Build the source {slug}.db for Project A (the importable one).
  function buildSourceDb() {
    const p = path.join(srcDir, DB_FILENAME);
    const sdb = new Database(p);
    sdb.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    const ins = sdb.prepare('INSERT INTO images VALUES (?,?,?)');
    ins.run(p1, full1, prev1);
    ins.run(p2, full2, prev2);
    sdb.close();
    // Project B's {slug}.db is intentionally NOT created → it must be skipped.
  }

  /**
   * Escreve o {slug}.db PODADO de um projeto: a tabela `images` existe, as colunas
   * de blob não. É o que a origem deixou depois do `aposentar-full.js`.
   * @param {string} slug - slug do projeto
   * @param {string[]} ids - as fotos que sobraram como registro
   * @returns {void}
   */
  function buildPodadoDb(slug, ids) {
    const sdb = new Database(path.join(srcDir, `${slug}.db`));
    sdb.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY)');
    const ins = sdb.prepare('INSERT INTO images VALUES (?)');
    for (const id of ids) ins.run(id);
    sdb.close();
  }

  /**
   * Escreve o `{slug}_tiles.db` ao lado, com uma pirâmide por id dado. O ETL tem de
   * levar este arquivo junto: sem ele o projeto podado chega ao destino sem fonte de
   * pixel nenhuma, e o defeito só aparece como panorama que nunca pinta.
   * @param {string} slug - slug do projeto
   * @param {string[]} ids - as fotos COM pirâmide (omitir uma é o caso incompleto)
   * @returns {void}
   */
  function buildTilesDb(slug, ids) {
    const tdb = new Database(path.join(srcDir, `${slug}_tiles.db`));
    tdb.exec(`CREATE TABLE tile_pyramids (
      photo_id TEXT PRIMARY KEY, tile_size INTEGER NOT NULL, max_level INTEGER NOT NULL,
      width INTEGER NOT NULL, height INTEGER NOT NULL, quality INTEGER NOT NULL,
      tile_count INTEGER NOT NULL, total_bytes INTEGER NOT NULL, built_at TEXT NOT NULL)`);
    const ins = tdb.prepare('INSERT INTO tile_pyramids VALUES (?,?,?,?,?,?,?,?,?)');
    for (const id of ids) ins.run(id, 512, 1, 4096, 2048, 80, 5, 999, '2026-08-20');
    tdb.close();
  }

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;

    tmpRoot = path.join(os.tmpdir(), `sv360-etl-${crypto.randomUUID().slice(0, 8)}`);
    srcDir = path.join(tmpRoot, 'src');
    destDir = path.join(tmpRoot, 'dest');
    thumbDir = path.join(tmpRoot, 'thumbnails');
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(destDir, { recursive: true });
    mkdirSync(thumbDir, { recursive: true });
    indexDbPath = path.join(tmpRoot, 'index.db');

    buildIndexDb();
    buildSourceDb();
    buildPodadoDb(TILES_SLUG, [t1, t2]);
    buildTilesDb(TILES_SLUG, [t1, t2]);
    buildPodadoDb(PARCIAL_SLUG, [x1, x2]);
    buildTilesDb(PARCIAL_SLUG, [x1]); // x2 fica sem pirâmide, de propósito
    // Only project A gets a thumbnail; project B has none (the real corpus has
    // 6 of 28 missing), which must NOT fail its import.
    writeFileSync(path.join(thumbDir, `${SLUG}.webp`), THUMB_BYTES);
  });

  after(async () => {
    await blobPool.closeAll();
    if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });

    await db.query(`DELETE FROM sv360.deleted_photos WHERE photo_id = ANY($1)`, [
      [p1, p2, sp1, t1, t2, x1, x2],
    ]);
    await db.query(
      `DELETE FROM sv360.projects WHERE slug = ANY($1)`,
      [[SLUG, SKIP_SLUG, TILES_SLUG, PARCIAL_SLUG]]
    );
    await teardownTestEnv(db);
  });

  it('imports a project, copies {slug}.db, fills geom; the project without a source db is skipped', async () => {
    const { imported, skipped } = await importIndexDb(indexDbPath, {
      dbDirSource: srcDir,
      dbDirDest: destDir,
      logger: silentLogger,
    });

    // Project A imported; Project B skipped (no source {slug}.db).
    assert.ok(imported.some((r) => r.slug === SLUG), 'proj-etl should import');
    assert.equal(imported.find((r) => r.slug === SLUG).photos, 2);
    assert.ok(skipped.some((r) => r.slug === SKIP_SLUG), 'proj-etl-missing-db should be skipped');

    // Rows in sv360 (default org backfill).
    const { rows: proj } = await db.query(
      `SELECT id FROM sv360.projects WHERE slug = $1
         AND organization_id = '00000000-0000-0000-0000-000000000001'`,
      [SLUG]
    );
    assert.equal(proj.length, 1);
    const pid = proj[0].id;

    const { rows: photos } = await db.query(
      `SELECT COUNT(*)::int AS n FROM sv360.photos WHERE project_id = $1`,
      [pid]
    );
    assert.equal(photos[0].n, 2);

    const { rows: targets } = await db.query(
      `SELECT COUNT(*)::int AS n FROM sv360.targets WHERE source_id = $1`,
      [p1]
    );
    assert.equal(targets[0].n, 1);

    // geom filled from lon/lat by the trigger.
    const { rows: geo } = await db.query(
      `SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat FROM sv360.photos WHERE id = $1`,
      [p1]
    );
    assert.equal(Number(geo[0].lon), -46.6);
    assert.equal(Number(geo[0].lat), -23.5);

    // {slug}.db copied to dest with both rows, under the server-derived name.
    const copied = path.join(destDir, `${DEFAULT_ORG_ID}__${SLUG}.db`);
    assert.ok(existsSync(copied), 'expected derived {slug}.db copied to dest');
    const cdb = new Database(copied, { readonly: true });
    const n = cdb.prepare('SELECT COUNT(*) AS n FROM images').get().n;
    cdb.close();
    assert.equal(n, 2);
  });

  it('is idempotent: a rerun reproduces the same state (no duplication)', async () => {
    await importIndexDb(indexDbPath, {
      dbDirSource: srcDir,
      dbDirDest: destDir,
      logger: silentLogger,
    });

    const { rows: proj } = await db.query(
      `SELECT id FROM sv360.projects WHERE slug = $1
         AND organization_id = '00000000-0000-0000-0000-000000000001'`,
      [SLUG]
    );
    assert.equal(proj.length, 1, 'no duplicate project after rerun');

    const { rows: photos } = await db.query(
      `SELECT COUNT(*)::int AS n FROM sv360.photos WHERE project_id = $1`,
      [proj[0].id]
    );
    assert.equal(photos[0].n, 2, 'still exactly 2 photos after rerun');
  });

  it('transfer:"link" hardlinks instead of copying, and a rerun keeps the source intact', async () => {
    const linkDir = path.join(tmpRoot, 'linked');
    mkdirSync(linkDir, { recursive: true });
    const srcPath = path.join(srcDir, DB_FILENAME);
    const linkPath = path.join(linkDir, `${DEFAULT_ORG_ID}__${SLUG}.db`);

    const { imported } = await importIndexDb(indexDbPath, {
      dbDirSource: srcDir,
      dbDirDest: linkDir,
      thumbDirSource: thumbDir,
      transfer: 'link',
      logger: silentLogger,
    });
    assert.ok(imported.some((r) => r.slug === SLUG), 'proj-etl should import in link mode');

    // The distinguishing property vs. a copy: SAME inode, and the source now has
    // ≥2 directory entries. A copy would produce a different ino and nlink 1.
    const srcStat = statSync(srcPath);
    const linkStat = statSync(linkPath);
    assert.equal(linkStat.ino, srcStat.ino, 'dest must be the same inode as the source');
    assert.ok(srcStat.nlink >= 2, `expected nlink >= 2 after linking, got ${srcStat.nlink}`);

    // Rerunning over a live link must relink, not truncate-through to the source:
    // linkSync fails EEXIST, so the dest is removed first, and removing a LINK must
    // never touch the shared data. Reading the payload back is what proves it.
    await importIndexDb(indexDbPath, {
      dbDirSource: srcDir,
      dbDirDest: linkDir,
      transfer: 'link',
      logger: silentLogger,
    });
    const ldb = new Database(linkPath, { readonly: true });
    const row = ldb.prepare('SELECT full_webp AS f FROM images WHERE photo_id = ?').get(p1);
    const total = ldb.prepare('SELECT COUNT(*) AS n FROM images').get().n;
    ldb.close();
    assert.equal(total, 2, 'both image rows survive the relink');
    assert.deepEqual(Buffer.from(row.f), full1, 'BLOB bytes survive the relink');
  });

  it('transfers the project thumbnail under the ORG-KEYED name the serving route resolves', async () => {
    const thumbOutDir = path.join(tmpRoot, 'thumb-dest');
    mkdirSync(thumbOutDir, { recursive: true });

    const { imported } = await importIndexDb(indexDbPath, {
      dbDirSource: srcDir,
      dbDirDest: thumbOutDir,
      thumbDirSource: thumbDir,
      logger: silentLogger,
    });

    // GET /sv360/thumbnails/:slug.webp resolves `{orgId}__{slug}.webp` inside
    // SV360_DB_DIR — the legacy `{slug}.webp` name would 404.
    const served = path.join(thumbOutDir, `${DEFAULT_ORG_ID}__${SLUG}.webp`);
    assert.ok(existsSync(served), 'thumbnail must land under the org-keyed name');
    assert.deepEqual(readFileSync(served), THUMB_BYTES, 'thumbnail bytes transferred intact');
    assert.ok(
      !existsSync(path.join(thumbOutDir, `${SLUG}.webp`)),
      'and NOT under the legacy slug-only name, which the route would not find'
    );

    // A project whose thumbnail is absent still imports — reported, never fatal.
    const projA = imported.find((r) => r.slug === SLUG);
    assert.equal(projA.thumbnail, true, 'proj-etl reports its thumbnail transferred');
  });

  it('importa um projeto SÓ-TILES e leva o {slug}_tiles.db junto', async () => {
    const podadoDir = path.join(tmpRoot, 'dest-podado');
    mkdirSync(podadoDir, { recursive: true });

    const { imported, skipped } = await importIndexDb(indexDbPath, {
      dbDirSource: srcDir,
      dbDirDest: podadoDir,
      logger: silentLogger,
    });

    const podado = imported.find((r) => r.slug === TILES_SLUG);
    assert.ok(podado, `${TILES_SLUG} tinha de importar — skipped: ${JSON.stringify(skipped)}`);
    assert.equal(podado.photos, 2);
    assert.equal(podado.tiles, true, 'o relatório tem de registrar o tiles db transferido');

    // O ARQUIVO QUE FALTAVA. O ETL não copiava `{slug}_tiles.db`, então um acervo
    // podado chegava ao destino sem fonte de pixel nenhuma.
    const tilesDest = path.join(podadoDir, `${DEFAULT_ORG_ID}__${TILES_SLUG}_tiles.db`);
    assert.ok(existsSync(tilesDest), 'o {slug}_tiles.db tem de chegar sob o nome org-keyed');
    const tdb = new Database(tilesDest, { readonly: true });
    const ids = tdb.prepare('SELECT photo_id FROM tile_pyramids ORDER BY photo_id').all();
    tdb.close();
    assert.deepEqual(
      ids.map((r) => r.photo_id).sort(),
      [t1, t2].sort(),
      'a pirâmide das duas fotos vivas viajou junto'
    );

    // E o {slug}.db podado entra sendo MUITO menor que os *_size_bytes que o index.db
    // anuncia: é exatamente o piso de bytes que não se aplica a este formato.
    const imagesDest = path.join(podadoDir, `${DEFAULT_ORG_ID}__${TILES_SLUG}.db`);
    assert.ok(existsSync(imagesDest), 'o {slug}.db podado também é instalado');
    assert.ok(
      statSync(imagesDest).size < BYTES_FANTASMA,
      'o arquivo podado é minúsculo perto do que o índice ainda anuncia'
    );

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM sv360.photos
        WHERE project_id = (SELECT id FROM sv360.projects WHERE slug = $1)`,
      [TILES_SLUG]
    );
    assert.equal(rows[0].n, 2, 'as duas fotos do projeto podado entraram');

    // A PIRÂMIDE TAMBÉM ATRAVESSA, e não só o arquivo. Copiar o `{slug}_tiles.db` e
    // deixar `sv360.photo_pyramids` vazia produzia exatamente o sintoma que o caso
    // acima existe para impedir: `GET /photos/:uuid/tiles.json` respondia 404, o
    // cliente entendia "esta foto tem blob" e pedia a imagem inteira, que não existe
    // neste formato. Arquivo no disco, Postgres vazio, panorama preto.
    assert.equal(podado.pyramids, 2, 'o relatório tem de contar as pirâmides gravadas');
    const { rows: pyr } = await db.query(
      `SELECT photo_id, tile_size, max_level, width, height, quality,
              tile_count, total_bytes, razao
         FROM sv360.photo_pyramids WHERE photo_id = ANY($1::text[]) ORDER BY photo_id`,
      [[t1, t2]]
    );
    assert.equal(pyr.length, 2, 'as duas fotos vivas precisam ter linha de pirâmide');
    for (const p of pyr) {
      // Os números do `buildTilesDb`: (512, 1, 4096, 2048, 80, 5, 999). A asserção é
      // absoluta porque uma linha com zeros passaria em qualquer "existe".
      assert.equal(p.tile_size, 512);
      assert.equal(p.max_level, 1);
      assert.equal(p.width, 4096);
      assert.equal(p.height, 2048);
      assert.equal(p.quality, 80);
      assert.equal(p.tile_count, 5);
      assert.equal(Number(p.total_bytes), 999);
      // A tabela do fixture NÃO tem a coluna `razao` (o acervo real tem os dois
      // esquemas), e o default precisa ser o mesmo de `escadaGravada`: com outro
      // valor, o descritor anunciaria uma escada que os tiles não têm.
      assert.equal(Number(p.razao), 2);
    }
  });

  it('RECUSA o projeto SÓ-TILES cuja pirâmide não cobre uma foto viva', async () => {
    // A CONTRAPROVA do caso acima: se a correção tivesse sido afrouxar o piso de
    // bytes, este projeto importaria com metade das fotos sem pixel, e o defeito só
    // apareceria depois, num panorama que nunca pinta.
    const parcialDir = path.join(tmpRoot, 'dest-parcial');
    mkdirSync(parcialDir, { recursive: true });

    const { imported, skipped } = await importIndexDb(indexDbPath, {
      dbDirSource: srcDir,
      dbDirDest: parcialDir,
      logger: silentLogger,
    });

    assert.ok(!imported.some((r) => r.slug === PARCIAL_SLUG), 'não pode importar');
    const parcial = skipped.find((r) => r.slug === PARCIAL_SLUG);
    assert.ok(parcial, 'pirâmide incompleta tem de ir para skipped[]');
    assert.match(parcial.error, new RegExp(x2), 'a mensagem nomeia a foto sem pirâmide');
    // E nomeia a CAUSA. A mensagem antiga mandava o operador caçar corrupção de cópia.
    assert.doesNotMatch(parcial.error, /summed photo BLOB bytes/);

    // O erro rola a transação do projeto para trás, e nada meio-instalado fica em disco.
    const { rows } = await db.query('SELECT id FROM sv360.projects WHERE slug = $1', [
      PARCIAL_SLUG,
    ]);
    assert.equal(rows.length, 0, 'o merge do projeto recusado tem de ter sido revertido');
    assert.ok(
      !existsSync(path.join(parcialDir, `${DEFAULT_ORG_ID}__${PARCIAL_SLUG}.db`)),
      'nem o {slug}.db do projeto recusado chega ao destino'
    );
    assert.ok(
      !existsSync(path.join(parcialDir, `${DEFAULT_ORG_ID}__${PARCIAL_SLUG}_tiles.db`)),
      'nem o {slug}_tiles.db dele'
    );

    // O projeto SÃO da mesma rodada segue entrando: o isolamento por projeto vale.
    assert.ok(imported.some((r) => r.slug === TILES_SLUG), 'o projeto podado íntegro importa');
  });
});
