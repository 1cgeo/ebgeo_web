// Path: tests/integration/resource-access-compartilhavel.test.js
//
// `shareable`: QUEM PODE REPASSAR, dentro do payload aditivo.
//
// É o único campo de `/resource-access/visible` que não é recurso, e ele existe
// para uma decisão de INTERFACE: o cartão do catálogo precisa saber, ANTES de
// qualquer clique, se mostra a ação "Compartilhar". As duas alternativas eram
// piores — uma chamada por cartão (dezenas de requisições ao abrir o catálogo), ou
// oferecer o botão a todo mundo e deixar o 403 explicar depois.
//
// A afirmação que este arquivo prende é a que separa os dois eixos: VER um recurso
// privado e poder CEDÊ-LO são coisas diferentes, e `shareable` é sempre um
// SUBCONJUNTO do que a pessoa vê. Sem o par medido junto, uma implementação que
// devolvesse "tudo o que você vê" passaria verde.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, loginUser,
} from '../helpers/fixtures.js';

describe('o payload aditivo declara o que este ator pode REPASSAR', () => {
  let app, db, admin, cedente, leitor, produtor;
  let tokenAdmin, tokenCedente, tokenLeitor, tokenProdutor;
  let orgA, orgB;
  const sufixo = randomUUID().slice(0, 8);
  const RECURSO = `share-3d-${sufixo}`;
  const OUTRO = `share-data-${sufixo}`;
  const DA_OM = `share-om-${sufixo}`;
  const DE_OUTRA_OM = `share-omb-${sufixo}`;
  const PUBLICO_DA_OM = `share-om-pub-${sufixo}`;
  let grantCedente;

  const visiveis = async (token) => (await supertest(app)
    .get('/api/v1/resource-access/visible')
    .set('Authorization', `Bearer ${token}`)
    .expect(200)).body.data;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `sh_admin_${sufixo}` });
    cedente = await createUser(db, { username: `sh_ced_${sufixo}` });
    leitor = await createUser(db, { username: `sh_leit_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenCedente = await loginUser(app, cedente.username, cedente.password);
    tokenLeitor = await loginUser(app, leitor.username, leitor.password);

    const criaOrg = async (rotulo) => (await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM sh ${rotulo} ${sufixo}`, `om-sh-${rotulo}-${sufixo}`, `${rotulo}${sufixo.slice(0, 3)}`]
    )).rows[0].id;
    orgA = await criaOrg('a');
    orgB = await criaOrg('b');
    produtor = await createProducerUser(db, orgA, { username: `sh_prod_${sufixo}` });
    tokenProdutor = await loginUser(app, produtor.username, produtor.password);

    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [RECURSO, `Modelo ${sufixo}`]
    );
    await db.query(
      `INSERT INTO data_layers (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/y"}'::jsonb, 0, 'private')`,
      [OUTRO, `Camada ${sufixo}`]
    );

    // Os três recursos do eixo de PRODUÇÃO: o privado da OM do produtor, o privado
    // de outra OM e o PÚBLICO da mesma OM (que separa 'produzido' de 'produzido e
    // privado').
    for (const [id, org, nivel] of [
      [DA_OM, orgA, 'private'], [DE_OUTRA_OM, orgB, 'private'], [PUBLICO_DA_OM, orgA, 'public'],
    ]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, sort_order, owner_org_id, access_level)
         VALUES ($1, $2, '{"url":"/z"}'::jsonb, 0, $3::uuid, $4)`,
        [id, `Tileset ${id}`, org, nivel]
      );
    }
    // O produtor ENXERGA o institucional por uma concessão `view`: é o piso da
    // discriminação do caso de produção.
    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${RECURSO}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: produtor.id, grantLevel: 'view' })
      .expect(201);

    // O CEDENTE recebe `view_share`; o LEITOR recebe `view` no MESMO recurso.
    // É esse par que discrimina: os dois veem, só um pode ceder.
    const res = await supertest(app)
      .post(`/api/v1/resource-access/tileset/${RECURSO}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: cedente.id, grantLevel: 'view_share' })
      .expect(201);
    grantCedente = res.body.data.id;

    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${RECURSO}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: leitor.id, grantLevel: 'view' })
      .expect(201);

    // E o cedente recebe SÓ `view` no outro recurso, para que "pode repassar" não
    // possa ser confundido com "é o fulano".
    await supertest(app)
      .post(`/api/v1/resource-access/data_layer/${OUTRO}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: cedente.id, grantLevel: 'view' })
      .expect(201);
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1)', [[RECURSO, OUTRO]]);
    await db.query('DELETE FROM tilesets WHERE id = ANY($1)', [[RECURSO, DA_OM, DE_OUTRA_OM, PUBLICO_DA_OM]]);
    await db.query('DELETE FROM data_layers WHERE id = $1', [OUTRO]);
    await db.query('DELETE FROM users WHERE producer_org_id = ANY($1::uuid[])', [[orgA, orgB]]);
    await db.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[orgA, orgB]]);
    await teardownTestEnv(db);
  });

  it('as quatro chaves de `shareable` existem sempre, mesmo para quem não pode repassar nada', async () => {
    // O cliente indexa sem checar; uma chave ausente viraria um `undefined` lido
    // como "não pode", que é a resposta certa pelo motivo errado.
    const dele = await visiveis(tokenLeitor);
    let medidas = 0;
    for (const chave of ['tilesets', 'dataLayers', 'analysisLayers', 'views360']) {
      assert.ok(Array.isArray(dele.shareable[chave]), `shareable.${chave} precisa ser um array`);
      medidas += 1;
    }
    assert.equal(medidas, 4, 'guarda: as quatro chaves precisam ter sido medidas');
  });

  it('quem tem `view_share` aparece em `shareable`; quem tem `view` NÃO — e os dois VEEM', async () => {
    const doCedente = await visiveis(tokenCedente);
    const doLeitor = await visiveis(tokenLeitor);

    // O piso: os dois enxergam o recurso. Sem isto, "o leitor não pode repassar"
    // também seria verdade num sistema em que ele simplesmente não vê nada.
    assert.ok(doCedente.tilesets.map((t) => t.id).includes(RECURSO), 'o cedente vê o recurso');
    assert.ok(doLeitor.tilesets.map((t) => t.id).includes(RECURSO), 'o leitor vê o recurso');

    assert.ok(doCedente.shareable.tilesets.includes(RECURSO), 'view_share => pode repassar');
    assert.ok(!doLeitor.shareable.tilesets.includes(RECURSO), 'view => NÃO pode repassar');
  });

  it('`shareable` é por RECURSO, não por pessoa', async () => {
    const doCedente = await visiveis(tokenCedente);
    assert.ok(doCedente.dataLayers.map((r) => r.id).includes(OUTRO), 'o cedente vê o outro recurso');
    assert.ok(
      !doCedente.shareable.dataLayers.includes(OUTRO),
      'ele só tem `view` neste, e o campo precisa refletir o recurso, não o usuário'
    );
  });

  it('o papel global NÃO entra em `shareable`, e a omissão é deliberada', async () => {
    // O administrador concede de RAIZ, sem concessão nenhuma, então não há linha
    // para listar. Quem sabe disso no cliente é `sessionContext.hasGlobalDataAccess()`,
    // e somar o papel aqui seria uma SEGUNDA definição da mesma regra. Este caso
    // existe para que ninguém "conserte" a ausência.
    const doAdmin = await visiveis(tokenAdmin);
    assert.ok(doAdmin.tilesets.map((t) => t.id).includes(RECURSO), 'o admin vê por papel global');
    assert.ok(!doAdmin.shareable.tilesets.includes(RECURSO), 'e não aparece em shareable, porque não tem concessão');
  });

  it('a PRODUÇÃO entra em `shareable`; o papel global continua fora', async () => {
    // O CASO VIZINHO AFIRMA A OMISSÃO DO PAPEL GLOBAL, e este afirma a PRESENÇA da
    // produção. A assimetria não é incoerência: o cliente TEM como saber que é
    // administrador (`hasGlobalDataAccess()`) e NÃO tem como saber de qual OM é cada
    // item — o payload aditivo não carrega `owner_org_id`, de propósito. Sem este braço,
    // o produtor teria a permissão de repassar o que a OM dele mantém e nenhuma porta
    // para ela, que na tela é indistinguível de não ter a permissão.
    const doProdutor = await visiveis(tokenProdutor);

    // O PISO: ele ENXERGA o recurso da OM dele (pelo ramo de produção do predicado).
    assert.ok(
      doProdutor.tilesets.map((t) => t.id).includes(DA_OM),
      'piso: o produtor vê o privado da própria OM'
    );
    assert.ok(doProdutor.shareable.tilesets.includes(DA_OM), 'e pode REPASSÁ-LO');

    // AS DUAS DISCRIMINAÇÕES, no MESMO payload do MESMO produtor. Sem elas, "aparece em
    // shareable" passaria numa implementação que despejasse ali tudo o que o ator
    // enxerga — que é exatamente a confusão entre VER e poder CEDER que este arquivo
    // existe para separar.
    assert.ok(
      doProdutor.tilesets.map((t) => t.id).includes(RECURSO),
      'piso da discriminação: ele enxerga o institucional, por uma concessão `view`'
    );
    assert.ok(
      !doProdutor.shareable.tilesets.includes(RECURSO),
      'e NÃO o repassa: `view` continua sendo `view`, venha o ator de onde vier'
    );
    assert.ok(
      !doProdutor.tilesets.map((t) => t.id).includes(DE_OUTRA_OM),
      'e o privado de OUTRA OM não entra em grupo nenhum'
    );
    assert.ok(!doProdutor.shareable.tilesets.includes(DE_OUTRA_OM));

    // E o recurso PÚBLICO da MESMA OM não aparece em `shareable`, que é o que separa
    // "produzido" de "produzido E privado": o campo serve à afordância do cartão, e o
    // cartão de recurso público não tem essa ação.
    assert.ok(!doProdutor.shareable.tilesets.includes(PUBLICO_DA_OM));
  });

  it('revogar a concessão tira o recurso de `shareable` junto com a visibilidade', async () => {
    const antes = await visiveis(tokenCedente);
    assert.ok(antes.shareable.tilesets.includes(RECURSO), 'piso: presente antes da revogação');

    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${grantCedente}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const depois = await visiveis(tokenCedente);
    assert.ok(!depois.shareable.tilesets.includes(RECURSO), 'revogado, não pode mais repassar');
    assert.ok(!depois.tilesets.map((t) => t.id).includes(RECURSO), 'e nem enxerga mais o recurso');
  });
});
