// Path: tests/integration/marcador-rest-ordem-de-commit.repro.test.js
//
// O CURSOR DO PULL INCREMENTAL SO E CORRETO SE A ORDEM DE `server_version` FOR A ORDEM DE COMMIT,
// e o push garante isso com um advisory lock por atlas (`pushOperations`). As escritas REST que
// gravam MARCADOR no log do MESMO atlas (duplicacao de mapa e merge) nao tomavam esse lock.
//
// A intercalacao perdedora, forcada aqui de forma deterministica:
//   1. a duplicacao atualiza `atlas.map_order` (segura a linha do atlas) e para;
//   2. um push chega, o INSERT em `operations` tira `nextval` (vP) e o gatilho
//      `trg_update_atlas_version` bloqueia na linha do atlas;
//   3. a duplicacao segue, grava o marcador com `nextval` MAIOR (vD) e comita;
//   4. um par puxa nessa janela: recebe o marcador, `currentVersion = vD`, e guarda vD como cursor;
//   5. o push comita vP < vD. O proximo pull (`server_version > vD`) nunca devolve a op dele.
// E o gatilho grava `current_version = vP` por cima de vD: a versao do atlas ANDA PARA TRAS.
//
// A pausa em (1) e em (5) e feita por gatilhos DE TESTE, restritos a este atlas e a este mapa, que
// esperam um advisory lock que o proprio teste segura. Nada e sorteado: cada passo espera o
// anterior ser VISTO em `pg_locks`.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import pg from 'pg';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

const PAUSA_DUPLICACAO = 747001;
const PAUSA_PUSH = 747002;

describe('marcador REST e push concorrente: a versao segue a ordem de commit', () => {
  let app, db, token, atlas, mapa, outroMapa, controle;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const dono = await createUser(db, { username: `mko_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, dono.username, dono.password);
    atlas = await createAtlas(db, dono.id, { name: `MKO ${randomUUID().slice(0, 6)}` });
    mapa = await createMap(db, atlas.id, { name: 'Origem' });
    outroMapa = await createMap(db, atlas.id, { name: 'Alvo do push' });

    // Os ids sao nossos (UUID recem-cunhado), nunca entrada externa: interpolar e seguro.
    await db.query(`
      CREATE OR REPLACE FUNCTION teste_pausa_duplicacao() RETURNS trigger AS $$
      BEGIN PERFORM pg_advisory_xact_lock(${PAUSA_DUPLICACAO}); RETURN NEW; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER teste_pausa_duplicacao AFTER UPDATE ON atlas FOR EACH ROW
        WHEN (NEW.id = '${atlas.id}'::uuid AND NEW.map_order IS DISTINCT FROM OLD.map_order)
        EXECUTE FUNCTION teste_pausa_duplicacao();
      CREATE OR REPLACE FUNCTION teste_pausa_push() RETURNS trigger AS $$
      BEGIN PERFORM pg_advisory_xact_lock(${PAUSA_PUSH}); RETURN NEW; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER teste_pausa_push AFTER INSERT ON features FOR EACH ROW
        WHEN (NEW.map_id = '${outroMapa.id}'::uuid)
        EXECUTE FUNCTION teste_pausa_push();
    `);

    controle = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await controle.connect();
  });

  after(async () => {
    await controle?.end().catch(() => {});
    await db.query(`
      DROP TRIGGER IF EXISTS teste_pausa_duplicacao ON atlas;
      DROP TRIGGER IF EXISTS teste_pausa_push ON features;
      DROP FUNCTION IF EXISTS teste_pausa_duplicacao();
      DROP FUNCTION IF EXISTS teste_pausa_push();
    `);
    await teardownTestEnv(db);
  });

  /** Espera ate que `predicado` (SQL que devolve uma linha `ok`) seja verdadeiro. */
  const esperar = async (sql, rotulo) => {
    const limite = Date.now() + 4000;
    while (Date.now() < limite) {
      const { rows } = await db.query(sql);
      if (rows[0]?.ok) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timeout esperando: ${rotulo}`);
  };
  const esperandoAdvisory = (chave) => `SELECT count(*) > 0 AS ok FROM pg_locks
    WHERE locktype = 'advisory' AND NOT granted AND objid = ${chave} AND classid = 0`;
  // Quantos pedidos de lock estao pendentes ALEM da pausa da duplicacao: e o push parado, seja
  // na linha do atlas (sem o conserto) ou no lock de push do atlas (com ele).
  const pushParado = `SELECT count(*) > 0 AS ok FROM pg_locks
    WHERE NOT granted AND NOT (locktype = 'advisory' AND objid = ${PAUSA_DUPLICACAO} AND classid = 0)`;

  const puxar = async (desde) => (await supertest(app)
    .get(`/api/v1/atlas/${atlas.id}/sync/${desde}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200)).body.data;

  it('o par que puxou entre os dois commits recebe, no pull seguinte, a op do push', async () => {
    // Uma op antes de tudo, para o par ter um cursor NAO nulo: `sync/0` responde retrato.
    const semente = randomUUID();
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [{
        protocolVersion: 2, id: randomUUID(), entityType: 'feature', operationType: 'create',
        entityId: semente, mapId: mapa.id, timestamp: Date.now(), clientId: 'cli-semente',
        data: { id: semente, feature_type: 'point',
          geometry: { type: 'Point', coordinates: [-44, -21] }, properties: { nome: 'S' } },
      }] })
      .expect(200);
    const v0 = Number((await db.query('SELECT current_version FROM atlas WHERE id = $1', [atlas.id]))
      .rows[0].current_version);
    await controle.query('SELECT pg_advisory_lock($1), pg_advisory_lock($2)', [PAUSA_DUPLICACAO, PAUSA_PUSH]);

    const duplicacao = supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${mapa.id}/duplicate`)
      .set('Authorization', `Bearer ${token}`)
      .then((r) => r);
    await esperar(esperandoAdvisory(PAUSA_DUPLICACAO), 'duplicacao parada com a linha do atlas');

    const featureId = randomUUID();
    const opId = randomUUID();
    const push = supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [{
        protocolVersion: 2, id: opId, entityType: 'feature', operationType: 'create',
        entityId: featureId, mapId: outroMapa.id, timestamp: Date.now(), clientId: 'cli-push',
        data: { id: featureId, feature_type: 'point',
          geometry: { type: 'Point', coordinates: [-45, -20] }, properties: { nome: 'P' } },
      }] })
      .then((r) => r);
    await esperar(pushParado, 'push parado atras da duplicacao');

    await controle.query('SELECT pg_advisory_unlock($1)', [PAUSA_DUPLICACAO]);
    const respDuplicacao = await duplicacao;
    assert.equal(respDuplicacao.status, 201, 'a duplicacao comitou');
    await esperar(esperandoAdvisory(PAUSA_PUSH), 'push parado depois de gravar a feicao, antes do commit');

    // O PAR PUXA NA JANELA entre o commit da duplicacao e o do push.
    const primeiro = await puxar(v0);
    assert.equal(primeiro.isSnapshot, false);
    const cursor = primeiro.currentVersion;

    await controle.query('SELECT pg_advisory_unlock($1)', [PAUSA_PUSH]);
    const respPush = await push;
    assert.equal(respPush.status, 200);
    assert.equal(respPush.body.data.results[0].status, 'applied', 'o push foi aplicado');

    const segundo = await puxar(cursor);
    const logada = await db.query('SELECT server_version FROM operations WHERE atlas_id = $1 AND op_id = $2',
      [atlas.id, opId]);
    assert.equal(logada.rows.length, 1, 'a op do push esta no log');
    // O primeiro pull nao a viu (ela nao tinha comitado), entao ela TEM de estar acima do cursor.
    assert.equal(primeiro.operations.some((o) => o.id === opId), false);
    assert.ok(Number(logada.rows[0].server_version) > cursor,
      `a op do push (v${logada.rows[0].server_version}) ficou abaixo do cursor ${cursor} `
      + 'que o par guardou sem te-la recebido: nenhum pull incremental a devolve mais');
    assert.equal(segundo.isSnapshot, false);
    assert.equal(segundo.operations.some((o) => o.id === opId), true, 'o par recebe a op do push');

    // A versao do atlas nunca anda para tras.
    const vFinal = Number((await db.query('SELECT current_version FROM atlas WHERE id = $1', [atlas.id]))
      .rows[0].current_version);
    assert.ok(vFinal >= cursor, `current_version recuou de ${cursor} para ${vFinal}`);
  });
});
