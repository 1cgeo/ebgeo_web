// Path: tests/integration/config-mapa-base-inicial.test.js
//
// A BASE PADRAO (`map2d.defaultBasemap`) PELA ROTA, de ponta a ponta: servida por GET /api/config,
// escolhida por PUT /config/admin, recusada quando o id nao e mapa base publico do catalogo, e
// usada no primeiro mapa de um atlas criado no servidor.
//
// POR QUE O ULTIMO CASO MORA AQUI. O mapa abre na base que o documento dele carrega, e o primeiro
// mapa de um atlas novo e o unico documento de mapa que o SERVIDOR fabrica do nada
// (`createAtlas`). Com a coluna `maps.base_layer` no padrao dela, um atlas criado depois da escolha
// abria na carta topografica e a escolha do administrador nao valia para ele.
//
// A borda de TIPO e `tests/unit/config-mapa-base-inicial.test.js`; o cliente (nascimento do mapa,
// documento novo, aba do painel) e de `frontend/tests/unit/basemap-padrao-*.test.js` e
// `admin-mapa-base-inicial.test.js`.
//
// O ARQUIVO DEVOLVE O DOCUMENTO DE OVERRIDE COMO O ACHOU: a suite roda os arquivos em sequencia
// sobre o mesmo banco, e uma base padrao deixada aqui mudaria o primeiro mapa de todo atlas criado
// pelos arquivos seguintes.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, createUser, loginUser } from '../helpers/fixtures.js';
import { invalidateAppConfigCache } from '../../src/modules/config/config.cache.js';

const PRIVADO = 'mapa-base-privado-do-teste-da-base-padrao';

describe('Config: a base padrao do mapa (map2d.defaultBasemap)', () => {
  let app, db, adminTok, userTok, documentoAntes;

  const put = (body) => supertest(app)
    .put('/api/v1/config/admin')
    .set('Authorization', `Bearer ${adminTok}`)
    .send(body);
  const servida = async () => (await supertest(app).get('/api/v1/config').expect(200)).body.data.map2d.defaultBasemap;
  const baseDoPrimeiroMapa = async () => {
    const criado = await supertest(app)
      .post('/api/v1/atlas')
      .set('Authorization', `Bearer ${userTok}`)
      .send({ name: 'Atlas da base padrao' })
      .expect(201);
    const { rows } = await db.query('SELECT base_layer FROM maps WHERE atlas_id = $1', [criado.body.data.id]);
    assert.equal(rows.length, 1, 'o atlas novo nasce com um mapa so');
    return rows[0].base_layer;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db);
    const user = await createUser(db);
    adminTok = await loginUser(app, admin.username, admin.password);
    userTok = await loginUser(app, user.username, user.password);
    documentoAntes = (await db.query("SELECT value FROM config_settings WHERE key = 'app_config'")).rows[0]?.value ?? null;
    await db.query(
      `INSERT INTO basemaps (id, name, config, access_level)
       VALUES ($1, 'Privado do teste', '{"enabled": true, "priority": 99}'::jsonb, 'private')
       ON CONFLICT (id) DO NOTHING`,
      [PRIVADO],
    );
    invalidateAppConfigCache();
  });

  after(async () => {
    if (documentoAntes === null) {
      await db.query("DELETE FROM config_settings WHERE key = 'app_config'");
    } else {
      await db.query("UPDATE config_settings SET value = $1::jsonb WHERE key = 'app_config'", [JSON.stringify(documentoAntes)]);
    }
    await db.query('DELETE FROM basemaps WHERE id = $1', [PRIVADO]);
    invalidateAppConfigCache();
    await teardownTestEnv(db);
  });

  it('sem override, serve a carta topografica, e o primeiro mapa de um atlas novo nasce nela', async () => {
    // O documento pode trazer override de arquivos anteriores; so a chave deste importa.
    const doc = (await db.query("SELECT value FROM config_settings WHERE key = 'app_config'")).rows[0]?.value;
    assert.equal(doc?.map2d?.defaultBasemap, undefined, 'pre-condicao: ninguem escolheu ainda');

    assert.equal(await servida(), 'carta-topografica');
    assert.equal(await baseDoPrimeiroMapa(), 'carta-topografica');
  });

  it('a escolha do administrador e servida, e o proximo atlas criado nasce nela', async () => {
    await put({ map2d: { defaultBasemap: 'osm' } }).expect(200);

    assert.equal(await servida(), 'osm');
    const painel = await supertest(app)
      .get('/api/v1/config/admin')
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    assert.equal(painel.body.data.effective.map2d.defaultBasemap, 'osm');
    assert.equal(painel.body.data.overrides.map2d.defaultBasemap, 'osm');

    assert.equal(await baseDoPrimeiroMapa(), 'osm');
  });

  it('RECUSA com 422 o id que nao existe, dizendo em portugues o que fazer, e nao grava nada', async () => {
    const r = await put({ map2d: { defaultBasemap: 'carta-que-nao-existe' } });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'VALIDATION_ERROR');
    assert.equal(r.body.error.details[0].field, 'map2d.defaultBasemap');
    assert.equal(
      r.body.error.details[0].message,
      'O mapa base inicial "carta-que-nao-existe" não está no catálogo público. Escolha um da lista.',
    );
    assert.equal(await servida(), 'osm', 'a recusa nao gravou nada');
  });

  it('RECUSA o mapa base PRIVADO: a base padrao e de todo visitante, o anonimo inclusive', async () => {
    // Controle do insumo: a linha existe e esta ativa, entao a recusa e pela visibilidade.
    const { rows } = await db.query('SELECT access_level, active FROM basemaps WHERE id = $1', [PRIVADO]);
    assert.deepEqual(rows[0], { access_level: 'private', active: true });

    const r = await put({ map2d: { defaultBasemap: PRIVADO } });
    assert.equal(r.status, 422);
    assert.match(r.body.error.details[0].message, /não está no catálogo público/);
  });

  it('a recusa derruba o salvamento INTEIRO da aba, e nao so o campo', async () => {
    // A aba manda todas as secoes alteradas num PUT so. Gravar a metade boa e recusar a outra
    // deixaria o painel mostrando um estado que ninguem salvou por inteiro.
    const antes = (await supertest(app).get('/api/v1/config').expect(200)).body.data.features.grid;
    const r = await put({ features: { grid: !antes }, map2d: { defaultBasemap: 'carta-que-nao-existe' } });
    assert.equal(r.status, 422);
    const depois = (await supertest(app).get('/api/v1/config').expect(200)).body.data.features.grid;
    assert.equal(depois, antes);
  });

  it('a borda de tipo chega a rota: vazio morre em 422 nomeando o campo', async () => {
    const r = await put({ map2d: { defaultBasemap: '' } });
    assert.equal(r.status, 422);
    assert.match(JSON.stringify(r.body), /defaultBasemap/);
  });

  it('um salvamento que nao traz a chave nao consulta nem recusa nada por causa dela', async () => {
    await put({ map2d: { maxPitch: 60 } }).expect(200);
    assert.equal(await servida(), 'osm');
  });

  it('voltar ao padrao e escolher a carta topografica, e o atlas seguinte nasce nela de novo', async () => {
    await put({ map2d: { defaultBasemap: 'carta-topografica' } }).expect(200);
    assert.equal(await servida(), 'carta-topografica');
    assert.equal(await baseDoPrimeiroMapa(), 'carta-topografica');
  });
});
