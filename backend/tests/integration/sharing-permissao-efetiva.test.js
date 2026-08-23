// Path: tests/integration/sharing-permissao-efetiva.test.js
// O MODAL DE COMPARTILHAMENTO MOSTRA OS DOIS NÚMEROS: a LINHA daquela pessoa e o EFEITO
// que o servidor aplica. Até 2026-08-23 ele mostrava só a linha, e mentia.
//
// O ACESSO AO ATLAS RESOLVE PELO MAIOR NÍVEL entre o compartilhamento nominal e o de grupo
// (`fn_user_atlas_shares`, com o direto apenas desempatando) — é o princípio de caminhos
// independentes da constituição, aplicado ao eixo de atlas. A consequência mordia na tela:
// o gestor rebaixava alguém para leitura, o `<select>` passava a exibir "Leitura", e a
// pessoa continuava editando por um grupo daquele atlas. Uma permissão que a interface
// afirma e a autorização não honra é a forma mais cara de erro de permissão, porque o
// operador tem prova de que fez o certo.
//
// O QUE ESTE ARQUIVO PRENDE, e é o par inteiro: com excedente, a resposta carrega o nível
// efetivo e diz que ele vem de grupo; sem excedente, ela diz `direct` e os dois números
// coincidem. Sem a segunda metade, um servidor que carimbasse `group` em todo mundo
// passaria na primeira.
//
// O NOME DO GRUPO NÃO VIAJA, e isso também é asserido: a cláusula 5.3 dá ao gestor o dono
// de cada grupo, nunca a composição, e dizer QUAL grupo revelaria que aquela pessoa é
// membro dele.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createShare, loginUser,
  createAccessGroup, addAccessGroupMember, createGroupShare,
} from '../helpers/fixtures.js';

describe('sharing: a tela recebe a permissão EFETIVA, e não só a linha', () => {
  let app, db, atlas, dono, tokenDono;
  let comGrupo, semGrupo, grupo;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db);
    atlas = await createAtlas(db, dono.id);
    tokenDono = await loginUser(app, dono.username, dono.password);

    // OS DOIS SÃO GÊMEOS: mesma fábrica, mesmo share direto de LEITURA no mesmo atlas. A
    // única diferença é a participação no grupo, e é ela que o par mede.
    comGrupo = await createUser(db);
    semGrupo = await createUser(db);
    await createShare(db, atlas.id, comGrupo.id, 'read', dono.id);
    await createShare(db, atlas.id, semGrupo.id, 'read', dono.id);

    grupo = await createAccessGroup(db, dono.id, { name: 'Equipe de campo' });
    await addAccessGroupMember(db, grupo.id, comGrupo.id, dono.id);
    await createGroupShare(db, atlas.id, grupo.id, 'write', dono.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const config = async () => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sharing`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .expect(200);
    return res.body.data ?? res.body;
  };

  it('quem tem MAIS por um grupo aparece com o nível efetivo, marcado como de grupo', async () => {
    const cfg = await config();
    const linha = cfg.shares.find((s) => s.userId === comGrupo.id);
    assert.ok(linha, 'a pessoa com share direto tem de aparecer na lista');
    assert.equal(linha.permission, 'read', 'a LINHA continua sendo o que o select edita');
    assert.equal(linha.effectivePermission, 'write', 'e o EFEITO é o que o servidor aplica');
    assert.equal(linha.effectiveVia, 'group');
  });

  it('quem NÃO está no grupo tem os dois números iguais, e via `direct`', async () => {
    // Discriminação: sem esta metade, um servidor que carimbasse `group` em todo mundo
    // passaria no caso acima.
    const cfg = await config();
    const linha = cfg.shares.find((s) => s.userId === semGrupo.id);
    assert.ok(linha);
    assert.equal(linha.permission, 'read');
    assert.equal(linha.effectivePermission, 'read');
    assert.equal(linha.effectiveVia, 'direct');
  });

  it('o NOME do grupo não viaja na linha da pessoa', async () => {
    // Cláusula 5.3: o gestor vê o dono de cada grupo, nunca a composição. Nomear o grupo
    // aqui revelaria que aquela pessoa é membro dele.
    const cfg = await config();
    const linha = cfg.shares.find((s) => s.userId === comGrupo.id);
    assert.equal(
      JSON.stringify(linha).includes('Equipe de campo'), false,
      'a linha da pessoa não pode nomear o grupo que a sustenta',
    );
  });

  it('rebaixar a linha NÃO muda o efeito, e a resposta continua dizendo isso', async () => {
    // É o ato que produzia a mentira: o gestor rebaixa, a tela obedece, e o acesso fica.
    await supertest(app)
      .put(`/api/v1/atlas/${atlas.id}/sharing/users/${comGrupo.id}`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({ permission: 'read' })
      .expect((r) => assert.ok(r.status < 300, `rebaixamento recusado: ${r.status} ${r.text}`));

    const cfg = await config();
    const linha = cfg.shares.find((s) => s.userId === comGrupo.id);
    assert.equal(linha.permission, 'read');
    assert.equal(linha.effectivePermission, 'write', 'o grupo continua dando edição');
    assert.equal(linha.effectiveVia, 'group');
  });

  it('a lista de GRUPOS continua trazendo o dono, que é o que a cláusula 5.3 exige', async () => {
    const cfg = await config();
    const linha = cfg.groups.find((g) => g.groupId === grupo.id);
    assert.ok(linha, 'o grupo compartilhado aparece na sua seção');
    assert.equal(linha.permission, 'write');
    assert.equal(linha.ownerId, dono.id, 'o dono do grupo é nomeado');
  });
});
