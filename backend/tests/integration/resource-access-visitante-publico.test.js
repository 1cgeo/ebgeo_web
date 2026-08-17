// Path: tests/integration/resource-access-visitante-publico.test.js
//
// O VISITANTE DE LINK PÚBLICO E O EMPRÉSTIMO (R4, fase F5).
//
// Ele HERDA o empréstimo, e deve: "compartilhei o atlas, todos que acessarem
// acessam os recursos" inclui o link público. A resolução funciona porque o ramo
// de empréstimo depende de `p_atlas_id`, não de `p_user_id` — e os outros dois
// ramos morrem quando o usuário é nulo.
//
// DUAS ARMADILHAS, e as duas viram caso aqui.
//
//   O SUB SINTÉTICO. O principal dele é `public-<uuid>`, sem linha em `users`.
//   Mandá-lo para um cast `::uuid` levanta 22P02, que o errorHandler devolve como
//   HTTP 400 sem relação aparente com a causa — `principalUserId` existe por causa
//   desse defeito. O valor correto é NULL, e o caso de 200 aqui é o que prova que
//   ele chega como NULL.
//
//   O CONFINAMENTO. `confineVisitorPrincipal` (dentro de `auth`) compara
//   `req.params.atlasId` com o `publicAtlasId` do token. Como esta rota recebe o
//   atlas na QUERY, sem `liftOptionalAtlasId` ANTES de `auth` o visitante levaria
//   403 na própria rota que deveria lhe entregar os recursos. E o mesmo mecanismo é
//   o que impede o token de UM atlas de alcançar o empréstimo de outro.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createAtlas, loginUser, makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';

describe('R4 — o visitante de link público herda o empréstimo, e só o do atlas dele', () => {
  let app, db, admin, dono, atlasA, atlasB, tokenAdmin, tokenDono;
  let tokenPublicoA, tokenPublicoB;
  const sufixo = randomUUID().slice(0, 8);
  const TILESET = `pub-${sufixo}`;

  const visiveis = (token, atlasId) => supertest(app)
    .get(`/api/v1/resource-access/visible?atlasId=${atlasId}`)
    .set('Authorization', `Bearer ${token}`);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `pub_admin_${sufixo}` });
    dono = await createUser(db, { username: `pub_dono_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenDono = await loginUser(app, dono.username, dono.password);

    atlasA = await createAtlas(db, dono.id, { name: `Atlas A ${sufixo}` });
    atlasB = await createAtlas(db, dono.id, { name: `Atlas B ${sufixo}` });
    tokenPublicoA = await getPublicToken(app, await makeAtlasPublic(db, atlasA.id));
    tokenPublicoB = await getPublicToken(app, await makeAtlasPublic(db, atlasB.id));

    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [TILESET, `Tileset público ${sufixo}`]
    );
    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${TILESET}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: dono.id, grantLevel: 'view' })
      .expect(201);
    // SÓ o atlas A empresta.
    await supertest(app)
      .post(`/api/v1/atlas/${atlasA.id}/resources`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({ resourceType: 'tileset', resourceId: TILESET })
      .expect(201);
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE resource_id = $1', [TILESET]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [TILESET]);
    await db.query('DELETE FROM tilesets WHERE id = $1', [TILESET]);
    await db.query('DELETE FROM atlas WHERE id = ANY($1::uuid[])', [[atlasA.id, atlasB.id]]);
    await teardownTestEnv(db);
  });

  it('o token do atlas CERTO alcança o empréstimo (200, e o recurso está lá)', async () => {
    // Se o sub sintético fosse para o cast `::uuid`, isto seria 400 e não 200 — a
    // resposta que não parece ter relação nenhuma com o assunto.
    const res = await visiveis(tokenPublicoA, atlasA.id).expect(200);
    assert.ok(res.body.data.tilesets.map((t) => t.id).includes(TILESET));
  });

  it('o token de OUTRO atlas não alcança este: 403 do confinamento', async () => {
    await visiveis(tokenPublicoB, atlasA.id).expect(403);
  });

  it('e o token do atlas B, no atlas B, é 200 e NÃO traz o recurso', async () => {
    // A discriminação que separa "o confinamento funcionou" de "a rota está
    // quebrada para visitante": o mesmo token responde 200 no lugar certo, e o
    // conjunto vem vazio porque o atlas B não empresta nada.
    const res = await visiveis(tokenPublicoB, atlasB.id).expect(200);
    assert.ok(!res.body.data.tilesets.map((t) => t.id).includes(TILESET));
  });

  it('sem `?atlasId=`, o visitante não recebe nada — o empréstimo é de ESCOPO', async () => {
    // Sem atlas em foco o ramo de empréstimo morre, e o de concessão pessoal já
    // estava morto (ele não tem linha em `users`). Sobra o conjunto vazio.
    // 403 e não 200: sem `atlasId` no caminho, `confineVisitorPrincipal` não acha o
    // atlas do token e recusa. É o comportamento do middleware de confinamento, e
    // fica escrito aqui porque um 200 vazio e este 403 são estados diferentes.
    const res = await supertest(app)
      .get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokenPublicoA}`)
      .expect(403);
    assert.match(
      JSON.stringify(res.body), /link público/,
      'a recusa precisa ser a do CONFINAMENTO, e não um 403 qualquer'
    );
  });

  it('o empréstimo removido some para o visitante também', async () => {
    await supertest(app)
      .delete(`/api/v1/atlas/${atlasA.id}/resources/tileset/${TILESET}`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .expect(200);
    const res = await visiveis(tokenPublicoA, atlasA.id).expect(200);
    assert.ok(!res.body.data.tilesets.map((t) => t.id).includes(TILESET));
  });
});
