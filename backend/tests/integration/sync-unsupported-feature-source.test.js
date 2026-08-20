// Path: tests/integration/sync-unsupported-feature-source.test.js
//
// Diagnostic + contract pin for the scenario the Playwright spec
// `frontend/tests/e2e-ui/browser-military-tools.spec.js` exercises: a feature op whose
// `properties.source` is NOT one of the twenty types listed in `valid_feature_type`
// (003_atlas.sql). The spec used to demand that the push THROW, and it was red
// because the push does not throw. The three candidate explanations were:
//
//   (a) the op is dropped before the INSERT, so nothing reaches the database;
//   (b) the INSERT lands with some other feature_type — WRONG DATA persisted;
//   (c) the database error is swallowed and the batch reports success — a broken
//       contract, because the client believes it synced.
//
// This file settles it by observation, against real Postgres. What actually happens is
// none of the three: the INSERT is attempted, Postgres raises 23514, and the per-op
// SAVEPOINT in `pushOperations` turns that into a FIRST-CLASS per-operation refusal
// (`success: false`, `rejected: true`, `reason`) inside a 200 batch, with log and effect
// rolled back together. That is (a)'s outcome for the data with (c)'s HTTP status but
// NOT (c)'s contract: the ack names the offending op, so the client knows it did not
// sync and can drop it. Per-op refusal is deliberate (2026-07-25): a whole-batch 400
// froze the client queue forever, since it does not dequeue on a non-2xx.
//
// The sibling file `sync-check-constraint-poison.test.js` pins the MIXED batch (one bad
// op must not take a good sibling down). What is pinned HERE, and only here, is the
// batch of ONE — the shape the Playwright spec pushes, where there is no sibling keeping
// the transaction alive and where a regression would most plausibly hide — plus the
// round trip through the snapshot the spec reads back.
//
// Negative control (executed 2026-08-14): adding 'enemy_symbol' to the valid_feature_type
// CHECK in 003_atlas.sql, so the write succeeds, turns the first two tests red (the ack
// comes back `success: true`, and the row IS in `features`). Reverted afterwards.
//
// That control also exposed why the row-level assertion is the load-bearing one: the
// SNAPSHOT test stayed GREEN with the bad row persisted, because `typeToCollection`
// (sync.service.js) has no bucket for an unknown feature_type and simply drops the row on
// the way out. "It does not show up in the snapshot" is therefore NOT evidence that
// nothing was written — reading the table is.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('Push de feição com source fora do CHECK (batch de UMA op)', () => {
  let app, db, user, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: `src_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations });

  /**
   * Builds the same envelope the frontend's `createOperation('feature', 'create', ...)`
   * produces: the type travels only inside `properties.source`, and the server derives
   * the `feature_type` column from it (`deriveFeatureColumns`, sync.service.js).
   * `properties` is spread last so a case can omit `source` entirely.
   */
  const opFeicao = (entityId, properties) => ({
    id: randomUUID(),
    type: 'create',
    target: 'feature',
    targetId: entityId,
    mapId: map.id,
    data: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { id: entityId, marker: 'mk_bogus', ...properties },
    },
    timestamp: Date.now(),
    clientId: 'src-client',
  });

  /** Reads the row back, so a failure can report WHAT persisted instead of just "1 !== 0". */
  const lerFeicao = async (entityId) => {
    const { rows } = await db.query('SELECT id, feature_type, properties FROM features WHERE id = $1', [entityId]);
    return rows;
  };

  it('a op é recusada por operação, com motivo, e o lote responde 200', async () => {
    const id = randomUUID();
    const op = opFeicao(id, { source: 'enemy_symbol' });
    const res = await push([op]);

    assert.equal(res.status, 200, 'batch de uma op inválida não derruba a requisição');
    const results = res.body.data.results;
    assert.equal(results.length, 1, 'uma op enviada, um ack devolvido');
    assert.equal(results[0].operationId, op.id, 'o ack identifica a op ofensora');
    assert.equal(results[0].success, false, 'o cliente NÃO pode ler isto como sincronizado');
    assert.equal(results[0].rejected, true);
    assert.equal(typeof results[0].reason, 'string');
    assert.ok(results[0].reason.length > 0, 'a recusa vem com motivo exibível');
    // The reason must not leak the driver's raw text (schema + locale dependent).
    for (const vazamento of ['constraint', 'check', 'violates', 'sqlstate', 'column']) {
      assert.ok(
        !results[0].reason.toLowerCase().includes(vazamento),
        `o motivo não pode vazar "${vazamento}": ${results[0].reason}`
      );
    }
  });

  it('nada persiste: nem linha em features, nem entrada no log de operações', async () => {
    // This is the (b)/(c) discriminator. If the INSERT had landed under some default or
    // coerced feature_type, `linhas` would be 1 and the message would print the value.
    const id = randomUUID();
    const op = opFeicao(id, { source: 'enemy_symbol' });
    await push([op]).expect(200);

    const linhas = await lerFeicao(id);
    assert.equal(linhas.length, 0, `a feição não pode existir; persistiu: ${JSON.stringify(linhas)}`);

    const { rows: logadas } = await db.query('SELECT op_id FROM operations WHERE op_id = $1', [op.id]);
    assert.equal(logadas.length, 0, 'o savepoint reverte log e efeito juntos');
  });

  it('e o snapshot seguinte não traz a feição em bucket nenhum', async () => {
    // Mirrors the spec's second assertion, which reads the pull, not the table.
    const id = randomUUID();
    await push([opFeicao(id, { source: 'enemy_symbol' })]).expect(200);

    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(res.body.data.isSnapshot, true, 'pull a partir de 0 devolve snapshot');
    const mapa = res.body.data.snapshot.maps.find((m) => m.id === map.id);
    assert.ok(mapa, 'o mapa do cenário está no snapshot');
    const todas = Object.values(mapa.features || {}).filter(Array.isArray).flat();
    assert.ok(todas.length >= 0);
    const vazou = todas.some((f) => f.properties && f.properties.id === id);
    assert.equal(vazou, false, 'a feição recusada não pode aparecer em nenhum bucket');
  });

  it('bordas: source ausente, vazio, ou com caixa trocada também são recusados', async () => {
    // 'Point' is not 'point': the CHECK is case sensitive, and this is the boundary
    // between a valid type and a value that merely looks like one. An absent source
    // leaves feature_type NULL (23502, not 23514) and must be refused the same way,
    // which also proves the refusal is not keyed to a single SQLSTATE.
    const casos = [
      { rotulo: 'source ausente', props: {} },
      { rotulo: 'source vazio', props: { source: '' } },
      { rotulo: 'caixa trocada', props: { source: 'Point' } },
      { rotulo: 'espaço em volta', props: { source: ' point ' } },
    ];

    for (const caso of casos) {
      const id = randomUUID();
      const res = await push([opFeicao(id, caso.props)]);
      assert.equal(res.status, 200, `${caso.rotulo}: lote responde 200`);
      assert.equal(res.body.data.results[0].rejected, true, `${caso.rotulo}: recusada por operação`);
      const linhas = await lerFeicao(id);
      assert.equal(linhas.length, 0, `${caso.rotulo}: não persistiu; achado: ${JSON.stringify(linhas)}`);
    }
  });

  it('controle positivo: a MESMA op com um source militar válido persiste com aquele feature_type', async () => {
    // Without this the four reds above would also be produced by a broken fixture,
    // a wrong route, or an unauthenticated push.
    const id = randomUUID();
    const op = opFeicao(id, { source: 'military_symbol', sidc: 'SFGPUCI-----' });
    const res = await push([op]).expect(200);

    assert.equal(res.body.data.results[0].success, true, 'um source válido não pode ser recusado');
    const linhas = await lerFeicao(id);
    assert.equal(linhas.length, 1, 'a feição válida persiste');
    assert.equal(linhas[0].feature_type, 'military_symbol', 'a coluna é derivada de properties.source');
    assert.equal(linhas[0].properties.sidc, 'SFGPUCI-----', 'as propriedades de domínio sobrevivem');
  });
});
