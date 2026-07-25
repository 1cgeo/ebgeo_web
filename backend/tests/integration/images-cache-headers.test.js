// Path: tests/integration/images-cache-headers.test.js
//
// Item 107. A única asserção que existia sobre o cabeçalho de cache do download
// (`images-hardening.test.js:71-104`) é `assert.match(cache-control, /immutable/)`, e
// `immutable` não é o token que carrega a decisão de segurança. A imagem é conteúdo
// controlado por permissão servido com `max-age` de um ano: trocar `private` por
// `public` — ou simplesmente remover a diretiva — autorizaria proxy compartilhado/CDN
// a guardar e reentregar a imagem de um atlas PRIVADO para quem não tem share, e o
// regex antigo continuaria casando palavra por palavra.
//
// A segunda cegueira é o 304. O `setHeader` acontece ANTES do `res.sendFile`
// (images.controller.js:32-44), e a resposta condicional nunca teve seus cabeçalhos
// verificados: mover os headers para dentro do callback do `sendFile` — refatoração
// que parece equivalente — deixaria toda resposta 304 sem Cache-Control e sem
// Content-Disposition, e nada na suíte reagiria. Um cliente que revalida (o caso comum
// depois do primeiro acesso) passaria a receber a diretiva de cache implícita.
//
// Terceiro: o gate de permissão tem de rodar ANTES do cache condicional. Um 304
// respondido a quem não tem share seria bypass por cache (o corpo não vaza, mas a
// EXISTÊNCIA e a versão do recurso vazam, e o cliente tratará o objeto em cache como
// ainda válido).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');

describe('images — download cache headers (107)', () => {
  let app, db, owner, reader, stranger;
  let tokOwner, tokReader, tokStranger;
  let atlas, imageId;

  const sfx = randomUUID().slice(0, 8);

  const get = (tok, path) =>
    supertest(app).get(path).set('Authorization', `Bearer ${tok}`);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    owner = await createUser(db, { username: `imgch_own_${sfx}` });
    reader = await createUser(db, { username: `imgch_rd_${sfx}` });
    stranger = await createUser(db, { username: `imgch_st_${sfx}` });
    tokOwner = await loginUser(app, owner.username, owner.password);
    tokReader = await loginUser(app, reader.username, reader.password);
    tokStranger = await loginUser(app, stranger.username, stranger.password);

    atlas = await createAtlas(db, owner.id, { name: `ImgCH ${sfx}` });
    await createShare(db, atlas.id, reader.id, 'read', owner.id);

    const up = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/images`)
      .set('Authorization', `Bearer ${tokOwner}`)
      .attach('image', PNG, { filename: 'cache.png', contentType: 'image/png' })
      .expect(201);
    imageId = up.body.data.id;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const url = () => `/api/v1/atlas/${atlas.id}/images/${imageId}`;

  it('200 carries private + immutable + max-age=31536000, and never public', async () => {
    const res = await get(tokOwner, url()).expect(200);
    const cc = res.headers['cache-control'];
    assert.ok(cc, 'the download must declare a Cache-Control at all');

    // Directive-level parsing, not a substring search: 'no-cache' contains 'cache'
    // and 'private' is a substring of nothing useful — the point is that each token
    // is present as its own directive.
    const directives = cc.split(',').map((d) => d.trim().toLowerCase());
    assert.ok(directives.includes('private'),
      `Cache-Control must be private (access-controlled content), got: ${cc}`);
    assert.ok(directives.includes('immutable'), `expected immutable, got: ${cc}`);
    assert.ok(directives.includes('max-age=31536000'), `expected max-age=31536000, got: ${cc}`);
    assert.ok(!directives.includes('public'),
      `a shared cache must never be allowed to hold this response: ${cc}`);
  });

  it('200 is served as an attachment, never inline', async () => {
    const res = await get(tokOwner, url()).expect(200);
    const cd = res.headers['content-disposition'];
    assert.match(cd, /^attachment/, `expected an attachment disposition, got: ${cd}`);
    assert.ok(!cd.includes('inline'));
    assert.match(cd, /filename="cache\.png"/);
    assert.match(res.headers['content-type'], /image\/png/);
    assert.ok(res.headers.etag, 'sendFile must emit an ETag, otherwise the 304 cases are vacuous');
  });

  it('a conditional revalidation returns 304 AND still carries private/immutable', async () => {
    const first = await get(tokOwner, url()).expect(200);
    const etag = first.headers.etag;
    assert.ok(etag);

    const res = await get(tokOwner, url()).set('If-None-Match', etag).expect(304);

    const cc = res.headers['cache-control'];
    assert.ok(cc, 'the 304 dropped Cache-Control entirely — the client falls back to heuristics');
    const directives = cc.split(',').map((d) => d.trim().toLowerCase());
    assert.ok(directives.includes('private'), `304 must stay private, got: ${cc}`);
    assert.ok(directives.includes('immutable'), `304 must stay immutable, got: ${cc}`);
    assert.ok(!directives.includes('public'));

    // Same reasoning for the disposition: it is set at the same place and would
    // disappear together with the cache directive.
    assert.match(res.headers['content-disposition'], /^attachment/);
    assert.equal(res.body?.length ?? 0, 0, 'a 304 carries no body');
  });

  it('a read-level share gets the same headers (the cache policy is not owner-only)', async () => {
    const res = await get(tokReader, url()).expect(200);
    const directives = res.headers['cache-control'].split(',').map((d) => d.trim());
    assert.ok(directives.includes('private'));
    assert.ok(!directives.includes('public'));
  });

  it('the permission gate runs BEFORE the conditional cache: a stranger gets 404, never 304', async () => {
    // Se o 304 chegasse aqui, seria bypass por cache: o portador do ETag confirmaria
    // a existência do recurso e revalidaria uma cópia que não tem direito de manter.
    //
    // 404 e não 403 desde 2026-07-25: o estranho não tem relação nenhuma com o atlas, então
    // a resposta é indistinguível de atlas inexistente. O que este caso prende não mudou, e
    // é a ORDEM: o gate roda antes do cache condicional. Repare que aqui isso importa em
    // dobro, porque um 304 seria pior que um 403: além de bypass, confirmaria a existência
    // do recurso justamente pelo canal que a escada existe para fechar.
    const first = await get(tokOwner, url()).expect(200);
    const res = await get(tokStranger, url()).set('If-None-Match', first.headers.etag);

    assert.equal(res.status, 404, `expected 404, got ${res.status}`);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.equal(res.headers['cache-control'], undefined,
      'a refused request must not inherit the immutable cache directive');
  });

  it('anonymous revalidation is 401, not 304', async () => {
    const first = await get(tokOwner, url()).expect(200);
    await supertest(app)
      .get(url())
      .set('If-None-Match', first.headers.etag)
      .expect(401);
  });

  it('control: an If-None-Match that does NOT match still returns 200 with the bytes', async () => {
    // Sem isto, os 304 acima poderiam vir de um servidor que responde 304 sempre.
    const res = await get(tokOwner, url()).set('If-None-Match', '"not-the-etag"').expect(200);
    assert.deepEqual(res.body, PNG);
  });
});
