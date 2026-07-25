// Path: tests/integration/sync-cleanup-boundaries.test.js
// Item 135 — bordas de `POST /sync/admin/cleanup`: a coerção de `keepFromVersion` no
// controller e o ramo `keepDays` do serviço.
//
// DEFEITO CONFIRMADO E CORRIGIDO (2026-07-25, sync.controller.js): o Joi aceita
// `keepFromVersion: 0` (`min(0)`), mas o controller fazia
// `keepFromVersion ? parseInt(...) : undefined` — o zero caía como falsy, virava
// `undefined`, e o serviço executava o OUTRO ramo, um expurgo por `keepDays` (7, o
// default do Joi). O administrador que pedia "preserve tudo a partir da versão 0"
// disparava na verdade um apagamento de sete dias, com 200 e sem sinal nenhum.
//
// O teste que PARECIA cobrir isso (sync-gaps.test.js, "keepFromVersion=0 returns
// deletedCount 0") passava por outro motivo: o atlas dele só tem ops recentes, então o
// ramo keepDays coincidentemente não apagava nada. Aqui a diferença fica observável
// porque existe uma op ANTIGA para o ramo errado apagar.
//
// O ramo keepDays também nunca havia sido provado APAGANDO (sync.test.js limpa com
// keepDays:7 sobre ops recém-criadas, deletando zero).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

const U = () => `clean_${randomUUID().slice(0, 8)}`;

describe('cleanup de operações — bordas de keepFromVersion e keepDays', () => {
  let app, db, user, token, adminToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    user = await createUser(db, { username: U() });
    token = await loginUser(app, user.username, user.password);
    const admin = await createAdminUser(db, { username: U() });
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const featureOp = (mapId, nome) => ({
    id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: randomUUID(),
    mapId,
    data: { feature_type: 'point', geometry: { coordinates: [-43.2, -22.9] }, properties: { name: nome } },
    timestamp: Date.now(), clientId: 'clean-client',
  });

  const push = (atlasId, ops) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlasId}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: ops });

  const cleanup = (atlasId, body) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlasId}/sync/admin/cleanup`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);

  /** Atlas com uma op de 30 dias atrás e uma recente. */
  async function atlasComOpAntiga() {
    const atlas = await createAtlas(db, user.id, { name: `Atlas ${U()}` });
    const map = await createMap(db, atlas.id);

    const antiga = featureOp(map.id, 'antiga');
    await push(atlas.id, [antiga]).expect(200);
    await db.query(
      `UPDATE operations SET created_at = NOW() - INTERVAL '30 days' WHERE atlas_id = $1 AND op_id = $2`,
      [atlas.id, antiga.id]
    );

    const recente = featureOp(map.id, 'recente');
    const res = await push(atlas.id, [recente]).expect(200);
    const versaoRecente = Number(res.body.data.results[0].currentVersion);

    return { atlas, map, antiga, recente, versaoRecente };
  }

  it('keepDays: 7 apaga a op de 30 dias, preserva a recente e sobe min_version', async () => {
    const { atlas, antiga, recente, versaoRecente } = await atlasComOpAntiga();

    const res = await cleanup(atlas.id, { keepDays: 7 }).expect(200);
    assert.equal(res.body.data.deletedCount, 1, 'o ramo keepDays tem de apagar de verdade');
    assert.equal(res.body.data.newMinVersion, versaoRecente);

    const { rows } = await db.query(
      'SELECT op_id FROM operations WHERE atlas_id = $1 ORDER BY server_version',
      [atlas.id]
    );
    assert.deepEqual(rows.map((r) => r.op_id), [recente.id], 'só a recente permanece');
    assert.equal(rows.some((r) => r.op_id === antiga.id), false);

    const { rows: minRows } = await db.query('SELECT min_version FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(Number(minRows[0].min_version), versaoRecente);
  });

  it('keepFromVersion: 0 NÃO apaga nada — o zero é um pedido válido, não um ausente', async () => {
    const { atlas, antiga } = await atlasComOpAntiga();

    const res = await cleanup(atlas.id, { keepFromVersion: 0 }).expect(200);
    assert.equal(res.body.data.deletedCount, 0, '"preserve tudo a partir de 0" não apaga nada');

    const { rows } = await db.query(
      'SELECT op_id FROM operations WHERE atlas_id = $1 AND op_id = $2',
      [atlas.id, antiga.id]
    );
    assert.equal(rows.length, 1, 'a op de 30 dias continua lá (o ramo keepDays NÃO rodou)');

    const { rows: minRows } = await db.query('SELECT min_version FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(Number(minRows[0].min_version), 0, 'e min_version não foi mexido');
  });

  it('atlas sem nenhuma operação: keepDays retorna zeros e não mexe em min_version', async () => {
    const atlas = await createAtlas(db, user.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);

    const res = await cleanup(atlas.id, { keepDays: 7 }).expect(200);
    assert.equal(res.body.data.deletedCount, 0);
    assert.equal(res.body.data.newMinVersion, 0);

    const { rows } = await db.query('SELECT min_version FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(Number(rows[0].min_version), 0, 'early-return de min_keep_version null');
  });

  it('depois do expurgo por keepDays, um pull da versão expurgada vira snapshot', async () => {
    const { atlas } = await atlasComOpAntiga();

    await cleanup(atlas.id, { keepDays: 7 }).expect(200);
    const { rows } = await db.query('SELECT min_version FROM atlas WHERE id = $1', [atlas.id]);
    const min = Number(rows[0].min_version);
    assert.ok(min > 0, 'o expurgo subiu min_version (guarda do próprio caso)');

    const pull = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/${min - 1}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(
      pull.body.data.isSnapshot,
      true,
      'o ciclo cleanup → min_version → snapshot fecha também pelo ramo keepDays'
    );
    assert.ok(pull.body.data.snapshot);
  });
});
