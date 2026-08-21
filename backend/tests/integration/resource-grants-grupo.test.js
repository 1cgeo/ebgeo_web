// Path: tests/integration/resource-grants-grupo.test.js
//
// A CONCESSÃO COLETIVA: o beneficiário é uma pessoa OU um grupo.
//
// As duas tabelas do grupo, a coluna `resource_grants.grantee_group_id` e o braço de
// grupo de `fn_granted_resource_ids` nasceram com `008_acesso_a_recurso.sql` e, até
// 2026-08-19, NENHUMA
// linha de JavaScript as tocava: o ramo do predicado nunca devolveu linha em
// produção, porque não havia como pôr ninguém num grupo. Este arquivo mede o
// mecanismo inteiro pela superfície REAL, `GET /resource-access/visible`, e não pela
// função SQL: um recurso sai por muitas portas, e um predicado certo numa consulta
// não protege (nem abre) as outras.
//
// TODO NEGATIVO VEM COM O POSITIVO DO MESMO PAR, no mesmo corpo. "Não vê" é também o
// que se mede quando a fixture não existe, quando o token está errado e quando o
// filtro passou a negar tudo; e o caso mais importante daqui (a LISTAGEM de quem tem
// acesso) existe porque a junção era um INNER em `users`, o que fazia a linha de
// grupo SUMIR da resposta com 201 na criação e nenhum erro em lugar nenhum.
//
// O QUE ESTE ARQUIVO NÃO PRENDE: o CRUD do grupo e os gates do módulo
// (`access-groups-crud.test.js`) e a trilha de auditoria
// (`access-groups-auditoria.test.js`).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('F16 — concessão a GRUPO', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  let serie = 0;

  /** Uma camada de dados PRIVADA, nova a cada caso (o payload aditivo só traz privado). */
  async function novaCamada(rotulo) {
    serie += 1;
    const id = `grp-${rotulo}-${sufixo}-${serie}`;
    await db.query(
      `INSERT INTO data_layers (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [id, `Camada ${id}`],
    );
    return id;
  }

  /**
   * Um grupo novo, criado pela ROTA (que é o caminho que o produto usa).
   *
   * O DONO É PARÂMETRO desde que a autoridade sobre grupo virou POSSE (2026-08-20):
   * quem cria é o dono, e só o dono (ou o administrador) endereça aquele grupo numa
   * concessão. O default continua sendo o administrador, que é o ramo curinga.
   */
  async function novoGrupo(rotulo, dono = 'admin') {
    serie += 1;
    const res = await supertest(app)
      .post('/api/v1/access-groups')
      .set('Authorization', `Bearer ${tokens[dono]}`)
      .send({ name: `Grupo ${rotulo} ${sufixo} ${serie}` })
      .expect(201);
    return res.body.data;
  }

  /** Põe alguém no grupo (rota, idempotente). */
  const porMembro = (grupoId, userId) => supertest(app)
    .post(`/api/v1/access-groups/${grupoId}/members`)
    .set('Authorization', `Bearer ${tokens.admin}`)
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

  /** O que `quem` pode REPASSAR, segundo o mesmo payload (é o que liga o botão da UI). */
  async function camadasRepassaveis(quem) {
    const res = await supertest(app)
      .get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .expect(200);
    return res.body.data.shareable.dataLayers;
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    atores.admin = await createAdminUser(db, { username: `gg_admin_${sufixo}` });
    for (const nome of ['membro1', 'membro2', 'forasteiro', 'alvo1', 'alvo2']) {
      atores[nome] = await createUser(db, { username: `gg_${nome}_${sufixo}` });
    }
    for (const nome of ['admin', 'membro1', 'membro2', 'forasteiro', 'alvo1', 'alvo2']) {
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM data_layers WHERE id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM access_groups WHERE name LIKE $1', [`%${sufixo}%`]);
    await teardownTestEnv(db);
  });

  it('conceder a um GRUPO devolve 201 com `grantee_group_id` preenchido e `grantee_id` nulo', async () => {
    const layer = await novaCamada('basico');
    const grupo = await novoGrupo('basico');

    const res = await conceder('admin', layer, { granteeGroupId: grupo.id, grantLevel: 'view' })
      .expect(201);
    assert.equal(res.body.data.grantee_group_id, grupo.id);
    assert.equal(res.body.data.grantee_id, null, 'os dois alvos são ALTERNATIVOS, nunca simultâneos');
    assert.equal(res.body.data.grant_level, 'view');
    assert.equal(res.body.data.parent_grant_id, null, 'papel global concede de RAIZ');
  });

  it('o MEMBRO passa a ver o recurso privado, e o não-membro não', async () => {
    const layer = await novaCamada('visao');
    const grupo = await novoGrupo('visao');

    // O PISO: ninguém vê antes. Medir só o estado final não distingue "ganhou
    // acesso" de "sempre teve".
    assert.ok(!(await camadasVisiveis('membro1')).includes(layer), 'piso: o futuro membro não vê');
    assert.ok(!(await camadasVisiveis('forasteiro')).includes(layer), 'piso: o forasteiro não vê');

    await porMembro(grupo.id, atores.membro1.id);
    await conceder('admin', layer, { granteeGroupId: grupo.id, grantLevel: 'view' }).expect(201);

    assert.ok(
      (await camadasVisiveis('membro1')).includes(layer),
      'o membro enxerga o recurso pelo braço COLETIVO do predicado',
    );
    // A DISCRIMINAÇÃO: quem não está no grupo continua fora. Sem ela, um predicado
    // que passasse a devolver tudo a todos passaria neste arquivo.
    assert.ok(
      !(await camadasVisiveis('forasteiro')).includes(layer),
      'quem não é membro não herda nada',
    );

    // E entrar no grupo DEPOIS da concessão também abre: a resolução é por leitura,
    // não uma cópia feita no instante da concessão.
    await porMembro(grupo.id, atores.membro2.id);
    assert.ok((await camadasVisiveis('membro2')).includes(layer));
  });

  it('tirar a pessoa do grupo tira o acesso DELA; apagar o grupo tira o de TODOS', async () => {
    const layer = await novaCamada('revogacao');
    const grupo = await novoGrupo('revogacao');
    await porMembro(grupo.id, atores.membro1.id);
    await porMembro(grupo.id, atores.membro2.id);
    await conceder('admin', layer, { granteeGroupId: grupo.id, grantLevel: 'view' }).expect(201);

    assert.ok((await camadasVisiveis('membro1')).includes(layer), 'piso: membro1 vê');
    assert.ok((await camadasVisiveis('membro2')).includes(layer), 'piso: membro2 vê');

    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}/members/${atores.membro1.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);

    assert.ok(!(await camadasVisiveis('membro1')).includes(layer), 'quem saiu perde o acesso');
    assert.ok(
      (await camadasVisiveis('membro2')).includes(layer),
      'e quem ficou NÃO perde — a saída de um não é a revogação do grupo',
    );

    // APAGAR O GRUPO PODA (2026-08-20), e esta asserção INVERTEU. O argumento antigo
    // ("`fn_user_group_ids` exige `deleted_at IS NULL`, então apagado e não-concede-mais
    // são o MESMO fato") valia para os MEMBROS e não valia para o que eles repassaram:
    // essas linhas apontam para terceiros fora do grupo, o predicado não as alcança, e
    // elas sobreviviam penduradas numa concessão viva sem justificativa.
    const apagado = await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    assert.equal(apagado.body.data.grantsAffected, 1, 'a resposta diz o alcance do ato');

    assert.ok(!(await camadasVisiveis('membro2')).includes(layer), 'o último membro também perde');

    // A concessão continua na tabela — REVOGADA, com autor. É a resposta de auditoria
    // "por que o grupo X tinha acesso ao recurso Y", que continua preservada: o que
    // mudou é que agora ela é uma revogação explícita em vez de um acesso que só o
    // predicado silenciava.
    const { rows } = await db.query(
      'SELECT revoked_at, revoked_by FROM resource_grants WHERE resource_id = $1',
      [layer],
    );
    assert.equal(rows.length, 1);
    assert.ok(rows[0].revoked_at, 'a exclusão do grupo REVOGA a concessão que ele recebeu');
    assert.equal(rows[0].revoked_by, atores.admin.id, 'com o autor do ato');
  });

  it('`GET /:type/:id/grants` LISTA a concessão a grupo, com nome e contagem de membros', async () => {
    // ESTE É O CASO QUE A CORREÇÃO DO `LEFT JOIN` EXIGIU. A junção era
    // `JOIN users gu ON gu.id = g.grantee_id`, um INNER, e numa concessão a grupo o
    // `grantee_id` é NULL por CHECK: a linha inteira sumia. O sintoma é o pior
    // possível para uma tela de permissão — 201 na criação e a lista "quem tem
    // acesso" continuando sem mostrar ninguém, sem erro em lugar nenhum.
    const layer = await novaCamada('listagem');
    const grupo = await novoGrupo('listagem');
    await porMembro(grupo.id, atores.membro1.id);
    await porMembro(grupo.id, atores.membro2.id);

    await conceder('admin', layer, { granteeGroupId: grupo.id, grantLevel: 'view' }).expect(201);
    await conceder('admin', layer, { granteeId: atores.alvo1.id, grantLevel: 'view' }).expect(201);

    const res = await supertest(app)
      .get(`/api/v1/resource-access/data_layer/${layer}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    assert.equal(res.body.data.length, 2, 'as DUAS linhas: a coletiva e a pessoal');

    const coletiva = res.body.data.find((g) => g.grantee_group_id === grupo.id);
    assert.ok(coletiva, 'a concessão a grupo precisa APARECER na lista');
    assert.equal(coletiva.grantee_id, null);
    assert.equal(coletiva.grantee_group_name, grupo.name);
    assert.equal(coletiva.grantee_group_member_count, 2, 'a tela precisa da contagem');
    assert.equal(coletiva.granted_by_username, atores.admin.username);

    // A linha PESSOAL continua vindo inteira: o `LEFT JOIN` não perdeu o que o INNER
    // entregava.
    const pessoal = res.body.data.find((g) => g.grantee_id === atores.alvo1.id);
    assert.ok(pessoal, 'a concessão a pessoa continua na lista');
    assert.equal(pessoal.grantee_group_id, null);
    assert.equal(pessoal.grantee_username, atores.alvo1.username);
    assert.equal(pessoal.grantee_group_name, null);

    // GRUPO APAGADO SAI DA LISTA, porque ele já não concede a ninguém: mantê-lo faria
    // a tela chamada "quem tem acesso" listar quem não tem.
    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    const depois = await supertest(app)
      .get(`/api/v1/resource-access/data_layer/${layer}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    assert.equal(depois.body.data.length, 1, 'só a pessoal sobra');
    assert.equal(depois.body.data[0].grantee_id, atores.alvo1.id);
  });

  it('o corpo escolhe UM beneficiário: os dois juntos é 422, nenhum é 422, um só é 201', async () => {
    // O `xor` do Joi ESPELHA o `CHECK (num_nonnulls(grantee_id, grantee_group_id) = 1)`
    // da tabela. Sem ele o pedido malformado morreria no banco como 23514, que a borda
    // traduz num 400 genérico sem nome de campo, para um erro que é literalmente
    // "escolha um dos dois".
    const layer = await novaCamada('xor');
    const grupo = await novoGrupo('xor');

    await conceder('admin', layer, {
      granteeId: atores.alvo1.id, granteeGroupId: grupo.id, grantLevel: 'view',
    }).expect(422);

    await conceder('admin', layer, { grantLevel: 'view' }).expect(422);

    // As duas formas válidas, no mesmo corpo: sem elas o 422 acima seria
    // indistinguível de uma rota quebrada.
    await conceder('admin', layer, { granteeGroupId: grupo.id, grantLevel: 'view' }).expect(201);
    await conceder('admin', layer, { granteeId: atores.alvo1.id, grantLevel: 'view' }).expect(201);
  });

  it('escalonamento POR GRUPO: `view_share` coletivo repassa (e aparece em `shareable`); `view` coletivo não', async () => {
    // A DISTINÇÃO ENTRE OS DOIS NÍVEIS PRECISA VALER TAMBÉM PELO COLETIVO, senão a
    // concessão a grupo seria de segunda classe: quem recebeu `view_share` através de
    // um grupo veria o recurso (o predicado de LEITURA sempre teve o braço coletivo) e
    // não conseguiria repassá-lo, porque o gate se alimenta de `LIVE_GRANTS_OF_ACTOR`.
    const layer = await novaCamada('escala');
    // O `grupoShare` é DO MEMBRO1, e não do administrador, e a escolha é o que mantém
    // vivo o caso degenerado do fim deste corpo: conceder AO MESMO grupo de onde a
    // autoridade veio só é alcançável por quem pode ENDEREÇAR aquele grupo. Se ele
    // fosse do administrador, o membro1 levaria 404 antes de chegar ao 409, e a
    // asserção mediria a regra do coletivo próprio em vez do caso degenerado.
    const grupoShare = await novoGrupo('escala-share', 'membro1');
    const grupoView = await novoGrupo('escala-view');
    await porMembro(grupoShare.id, atores.membro1.id);
    await porMembro(grupoView.id, atores.membro2.id);

    const raiz = await conceder('admin', layer, {
      granteeGroupId: grupoShare.id, grantLevel: 'view_share',
    }).expect(201);
    await conceder('admin', layer, { granteeGroupId: grupoView.id, grantLevel: 'view' })
      .expect(201);

    // Os dois VEEM (o braço de leitura não distingue nível).
    assert.ok((await camadasVisiveis('membro1')).includes(layer), 'piso: membro1 vê');
    assert.ok((await camadasVisiveis('membro2')).includes(layer), 'piso: membro2 vê');

    // O BOTÃO DA INTERFACE: `shareable` é quem decide se a tela OFERECE "Compartilhar".
    // Uma permissão sem porta é indistinguível, na tela, de não ter a permissão.
    assert.ok(
      (await camadasRepassaveis('membro1')).includes(layer),
      '`shareable` precisa listar o recurso para quem recebeu `view_share` pelo grupo',
    );
    assert.ok(
      !(await camadasRepassaveis('membro2')).includes(layer),
      'e NÃO listar para quem recebeu só `view`',
    );

    const filho = await conceder('membro1', layer, {
      granteeId: atores.alvo2.id, grantLevel: 'view',
    }).expect(201);
    assert.equal(
      filho.body.data.parent_grant_id, raiz.body.data.id,
      'a concessão nova pendura na concessão DO GRUPO de onde a autoridade veio',
    );
    assert.ok((await camadasVisiveis('alvo2')).includes(layer), 'e o repasse tem efeito');

    // A DISCRIMINAÇÃO: `view` coletivo não repassa, que é a definição do nível.
    await conceder('membro2', layer, { granteeId: atores.alvo1.id, grantLevel: 'view' })
      .expect(403);
    assert.ok(!(await camadasVisiveis('alvo1')).includes(layer), 'o 403 é sem efeito');

    // O CASO DEGENERADO: conceder AO MESMO grupo de onde a própria autoridade veio.
    await conceder('membro1', layer, { granteeGroupId: grupoShare.id, grantLevel: 'view' })
      .expect(409);
  });

  it('conceder a um grupo APAGADO é 404 (a concessão nasceria morta)', async () => {
    const layer = await novaCamada('apagado');
    const grupo = await novoGrupo('apagado');
    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);

    // A FK aceitaria o grupo apagado, e a linha nasceria sem entregar acesso a
    // ninguém: `fn_user_group_ids` exige grupo VIVO. A tela mostraria um acesso
    // concedido que não existe.
    await conceder('admin', layer, { granteeGroupId: grupo.id, grantLevel: 'view' })
      .expect(404);
    // Id que nunca existiu: mesma resposta, pelo mesmo caminho.
    await conceder('admin', layer, { granteeGroupId: randomUUID(), grantLevel: 'view' })
      .expect(404);

    // A discriminação: um grupo VIVO passa na mesma chamada.
    const vivo = await novoGrupo('apagado-vivo');
    await conceder('admin', layer, { granteeGroupId: vivo.id, grantLevel: 'view' }).expect(201);
  });

  it('revogar a concessão a grupo derruba a SUBÁRVORE, como no caso de pessoa', async () => {
    const layer = await novaCamada('poda');
    const grupo = await novoGrupo('poda');
    await porMembro(grupo.id, atores.membro1.id);

    const raiz = await conceder('admin', layer, {
      granteeGroupId: grupo.id, grantLevel: 'view_share',
    }).expect(201);
    const filho = await conceder('membro1', layer, {
      granteeId: atores.alvo1.id, grantLevel: 'view_share',
    }).expect(201);
    const neto = await conceder('alvo1', layer, {
      granteeId: atores.alvo2.id, grantLevel: 'view',
    }).expect(201);
    assert.equal(filho.body.data.parent_grant_id, raiz.body.data.id);
    assert.equal(neto.body.data.parent_grant_id, filho.body.data.id);

    // Um ramo IRMÃO, pendurado numa raiz diferente: sem ele, uma poda que derrubasse
    // tudo passaria neste caso.
    const irma = await conceder('admin', layer, {
      granteeId: atores.forasteiro.id, grantLevel: 'view',
    }).expect(201);
    assert.notEqual(irma.body.data.id, raiz.body.data.id);

    for (const quem of ['membro1', 'alvo1', 'alvo2', 'forasteiro']) {
      assert.ok((await camadasVisiveis(quem)).includes(layer), `piso: ${quem} vê antes da poda`);
    }

    const res = await supertest(app)
      .delete(`/api/v1/resource-access/grants/${raiz.body.data.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    const derrubados = res.body.data.revoked.map((r) => r.id).sort();
    assert.deepEqual(
      derrubados,
      [raiz.body.data.id, filho.body.data.id, neto.body.data.id].sort(),
      'a poda alcança a raiz coletiva e os dois descendentes',
    );
    // A linha da raiz carrega o beneficiário COLETIVO, e não um `grantee_id` nulo sem
    // explicação: é o que responde "quem perdeu acesso" quando N pessoas caem juntas.
    const linhaRaiz = res.body.data.revoked.find((r) => r.id === raiz.body.data.id);
    assert.ok(linhaRaiz, 'a raiz precisa estar entre as derrubadas');
    assert.equal(linhaRaiz.grantee_group_id, grupo.id);
    assert.equal(linhaRaiz.grantee_id, null);

    for (const quem of ['membro1', 'alvo1', 'alvo2']) {
      assert.ok(!(await camadasVisiveis(quem)).includes(layer), `${quem} perde o acesso`);
    }
    assert.ok(
      (await camadasVisiveis('forasteiro')).includes(layer),
      'o ramo irmão sobrevive — a poda alcança a subárvore, e só ela',
    );
  });
});
