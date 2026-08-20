// Path: tests/integration/sync-version-cursor.test.js
// Item 24 — trg_update_atlas_version / atlas.current_version como cursor de sync.
//
// O cursor incremental do sync tem DUAS fontes de verdade e nada as amarrava:
//   • a COLUNA `atlas.current_version`, mantida pelo trigger AFTER INSERT ON
//     operations (004_sync.sql), devolvida pelo snapshot e lida pela decisão
//     snapshot-vs-incremental (GET_ATLAS_SYNC_INFO);
//   • o CÁLCULO `COALESCE(MAX(server_version),0)` (sync.queries.js GET_CURRENT_VERSION),
//     que produz o `serverVersion` do ack do push.
// As duas só coincidem porque o trigger dispara a cada INSERT em `operations`.
// `current_version` tinha ZERO ocorrências em tests/: se o trigger sumisse numa
// migração futura, ou parasse de filtrar por NEW.atlas_id, o cliente ancoraria
// `lastVersion` num número errado e o pull incremental
// (`WHERE server_version > $lastVersion`) pularia ops para sempre.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('atlas.current_version como cursor de sync (item 24)', () => {
  let app, db, user, token, atlasA, mapA, atlasB, mapB;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: `cursor_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, user.username, user.password);
    atlasA = await createAtlas(db, user.id);
    mapA = await createMap(db, atlasA.id);
    atlasB = await createAtlas(db, user.id);
    mapB = await createMap(db, atlasB.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const opCreate = (mapId, clientId = 'cursor-c') => {
    const id = randomUUID();
    return {
      id: randomUUID(),
      type: 'create',
      target: 'feature',
      targetId: id,
      mapId,
      data: {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { id, source: 'point' },
      },
      timestamp: Date.now(),
      clientId,
    };
  };

  const push = (atlasId, operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlasId}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations });

  const colunaDoAtlas = async (atlasId) => {
    const { rows } = await db.query('SELECT current_version, updated_at FROM atlas WHERE id = $1', [atlasId]);
    assert.equal(rows.length, 1, 'o atlas precisa existir');
    return { versao: Number(rows[0].current_version), updatedAt: rows[0].updated_at };
  };

  const maxOperations = async (atlasId) => {
    const { rows } = await db.query(
      'SELECT COALESCE(MAX(server_version),0)::bigint AS m, COUNT(*)::int AS n FROM operations WHERE atlas_id = $1',
      [atlasId]
    );
    assert.equal(rows.length, 1);
    return { max: Number(rows[0].m), linhas: rows[0].n };
  };

  const snapshotVersion = async (atlasId) => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlasId}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(res.body.data.isSnapshot, true);
    return Number(res.body.data.currentVersion);
  };

  it('igualdade TRIPLA após um push de 3 ops: coluna == MAX(server_version) == snapshot == ack', async () => {
    const res = await push(atlasA.id, [opCreate(mapA.id), opCreate(mapA.id), opCreate(mapA.id)]).expect(200);

    const acks = res.body.data.acks;
    assert.equal(acks.length, 3, 'um ack por op');
    const ackMax = Math.max(...acks.map((a) => Number(a.serverVersion)));
    const serverVersionDoPush = Number(res.body.data.serverVersion);

    const { versao } = await colunaDoAtlas(atlasA.id);
    const { max } = await maxOperations(atlasA.id);
    const snap = await snapshotVersion(atlasA.id);

    assert.equal(versao, max, 'coluna do trigger == MAX(server_version) do log');
    assert.equal(snap, versao, 'o snapshot devolve a coluna');
    assert.equal(serverVersionDoPush, versao, 'o ack do push devolve o mesmo número');
    assert.equal(ackMax, versao, 'o maior serverVersion dos acks é o cursor corrente');
  });

  it('tráfego no atlas B NÃO avança o cursor do atlas A (WHERE id = NEW.atlas_id)', async () => {
    const antes = await colunaDoAtlas(atlasA.id);

    await push(atlasB.id, [opCreate(mapB.id)]).expect(200);

    const depois = await colunaDoAtlas(atlasA.id);
    assert.equal(depois.versao, antes.versao, 'o cursor de A não pode andar por causa de B');

    const b = await colunaDoAtlas(atlasB.id);
    const maxB = await maxOperations(atlasB.id);
    assert.equal(b.versao, maxB.max, 'e o cursor de B é o dele mesmo');
    assert.notEqual(b.versao, depois.versao, 'os dois atlas têm cursores independentes');
  });

  it('reenvio idempotente do MESMO op_id não cria linha nem avança current_version', async () => {
    const op = opCreate(mapA.id);
    await push(atlasA.id, [op]).expect(200);

    const antes = await colunaDoAtlas(atlasA.id);
    const antesLog = await maxOperations(atlasA.id);

    const reenvio = await push(atlasA.id, [op]).expect(200);
    assert.equal(reenvio.body.data.acks.length, 1);
    assert.equal(reenvio.body.data.acks[0].idempotent, true, 'o reenvio é reconhecido como idempotente');

    const depois = await colunaDoAtlas(atlasA.id);
    const depoisLog = await maxOperations(atlasA.id);
    assert.equal(depoisLog.linhas, antesLog.linhas, 'ON CONFLICT DO NOTHING: nenhuma linha nova');
    assert.equal(depois.versao, antes.versao, 'sem INSERT não há trigger, logo o cursor não anda');
  });

  it('atlas.updated_at avança a cada push (o campo de "última modificação" do project-picker)', async () => {
    const antes = await colunaDoAtlas(atlasA.id);
    await push(atlasA.id, [opCreate(mapA.id)]).expect(200);
    const depois = await colunaDoAtlas(atlasA.id);
    assert.ok(
      new Date(depois.updatedAt).getTime() >= new Date(antes.updatedAt).getTime(),
      'updated_at não pode retroceder'
    );
    assert.ok(depois.versao > antes.versao, 'e o cursor avançou junto');
  });

  it('após o cleanup que apaga TODAS as ops as duas fontes DIVERGEM — e o snapshot devolve a coluna', async () => {
    // O cleanup é um DELETE em `operations`; o trigger é AFTER INSERT, então a
    // coluna não retrocede. Quem ancorar em MAX(server_version) volta a 0 e
    // re-pede tudo; quem ancorar na coluna mantém o número. Fica pinado qual das
    // duas o snapshot devolve, que é o que o cliente de fato consome.
    const atlasC = await createAtlas(db, user.id);
    const mapC = await createMap(db, atlasC.id);
    await push(atlasC.id, [opCreate(mapC.id), opCreate(mapC.id)]).expect(200);

    const antes = await colunaDoAtlas(atlasC.id);
    assert.ok(antes.versao > 0, 'guarda: o cursor precisa ter avançado antes do cleanup');

    const admin = await createAdminUser(db, { username: `cursor_adm_${randomUUID().slice(0, 8)}` });
    const admTok = await loginUser(app, admin.username, admin.password);
    await supertest(app)
      .post(`/api/v1/atlas/${atlasC.id}/sync/admin/cleanup`)
      .set('Authorization', `Bearer ${admTok}`)
      // keepFromVersion acima do maior server_version do atlas => apaga TODAS as ops.
      .send({ keepFromVersion: antes.versao + 1 })
      .expect(200);

    const restante = await maxOperations(atlasC.id);
    assert.equal(restante.linhas, 0, 'guarda: o cleanup precisa ter apagado tudo');
    assert.equal(restante.max, 0, 'MAX(server_version) volta a 0');

    const depois = await colunaDoAtlas(atlasC.id);
    assert.equal(depois.versao, antes.versao, 'a COLUNA não retrocede (o trigger é AFTER INSERT)');

    const snap = await snapshotVersion(atlasC.id);
    assert.equal(snap, depois.versao, 'o snapshot devolve a COLUNA, não o MAX recalculado');
    assert.notEqual(snap, restante.max, 'as duas fontes ficam de fato divergentes após o cleanup');
  });
});
