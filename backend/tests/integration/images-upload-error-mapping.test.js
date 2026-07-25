// Path: tests/integration/images-upload-error-mapping.test.js
// Item 165 (testes-backend.md, fatia be-images): o wrapper `uploadSingleImage`
// (images.routes.js:73-84) tem tres saidas e so uma estava coberta.
//
//   1. MulterError com code LIMIT_FILE_SIZE  -> "Image too large (max NMB)"  [coberto: images-hardening.test.js:59-69]
//   2. QUALQUER outro MulterError            -> "Upload error: <msg>"        [NAO coberto]
//   3. `if (err) return next(err)`           -> erro repassado INTACTO       [NAO pinado]
//
// O que o verde de hoje provaria: nada sobre 2 e 3. Apagar o ramo generico faz
// todo erro de multipart que nao seja de tamanho (campo errado, arquivo a mais)
// virar 500 INTERNAL_ERROR, e nenhum teste da fatia percebe — MulterError nao tem
// `statusCode`, entao cai no ramo "erro desconhecido" do error-handler. Apagar o
// repasse (3) transforma o 422 do Joi e o 400 do fileFilter em `next()` sem erro,
// isto e, a requisicao segue para o controller com `req.file` indefinido.
//
// REFUTACOES do relatorio (codigo lido em 2026-07-25, o relatorio e de 2026-07-19
// sobre e1bb74e):
//   - o relatorio ESPERA que 'foto.pn/g' produza um 500 por ENOENT no path.join.
//     Refutado DUAS vezes, e a ordem importa: (i) o busboy aplica `basename()`
//     ao filename do Content-Disposition antes de multer, entao
//     `file.originalname` ja chega 'g', sem separador; (ii) mesmo que chegasse,
//     `safeExtension()` (images.routes.js:29-32) usa path.extname + allowlist
//     [a-z0-9] + teto de 8 chars. O upload e um 201 legitimo.
//     Nota de metodo: `.attach()` do supertest NAO consegue exercitar este caso —
//     `form-data` aplica `path.basename()` ao montar o cabecalho, de modo que um
//     teste escrito com `.attach()` mediria o cliente. Daqui em diante o
//     multipart e montado a mao (`postRaw`).
//   - o relatorio ESPERA 4xx para uma extensao de ~300 chars por ENAMETOOLONG.
//     Refutado pelo mesmo mecanismo: a extensao e truncada para 'bin'. O 4xx que
//     de fato existe vem do Joi por NOME > 255 chars, que e outro guarda
//     (uploadFileSchema, images.schemas.js:16-18) e outro codigo (422, nao 400).
// Os dois casos viraram teste mesmo assim: defeito corrigido sem cobertura ainda
// e defeito destravado.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { join, resolve } from 'path';
import { existsSync, readdirSync } from 'fs';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';

const uname = (p) => `iuem_${p}_${randomUUID().slice(0, 8)}`;

// PNG 1x1 real (os magic bytes importam: o service confere o conteudo).
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
);

describe('Images — mapeamento de erro do upload single (item 165)', () => {
  let app, db, owner, token, atlas, atlasDir;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: uname('owner') });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: `Upload Error Map ${randomUUID().slice(0, 6)}` });
    atlasDir = resolve(join(config.images.dir, atlas.id));
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Arquivos no diretorio do atlas (0 se ele ainda nao existe). */
  function countFiles() {
    return existsSync(atlasDir) ? readdirSync(atlasDir).length : 0;
  }

  /** Linhas de imagem do atlas. */
  async function countRows() {
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM images WHERE atlas_id = $1', [atlas.id]);
    return rows[0].n;
  }

  const post = () => supertest(app)
    .post(`/api/v1/atlas/${atlas.id}/images`)
    .set('Authorization', `Bearer ${token}`);

  /**
   * POST multipart montado a MAO.
   *
   * `.attach()` do supertest nao serve para os casos de nome hostil: o modulo
   * `form-data` passa o filename por `path.basename()` antes de escrever o
   * cabecalho, entao 'foto.pn/g' chega ao servidor ja reduzido a 'g' e o teste
   * estaria medindo o cliente, nao o servidor. Um navegador nao faz essa
   * normalizacao. Aqui os bytes do multipart sao escritos literalmente.
   *
   * @param {string} filename - valor cru do parametro filename do Content-Disposition
   * @param {Buffer} conteudo
   */
  function postRaw(filename, conteudo) {
    const boundary = `----ebgeo${randomUUID().replace(/-/g, '')}`;
    const corpo = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="image"; filename="${filename}"\r\n` +
        'Content-Type: image/png\r\n\r\n'
      ),
      conteudo,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return post()
      .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
      .send(corpo);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ramo 2: MulterError que NAO e LIMIT_FILE_SIZE
  // ─────────────────────────────────────────────────────────────────────────

  it('campo de arquivo errado ("file" em vez de "image"): 400 BAD_REQUEST, nunca 500', async () => {
    const arquivosAntes = countFiles();
    const linhasAntes = await countRows();

    const res = await post()
      .attach('file', PNG_1x1, { filename: 'campo-errado.png', contentType: 'image/png' })
      .expect(400);

    // O ramo generico e o unico que produz esta mensagem. Sem ele, o MulterError
    // (que nao carrega statusCode) sai como 500 INTERNAL_ERROR.
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.match(res.body.error.message, /^Upload error: /, `mensagem do ramo generico, recebido: ${res.body.error.message}`);
    assert.match(res.body.error.message, /Unexpected field/i, 'o code do multer sobrevive na mensagem');

    assert.equal(countFiles(), arquivosAntes, 'multer rejeita o campo ANTES de escrever bytes');
    assert.equal(await countRows(), linhasAntes, 'nenhuma linha criada');
  });

  it('dois arquivos no campo "image" (limits.files=1 do single): 400 BAD_REQUEST pelo mesmo ramo', async () => {
    const arquivosAntes = countFiles();

    const res = await post()
      .attach('image', PNG_1x1, { filename: 'a.png', contentType: 'image/png' })
      .attach('image', PNG_1x1, { filename: 'b.png', contentType: 'image/png' })
      .expect(400);

    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.match(res.body.error.message, /^Upload error: /);

    // O primeiro arquivo pode ter sido escrito antes do segundo ser recusado;
    // o que NAO pode e sobrar mais de um blob por uma requisicao rejeitada.
    assert.ok(
      countFiles() - arquivosAntes <= 1,
      `no maximo um blob orfao por requisicao abortada, ganhou ${countFiles() - arquivosAntes}`
    );
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM images WHERE atlas_id = $1', [atlas.id]);
    assert.ok(rows[0].n >= 0, 'consulta valida');
  });

  it('a mensagem do ramo de TAMANHO e distinta da do ramo generico (o ternario e observavel)', async () => {
    const grande = Buffer.alloc((config.images.maxSizeMb + 1) * 1024 * 1024, 0x00);
    const res = await post()
      .attach('image', grande, { filename: 'huge.png', contentType: 'image/png' })
      .expect(400);

    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.equal(res.body.error.message, `Image too large (max ${config.images.maxSizeMb}MB)`);
    assert.doesNotMatch(res.body.error.message, /^Upload error: /, 'nao pode cair no ramo generico');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Ramo 3: `if (err) return next(err)` — o erro atravessa INTACTO
  // ─────────────────────────────────────────────────────────────────────────

  it('erro do Joi vindo do fileFilter atravessa como 422 VALIDATION_ERROR (nao vira 400 do wrapper)', async () => {
    const arquivosAntes = countFiles();
    const linhasAntes = await countRows();

    const res = await post()
      .attach('image', PNG_1x1, { filename: `${'a'.repeat(252)}.png`, contentType: 'image/png' })
      .expect(422);

    // 422, e nao 400: prova que o wrapper REPASSOU o erro em vez de reembrulhar.
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(res.body.error.details[0].field, 'originalname');

    assert.equal(countFiles(), arquivosAntes, 'fileFilter roda antes do primeiro byte');
    assert.equal(await countRows(), linhasAntes);
  });

  it('BadRequestError do fileFilter (mime nao permitido) atravessa com a mensagem original', async () => {
    const res = await post()
      .attach('image', Buffer.from('GIF89a'), { filename: 'anim.gif', contentType: 'image/gif' })
      .expect(400);

    // 'Invalid file type' e a mensagem do fileFilter; se o wrapper a
    // reembrulhasse, viria 'Upload error: ...'.
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.equal(res.body.error.message, 'Invalid file type');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Refutacoes: os dois gatilhos que o relatorio esperava ver falhar
  // ─────────────────────────────────────────────────────────────────────────

  it('REFUTADO: separador no segmento de extensao ("foto.pn/g") nao vira 500 — safeExtension o neutraliza', async () => {
    const res = await postRaw('foto.pn/g', PNG_1x1).expect(201);

    const { rows } = await db.query('SELECT storage_path, filename FROM images WHERE id = $1', [res.body.data.id]);
    const stored = rows[0].storage_path.split(/[\\/]/).pop();

    assert.match(stored, /^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/, `nome em disco derivado e limitado, recebido: ${stored}`);
    assert.ok(existsSync(resolve(rows[0].storage_path)), 'o blob foi escrito de fato');
    // O caminho gravado fica DENTRO do diretorio do atlas: nenhum segmento escapou.
    assert.equal(resolve(rows[0].storage_path, '..'), atlasDir, 'o blob nao saiu do diretorio do atlas');
    // ONDE o separador morre, medido em vez de suposto: o proprio busboy aplica
    // um `basename()` (que trata '/' E '\') ao filename do Content-Disposition
    // antes de qualquer codigo deste repositorio ver a string. Entao
    // `file.originalname` ja chega sem separador, e `safeExtension` e a SEGUNDA
    // barreira, nao a primeira. Se um dia alguem ligar `preservePath` no multer,
    // esta assercao cai e aponta exatamente para a regressao.
    assert.equal(rows[0].filename, 'g', 'busboy ja entrega o originalname sem componente de caminho');
  });

  it('REFUTADO: barra invertida no nome tambem nao alcanca o filesystem', async () => {
    const res = await postRaw('foto.pn\\\\g', PNG_1x1).expect(201);

    const { rows } = await db.query('SELECT storage_path FROM images WHERE id = $1', [res.body.data.id]);
    const stored = rows[0].storage_path.split(/[\\/]/).pop();
    assert.match(stored, /^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/, `nome em disco derivado, recebido: ${stored}`);
    assert.equal(resolve(rows[0].storage_path, '..'), atlasDir, 'o blob nao saiu do diretorio do atlas');
  });

  it('REFUTADO: nome sem ponto nenhum nao produz componente de caminho gigante', async () => {
    // Este era o gatilho literal do ENAMETOOLONG do relatorio: sem ponto,
    // `originalname.split('.').pop()` devolvia a string INTEIRA como extensao.
    const res = await postRaw('a'.repeat(250), PNG_1x1).expect(201);

    const { rows } = await db.query('SELECT storage_path FROM images WHERE id = $1', [res.body.data.id]);
    const stored = rows[0].storage_path.split(/[\\/]/).pop();
    assert.equal(stored.split('.').pop(), 'bin', `sem extensao reconhecivel o token e 'bin', recebido: ${stored}`);
  });

  it('REFUTADO: extensao de ~240 chars nao vira ENAMETOOLONG — e truncada para um token curto', async () => {
    const res = await post()
      .attach('image', PNG_1x1, { filename: `a.${'b'.repeat(240)}`, contentType: 'image/png' })
      .expect(201);

    const { rows } = await db.query('SELECT storage_path FROM images WHERE id = $1', [res.body.data.id]);
    const stored = rows[0].storage_path.split(/[\\/]/).pop();
    assert.match(stored, /^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/, `extensao limitada, recebido: ${stored}`);
    assert.ok(stored.length <= 45, `nome em disco curto (uuid + ponto + <=8), recebido ${stored.length} chars`);
  });

  it('caminho feliz continua 201 (as guardas nao sao amplas demais)', async () => {
    const res = await post()
      .attach('image', PNG_1x1, { filename: 'normal.png', contentType: 'image/png' })
      .expect(201);
    assert.equal(res.body.data.filename, 'normal.png');
  });
});
