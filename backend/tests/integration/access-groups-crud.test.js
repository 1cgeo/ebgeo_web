// Path: tests/integration/access-groups-crud.test.js
//
// O CICLO DE VIDA DO GRUPO DE ACESSO, E O EIXO QUE O GATEIA.
//
// O eixo mudou em 2026-08-20: era PAPEL GLOBAL DE DADO (administrador ou credenciado,
// por `requireGlobalDataAccess`) e passou a ser POSSE (o dono vivo, ou o administrador
// do sistema, por `fn_can_administer_group`). As consequências que este arquivo mede:
// criar é de qualquer sessão autenticada, escrever é de quem é dono, e a recusa é
// SEMPRE 404 — com a listagem recortada por posse, um 403 sobre grupo alheio contaria
// que aquele id existe.
//
// TODO NEGATIVO VEM COM O POSITIVO DO MESMO PAR, no mesmo corpo: um 404 sozinho é
// indistinguível de fixture que não existe, de rota que sumiu e de gate que passou a
// negar tudo.
//
// O QUE ESTE ARQUIVO NÃO PRENDE: a posse em si e a listagem recortada
// (`access-groups-dono.test.js`), a poda que a exclusão e a saída de membro disparam
// (`access-groups-exclusao-cascata.test.js`), o efeito da concessão coletiva sobre o
// que se enxerga (`resource-grants-grupo.test.js`) e a trilha
// (`access-groups-auditoria.test.js`). Aqui só o CRUD e quem pode chamá-lo.

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

describe('F16 — grupo de acesso: CRUD e o eixo de posse', () => {
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

  it('os QUATRO papéis globais percorrem o ciclo inteiro no PRÓPRIO grupo', async () => {
    // O CICLO DEIXOU DE SER PRIVILÉGIO. Antes o par medido eram os dois titulares do
    // papel global de dado; agora são os quatro papéis, porque criar e administrar o
    // que é seu não pergunta papel nenhum. O `producer` e o `comum` são os dois que
    // MUDARAM de resposta (eram 403 nas cinco rotas de escrita), e o `credenciado` é o
    // que continua passando por um motivo DIFERENTE do de antes: posse, não papel.
    const papeis = ['admin', 'credenciado', 'comum', 'produtor'];
    assert.equal(papeis.length, 4, 'os quatro papéis globais, e os quatro passam no que é deles');

    for (const quem of papeis) {
      const nome = nomeDeGrupo(quem);
      const criado = await criar(quem, nome, 'descrição inicial').expect(201);
      assert.equal(criado.body.data.name, nome);
      assert.equal(criado.body.data.created_by, atores[quem].id);
      assert.equal(
        criado.body.data.owner_id, atores[quem].id,
        'quem cria é o DONO, e o dono é coluna própria — não a promoção de `created_by`',
      );

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
      assert.ok(naLista, 'o grupo criado precisa aparecer na listagem do próprio dono');
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

  it('o DONO passa nas CINCO rotas apontadas; estranho, credenciado e produtor levam 404', async () => {
    // O CENSO É A ASSERÇÃO. Medir uma rota só deixaria as outras quatro livres para
    // perder o gate sem nada ficar vermelho. São CINCO e não seis: o `POST /` saiu do
    // lado fechado quando criar grupo virou ato de qualquer sessão autenticada, e ele
    // é medido no caso anterior.
    const grupo = (await criar('comum', nomeDeGrupo('doDono')).expect(201)).body.data;

    const rotas = [
      { metodo: 'patch', url: `/api/v1/access-groups/${grupo.id}`, corpo: { name: nomeDeGrupo('renomeado') }, dono: 200 },
      { metodo: 'get', url: `/api/v1/access-groups/${grupo.id}/members`, corpo: null, dono: 200 },
      { metodo: 'post', url: `/api/v1/access-groups/${grupo.id}/members`, corpo: { userId: atores.membro.id }, dono: 200 },
      { metodo: 'delete', url: `/api/v1/access-groups/${grupo.id}/members/${atores.membro.id}`, corpo: null, dono: 200 },
      { metodo: 'delete', url: `/api/v1/access-groups/${grupo.id}`, corpo: null, dono: 200 },
    ];
    assert.equal(rotas.length, 5, 'as cinco rotas sob `requireGroupAuthority`');

    const chamar = (quem, rota) => {
      const req = supertest(app)[rota.metodo](rota.url)
        .set('Authorization', `Bearer ${tokens[quem]}`);
      return rota.corpo ? req.send(rota.corpo) : req;
    };

    // OS TRÊS QUE NÃO PASSAM, e a resposta é 404 e não 403 nos três. O CREDENCIADO
    // está aqui como o controle que prova que a autoridade migrou de PAPEL para
    // POSSE: até 2026-08-19 ele passava nas seis. O `producer` continua fora pelo
    // motivo de sempre (ele mantém acervo, não compõe coletivo alheio).
    for (const rota of rotas) {
      await chamar('forasteiro', rota).expect(404);
      await chamar('credenciado', rota).expect(404);
      await chamar('produtor', rota).expect(404);
    }

    // A DISCRIMINAÇÃO, nas MESMAS chamadas: o dono recebe 2xx onde os três acabaram de
    // receber 404, e o administrador do sistema é o ramo curinga. A ordem é a do ciclo
    // (pôr membro antes de tirá-lo, apagar o grupo por último), então o administrador
    // é medido num grupo próprio logo abaixo para não competir pelo mesmo estado.
    for (const rota of rotas) {
      await chamar('comum', rota).expect(rota.dono);
    }

    const doComum = (await criar('comum', nomeDeGrupo('curinga')).expect(201)).body.data;
    await supertest(app)
      .patch(`/api/v1/access-groups/${doComum.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ name: nomeDeGrupo('curinga-admin') })
      .expect(200);
    await supertest(app)
      .get(`/api/v1/access-groups/${doComum.id}/members`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    await supertest(app)
      .delete(`/api/v1/access-groups/${doComum.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
  });

  it('`GET /` é recortado por posse, e `GET /:id/members` continua fechado', async () => {
    // O SELETOR DO MODAL DE COMPARTILHAR SE ALIMENTA DESTA LISTAGEM, e é por isso que
    // recortá-la é a metade VISÍVEL da regra do coletivo próprio: quem concede só vê
    // os grupos que pode endereçar. A outra metade (o id no corpo do POST) é medida em
    // `access-groups-dono.test.js`.
    const grupo = (await criar('comum', nomeDeGrupo('seletor')).expect(201)).body.data;
    await supertest(app)
      .post(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .send({ userId: atores.membro.id })
      .expect(200);

    const doDono = await supertest(app)
      .get('/api/v1/access-groups')
      .set('Authorization', `Bearer ${tokens.comum}`)
      .expect(200);
    const visto = doDono.body.data.find((g) => g.id === grupo.id);
    assert.ok(visto, 'o dono enxerga o próprio grupo');
    assert.equal(visto.member_count, 1);
    assert.equal(Object.hasOwn(visto, 'members'), false, 'a listagem não carrega o roster');

    // A DISCRIMINAÇÃO: o MEMBRO não vê o grupo nesta listagem (ele não o administra),
    // e o forasteiro também não. Sem o par, "a listagem devolve o grupo" seria
    // compatível com uma consulta que devolve tudo a todos.
    const doMembro = await supertest(app)
      .get('/api/v1/access-groups')
      .set('Authorization', `Bearer ${tokens.membro}`)
      .expect(200);
    assert.ok(
      !doMembro.body.data.some((g) => g.id === grupo.id),
      'participar de um grupo não é administrá-lo — esta listagem é a de gestão',
    );

    // E o roster continua do lado fechado: o membro não o lê.
    await supertest(app)
      .get(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.membro}`)
      .expect(404);

    const membros = await supertest(app)
      .get(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .expect(200);
    assert.equal(membros.body.data.length, 1);
    assert.equal(membros.body.data[0].id, atores.membro.id);
    assert.equal(membros.body.data[0].username, atores.membro.username);

    // E sem token nenhum nada abre: "aberto a toda sessão autenticada" não é "aberto
    // ao anônimo".
    await supertest(app).get('/api/v1/access-groups').expect(401);
    await supertest(app).get('/api/v1/access-groups/participating').expect(401);
    await supertest(app).post('/api/v1/access-groups').send({ name: nomeDeGrupo('anon') }).expect(401);
  });

  it('`GET /participating` mostra o grupo e o DONO, e NUNCA o roster', async () => {
    // A SEGUNDA SEÇÃO DA ABA GRUPOS (decisão do dono, 2026-08-20). Sem ela, quem foi
    // posto num grupo por outra pessoa não veria em lugar nenhum um mecanismo que
    // decide o acesso dele a recurso privado.
    const grupo = (await criar('comum', nomeDeGrupo('participo')).expect(201)).body.data;
    await supertest(app)
      .post(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .send({ userId: atores.membro.id })
      .expect(200);

    const doMembro = await supertest(app)
      .get('/api/v1/access-groups/participating')
      .set('Authorization', `Bearer ${tokens.membro}`)
      .expect(200);
    const linha = doMembro.body.data.find((g) => g.id === grupo.id);
    assert.ok(linha, 'o membro precisa VER que participa');
    assert.equal(linha.owner_username, atores.comum.username, 'e de QUEM é o grupo');
    assert.equal(Object.hasOwn(linha, 'members'), false);
    assert.equal(Object.hasOwn(linha, 'member_count'), false, 'nem o tamanho do coletivo');
    assert.equal(Object.hasOwn(linha, 'grant_count'), false, 'nem quantos recursos ele recebeu');

    // A DISCRIMINAÇÃO: quem NÃO é membro não vê a linha, e o DONO também não a vê
    // aqui (ele não é membro do próprio grupo — as duas seções não se sobrepõem).
    const doForasteiro = await supertest(app)
      .get('/api/v1/access-groups/participating')
      .set('Authorization', `Bearer ${tokens.forasteiro}`)
      .expect(200);
    assert.ok(!doForasteiro.body.data.some((g) => g.id === grupo.id));
    const doDono = await supertest(app)
      .get('/api/v1/access-groups/participating')
      .set('Authorization', `Bearer ${tokens.comum}`)
      .expect(200);
    assert.ok(
      !doDono.body.data.some((g) => g.id === grupo.id),
      'ser dono não é participar: as duas seções respondem perguntas diferentes',
    );

    // E sair do grupo tira a linha — a lista é resolvida por leitura, não uma cópia.
    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}/members/${atores.membro.id}`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .expect(200);
    const depois = await supertest(app)
      .get('/api/v1/access-groups/participating')
      .set('Authorization', `Bearer ${tokens.membro}`)
      .expect(200);
    assert.ok(!depois.body.data.some((g) => g.id === grupo.id));
  });

  it('nome duplicado é POR DONO: 409 para o mesmo, 201 para outro, e recriar volta a passar', async () => {
    // O ÍNDICE ÚNICO É PARCIAL (`WHERE deleted_at IS NULL`) e passou a ser por DONO. A
    // metade "outro dono repete o nome" é a que mudou: antes era 409 sobre um grupo
    // que o chamador não podia ver, que é recusa e vazamento na mesma resposta.
    const nome = nomeDeGrupo('duplicado');
    const primeiro = (await criar('comum', nome).expect(201)).body.data;

    await criar('comum', nome).expect(409);
    // A colisão é sobre `LOWER(name)` e o nome é APARADO na borda: sem o `trim`, o
    // espaço à direita criaria dois grupos que a tela mostra com o mesmo nome.
    await criar('comum', `  ${nome.toUpperCase()}  `).expect(409);

    // A DISCRIMINAÇÃO: OUTRO dono cria o MESMO nome e passa.
    const doOutro = (await criar('forasteiro', nome).expect(201)).body.data;
    assert.notEqual(doOutro.id, primeiro.id);
    assert.equal(doOutro.owner_id, atores.forasteiro.id);

    await supertest(app)
      .delete(`/api/v1/access-groups/${primeiro.id}`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .expect(200);

    const recriado = (await criar('comum', nome).expect(201)).body.data;
    assert.equal(recriado.name, nome);
    assert.notEqual(recriado.id, primeiro.id, 'é um grupo NOVO, não a ressurreição do antigo');

    // RENOMEAR PARA UM NOME TOMADO também colide, e por um caminho DIFERENTE: o
    // `UPDATE` não tem `ON CONFLICT`, então quem responde é o índice (23505), que o
    // `errorHandler` traduz em 409. As duas portas do mesmo nome único precisam dar a
    // mesma resposta, senão a tela mostra "conflito" numa e "erro do servidor" na
    // outra para a mesma causa.
    const outro = (await criar('comum', nomeDeGrupo('rival')).expect(201)).body.data;
    await supertest(app)
      .patch(`/api/v1/access-groups/${outro.id}`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .send({ name: nome })
      .expect(409);
    // E o rename para um nome LIVRE passa no mesmo corpo.
    await supertest(app)
      .patch(`/api/v1/access-groups/${outro.id}`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .send({ name: nomeDeGrupo('rival-livre') })
      .expect(200);
  });

  it('pôr membro é idempotente (`added:false` na segunda), e tirar quem não está é 404', async () => {
    const grupo = (await criar('comum', nomeDeGrupo('membros')).expect(201)).body.data;

    const primeira = await supertest(app)
      .post(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .send({ userId: atores.membro.id })
      .expect(200);
    assert.equal(primeira.body.data.added, true, 'a primeira chamada CRIOU a linha');

    const segunda = await supertest(app)
      .post(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.comum}`)
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
      .set('Authorization', `Bearer ${tokens.comum}`)
      .expect(404);

    // A discriminação do mesmo par: quem ESTÁ sai com 200.
    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}/members/${atores.membro.id}`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .expect(200);

    // E pôr um usuário que não existe é 404, não uma linha órfã.
    await supertest(app)
      .post(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .send({ userId: randomUUID() })
      .expect(404);
  });

  it('PATCH vazio é 422; `description: null` LIMPA e um PATCH só de `name` PRESERVA', async () => {
    // "LIMPAR" E "NÃO MEXER" SÃO DOIS PEDIDOS DIFERENTES, e um `null` sozinho não os
    // distingue: quem os separa é `Object.hasOwn(req.body, 'description')`, carregado
    // até o `CASE WHEN $4` do SQL. Sem este caso, trocar aquele CASE por um COALESCE
    // deixaria a suíte verde e a descrição impossível de apagar.
    const grupo = (await criar('comum', nomeDeGrupo('descricao'), 'a descrição original').expect(201)).body.data;
    assert.equal(grupo.description, 'a descrição original');

    // PATCH vazio: uma escrita que audita uma mudança que não aconteceu. Ele é 422
    // DEPOIS do gate de autoridade, que é a ordem que a rota declara.
    await supertest(app)
      .patch(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .send({})
      .expect(422);

    const soNome = await supertest(app)
      .patch(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .send({ name: nomeDeGrupo('descricao-renomeado') })
      .expect(200);
    assert.equal(
      soNome.body.data.description, 'a descrição original',
      'ausência da chave é "não mexer"',
    );

    const limpo = await supertest(app)
      .patch(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .send({ description: null })
      .expect(200);
    assert.equal(limpo.body.data.description, null, '`null` explícito é "limpar"');
    assert.equal(limpo.body.data.name, soNome.body.data.name, 'e o nome fica onde estava');

    // String vazia é o mesmo pedido de limpeza, vindo de um `<textarea>` esvaziado.
    await supertest(app)
      .patch(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .send({ description: 'outra' })
      .expect(200);
    const vazia = await supertest(app)
      .patch(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .send({ description: '' })
      .expect(200);
    assert.equal(vazia.body.data.description, null);
  });

  it('grupo apagado e id inexistente são 404; `:groupId` não-UUID morre na BORDA', async () => {
    const grupo = (await criar('comum', nomeDeGrupo('sumido')).expect(201)).body.data;
    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .expect(200);

    // O grupo apagado é indistinguível de um que nunca existiu, e agora também de um
    // que é de outra pessoa: as três causas dão a MESMA resposta.
    await supertest(app)
      .get(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .expect(404);
    await supertest(app)
      .delete(`/api/v1/access-groups/${grupo.id}`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .expect(404);
    await supertest(app)
      .get(`/api/v1/access-groups/${randomUUID()}/members`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(404);

    // A ORDEM DOS MIDDLEWARES É CONTRATO, e este é o caso que a prende: um `:groupId`
    // que não é UUID morre em 422 na borda, ANTES do gate — se o gate rodasse
    // primeiro, o valor chegaria a um cast `::uuid` e sairia como erro de servidor.
    await supertest(app)
      .get('/api/v1/access-groups/nao-e-uuid/members')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(422);
    // E a metade oposta da mesma ordem: com params VÁLIDOS e corpo inválido, o grupo
    // ALHEIO responde 404 (o gate rodou antes do `validate({ body })`), nunca 422.
    const doOutro = (await criar('forasteiro', nomeDeGrupo('ordem')).expect(201)).body.data;
    await supertest(app)
      .patch(`/api/v1/access-groups/${doOutro.id}`)
      .set('Authorization', `Bearer ${tokens.comum}`)
      .send({ name: 'x' })
      .expect(404);
    // A discriminação: o DONO daquele grupo, com o MESMO corpo inválido, leva 422.
    await supertest(app)
      .patch(`/api/v1/access-groups/${doOutro.id}`)
      .set('Authorization', `Bearer ${tokens.forasteiro}`)
      .send({ name: 'x' })
      .expect(422);
  });
});
