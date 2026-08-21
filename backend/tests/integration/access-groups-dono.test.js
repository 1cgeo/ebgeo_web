// Path: tests/integration/access-groups-dono.test.js
//
// O GRUPO TEM DONO, E O DONO É QUEM O ENDEREÇA.
//
// Recortar a LISTAGEM por posse seria só obscuridade: o id do grupo viaja no corpo do
// `POST /grants`, e quem o adivinhe (ou o tenha visto antes, quando a listagem era
// aberta a todo autenticado) continuaria concedendo a um coletivo alheio. Quem fecha é
// `fn_can_administer_group` DENTRO do `WHERE` de `GET_ADDRESSABLE_LIVE_GROUP`. Este
// arquivo mede essa metade, pela superfície REAL.
//
// E MEDE A OUTRA METADE DA MESMA DECISÃO: um grupo cujo DONO foi desativado deixa de
// entregar acesso. Até 2026-08-20 `fn_user_group_ids` perguntava só pelo grupo
// (`deleted_at IS NULL`), então dono morto, grupo vivo e membros enxergando era estado
// estável — e, com a autoridade passando a ser posse, ninguém além do administrador
// podia sequer apagar aquele grupo. É a mesma forma de defeito que `fn_principal_vivo`
// fechou no ramo de concessão: autoridade que sobrevive a quem a exercia.
//
// TODO NEGATIVO VEM COM O POSITIVO DO MESMO PAR, e nos dois eixos: um 404 sozinho é o
// que se mede numa rota quebrada, e "deixou de ver" é o que se mede num predicado que
// passou a negar tudo.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, loginUser,
} from '../helpers/fixtures.js';

describe('F17 — o grupo de acesso tem DONO', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  let orgProdutora;
  let serie = 0;

  /** Uma camada de dados PRIVADA, nova a cada caso (o payload aditivo só traz privado). */
  async function novaCamada(rotulo, ownerOrgId = null) {
    serie += 1;
    const id = `dono-${rotulo}-${sufixo}-${serie}`;
    await db.query(
      `INSERT INTO data_layers (id, name, config, sort_order, access_level, owner_org_id)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private', $3::uuid)`,
      [id, `Camada ${id}`, ownerOrgId],
    );
    return id;
  }

  /** Um grupo novo, criado pela ROTA por `quem` (que vira o dono). */
  async function novoGrupo(quem, rotulo) {
    serie += 1;
    const res = await supertest(app)
      .post('/api/v1/access-groups')
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .send({ name: `Grupo ${rotulo} ${sufixo} ${serie}` })
      .expect(201);
    assert.equal(res.body.data.owner_id, atores[quem].id, 'quem cria é o dono');
    return res.body.data;
  }

  /** Põe alguém no grupo, pela rota, como o dono. */
  const porMembro = (quem, grupoId, userId) => supertest(app)
    .post(`/api/v1/access-groups/${grupoId}/members`)
    .set('Authorization', `Bearer ${tokens[quem]}`)
    .send({ userId })
    .expect(200);

  /** POST /grants como `quem`, sobre uma camada de dados. */
  const conceder = (quem, layer, corpo) => supertest(app)
    .post(`/api/v1/resource-access/data_layer/${layer}/grants`)
    .set('Authorization', `Bearer ${tokens[quem]}`)
    .send(corpo);

  /** Os ids de camada de dados que `quem` enxerga no payload aditivo. */
  async function camadasVisiveis(quem) {
    const res = await supertest(app)
      .get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .expect(200);
    return res.body.data.dataLayers.map((l) => l.id);
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    orgProdutora = (await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM dono ${sufixo}`, `om-dono-${sufixo}`, `dn${sufixo.slice(0, 3)}`],
    )).rows[0].id;

    atores.admin = await createAdminUser(db, { username: `dn_admin_${sufixo}` });
    atores.credenciado = await createUser(db, {
      username: `dn_cred_${sufixo}`, role: 'credenciado',
    });
    atores.produtor = await createProducerUser(db, orgProdutora, {
      username: `dn_prod_${sufixo}`,
    });
    for (const nome of ['donoA', 'donoB', 'membro', 'alvo', 'estranho']) {
      atores[nome] = await createUser(db, { username: `dn_${nome}_${sufixo}` });
    }
    for (const nome of Object.keys(atores)) {
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM data_layers WHERE id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM access_groups WHERE name LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM users WHERE producer_org_id = $1::uuid', [orgProdutora]);
    await db.query('DELETE FROM organizations WHERE id = $1::uuid', [orgProdutora]);
    await teardownTestEnv(db);
  });

  it('conceder a grupo PRÓPRIO é 201; a grupo alheio é 404, mesmo sabendo o id', async () => {
    const layer = await novaCamada('endereco');
    const doA = await novoGrupo('donoA', 'endereco-a');
    const doB = await novoGrupo('donoB', 'endereco-b');
    await porMembro('donoA', doA.id, atores.membro.id);
    await porMembro('donoB', doB.id, atores.alvo.id);

    // O ator ganha `view_share` na camada, que é a autoridade de repasse.
    await conceder('admin', layer, { granteeId: atores.donoA.id, grantLevel: 'view_share' })
      .expect(201);
    assert.ok(!(await camadasVisiveis('membro')).includes(layer), 'piso: o membro não vê ainda');

    // O PISO NÃO É O 201: é o membro passando a enxergar. Um 201 sozinho passa numa
    // concessão que nasce morta.
    await conceder('donoA', layer, { granteeGroupId: doA.id, grantLevel: 'view' }).expect(201);
    assert.ok(
      (await camadasVisiveis('membro')).includes(layer),
      'a concessão ao coletivo PRÓPRIO resolve para os membros dele',
    );

    // A DISCRIMINAÇÃO: o MESMO ator, o MESMO corpo, apontando para o grupo de outra
    // pessoa (id lido da resposta, não adivinhado). 404 e nunca 403 — a listagem
    // esconde o grupo, e um 403 confirmaria que ele existe.
    await conceder('donoA', layer, { granteeGroupId: doB.id, grantLevel: 'view' }).expect(404);
    assert.ok(
      !(await camadasVisiveis('alvo')).includes(layer),
      'a recusa é SEM EFEITO: o membro do grupo alheio não ganhou nada',
    );

    // E o ADMINISTRADOR concede ÀQUELE MESMO grupo alheio, com 201: sem esta linha, o
    // 404 acima seria indistinguível de uma consulta quebrada.
    await conceder('admin', layer, { granteeGroupId: doB.id, grantLevel: 'view' }).expect(201);
    assert.ok((await camadasVisiveis('alvo')).includes(layer), 'e o ramo curinga resolve');
  });

  it('o PRODUTOR concede de raiz a um grupo SÓ se o grupo for dele', async () => {
    // A COMBINAÇÃO DOS DOIS EIXOS, e ela não é dedutível de nenhum dos dois sozinho:
    // `fn_can_administer_group` NÃO tem ramo de produção, então produzir um recurso não
    // dá autoridade sobre o coletivo de outra pessoa. O produtor concede de RAIZ (não
    // há `view_share` de onde derivar) e mesmo assim precisa que o grupo seja seu.
    const layer = await novaCamada('produtor', orgProdutora);
    const doProdutor = await novoGrupo('produtor', 'prod-proprio');
    const doA = await novoGrupo('donoA', 'prod-alheio');
    await porMembro('produtor', doProdutor.id, atores.membro.id);
    await porMembro('donoA', doA.id, atores.alvo.id);

    const { rows: piso } = await db.query(
      `SELECT COUNT(*)::int AS n FROM resource_grants
        WHERE resource_id = $1 AND grantee_id = $2 AND revoked_at IS NULL`,
      [layer, atores.produtor.id],
    );
    assert.equal(piso[0].n, 0, 'piso: o produtor não tem concessão nenhuma — o que ele tem é o crachá');

    const criada = await conceder('produtor', layer, {
      granteeGroupId: doProdutor.id, grantLevel: 'view',
    }).expect(201);
    assert.equal(
      criada.body.data.parent_grant_id, null,
      'ele enxerga por PRODUÇÃO, não por concessão: não há pai de onde derivar',
    );
    assert.equal(criada.body.data.granted_by, atores.produtor.id);
    assert.ok((await camadasVisiveis('membro')).includes(layer), 'e a concessão resolve');

    // A DISCRIMINAÇÃO: o MESMO produtor, sobre o MESMO recurso que ele produz,
    // apontando para o grupo de outra pessoa. 404, e sem efeito.
    await conceder('produtor', layer, { granteeGroupId: doA.id, grantLevel: 'view' }).expect(404);
    assert.ok(
      !(await camadasVisiveis('alvo')).includes(layer),
      'produzir o recurso não dá autoridade sobre o coletivo alheio',
    );
    const { rows: nada } = await db.query(
      `SELECT COUNT(*)::int AS n FROM resource_grants
        WHERE resource_id = $1 AND grantee_group_id = $2`,
      [layer, doA.id],
    );
    assert.equal(nada[0].n, 0);

    // E o par que prova que o grupo alheio É concedível e que falta é a AUTORIDADE
    // sobre ele: o dono daquele grupo tem de poder recebê-lo por outra mão.
    await conceder('admin', layer, { granteeGroupId: doA.id, grantLevel: 'view' }).expect(201);
    assert.ok((await camadasVisiveis('alvo')).includes(layer));
  });

  it('D8(a) — desativar o DONO do grupo tira o acesso dos membros', async () => {
    // O PISO É O ACESSO EXISTINDO, e a DISCRIMINAÇÃO é um SEGUNDO grupo, de dono VIVO,
    // com o MESMO membro e outro recurso. Sem ele, um predicado quebrado que zerasse
    // todos os grupos passaria verde neste caso.
    const camadaA = await novaCamada('vidaA');
    const camadaB = await novaCamada('vidaB');
    const doA = await novoGrupo('donoA', 'vida-a');
    const doB = await novoGrupo('donoB', 'vida-b');
    await porMembro('donoA', doA.id, atores.membro.id);
    await porMembro('donoB', doB.id, atores.membro.id);
    await conceder('admin', camadaA, { granteeGroupId: doA.id, grantLevel: 'view' }).expect(201);
    await conceder('admin', camadaB, { granteeGroupId: doB.id, grantLevel: 'view' }).expect(201);

    const antes = await camadasVisiveis('membro');
    assert.ok(antes.includes(camadaA), 'piso: o membro vê pelo grupo de A');
    assert.ok(antes.includes(camadaB), 'piso: e vê pelo grupo de B');

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [atores.donoA.id]);

    const depois = await camadasVisiveis('membro');
    assert.ok(
      !depois.includes(camadaA),
      'dono desativado, grupo deixa de conceder — a autoridade morre com quem a exercia',
    );
    assert.ok(
      depois.includes(camadaB),
      'A DISCRIMINAÇÃO: o grupo de dono VIVO não se move. Sem esta linha, um predicado '
      + 'que zerasse todos os grupos passaria verde',
    );

    // O ADMINISTRADOR CONTINUA PODENDO ADMINISTRAR o grupo órfão, que é o que impede o
    // estado de ser um beco: o dono não pode mais mexer nele (nem entrar).
    await supertest(app)
      .get(`/api/v1/access-groups/${doA.id}/members`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);

    // O CONTROLE DA REVERSÃO: reativar devolve o acesso. Sem ele, "sumiu" seria
    // compatível com a fixture ter sido destruída pelo caminho.
    await db.query('UPDATE users SET is_active = true WHERE id = $1', [atores.donoA.id]);
    const revertido = await camadasVisiveis('membro');
    assert.ok(revertido.includes(camadaA), 'reativar o dono devolve o acesso');
    assert.ok(revertido.includes(camadaB));
  });

  it('D8(a) — a mesma morte fecha a porta do REPASSE, e não só a da leitura', async () => {
    // A CHECAGEM ESTÁ NO LUGAR MAIS FUNDO (`fn_user_group_ids`), e é isso que faz as
    // portas fecharem JUNTAS. Se ela morasse só no ramo coletivo de
    // `fn_granted_resource_ids`, quem recebeu `view_share` por um grupo de dono morto
    // continuaria REPASSANDO o recurso que já não pode ver — e o `shareable` do payload
    // continuaria oferecendo o botão.
    const layer = await novaCamada('repasse');
    const doA = await novoGrupo('donoA', 'repasse-a');
    await porMembro('donoA', doA.id, atores.membro.id);
    await conceder('admin', layer, { granteeGroupId: doA.id, grantLevel: 'view_share' })
      .expect(201);

    const piso = await supertest(app)
      .get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokens.membro}`)
      .expect(200);
    assert.ok(piso.body.data.shareable.dataLayers.includes(layer), 'piso: o botão está aceso');
    await conceder('membro', layer, { granteeId: atores.alvo.id, grantLevel: 'view' })
      .expect(201);

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [atores.donoA.id]);

    const depois = await supertest(app)
      .get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokens.membro}`)
      .expect(200);
    assert.ok(
      !depois.body.data.shareable.dataLayers.includes(layer),
      'o botão apaga junto: uma capacidade sem leitura seria escalação',
    );
    await conceder('membro', layer, { granteeId: atores.estranho.id, grantLevel: 'view' })
      .expect(403);

    await db.query('UPDATE users SET is_active = true WHERE id = $1', [atores.donoA.id]);
    const revertido = await supertest(app)
      .get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokens.membro}`)
      .expect(200);
    assert.ok(revertido.body.data.shareable.dataLayers.includes(layer), 'e volta ao reativar');
  });
});
