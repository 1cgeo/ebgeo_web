// Path: tests/integration/images-size-boundary.test.js
// Item 166 (testes-backend.md, fatia be-images): fronteira exata de
// MAX_IMAGE_SIZE_MB nos DOIS guardas.
//
// Guarda 1 — multer `limits.fileSize` (images.routes.js:50-62), que aborta o stream.
// Guarda 2 — `file.size > maxBytes` no service (images.service.js:38-40).
//
// DEFEITO ENCONTRADO E CORRIGIDO ao escrever este arquivo, e e exatamente a
// classe que o item previu: os dois guardas discordavam em UM byte. O busboy
// corta quando o contador ATINGE o limite, nao quando o ultrapassa
// (`if (fileSize === fileSizeLimit)`, busboy/lib/types/multipart.js:476), entao
// `fileSize: maxBytes` cru recusava um arquivo de exatamente MAX_IMAGE_SIZE_MB —
// com a mensagem "Image too large (max 10MB)", que contradizia o proprio limite —
// enquanto o service (`> maxBytes`) aceitaria o mesmo arquivo. Corrigido em
// images.routes.js passando `maxBytes + 1` ao busboy, o que NAO afrouxa nada: o
// corte passa a cair no primeiro tamanho realmente ilegal.
//
// Cobertura anterior: images-hardening.test.js:59-69 (maxSizeMb + 1 MB) e
// images-gaps.test.js:274-294 (bulk com 11 MB). Os dois estao a um megabyte
// inteiro da borda, e e a borda que erra: trocar `>` por `>=`, ou calcular
// `maxSizeMb * 1000 * 1000`, rejeita arquivo legitimo exatamente no limite sem
// mover nenhum dos verdes existentes. A pergunta de ouro respondida aqui: o que
// um teste de 11 MB provaria se o limite estivesse um byte deslocado? Nada.
//
// A terceira invariante e de arquitetura, nao de tamanho: por HTTP o guarda do
// service e INALCANCAVEL, porque o multer corta antes. Isso e verificado pela
// MENSAGEM (as duas sao diferentes), e importa no dia em que alguem remover
// `limits.fileSize` achando que o service cobre — os testes de HTTP continuariam
// verdes e o servidor passaria a gravar o arquivo inteiro em disco antes de
// recusa-lo. Por isso o guarda do service e exercitado direto, sem HTTP.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'fs';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import * as imagesService from '../../src/modules/images/images.service.js';
import config from '../../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const uname = (p) => `isb_${p}_${randomUUID().slice(0, 8)}`;

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
);

const MAX_BYTES = config.images.maxSizeMb * 1024 * 1024;

/**
 * PNG valido com EXATAMENTE `total` bytes: o padding vai depois do IEND, entao os
 * magic bytes continuam intactos e `fileTypeFromFile` ainda detecta image/png.
 * @param {number} total
 */
function pngComTamanho(total) {
  assert.ok(total >= PNG_1x1.length, 'o PNG minimo ja e maior que o alvo');
  return Buffer.concat([PNG_1x1, Buffer.alloc(total - PNG_1x1.length, 0x00)]);
}

describe('Images — fronteira exata de MAX_IMAGE_SIZE_MB (item 166)', () => {
  let app, db, owner, token, atlas, atlasDir;
  const tmpFiles = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: uname('owner') });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: `Size Boundary ${randomUUID().slice(0, 6)}` });
    atlasDir = resolve(join(config.images.dir, atlas.id));
  });

  after(async () => {
    for (const f of tmpFiles) {
      try { rmSync(f, { force: true }); } catch { /* best effort */ }
    }
    await teardownTestEnv(db);
  });

  function countFiles() {
    return existsSync(atlasDir) ? readdirSync(atlasDir).length : 0;
  }

  async function countRows() {
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM images WHERE atlas_id = $1', [atlas.id]);
    return rows[0].n;
  }

  const post = () => supertest(app)
    .post(`/api/v1/atlas/${atlas.id}/images`)
    .set('Authorization', `Bearer ${token}`);

  // ─────────────────────────────────────────────────────────────────────────
  // Upload single: a borda do multer
  // ─────────────────────────────────────────────────────────────────────────

  it('EXATAMENTE maxBytes e aceito: 201 e size_bytes === maxBytes no banco', async () => {
    const res = await post()
      .attach('image', pngComTamanho(MAX_BYTES), { filename: 'exato.png', contentType: 'image/png' })
      .expect(201);

    // O limite e inclusivo dos dois lados (`> limit` no busboy, `> maxBytes` no
    // service). Um `>=` em qualquer um dos dois derruba esta linha.
    const { rows } = await db.query('SELECT size_bytes FROM images WHERE id = $1', [res.body.data.id]);
    assert.equal(Number(rows[0].size_bytes), MAX_BYTES, 'o arquivo no limite e gravado inteiro');
    assert.equal(Number(res.body.data.size_bytes), MAX_BYTES, 'e o envelope concorda com o banco');
  });

  it('maxBytes + 1 e recusado: 400 BAD_REQUEST, nenhuma linha e nenhum blob', async () => {
    const arquivosAntes = countFiles();
    const linhasAntes = await countRows();

    const res = await post()
      .attach('image', pngComTamanho(MAX_BYTES + 1), { filename: 'um-a-mais.png', contentType: 'image/png' })
      .expect(400);

    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.equal(await countRows(), linhasAntes, 'nenhuma linha criada');
    assert.equal(countFiles(), arquivosAntes, 'o blob truncado nao pode sobrar em disco');
  });

  it('UM byte separa os dois resultados: a fronteira e maxBytes, nao "por volta de"', async () => {
    // Duas requisicoes que diferem em exatamente 1 byte e em nada mais.
    const ok = await post()
      .attach('image', pngComTamanho(MAX_BYTES), { filename: 'no-limite.png', contentType: 'image/png' })
      .expect(201);
    const nok = await post()
      .attach('image', pngComTamanho(MAX_BYTES + 1), { filename: 'passou.png', contentType: 'image/png' })
      .expect(400);

    assert.equal(Number(ok.body.data.size_bytes), MAX_BYTES);
    assert.equal(nok.body.error.code, 'BAD_REQUEST');
  });

  it('quem recusa por HTTP e o MULTER, nao o service (mensagens distintas)', async () => {
    const res = await post()
      .attach('image', pngComTamanho(MAX_BYTES + 1), { filename: 'quem-recusou.png', contentType: 'image/png' })
      .expect(400);

    // images.routes.js:78-80 (multer) vs images.service.js:40 (service). Se o dia
    // vier em que esta assercao falhar com a mensagem do service, o significado e
    // preciso: `limits.fileSize` sumiu e o servidor esta gravando o arquivo
    // inteiro em disco antes de recusa-lo.
    assert.equal(res.body.error.message, `Image too large (max ${config.images.maxSizeMb}MB)`);
    assert.doesNotMatch(res.body.error.message, /^File too large\./, 'nao e o guarda do service');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // O guarda do service, exercitado direto (inalcancavel por HTTP)
  // ─────────────────────────────────────────────────────────────────────────

  describe('guarda do service (images.service.js:38-40), fora do HTTP', () => {
    let pngPath;

    before(() => {
      const fixtureDir = join(__dirname, '..', 'fixtures');
      if (!existsSync(fixtureDir)) mkdirSync(fixtureDir, { recursive: true });
      pngPath = join(fixtureDir, `isb-${randomUUID().slice(0, 8)}.png`);
      writeFileSync(pngPath, PNG_1x1);
      tmpFiles.push(pngPath);
    });

    /** Molda o objeto que o multer entregaria ao service. */
    const fakeFile = (size) => ({
      originalname: 'direto.png',
      mimetype: 'image/png',
      size,
      path: pngPath,
    });

    it('maxBytes + 1 lanca BadRequestError com a mensagem do service', async () => {
      await assert.rejects(
        () => imagesService.uploadImage(atlas.id, fakeFile(MAX_BYTES + 1), owner.id),
        (err) => {
          assert.equal(err.statusCode, 400, 'e um 400, nao um 500');
          assert.equal(err.message, `File too large. Maximum size: ${config.images.maxSizeMb}MB`);
          return true;
        }
      );
    });

    it('EXATAMENTE maxBytes atravessa o guarda de tamanho (a comparacao e `>`, nao `>=`)', async () => {
      // O arquivo em disco e o PNG 1x1; so o campo `size` esta no limite. Se o
      // guarda fosse `>=`, isto lancaria "File too large" e nunca chegaria a
      // gravar. Chegando ao INSERT, o size no banco e o declarado.
      const img = await imagesService.uploadImage(atlas.id, fakeFile(MAX_BYTES), owner.id);
      assert.equal(Number(img.size_bytes), MAX_BYTES, 'passou do guarda e persistiu');

      // Limpeza: este caminho aponta para o fixture compartilhado, entao a linha
      // e removida sem apagar o arquivo (deleteImage tolera unlink falho).
      await db.query('DELETE FROM images WHERE id = $1', [img.id]);
    });

    it('CARACTERIZACAO: `size` NaN atravessa o guarda numerico; quem segura e a coluna', async () => {
      // `NaN > maxBytes` e false — a armadilha que testing.md nomeia: `x ?? 0` e
      // uma comparacao crua nao protegem contra NaN. O guarda de tamanho deixa
      // passar, e a recusa so acontece no INSERT (integer NOT NULL), como
      // SQLSTATE 22P02 -> 400 BAD_REQUEST pelo PG_ERROR_MAP. Nao ha caminho HTTP
      // que produza isso (o `size` vem do multer), por isso e caracterizacao e
      // nao defeito: o que ela prende e o efeito colateral que importa, abaixo.
      const proprio = join(__dirname, '..', 'fixtures', `isb-nan-${randomUUID().slice(0, 8)}.png`);
      writeFileSync(proprio, PNG_1x1);
      tmpFiles.push(proprio);

      await assert.rejects(
        () => imagesService.uploadImage(atlas.id, { ...fakeFile(Number.NaN), path: proprio }, owner.id),
        (err) => {
          assert.equal(err.code, '22P02', 'a recusa vem do tipo da coluna, nao do guarda');
          return true;
        }
      );

      // O contrato que images.service.js:56-68 promete: um INSERT que lanca leva o
      // blob junto, senao sobram bytes em disco sem linha que os aponte.
      assert.equal(existsSync(proprio), false, 'o blob foi removido junto com o INSERT que falhou');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Bulk: mesma borda, outro guarda (`buffer.length > maxBytes`)
  // ─────────────────────────────────────────────────────────────────────────

  describe('bulk (images.service.js:175)', () => {
    const bulk = (item) => supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({ images: [item] });

    it('item cujo buffer decodificado tem EXATAMENTE maxBytes: uploaded', async () => {
      const localId = randomUUID();
      const res = await bulk({
        localId,
        filename: 'bulk-exato.png',
        mimeType: 'image/png',
        data: pngComTamanho(MAX_BYTES).toString('base64'),
      }).expect(201);

      assert.equal(res.body.data.failed.length, 0, `nada pode falhar no limite: ${JSON.stringify(res.body.data.failed)}`);
      assert.equal(res.body.data.uploaded.length, 1);

      const { rows } = await db.query('SELECT size_bytes FROM images WHERE id = $1', [res.body.data.uploaded[0].serverId]);
      assert.equal(Number(rows[0].size_bytes), MAX_BYTES, 'o buffer no limite e gravado inteiro');
    });

    it('maxBytes + 1: failed com /File too large/ e nenhuma linha criada', async () => {
      const localId = randomUUID();
      const linhasAntes = await countRows();

      const res = await bulk({
        localId,
        filename: 'bulk-um-a-mais.png',
        mimeType: 'image/png',
        data: pngComTamanho(MAX_BYTES + 1).toString('base64'),
      }).expect(201);

      assert.equal(res.body.data.uploaded.length, 0, 'nada subiu');
      assert.equal(res.body.data.failed.length, 1);
      assert.equal(res.body.data.failed[0].localId, localId);
      assert.match(res.body.data.failed[0].error, /File too large/);

      assert.equal(await countRows(), linhasAntes, 'o item recusado nao cria linha');
      const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM images WHERE id = $1', [localId]);
      assert.equal(rows[0].n, 0, 'nem sob o localId reservado');
    });
  });
});
