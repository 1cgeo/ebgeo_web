// Path: tests/integration/sync-referencia-privada.test.js
//
// O BURACO DE REFERÊNCIA PRIVADA NO CAMINHO DE SYNC, e as quatro superfícies que ele tinha.
//
// A poda de referência privada cobria os quatro caminhos em que o dado SAI do atlas (`.ebgeo`,
// "salvar como local", clone e import). O caminho por onde ele ENTRA — a operação de sync — tinha
// gate para UMA superfície só: `catalog_layer`. A primeira linha de
// `unseenResourceDenialReason` era literalmente `if (op.target !== 'catalog_layer') return null;`,
// e as outras quatro superfícies do registro de referências que viajam em op passavam inteiras:
//
//   - `cesium3d_data.tileset_id`  (marcador, medição, viewshed, posição de câmera 3D)
//   - `streetview360_data.photo_name` (orientação e marcador 360)
//   - `slides.model_id` / `slides.photo_id` (o slide de briefing)
//   - `maps.base_layer` (a camada de base do mapa)
//
// Qualquer membro com `write` escrevia no atlas uma referência a um recurso PRIVADO que ele
// próprio não pode abrir, por adivinhação de id, e ela persistia. É a lição de "um recurso sai
// por muitas portas" (`tests/unit/superficies-de-recurso-censo.test.js`) na forma de ESCRITA: o
// predicado numa porta não protege as outras.
//
// A ESTRUTURA DE CADA SUPERFÍCIE É SEMPRE A MESMA, e as três discriminações não são simetria
// estética — cada uma exclui uma forma diferente de o PISO passar verde sem gate nenhum:
//
//   PISO            — o autor que NÃO enxerga o recurso privado tem a op RECUSADA e nada é
//                     escrito. Sozinho, ele passaria idêntico se o gate NEGASSE TUDO.
//   DISCRIMINAÇÃO 1 — o MESMO autor, com o MESMO payload, passa quando o recurso é PÚBLICO.
//                     É o par que separa "há um gate" de "a escrita está quebrada".
//   DISCRIMINAÇÃO 2 — o `delete` da MESMA referência CONTINUA passando. Quem perdeu acesso
//                     precisa poder remover a referência morta, e essa é a exclusão que se
//                     quebra sem perceber (o beco sem saída que este arquivo de serviço já
//                     consertou três vezes).
//   DISCRIMINAÇÃO 3 — o recurso privado EMPRESTADO PELO ATLAS passa. É ela que distingue o
//                     parâmetro certo do errado: `CLASSIFY_RESOURCE_REFS` (a classificação do
//                     clone) passa `NULL::uuid` como atlas em foco DE PROPÓSITO, porque na cópia
//                     o recurso SAI do atlas; aqui o dado FICA, então o empréstimo conta e o
//                     parâmetro é o `atlasId` da rota. Sem este caso, reusar a consulta do clone
//                     passaria verde nos três anteriores e recusaria escrita legítima em produção.
//
// RECUSA POR OPERAÇÃO, NUNCA 4xx DE LOTE: o cliente não faz dequeue de resposta não-2xx, então um
// lote recusado volta a cada 1,5 s para sempre. Cada PISO empurra a op ofensora ao lado de uma
// IRMÃ legítima e exige que a irmã tenha passado — é o que prova que a recusa é per-op.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createAtlas, createMap, createShare, loginUser, createBriefing,
} from '../helpers/fixtures.js';

const SFX = randomUUID().slice(0, 8);

// Os três estados de acesso, repetidos em cada tipo de recurso. O PÚBLICO existe para a
// discriminação 1, o EMPRESTADO para a 3; o PRIVADO é o piso.
const TS_PRIVADO = `srp-ts-priv-${SFX}`;
const TS_PUBLICO = `srp-ts-pub-${SFX}`;
const TS_EMPRESTADO = `srp-ts-empr-${SFX}`;
const BM_PRIVADO = `srp-bm-priv-${SFX}`;
const BM_EMPRESTADO = `srp-bm-empr-${SFX}`;
// `osm` é semeado PÚBLICO por `005_catalogo.sql`: usar um id semeado em vez de criar mais um
// basemap mantém o caso positivo ancorado no dado real do deploy.
const BM_PUBLICO = 'osm';

const IDS_TILESET = [TS_PRIVADO, TS_PUBLICO, TS_EMPRESTADO];
const IDS_BASEMAP = [BM_PRIVADO, BM_EMPRESTADO];

// As linhas que JÁ apontam para o privado, escritas direto no banco: o mundo depois de uma
// REVOGAÇÃO, onde a referência ficou e o acesso não. São elas que a discriminação 2 (o delete)
// e o piso de UPDATE exercitam. Os ids são UUID porque as três colunas de id são UUID.
const MORTO = { tresD: randomUUID(), tresSessenta: randomUUID(), slide: randomUUID() };

describe('sync — referência a recurso privado: o gate de escrita nas quatro superfícies', () => {
  let app, db;
  let admin, dono, membro;
  let tokenDono, tokenMembro;
  let atlas, mapa, briefing, orgId;
  // As referências 360 são NOMES DE FOTO, não ids de projeto: é o que `streetview360_data`
  // guarda e o que `RESOLVE_SV360_REFS` traduz. Um id de projeto aqui mediria outra coisa.
  const foto = { privada: `srp-priv-${SFX}.jpg`, publica: `srp-pub-${SFX}.jpg`, emprestada: `srp-empr-${SFX}.jpg` };
  const projeto = {};

  // --- helpers ---------------------------------------------------------------

  /** Empurra ops pelo sync e devolve os acks (200 sempre: recusa é POR OPERAÇÃO). */
  const push = async (token, operations, esperado = 200) => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations })
      .expect(esperado);
    return res.body.data;
  };

  /**
   * A op ofensora MAIS uma irmã inocente, empurradas juntas.
   * Devolve `{ alvo, irma }` já casados por opId, para que cada PISO afirme as duas coisas que
   * importam: a recusa da alvo e a SOBREVIVÊNCIA do lote.
   */
  const pushComIrma = async (token, op) => {
    const irma = {
      id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: randomUUID(),
      mapId: mapa.id, timestamp: Date.now(), clientId: `srp-${SFX}`,
      data: {
        type: 'Feature', geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { source: 'point', nome: 'irmã inocente' },
      },
    };
    const { acks } = await push(token, [op, irma]);
    return {
      alvo: acks.find((a) => a.opId === op.id),
      irma: acks.find((a) => a.opId === irma.id),
    };
  };

  /** A op FLAT camelCase que o cliente real emite para uma entidade 3D. */
  const op3d = (entityId, tilesetId, operationType = 'create') => ({
    id: randomUUID(), entityType: 'marker3d', operationType, entityId, mapId: mapa.id,
    timestamp: Date.now(), clientId: `srp-${SFX}`,
    data: operationType === 'delete' ? null : {
      id: entityId, tilesetId, position: { longitude: -43.2, latitude: -22.9, height: 10 },
      properties: { nome: 'marcador' },
      sync: { createdAt: Date.now(), updatedAt: Date.now(), version: 1 },
    },
  });

  /** A op FLAT camelCase de um marcador 360. */
  const op360 = (entityId, photoName, operationType = 'create') => ({
    id: randomUUID(), entityType: 'marker360', operationType, entityId, mapId: mapa.id,
    timestamp: Date.now(), clientId: `srp-${SFX}`,
    data: operationType === 'delete' ? null : {
      id: entityId, photoName, azimuth: 90, label: 'alvo',
      sync: { createdAt: Date.now(), updatedAt: Date.now(), version: 1 },
    },
  });

  /** A op de slide, camelCase, com o id do briefing no slot `mapId` — como o cliente real. */
  const opSlide = (entityId, campos, operationType = 'create') => ({
    id: randomUUID(), entityType: 'slide', operationType, entityId, mapId: briefing.id,
    timestamp: Date.now(), clientId: `srp-${SFX}`,
    data: operationType === 'delete' ? null : {
      id: entityId, briefing_id: briefing.id, title: 'Slide', mode: '3d', ...campos,
    },
  });

  /** A op de camada de base: sub-tipo `baseLayer`, payload `{ baseLayer }`. */
  const opBaseLayer = (baseLayer) => ({
    id: randomUUID(), entityType: 'baseLayer', operationType: 'update', entityId: mapa.id,
    mapId: mapa.id, timestamp: Date.now(), clientId: `srp-${SFX}`,
    data: { baseLayer },
  });

  const linha3d = async (id) => (await db.query('SELECT tileset_id, deleted_at FROM cesium3d_data WHERE id = $1', [id])).rows[0];
  const linha360 = async (id) => (await db.query('SELECT photo_name, deleted_at FROM streetview360_data WHERE id = $1', [id])).rows[0];
  const linhaSlide = async (id) => (await db.query('SELECT model_id, photo_id, deleted_at FROM slides WHERE id = $1', [id])).rows[0];
  const baseLayerDoMapa = async () => (await db.query('SELECT base_layer FROM maps WHERE id = $1', [mapa.id])).rows[0].base_layer;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `srp_admin_${SFX}` });
    dono = await createUser(db, { username: `srp_dono_${SFX}` });
    membro = await createUser(db, { username: `srp_membro_${SFX}` });
    tokenDono = await loginUser(app, dono.username, dono.password);
    tokenMembro = await loginUser(app, membro.username, membro.password);

    atlas = await createAtlas(db, dono.id, { name: `SRP atlas ${SFX}` });
    mapa = await createMap(db, atlas.id, { name: 'Mapa SRP' });
    briefing = await createBriefing(db, atlas.id, { name: `Briefing SRP ${SFX}` });
    // `write`: o membro precisa poder EMPURRAR para que o gate de RECURSO seja o que o recusa.
    // O eixo medido aqui não é o de permissão por atlas (esse é `sync-3d-360-authz.test.js`).
    await createShare(db, atlas.id, membro.id, 'write', dono.id);

    // --- os recursos de catálogo, nos três estados ---------------------------
    for (const [id, nivel] of [[TS_PRIVADO, 'private'], [TS_PUBLICO, 'public'], [TS_EMPRESTADO, 'private']]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, sort_order, access_level)
         VALUES ($1, $2, $3::jsonb, 90, $4)`,
        [id, `Modelo ${id}`, JSON.stringify({ url: `http://localhost/3d/${id}/tileset.json` }), nivel],
      );
    }
    for (const [id, nivel] of [[BM_PRIVADO, 'private'], [BM_EMPRESTADO, 'private']]) {
      await db.query(
        `INSERT INTO basemaps (id, name, sort_order, config, access_level)
         VALUES ($1, $2, 90, '{}'::jsonb, $3)`,
        [id, `Base ${id}`, nivel],
      );
    }

    // --- os projetos 360, nos três estados, cada um com UMA foto -------------
    const { rows: orgs } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM SRP ${SFX}`, `om-srp-${SFX}`, 'SRP'],
    );
    orgId = orgs[0].id;
    for (const [chave, nivel] of [['privada', 'private'], ['publica', 'public'], ['emprestada', 'private']]) {
      const slug = `srp-${chave}-${SFX}`;
      const { rows } = await db.query(
        `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                     center_lat, center_long, photo_count)
         VALUES ($1, $2, $3, $4, 'enabled', $5, -22.9, -43.2, 1) RETURNING id`,
        [orgId, slug, `Projeto ${chave} ${SFX}`, `${orgId}__${slug}.db`, nivel],
      );
      projeto[chave] = rows[0].id;
      await db.query(
        `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
         VALUES ($1, $2, $3, 1, -22.9, -43.2)`,
        [`srp-foto-${chave}-${SFX}`, projeto[chave], foto[chave]],
      );
    }

    // --- o EMPRÉSTIMO (discriminação 3) --------------------------------------
    // D4: o empréstimo do atlas só sustenta enquanto o DONO do atlas vê o recurso, então a
    // concessão ao dono vem primeiro. O membro NÃO recebe concessão nenhuma: é justamente por
    // isso que o caso positivo dele só pode vir do empréstimo.
    for (const [tipo, id] of [
      ['tileset', TS_EMPRESTADO], ['basemap', BM_EMPRESTADO], ['sv360_project', projeto.emprestada],
    ]) {
      await db.query(
        `INSERT INTO resource_grants (resource_type, resource_id, grantee_id, grant_level, granted_by)
         VALUES ($1, $2, $3, 'view_share', $4)`,
        [tipo, id, dono.id, admin.id],
      );
      await db.query(
        `INSERT INTO atlas_resources (atlas_id, resource_type, resource_id, added_by)
         VALUES ($1, $2, $3, $4)`,
        [atlas.id, tipo, id, dono.id],
      );
    }

    // --- as linhas JÁ EXISTENTES que apontam para o privado ------------------
    // Elas são o mundo depois de uma revogação: a referência ficou, o acesso não. É sobre elas
    // que a discriminação 2 (o delete) e o piso de UPDATE trabalham. Escritas direto no banco,
    // porque escrevê-las pelo sync é exatamente o que o gate agora impede.
    await db.query(
      `INSERT INTO cesium3d_data (id, map_id, data_type, tileset_id, data)
       VALUES ($1, $2, 'marker', $3, '{}'::jsonb)`,
      [MORTO.tresD, mapa.id, TS_PRIVADO],
    );
    await db.query(
      `INSERT INTO streetview360_data (id, map_id, data_type, photo_name, data)
       VALUES ($1, $2, 'marker', $3, '{}'::jsonb)`,
      [MORTO.tresSessenta, mapa.id, foto.privada],
    );
    await db.query(
      `INSERT INTO slides (id, briefing_id, title, mode, model_id, photo_id)
       VALUES ($1, $2, 'Slide morto', '3d', $3, $4)`,
      [MORTO.slide, briefing.id, TS_PRIVADO, projeto.privada],
    );
  });

  after(async () => {
    // As tabelas de catálogo e o schema sv360 são COMPARTILHADOS pela suíte: uma linha privada
    // deixada para trás reprova longe daqui, num caso que compara listagens inteiras.
    const ids = [...IDS_TILESET, ...IDS_BASEMAP, ...Object.values(projeto)];
    await db.query('DELETE FROM atlas_resources WHERE resource_id = ANY($1::text[])', [ids]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])', [ids]);
    await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])', [IDS_TILESET]);
    await db.query('DELETE FROM basemaps WHERE id = ANY($1::text[])', [IDS_BASEMAP]);
    if (Object.values(projeto).length > 0) {
      await db.query('DELETE FROM sv360.projects WHERE id = ANY($1::uuid[])', [Object.values(projeto)]);
    }
    if (orgId) await db.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // PISO DAS FIXTURES — o dado de teste é o que o teste supõe
  // ==========================================================================

  it('PISO DE FIXTURE — os três estados de acesso existem, e o membro não tem concessão nenhuma', async () => {
    const { rows: ts } = await db.query(
      'SELECT id, access_level FROM tilesets WHERE id = ANY($1::text[]) ORDER BY id', [IDS_TILESET],
    );
    assert.equal(ts.length, 3, 'os três tilesets precisam existir');
    assert.deepEqual(
      Object.fromEntries(ts.map((r) => [r.id, r.access_level])),
      { [TS_PRIVADO]: 'private', [TS_PUBLICO]: 'public', [TS_EMPRESTADO]: 'private' },
    );

    const { rows: bm } = await db.query(
      "SELECT access_level FROM basemaps WHERE id = $1", [BM_PUBLICO],
    );
    assert.equal(bm.length, 1, 'o basemap semeado `osm` precisa existir');
    assert.equal(bm[0].access_level, 'public', 'e ser público, senão a discriminação 1 não discrimina');

    const { rows: g } = await db.query(
      'SELECT 1 FROM resource_grants WHERE grantee_id = $1 AND revoked_at IS NULL', [membro.id],
    );
    assert.equal(g.length, 0, 'o membro não pode ter concessão pessoal: o positivo dele vem do empréstimo');
  });

  // ==========================================================================
  // SUPERFÍCIE 1 — cesium3d.tileset_id
  // ==========================================================================

  it('3D PISO — o tileset PRIVADO é recusado por operação, nada é escrito, e o lote sobrevive', async () => {
    const id = randomUUID();
    const { alvo, irma } = await pushComIrma(tokenMembro, op3d(id, TS_PRIVADO));

    assert.equal(alvo.rejected, true, 'a op sobre o modelo 3D invisível precisa ser recusada');
    assert.match(alvo.reason, /modelo 3D/, 'a razão precisa nomear a superfície');
    assert.equal(await linha3d(id), undefined, 'nada pode ter sido escrito');
    assert.equal(irma.rejected, undefined, 'a irmã do mesmo lote precisa ter passado');
  });

  it('3D DISCRIMINAÇÃO 1 — o MESMO autor e o MESMO payload passam quando o tileset é PÚBLICO', async () => {
    const id = randomUUID();
    const { acks } = await push(tokenMembro, [op3d(id, TS_PUBLICO)]);
    assert.equal(acks[0].rejected, undefined, 'quem enxerga o recurso não pode ser recusado');
    assert.equal((await linha3d(id)).tileset_id, TS_PUBLICO);
  });

  it('3D DISCRIMINAÇÃO 2 — o DELETE da referência morta continua passando', async () => {
    const id = MORTO.tresD;
    const { acks } = await push(tokenMembro, [op3d(id, TS_PRIVADO, 'delete')]);
    assert.equal(acks[0].rejected, undefined, 'quem perdeu acesso precisa poder remover a referência');
    assert.notEqual((await linha3d(id)).deleted_at, null, 'e a remoção precisa ter acontecido');
  });

  it('3D DISCRIMINAÇÃO 3 — o tileset privado EMPRESTADO pelo atlas passa', async () => {
    const id = randomUUID();
    const { acks } = await push(tokenMembro, [op3d(id, TS_EMPRESTADO)]);
    assert.equal(acks[0].rejected, undefined, 'o empréstimo por atlas precisa contar no gate de escrita');
    assert.equal((await linha3d(id)).tileset_id, TS_EMPRESTADO);
  });

  it('3D — o UPDATE também é gateado: trocar um tileset visível por um privado é recusado', async () => {
    const id = randomUUID();
    await push(tokenMembro, [op3d(id, TS_PUBLICO)]);

    const { acks } = await push(tokenMembro, [op3d(id, TS_PRIVADO, 'update')]);
    assert.equal(acks[0].rejected, true, 'o update é create para efeitos deste gate');
    assert.equal((await linha3d(id)).tileset_id, TS_PUBLICO, 'a linha precisa ter ficado como estava');
  });

  // ==========================================================================
  // SUPERFÍCIE 2 — streetview360.photo_name
  // ==========================================================================

  it('360 PISO — a foto de projeto PRIVADO é recusada, nada é escrito, e o lote sobrevive', async () => {
    const id = randomUUID();
    const { alvo, irma } = await pushComIrma(tokenMembro, op360(id, foto.privada));

    assert.equal(alvo.rejected, true, 'a op sobre o projeto 360 invisível precisa ser recusada');
    assert.match(alvo.reason, /projeto 360/, 'a razão precisa nomear a superfície');
    assert.equal(await linha360(id), undefined, 'nada pode ter sido escrito');
    assert.equal(irma.rejected, undefined, 'a irmã do mesmo lote precisa ter passado');
  });

  it('360 DISCRIMINAÇÃO 1 — a mesma op passa com a foto de um projeto PÚBLICO', async () => {
    const id = randomUUID();
    const { acks } = await push(tokenMembro, [op360(id, foto.publica)]);
    assert.equal(acks[0].rejected, undefined, 'quem enxerga o projeto não pode ser recusado');
    assert.equal((await linha360(id)).photo_name, foto.publica);
  });

  it('360 DISCRIMINAÇÃO 2 — o DELETE da referência morta continua passando', async () => {
    const id = MORTO.tresSessenta;
    const { acks } = await push(tokenMembro, [op360(id, foto.privada, 'delete')]);
    assert.equal(acks[0].rejected, undefined, 'quem perdeu acesso precisa poder remover o marcador');
    assert.notEqual((await linha360(id)).deleted_at, null, 'e a remoção precisa ter acontecido');
  });

  it('360 DISCRIMINAÇÃO 3 — a foto de projeto privado EMPRESTADO pelo atlas passa', async () => {
    const id = randomUUID();
    const { acks } = await push(tokenMembro, [op360(id, foto.emprestada)]);
    assert.equal(acks[0].rejected, undefined, 'o empréstimo por atlas precisa contar no gate de escrita');
    assert.equal((await linha360(id)).photo_name, foto.emprestada);
  });

  it('360 — a referência é um NOME DE FOTO e é RESOLVIDA: um nome que não é de projeto nenhum recusa', async () => {
    // O par do caso acima: prova que o gate não está passando por acaso (por exemplo, aceitando
    // qualquer texto). Nome inexistente = projeto ausente = recusa, pela convenção da casa
    // (`NO ROW MEANS REFUSE`), que é o que impede o ack de virar oráculo de existência.
    const id = randomUUID();
    const { acks } = await push(tokenMembro, [op360(id, `nao-existe-${SFX}.jpg`)]);
    assert.equal(acks[0].rejected, true, 'referência que não resolve para projeto nenhum é recusada');
    assert.equal(await linha360(id), undefined);
  });

  // ==========================================================================
  // SUPERFÍCIE 3 — slides.model_id / slides.photo_id
  // ==========================================================================

  it('SLIDE PISO — o `modelId` privado é recusado, nada é escrito, e o lote sobrevive', async () => {
    const id = randomUUID();
    const { alvo, irma } = await pushComIrma(tokenMembro, opSlide(id, { modelId: TS_PRIVADO }));

    assert.equal(alvo.rejected, true, 'o slide que aponta para um modelo invisível precisa ser recusado');
    assert.match(alvo.reason, /slide/, 'a razão precisa nomear a superfície');
    assert.equal(await linhaSlide(id), undefined, 'nada pode ter sido escrito');
    assert.equal(irma.rejected, undefined, 'a irmã do mesmo lote precisa ter passado');
  });

  it('SLIDE PISO — o `photoId` privado é recusado pelo MESMO gate, na outra perna', async () => {
    // As duas pernas do slide são independentes de propósito: um extrator que só lesse `model_id`
    // deixaria esta passar, e o caso acima continuaria verde.
    const id = randomUUID();
    const { acks } = await push(tokenMembro, [opSlide(id, { photoId: projeto.privada })]);
    assert.equal(acks[0].rejected, true, 'o slide que aponta para um projeto 360 invisível é recusado');
    assert.equal(await linhaSlide(id), undefined);
  });

  it('SLIDE DISCRIMINAÇÃO 1 — o mesmo slide passa com modelo e projeto que o autor ENXERGA', async () => {
    const id = randomUUID();
    const { acks } = await push(
      tokenMembro, [opSlide(id, { modelId: TS_PUBLICO, photoId: projeto.publica })],
    );
    assert.equal(acks[0].rejected, undefined, 'quem enxerga os dois recursos não pode ser recusado');
    const linha = await linhaSlide(id);
    assert.equal(linha.model_id, TS_PUBLICO);
    assert.equal(linha.photo_id, projeto.publica);
  });

  it('SLIDE DISCRIMINAÇÃO 2 — o DELETE do slide com referência morta continua passando', async () => {
    const id = MORTO.slide;
    const { acks } = await push(tokenMembro, [opSlide(id, {}, 'delete')]);
    assert.equal(acks[0].rejected, undefined, 'quem perdeu acesso precisa poder apagar o slide');
    assert.notEqual((await linhaSlide(id)).deleted_at, null, 'e a remoção precisa ter acontecido');
  });

  it('SLIDE DISCRIMINAÇÃO 3 — modelo e projeto privados EMPRESTADOS pelo atlas passam', async () => {
    const id = randomUUID();
    const { acks } = await push(
      tokenMembro, [opSlide(id, { modelId: TS_EMPRESTADO, photoId: projeto.emprestada })],
    );
    assert.equal(acks[0].rejected, undefined, 'o empréstimo por atlas precisa contar nas duas pernas');
    const linha = await linhaSlide(id);
    assert.equal(linha.model_id, TS_EMPRESTADO);
    assert.equal(linha.photo_id, projeto.emprestada);
  });

  it('SLIDE — o slide SEM referência nenhuma passa: ausente e nulo não são referência', async () => {
    const id = randomUUID();
    const { acks } = await push(tokenMembro, [opSlide(id, { modelId: null, mode: '2d' })]);
    assert.equal(acks[0].rejected, undefined, 'um slide 2D não aponta para recurso nenhum');
    assert.equal((await linhaSlide(id)).model_id, null);
  });

  // ==========================================================================
  // SUPERFÍCIE 4 — maps.base_layer
  // ==========================================================================

  it('BASE PISO — a camada de base PRIVADA é recusada, o mapa não muda, e o lote sobrevive', async () => {
    const antes = await baseLayerDoMapa();
    const { alvo, irma } = await pushComIrma(tokenMembro, opBaseLayer(BM_PRIVADO));

    assert.equal(alvo.rejected, true, 'a troca para uma camada de base invisível precisa ser recusada');
    assert.match(alvo.reason, /camada de base/, 'a razão precisa nomear a superfície');
    assert.equal(await baseLayerDoMapa(), antes, 'o mapa precisa ter ficado como estava');
    assert.equal(irma.rejected, undefined, 'a irmã do mesmo lote precisa ter passado');
  });

  it('BASE DISCRIMINAÇÃO 1 — a mesma op passa com uma camada de base PÚBLICA', async () => {
    const { acks } = await push(tokenMembro, [opBaseLayer(BM_PUBLICO)]);
    assert.equal(acks[0].rejected, undefined, 'quem enxerga a camada de base não pode ser recusado');
    assert.equal(await baseLayerDoMapa(), BM_PUBLICO);
  });

  it('BASE DISCRIMINAÇÃO 2 — o DELETE do mapa cuja base é privada continua passando', async () => {
    // A superfície `baseLayer` não tem delete próprio (é uma coluna), então quem carrega a
    // exclusão é o delete do MAPA que a contém — a mesma regra, na entidade dona da coluna.
    // Vai pelo DONO porque apagar mapa é `manage`/`owner`, e este arquivo não mede aquele eixo.
    const morto = await createMap(db, atlas.id, { name: `Mapa base morta ${SFX}` });
    await db.query('UPDATE maps SET base_layer = $2 WHERE id = $1', [morto.id, BM_PRIVADO]);

    const { acks } = await push(tokenDono, [{
      id: randomUUID(), entityType: 'map', operationType: 'delete', entityId: morto.id,
      timestamp: Date.now(), clientId: `srp-${SFX}`, data: null,
    }]);
    assert.equal(acks[0].rejected, undefined, 'apagar um mapa com base privada não pode ser recusado');
    const { rows } = await db.query('SELECT deleted_at FROM maps WHERE id = $1', [morto.id]);
    assert.notEqual(rows[0].deleted_at, null, 'e a remoção precisa ter acontecido');
  });

  it('BASE DISCRIMINAÇÃO 3 — a camada de base privada EMPRESTADA pelo atlas passa', async () => {
    const { acks } = await push(tokenMembro, [opBaseLayer(BM_EMPRESTADO)]);
    assert.equal(acks[0].rejected, undefined, 'o empréstimo por atlas precisa contar no gate de escrita');
    assert.equal(await baseLayerDoMapa(), BM_EMPRESTADO);
  });

  it('BASE — um sub-tipo que NÃO é `baseLayer` não é gateado: a escrita já descarta a coluna irmã', async () => {
    // `MAP_SUBTYPE_FIELDS` estreita um `mapTemporal` à PRÓPRIA coluna, de propósito (anti
    // contrabando de coluna irmã), então um `base_layer` que venha de carona é DESCARTADO pela
    // escrita. Gatear ali recusaria a op inteira por um campo que nunca chega a coluna nenhuma:
    // o gate espelha a escrita, não a intenção declarada.
    const antes = await baseLayerDoMapa();
    const { acks } = await push(tokenMembro, [{
      id: randomUUID(), entityType: 'mapTemporal', operationType: 'update', entityId: mapa.id,
      mapId: mapa.id, timestamp: Date.now(), clientId: `srp-${SFX}`,
      data: { ativo: true, unidade: 'hora', base_layer: BM_PRIVADO },
    }]);
    assert.equal(acks[0].rejected, undefined, 'o sub-tipo temporal não carrega referência gateável');
    assert.equal(await baseLayerDoMapa(), antes, 'e a coluna irmã continua descartada pela escrita');
    const { rows } = await db.query('SELECT temporal_config FROM maps WHERE id = $1', [mapa.id]);
    assert.equal(rows[0].temporal_config.ativo, true, 'o efeito legítimo do sub-tipo aconteceu');
  });

  it('BASE — o gate alcança também o update de MAPA INTEIRO, que é a outra porta da mesma coluna', async () => {
    // `updateMapDataStore` (renomear, por exemplo) emite um `map` update com o documento
    // INTEIRO, `baseLayer` incluso, e `buildUpdateQuery` escreve a coluna a partir dele. Um gate
    // que só conhecesse o sub-tipo `baseLayer` deixaria esta porta aberta.
    const antes = await baseLayerDoMapa();
    const { acks } = await push(tokenMembro, [{
      id: randomUUID(), entityType: 'map', operationType: 'update', entityId: mapa.id,
      timestamp: Date.now(), clientId: `srp-${SFX}`,
      data: { id: mapa.id, name: 'Mapa SRP', baseLayer: BM_PRIVADO },
    }]);
    assert.equal(acks[0].rejected, true, 'o update de mapa inteiro carrega a mesma referência');
    assert.equal(await baseLayerDoMapa(), antes, 'e nada pode ter mudado');
  });

  // ==========================================================================
  // O QUE O GATE NÃO PODE ALCANÇAR
  // ==========================================================================

  it('O ADMINISTRADOR não é recusado: quem tem acesso global a dado privado escreve as quatro', async () => {
    // O par POSITIVO do arquivo inteiro, do outro lado do eixo: se o gate estivesse negando por
    // outro motivo (id inexistente, tipo errado, consulta quebrada), ele negaria aqui também.
    const tokenAdmin = await loginUser(app, admin.username, admin.password);
    await createShare(db, atlas.id, admin.id, 'write', dono.id);

    const idsNovos = { tresD: randomUUID(), tresSessenta: randomUUID(), slide: randomUUID() };
    const { acks } = await push(tokenAdmin, [
      op3d(idsNovos.tresD, TS_PRIVADO),
      op360(idsNovos.tresSessenta, foto.privada),
      opSlide(idsNovos.slide, { modelId: TS_PRIVADO, photoId: projeto.privada }),
      opBaseLayer(BM_PRIVADO),
    ]);
    assert.equal(acks.length, 4, 'as quatro ops precisam ter sido acusadas');
    assert.deepEqual(
      acks.map((a) => a.rejected), [undefined, undefined, undefined, undefined],
      'nenhuma das quatro pode ser recusada para quem enxerga todo recurso privado',
    );
    assert.equal((await linha3d(idsNovos.tresD)).tileset_id, TS_PRIVADO);
    assert.equal((await linha360(idsNovos.tresSessenta)).photo_name, foto.privada);
    assert.equal((await linhaSlide(idsNovos.slide)).model_id, TS_PRIVADO);
    assert.equal(await baseLayerDoMapa(), BM_PRIVADO);
  });
});
