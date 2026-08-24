// Path: tests/integration/resource-access-prazo-no-payload.test.js
//
// O PRAZO de cada recurso do payload aditivo (`data.expirations`), irmão de `origins`.
//
// O DEFEITO QUE ELE FECHA É DE TELA, e é a metade que faltava do selo de procedência. A
// procedência responde POR QUE a pessoa enxerga; ninguém respondia ATÉ QUANDO. Para quem
// recebeu com nível `view` — a maioria de quem tem prazo — o recurso aparecia um dia e
// sumia noutro, sem evento e sem aviso, porque a morte da concessão mora no PREDICADO do
// servidor e não emite nada. O chip do cartão já estava escrito e sem dado nenhum.
//
// A DECISÃO QUE ESTE ARQUIVO MEDE, e ela é o oposto do que a nota de decisão sugeria
// ("o `expires_at` da concessão VIVA de MENOR prazo"): o valor é o MAIOR. A pergunta da
// tela é QUANDO EU PERCO ISTO, concessão é DISJUNTIVA (D3: a estrutura é um DAG, e a mesma
// pessoa pode receber de dois concedentes), e o acesso sobrevive enquanto QUALQUER uma
// estiver viva. Com o menor, a tela anunciaria o sumiço numa data em que o item
// demonstravelmente continua lá — e o preço não é o susto, é a pessoa aprender que o chip
// mente e ignorá-lo no dia em que ele estiver certo.
//
// A SEGUNDA METADE É O NULO POR PAPEL. Quem enxerga por papel global ou por PRODUÇÃO não
// perde nada quando uma concessão vence, mesmo tendo uma; publicar o prazo dela prometeria
// um vencimento que não existe. É a mesma precedência de `origins` (`papel > concessao >
// emprestimo`) reusada, e é por isso que o caso do administrador COM concessão está aqui:
// é ele que discrimina "olhou a procedência" de "só copiou a coluna".
//
// CONTROLE NEGATIVO, conferido revertendo de fato:
//   - trocar `MAX` por `MIN` em `expiryColumn` derruba o caso dos dois concedentes;
//   - apagar o `if (origem !== RESOURCE_ORIGIN.CONCESSAO) return null` de `prazoDeAcesso`
//     derruba o caso do administrador e o do produtor;
//   - apagar a coluna do SELECT (ou passar o `id` NÃO qualificado no 360, que a resolve
//     para `resource_grants.id` e devolve NULL calado) derruba o piso e o caso do 360.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, createAtlas, createShare, loginUser,
} from '../helpers/fixtures.js';

const GRUPOS = ['basemaps', 'tilesets', 'dataLayers', 'analysisLayers', 'views360'];

const DIA = 24 * 60 * 60 * 1000;
/** Uma data ISO daqui a N dias. O teto da casa é um ano, então tudo aqui cabe. */
const daquiA = (dias) => new Date(Date.now() + dias * DIA).toISOString();

describe('prazo no payload aditivo: até quando este acesso vale', () => {
  let app, db, orgId;
  let adminA, adminB, produtor, beneficiario, membroDoAtlas, forasteiro;
  const token = {};
  let atlasQueEmpresta;
  const sufixo = randomUUID().slice(0, 8);
  const TILESET = `prazo-inst-${sufixo}`;
  const TILESET_OM = `prazo-om-${sufixo}`;
  const SLUG_360 = `prazo360-${sufixo}`;
  let projeto360Id;

  /** Os dois prazos do mesmo beneficiário sobre TILESET, para o caso do MAX. */
  const PRAZO_CURTO = daquiA(20);
  const PRAZO_LONGO = daquiA(200);

  const visiveis = async (quem, atlasId = null) => {
    const req = supertest(app).get(
      `/api/v1/resource-access/visible${atlasId ? `?atlasId=${atlasId}` : ''}`
    );
    if (quem) req.set('Authorization', `Bearer ${token[quem]}`);
    return (await req.expect(200)).body.data;
  };

  const conceder = (quem, type, resourceId, granteeId, expiresAt) => supertest(app)
    .post(`/api/v1/resource-access/${type}/${resourceId}/grants`)
    .set('Authorization', `Bearer ${token[quem]}`)
    .send({ granteeId, grantLevel: 'view', expiresAt })
    .expect(201);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const { rows: orgs } = await db.query(
      'INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id',
      [`OM prazo ${sufixo}`, `omprazo-${sufixo}`, `Z${sufixo.slice(0, 4)}`]
    );
    orgId = orgs[0].id;

    // DOIS ADMINISTRADORES, e a duplicidade é o sujeito do caso central: duas concessões
    // vivas para a mesma pessoa exigem concedentes DIFERENTES (a segunda do mesmo
    // concedente volta 409, por `LIVE_GRANT_FROM_ACTOR_TO_GRANTEE`).
    adminA = await createAdminUser(db, { username: `prazo_adma_${sufixo}` });
    adminB = await createAdminUser(db, { username: `prazo_admb_${sufixo}` });
    produtor = await createProducerUser(db, orgId, { username: `prazo_prod_${sufixo}` });
    beneficiario = await createUser(db, { username: `prazo_ben_${sufixo}` });
    membroDoAtlas = await createUser(db, { username: `prazo_membro_${sufixo}` });
    forasteiro = await createUser(db, { username: `prazo_fora_${sufixo}` });
    for (const [nome, u] of Object.entries({
      adminA, adminB, produtor, beneficiario, membroDoAtlas, forasteiro,
    })) {
      token[nome] = await loginUser(app, u.username, u.password);
    }

    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [TILESET, `Tileset institucional ${sufixo}`]
    );
    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level, owner_org_id)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private', $3)`,
      [TILESET_OM, `Tileset da OM ${sufixo}`, orgId]
    );
    const { rows: p360 } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, access_level)
       VALUES ($1, $2, $3, $4, 'private') RETURNING id::text AS id`,
      [orgId, SLUG_360, `Projeto 360 ${sufixo}`, `${orgId}__${SLUG_360}.db`]
    );
    projeto360Id = p360[0].id;

    atlasQueEmpresta = await createAtlas(db, adminA.id, { name: `Atlas prazo ${sufixo}` });
    await createShare(db, atlasQueEmpresta.id, membroDoAtlas.id, 'read', adminA.id);
    await supertest(app)
      .post(`/api/v1/atlas/${atlasQueEmpresta.id}/resources`)
      .set('Authorization', `Bearer ${token.adminA}`)
      .send({ resourceType: 'tileset', resourceId: TILESET })
      .expect(201);

    // O CASO CENTRAL: dois concedentes, dois prazos. A ORDEM DE CRIAÇÃO É A INVERSA DA
    // ORDEM DAS DATAS de propósito — assim um `MAX` trocado por "o último que chegou"
    // continuaria verde, e é justamente esse atalho que a asserção precisa recusar.
    await conceder('adminA', 'tileset', TILESET, beneficiario.id, PRAZO_LONGO);
    await conceder('adminB', 'tileset', TILESET, beneficiario.id, PRAZO_CURTO);

    // O ADMINISTRADOR B RECEBE UMA CONCESSÃO TAMBÉM, e é ela que discrimina o ramo do
    // papel: a coluna vem preenchida para ele, e mesmo assim o payload não pode publicá-la.
    await conceder('adminA', 'tileset', TILESET, adminB.id, PRAZO_CURTO);
    // O MESMO para o produtor, sobre o recurso da PRÓPRIA OM: ele o enxerga por produção,
    // e a concessão que ele por acaso tenha não é o que o mantém enxergando.
    await conceder('adminA', 'tileset', TILESET_OM, produtor.id, PRAZO_CURTO);

    await conceder('adminA', 'sv360_project', projeto360Id, beneficiario.id, PRAZO_CURTO);
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id IN ($1, $2, $3)',
      [TILESET, TILESET_OM, projeto360Id]);
    await db.query('DELETE FROM atlas_resources WHERE resource_id = $1', [TILESET]);
    await db.query('DELETE FROM tilesets WHERE id IN ($1, $2)', [TILESET, TILESET_OM]);
    await db.query('DELETE FROM sv360.projects WHERE id = $1::uuid', [projeto360Id]);
    await teardownTestEnv(db);
  });

  it('as CINCO chaves de `expirations` existem sempre, como as de `origins`', async () => {
    const dele = await visiveis('forasteiro');
    assert.deepEqual(Object.keys(dele.expirations).sort(), [...GRUPOS].sort());
    for (const g of GRUPOS) {
      assert.deepEqual(dele.expirations[g], {}, `${g}: o forasteiro não tem prazo nenhum`);
    }
    // O POSITIVO DO MESMO PAR: "tudo vazio" também é o que se mede se a rota tiver parado
    // de responder o mapa inteiro.
    const doBeneficiario = await visiveis('beneficiario');
    assert.ok(doBeneficiario.expirations.tilesets[TILESET],
      'piso: quem tem concessão precisa ter prazo, senão os "vazios" acima não provam nada');
  });

  it('com DOIS concedentes vale o MAIOR prazo: é quando a pessoa perde de fato', async () => {
    const dados = await visiveis('beneficiario');
    assert.equal(dados.origins.tilesets[TILESET], 'concessao', 'piso: a procedência é concessão');

    const prazo = dados.expirations.tilesets[TILESET];
    assert.equal(new Date(prazo).getTime(), new Date(PRAZO_LONGO).getTime());
    assert.notEqual(new Date(prazo).getTime(), new Date(PRAZO_CURTO).getTime(),
      'com o menor, a tela anuncia o sumiço numa data em que o item continua lá');
    // ISO E NÃO OBJETO: o cliente formata a data e compara instantes, e um `Date` cru
    // atravessaria o JSON de um jeito e a leitura do outro.
    assert.equal(typeof prazo, 'string');
  });

  it('quem enxerga por PAPEL não recebe prazo, mesmo tendo uma concessão viva', async () => {
    // O ADMINISTRADOR B tem concessão sobre TILESET (criada no `before`) e enxerga tudo
    // por papel global. A coluna da consulta vem preenchida para ele; publicá-la
    // prometeria um sumiço que o vencimento daquela concessão não causa.
    const doAdmin = await visiveis('adminB');
    assert.equal(doAdmin.origins.tilesets[TILESET], 'papel', 'piso: a procedência é papel');
    assert.ok(doAdmin.tilesets.map((t) => t.id).includes(TILESET), 'piso: ele recebe o recurso');
    assert.equal(doAdmin.expirations.tilesets[TILESET], undefined);

    // E O MESMO PELO EIXO DE PRODUÇÃO, que é o outro ramo que `papel` absorve.
    const doProdutor = await visiveis('produtor');
    assert.equal(doProdutor.origins.tilesets[TILESET_OM], 'papel');
    assert.equal(doProdutor.expirations.tilesets[TILESET_OM], undefined);
  });

  it('empréstimo não tem prazo a dizer: `atlas_resources` não carrega relógio', async () => {
    const dentro = await visiveis('membroDoAtlas', atlasQueEmpresta.id);
    assert.equal(dentro.origins.tilesets[TILESET], 'emprestimo', 'piso: a procedência é empréstimo');
    assert.ok(dentro.tilesets.map((t) => t.id).includes(TILESET), 'piso: ele recebe o recurso');
    assert.equal(dentro.expirations.tilesets[TILESET], undefined);
  });

  it('o 360 carrega prazo pelo MESMO caminho, e sem contaminar o item', async () => {
    const dados = await visiveis('beneficiario');
    assert.equal(
      new Date(dados.expirations.views360[projeto360Id]).getTime(),
      new Date(PRAZO_CURTO).getTime()
    );

    // A COLUNA DE PRAZO NÃO PODE VAZAR PARA DENTRO DO ITEM, pela mesma razão das de
    // procedência: o cliente despeja estes itens nos arrays de `config`. A lista de campos
    // é a mesma de antes das colunas novas.
    const item = dados.views360.find((v) => v.id === projeto360Id);
    assert.ok(item, 'piso: o item precisa estar na lista');
    assert.deepEqual(
      Object.keys(item).sort(),
      ['capture_date', 'center_lat', 'center_long', 'entry_photo_id', 'id', 'name',
        'photo_count', 'slug', 'status']
    );
    // E o mesmo do lado do catálogo: `concessao_expira_em` é coluna da linha, não campo do item.
    const tileset = dados.tilesets.find((t) => t.id === TILESET);
    assert.ok(tileset, 'piso: o tileset precisa estar na lista');
    assert.equal(tileset.concessao_expira_em, undefined);
  });

  it('concessão REVOGADA deixa de contar, e o prazo cai para a que sobrou', async () => {
    // A vivacidade não é uma segunda regra aqui: é o mesmo `revoked_at IS NULL` dos braços
    // de `fn_granted_resource_ids`. Derrubando a de PRAZO LONGO, o valor tem de recuar para
    // a curta — se ele não recuar, a coluna está lendo linha morta.
    const { rows } = await db.query(
      `SELECT id FROM resource_grants
        WHERE resource_id = $1 AND grantee_id = $2 AND granted_by = $3 AND revoked_at IS NULL`,
      [TILESET, beneficiario.id, adminA.id]
    );
    assert.equal(rows.length, 1, 'piso: a concessão de prazo longo precisa existir viva');

    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${rows[0].id}`)
      .set('Authorization', `Bearer ${token.adminA}`)
      .expect(200);

    const dados = await visiveis('beneficiario');
    assert.equal(dados.origins.tilesets[TILESET], 'concessao', 'piso: ele ainda enxerga');
    assert.equal(
      new Date(dados.expirations.tilesets[TILESET]).getTime(),
      new Date(PRAZO_CURTO).getTime()
    );
  });
});
