// Path: tests/integration/sharing-params-validation.test.js
// Item 170 — `:userId` malformado em PUT/DELETE /sharing/users/:userId.
//
// Diferente de users.routes.js, que valida params com `userIdParamsSchema`, as rotas
// de sharing só passam `validate({ body })`: o `:userId` vai direto para o SQL e um
// valor malformado vira 22P02, mapeado para 400 em error-handler.js. O comportamento
// atual é aceitável (o SQL é parametrizado, então é robustez de borda e não
// vazamento), mas não estava preso em lugar nenhum: se o PG_ERROR_MAP perder o 22P02,
// essas duas rotas viram 500 — com texto do driver em dev — sem nenhum teste acusar.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';

const U = () => `shp_${randomUUID().slice(0, 8)}`;

describe('sharing — :userId malformado nas rotas que só validam o body', () => {
  let app, db, owner, ownerTok, membro, atlasA, atlasB;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    owner = await createUser(db, { username: U() });
    ownerTok = await loginUser(app, owner.username, owner.password);
    membro = await createUser(db, { username: U() });

    atlasA = await createAtlas(db, owner.id, { name: `A ${U()}` });
    await createMap(db, atlasA.id);
    atlasB = await createAtlas(db, owner.id, { name: `B ${U()}` });
    await createMap(db, atlasB.id);

    // O membro tem share só no atlas B.
    await createShare(db, atlasB.id, membro.id, 'read', owner.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const como = (metodo, url) =>
    supertest(app)[metodo](url).set('Authorization', `Bearer ${ownerTok}`);

  it('PUT /sharing/users/not-a-uuid → 400 BAD_REQUEST, nunca 500 nem stack', async () => {
    const res = await como('put', `/api/v1/atlas/${atlasA.id}/sharing/users/not-a-uuid`)
      .send({ permission: 'read' })
      .expect(400);

    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.equal(res.body.error.stack, undefined, 'nenhuma stack no corpo');
  });

  it('DELETE /sharing/users/not-a-uuid → 400', async () => {
    const res = await como('delete', `/api/v1/atlas/${atlasA.id}/sharing/users/not-a-uuid`).expect(400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
  });

  it('contraste: no BODY o Joi pega antes, e é 422 (só o caminho de params está descoberto)', async () => {
    const res = await como('post', `/api/v1/atlas/${atlasA.id}/sharing/users`)
      .send({ userId: 'not-a-uuid', permission: 'read' })
      .expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('UUID válido com share em OUTRO atlas → 404 (o UPDATE filtra por atlas_id)', async () => {
    // O share existe, mas no atlas B. Confusão entre atlas não pode virar 200.
    const res = await como('put', `/api/v1/atlas/${atlasA.id}/sharing/users/${membro.id}`)
      .send({ permission: 'write' })
      .expect(404);
    assert.equal(res.body.error.code, 'NOT_FOUND');

    const { rows } = await db.query(
      'SELECT atlas_id, permission FROM atlas_shares WHERE user_id = $1',
      [membro.id]
    );
    assert.equal(rows.length, 1, 'continua existindo um único share');
    assert.equal(rows[0].atlas_id, atlasB.id);
    assert.equal(rows[0].permission, 'read', 'e ele NÃO foi alterado pelo pedido no atlas errado');
  });
});
