// Path: tests/integration/atlas-emprestimo-anexo-autorizado.test.js
//
// O GATE DE ANEXAR É DUPLO (fase F5).
//
// `manage` no atlas NÃO basta. Quem anexa precisa também VER o recurso, senão um
// co-Gestor emprestaria por adivinhação de id um recurso que ele mesmo não pode
// abrir — e o empréstimo o entregaria a todos os membros do atlas.
//
// A resposta é 404 e não 403, e a escolha é deliberada: um recurso que o ator não
// enxerga precisa ser indistinguível de um que não existe, senão o próprio 403
// confirma a existência e a rota vira um oráculo de inventário. É a mesma escada
// que `enforceProjectReadable` usa no 360.
//
// Cada negativo carrega o positivo do MESMO par: o mesmo ator, no mesmo corpo,
// depois de receber a concessão. Sem isso, o 404 também é o que se mede quando a
// fixture não existe.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';

describe('F5 — anexar exige `manage` E ver o recurso', () => {
  let app, db, admin, dono, coGestor, editor, atlas;
  let tokenAdmin, tokenDono, tokenCoGestor, tokenEditor;
  const sufixo = randomUUID().slice(0, 8);
  const TILESET = `anx-${sufixo}`;

  const anexar = (token, resourceId = TILESET) => supertest(app)
    .post(`/api/v1/atlas/${atlas.id}/resources`)
    .set('Authorization', `Bearer ${token}`)
    .send({ resourceType: 'tileset', resourceId });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `anx_admin_${sufixo}` });
    dono = await createUser(db, { username: `anx_dono_${sufixo}` });
    coGestor = await createUser(db, { username: `anx_gestor_${sufixo}` });
    editor = await createUser(db, { username: `anx_editor_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenDono = await loginUser(app, dono.username, dono.password);
    tokenCoGestor = await loginUser(app, coGestor.username, coGestor.password);
    tokenEditor = await loginUser(app, editor.username, editor.password);

    atlas = await createAtlas(db, dono.id, { name: `Atlas anexo ${sufixo}` });
    await createShare(db, atlas.id, coGestor.id, 'manage', dono.id);
    await createShare(db, atlas.id, editor.id, 'write', dono.id);

    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [TILESET, `Tileset anexo ${sufixo}`]
    );
    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${TILESET}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: dono.id, grantLevel: 'view' })
      .expect(201);
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE resource_id = $1', [TILESET]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [TILESET]);
    await db.query('DELETE FROM tilesets WHERE id = $1', [TILESET]);
    await db.query('DELETE FROM atlas WHERE id = $1', [atlas.id]);
    await teardownTestEnv(db);
  });

  it('co-Gestor SEM acesso ao recurso recebe 404, mesmo com `manage`', async () => {
    await anexar(tokenCoGestor).expect(404);
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM atlas_resources WHERE resource_id = $1', [TILESET]
    );
    assert.equal(rows[0].n, 0, 'o 404 precisa ser sem efeito — nada foi anexado');
  });

  it('e o MESMO co-Gestor, com a concessão, recebe 201 no mesmo corpo', async () => {
    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${TILESET}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: coGestor.id, grantLevel: 'view' })
      .expect(201);

    const res = await anexar(tokenCoGestor).expect(201);
    assert.equal(res.body.data.resource_id, TILESET);
  });

  it('quem tem só `write` não anexa nem remove, mesmo enxergando o recurso', async () => {
    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${TILESET}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: editor.id, grantLevel: 'view' })
      .expect(201);

    // O gate de atlas roda ANTES do de recurso, então este é 403 e não 404: o
    // editor alcança o atlas, e o que falta é o nível.
    await anexar(tokenEditor).expect(403);
    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}/resources/tileset/${TILESET}`)
      .set('Authorization', `Bearer ${tokenEditor}`)
      .expect(403);
    // Discriminação: o dono (nível `owner`, acima de `manage`) remove.
    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}/resources/tileset/${TILESET}`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .expect(200);
  });

  it('REMOVER não exige ver o recurso — senão o empréstimo ficaria preso', async () => {
    // Quem tem `manage` precisa poder retirar o que outro Gestor anexou, inclusive
    // um recurso que ele mesmo não enxerga. É a assimetria deliberada entre as duas
    // rotas, e sem este caso ninguém saberia que ela é intencional.
    await anexar(tokenDono).expect(201);
    const { rows } = await db.query(
      `SELECT id FROM resource_grants
        WHERE resource_id = $1 AND grantee_id = $2 AND revoked_at IS NULL`,
      [TILESET, coGestor.id]
    );
    assert.equal(rows.length, 1, 'piso: o co-Gestor tem uma concessão viva a revogar');
    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${rows[0].id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    // Agora ele não vê o recurso, e ainda assim remove o empréstimo.
    await supertest(app)
      .delete(`/api/v1/atlas/${atlas.id}/resources/tileset/${TILESET}`)
      .set('Authorization', `Bearer ${tokenCoGestor}`)
      .expect(200);
  });

  it('recurso inexistente é 404, e tipo fora da whitelist morre na borda (422)', async () => {
    await anexar(tokenDono, `nao-existe-${sufixo}`).expect(404);
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/resources`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({ resourceType: 'users', resourceId: 'x' })
      .expect(422);
    // Discriminação: o corpo válido, do mesmo ator, passa.
    await anexar(tokenDono).expect(201);
  });
});
