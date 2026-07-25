// Path: tests/integration/sv360-missing-blob.test.js
// GET /sv360/photos/:uuid/image when Postgres knows the photo but the blobstore
// returns null — the `if (!buf) { release(); next(NotFoundError) }` branch of
// sv360.controller.js, which no test reached (sv360-image-drift.test.js covers a
// blob that is PRESENT with a divergent size).
//
// Two independent ways to get there, both reachable in production:
//   a) the {slug}.db file is absent (the residual crash window between PASSO 1 and
//      the PASSO 2 commit, which sv360.ingest.js documents, or a manual removal);
//   b) the file exists but has no row for that photo id.
//
// What actually matters here is not the 404 — it is the `release()` that precedes
// it. Drop that one call and the semaphore (SV360_MAX_INFLIGHT permits) drains one
// permit per missing blob until photo serving stops answering AT ALL, with no error,
// no log and no failing test. The suite runs this file with SV360_MAX_INFLIGHT=2 so
// a single leaked permit is fatal within a handful of requests instead of eight.
//
// CONTROLE NEGATIVO: removing `release()` from that branch makes the "still answers
// after N misses" case hang until the test timeout, and the valid-photo case after
// it never gets a permit.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';

// Must be set BEFORE src/config.js is first imported — hence the dynamic imports.
process.env.SV360_MAX_INFLIGHT = '2';

const supertest = (await import('supertest')).default;
const { setupTestEnv, teardownTestEnv } = await import('../helpers/setup.js');
const config = (await import('../../src/config.js')).default;
const { closeStore } = await import('../../src/modules/streetview360/sv360.blobstore.js');

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const RID = crypto.randomUUID().slice(0, 8);
// (a) project whose db_filename points at a file that does not exist on disk.
const SLUG_NO_FILE = `sv360-noblob-file-${RID}`;
// (b) project whose {slug}.db exists but carries no row for the photo.
const SLUG_NO_ROW = `sv360-noblob-row-${RID}`;

const goodBlob = Buffer.from('RIFFxxxxWEBP-conteudo-valido-desta-foto');
const goodPrev = Buffer.from('RIFFxxxxWEBP-prev');

const photoNoFile = uuidv5(`default/${SLUG_NO_FILE}/sem-arquivo.jpg`);
const photoNoRow = uuidv5(`default/${SLUG_NO_ROW}/sem-linha.jpg`);
const photoGood = uuidv5(`default/${SLUG_NO_ROW}/com-linha.jpg`);

const imageUrl = (id) => `/api/v1/sv360/photos/${id}/image`;

describe('StreetView 360 — foto sem blob: 404 e o permit do semáforo volta', () => {
  let app, db, dbPathNoRow, missingDbPath;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query("SELECT id FROM public.organizations WHERE slug = 'default'");
    const orgId = org.rows[0].id;

    mkdirSync(config.sv360.dbDir, { recursive: true });

    // (a) db_filename aponta para um arquivo INEXISTENTE.
    const missingName = `${orgId}__${SLUG_NO_FILE}.db`;
    missingDbPath = path.resolve(config.sv360.dbDir, missingName);
    if (existsSync(missingDbPath)) rmSync(missingDbPath, { force: true });

    const p1 = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Sem arquivo', -23, -46, $3, 'enabled', 1) RETURNING id`,
      [orgId, SLUG_NO_FILE, missingName]
    );
    await db.query(
      `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon, full_size_bytes, preview_size_bytes)
       VALUES ($1, $2, 'sem-arquivo.jpg', 1, -23, -46, 100, 10)`,
      [photoNoFile, p1.rows[0].id]
    );

    // (b) o {slug}.db existe, mas só tem a linha da foto BOA.
    const rowName = `${orgId}__${SLUG_NO_ROW}.db`;
    dbPathNoRow = path.resolve(config.sv360.dbDir, rowName);
    if (existsSync(dbPathNoRow)) rmSync(dbPathNoRow, { force: true });
    const sdb = new Database(dbPathNoRow);
    sdb.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    sdb.prepare('INSERT INTO images VALUES (?,?,?)').run(photoGood, goodBlob, goodPrev);
    sdb.close();

    const p2 = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Sem linha', -23, -46, $3, 'enabled', 2) RETURNING id`,
      [orgId, SLUG_NO_ROW, rowName]
    );
    await db.query(
      `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon, full_size_bytes, preview_size_bytes)
       VALUES ($1, $2, 'sem-linha.jpg', 1, -23, -46, 100, 10),
              ($3, $2, 'com-linha.jpg', 2, -23, -46, $4, $5)`,
      [photoNoRow, p2.rows[0].id, photoGood, goodBlob.length, goodPrev.length]
    );
  });

  after(async () => {
    await closeStore();
    for (const f of [dbPathNoRow, `${dbPathNoRow}-wal`, `${dbPathNoRow}-shm`, missingDbPath]) {
      if (f && existsSync(f)) {
        try {
          rmSync(f, { force: true });
        } catch {
          /* ignore */
        }
      }
    }
    await db.query(`DELETE FROM sv360.photos WHERE id = ANY($1)`, [
      [photoNoFile, photoNoRow, photoGood],
    ]);
    await db.query(`DELETE FROM sv360.projects WHERE slug = ANY($1)`, [
      [SLUG_NO_FILE, SLUG_NO_ROW],
    ]);
    await teardownTestEnv(db);
  });

  it('projeto habilitado cujo {slug}.db não existe em disco → 404 com envelope plano', async () => {
    const res = await supertest(app).get(imageUrl(photoNoFile)).expect(404);
    assert.equal(typeof res.body.error, 'string', 'sv360 usa envelope plano { error }');
    assert.equal(res.body.error?.code, undefined, 'não pode ser o envelope aninhado do resto da API');
  });

  it('{slug}.db presente porém SEM a linha do photo_id → 404 (o outro caminho para buf null)', async () => {
    const res = await supertest(app).get(imageUrl(photoNoRow)).expect(404);
    assert.equal(typeof res.body.error, 'string');
  });

  it('estritamente 404, nunca um 200 de corpo vazio', async () => {
    // Um `res.end()` sem status explícito responderia 200 com Content-Length 0, e um
    // cliente que só checa `res.ok` cacheria bytes vazios como se fossem a foto.
    const res = await supertest(app).get(imageUrl(photoNoRow));
    assert.equal(res.status, 404);
    assert.notEqual(res.status, 200);
  });

  it('o 404 NÃO herda os cabeçalhos immutable do caminho feliz (drift é transitório)', async () => {
    // Os cabeçalhos de cache sobem ANTES da leitura do blob (o ETag é O(1), vem do
    // Postgres), então este 404 nasce com `public, max-age=31536000, immutable`. A
    // ausência do blob é transitória por construção — a janela entre o PASSO 1 e o
    // commit do PASSO 2 da ingestão —, então um cache que respeite o cabeçalho fixa
    // a foto como inexistente por um ANO depois que o drift já se curou.
    const res = await supertest(app).get(imageUrl(photoNoFile)).expect(404);
    assert.doesNotMatch(res.headers['cache-control'] ?? '', /immutable/, 'um 404 transitório não é imutável');
    assert.doesNotMatch(res.headers['cache-control'] ?? '', /max-age=31536000/);
    assert.equal(res.headers['cache-control'], 'no-store');
    // O ETag forte que a rota emite no caminho feliz é `"{uuid}-{quality}-{bytes}"`
    // e identifica os BYTES DA FOTO. Ele não pode sobreviver num 404: o que o
    // Express regenera aqui (weak, sobre o corpo de erro) é inócuo.
    const etag = res.headers.etag ?? '';
    assert.doesNotMatch(etag, new RegExp(photoNoFile), 'o ETag da foto não pode identificar um 404');
    assert.doesNotMatch(etag, /^"[0-9a-f-]+-(full|preview)-\d+"$/, 'ETag forte do blob permaneceu');
    assert.doesNotMatch(
      res.headers['content-type'] ?? '',
      /image\/webp/,
      'o corpo é JSON de erro, não uma imagem'
    );
  });

  it('N misses seguidos NÃO esgotam o semáforo: a última ainda responde 404', async () => {
    // Com maxInflight=2, um permit vazado por miss trava o serviço na 3a chamada.
    // As requisições são SEQUENCIAIS de propósito: em paralelo, um vazamento poderia
    // ser mascarado por permits ainda em voo.
    const n = config.sv360.maxInflight + 2;
    assert.ok(n >= 4, 'guard: o laço precisa exceder a capacidade do semáforo');
    for (let i = 0; i < n; i += 1) {
      const res = await supertest(app).get(imageUrl(photoNoFile));
      assert.equal(res.status, 404, `requisição ${i + 1}/${n} deixou de responder`);
    }
  });

  it('logo após os misses, uma foto VÁLIDA é servida 200 com os bytes corretos', async () => {
    // O fecho: prova que sobraram permits. Sem o release() a rota nem chega aqui.
    const res = await supertest(app).get(`${imageUrl(photoGood)}?quality=full`).expect(200);
    assert.ok(Buffer.from(res.body).equals(goodBlob), 'os bytes servidos são os do blob real');
  });
});
