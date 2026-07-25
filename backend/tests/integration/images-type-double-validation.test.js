// Path: tests/integration/images-type-double-validation.test.js
//
// Itens 27 e 108 do relatório. Os dois vivem na MESMA linha de código
// (images.service.js:46-49), e por isso no mesmo arquivo: a condição que rejeita e o
// `unlink` que limpa o rastro da rejeição.
//
//   27 — a validação dupla tem TRÊS cláusulas e só a primeira estava exercitada.
//        `images-hardening.test.js:48-57` manda '<html>not a png</html>' declarado como
//        image/png: `fileTypeFromFile` devolve undefined e o teste morre na cláusula
//        `!detected`. As outras duas — `!ALLOWED_MIME_TYPES.includes(detected.mime)` e,
//        sobretudo, `detected.mime !== file.mimetype` — nunca rodavam. Apagar a
//        igualdade (deixando só a allowlist) fazia o par declarado/real divergir sem
//        erro: `mime_type` é gravado do DECLARADO e o download monta o Content-Type a
//        partir dele, então o header passaria a mentir sobre os bytes servidos.
//
//   108 — o multer grava o arquivo em disco ANTES de qualquer checagem de conteúdo
//        (diskStorage em images.routes.js:35-46), então toda rejeição por magic bytes
//        depende do `await unlink(file.path)` da linha 47 para não deixar lixo. Os
//        testes de hardening afirmam só o status 400: o verde deles não diz nada sobre
//        o disco, e um upload rejeitado que deixasse o blob seria disk-fill autenticado,
//        invisível para a API e para a suíte.
//
// Toda asserção aqui é sobre EFEITO (linhas em `images`, arquivos no diretório do
// atlas), nunca só sobre o status.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { existsSync, readdirSync } from 'fs';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';

// Fixtures com MAGIC BYTES reais — um placeholder textual reprovaria pelo motivo
// errado (cairia em `!detected`, que é justamente a cláusula já coberta).
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const WEBP_B64 = 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';
const GIF_B64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const PNG = Buffer.from(PNG_B64, 'base64');
const JPEG = Buffer.from(JPEG_B64, 'base64');
const WEBP = Buffer.from(WEBP_B64, 'base64');
const GIF = Buffer.from(GIF_B64, 'base64');

describe('images — double type validation (magic bytes vs declared) and disk cleanup', () => {
  let app, db, owner, token, atlas;

  const sfx = randomUUID().slice(0, 8);

  /** POST /images with an explicit declared Content-Type for the part. */
  function upload(bytes, filename, contentType) {
    return supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', bytes, { filename, contentType });
  }

  async function imageCount() {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM images WHERE atlas_id = $1', [atlas.id]
    );
    return rows[0].n;
  }

  /** Files currently sitting in this atlas's upload directory (0 when absent). */
  function filesOnDisk() {
    const dir = join(config.images.dir, atlas.id);
    return existsSync(dir) ? readdirSync(dir) : [];
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `imgdv_${sfx}` });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: `ImgDV ${sfx}` });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // 27 — cláusula `detected.mime !== file.mimetype`
  // ==========================================================================
  describe('27 — declared type must equal the detected type', () => {
    it('the fixtures really are what they claim (guard: otherwise every 400 below is vacuous)', async () => {
      const { fileTypeFromBuffer } = await import('file-type');
      assert.equal((await fileTypeFromBuffer(PNG)).mime, 'image/png');
      assert.equal((await fileTypeFromBuffer(JPEG)).mime, 'image/jpeg');
      assert.equal((await fileTypeFromBuffer(WEBP)).mime, 'image/webp');
      assert.equal((await fileTypeFromBuffer(GIF)).mime, 'image/gif');
    });

    it('JPEG bytes declared image/png -> 400 and no row is created', async () => {
      const before = await imageCount();
      const res = await upload(JPEG, 'x.png', 'image/png').expect(400);
      assert.equal(res.body.error.code, 'BAD_REQUEST');
      assert.match(res.body.error.message, /does not match declared type/i);
      assert.equal(await imageCount(), before, 'a rejected upload must create nothing');
    });

    it('WebP bytes declared image/jpeg -> 400 (both sides INSIDE the allowlist)', async () => {
      // O par cruzado é o caso que só a igualdade pega: `ALLOWED.includes(detected.mime)`
      // sozinho aprovaria este upload, porque image/webp está na allowlist.
      const before = await imageCount();
      const res = await upload(WEBP, 'x.jpg', 'image/jpeg').expect(400);
      assert.equal(res.body.error.code, 'BAD_REQUEST');
      assert.equal(await imageCount(), before);
    });

    it('PNG bytes declared image/webp -> 400 (a igualdade vale nos dois sentidos)', async () => {
      const before = await imageCount();
      await upload(PNG, 'x.webp', 'image/webp').expect(400);
      assert.equal(await imageCount(), before);
    });

    it('GIF bytes declared image/png -> 400 (cláusula !ALLOWED.includes(detected.mime))', async () => {
      // Detectado com sucesso, tipo real VÁLIDO como imagem, porém fora da allowlist:
      // esta é a segunda cláusula, e ela precisa reprovar antes mesmo da igualdade.
      const before = await imageCount();
      await upload(GIF, 'x.png', 'image/png').expect(400);
      assert.equal(await imageCount(), before);
    });

    it('control: PNG bytes declared image/png -> 201 with mime_type gravado do arquivo real', async () => {
      // Sem este controle, os 400 acima passariam também com um fixture quebrado.
      const before = await imageCount();
      const res = await upload(PNG, 'ok.png', 'image/png').expect(201);
      assert.ok(res.body.data.id);
      assert.equal(res.body.data.mime_type, 'image/png');
      assert.equal(await imageCount(), before + 1);

      // O invariante que a igualdade sustenta: o Content-Type servido no download
      // descreve os bytes servidos. Se a cláusula caísse, este par divergiria.
      const dl = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images/${res.body.data.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      assert.match(dl.headers['content-type'], /image\/png/);
      assert.deepEqual(dl.body, PNG, 'os bytes servidos são de fato um PNG');
    });

    it('control: JPEG bytes declared image/jpeg -> 201 (o fixture JPEG presta)', async () => {
      const res = await upload(JPEG, 'ok.jpg', 'image/jpeg').expect(201);
      assert.equal(res.body.data.mime_type, 'image/jpeg');
    });
  });

  // ==========================================================================
  // 27 — mesma validação no caminho /bulk (images.service.js:185)
  // ==========================================================================
  describe('27 — /images/bulk applies the same equality', () => {
    /** Um item de bulk; devolve o corpo de data. */
    async function bulk(items) {
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
        .set('Authorization', `Bearer ${token}`)
        .send({ images: items })
        .expect(201);
      return res.body.data;
    }

    it('JPEG base64 declarado image/png falha o item, sem linha e sem mapping', async () => {
      const localId = randomUUID();
      const before = await imageCount();
      const data = await bulk([
        { localId, filename: 'b.png', mimeType: 'image/png', data: JPEG_B64 },
      ]);

      assert.equal(data.uploaded.length, 0);
      assert.equal(data.failed.length, 1);
      assert.equal(data.failed[0].localId, localId);
      assert.equal(data.failed[0].error, 'Content does not match declared type');
      assert.equal(Object.keys(data.mapping).length, 0, 'nenhum mapping para item rejeitado');
      assert.equal(await imageCount(), before, 'nenhuma linha criada');

      const { rows } = await db.query('SELECT 1 FROM images WHERE id = $1', [localId]);
      assert.equal(rows.length, 0, 'o localId rejeitado não pode virar linha');
    });

    it('GIF base64 declarado image/png falha o item (allowlist sobre o tipo DETECTADO)', async () => {
      const localId = randomUUID();
      const data = await bulk([
        { localId, filename: 'b.png', mimeType: 'image/png', data: GIF_B64 },
      ]);
      assert.equal(data.failed.length, 1);
      assert.equal(data.failed[0].error, 'Content does not match declared type');
    });

    it('control: PNG base64 declarado image/png sobe (o lote não está quebrado por outro motivo)', async () => {
      const localId = randomUUID();
      const data = await bulk([
        { localId, filename: 'b.png', mimeType: 'image/png', data: PNG_B64 },
      ]);
      assert.equal(data.failed.length, 0);
      assert.equal(data.uploaded.length, 1);
      assert.equal(data.mapping[localId], localId);
    });

    it('num lote MISTO só o item divergente falha (a rejeição é por item, não por lote)', async () => {
      const okId = randomUUID();
      const badId = randomUUID();
      const data = await bulk([
        { localId: badId, filename: 'bad.png', mimeType: 'image/png', data: WEBP_B64 },
        { localId: okId, filename: 'good.png', mimeType: 'image/png', data: PNG_B64 },
      ]);
      assert.equal(data.failed.length, 1);
      assert.equal(data.failed[0].localId, badId);
      assert.equal(data.uploaded.length, 1);
      assert.equal(data.uploaded[0].localId, okId);
    });
  });

  // ==========================================================================
  // 108 — o blob do upload rejeitado não pode sobrar em disco
  // ==========================================================================
  describe('108 — a rejected upload leaves no file behind', () => {
    it('control do instrumento: um upload VÁLIDO aumenta a contagem de arquivos em 1', async () => {
      // Sem isto, "a contagem não mudou" passaria com o diretório inexistente ou com
      // um caminho de storage que o teste nem está olhando.
      const before = filesOnDisk().length;
      await upload(PNG, 'counted.png', 'image/png').expect(201);
      assert.equal(filesOnDisk().length, before + 1, 'o instrumento enxerga o diretório real');
    });

    it('conteúdo indetectável (<html> declarado png) -> 400 e zero arquivo residual', async () => {
      const before = filesOnDisk().length;
      await upload(Buffer.from('<html>not a png</html>'), 'evil.png', 'image/png').expect(400);
      assert.equal(filesOnDisk().length, before, 'o multer gravou; o service tem de apagar');
    });

    it('mismatch JPEG-declarado-PNG -> 400 e zero arquivo residual', async () => {
      const before = filesOnDisk().length;
      await upload(JPEG, 'mismatch.png', 'image/png').expect(400);
      assert.equal(filesOnDisk().length, before);
    });

    it('tipo detectado fora da allowlist (GIF) -> 400 e zero arquivo residual', async () => {
      const before = filesOnDisk().length;
      await upload(GIF, 'gif.png', 'image/png').expect(400);
      assert.equal(filesOnDisk().length, before);
    });

    it('invariante de consistência: todo arquivo do diretório tem exatamente uma linha em images', async () => {
      // A afirmação forte do item 108: depois de todas as rejeições acima, disco e
      // banco continuam em bijeção. Um órfão quebra este assert mesmo que cada
      // contagem individual acima estivesse certa por acaso.
      const dir = join(config.images.dir, atlas.id);
      const files = filesOnDisk().map((f) => join(dir, f));
      assert.ok(files.length > 0, 'o diretório precisa ter arquivos, senão a bijeção é vazia');

      const { rows } = await db.query(
        'SELECT storage_path FROM images WHERE atlas_id = $1', [atlas.id]
      );
      const stored = new Set(rows.map((r) => r.storage_path));
      assert.equal(rows.length, stored.size, 'nenhum storage_path duplicado');

      for (const f of files) {
        assert.ok(stored.has(f), `arquivo órfão em disco (nenhuma linha aponta para ele): ${f}`);
      }
      assert.equal(files.length, stored.size, 'disco e banco em bijeção');
    });
  });
});
