// Path: tests/integration/sharing-grupo-rotas.test.js
//
// AS TRÊS ROTAS DE ESCRITA DO EIXO DE GRUPO, a trilha que elas emitem, e o payload de
// `GET /sharing` depois que ele passou a ter dois arrays.
//
// TRÊS COISAS QUE SÓ FALHAM AQUI:
//
// 1. A TRILHA. As três ações (`PERMISSION_GRANT`, `SHARING_CHANGE`, `PERMISSION_REVOKE`)
//    estavam reservadas no CHECK de `audit_trail` desde o primeiro dia e ficaram anos sem
//    emissor — o defeito que `sharing-audit.repro` documenta. Reusá-las no eixo novo só é
//    honesto se alguém contar as linhas.
// 2. SÓ GRUPO PRÓPRIO (decisão do dono, 2026-08-20). É a mitigação que tira a amplificação
//    de autoridade da invisibilidade, e sem um caso que ISOLE a variável (mesmo atlas,
//    mesmo grupo, mesmo nível de atlas, posse diferente) o 403/404 mediria a rota quebrada
//    tão bem quanto o gate funcionando.
// 3. O `FILTER` de `shares`. Ele olhava para `s.id` — "existe linha?" — o que era a mesma
//    pergunta enquanto toda linha tinha pessoa. Com o alvo coletivo, cada linha de grupo
//    entraria no array de MEMBROS como uma pessoa de nome nulo.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createShare, loginUser,
  createAccessGroup, addAccessGroupMember, createGroupShare,
} from '../helpers/fixtures.js';

const U = () => `sgr_${randomUUID().slice(0, 8)}`;

describe('sharing · rotas do eixo de GRUPO', () => {
  let app, db, dono, donoTok, coGestor, coGestorTok, editor, editorTok, membro;

  const como = (tok, metodo, url) =>
    supertest(app)[metodo](url).set('Authorization', `Bearer ${tok}`);

  const contarTrilha = async (atlasId, action = null) => {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM audit_trail
        WHERE target_type = 'ATLAS' AND target_id = $1
          ${action ? 'AND action = $2' : ''}`,
      action ? [atlasId, action] : [atlasId]
    );
    return rows[0].n;
  };

  const ultimaTrilha = async (atlasId, action) => {
    const { rows } = await db.query(
      `SELECT action, actor_id, details FROM audit_trail
        WHERE target_type = 'ATLAS' AND target_id = $1 AND action = $2
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [atlasId, action]
    );
    return rows[0] ?? null;
  };

  const contarShares = async (atlasId) => {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM atlas_shares WHERE atlas_id = $1', [atlasId]
    );
    return rows[0].n;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db, { username: U(), nome: 'Dona' });
    donoTok = await loginUser(app, dono.username, dono.password);
    coGestor = await createUser(db, { username: U(), nome: 'Co Gestor' });
    coGestorTok = await loginUser(app, coGestor.username, coGestor.password);
    editor = await createUser(db, { username: U(), nome: 'Editor' });
    editorTok = await loginUser(app, editor.username, editor.password);
    membro = await createUser(db, { username: U(), nome: 'Membro' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Atlas do `dono`, com o co-Gestor em `manage` e o editor em `write`. */
  async function cenario() {
    const atlas = await createAtlas(db, dono.id, { name: `SGR ${U()}` });
    await createMap(db, atlas.id);
    await createShare(db, atlas.id, coGestor.id, 'manage', dono.id);
    await createShare(db, atlas.id, editor.id, 'write', dono.id);
    return atlas;
  }

  // ==========================================================================
  it('POST/PUT/DELETE /sharing/groups: 201/200/204, cada um com UMA linha de trilha', async () => {
    const atlas = await cenario();
    const g = await createAccessGroup(db, dono.id, { name: `Alfa ${U()}` });

    // ---- POST
    const antesGrant = await contarTrilha(atlas.id, 'PERMISSION_GRANT');
    const criado = await como(donoTok, 'post', `/api/v1/atlas/${atlas.id}/sharing/groups`)
      .send({ groupId: g.id, permission: 'write' })
      .expect(201);
    assert.equal(criado.body.data.group_id, g.id);
    assert.equal(criado.body.data.permission, 'write');
    assert.equal(criado.body.data.user_id, null, 'linha de grupo não carrega pessoa');
    assert.equal(await contarTrilha(atlas.id, 'PERMISSION_GRANT'), antesGrant + 1);
    const grant = await ultimaTrilha(atlas.id, 'PERMISSION_GRANT');
    assert.equal(grant.details.groupId, g.id, 'é o `groupId` que discrimina o eixo na trilha');
    assert.equal(grant.details.permission, 'write');
    assert.equal(grant.actor_id, dono.id);

    // ---- PUT
    const antesChange = await contarTrilha(atlas.id, 'SHARING_CHANGE');
    const atualizado = await como(donoTok, 'put', `/api/v1/atlas/${atlas.id}/sharing/groups/${g.id}`)
      .send({ permission: 'manage' })
      .expect(200);
    assert.equal(atualizado.body.data.permission, 'manage');
    assert.equal(await contarTrilha(atlas.id, 'SHARING_CHANGE'), antesChange + 1);
    const change = await ultimaTrilha(atlas.id, 'SHARING_CHANGE');
    assert.equal(change.details.groupId, g.id);
    assert.equal(change.details.previousPermission, 'write', 'a trilha diz de ONDE veio');
    assert.equal(change.details.permission, 'manage');

    // ---- DELETE
    const antesRevoke = await contarTrilha(atlas.id, 'PERMISSION_REVOKE');
    await como(donoTok, 'delete', `/api/v1/atlas/${atlas.id}/sharing/groups/${g.id}`).expect(204);
    assert.equal(await contarTrilha(atlas.id, 'PERMISSION_REVOKE'), antesRevoke + 1);
    const revoke = await ultimaTrilha(atlas.id, 'PERMISSION_REVOKE');
    assert.equal(revoke.details.groupId, g.id);
    // O NOME TAMBÉM, e não por simetria: o grupo pode ser apagado depois, e um UUID que
    // resolve para linha morta é o ponto em que a trilha para de responder a pergunta que
    // ela existe para responder. As outras duas ações já gravavam `groupName`.
    assert.equal(revoke.details.groupName, g.name);
  });

  it('a trilha de revogar NOMEIA até o grupo já apagado — que é quando o nome importa', async () => {
    const atlas = await cenario();
    const g = await createAccessGroup(db, dono.id, { name: `Extinto ${U()}` });
    await createGroupShare(db, atlas.id, g.id, 'write', dono.id);
    await db.query('UPDATE access_groups SET deleted_at = NOW() WHERE id = $1', [g.id]);

    // Tirar do atlas o vínculo de um grupo já apagado é limpeza legítima: o `DELETE` não
    // consulta o grupo e continua respondendo 204.
    await como(donoTok, 'delete', `/api/v1/atlas/${atlas.id}/sharing/groups/${g.id}`).expect(204);

    const revoke = await ultimaTrilha(atlas.id, 'PERMISSION_REVOKE');
    assert.equal(revoke.details.groupId, g.id);
    assert.equal(revoke.details.groupName, g.name, 'a leitura do nome ignora `deleted_at`');
  });

  it('quem tem write (abaixo de manage) leva 403 e NÃO escreve nem audita', async () => {
    const atlas = await cenario();
    const g = await createAccessGroup(db, editor.id);

    const sharesAntes = await contarShares(atlas.id);
    const trilhaAntes = await contarTrilha(atlas.id);

    await como(editorTok, 'post', `/api/v1/atlas/${atlas.id}/sharing/groups`)
      .send({ groupId: g.id, permission: 'read' })
      .expect(403);

    // AS DUAS NEGATIVAS CORREM JUNTAS: só o 403 ficaria verde numa implementação que
    // escrevesse a linha e falhasse depois.
    assert.equal(await contarShares(atlas.id), sharesAntes, 'nenhuma linha nova');
    assert.equal(await contarTrilha(atlas.id), trilhaAntes, 'nenhuma linha de trilha');
  });

  it('DELETE de um grupo sem share responde 404, não 204', async () => {
    const atlas = await cenario();
    const g = await createAccessGroup(db, dono.id);
    await como(donoTok, 'delete', `/api/v1/atlas/${atlas.id}/sharing/groups/${g.id}`).expect(404);
  });

  // ==========================================================================
  it('só grupo PRÓPRIO: o co-Gestor sem posse do grupo leva 404 e não escreve', async () => {
    const atlas = await cenario();
    const g = await createAccessGroup(db, dono.id, { name: `Do Dono ${U()}` });
    // O co-Gestor é MEMBRO do grupo, e ainda assim não o administra: participar não é possuir.
    await addAccessGroupMember(db, g.id, coGestor.id, dono.id);

    // PISO: quem POSSUI o grupo compartilha, com o MESMO atlas e o MESMO nível.
    await como(donoTok, 'post', `/api/v1/atlas/${atlas.id}/sharing/groups`)
      .send({ groupId: g.id, permission: 'manage' })
      .expect(201);
    await como(donoTok, 'delete', `/api/v1/atlas/${atlas.id}/sharing/groups/${g.id}`).expect(204);

    const sharesAntes = await contarShares(atlas.id);
    const trilhaAntes = await contarTrilha(atlas.id);

    // DISCRIMINAÇÃO: mesmo atlas, mesmo grupo, mesmo nível, `manage` no atlas — só a posse
    // do grupo muda. 404 e NÃO 403, porque a listagem de grupos é recortada por posse: um
    // 403 contaria que aquele id existe.
    await como(coGestorTok, 'post', `/api/v1/atlas/${atlas.id}/sharing/groups`)
      .send({ groupId: g.id, permission: 'manage' })
      .expect(404);

    assert.equal(await contarShares(atlas.id), sharesAntes);
    assert.equal(await contarTrilha(atlas.id), trilhaAntes);
  });

  it('o PUT: SUBIR o nível exige posse do grupo, REBAIXAR não, e a recusa não deixa rastro', async () => {
    // O GATE DO `PUT` FICOU SEM TESTE NA PRIMEIRA ESCRITA DESTA ONDA, e a ausência foi
    // medida: apagando a linha do `assertCanAdministerGroup` de `updateGroupShare`, os onze
    // casos deste arquivo continuavam verdes. Um co-Gestor sem posse do grupo promovia o
    // vínculo de `read` a `manage` e distribuía co-Gestão por uma composição que não é dele
    // — que é o RISCO principal do lote inteiro, livre numa das duas portas que o aplicam.
    //
    // E O GATE É CONDICIONAL AO SENTIDO, não à rota: a mesma frase que libera o `DELETE`
    // ("tirar acesso nunca pode ser mais difícil que dar") libera o `PUT` que rebaixa.
    // Enquanto ele era incondicional, a regra estava aplicada ao contrário — o gestor do
    // atlas podia apagar o vínculo e não podia reduzi-lo, e a única saída que lhe restava
    // era a mais destrutiva.
    const atlas = await cenario();
    const g = await createAccessGroup(db, dono.id, { name: `Do Dono ${U()}` });
    await addAccessGroupMember(db, g.id, coGestor.id, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'read', dono.id);

    const nivelNoBanco = async () => {
      const { rows } = await db.query(
        'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND group_id = $2', [atlas.id, g.id]
      );
      return rows[0]?.permission ?? null;
    };
    const url = `/api/v1/atlas/${atlas.id}/sharing/groups/${g.id}`;

    // PISO: quem POSSUI o grupo sobe o nível, e o banco muda.
    await como(donoTok, 'put', url).send({ permission: 'manage' }).expect(200);
    assert.equal(await nivelNoBanco(), 'manage', 'piso: o caminho com posse funciona');

    // ATO 1 — REBAIXAR sem posse: passa, porque é tirar.
    const trilhaAntesDeRebaixar = await contarTrilha(atlas.id, 'SHARING_CHANGE');
    await como(coGestorTok, 'put', url).send({ permission: 'read' }).expect(200);
    assert.equal(await nivelNoBanco(), 'read', 'o co-Gestor rebaixa o grupo alheio');
    assert.equal(await contarTrilha(atlas.id, 'SHARING_CHANGE'), trilhaAntesDeRebaixar + 1);

    // ATO 2 — SUBIR sem posse: 404, e a transação inteira volta atrás.
    const trilhaAntesDeSubir = await contarTrilha(atlas.id);
    await como(coGestorTok, 'put', url).send({ permission: 'manage' }).expect(404);

    // AS DUAS NEGATIVAS JUNTAS. O 404 sozinho ficaria verde numa rota inteiramente
    // quebrada, e ficaria verde também se o `UPDATE` tivesse escrito antes da recusa —
    // que é exatamente o risco de gatear DEPOIS de escrever.
    assert.equal(await nivelNoBanco(), 'read', 'o nível não subiu: o UPDATE foi desfeito');
    assert.equal(await contarTrilha(atlas.id), trilhaAntesDeSubir, 'nem trilha ficou');

    // DISCRIMINAÇÃO: o DONO do grupo faz a MESMA subida, no mesmo atlas e no mesmo nível.
    // Sem ela, o 404 acima não distingue "gate de posse" de "PUT que nunca sobe".
    await como(donoTok, 'put', url).send({ permission: 'manage' }).expect(200);
    assert.equal(await nivelNoBanco(), 'manage');
  });

  it('tirar o grupo do atlas NÃO exige posse do grupo (a assimetria conceder/remover)', async () => {
    const atlas = await cenario();
    const g = await createAccessGroup(db, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'read', dono.id);

    // O co-Gestor não possui o grupo e mesmo assim desfaz o vínculo: tirar acesso nunca
    // pode ser mais difícil que dar, senão um grupo compartilhado por quem depois perdeu a
    // posse ficaria preso ao atlas para sempre.
    await como(coGestorTok, 'delete', `/api/v1/atlas/${atlas.id}/sharing/groups/${g.id}`).expect(204);
  });

  it('grupo apagado (soft) responde 404 no POST, mesmo para o dono dele', async () => {
    const atlas = await cenario();
    const g = await createAccessGroup(db, dono.id);
    await db.query('UPDATE access_groups SET deleted_at = NOW() WHERE id = $1', [g.id]);

    await como(donoTok, 'post', `/api/v1/atlas/${atlas.id}/sharing/groups`)
      .send({ groupId: g.id, permission: 'read' })
      .expect(404);
  });

  // ==========================================================================
  it('PUT/DELETE /sharing/groups/nao-e-uuid respondem 422 na borda, nunca 500', async () => {
    const atlas = await cenario();

    const put = await como(donoTok, 'put', `/api/v1/atlas/${atlas.id}/sharing/groups/nao-e-uuid`)
      .send({ permission: 'read' })
      .expect(422);
    assert.ok(Array.isArray(put.body.error.details), 'a borda explica o campo');
    assert.equal(put.body.error.stack, undefined);

    await como(donoTok, 'delete', `/api/v1/atlas/${atlas.id}/sharing/groups/nao-e-uuid`).expect(422);

    // CONTRASTE no mesmo arquivo: um UUID válido de grupo sem share naquele atlas chega ao
    // serviço e responde 404. Sem ele, um `validate` que rejeitasse tudo passaria acima.
    const g = await createAccessGroup(db, dono.id);
    await como(donoTok, 'delete', `/api/v1/atlas/${atlas.id}/sharing/groups/${g.id}`).expect(404);
  });

  it('o nível fora dos quatro concedíveis é recusado na borda', async () => {
    const atlas = await cenario();
    const g = await createAccessGroup(db, dono.id);
    await como(donoTok, 'post', `/api/v1/atlas/${atlas.id}/sharing/groups`)
      .send({ groupId: g.id, permission: 'owner' })
      .expect(422);
    // `manage` PASSA: os quatro concedíveis valem para grupo como valem para pessoa
    // (decisão do dono). É a metade positiva sem a qual o 422 acima não distingue
    // "recusa `owner`" de "recusa tudo".
    await como(donoTok, 'post', `/api/v1/atlas/${atlas.id}/sharing/groups`)
      .send({ groupId: g.id, permission: 'manage' })
      .expect(201);
  });

  // ==========================================================================
  it('GET /sharing separa pessoas de grupos, não inventa membro nulo, e NOMEIA o dono do grupo', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `SGR cfg ${U()}` });
    await createMap(db, atlas.id);
    await createShare(db, atlas.id, editor.id, 'write', dono.id);

    const g = await createAccessGroup(db, coGestor.id, { name: `Coletivo ${U()}` });
    await addAccessGroupMember(db, g.id, membro.id, coGestor.id);
    await addAccessGroupMember(db, g.id, editor.id, coGestor.id);
    await createGroupShare(db, atlas.id, g.id, 'read', dono.id);

    const res = await como(donoTok, 'get', `/api/v1/atlas/${atlas.id}/sharing`).expect(200);
    const data = res.body.data;

    // O PISO É A SEPARAÇÃO. Revertendo o `FILTER` para `s.id IS NOT NULL`, `shares` viria
    // com DUAS entradas e a segunda seria uma pessoa de `username` nulo.
    assert.equal(data.shares.length, 1, 'uma pessoa');
    assert.equal(data.shares[0].userId, editor.id);
    assert.equal(typeof data.shares[0].username, 'string');
    assert.ok(data.shares[0].username.length > 0);

    assert.equal(data.groups.length, 1, 'um grupo');
    assert.equal(data.groups[0].groupId, g.id);
    assert.equal(data.groups[0].name, g.name);
    assert.equal(data.groups[0].permission, 'read');
    assert.equal(data.groups[0].memberCount, 2);

    // A MITIGAÇÃO (ii) DA DECISÃO DO DONO: o gestor do atlas vê DE QUEM é a composição que
    // está aceitando. Sem o nome do dono, a amplificação de autoridade fica invisível
    // justamente na tela que a mostraria.
    assert.equal(data.groups[0].ownerId, coGestor.id);
    assert.equal(data.groups[0].ownerUsername, coGestor.username);
    assert.equal(data.groups[0].ownerNome, 'Co Gestor');

    // DISCRIMINAÇÃO: a linha de PESSOA não ganha rótulo de dono nenhum.
    assert.equal(data.shares[0].ownerNome, undefined);
  });

  it('grupo soft-deletado sai de `groups`; o share direto do mesmo atlas continua em `shares`', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `SGR morto ${U()}` });
    await createMap(db, atlas.id);
    await createShare(db, atlas.id, editor.id, 'read', dono.id);
    const g = await createAccessGroup(db, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'write', dono.id);

    const antes = await como(donoTok, 'get', `/api/v1/atlas/${atlas.id}/sharing`).expect(200);
    assert.equal(antes.body.data.groups.length, 1, 'piso');
    assert.equal(antes.body.data.shares.length, 1, 'piso');

    await db.query('UPDATE access_groups SET deleted_at = NOW() WHERE id = $1', [g.id]);

    const depois = await como(donoTok, 'get', `/api/v1/atlas/${atlas.id}/sharing`).expect(200);
    assert.deepEqual(depois.body.data.groups, [], 'a tela concorda com a resolução');
    assert.equal(depois.body.data.shares.length, 1, 'e a pessoa não se moveu');
  });

  it('atlas sem grupo nenhum devolve `groups: []`, não ausência da chave', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `SGR vazio ${U()}` });
    await createMap(db, atlas.id);
    const res = await como(donoTok, 'get', `/api/v1/atlas/${atlas.id}/sharing`).expect(200);
    assert.ok('groups' in res.body.data, 'a chave existe mesmo vazia');
    assert.deepEqual(res.body.data.groups, []);
  });
});
