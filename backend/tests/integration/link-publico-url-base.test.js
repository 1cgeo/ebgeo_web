// Path: tests/integration/link-publico-url-base.test.js
//
// O LINK PÚBLICO JÁ NASCE COM A BASE (dono, 2026-09-20).
//
// A tela de compartilhamento mostrava o TOKEN cru. O servidor passou a devolver, AO LADO dele,
// `publicUrl`: a base de `app.urlBaseLinkPublico` (padrão do env, override do administrador pela
// aba Sistema) mais `?atlasPublico=<token>`.
//
// O QUE ESTE ARQUIVO PRENDE, e o que erra calado:
//   1. as DUAS portas carregam o endereço: a resposta de PUBLICAR (é ela que "já vem com a base
//      ao criar") e a leitura da configuração de compartilhamento;
//   2. `publicLink` CONTINUA sendo o token: `GET /atlas/public/:link` e a trilha leem o token;
//   3. o override do administrador vale na leitura SEGUINTE, sem reiniciar e sem republicar, que
//      é a propriedade que o campo do painel promete (a escrita derruba o memo de `/api/config`);
//   4. atlas não publicado não tem endereço.
//
// A composição em si (barras, caminho, esquemas recusados) é pura e mora em
// `tests/unit/link-publico-url-base.test.js`.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import { clearConfigOverrides } from '../../src/modules/config/config.service.js';
import { invalidateAppConfigCache } from '../../src/modules/config/config.cache.js';

const U = () => `u_${randomUUID().slice(0, 8)}`;
const BASE_PADRAO = 'https://ebgeo.dsg.eb.mil.br';

describe('o endereço do link público', () => {
  let app, db, owner, ownerTok, adminTok;

  const como = (token, metodo, url) => supertest(app)[metodo](url).set('Authorization', `Bearer ${token}`);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: U() });
    ownerTok = await loginUser(app, owner.username, owner.password);
    const admin = await createAdminUser(db, { username: U() });
    adminTok = await loginUser(app, admin.username, admin.password);
  });

  afterEach(async () => {
    await clearConfigOverrides();
    invalidateAppConfigCache();
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('o padrão do checkout é o servidor principal, e ele viaja em /api/config', async () => {
    const cfg = (await supertest(app).get('/api/config').expect(200)).body.data;
    assert.equal(cfg.app.urlBaseLinkPublico, BASE_PADRAO);
  });

  it('PUBLICAR já devolve o endereço com a base, e o token continua no campo dele', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    const { body } = await como(ownerTok, 'post', `/api/v1/atlas/${atlas.id}/sharing/public`).expect(200);
    const { publicLink, publicUrl } = body.data;

    assert.match(publicLink, /^[0-9a-f]{32}$/, 'o token é o de sempre');
    assert.equal(publicUrl, `${BASE_PADRAO}/?atlasPublico=${publicLink}`);
    // O token do endereço ABRE o atlas pela rota pública: o endereço não é enfeite.
    const token = new URL(publicUrl).searchParams.get('atlasPublico');
    await supertest(app).get(`/api/v1/atlas/public/${token}`).expect(200);
  });

  it('a leitura da configuração de compartilhamento carrega o MESMO endereço', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    const publicado = (await como(ownerTok, 'post', `/api/v1/atlas/${atlas.id}/sharing/public`).expect(200)).body.data;
    const lido = (await como(ownerTok, 'get', `/api/v1/atlas/${atlas.id}/sharing`).expect(200)).body.data;

    assert.equal(lido.publicLink, publicado.publicLink);
    assert.equal(lido.publicUrl, publicado.publicUrl);
  });

  it('atlas NÃO publicado não tem endereço', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    const lido = (await como(ownerTok, 'get', `/api/v1/atlas/${atlas.id}/sharing`).expect(200)).body.data;
    assert.equal(lido.isPublic, false);
    assert.equal(lido.publicUrl, null);
  });

  it('o administrador troca a base pelo painel, e o atlas JÁ publicado passa a sair com ela', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    const { publicLink } = (await como(ownerTok, 'post', `/api/v1/atlas/${atlas.id}/sharing/public`).expect(200)).body.data;

    await como(adminTok, 'put', '/api/v1/config/admin')
      .send({ app: { urlBaseLinkPublico: 'https://ebgeo.1cgeo.exemplo/mapa/' } })
      .expect(200);

    const lido = (await como(ownerTok, 'get', `/api/v1/atlas/${atlas.id}/sharing`).expect(200)).body.data;
    assert.equal(lido.publicLink, publicLink, 'o token não muda: só o endereço mostrado');
    assert.equal(lido.publicUrl, `https://ebgeo.1cgeo.exemplo/mapa/?atlasPublico=${publicLink}`);

    // E o que NASCE depois da troca também sai com a base nova.
    const outro = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    const novo = (await como(ownerTok, 'post', `/api/v1/atlas/${outro.id}/sharing/public`).expect(200)).body.data;
    assert.ok(novo.publicUrl.startsWith('https://ebgeo.1cgeo.exemplo/mapa/?atlasPublico='));
  });

  for (const ruim of ['ftp://host.exemplo', 'ebgeo.dsg.eb.mil.br', '', 42]) {
    it(`a borda recusa a base ${JSON.stringify(ruim)} com 422, e nada é gravado`, async () => {
      await como(adminTok, 'put', '/api/v1/config/admin')
        .send({ app: { urlBaseLinkPublico: ruim } })
        .expect(422);
      const cfg = (await supertest(app).get('/api/config').expect(200)).body.data;
      assert.equal(cfg.app.urlBaseLinkPublico, BASE_PADRAO);
    });
  }

  it('quem NÃO administra não troca a base', async () => {
    await como(ownerTok, 'put', '/api/v1/config/admin')
      .send({ app: { urlBaseLinkPublico: 'https://atacante.exemplo' } })
      .expect(403);
    const cfg = (await supertest(app).get('/api/config').expect(200)).body.data;
    assert.equal(cfg.app.urlBaseLinkPublico, BASE_PADRAO);
  });
});
