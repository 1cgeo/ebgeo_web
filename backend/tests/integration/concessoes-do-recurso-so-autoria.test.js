// Path: tests/integration/concessoes-do-recurso-so-autoria.test.js
//
// A LISTA DE CONCESSÕES DE UM RECURSO É A AUTORIA DE QUEM PERGUNTA (decisão do dono, 2026-09-22,
// item 19c; cláusula 3.9 da constituição).
//
// `GET /resource-access/:type/:id/grants` devolvia a árvore INTEIRA do recurso, com o que outras
// pessoas tinham concedido, e o modal de compartilhar desenhava tudo. O pedido foi mostrar só o
// que a própria conta concedeu, e decidir isso no SERVIDOR, para que a concessão alheia nem chegue
// ao cliente. O que muda de significado com o recorte é o aviso de revogação: ele contava a queda
// percorrendo a árvore no cliente, e a árvore deixou de vir. O número passou a vir pronto
// (`cascade_people`/`cascade_groups`), contado pelas MESMAS CTEs de leitura da poda
// (`REVOCATION_FALL_PREVIEW` é montada de `CTES_DE_LEITURA_DA_PODA`).
//
// O QUE ESTE ARQUIVO PRENDE:
//
//   1. O recorte, nos dois sentidos: cada concedente vê as dele (positivo) e nenhuma linha alheia
//      (negativo), administrador inclusive. O negativo sozinho passaria com uma lista vazia.
//   2. A contagem da subárvore que deriva de uma concessão do chamador, separada em pessoas e
//      grupos, sem que as linhas dessa subárvore apareçam.
//   3. O RESGATE entra na contagem: um descendente cujo concedente ainda tem outro caminho vivo não
//      é contado, e a prévia bate com o que a revogação de fato derruba. É esse último caso que
//      prende "uma definição só": uma prévia escrita à parte divergiria dele primeiro.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('GET /resource-access/:type/:id/grants — só o que quem pergunta concedeu', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const RECURSO = `autoria-${sufixo}`;
  const atores = {};
  const tokens = {};
  /** As concessões criadas, por nome, para as asserções lerem ids e não posições. */
  const g = {};
  let grupo;

  /** POST /grants como `quem`, devolvendo a linha criada. */
  async function conceder(quem, corpo, esperado = 201) {
    const res = await supertest(app)
      .post(`/api/v1/resource-access/tileset/${RECURSO}/grants`)
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .send(corpo)
      .expect(esperado);
    return res.body.data;
  }

  /** A listagem do recurso como `quem`. */
  async function listar(quem, esperado = 200) {
    const res = await supertest(app)
      .get(`/api/v1/resource-access/tileset/${RECURSO}/grants`)
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .expect(esperado);
    return res.body.data;
  }

  const ids = (linhas) => linhas.map((l) => l.id).sort();

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    for (const nome of ['admin', 'a', 'b', 'c', 'd', 'e']) {
      atores[nome] = nome === 'admin'
        ? await createAdminUser(db, { username: `aut_admin_${sufixo}` })
        : await createUser(db, { username: `aut_${nome}_${sufixo}` });
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }

    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [RECURSO, `Tileset autoria ${sufixo}`],
    );

    // A árvore: admin → A (repassa) e admin → B (só vê); A → C (repassa); C → D (só vê); e A → um
    // grupo PRÓPRIO dele, com E dentro. O grupo precisa ser de A: conceder a coletivo alheio é 404.
    g.adminA = await conceder('admin', { granteeId: atores.a.id, grantLevel: 'view_share' });
    g.adminB = await conceder('admin', { granteeId: atores.b.id, grantLevel: 'view' });
    g.aC = await conceder('a', { granteeId: atores.c.id, grantLevel: 'view_share' });
    g.cD = await conceder('c', { granteeId: atores.d.id, grantLevel: 'view' });

    const criado = await supertest(app)
      .post('/api/v1/access-groups')
      .set('Authorization', `Bearer ${tokens.a}`)
      .send({ name: `Grupo autoria ${sufixo}` })
      .expect(201);
    grupo = criado.body.data;
    await supertest(app)
      .post(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${tokens.a}`)
      .send({ userId: atores.e.id })
      .expect(200);
    g.aGrupo = await conceder('a', { granteeGroupId: grupo.id, grantLevel: 'view' });
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [RECURSO]);
    await db.query('DELETE FROM tilesets WHERE id = $1', [RECURSO]);
    await db.query('DELETE FROM access_groups WHERE name LIKE $1', [`%${sufixo}%`]);
    await teardownTestEnv(db);
  });

  it('o administrador vê as DELE, e nenhuma das que os outros concederam', async () => {
    const linhas = await listar('admin');
    assert.deepEqual(ids(linhas), [g.adminA.id, g.adminB.id].sort());
    assert.ok(linhas.every((l) => l.granted_by === atores.admin.id), 'toda linha é de autoria dele');
    // O NEGATIVO NOMEADO: as três concessões feitas a partir da dele existem e não saem por aqui.
    for (const alheia of [g.aC.id, g.cD.id, g.aGrupo.id]) {
      assert.ok(!ids(linhas).includes(alheia), `a concessão ${alheia} é de outra pessoa`);
    }
  });

  it('cada concedente vê a própria fatia da árvore, e só ela', async () => {
    assert.deepEqual(ids(await listar('a')), [g.aC.id, g.aGrupo.id].sort());
    assert.deepEqual(ids(await listar('c')), [g.cD.id]);
    // Quem só VÊ continua sem lista nenhuma: o gate é o de compartilhar, e o recorte por autoria
    // não o afrouxou.
    await listar('d', 403);
    await listar('b', 403);
  });

  it('a subárvore da concessão do chamador sai CONTADA, por tipo, sem as linhas', async () => {
    const linhas = await listar('admin');
    const daA = linhas.find((l) => l.id === g.adminA.id);
    const daB = linhas.find((l) => l.id === g.adminB.id);
    // Revogar admin → A derruba A → C, C → D (pessoas) e A → grupo (grupo). A própria âncora não
    // conta: ela é a linha em que a pessoa está clicando.
    assert.equal(daA.cascade_people, 2);
    assert.equal(daA.cascade_groups, 1);
    // A folha não derruba ninguém, e o zero precisa vir como número, não como ausência.
    assert.equal(daB.cascade_people, 0);
    assert.equal(daB.cascade_groups, 0);

    const deA = await listar('a');
    assert.equal(deA.find((l) => l.id === g.aC.id).cascade_people, 1, 'A → C derruba C → D');
    assert.equal(deA.find((l) => l.id === g.aGrupo.id).cascade_people, 0);
  });

  it('o resgate entra na contagem, e a prévia bate com o que a revogação derruba', async () => {
    // C ganha um SEGUNDO caminho, do administrador, DEPOIS de ter concedido a D: C → D continua
    // pendurada em A → C, e agora o concedente dela tem `view_share` vivo fora da subárvore de
    // admin → A. Pela regra D3, revogar admin → A não derruba D.
    g.adminC = await conceder('admin', { granteeId: atores.c.id, grantLevel: 'view_share' });

    const antes = (await listar('admin')).find((l) => l.id === g.adminA.id);
    assert.equal(antes.cascade_people, 1, 'só C (A → C) cai; D é resgatada pelo caminho novo de C');
    assert.equal(antes.cascade_groups, 1, 'o grupo de A cai, porque A não tem outro caminho');

    const res = await supertest(app)
      .delete(`/api/v1/resource-access/grants/${g.adminA.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    const revogadas = res.body.data.revoked.map((l) => l.id).sort();
    assert.deepEqual(revogadas, [g.adminA.id, g.aC.id, g.aGrupo.id].sort());
    assert.ok(res.body.data.reparented.some((l) => l.id === g.cD.id), 'C → D foi re-pendurada');
    // A MESMA DEFINIÇÃO: a prévia contou o que a poda derrubou, menos a âncora.
    assert.equal(antes.cascade_people + antes.cascade_groups, revogadas.length - 1);
  });
});
