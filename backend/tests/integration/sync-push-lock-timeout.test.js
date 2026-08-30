// Path: tests/integration/sync-push-lock-timeout.test.js
// Item 64 (testes-backend.md) — the per-atlas advisory lock FAILS FAST instead of
// holding a pool connection forever.
//
// livro-razao (2026-07-18, regressão-própria): a lock taken after the transaction
// was open exhausted the pool. The fix has two halves — take the lock first, and
// bound the wait with `SET LOCAL lock_timeout = '5s'` so 55P03 becomes a retryable
// 503 (sync.service.js:1049-1064). Only the first half was pinned:
// sync-push-serialization.test.js holds the lock for 500 ms, far below the 5 s
// threshold, so it cannot distinguish "waited and got in" from "would wait forever".
// Deleting the SET LOCAL and the 55P03 catch left the whole suite green while ten
// concurrent pushes to one atlas (poolMax=10) froze the entire process — /health and
// /auth/login included, since they share the pool.
//
// This is the ONLY test in the repo that crosses the 5 s threshold. It is slow by
// construction: the invariant IS the deadline.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';

// Must match SYNC_PUSH_LOCK_NAMESPACE in src/modules/sync/sync.service.js.
const SYNC_PUSH_LOCK_NAMESPACE = 0x53594e43;

function pointOp(mapId, opId) {
  const featureId = randomUUID();
  return {
    id: opId,
    entityType: 'feature',
    operationType: 'create',
    entityId: featureId,
    mapId,
    data: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
      properties: { id: featureId, source: 'point', nome: 'ponto do timeout' },
    },
    timestamp: Date.now(),
    clientId: 'lock-timeout-client',
  };
}

describe('sync push — the advisory lock wait is BOUNDED (503, not a hung pool)', () => {
  let app, db, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const user = await createUser(db, { username: `locktmo_${randomUUID().slice(0, 6)}` });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    // Never leave the lock held if an assertion threw mid-transaction.
    try {
      await db.query('ROLLBACK');
    } catch {
      /* no open transaction */
    }
    await teardownTestEnv(db);
  });

  it('answers 503 within the deadline, persists nothing, and stays idempotent on retry', async () => {
    const opId = randomUUID();
    const batch = { operations: [pointOp(map.id, opId)] };

    // Hold the atlas push lock on an independent connection for LONGER than the 5 s
    // lock_timeout — this is what sync-push-serialization.test.js never does.
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
      SYNC_PUSH_LOCK_NAMESPACE,
      atlas.id,
    ]);

    const startedAt = Date.now();
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send(batch);
    const elapsed = Date.now() - startedAt;

    // 1. It SETTLES, and it settles as a retryable 503 — not a 500, not a hang.
    assert.equal(res.status, 503, `expected 503, got ${res.status} ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
    assert.match(res.body.error.message, /ocupado processando outra sincroniza/i);

    // 2. Within the deadline. Without SET LOCAL lock_timeout this request never
    //    settles at all and the assertion above would time the test out instead.
    assert.ok(elapsed >= 4500, `it must actually WAIT for the lock (waited ${elapsed}ms)`);
    assert.ok(elapsed < 15000, `it must give up near the 5s deadline (waited ${elapsed}ms)`);

    // 3. The transaction was undone: nothing from the batch reached the log.
    const { rows: opRows } = await db.query(
      'SELECT 1 FROM operations WHERE atlas_id = $1 AND op_id = $2',
      [atlas.id, opId],
    );
    assert.equal(opRows.length, 0, 'a refused push must persist no operation');

    // 4. Releasing the lock and retrying the SAME batch succeeds exactly once —
    //    the failure path did not break idempotency by op_id.
    await db.query('ROLLBACK');

    const retry = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send(batch)
      .expect(200);
    assert.equal(retry.body.data.results[0].success, true);

    const again = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send(batch)
      .expect(200);
    assert.equal(again.body.data.results[0].idempotent, true, 'the replay is recognized');

    const { rows: finalRows } = await db.query(
      'SELECT 1 FROM operations WHERE atlas_id = $1 AND op_id = $2',
      [atlas.id, opId],
    );
    assert.equal(finalRows.length, 1, 'exactly one row for the op, after 503 + retry + replay');
  });

  it('the 503 is scoped to the contended atlas — another atlas is served normally meanwhile', async () => {
    // The point of failing fast is that ONE atlas under contention must not take the
    // server down. A pushed-but-unbounded wait would hold a pool connection here too.
    const other = await createAtlas(db, (await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id])).rows[0].owner_id);
    const otherMap = await createMap(db, other.id);

    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
      SYNC_PUSH_LOCK_NAMESPACE,
      atlas.id,
    ]);

    // Health stays answerable while the contended atlas is locked.
    await supertest(app).get('/api/v1/health').expect(200);

    await supertest(app)
      .post(`/api/v1/atlas/${other.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [pointOp(otherMap.id, randomUUID())] })
      .expect(200);

    await db.query('ROLLBACK');
  });

  // ---------------------------------------------------------------------------
  // Item 182 — a LIBERAÇÃO do lock no caminho de ERRO.
  //
  // O comentário em sync.service.js afirma que o lock é transaction-scoped e que não
  // vaza em erro. Isso é prosa: sync-push-serialization.test.js só exercita o caminho
  // feliz, e os dois casos acima só o caminho do TIMEOUT (em que o lock nem chegou a
  // ser tomado por este push). Falta a forma que originou a lição no livro-razão: o
  // push TOMA o lock, aborta no meio do lote, e o atlas fica travado para todos os
  // outros clientes.
  //
  // Cada caso afirma as DUAS metades — o erro esperado E que o atlas segue servível
  // logo depois. O 4xx sozinho não prova nada: ele aparece igual com o lock preso.
  // ---------------------------------------------------------------------------

  /**
   * Tries to take the atlas push lock from an INDEPENDENT connection, without
   * waiting. Returns whether it was granted; always leaves the transaction rolled
   * back so the probe itself never becomes the next test's contention.
   */
  async function lockLivre(atlasId) {
    await db.query('BEGIN');
    try {
      const { rows } = await db.query(
        'SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS ok',
        [SYNC_PUSH_LOCK_NAMESPACE, atlasId],
      );
      return rows[0].ok === true;
    } finally {
      await db.query('ROLLBACK');
    }
  }

  it('push barrado por permissão (403): o lock é liberado e o atlas segue servível', async () => {
    // Um leitor empurrando uma escrita: assertOperationAllowed lança ForbiddenError
    // DEPOIS de o lock já ter sido tomado, dentro da mesma transação.
    const leitor = await createUser(db, { username: `lockerr_${randomUUID().slice(0, 6)}` });
    await createShare(db, atlas.id, leitor.id, 'read', atlas.owner_id);
    const tokenLeitor = await loginUser(app, leitor.username, leitor.password);

    const negado = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${tokenLeitor}`)
      .send({ operations: [pointOp(map.id, randomUUID())] });
    assert.equal(negado.status, 403, `esperado 403, veio ${negado.status}`);

    // Metade 1: prova DIRETA — uma conexão externa consegue o lock imediatamente.
    assert.equal(await lockLivre(atlas.id), true, 'o lock ficou preso após o 403');

    // Metade 2: prova pelo comportamento — um push legítimo passa sem esperar.
    const opId = randomUUID();
    const ok = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [pointOp(map.id, opId)] })
      .expect(200);
    assert.equal(ok.body.data.results[0].success, true);
  });

  it('push com mapId malformado (erro nascido no Postgres): recusa por op, e o lock é liberado', async () => {
    // ESTE CASO MUDOU DE ALVO EM 2026-08-30, e a mudança é o registro de um conserto.
    // Ele media a saída da tx por um erro nascido no POSTGRES, e usava como gatilho um
    // mapId não-UUID, que estourava 22P02 na consulta de `lockedMapDenialReason` — feita,
    // até aquela data, FORA do savepoint por operação. Isso abortava o lote inteiro e
    // devolvia 400 a cada flush de 1,5 s, para sempre, porque o cliente não faz dequeue de
    // não-2xx: era defeito, não modo de falha legítimo. As duas recusas que consultam o
    // banco desceram para dentro do savepoint, então o MESMO gatilho hoje termina em recusa
    // POR OPERAÇÃO, com a transação COMMITADA. Ver
    // `tests/integration/sync-mapid-nao-uuid-poison.repro.test.js`.
    //
    // O que ele prende agora é a metade que continua sendo assunto deste arquivo: um lote
    // que sai pelo caminho da recusa não deixa o advisory lock preso. A saída por ABORTO
    // continua prendida pelo caso anterior (403 de política, exceção de aplicação lançada
    // depois de o lock já ter sido tomado), que é o mesmo ROLLBACK.
    const opRuim = pointOp('nao-e-um-uuid', randomUUID()); // mapId que estoura o cast ::uuid
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [opRuim] });
    assert.equal(res.status, 200, `o lote não pode mais cair por causa de uma op, veio ${res.status}`);
    assert.equal(res.body.data.results[0].rejected, true, 'e a op ofensora é recusada individualmente');

    assert.equal(await lockLivre(atlas.id), true, 'o lock ficou preso após a recusa');

    const opId = randomUUID();
    const ok = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [pointOp(map.id, opId)] })
      .expect(200);
    assert.equal(ok.body.data.results[0].success, true, 'o atlas seguinte não pode ficar travado');
  });

  it('guarda: a sonda do lock realmente detecta um lock preso (senão ela provaria nada)', async () => {
    // Sem este caso, `lockLivre()` poderia estar devolvendo true sempre — por exemplo
    // se o namespace ou a chave estivessem errados — e os dois testes acima seriam
    // verdes vazios.
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
      SYNC_PUSH_LOCK_NAMESPACE,
      atlas.id,
    ]);
    // Uma SEGUNDA sessão não consegue o mesmo lock. `db` é uma única conexão, então a
    // sonda precisa ser feita de fora dela: pg_advisory_xact_lock é reentrante na
    // MESMA sessão e devolveria true por engano.
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM pg_locks
        WHERE locktype = 'advisory' AND classid = $1 AND granted`,
      [SYNC_PUSH_LOCK_NAMESPACE],
    );
    assert.ok(rows[0].n >= 1, 'o lock precisa aparecer em pg_locks enquanto está detido');
    await db.query('ROLLBACK');

    const { rows: depois } = await db.query(
      `SELECT count(*)::int AS n FROM pg_locks
        WHERE locktype = 'advisory' AND classid = $1 AND granted`,
      [SYNC_PUSH_LOCK_NAMESPACE],
    );
    assert.equal(depois[0].n, 0, 'e desaparecer no ROLLBACK — o lock é transaction-scoped');
  });
});
