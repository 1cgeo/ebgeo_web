// Path: tests/integration/resource-grants-poda.test.js
//
// A PODA DA SUBÁRVORE (fase F3, decisão D2).
//
// Revogar uma concessão derruba TODA a subárvore que dela deriva, e só ela. As
// duas metades importam igualmente, e a segunda é a que separa uma poda de um
// `UPDATE resource_grants SET revoked_at = NOW()` sem WHERE:
//
//   - A→B→C, revogar A derruba B e C;
//   - o ramo IRMÃO (D→E, pendurado numa concessão de raiz diferente) SOBREVIVE.
//
// Sem o irmão, uma poda que revogasse tudo passaria neste arquivo. É a mesma
// razão de o teste positivo acompanhar todo teste negativo: "não vê" também é o
// que se mede quando a fixture não existe.
//
// D3 tem um caso próprio aqui: A e X concedem o MESMO recurso a B. Revogar a
// concessão de A não pode derrubar a de X — a revogação de um concedente não
// desfaz a decisão de outro.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('F3 — revogar poda a subárvore, e só ela', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const TILESET = `poda-${sufixo}`;
  const atores = {};
  const tokens = {};

  /** POST /grants como `quem`, devolvendo o corpo já desembrulhado. */
  async function conceder(quem, granteeId, grantLevel, esperado = 201) {
    const res = await supertest(app)
      .post(`/api/v1/resource-access/tileset/${TILESET}/grants`)
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .send({ granteeId, grantLevel })
      .expect(esperado);
    return res.body.data;
  }

  /** Os ids que este usuário enxerga em /visible (sem atlas em foco). */
  async function tilesetsVisiveis(quem) {
    const res = await supertest(app)
      .get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .expect(200);
    return res.body.data.tilesets.map((t) => t.id);
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    for (const nome of ['admin', 'a', 'b', 'c', 'd', 'e', 'x']) {
      atores[nome] = nome === 'admin'
        ? await createAdminUser(db, { username: `poda_admin_${sufixo}` })
        : await createUser(db, { username: `poda_${nome}_${sufixo}` });
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }

    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [TILESET, `Tileset ${sufixo}`]
    );
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [TILESET]);
    await db.query('DELETE FROM tilesets WHERE id = $1', [TILESET]);
    await teardownTestEnv(db);
  });

  it('A→B→C cai inteira, e o ramo irmão D→E fica de pé', async () => {
    // Duas RAÍZES independentes, ambas concedidas pelo admin (papel global concede
    // de raiz, `parent_grant_id = NULL`).
    const gA = await conceder('admin', atores.a.id, 'view_share');
    const gD = await conceder('admin', atores.d.id, 'view_share');
    assert.equal(gA.parent_grant_id, null, 'papel global concede de RAIZ');
    assert.equal(gD.parent_grant_id, null);

    const gB = await conceder('a', atores.b.id, 'view_share');
    const gC = await conceder('b', atores.c.id, 'view');
    const gE = await conceder('d', atores.e.id, 'view');

    // A árvore é a que se pensa que é. Sem esta asserção, uma poda que "funciona"
    // porque tudo nasceu de raiz passaria despercebida.
    assert.equal(gB.parent_grant_id, gA.id, 'B pendura em A');
    assert.equal(gC.parent_grant_id, gB.id, 'C pendura em B');
    assert.equal(gE.parent_grant_id, gD.id, 'E pendura em D');

    // O PISO: os cinco enxergam o recurso ANTES da poda. Medir só o estado final
    // não distingue "perdeu acesso" de "nunca teve".
    for (const quem of ['a', 'b', 'c', 'd', 'e']) {
      assert.ok((await tilesetsVisiveis(quem)).includes(TILESET), `${quem} precisa ver antes da poda`);
    }

    const res = await supertest(app)
      .delete(`/api/v1/resource-access/grants/${gA.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);

    const derrubados = res.body.data.revoked.map((r) => r.id).sort();
    assert.deepEqual(derrubados, [gA.id, gB.id, gC.id].sort(), 'a poda devolve exatamente A, B e C');

    for (const quem of ['a', 'b', 'c']) {
      assert.ok(!(await tilesetsVisiveis(quem)).includes(TILESET), `${quem} perde o acesso`);
    }
    // O CONTROLE DE DISCRIMINAÇÃO: o irmão sobrevive.
    for (const quem of ['d', 'e']) {
      assert.ok((await tilesetsVisiveis(quem)).includes(TILESET), `${quem} (ramo irmão) continua vendo`);
    }
  });

  it('D3: a revogação de um concedente não desfaz o que outro concedeu', async () => {
    const gX = await conceder('admin', atores.x.id, 'view_share');
    const gDoX = await conceder('x', atores.b.id, 'view');
    const gDoD = await conceder('d', atores.b.id, 'view');

    assert.notEqual(gDoX.id, gDoD.id, 'duas concessões vivas para a mesma pessoa (DAG, D3)');
    assert.ok((await tilesetsVisiveis('b')).includes(TILESET), 'piso: B vê pelos dois caminhos');

    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${gDoX.id}`)
      .set('Authorization', `Bearer ${tokens.x}`)
      .expect(200);

    assert.ok(
      (await tilesetsVisiveis('b')).includes(TILESET),
      'B continua vendo pelo caminho de D — a revogação de X não alcança a decisão de D'
    );

    // E a discriminação: derrubado TAMBÉM o caminho de D, o acesso acaba.
    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${gDoD.id}`)
      .set('Authorization', `Bearer ${tokens.d}`)
      .expect(200);
    assert.ok(!(await tilesetsVisiveis('b')).includes(TILESET), 'sem nenhum caminho vivo, B não vê');

    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${gX.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
  });

  it('revogar duas vezes é idempotente e a data da PRIMEIRA revogação é a que vale', async () => {
    const g = await conceder('admin', atores.a.id, 'view');

    const um = await supertest(app)
      .delete(`/api/v1/resource-access/grants/${g.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    assert.equal(um.body.data.revoked.length, 1);

    const { rows: antes } = await db.query('SELECT revoked_at FROM resource_grants WHERE id = $1', [g.id]);

    const dois = await supertest(app)
      .delete(`/api/v1/resource-access/grants/${g.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    assert.equal(dois.body.data.revoked.length, 0, 'a segunda revogação não derruba nada');

    const { rows: depois } = await db.query('SELECT revoked_at FROM resource_grants WHERE id = $1', [g.id]);
    assert.equal(
      depois[0].revoked_at.getTime(), antes[0].revoked_at.getTime(),
      'a data da primeira revogação não é reescrita'
    );
  });

  it('uma poda posterior NÃO re-data o que uma poda anterior já derrubou', async () => {
    // ESTE CASO EXISTE PARA PRENDER O `revoked_at IS NULL` DO BRAÇO RECURSIVO, e
    // ele não era prendível pelo controle que o plano sugeria. Com todos os elos
    // vivos, remover aquela linha não muda nada: A→B→C cai igual, e o controle
    // negativo passava VERDE.
    //
    // O que a linha realmente faz é parar a travessia no primeiro elo JÁ revogado.
    // Sem ela, revogar A depois de B já ter caído reescreveria `revoked_at` e
    // `revoked_by` de B e de C com a data de agora — e "quando Fulano perdeu
    // acesso, e por ordem de quem" passaria a responder a poda ERRADA. A data da
    // primeira revogação é a que vale.
    const gA = await conceder('admin', atores.a.id, 'view_share');
    const gB = await conceder('a', atores.b.id, 'view_share');
    const gC = await conceder('b', atores.c.id, 'view');

    // Primeira poda: A derruba a própria subárvore B→C.
    const primeira = await supertest(app)
      .delete(`/api/v1/resource-access/grants/${gB.id}`)
      .set('Authorization', `Bearer ${tokens.a}`)
      .expect(200);
    assert.equal(primeira.body.data.revoked.length, 2, 'piso: a primeira poda derruba B e C');

    const { rows: antes } = await db.query(
      'SELECT id, revoked_at, revoked_by FROM resource_grants WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[gB.id, gC.id]]
    );
    assert.equal(antes.length, 2);
    for (const linha of antes) {
      assert.equal(linha.revoked_by, atores.a.id, 'piso: quem revogou foi A');
    }

    // Segunda poda, mais acima. Ela alcança A e PARA ali.
    const segunda = await supertest(app)
      .delete(`/api/v1/resource-access/grants/${gA.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    assert.deepEqual(segunda.body.data.revoked.map((r) => r.id), [gA.id], 'só A ainda estava vivo');

    const { rows: depois } = await db.query(
      'SELECT id, revoked_at, revoked_by FROM resource_grants WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[gB.id, gC.id]]
    );
    assert.equal(depois.length, 2, 'guarda: as duas linhas precisam ter sido relidas');
    for (let i = 0; i < depois.length; i += 1) {
      assert.equal(
        depois[i].revoked_at.getTime(), antes[i].revoked_at.getTime(),
        'a data da PRIMEIRA revogação não pode ser reescrita por uma poda posterior'
      );
      assert.equal(
        depois[i].revoked_by, atores.a.id,
        'nem o autor dela — quem derrubou B e C foi A, e não o admin que veio depois'
      );
    }
  });

  it('a poda emite UMA linha de auditoria por concessão derrubada', async () => {
    const gA = await conceder('admin', atores.a.id, 'view_share');
    const gB = await conceder('a', atores.b.id, 'view');

    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${gA.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);

    const { rows } = await db.query(
      `SELECT target_id, details FROM audit_trail
        WHERE action = 'PERMISSION_REVOKE' AND details->>'rootGrantId' = $1`,
      [gA.id]
    );
    assert.equal(rows.length, 2, 'a raiz e o filho, uma linha cada');
    const porBeneficiario = new Map(rows.map((r) => [r.target_id, r.details]));
    assert.ok(porBeneficiario.has(atores.a.id), 'a raiz aparece com o beneficiário dela');
    assert.ok(porBeneficiario.has(atores.b.id), 'o filho aparece com o beneficiário dele');
    // O `parentGrantId` é o que responde "por que Fulano perdeu acesso".
    assert.equal(porBeneficiario.get(atores.b.id).parentGrantId, gA.id);
    assert.equal(porBeneficiario.get(atores.b.id).grantId, gB.id);
    assert.equal(porBeneficiario.get(atores.b.id).resourceId, TILESET);
  });

  it('quem não concedeu não revoga (e a linha continua viva)', async () => {
    const g = await conceder('admin', atores.a.id, 'view_share');

    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${g.id}`)
      .set('Authorization', `Bearer ${tokens.c}`)
      .expect(403);

    assert.ok(
      (await tilesetsVisiveis('a')).includes(TILESET),
      'o 403 precisa ser sem efeito — a concessão continua viva'
    );

    // Discriminação: quem CONCEDEU passa no mesmo corpo.
    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${g.id}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
  });
});
