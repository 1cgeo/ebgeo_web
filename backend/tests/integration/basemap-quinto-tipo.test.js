// Path: tests/integration/basemap-quinto-tipo.test.js
//
// `basemap` COMO QUINTO TIPO DE RECURSO (migração 021).
//
// O QUE FALTAVA NÃO ERA O FILTRO. `basemaps.access_level` existe desde a 017 e
// `listCatalog('basemaps')` sem principal já aplicava `access_level = 'public'`,
// que é por onde `/api/config` se monta; a rota crua já aplicava também o ramo de
// produção. Duas prosas do repositório afirmavam que aquela coluna "nunca é
// consultada", e estavam erradas.
//
// O que faltava era o OUTRO SENTIDO: sem `basemap` no CHECK de
// `resource_grants.resource_type` e no de `atlas_resources.resource_type`, nem a
// concessão pessoal nem o empréstimo por atlas conseguiam DEVOLVER um basemap
// privado a quem tem direito. Era meia regra — fechava e não abria — e o efeito
// prático é que marcar um basemap como privado o apagava para todo mundo, sem
// recurso.
//
// Este arquivo mede os DOIS braços da resolução (concessão direta e empréstimo do
// atlas em foco) com o par negativo de cada um no mesmo corpo, e afirma sobre o
// SCHEMA que os dois CHECKs aceitam `basemap` e recusam o tipo que morreu junto.
//
// A superfície do basemap é o SELETOR DE CAMADA BASE, e ela vive no cliente
// (`config.basemaps`, somado por `mergeGrantedIntoBaseline`). O que este arquivo
// cobre é o servidor: que o item chega ao payload aditivo, e só a quem deve.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';

describe('021 — basemap é o quinto tipo de recurso concedível', () => {
  let app, db, admin, dono, membro, forasteiro, atlas, outroAtlas;
  let tokenAdmin, tokenDono, tokenMembro, tokenForasteiro;
  const sufixo = randomUUID().slice(0, 8);
  const BASEMAP = `bm5-${sufixo}`;

  const visiveis = async (token, atlasId) => {
    const qs = atlasId ? `?atlasId=${atlasId}` : '';
    return (await supertest(app)
      .get(`/api/v1/resource-access/visible${qs}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)).body.data;
  };

  const veBasemap = async (token, atlasId = null) =>
    (await visiveis(token, atlasId)).basemaps.map((b) => b.id).includes(BASEMAP);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `bm5_admin_${sufixo}` });
    dono = await createUser(db, { username: `bm5_dono_${sufixo}` });
    membro = await createUser(db, { username: `bm5_membro_${sufixo}` });
    forasteiro = await createUser(db, { username: `bm5_fora_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenDono = await loginUser(app, dono.username, dono.password);
    tokenMembro = await loginUser(app, membro.username, membro.password);
    tokenForasteiro = await loginUser(app, forasteiro.username, forasteiro.password);

    atlas = await createAtlas(db, dono.id, { name: `Atlas bm5 ${sufixo}` });
    outroAtlas = await createAtlas(db, dono.id, { name: `Outro bm5 ${sufixo}` });
    await createShare(db, atlas.id, membro.id, 'read', dono.id);
    await createShare(db, outroAtlas.id, membro.id, 'read', dono.id);

    await db.query(
      `INSERT INTO basemaps (id, name, config, sort_order)
       VALUES ($1, $2, '{"enabled":true,"priority":9}'::jsonb, 0)`,
      [BASEMAP, `Camada base ${sufixo}`]
    );
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE resource_id = $1', [BASEMAP]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [BASEMAP]);
    await db.query('DELETE FROM basemaps WHERE id = $1', [BASEMAP]);
    await db.query('DELETE FROM atlas WHERE id = ANY($1::uuid[])', [[atlas.id, outroAtlas.id]]);
    await teardownTestEnv(db);
  });

  // ---------------------------------------------------------------------------
  // O SCHEMA
  // ---------------------------------------------------------------------------

  it('os dois CHECKs de resource_type aceitam `basemap` e recusam `streetview_marker`', async () => {
    // Afirmar sobre o TEXTO do constraint (e não só tentar um INSERT) é o que pega
    // a metade esquecida: alargar `resource_grants` e não `atlas_resources` deixaria
    // o tipo concedível e não emprestável, e só o segundo braço da resolução
    // quebraria — num caminho que exige um atlas em foco para ser exercitado.
    const { rows } = await db.query(
      `SELECT conrelid::regclass::text AS tabela, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conname IN ('resource_grants_resource_type_check', 'atlas_resources_resource_type_check')
        ORDER BY tabela`
    );
    assert.equal(rows.length, 2, `esperava os dois CHECKs, achei ${rows.length}`);
    for (const { tabela, def } of rows) {
      assert.match(def, /'basemap'/, `${tabela}: o CHECK precisa aceitar basemap`);
      assert.ok(!/streetview_marker/.test(def), `${tabela}: streetview_marker morreu com a tabela`);
      // Discriminação: os outros quatro continuam lá, senão "aceita basemap" poderia
      // ser um CHECK reescrito por cima dos demais.
      for (const t of ['tileset', 'data_layer', 'analysis_layer', 'sv360_project']) {
        assert.match(def, new RegExp(`'${t}'`), `${tabela}: ${t} não pode ter sumido`);
      }
    }
  });

  it('a tabela streetview_markers não existe mais, e as outras quatro existem', async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])`,
      [['basemaps', 'data_layers', 'analysis_layers', 'tilesets', 'streetview_markers']]
    );
    assert.deepEqual(
      rows.map((r) => r.table_name).sort(),
      ['analysis_layers', 'basemaps', 'data_layers', 'tilesets'],
      'a 021 apaga streetview_markers e não encosta nas outras quatro'
    );
  });

  // ---------------------------------------------------------------------------
  // O PAR: público aparece, privado some
  // ---------------------------------------------------------------------------

  it('piso: público, o basemap está no /api/config e FORA do payload aditivo', async () => {
    const c = (await supertest(app).get('/api/config').expect(200)).body.data;
    assert.ok(c.basemaps[BASEMAP], 'guarda: público, o basemap está no documento público');
    // O payload aditivo é o DELTA sobre o público: trazer o público ali faria o
    // cliente somá-lo duas vezes.
    assert.equal(await veBasemap(tokenAdmin), false, 'público não entra no payload aditivo');
  });

  it('privado, some do /api/config para todos e volta ao ser remarcado público', async () => {
    await marcar('private');
    try {
      for (const [quem, token] of [['anônimo', null], ['usuário', tokenMembro], ['admin', tokenAdmin]]) {
        const req = supertest(app).get('/api/config');
        if (token) req.set('Authorization', `Bearer ${token}`);
        const c = (await req.expect(200)).body.data;
        assert.equal(c.basemaps[BASEMAP], undefined, `privado não sai no /api/config para ${quem}`);
      }
      // O CONTROLE da reversão: remarcado público, volta no pedido seguinte.
      await marcar('public');
      const volta = (await supertest(app).get('/api/config').expect(200)).body.data;
      assert.ok(volta.basemaps[BASEMAP], 'remarcado público, volta');
    } finally {
      await marcar('private');
    }
  });

  // ---------------------------------------------------------------------------
  // BRAÇO 1 — concessão pessoal
  // ---------------------------------------------------------------------------

  it('concedido, o beneficiário vê no payload aditivo; o forasteiro continua sem ver', async () => {
    assert.equal(await veBasemap(tokenDono), false, 'piso: antes da concessão, o dono não vê');

    await supertest(app)
      .post(`/api/v1/resource-access/basemap/${BASEMAP}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: dono.id, grantLevel: 'view_share' })
      .expect(201);

    assert.equal(await veBasemap(tokenDono), true, 'concedido, aparece');
    assert.equal(await veBasemap(tokenForasteiro), false, 'a concessão é PESSOAL');
  });

  it('o item vem no shape do /api/config (`{id, name, ...config}`)', async () => {
    const item = (await visiveis(tokenDono, null)).basemaps.find((b) => b.id === BASEMAP);
    assert.ok(item, 'guarda: o item precisa estar no payload');
    assert.equal(item.name, `Camada base ${sufixo}`);
    // As chaves de `config` sobem para a raiz, como no documento público — é o que
    // permite ao cliente pôr o item em `config.basemaps` sem reprojetar de novo.
    assert.equal(item.enabled, true);
    assert.equal(item.priority, 9);
    assert.equal(item.config, undefined, '`config` não viaja aninhado');
  });

  // ---------------------------------------------------------------------------
  // BRAÇO 2 — empréstimo por atlas
  // ---------------------------------------------------------------------------

  it('anexado ao atlas, o membro vê COM `?atlasId=` e NÃO vê sem ele nem com outro atlas', async () => {
    assert.equal(await veBasemap(tokenMembro, atlas.id), false, 'piso: antes de anexar, não vê');

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/resources`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({ resourceType: 'basemap', resourceId: BASEMAP })
      .expect(201);
    assert.equal(res.body.data.resource_type, 'basemap');

    assert.equal(await veBasemap(tokenMembro, atlas.id), true, 'com o atlas em foco, vê');
    assert.equal(await veBasemap(tokenMembro, null), false, 'sem atlas em foco, NÃO vê');
    assert.equal(
      await veBasemap(tokenMembro, outroAtlas.id), false,
      'com o id de outro atlas que ele também alcança, NÃO vê'
    );
  });

  it('removido o empréstimo, o membro deixa de ver mesmo com o atlas em foco', async () => {
    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}/resources/basemap/${BASEMAP}`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .expect(200);
    assert.equal(await veBasemap(tokenMembro, atlas.id), false, 'removido, não vê mais');
    // Discriminação: quem tem concessão PESSOAL não perdeu nada com a remoção.
    assert.equal(await veBasemap(tokenDono, atlas.id), true, 'a concessão pessoal do dono sobrevive');
  });

  /** Marca o basemap da fixture, pela rota (que invalida o memo do /api/config). */
  async function marcar(accessLevel) {
    await supertest(app)
      .patch(`/api/v1/resource-access/basemap/${BASEMAP}/visibility`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ accessLevel })
      .expect(200);
  }
});
