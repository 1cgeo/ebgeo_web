// Path: tests/integration/access-groups-crud.test.js
//
// O CICLO DE VIDA DO GRUPO DE ACESSO, E OS DOIS GATES QUE O MÓDULO TEM.
//
// O desenho de `access-groups.routes.js` é uma LINHA, não um gate só: `GET /` é
// `auth` sozinho (é o seletor de quem vai conceder, e quem tem `view_share` num
// recurso não é necessariamente administrador nem credenciado), e todo o resto é
// `requireGlobalDataAccess`. Fechar a listagem junto com a escrita, ou abrir a
// escrita junto com a listagem, quebra o produto em sentidos OPOSTOS, e nenhum dos
// dois erros aparece num teste que meça só um lado. Por isso cada 403 aqui vem com o
// 2xx do MESMO par no mesmo corpo: um 403 sozinho é indistinguível de fixture que
// não existe, de rota que sumiu e de gate que passou a negar tudo.
//
// O QUE ESTE ARQUIVO NÃO PRENDE: nada sobre concessão a grupo (o efeito de estar num
// grupo sobre o que se enxerga está em `resource-grants-grupo.test.js`) e nada sobre
// a trilha de auditoria (`access-groups-auditoria.test.js`). Aqui só o CRUD e quem
// pode chamá-lo.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, loginUser,
} from '../helpers/fixtures.js';

/** A OM semeada, usada como escopo de PRODUÇÃO do produtor (lotação não autoriza nada). */
const OM_PADRAO = '00000000-0000-0000-0000-000000000001';

describe('F16 — grupo de acesso: CRUD e os dois gates', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  let serie = 0;

  /** Um nome de grupo único dentro desta suíte (e entre suítes, pelo sufixo). */
  const nomeDeGrupo = (rotulo) => {
    serie += 1;
    return `Grupo ${rotulo} ${sufixo} ${serie}`;
  };

  /** POST /access-groups como `quem`. */
  const criar = (quem, name, description) => supertest(app)
    .post('/api/v1/access-groups')
    .set('Authorization', `Bearer ${tokens[quem]}`)
    .send(description === undefined ? { name } : { name, description });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    atores.admin = await createAdminUser(db, { username: `ag_admin_${sufixo}` });
    atores.credenciado = await createUser(db, {
      username: `ag_cred_${sufixo}`, role: 'credenciado',
    });
    atores.comum = await createUser(db, { username: `ag_comum_${sufixo}` });
    atores.produtor = await createProducerUser(db, OM_PADRAO, {
      username: `ag_prod_${sufixo}`,
    });
    atores.membro = await createUser(db, { username: `ag_membro_${sufixo}` });
    atores.forasteiro = await createUser(db, { username: `ag_fora_${sufixo}` });

    for (const nome of ['admin', 'credenciado', 'comum', 'produtor', 'membro', 'forasteiro']) {
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }
  });

  after(async () => {
    await db.query('DELETE FROM access_groups WHERE name LIKE $1', [`%${sufixo}%`]);
    await teardownTestEnv(db);
  });

  it('administrador E credenciado percorrem o ciclo inteiro (criar, renomear, listar, apagar)', async () => {
    // OS DOIS PASSAM PELO MESMO GATE (`requireGlobalDataAccess` = admin OU
    // credenciado), e o credenciado é o caso que ninguém espera: o papel é definido
    // como "lê todo recurso privado e NÃO ESCREVE NADA", e esta é a primeira escrita
    // dele. Medir só o administrador deixaria a exceção inteira sem guarda.
    const papeis = ['admin', 'credenciado'];
    assert.equal(papeis.length, 2, 'o gate tem DOIS titulares, e os dois são medidos');

    for (const quem of papeis) {
      const nome = nomeDeGrupo(quem);
      const criado = await criar(quem, nome, 'descrição inicial').expect(201);
      assert.equal(criado.body.data.name, nome);
      assert.equal(criado.body.data.created_by, atores[quem].id);

      const novoNome = `${nome} renomeado`;
      const renomeado = await supertest(app)
        .patch(`/api/v1/access-groups/${criado.body.data.id}`)
        .set('Authorization', `Bearer ${tokens[quem]}`)
        .send({ name: novoNome })
        .expect(200);
      assert.equal(renomeado.body.data.name, novoNome);

      const lista = await supertest(app)
        .get('/api/v1/access-groups')
        .set('Authorization', `Bearer ${tokens[quem]}`)
        .expect(200);
      const naLista = lista.body.data.find((g) => g.id === criado.body.data.id);
      assert.ok(naLista, 'o grupo criado precisa aparecer na listagem');
      assert.equal(naLista.name, novoNome, 'a listagem traz o nome NOVO');
      assert.equal(naLista.member_count, 0);
      assert.equal(naLista.grant_count, 0);

      const apagado = await supertest(app)
        .delete(`/api/v1/access-groups/${criado.body.data.id}`)
        .set('Authorization', `Bearer ${tokens[quem]}`)
        .expect(200);
      assert.equal(apagado.body.data.id, criado.body.data.id);
      assert.equal(apagado.body.data.grantsAffected, 0);

      const depois = await supertest(app)
        .get('/api/v1/access-groups')
        .set('Authorization', `Bearer ${tokens[quem]}`)
        .expect(200);
      assert.ok(
        !depois.body.data.some((g) => g.id === criado.body.data.id),
        'o grupo apagado sai da listagem (exclusão SOFT, leitura filtrada)',
      );
    }
  });

  it('`user` comum e `producer` levam 403 nas SEIS rotas fechadas, e o administrador passa nas mesmas', async () => {
    // O CENSO É A ASSERÇÃO. Medir uma rota só deixaria as outras cinco livres para
    // perder o gate sem nada ficar vermelho, e o módulo tem exatamente sete rotas:
    // seis fechadas mais o `GET /` do caso seguinte.
    const grupo = (await criar('admin', nomeDeGrupo('fechado')).expect(201)).body.data;

    const rotas = [
      { metodo: 'post', url: '/api/v1/access-groups', corpo: { name: nomeDeGrupo('viaGate') }, admin: 201 },
      { metodo: 'patch', url: `/api/v1/access-groups/${grupo.id}`, corpo: { name: nomeDeGrupo('renomeado') }, admin: 200 },
      { metodo: 'get', url: `/api/v1/access-groups/${grupo.id}/members`, corpo: null, admin: 200 },
      { metodo: 'post', url: `/api/v1/access-groups/${grupo.id}/members`, corpo: { userId: atores.membro.id }, admin: 200 },
      { metodo: 'delete', url: `/api/v1/access-groups/${grupo.id}/members/${atores.membro.id}`, corpo: null, admin: 200 },
      { metodo: 'delete', url: `/api/v1/access-groups/${grupo.id}`, corpo: null, admin: 200 },
    ];
    assert.equal(rotas.length, 6, 'as seis rotas sob `requireGlobalDataAccess`');

    const chamar = (quem, rota) => {
      const req = supertest(app)[rota.metodo](rota.url)
        .set('Authorization', `Bearer ${tokens[quem]}`);
      return rota.corpo ? req.send(rota.corpo) : req;
    };

    // Os dois papéis que NÃO passam. `producer` está aqui de propósito: ele é o papel
    // global cuja escrita existe (o acervo da OM dele), e um gate escrito como
    // `role !== 'user'` o promoveria junto com o credenciado sem ninguém notar.
    for (const rota of rotas) {
      await chamar('comum', rota).expect(403);
      await chamar('produtor', rota).expect(403);
    }

    // A DISCRIMINAÇÃO, na MESMA chamada: o administrador recebe 2xx onde os dois
    // acabaram de receber 403. A ordem é a do ciclo (pôr membro antes de tirá-lo,
    // apagar o grupo por último).
    for (const rota of rotas) {
      await chamar('admin', rota).expect(rota.admin);
    }
  });

  it('`GET /` é do usuário comum (é o seletor), e `GET /:id/members` não é', async () => {
    // ESTE PAR É O DESENHO DO MÓDULO. Quem tem `view_share` num recurso concede a um
    // grupo sem ser administrador nem credenciado, e sem LISTAR grupos ele não tem
    // como escolher um: o ramo de grupo do predicado voltaria a ser inalcançável pela
    // interface, que é o defeito que o módulo inteiro existe para fechar. Já a lista
    // de MEMBROS nomeia pessoas e fica do lado fechado.
    const grupo = (await criar('admin', nomeDeGrupo('seletor')).expect(201)).body.data;
    await supertest(app)
      .post(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ userId: atores.membro.id })
      .expect(200);

    const lista = await supertest(app)
      .get('/api/v1/access-groups')
      .set('Authorization', `Bearer ${tokens.comum}`)
      .expect(200);
    const visto = lista.body.data.find((g) => g.id === grupo.id);
    assert.ok(visto, 'o usuário comum precisa ENXERGAR o grupo para poder escolhê-lo');
    // E a listagem NÃO nomeia pessoa nenhuma: ela traz a contagem, que é o que a tela
    // do seletor exibe ("Estado-Maior (1)").
    assert.equal(visto.member_count, 1);
    assert.equal(Object.hasOwn(visto, 'members'), false, 'a listagem não carrega o roster');

    await supertest(app)
      .get(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .expect(403);

    const membros = await supertest(app)
      .get(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    assert.equal(membros.body.data.length, 1);
    assert.equal(membros.body.data[0].id, atores.membro.id);
    assert.equal(membros.body.data[0].username, atores.membro.username);

    // E sem token nenhum a listagem também não abre: `auth` sozinho continua sendo
    // `auth`, e "aberto ao usuário comum" não é "aberto ao anônimo".
    await supertest(app).get('/api/v1/access-groups').expect(401);
  });

  it('nome duplicado entre VIVOS é 409, e recriar depois de apagar volta a ser 201', async () => {
    // O ÍNDICE ÚNICO É PARCIAL (`WHERE deleted_at IS NULL`), e a segunda metade deste
    // caso é a que prova isso: sem o `WHERE`, um grupo apagado ocuparia o nome para
    // sempre, que é o beco de `catalog-soft-delete-resurrect.repro`.
    const nome = nomeDeGrupo('duplicado');
    const primeiro = (await criar('admin', nome).expect(201)).body.data;

    await criar('admin', nome).expect(409);
    // A colisão é sobre `LOWER(name)` e o nome é APARADO na borda: sem o `trim`, o
    // espaço à direita criaria dois grupos que a tela mostra com o mesmo nome.
    await criar('credenciado', `  ${nome.toUpperCase()}  `).expect(409);

    await supertest(app)
      .delete(`/api/v1/access-groups/${primeiro.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);

    const recriado = (await criar('admin', nome).expect(201)).body.data;
    assert.equal(recriado.name, nome);
    assert.notEqual(recriado.id, primeiro.id, 'é um grupo NOVO, não a ressurreição do antigo');

    // RENOMEAR PARA UM NOME TOMADO também colide, e por um caminho DIFERENTE: o
    // `UPDATE` não tem `ON CONFLICT`, então quem responde é o índice (23505), que o
    // `errorHandler` traduz em 409. As duas portas do mesmo nome único precisam dar a
    // mesma resposta, senão a tela mostra "conflito" numa e "erro do servidor" na
    // outra para a mesma causa.
    const outro = (await criar('admin', nomeDeGrupo('rival')).expect(201)).body.data;
    await supertest(app)
      .patch(`/api/v1/access-groups/${outro.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ name: nome })
      .expect(409);
    // E o rename para um nome LIVRE passa no mesmo corpo.
    await supertest(app)
      .patch(`/api/v1/access-groups/${outro.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ name: nomeDeGrupo('rival-livre') })
      .expect(200);
  });

  it('pôr membro é idempotente (`added:false` na segunda), e tirar quem não está é 404', async () => {
    const grupo = (await criar('admin', nomeDeGrupo('membros')).expect(201)).body.data;

    const primeira = await supertest(app)
      .post(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ userId: atores.membro.id })
      .expect(200);
    assert.equal(primeira.body.data.added, true, 'a primeira chamada CRIOU a linha');

    const segunda = await supertest(app)
      .post(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ userId: atores.membro.id })
      .expect(200);
    assert.equal(segunda.body.data.added, false, 'a segunda chegou ao MESMO estado, sem erro');

    // O estado é um só, e não dois: a PK `(group_id, user_id)` é quem garante.
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM access_group_members WHERE group_id = $1',
      [grupo.id],
    );
    assert.equal(rows[0].n, 1);

    // A ASSIMETRIA DELIBERADA: "pôr quem já está" chega ao estado pedido, "tirar quem
    // não está" quase sempre significa que o chamador aponta para o grupo errado.
    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}/members/${atores.forasteiro.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(404);

    // A discriminação do mesmo par: quem ESTÁ sai com 200.
    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}/members/${atores.membro.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);

    // E pôr um usuário que não existe é 404, não uma linha órfã.
    await supertest(app)
      .post(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ userId: randomUUID() })
      .expect(404);
  });

  it('PATCH vazio é 422; `description: null` LIMPA e um PATCH só de `name` PRESERVA', async () => {
    // "LIMPAR" E "NÃO MEXER" SÃO DOIS PEDIDOS DIFERENTES, e um `null` sozinho não os
    // distingue: quem os separa é `Object.hasOwn(req.body, 'description')`, carregado
    // até o `CASE WHEN $4` do SQL. Sem este caso, trocar aquele CASE por um COALESCE
    // deixaria a suíte verde e a descrição impossível de apagar.
    const grupo = (await criar('admin', nomeDeGrupo('descricao'), 'a descrição original').expect(201)).body.data;
    assert.equal(grupo.description, 'a descrição original');

    // PATCH vazio: uma escrita que audita uma mudança que não aconteceu.
    await supertest(app)
      .patch(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({})
      .expect(422);

    const soNome = await supertest(app)
      .patch(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ name: nomeDeGrupo('descricao-renomeado') })
      .expect(200);
    assert.equal(
      soNome.body.data.description, 'a descrição original',
      'ausência da chave é "não mexer"',
    );

    const limpo = await supertest(app)
      .patch(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ description: null })
      .expect(200);
    assert.equal(limpo.body.data.description, null, '`null` explícito é "limpar"');
    assert.equal(limpo.body.data.name, soNome.body.data.name, 'e o nome fica onde estava');

    // String vazia é o mesmo pedido de limpeza, vindo de um `<textarea>` esvaziado.
    await supertest(app)
      .patch(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ description: 'outra' })
      .expect(200);
    const vazia = await supertest(app)
      .patch(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ description: '' })
      .expect(200);
    assert.equal(vazia.body.data.description, null);
  });

  it('grupo apagado e id inexistente são 404 nas rotas que apontam para um grupo', async () => {
    const grupo = (await criar('admin', nomeDeGrupo('sumido')).expect(201)).body.data;
    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);

    // O grupo apagado é indistinguível de um que nunca existiu, porque TODA consulta
    // do módulo carrega `deleted_at IS NULL`.
    await supertest(app)
      .get(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(404);
    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(404);
    await supertest(app)
      .get(`/api/v1/access-groups/${randomUUID()}/members`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(404);

    // E um `:groupId` que não é UUID morre na BORDA (422), antes de qualquer cast.
    await supertest(app)
      .get('/api/v1/access-groups/nao-e-uuid/members')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(422);
  });
});
