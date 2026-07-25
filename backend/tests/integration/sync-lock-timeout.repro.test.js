// Path: tests/integration/sync-lock-timeout.repro.test.js
// Item 51 — `SET LOCAL lock_timeout='5s'` no advisory lock do push → 55P03 →
// ServiceUnavailableError 503.
//
// Regressão registrada no livro-razao.md (2026-07-18, `regressao-propria`): o lock era
// tomado SEM timeout, retendo uma conexão do pool durante toda a espera; com
// poolMax=10, dez pushes concorrentes no mesmo atlas travavam o processo INTEIRO,
// inclusive /auth/login e /health (que usam o mesmo pool e ficariam pendurados na fila
// em vez de responder). O fix foi `SET LOCAL lock_timeout` + ServiceUnavailableError.
//
// Um grep por 503/ServiceUnavailable/lock_timeout em backend/tests não retornava NADA:
// o fix não tinha prendedor. sync-push-serialization.test.js segura o lock por 500 ms,
// sempre ABAIXO do timeout, então remover o SET LOCAL e o catch do 55P03 deixava a
// suíte inteira verde — e o modo de falha voltava a ser a parada global, que é
// justamente o que ninguém detecta por acidente.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

const U = () => `lockto_${randomUUID().slice(0, 8)}`;

// Mesmo namespace do serviço (sync.service.js). Duplicado de propósito: se alguém
// mudar o namespace lá, este teste para de bloquear e a mudança fica visível.
const SYNC_PUSH_LOCK_NAMESPACE = 0x53594e43;

describe('lock_timeout do push → 503 retentável (repro)', () => {
  let app, db, user, token, atlasA, mapA, atlasB, mapB;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    user = await createUser(db, { username: U() });
    token = await loginUser(app, user.username, user.password);
    atlasA = await createAtlas(db, user.id, { name: `A ${U()}` });
    mapA = await createMap(db, atlasA.id);
    atlasB = await createAtlas(db, user.id, { name: `B ${U()}` });
    mapB = await createMap(db, atlasB.id);
  });

  after(async () => {
    // Nunca deixar o lock preso se uma asserção estourou no meio da transação.
    try {
      await db.query('ROLLBACK');
    } catch {
      /* sem transação aberta */
    }
    await teardownTestEnv(db);
  });

  const featureOp = (mapId) => ({
    id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: randomUUID(),
    mapId,
    data: { type: 'Feature', geometry: { type: 'Point', coordinates: [-43, -22] }, properties: { source: 'point' } },
    timestamp: Date.now(), clientId: 'lockto-client',
  });

  const push = (atlasId, op) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlasId}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [op] });

  it('lock segurado além dos 5s: 503 com corpo retentável, sem pendurar e sem persistir', async () => {
    const op = featureOp(mapA.id);

    // Segura o lock do atlas A numa conexão INDEPENDENTE por mais que o timeout.
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
      SYNC_PUSH_LOCK_NAMESPACE,
      atlasA.id,
    ]);

    const t0 = Date.now();
    const res = await push(atlasA.id, op);
    const decorrido = Date.now() - t0;

    await db.query('ROLLBACK');

    assert.equal(res.status, 503, 'contenção prolongada vira 503, não 500 nem pendura');
    assert.ok(
      decorrido >= 4500 && decorrido < 12000,
      `a resposta tem de chegar por volta do timeout de 5s (levou ${decorrido}ms)`
    );

    // Contrato para o cliente decidir retry.
    assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
    assert.match(res.body.error.message, /Tente novamente/i, 'mensagem retentável em pt-BR');

    // Nada da op rejeitada persiste.
    const { rows: ops } = await db.query('SELECT id FROM operations WHERE op_id = $1', [op.id]);
    assert.equal(ops.length, 0);
    const { rows: feats } = await db.query('SELECT id FROM features WHERE id = $1', [op.entityId]);
    assert.equal(feats.length, 0);
  });

  it('durante a espera, /health segue respondendo: a conexão presa não esgota o pool', async () => {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
      SYNC_PUSH_LOCK_NAMESPACE,
      atlasA.id,
    ]);

    const pushEmVoo = push(atlasA.id, featureOp(mapA.id));

    // Enquanto o push espera pelo lock, o resto do servidor tem de continuar vivo.
    const health = await supertest(app).get('/api/v1/health');
    assert.equal(health.status, 200, 'o sintoma original era exatamente /health pendurar');

    const res = await pushEmVoo;
    await db.query('ROLLBACK');
    assert.equal(res.status, 503);
  });

  it('escopo: com o lock do atlas A segurado, um push no atlas B responde 200 normalmente', async () => {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
      SYNC_PUSH_LOCK_NAMESPACE,
      atlasA.id,
    ]);

    const res = await push(atlasB.id, featureOp(mapB.id));
    await db.query('ROLLBACK');

    assert.equal(res.status, 200, 'o lock é por atlas, não global');
    assert.equal(res.body.data.results[0].success, true);
  });
});
