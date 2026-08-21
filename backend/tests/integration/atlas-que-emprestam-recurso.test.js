// Path: tests/integration/atlas-que-emprestam-recurso.test.js
//
// `atlasesLendingResource` — a pergunta INVERSA do empréstimo por atlas: dado um
// recurso, que atlas o emprestam AGORA. Ela é o endereço das salas que a revogação
// acorda (`tests/ws/revogacao-avisa-atlas-que-empresta.test.js`), e por isso o que ela
// devolve a mais é ruído e o que ela devolve a menos é o defeito.
//
// Não é consulta de autorização: nada aqui decide quem vê o quê. O que se mede é
// VIVACIDADE (empréstimo desfeito e atlas na lixeira somem) e RECORTE (o par tipo+id é
// exato, não um dos dois).
//
// O PISO É O PRIMEIRO CASO, e sem ele os demais não valeriam nada: uma consulta que
// nunca devolvesse linha nenhuma passaria idêntica em todos os "sumiu".

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import { atlasesLendingResource } from '../../src/modules/resource-access/resource-access.service.js';

describe('atlasesLendingResource: o empréstimo VIVO, e só ele', () => {
  let app, db, admin, dono, tokenAdmin, tokenDono;
  let atlasA, atlasC, atlasD;
  const sufixo = randomUUID().slice(0, 8);
  const TILESET = `lend-${sufixo}`;
  const OUTRO_TILESET = `lend-outro-${sufixo}`;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `lend_admin_${sufixo}` });
    dono = await createUser(db, { username: `lend_dono_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenDono = await loginUser(app, dono.username, dono.password);

    for (const id of [TILESET, OUTRO_TILESET]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, sort_order, access_level)
         VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
        [id, `Tileset ${id}`]
      );
    }
    // A concessão pessoal ao dono é o que o torna capaz de anexar pelas rotas reais.
    for (const id of [TILESET, OUTRO_TILESET]) {
      await supertest(app)
        .post(`/api/v1/resource-access/tileset/${id}/grants`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ granteeId: dono.id, grantLevel: 'view_share' })
        .expect(201);
    }

    atlasA = await createAtlas(db, dono.id, { name: `A ${sufixo}` });
    atlasC = await createAtlas(db, dono.id, { name: `C ${sufixo}` });
    atlasD = await createAtlas(db, dono.id, { name: `D ${sufixo}` });
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE resource_id = ANY($1::text[])',
      [[TILESET, OUTRO_TILESET]]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])',
      [[TILESET, OUTRO_TILESET]]);
    await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])', [[TILESET, OUTRO_TILESET]]);
    await db.query('DELETE FROM atlas WHERE id = ANY($1::uuid[])', [[atlasA.id, atlasC.id, atlasD.id]]);
    await teardownTestEnv(db);
  });

  const anexar = (atlasId, resourceId) => supertest(app)
    .post(`/api/v1/atlas/${atlasId}/resources`)
    .set('Authorization', `Bearer ${tokenDono}`)
    .send({ resourceType: 'tileset', resourceId })
    .expect(201);

  it('PISO: anexado pela rota real, o atlas aparece na consulta', async () => {
    await anexar(atlasA.id, TILESET);
    const salas = await atlasesLendingResource('tileset', TILESET);
    assert.deepEqual(salas, [atlasA.id]);
  });

  it('DESTACADO some, e some sem apagar linha nenhuma (soft)', async () => {
    await supertest(app)
      .delete(`/api/v1/atlas/${atlasA.id}/resources/tileset/${TILESET}`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .expect(200);

    assert.deepEqual(await atlasesLendingResource('tileset', TILESET), []);

    const { rows } = await db.query(
      'SELECT removed_at FROM atlas_resources WHERE atlas_id = $1 AND resource_id = $2',
      [atlasA.id, TILESET]
    );
    assert.equal(rows.length, 1, 'a linha continua lá: quem sumiu foi da CONSULTA, não do banco');
    assert.ok(rows[0].removed_at, 'e o que a tirou da consulta é `removed_at`');
  });

  it('atlas na LIXEIRA para de emprestar, e restaurá-lo devolve o empréstimo', async () => {
    await anexar(atlasC.id, TILESET);
    assert.deepEqual(await atlasesLendingResource('tileset', TILESET), [atlasC.id], 'piso deste caso');

    await db.query('UPDATE atlas SET deleted_at = NOW() WHERE id = $1', [atlasC.id]);
    assert.deepEqual(await atlasesLendingResource('tileset', TILESET), []);

    // A volta é o par que impede "a consulta parou de devolver C" de significar
    // "a consulta parou de devolver qualquer coisa".
    await db.query('UPDATE atlas SET deleted_at = NULL WHERE id = $1', [atlasC.id]);
    assert.deepEqual(await atlasesLendingResource('tileset', TILESET), [atlasC.id]);
  });

  it('DISCRIMINAÇÃO: quem empresta OUTRO recurso do mesmo tipo não entra', async () => {
    await anexar(atlasD.id, OUTRO_TILESET);

    // D existe, empresta, está vivo — e mesmo assim não é sala de TILESET.
    assert.deepEqual(await atlasesLendingResource('tileset', OUTRO_TILESET), [atlasD.id],
      'piso: D é sala do recurso que ele de fato empresta');
    assert.deepEqual(await atlasesLendingResource('tileset', TILESET), [atlasC.id],
      'e não aparece na consulta do outro recurso');
  });

  it('DISCRIMINAÇÃO: o mesmo id TEXTUAL em outro tipo é outro recurso', async () => {
    // Escrito direto na tabela de propósito: `atlas_resources.resource_id` é TEXT sem FK,
    // então o mesmo texto pode nomear um `tileset` e um `data_layer` distintos. Um filtro
    // que casasse só o id juntaria os dois, e o aviso iria para a sala errada.
    await db.query(
      `INSERT INTO atlas_resources (atlas_id, resource_type, resource_id, added_by)
       VALUES ($1::uuid, 'data_layer', $2, $3::uuid)`,
      [atlasD.id, TILESET, dono.id]
    );

    assert.deepEqual(await atlasesLendingResource('data_layer', TILESET), [atlasD.id],
      'piso: a linha nova existe e a consulta a acha pelo par certo');
    assert.deepEqual(await atlasesLendingResource('tileset', TILESET), [atlasC.id],
      'e o par (tileset, mesmo id) continua devolvendo só C');
  });

  it('recurso que ninguém empresta devolve lista vazia, e não erro', async () => {
    assert.deepEqual(await atlasesLendingResource('tileset', `inexistente-${sufixo}`), []);
  });
});
