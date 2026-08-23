// Path: tests/integration/sair-do-atlas.test.js
//
// SAIR DE UM ATLAS POR CONTA PRÓPRIA — `DELETE /api/v1/atlas/:atlasId/sharing/me`
// (decisão do dono, 2026-08-23).
//
// O QUE NÃO EXISTIA: `DELETE /sharing/users/:userId` exige `manage`, então um Editor não conseguia
// se retirar de um projeto — a única saída era pedir a quem administra. A rota nova é gateada só
// por `auth`, porque a autoridade exercida aqui é sobre si mesmo.
//
// AS QUATRO PROPRIEDADES QUE SÓ FALHAM AQUI:
//
// 1. O DONO NÃO SAI. Sem a recusa o atlas fica órfão: `atlas.owner_id` é FK sem `ON DELETE`, o
//    empréstimo de recurso é resolvido a partir do dono (cláusula 6.2) e não há caminho de volta.
//    A recusa é 409 e não 403, porque quem chega ali tem a MAIOR permissão que existe; o que
//    existe é conflito de estado, e a mensagem nomeia a saída.
// 2. SAIR NÃO É UM JEITO OBLÍQUO DE DESTRUIR. O que a pessoa alcançava POR AQUELE atlas é o
//    EMPRÉSTIMO, que não é concessão e não tem linha em `resource_grants`: ele mora dentro do
//    predicado, avaliado com o atlas em foco. O que ela tem por CAMINHO PRÓPRIO nunca dependeu do
//    atlas e não pode cair junto. O par (cai / não cai) é a discriminação: medir só um dos dois
//    passaria idêntico com uma poda escrita a mais ou a menos.
// 3. IDEMPOTÊNCIA SEM ORÁCULO. Sair de onde não se está responde 200 `removed: false` — e o atlas
//    INEXISTENTE responde exatamente o mesmo. As duas metades são a mesma decisão: um 404 só no
//    segundo caso devolveria, por esta porta, o oráculo de existência que o 404 uniforme de
//    `requireAtlasPermission` nega.
// 4. QUEM TAMBÉM ALCANÇA POR GRUPO NÃO SAI DE VERDADE. A linha do coletivo não é dela para
//    apagar, e é por isso que a resposta carrega `effectivePermission` DEPOIS do ato: sem ele a
//    tela anunciaria "você saiu" e o atlas continuaria na lista.
//
// O QUE ESTE ARQUIVO NÃO MEDE: a queda da sessão de collab ao vivo. Ela é o MESMO caminho da
// revogação por terceiro — o sweep de `reconcileAuthorization` fecha com 4003 —, e está medido em
// `tests/ws/collab-reauthz.test.js` e `tests/ws/collab-reauthz-grupo.test.js`. Uma terceira cópia
// aqui mediria o sweep, não a rota.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createAtlas, createShare, loginUser,
  createAccessGroup, addAccessGroupMember, createGroupShare,
} from '../helpers/fixtures.js';

const U = () => `sai_${randomUUID().slice(0, 8)}`;

describe('sair do atlas · DELETE /sharing/me', () => {
  let app, db, admin, adminTok, dono, donoTok, editor, editorTok;

  const sair = (tok, atlasId) => supertest(app)
    .delete(`/api/v1/atlas/${atlasId}/sharing/me`)
    .set('Authorization', `Bearer ${tok}`);

  const contarShares = async (atlasId, userId) => {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
      [atlasId, userId]
    );
    return rows[0].n;
  };

  const trilhaDeSaida = async (atlasId) => {
    const { rows } = await db.query(
      `SELECT actor_id, details FROM audit_trail
        WHERE target_type = 'ATLAS' AND target_id = $1 AND action = 'PERMISSION_REVOKE'
        ORDER BY created_at, id`,
      [atlasId]
    );
    return rows;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    admin = await createAdminUser(db, { username: U() });
    adminTok = await loginUser(app, admin.username, admin.password);
    dono = await createUser(db, { username: U(), nome: 'Ana Dona' });
    donoTok = await loginUser(app, dono.username, dono.password);
    editor = await createUser(db, { username: U(), nome: 'Caio Editor' });
    editorTok = await loginUser(app, editor.username, editor.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('o Editor sai sozinho, e o atlas deixa de existir para ele', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `Sai ${U()}` });
    await createShare(db, atlas.id, editor.id, 'write', dono.id);

    // PISO: antes do ato ele alcança o atlas. Sem esta linha, o 404 do fim seria compatível com
    // um compartilhamento que nunca funcionou.
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${editorTok}`)
      .expect(200);

    const res = await sair(editorTok, atlas.id).expect(200);
    assert.equal(res.body.data.removed, true);
    assert.equal(res.body.data.effectivePermission, null, 'não sobrou caminho nenhum');
    assert.equal(res.body.data.atlasId, atlas.id);
    assert.equal(await contarShares(atlas.id, editor.id), 0, 'a linha de share some');

    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${editorTok}`)
      .expect(404);

    // A TRILHA DIZ QUEM DECIDIU: o ator é o próprio, e `self` separa esta linha da revogação
    // feita por um gestor, que grava a MESMA ação sem ele.
    const trilha = await trilhaDeSaida(atlas.id);
    assert.equal(trilha.length, 1, 'uma linha, e só uma');
    assert.equal(trilha[0].actor_id, editor.id);
    assert.equal(trilha[0].details.self, true);
    assert.equal(trilha[0].details.userId, editor.id);
  });

  it('a remoção POR TERCEIRO continua sem `self` — é ela que a saída se distingue de', async () => {
    // O CONTROLE DA DISCRIMINAÇÃO ACIMA. `self: true` só separa alguma coisa se o outro emissor
    // NÃO o escrever; com os dois escrevendo, a trilha teria um campo constante.
    const atlas = await createAtlas(db, dono.id, { name: `Sai ${U()}` });
    await createShare(db, atlas.id, editor.id, 'write', dono.id);

    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}/sharing/users/${editor.id}`)
      .set('Authorization', `Bearer ${donoTok}`)
      .expect(204);

    const trilha = await trilhaDeSaida(atlas.id);
    assert.equal(trilha.length, 1);
    assert.equal(trilha[0].actor_id, dono.id, 'quem decidiu foi o gestor');
    assert.equal(trilha[0].details.self, undefined, '`self` ausente é o que distingue os dois');
  });

  it('o DONO leva 409, e o atlas continua dele', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `Sai ${U()}` });

    const res = await sair(donoTok, atlas.id).expect(409);
    assert.match(res.body.error?.message ?? '', /transfira a posse/i,
      'a recusa precisa nomear o caminho, senão ela só informa que não dá');

    const { rows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].owner_id, dono.id, 'nada pode ter sido escrito');
    assert.deepEqual(await trilhaDeSaida(atlas.id), [], 'e a recusa não deixa rastro');

    // E o dono continua entrando no próprio atlas: o 409 não é um efeito colateral disfarçado.
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${donoTok}`)
      .expect(200);
  });

  it('sair duas vezes é 200 com `removed: false`, e não grava trilha nova', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `Sai ${U()}` });
    await createShare(db, atlas.id, editor.id, 'read', dono.id);

    const primeira = await sair(editorTok, atlas.id).expect(200);
    assert.equal(primeira.body.data.removed, true);

    const segunda = await sair(editorTok, atlas.id).expect(200);
    assert.equal(segunda.body.data.removed, false, 'sair de onde não se está não é erro');
    assert.equal(segunda.body.data.effectivePermission, null);

    assert.equal((await trilhaDeSaida(atlas.id)).length, 1, 'a repetição não é um evento');
  });

  it('atlas inexistente responde IGUAL a "não estou nele" (nenhum oráculo de existência)', async () => {
    const inexistente = randomUUID();
    const alheio = await createAtlas(db, dono.id, { name: `Sai ${U()}` });

    const a = await sair(editorTok, inexistente).expect(200);
    const b = await sair(editorTok, alheio.id).expect(200);
    assert.deepEqual(a.body.data.removed, false);
    assert.deepEqual(b.body.data.removed, false);
    assert.deepEqual(
      Object.keys(a.body.data).sort(), Object.keys(b.body.data).sort(),
      'as duas respostas precisam ser indistinguíveis na forma, não só no status'
    );
    assert.equal(a.body.data.effectivePermission, b.body.data.effectivePermission);
  });

  it('`:atlasId` malformado morre na borda (422), e não num cast ::uuid', async () => {
    // Esta é a primeira rota do módulo SEM `requireAtlasPermission`, e era ele que barrava a
    // forma antes do banco. Sem o `validate({ params })` o desfecho seria um 22P02 traduzido em
    // 400 sem relação aparente com o assunto.
    await sair(editorTok, 'nao-e-uuid').expect(422);
  });

  it('sem token, 401', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `Sai ${U()}` });
    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}/sharing/me`)
      .expect(401);
  });

  it('quem também alcança por GRUPO continua dentro, e a resposta diz isso', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `Sai ${U()}` });
    const duplo = await createUser(db, { username: U(), nome: 'Elza Dupla' });
    const duploTok = await loginUser(app, duplo.username, duplo.password);
    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, duplo.id, dono.id);
    await createShare(db, atlas.id, duplo.id, 'read', dono.id);
    await createGroupShare(db, atlas.id, g.id, 'write', dono.id);

    const res = await sair(duploTok, atlas.id).expect(200);
    assert.equal(res.body.data.removed, true, 'a linha NOMINAL saiu');
    assert.equal(
      res.body.data.effectivePermission, 'write',
      'e o coletivo continua entregando o atlas: anunciar saída aqui seria mentira'
    );
    assert.equal(await contarShares(atlas.id, duplo.id), 0);

    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${duploTok}`)
      .expect(200);
  });

  it('a saída derruba o EMPRÉSTIMO do atlas e preserva a concessão de caminho próprio', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `Sai ${U()}` });
    const membro = await createUser(db, { username: U(), nome: 'Fábio Membro' });
    const membroTok = await loginUser(app, membro.username, membro.password);
    await createShare(db, atlas.id, membro.id, 'read', dono.id);

    const sufixo = randomUUID().slice(0, 8);
    const EMPRESTADO = `emprestado-${sufixo}`;
    const PROPRIO = `proprio-${sufixo}`;
    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private'),
              ($3, $4, '{"url":"/y"}'::jsonb, 0, 'private')`,
      [EMPRESTADO, `Emprestado ${sufixo}`, PROPRIO, `Próprio ${sufixo}`]
    );
    try {
      // O DONO recebe o emprestado (é a concessão dele que sustenta o empréstimo) e o ANEXA.
      await supertest(app)
        .post(`/api/v1/resource-access/tileset/${EMPRESTADO}/grants`)
        .set('Authorization', `Bearer ${adminTok}`)
        .send({ granteeId: dono.id, grantLevel: 'view_share' })
        .expect(201);
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/resources`)
        .set('Authorization', `Bearer ${donoTok}`)
        .send({ resourceType: 'tileset', resourceId: EMPRESTADO })
        .expect(201);
      // E o MEMBRO recebe o outro por caminho PRÓPRIO, que não passa pelo atlas.
      await supertest(app)
        .post(`/api/v1/resource-access/tileset/${PROPRIO}/grants`)
        .set('Authorization', `Bearer ${adminTok}`)
        .send({ granteeId: membro.id, grantLevel: 'view' })
        .expect(201);

      const visiveisSemAtlas = async () => (await supertest(app)
        .get('/api/v1/resource-access/visible')
        .set('Authorization', `Bearer ${membroTok}`)
        .expect(200)).body.data.tilesets.map((t) => t.id);

      const comAtlas = await supertest(app)
        .get(`/api/v1/resource-access/visible?atlasId=${atlas.id}`)
        .set('Authorization', `Bearer ${membroTok}`)
        .expect(200);
      const idsComAtlas = comAtlas.body.data.tilesets.map((t) => t.id);
      assert.ok(idsComAtlas.includes(EMPRESTADO), 'piso: dentro do atlas ele vê o emprestado');
      assert.ok(idsComAtlas.includes(PROPRIO), 'piso: e o próprio');
      assert.ok((await visiveisSemAtlas()).includes(PROPRIO), 'piso: o próprio não depende do atlas');

      await sair(membroTok, atlas.id).expect(200);

      // O EMPRÉSTIMO CAI SEM PODA NENHUMA: fora do atlas o termo do predicado não é alcançado, e
      // o atlas deixou de ser alcançável (404, o mesmo do estranho).
      await supertest(app)
        .get(`/api/v1/resource-access/visible?atlasId=${atlas.id}`)
        .set('Authorization', `Bearer ${membroTok}`)
        .expect(404);

      const depois = await visiveisSemAtlas();
      assert.ok(depois.includes(PROPRIO), 'a concessão de caminho próprio SOBREVIVE à saída');
      assert.equal(depois.includes(EMPRESTADO), false, 'e o emprestado não vaza para fora do atlas');

      // E NENHUMA linha de concessão foi tocada: a saída apaga UMA linha, a de `atlas_shares`.
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS n FROM resource_grants
          WHERE resource_id = ANY($1::text[]) AND revoked_at IS NOT NULL`,
        [[EMPRESTADO, PROPRIO]]
      );
      assert.equal(rows[0].n, 0, 'sair não pode ser um jeito oblíquo de revogar');
    } finally {
      await db.query('DELETE FROM atlas_resources WHERE resource_id = ANY($1::text[])', [[EMPRESTADO, PROPRIO]]);
      await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])', [[EMPRESTADO, PROPRIO]]);
      await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])', [[EMPRESTADO, PROPRIO]]);
    }
  });

  it('o administrador global sai da LINHA de share e mantém a posse por papel', async () => {
    // DECISÃO ESCRITA: o curto-circuito de papel (cláusula 5.5) não vem de share nenhum, então
    // esta rota não o alcança — e um administrador SEM linha recebe o mesmo `removed: false` de
    // qualquer um, sem 404 e sem efeito.
    const atlas = await createAtlas(db, dono.id, { name: `Sai ${U()}` });

    const semLinha = await sair(adminTok, atlas.id).expect(200);
    assert.equal(semLinha.body.data.removed, false, 'não havia linha para apagar');
    assert.equal(
      semLinha.body.data.effectivePermission, null,
      '`effectivePermission` é o eixo POR ATLAS: o atalho global não é share e não aparece aqui'
    );
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);

    await createShare(db, atlas.id, admin.id, 'read', dono.id);
    const comLinha = await sair(adminTok, atlas.id).expect(200);
    assert.equal(comLinha.body.data.removed, true, 'a linha, essa sim, sai');
    // E a posse por papel continua de pé: o 200 abaixo vem do curto-circuito de administrador,
    // não de share nenhum.
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
  });
});
