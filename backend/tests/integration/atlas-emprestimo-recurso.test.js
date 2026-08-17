// Path: tests/integration/atlas-emprestimo-recurso.test.js
//
// O EMPRÉSTIMO POR ATLAS (fase F5).
//
// "Compartilhei o atlas, todos que acessarem acessam os recursos." O atlas passa a
// EMPRESTAR acesso aos recursos privados que ele carrega, no escopo dele.
//
// A propriedade que este arquivo mede é que o empréstimo é DE ESCOPO, e não uma
// concessão disfarçada: o mesmo usuário, com o mesmo token, vê o recurso quando
// pede COM o atlas em foco e não vê quando pede SEM ele — nem com o id de outro
// atlas. Sem os dois negativos, "vê com atlasId" também é o que se mede quando o
// filtro não filtra nada.
//
// Tabela SEPARADA de `atlas.settings.available_*` de propósito: aquele é
// RESTRITIVO com "vazio = sem restrição" (contrato congelado), este é AMPLIATIVO
// com "vazio = não empresta nada". A mesma estrutura não carrega as duas
// semânticas, e o último caso deste arquivo mede as duas juntas (D1).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';

describe('F5 — o atlas empresta, e o empréstimo é de ESCOPO', () => {
  let app, db, admin, dono, membro, forasteiro, atlas, outroAtlas;
  let tokenAdmin, tokenDono, tokenMembro, tokenForasteiro;
  const sufixo = randomUUID().slice(0, 8);
  const TILESET = `emp-${sufixo}`;

  const visiveis = async (token, atlasId) => {
    const qs = atlasId ? `?atlasId=${atlasId}` : '';
    return (await supertest(app)
      .get(`/api/v1/resource-access/visible${qs}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)).body.data;
  };

  const veTileset = async (token, atlasId) =>
    (await visiveis(token, atlasId)).tilesets.map((t) => t.id).includes(TILESET);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `emp_admin_${sufixo}` });
    dono = await createUser(db, { username: `emp_dono_${sufixo}` });
    membro = await createUser(db, { username: `emp_membro_${sufixo}` });
    forasteiro = await createUser(db, { username: `emp_fora_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenDono = await loginUser(app, dono.username, dono.password);
    tokenMembro = await loginUser(app, membro.username, membro.password);
    tokenForasteiro = await loginUser(app, forasteiro.username, forasteiro.password);

    atlas = await createAtlas(db, dono.id, { name: `Atlas ${sufixo}` });
    outroAtlas = await createAtlas(db, dono.id, { name: `Outro atlas ${sufixo}` });
    await createShare(db, atlas.id, membro.id, 'read', dono.id);
    await createShare(db, outroAtlas.id, membro.id, 'read', dono.id);
    await createShare(db, atlas.id, forasteiro.id, 'read', dono.id);

    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [TILESET, `Tileset ${sufixo}`]
    );
    // O DONO recebe concessão pessoal — é o que sustenta o empréstimo (D4) — e é
    // ela que o torna capaz de anexar.
    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${TILESET}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: dono.id, grantLevel: 'view_share' })
      .expect(201);
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE resource_id = $1', [TILESET]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [TILESET]);
    await db.query('DELETE FROM tilesets WHERE id = $1', [TILESET]);
    await db.query('DELETE FROM atlas WHERE id = ANY($1::uuid[])', [[atlas.id, outroAtlas.id]]);
    await teardownTestEnv(db);
  });

  it('piso: antes de anexar, nem com o atlas em foco o membro vê', async () => {
    assert.equal(await veTileset(tokenMembro, atlas.id), false);
    assert.equal(await veTileset(tokenMembro, null), false);
  });

  it('anexado, o membro vê COM `?atlasId=` e NÃO vê sem ele — nem com o de outro atlas', async () => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/resources`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({ resourceType: 'tileset', resourceId: TILESET })
      .expect(201);
    assert.equal(res.body.data.resource_id, TILESET);

    assert.equal(await veTileset(tokenMembro, atlas.id), true, 'com o atlas em foco, vê');
    assert.equal(await veTileset(tokenMembro, null), false, 'sem atlas em foco, NÃO vê');
    assert.equal(
      await veTileset(tokenMembro, outroAtlas.id), false,
      'com o id de OUTRO atlas (que ele também alcança), NÃO vê'
    );
  });

  it('e o empréstimo alcança QUALQUER membro do atlas, sem concessão pessoal nenhuma', async () => {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM resource_grants WHERE grantee_id = $1 AND revoked_at IS NULL',
      [forasteiro.id]
    );
    assert.equal(rows[0].n, 0, 'piso: este usuário não tem concessão nenhuma');
    assert.equal(await veTileset(tokenForasteiro, atlas.id), true);
  });

  it('a listagem do que o atlas empresta exige só `read`, e mostra quem anexou', async () => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/resources`)
      .set('Authorization', `Bearer ${tokenMembro}`)
      .expect(200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].resource_id, TILESET);
    assert.equal(res.body.data[0].added_by_username, dono.username);

    // Quem não alcança o atlas não lê a lista.
    const estranho = await createUser(db, { username: `emp_estranho_${sufixo}` });
    const tokenEstranho = await loginUser(app, estranho.username, estranho.password);
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/resources`)
      .set('Authorization', `Bearer ${tokenEstranho}`)
      .expect(404);
  });

  it('anexar duas vezes é 409; remover e reanexar volta a passar', async () => {
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/resources`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({ resourceType: 'tileset', resourceId: TILESET })
      .expect(409);

    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}/resources/tileset/${TILESET}`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .expect(200);
    assert.equal(await veTileset(tokenMembro, atlas.id), false, 'removido, o empréstimo acaba');

    // O índice único é PARCIAL (`WHERE removed_at IS NULL`), então a vaga não fica
    // ocupada para sempre — que é o beco sem saída do soft-delete do catálogo.
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/resources`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({ resourceType: 'tileset', resourceId: TILESET })
      .expect(201);
    assert.equal(await veTileset(tokenMembro, atlas.id), true);
  });

  it('atlas na LIXEIRA para de emprestar, e restaurá-lo devolve o empréstimo', async () => {
    // Atlas é soft-deletado, então o `ON DELETE CASCADE` de `atlas_resources` NÃO
    // dispara: quem corta é o `a.deleted_at IS NULL` da função de resolução (R5).
    await db.query('UPDATE atlas SET deleted_at = NOW() WHERE id = $1', [atlas.id]);
    try {
      assert.equal(await veTileset(tokenMembro, atlas.id), false);
    } finally {
      await db.query('UPDATE atlas SET deleted_at = NULL WHERE id = $1', [atlas.id]);
    }
    assert.equal(await veTileset(tokenMembro, atlas.id), true, 'restaurado, o empréstimo volta');
  });

  it('D1 — a allowlist do atlas alcança o emprestado, e o servidor entrega os dois lados', async () => {
    // O servidor NÃO intersecta: ele entrega o conjunto ampliado e a allowlist é
    // aplicada no CLIENTE, sobre o baseline somado. Este caso mede que os dois
    // fatos chegam juntos ao cliente, que é o que torna D1 executável lá.
    await supertest(app)
      .patch(`/api/v1/atlas/${atlas.id}/settings`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({ available_3d_models: ['outro-modelo'] })
      .expect(200);

    assert.equal(
      await veTileset(tokenMembro, atlas.id), true,
      'o payload aditivo continua trazendo o emprestado — quem restringe é o cliente'
    );
    const settings = (await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/settings`)
      .set('Authorization', `Bearer ${tokenMembro}`)
      .expect(200)).body.data;
    assert.deepEqual(
      settings.available_3d_models, ['outro-modelo'],
      'e a allowlist chega inteira, para o cliente intersectar por cima'
    );
  });
});
