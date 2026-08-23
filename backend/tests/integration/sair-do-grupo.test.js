// Path: tests/integration/sair-do-grupo.test.js
//
// SAIR DE UM GRUPO DE ACESSO POR CONTA PRÓPRIA —
// `DELETE /api/v1/access-groups/:groupId/members/me` (decisão do dono, 2026-08-23).
//
// O QUE NÃO EXISTIA: `DELETE /:groupId/members/:userId` passa por `requireGroupAuthority`, que
// responde 404 ao PRÓPRIO membro — ele não administra o grupo. Quem foi posto num coletivo por
// outra pessoa não tinha como sair dele, e a composição decide o acesso dele a recurso privado e a
// atlas. A cláusula 4.5 já dizia que esse mecanismo não pode ser invisível para quem está dentro;
// sair é a metade que faltava.
//
// AS QUATRO PROPRIEDADES QUE SÓ FALHAM AQUI:
//
// 1. A ORDEM DAS ROTAS. `/me` precisa ser declarada ANTES de `/:userId`, senão Express casa a
//    segunda com `userId = 'me'` e o `validate({ params })` dela responde 422 falando de UUID. É
//    um defeito cujo sintoma não aponta para ordem nenhuma, e o caso do 422 aqui é o que o prende.
// 2. O DONO NÃO SAI. `fn_can_administer_group` tem dois ramos, posse VIVA e administrador do
//    sistema, e `fn_user_group_ids` exige `fn_principal_vivo(owner)`: um grupo cujo dono se
//    retirasse ficaria sem administrador e sem alcance. 409, com o caminho nomeado.
// 3. A PODA É A MESMA da saída por terceiro, e é por isso que as duas passam pelo mesmo corpo
//    (`retirarMembro`): o repasse feito ATRAVÉS do grupo cai, e o feito por autoridade PRÓPRIA
//    sobrevive (cláusula 3.7, `resgatarRaiz`). Uma segunda definição divergiria no primeiro
//    conserto, e o sintoma seria acesso órfão.
// 4. IDEMPOTÊNCIA SEM ORÁCULO. Não participar e o grupo não existir respondem a mesma coisa: 200
//    com `removed: false`. O 404 uniforme deste módulo existe para que o invisível seja
//    indistinguível do inexistente, e uma rota que os distinguisse aqui devolveria por outra porta
//    o oráculo de inventário que ele nega.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, loginUser } from '../helpers/fixtures.js';

describe('sair do grupo · DELETE /:groupId/members/me', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  let serie = 0;

  const sair = (quem, grupoId) => supertest(app)
    .delete(`/api/v1/access-groups/${grupoId}/members/me`)
    .set('Authorization', `Bearer ${tokens[quem]}`);

  async function novoGrupo(quem, rotulo) {
    serie += 1;
    const res = await supertest(app)
      .post('/api/v1/access-groups')
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .send({ name: `Sair ${rotulo} ${sufixo} ${serie}` })
      .expect(201);
    return res.body.data;
  }

  async function novaCamada(rotulo) {
    serie += 1;
    const id = `sag-${rotulo}-${sufixo}-${serie}`;
    await db.query(
      `INSERT INTO data_layers (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [id, `Camada ${id}`]
    );
    return id;
  }

  const porMembro = (quem, grupoId, userId) => supertest(app)
    .post(`/api/v1/access-groups/${grupoId}/members`)
    .set('Authorization', `Bearer ${tokens[quem]}`)
    .send({ userId })
    .expect(200);

  const conceder = (quem, layer, corpo) => supertest(app)
    .post(`/api/v1/resource-access/data_layer/${layer}/grants`)
    .set('Authorization', `Bearer ${tokens[quem]}`)
    .send(corpo);

  async function camadasVisiveis(quem) {
    const res = await supertest(app)
      .get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .expect(200);
    return res.body.data.dataLayers.map((l) => l.id);
  }

  const contarComposicao = async (grupoId, userId) => {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM access_group_members WHERE group_id = $1 AND user_id = $2',
      [grupoId, userId]
    );
    return rows[0].n;
  };

  const trilhaDeSaida = async (grupoId) => {
    const { rows } = await db.query(
      `SELECT actor_id, details FROM audit_trail
        WHERE action = 'ACCESS_GROUP_MEMBER_REMOVE' AND target_id = $1
        ORDER BY created_at, id`,
      [grupoId]
    );
    return rows;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    atores.admin = await createAdminUser(db, { username: `sag_admin_${sufixo}` });
    for (const nome of ['dono', 'membro', 'outro', 'terceiro', 'forasteiro', 'estranho']) {
      atores[nome] = await createUser(db, { username: `sag_${nome}_${sufixo}` });
    }
    for (const nome of Object.keys(atores)) {
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM data_layers WHERE id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM access_groups WHERE name LIKE $1', [`%${sufixo}%`]);
    await teardownTestEnv(db);
  });

  it('o membro sai sozinho, e a composição perde a linha dele', async () => {
    const grupo = await novoGrupo('dono', 'basico');
    await porMembro('dono', grupo.id, atores.membro.id);
    await porMembro('dono', grupo.id, atores.outro.id);
    assert.equal(await contarComposicao(grupo.id, atores.membro.id), 1, 'piso: ele está dentro');

    const res = await sair('membro', grupo.id).expect(200);
    assert.equal(res.body.data.removed, true);
    assert.equal(res.body.data.groupId, grupo.id);
    assert.equal(res.body.data.userId, atores.membro.id);
    assert.equal(res.body.data.grantsAffected, 0, 'ele não repassou nada por este grupo');
    assert.equal(await contarComposicao(grupo.id, atores.membro.id), 0);
    // DISCRIMINAÇÃO: quem ficou continua dentro. Sem ela, um DELETE que esvaziasse o grupo
    // passaria neste caso do mesmo jeito.
    assert.equal(await contarComposicao(grupo.id, atores.outro.id), 1);

    const trilha = await trilhaDeSaida(grupo.id);
    assert.equal(trilha.length, 1);
    assert.equal(trilha[0].actor_id, atores.membro.id, 'quem decidiu foi ele');
    assert.equal(trilha[0].details.self, true);
    assert.equal(trilha[0].details.userId, atores.membro.id);
  });

  it('a remoção POR TERCEIRO continua sem `self` — é dela que a saída se distingue', async () => {
    const grupo = await novoGrupo('dono', 'terceiro');
    await porMembro('dono', grupo.id, atores.membro.id);

    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}/members/${atores.membro.id}`)
      .set('Authorization', `Bearer ${tokens.dono}`)
      .expect(200);

    const trilha = await trilhaDeSaida(grupo.id);
    assert.equal(trilha.length, 1);
    assert.equal(trilha[0].actor_id, atores.dono.id);
    assert.equal(trilha[0].details.self, undefined, '`self` ausente é o que distingue os dois');
  });

  it('o DONO leva 409, e continua administrando o grupo', async () => {
    const grupo = await novoGrupo('dono', 'donoRecusado');
    await porMembro('dono', grupo.id, atores.membro.id);

    const res = await sair('dono', grupo.id).expect(409);
    assert.match(res.body.error?.message ?? '', /apague o grupo, ou transfira a posse/i,
      'a recusa precisa nomear a saída');

    // NADA foi escrito, e o grupo continua vivo e administrável por ele.
    assert.equal(await contarComposicao(grupo.id, atores.membro.id), 1);
    assert.deepEqual(await trilhaDeSaida(grupo.id), [], 'a recusa não deixa rastro');
    await supertest(app)
      .get(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.dono}`)
      .expect(200);
  });

  it('o dono que também está na composição continua se tirando pela rota administrativa', async () => {
    // O 409 ACIMA NÃO PRENDE NINGUÉM, e este caso é o que impede a recusa de virar uma armadilha:
    // posse e composição são coisas diferentes, e a linha de composição do próprio dono sai pela
    // porta que ele já tem.
    const grupo = await novoGrupo('dono', 'donoMembro');
    await porMembro('dono', grupo.id, atores.dono.id);
    assert.equal(await contarComposicao(grupo.id, atores.dono.id), 1, 'piso: ele se pôs dentro');

    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}/members/${atores.dono.id}`)
      .set('Authorization', `Bearer ${tokens.dono}`)
      .expect(200);
    assert.equal(await contarComposicao(grupo.id, atores.dono.id), 0);
  });

  it('sair duas vezes é 200 com `removed: false`, e não grava trilha nova', async () => {
    const grupo = await novoGrupo('dono', 'idempotente');
    await porMembro('dono', grupo.id, atores.membro.id);

    assert.equal((await sair('membro', grupo.id).expect(200)).body.data.removed, true);
    const segunda = await sair('membro', grupo.id).expect(200);
    assert.equal(segunda.body.data.removed, false, 'sair de onde não se está não é erro');
    assert.equal(segunda.body.data.grantsAffected, 0);
    assert.equal((await trilhaDeSaida(grupo.id)).length, 1, 'a repetição não é um evento');
  });

  it('grupo inexistente responde IGUAL a "não participo" (nenhum oráculo de inventário)', async () => {
    const inexistente = randomUUID();
    const alheio = await novoGrupo('dono', 'alheio');

    const a = await sair('estranho', inexistente).expect(200);
    const b = await sair('estranho', alheio.id).expect(200);
    assert.equal(a.body.data.removed, false);
    assert.equal(b.body.data.removed, false);
    assert.deepEqual(
      Object.keys(a.body.data).sort(), Object.keys(b.body.data).sort(),
      'as duas respostas precisam ser indistinguíveis na forma, não só no status'
    );
    // E o estranho continua sem enxergar o grupo alheio: sair não é uma porta de leitura.
    await supertest(app)
      .get(`/api/v1/access-groups/${alheio.id}/members`)
      .set('Authorization', `Bearer ${tokens.estranho}`)
      .expect(404);
  });

  it('`:groupId` malformado morre na borda (422)', async () => {
    await sair('membro', 'nao-e-uuid').expect(422);
  });

  it('sem token, 401', async () => {
    const grupo = await novoGrupo('dono', 'semToken');
    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}/members/me`)
      .expect(401);
  });

  it('a saída PODA o que ele repassou pelo grupo e PRESERVA o que veio de caminho próprio', async () => {
    const layer = await novaCamada('poda');
    const outraLayer = await novaCamada('propria');
    const grupo = await novoGrupo('dono', 'poda');
    await porMembro('dono', grupo.id, atores.membro.id);
    await porMembro('dono', grupo.id, atores.outro.id);

    const coletiva = (await conceder('admin', layer, {
      granteeGroupId: grupo.id, grantLevel: 'view_share',
    }).expect(201)).body.data;
    await conceder('admin', outraLayer, {
      granteeId: atores.membro.id, grantLevel: 'view_share',
    }).expect(201);

    const peloGrupo = (await conceder('membro', layer, {
      granteeId: atores.terceiro.id, grantLevel: 'view',
    }).expect(201)).body.data;
    assert.equal(peloGrupo.parent_grant_id, coletiva.id, 'piso: o repasse pendura no coletivo');
    const porCaminhoProprio = (await conceder('membro', outraLayer, {
      granteeId: atores.forasteiro.id, grantLevel: 'view',
    }).expect(201)).body.data;

    assert.ok((await camadasVisiveis('membro')).includes(layer), 'piso: o membro vê pelo grupo');
    assert.ok((await camadasVisiveis('terceiro')).includes(layer), 'piso: o terceiro vê');
    assert.ok((await camadasVisiveis('forasteiro')).includes(outraLayer), 'piso: o forasteiro vê');

    const res = await sair('membro', grupo.id).expect(200);
    assert.equal(res.body.data.grantsAffected, 1, 'a resposta diz quantas concessões caíram');

    assert.equal(
      (await camadasVisiveis('membro')).includes(layer), false,
      'quem saiu perde o acesso que o grupo dava'
    );
    assert.equal(
      (await camadasVisiveis('terceiro')).includes(layer), false,
      'e o que ele alimentou PELO grupo cai junto — senão é acesso órfão'
    );
    // AS DUAS DISCRIMINAÇÕES: quem ficou não perde nada, e o repasse por autoridade PRÓPRIA
    // sobrevive. Sem elas, uma poda que derrubasse tudo passaria neste caso do mesmo jeito.
    assert.ok(
      (await camadasVisiveis('outro')).includes(layer),
      'quem ficou no grupo continua vendo: a saída de um não é a revogação do coletivo'
    );
    assert.ok(
      (await camadasVisiveis('forasteiro')).includes(outraLayer),
      'e o repasse feito por caminho próprio não é alcançado'
    );
    const { rows: viva } = await db.query(
      'SELECT id FROM resource_grants WHERE id = $1 AND revoked_at IS NULL',
      [porCaminhoProprio.id]
    );
    assert.equal(viva.length, 1, 'a linha que não podia cair continua viva');

    const trilha = await trilhaDeSaida(grupo.id);
    assert.equal(trilha.length, 1);
    assert.equal(trilha[0].details.grantsAffected, 1);
    assert.equal(trilha[0].details.self, true);
  });

  it('sair do grupo tira também o alcance ao ATLAS que o grupo entregava', async () => {
    // O SEGUNDO EIXO DO GRUPO (D2): ele não passa por poda nenhuma e cai por PREDICADO
    // (`fn_user_group_ids` dentro de `fn_user_atlas_shares`). Sem este caso, a saída pareceria
    // resolvida medindo só o eixo de recurso.
    const grupo = await novoGrupo('dono', 'atlas');
    await porMembro('dono', grupo.id, atores.membro.id);
    const atlas = await createAtlas(db, atores.dono.id, { name: `Sair atlas ${sufixo}` });
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sharing/groups`)
      .set('Authorization', `Bearer ${tokens.dono}`)
      .send({ groupId: grupo.id, permission: 'write' })
      .expect(201);

    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${tokens.membro}`)
      .expect(200);

    await sair('membro', grupo.id).expect(200);

    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${tokens.membro}`)
      .expect(404);
    // DISCRIMINAÇÃO: o vínculo do grupo com o atlas continua de pé — o que saiu foi a pessoa.
    const { rows } = await db.query(
      'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND group_id = $2',
      [atlas.id, grupo.id]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].permission, 'write');
  });
});
