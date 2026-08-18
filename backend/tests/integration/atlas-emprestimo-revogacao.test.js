// Path: tests/integration/atlas-emprestimo-revogacao.test.js
//
// D4 — O QUE SUSTENTA O EMPRÉSTIMO DEPOIS QUE ELE É CRIADO.
//
// Validar só no momento de anexar deixaria um empréstimo vivo depois que quem o
// criou perdeu acesso. A escolha é: o empréstimo vale enquanto o DONO do atlas
// puder ver o recurso — condição ESTÁVEL (o dono é uma coluna, não uma cadeia) e
// que faz a revogação propagar sozinha para todos os membros, sem varredura
// periódica.
//
// ESTE ARQUIVO MEDE O DELTA, NÃO O ESTADO FINAL. Antes da revogação TODOS veem;
// depois, NINGUÉM. Medir só o depois passaria idêntico se a fixture nunca tivesse
// funcionado.
//
// Dois casos que só existem por causa de D4, e que a leitura do SQL não entrega:
// quem anexou pode ser OUTRO (um co-Gestor), e a condição continua sendo o DONO; e
// TRANSFERIR a posse para quem não vê o recurso derruba os empréstimos, que é a
// consequência aceita da decisão.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';

describe('F5/D4 — o empréstimo vive enquanto o DONO do atlas vê o recurso', () => {
  let app, db, admin, dono, gestor, membro, semAcesso, atlas;
  let tokenAdmin, tokenDono, tokenGestor, tokenMembro;
  let grantDoDono;
  const sufixo = randomUUID().slice(0, 8);
  const LAYER = `d4-${sufixo}`;

  const veLayer = async (token, atlasId) => (await supertest(app)
    .get(`/api/v1/resource-access/visible?atlasId=${atlasId}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200)).body.data.dataLayers.map((l) => l.id).includes(LAYER);

  const conceder = (token, granteeId, grantLevel) => supertest(app)
    .post(`/api/v1/resource-access/data_layer/${LAYER}/grants`)
    .set('Authorization', `Bearer ${token}`)
    .send({ granteeId, grantLevel });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `d4_admin_${sufixo}` });
    dono = await createUser(db, { username: `d4_dono_${sufixo}` });
    gestor = await createUser(db, { username: `d4_gestor_${sufixo}` });
    membro = await createUser(db, { username: `d4_membro_${sufixo}` });
    semAcesso = await createUser(db, { username: `d4_semacesso_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenDono = await loginUser(app, dono.username, dono.password);
    tokenGestor = await loginUser(app, gestor.username, gestor.password);
    tokenMembro = await loginUser(app, membro.username, membro.password);

    atlas = await createAtlas(db, dono.id, { name: `Atlas D4 ${sufixo}` });
    await createShare(db, atlas.id, gestor.id, 'manage', dono.id);
    await createShare(db, atlas.id, membro.id, 'read', dono.id);
    await createShare(db, atlas.id, semAcesso.id, 'read', dono.id);

    await db.query(
      `INSERT INTO data_layers (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [LAYER, `Camada D4 ${sufixo}`]
    );

    // O DONO recebe a concessão; o GESTOR também, senão ele não poderia anexar.
    grantDoDono = (await conceder(tokenAdmin, dono.id, 'view').expect(201)).body.data;
    await conceder(tokenAdmin, gestor.id, 'view').expect(201);

    // Quem ANEXA é o co-Gestor, e não o dono: é o que separa "quem criou" de "o que
    // sustenta". Se as duas condições fossem a mesma, este arquivo mediria uma só.
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/resources`)
      .set('Authorization', `Bearer ${tokenGestor}`)
      .send({ resourceType: 'data_layer', resourceId: LAYER })
      .expect(201);
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE resource_id = $1', [LAYER]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [LAYER]);
    await db.query('DELETE FROM data_layers WHERE id = $1', [LAYER]);
    await db.query('DELETE FROM atlas WHERE id = $1', [atlas.id]);
    await teardownTestEnv(db);
  });

  it('revogar a concessão do DONO derruba o empréstimo para TODOS — e o delta é medido', async () => {
    for (const [quem, token] of [['dono', tokenDono], ['gestor', tokenGestor], ['membro', tokenMembro]]) {
      assert.equal(await veLayer(token, atlas.id), true, `piso: ${quem} precisa ver ANTES`);
    }

    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${grantDoDono.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    for (const [quem, token] of [['dono', tokenDono], ['membro', tokenMembro]]) {
      assert.equal(await veLayer(token, atlas.id), false, `${quem} perde o acesso emprestado`);
    }
    // O GESTOR continua vendo, e por outro caminho: a concessão PESSOAL dele, que
    // não foi tocada. É a discriminação que separa "o empréstimo caiu" de "todo
    // acesso caiu".
    assert.equal(
      await veLayer(tokenGestor, atlas.id), true,
      'quem tem concessão pessoal continua vendo — caiu o empréstimo, não o acesso'
    );
  });

  it('e devolver a concessão ao dono ressuscita o empréstimo, sem reanexar nada', async () => {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM atlas_resources WHERE resource_id = $1 AND removed_at IS NULL',
      [LAYER]
    );
    assert.equal(rows[0].n, 1, 'piso: a linha de empréstimo nunca foi removida');

    grantDoDono = (await conceder(tokenAdmin, dono.id, 'view').expect(201)).body.data;
    assert.equal(await veLayer(tokenMembro, atlas.id), true);
  });

  it('papel global no dono também sustenta o empréstimo (o outro braço de D4)', async () => {
    // A condição é "o dono VÊ o recurso", e ver por papel global conta tanto quanto
    // ver por concessão. Sem este caso, o ramo `fn_has_global_data_access(a.owner_id)`
    // ficaria sem medição nenhuma.
    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${grantDoDono.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    assert.equal(await veLayer(tokenMembro, atlas.id), false, 'piso: sem concessão, o empréstimo cai');

    await db.query('UPDATE users SET role = $1 WHERE id = $2', ['credenciado', dono.id]);
    try {
      assert.equal(await veLayer(tokenMembro, atlas.id), true, 'dono credenciado sustenta o empréstimo');
    } finally {
      await db.query('UPDATE users SET role = $1 WHERE id = $2', ['user', dono.id]);
    }
    assert.equal(await veLayer(tokenMembro, atlas.id), false, 'e rebaixar o dono derruba de novo');

    grantDoDono = (await conceder(tokenAdmin, dono.id, 'view').expect(201)).body.data;
  });

  it('transferir a posse para quem NÃO vê o recurso derruba os empréstimos', async () => {
    // Consequência aceita de D4, e escrita aqui porque é o tipo de efeito que
    // ninguém prevê ao clicar em "transferir".
    assert.equal(await veLayer(tokenMembro, atlas.id), true, 'piso');

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/transfer`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({ newOwnerId: semAcesso.id })
      .expect(200);

    assert.equal(
      await veLayer(tokenMembro, atlas.id), false,
      'o novo dono não vê o recurso, então o atlas deixa de emprestá-lo'
    );
    // Discriminação: dar acesso ao NOVO dono ressuscita o empréstimo.
    await conceder(tokenAdmin, semAcesso.id, 'view').expect(201);
    assert.equal(await veLayer(tokenMembro, atlas.id), true);
  });
});
