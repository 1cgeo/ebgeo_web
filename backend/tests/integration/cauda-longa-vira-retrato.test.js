// Path: tests/integration/cauda-longa-vira-retrato.test.js
//
// O PULL INCREMENTAL NAO TINHA TETO. Um par que volta depois de um dia fora recebia a cauda
// inteira, e cada op de feicao carrega a feicao canonica INTEIRA duas vezes (`data` e `changes`):
// 300 edicoes de UM poligono de 300 vertices eram 7,5 MB de cauda contra 14 KB de retrato
// (medido em 2026-09-23), aplicados pelo cliente uma op por vez. Acima de `PULL_TAIL_MAX_OPS` ops
// OU de `PULL_TAIL_MAX_STORED_BYTES` guardados, `pullOperations` responde o retrato, que os dois
// caminhos do cliente ja tratam (REST do connect e WS `sync_request`; a prova do cliente esta em
// `frontend/tests/integration/cauda-longa-vira-retrato.repro.test.js`).
//
// As caudas aqui sao escritas direto em `operations`: o pull so LE o log, e escrever centenas de
// ops pelo push custaria segundos sem medir nada a mais.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import { PULL_TAIL_MAX_OPS, PULL_TAIL_MAX_STORED_BYTES } from '../../src/modules/sync/sync.service.js';

describe('pull incremental: cauda longa ou pesada vira retrato', () => {
  let app, db, dono, token;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    dono = await createUser(db, { username: `cauda_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, dono.username, dono.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Um atlas com um mapa e uma op inicial, e o cursor do par logo depois dela. */
  const cenario = async () => {
    const atlas = await createAtlas(db, dono.id, { name: `Cauda ${randomUUID().slice(0, 6)}` });
    const mapa = await createMap(db, atlas.id, { name: 'Mapa' });
    await escrever(atlas.id, mapa.id, 1, 'null');
    const cursor = Number((await db.query('SELECT current_version FROM atlas WHERE id = $1', [atlas.id]))
      .rows[0].current_version);
    return { atlas, mapa, cursor };
  };

  /** Escreve `n` ops de atualizacao de feicao no log, com `dado` (expressao SQL) como payload. */
  const escrever = async (atlasId, mapId, n, dado) => {
    await db.query(
      `INSERT INTO operations (atlas_id, op_type, entity_type, entity_id, map_id, data, changes,
                               client_timestamp, client_id, op_id)
       SELECT $1, 'update', 'feature', gen_random_uuid(), $2, ${dado}, NULL, 1, 'cli-teste', gen_random_uuid()::text
       FROM generate_series(1, $3)`,
      [atlasId, mapId, n],
    );
  };

  const puxar = async (atlasId, desde) => (await supertest(app)
    .get(`/api/v1/atlas/${atlasId}/sync/${desde}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200)).body.data;

  it('CONTROLE: exatamente no teto de ops, e leve, a resposta continua sendo a cauda', async () => {
    const { atlas, mapa, cursor } = await cenario();
    await escrever(atlas.id, mapa.id, PULL_TAIL_MAX_OPS, 'null');
    const r = await puxar(atlas.id, cursor);
    assert.equal(r.isSnapshot, false);
    assert.equal(r.operations.length, PULL_TAIL_MAX_OPS);
  });

  it('uma op acima do teto de ops: retrato, com a versao do atlas', async () => {
    const { atlas, mapa, cursor } = await cenario();
    await escrever(atlas.id, mapa.id, PULL_TAIL_MAX_OPS + 1, 'null');
    const r = await puxar(atlas.id, cursor);
    assert.equal(r.isSnapshot, true);
    const versao = Number((await db.query('SELECT current_version FROM atlas WHERE id = $1', [atlas.id]))
      .rows[0].current_version);
    assert.equal(r.currentVersion, versao);
    assert.equal(r.snapshot.currentVersion, versao);
    assert.equal(r.snapshot.maps.length, 1);
  });

  it('poucas ops mas pesadas (acima do teto de bytes guardados): retrato', async () => {
    const { atlas, mapa, cursor } = await cenario();
    // ~64 KB de hex aleatorio por op: pouco compressivel, entao o tamanho guardado nao encolhe
    // para baixo do teto por acaso.
    await escrever(atlas.id, mapa.id, 60,
      "jsonb_build_object('blob', (SELECT string_agg(md5(random()::text), '') FROM generate_series(1, 2000)))");
    // PISO: a premissa do caso e ser pesado sem ser longo.
    const { rows } = await db.query(
      `SELECT count(*)::int AS ops, sum(pg_column_size(data))::bigint AS bytes
       FROM operations WHERE atlas_id = $1 AND server_version > $2`, [atlas.id, cursor]);
    assert.ok(rows[0].ops <= PULL_TAIL_MAX_OPS, 'a cauda nao passa do teto de ops');
    assert.ok(Number(rows[0].bytes) > PULL_TAIL_MAX_STORED_BYTES, `a cauda passa do teto de bytes (${rows[0].bytes})`);

    const r = await puxar(atlas.id, cursor);
    assert.equal(r.isSnapshot, true);
  });

  it('CONTROLE: as mesmas ops pesadas, mas poucas o bastante para caber, voltam como cauda', async () => {
    const { atlas, mapa, cursor } = await cenario();
    await escrever(atlas.id, mapa.id, 5,
      "jsonb_build_object('blob', (SELECT string_agg(md5(random()::text), '') FROM generate_series(1, 2000)))");
    const r = await puxar(atlas.id, cursor);
    assert.equal(r.isSnapshot, false);
    assert.equal(r.operations.length, 5);
  });

  it('o sync_request pelo socket segue a mesma regra (a funcao e a mesma)', async () => {
    // O WS chama `pullOperations` com `haveSnapshot`, e o teto vale para ele tambem: o caminho do
    // socket no cliente trata `isSnapshot` (sync-engine, `syncResponse`).
    const { pullOperations } = await import('../../src/modules/sync/sync.service.js');
    const { atlas, mapa, cursor } = await cenario();
    await escrever(atlas.id, mapa.id, PULL_TAIL_MAX_OPS + 1, 'null');
    const r = await pullOperations(atlas.id, cursor, 'owner', dono.id, { haveSnapshot: true });
    assert.equal(r.isSnapshot, true);
  });
});
