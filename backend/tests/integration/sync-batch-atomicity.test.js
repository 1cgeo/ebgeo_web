// Path: tests/integration/sync-batch-atomicity.test.js
// One push = one transaction. The frontend sends destructive BATCH operations as a
// single operations[] push: mass reschedule (§29.12), delete-all-features-of-a-
// tileset/photo (§2.19/§2.23) and delete-attribute-column (§18.6) are thus atomic —
// if an op in the batch FAILS, the ENTIRE batch rolls back (all-or-nothing).
//
// UM RECORTE, desde 2026-07-25: cada op corre num SAVEPOINT próprio, e uma violação de
// DADO (SQLSTATE classe 22/23 — CHECK, FK, 22P02) reverte só a op ofensora, que volta
// recusada por operação (`rejected` + `reason`, 200 no lote). O motivo é vivacidade: o
// mesmo payload falha para sempre, o cliente não faz dequeue de não-2xx, e o lote
// inteiro voltava a cada 1,5 s — sync parado em silêncio (sync-check-constraint-poison).
// Tudo o mais — o 403 de política deste arquivo, 40001, 55P03, queda de conexão, bug de
// JS — continua abortando o push inteiro, porque pode dar certo na retentativa e
// descartar op boa é perda de dado irreversível.
//
// E UM SEGUNDO RECORTE, DESDE 2026-09-13 (decisão D4 do plano de lançamento): o savepoint é por
// LOTE LÓGICO quando as ops declaram um `batchId` comum, e só na ausência dele é por operação.
// Este arquivo mede o regime do PUSH (a transação que envolve tudo) com ops SEM `batchId`; o do
// GESTO, em que a violação de dado de um membro derruba os irmãos em vez de ser recortada, é
// `lote-logico-atomico.repro.test.js`. A distinção é o contrato: "um push = uma transação"
// continua verdadeiro, e "um savepoint por op" deixou de ser universal, porque o comando
// composto pediu uma unidade de aplicação maior que a op e menor que o push. O terceiro caso
// deste arquivo é quem prende esta fronteira, e ele existe porque a frase acima, sozinha,
// mandaria a próxima leitura concluir que o recorte por op vale sempre.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('Sync push batch atomicity (one push = one transaction)', () => {
  let app, db, user, token, atlasA, mapA, atlasB, mapB;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'atomic_user' });
    token = await loginUser(app, user.username, user.password);
    atlasA = await createAtlas(db, user.id);
    mapA = await createMap(db, atlasA.id);
    atlasB = await createAtlas(db, user.id);
    mapB = await createMap(db, atlasB.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('a failing op mid-batch rolls back the whole push (nothing persists)', async () => {
    const goodId = randomUUID();
    const goodCreate = { protocolVersion: 2,
      id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: goodId, mapId: mapA.id,
      data: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: goodId, source: 'point' } },
      timestamp: Date.now(), clientId: 'atomic-c',
    };
    // This op throws (cross-atlas map_id reference) AFTER the good op already applied
    // within the same transaction → the transaction must roll the good op back too.
    const crossAtlas = { protocolVersion: 2,
      id: randomUUID(), entityType: 'feature', operationType: 'update', entityId: randomUUID(), mapId: mapA.id,
      changes: { map_id: mapB.id }, timestamp: Date.now() + 1, clientId: 'atomic-c',
    };

    await supertest(app)
      .post(`/api/v1/atlas/${atlasA.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [goodCreate, crossAtlas] })
      .expect(403);

    // The good create must NOT have persisted (rolled back with the failed batch).
    const feat = await db.query('SELECT * FROM features WHERE id = $1', [goodId]);
    assert.equal(feat.rows.length, 0, 'the good op is rolled back when a later op in the batch fails');

    // And neither op landed in the operations log.
    const ops = await db.query(
      'SELECT COUNT(*)::int AS n FROM operations WHERE op_id = ANY($1::text[])',
      [[goodCreate.id, crossAtlas.id]]
    );
    assert.equal(ops.rows[0].n, 0, 'no operation from the failed batch is logged');
  });

  it('a fully-valid batch persists every op (atomic success)', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const ops = ids.map((id) => ({ protocolVersion: 2,
      id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: id, mapId: mapA.id,
      data: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id, source: 'point' } },
      timestamp: Date.now(), clientId: 'atomic-c',
    }));

    await supertest(app)
      .post(`/api/v1/atlas/${atlasA.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: ops })
      .expect(200);

    const { rows } = await db.query('SELECT id FROM features WHERE id = ANY($1::uuid[])', [ids]);
    assert.equal(rows.length, 3, 'all ops in a valid batch persist');
  });

  it('sem `batchId`, a violação de dado de uma op NÃO alcança as irmãs do mesmo push', async () => {
    // A fronteira entre os dois regimes, medida no push: as três ops chegam juntas, a do meio é
    // permanentemente venenosa (feature de outro atlas no `map_id`), e as outras duas precisam
    // sobreviver — que é o recorte de 2026-07-25. Com `batchId` nas três, este mesmo desenho
    // recusa as três, e é isso que `lote-logico-atomico.repro.test.js` afirma. Sem um caso aqui,
    // o lote lógico poderia ser estendido a todo push por engano e nada ficaria vermelho.
    const antes = randomUUID();
    const depois = randomUUID();
    const criar = (id, ts) => ({ protocolVersion: 2,
      id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: id, mapId: mapA.id,
      data: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id, source: 'point' } },
      timestamp: ts, clientId: 'atomic-c',
    });
    // Violação de INTEGRIDADE (classe 23): o grupo não existe, então o EXISTS do vínculo casa
    // zero linhas e a criação é recusada por operação.
    const venenosa = { protocolVersion: 2,
      id: randomUUID(), entityType: 'group_feature', operationType: 'create', entityId: randomUUID(),
      mapId: mapA.id, data: { group_id: randomUUID(), feature_id: randomUUID() },
      timestamp: Date.now() + 1, clientId: 'atomic-c',
    };

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlasA.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [criar(antes, Date.now()), venenosa, criar(depois, Date.now() + 2)] })
      .expect(200);

    assert.deepEqual(res.body.data.results.map((r) => r.success), [true, false, true],
      'op sem lote declarado é recusada sozinha, antes e depois dela seguem aplicadas');
    const { rows } = await db.query('SELECT id FROM features WHERE id = ANY($1::uuid[])', [[antes, depois]]);
    assert.equal(rows.length, 2, 'as duas boas persistem');
  });
});
