// Path: tests/integration/trava-do-log-nas-excecoes-rest.test.js
//
// AS DUAS EXCECOES REST QUE ESCREVEM NO LOG DE UM ATLAS EXISTENTE TOMAM A TRAVA DO LOG
// (`lockAtlasLog`, `src/modules/sync/atlas-log-lock.js`), e cada uma no ponto certo:
//
//   - a DUPLICACAO toma a trava so antes de atualizar a linha do atlas e gravar o marcador. Tomada
//     no topo, ela fazia todo push do atlas esperar a copia inteira de um mapa grande, segurando
//     uma conexao do pool, e voltar 503 passado o `lock_timeout`;
//   - o MERGE toma a trava antes de tudo. Sem ela, o `nextval` do marcador e o gatilho que atualiza
//     o atlas nao sao atomicos: um push que tire a versao seguinte entre os dois comita PRIMEIRO, e
//     o par que puxa nessa janela guarda um cursor que passa por cima do marcador.
//
// A intercalacao e forcada por gatilhos DE TESTE restritos a este atlas, que esperam um advisory
// lock que o teste segura; cada passo espera o anterior ser visto em `pg_locks`. A regressao da
// duplicacao com a linha do atlas esta em `marcador-rest-ordem-de-commit.repro.test.js`.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import pg from 'pg';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

const PAUSA_COPIA = 748101;
const PAUSA_MARCADOR = 748102;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('trava do log nas excecoes REST', () => {
  let app, db, token, controle;
  const gatilhos = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const dono = await createUser(db, { username: `tlr_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, dono.username, dono.password);
    controle = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await controle.connect();
    // Guardado para o `after`: os gatilhos deste arquivo nao podem sobreviver a ele.
    controle.dono = dono;
  });

  after(async () => {
    for (const sql of gatilhos) await db.query(sql).catch(() => {});
    await controle?.end().catch(() => {});
    await teardownTestEnv(db);
  });

  const esperar = async (sql, rotulo, limiteMs = 4000) => {
    const limite = Date.now() + limiteMs;
    while (Date.now() < limite) {
      const { rows } = await db.query(sql);
      if (rows[0]?.ok) return;
      await sleep(20);
    }
    throw new Error(`timeout esperando: ${rotulo}`);
  };
  const esperandoAdvisory = (chave) => `SELECT count(*) > 0 AS ok FROM pg_locks
    WHERE locktype = 'advisory' AND NOT granted AND objid = ${chave} AND classid = 0`;

  const criarFeicao = async (atlasId, mapId, props = {}) => {
    const id = randomUUID();
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlasId}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [{
        protocolVersion: 2, id: randomUUID(), entityType: 'feature', operationType: 'create',
        entityId: id, mapId, timestamp: Date.now(), clientId: 'cli-teste',
        data: { id, feature_type: 'point', geometry: { type: 'Point', coordinates: [-45, -20] },
          properties: { nome: 'P', ...props } },
      }] });
    return { id, res };
  };

  it('DUPLICACAO: a copia de um mapa nao segura os pushes do atlas', async () => {
    const atlas = await createAtlas(db, controle.dono.id, { name: `TLD ${randomUUID().slice(0, 6)}` });
    const origem = await createMap(db, atlas.id, { name: 'Grande' });
    const outro = await createMap(db, atlas.id, { name: 'Outro' });
    assert.equal((await criarFeicao(atlas.id, origem.id, { teste_pausa_dup: true })).res.status, 200);

    // A pausa cai no INSERT da feicao COPIADA (mapa diferente da origem), no meio da copia.
    await db.query(`
      CREATE OR REPLACE FUNCTION teste_pausa_copia() RETURNS trigger AS $$
      BEGIN PERFORM pg_advisory_xact_lock(${PAUSA_COPIA}); RETURN NEW; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER teste_pausa_copia AFTER INSERT ON features FOR EACH ROW
        WHEN (NEW.properties ? 'teste_pausa_dup' AND NEW.map_id <> '${origem.id}'::uuid)
        EXECUTE FUNCTION teste_pausa_copia();`);
    gatilhos.push('DROP TRIGGER IF EXISTS teste_pausa_copia ON features', 'DROP FUNCTION IF EXISTS teste_pausa_copia()');

    await controle.query('SELECT pg_advisory_lock($1)', [PAUSA_COPIA]);
    let duplicacao;
    try {
      duplicacao = supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/maps/${origem.id}/duplicate`)
        .set('Authorization', `Bearer ${token}`)
        .then((r) => r);
      await esperar(esperandoAdvisory(PAUSA_COPIA), 'duplicacao parada no meio da copia');

      // Com a copia parada, um colega edita outro mapa do mesmo atlas.
      const inicio = Date.now();
      const { res } = await criarFeicao(atlas.id, outro.id);
      const demora = Date.now() - inicio;
      assert.equal(res.status, 200, `o push nao pode esperar a copia (respondeu ${res.status} em ${demora} ms)`);
      assert.equal(res.body.data.results[0].status, 'applied');
      assert.ok(demora < 3000, `o push levou ${demora} ms`);
    } finally {
      await controle.query('SELECT pg_advisory_unlock($1)', [PAUSA_COPIA]);
    }
    assert.equal((await duplicacao).status, 201, 'a duplicacao termina depois de solta');
    for (const sql of gatilhos.splice(0)) await db.query(sql);
  });

  it('MERGE: o par que puxa durante o merge recebe o marcador', async () => {
    const atlas = await createAtlas(db, controle.dono.id, { name: `TLM ${randomUUID().slice(0, 6)}` });
    const destino = await createMap(db, atlas.id, { name: 'Destino' });
    const fonte = await createMap(db, atlas.id, { name: 'Fonte' });
    const outro = await createMap(db, atlas.id, { name: 'Outro' });
    await criarFeicao(atlas.id, fonte.id);
    const v0 = Number((await db.query('SELECT current_version FROM atlas WHERE id = $1', [atlas.id]))
      .rows[0].current_version);

    // A pausa cai DEPOIS do nextval do marcador (o default e avaliado antes do gatilho BEFORE) e
    // ANTES do gatilho que atualiza a versao do atlas.
    await db.query(`
      CREATE OR REPLACE FUNCTION teste_pausa_marcador() RETURNS trigger AS $$
      BEGIN PERFORM pg_advisory_xact_lock(${PAUSA_MARCADOR}); RETURN NEW; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER teste_pausa_marcador BEFORE INSERT ON operations FOR EACH ROW
        WHEN (NEW.entity_type = 'map_merge' AND NEW.atlas_id = '${atlas.id}'::uuid)
        EXECUTE FUNCTION teste_pausa_marcador();`);
    gatilhos.push('DROP TRIGGER IF EXISTS teste_pausa_marcador ON operations', 'DROP FUNCTION IF EXISTS teste_pausa_marcador()');

    await controle.query('SELECT pg_advisory_lock($1)', [PAUSA_MARCADOR]);
    let merge;
    let push;
    let primeiro;
    try {
      merge = supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/maps/${destino.id}/merge`)
        .set('Authorization', `Bearer ${token}`)
        .send({ sourceMapIds: [fonte.id] })
        .then((r) => r);
      await esperar(esperandoAdvisory(PAUSA_MARCADOR), 'merge parado com a versao do marcador tirada');

      push = criarFeicao(atlas.id, outro.id);
      // Da ao push a chance de comitar na frente do marcador (e o que acontecia sem a trava).
      await Promise.race([push, sleep(1000)]);
      primeiro = (await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/${v0}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)).body.data;
    } finally {
      await controle.query('SELECT pg_advisory_unlock($1)', [PAUSA_MARCADOR]);
    }
    assert.equal((await merge).status, 200);
    assert.equal((await push).res.status, 200);

    const segundo = (await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/${primeiro.currentVersion}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)).body.data;
    assert.equal(segundo.isSnapshot, false);
    const entregues = [...primeiro.operations, ...segundo.operations];
    assert.equal(entregues.filter((o) => o.entityType === 'map_merge').length, 1,
      `o marcador chega ao par (cursor guardado: ${primeiro.currentVersion})`);
    for (const sql of gatilhos.splice(0)) await db.query(sql);
  });
});
