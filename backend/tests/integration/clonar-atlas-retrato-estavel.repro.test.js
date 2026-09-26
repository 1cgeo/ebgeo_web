// Path: tests/integration/clonar-atlas-retrato-estavel.repro.test.js
//
// CLONAR UM ATLAS COPIA UM RETRATO ESTÁVEL DA ORIGEM, e o que o garante é o lock do log da ORIGEM
// (`lockAtlasLog`) tomado antes da primeira leitura. É o gêmeo de
// `duplicar-mapa-retrato-estavel.repro.test.js`, e o defeito era o mesmo.
//
// A cópia (`cloneMapSubEntities`) lê a origem em vários comandos, cada um vendo o que estava
// comitado quando ELE começou (READ COMMITTED): camadas, depois grupos, depois feições. O clone não
// tomava lock nenhum da origem (o atlas novo é do chamador e ninguém escreve nele, e era esse o
// argumento), e um envio de um colega À ORIGEM que caísse entre a leitura das camadas e a das feições
// entrava pela metade: a camada nova ficava fora do clone e a feição dela entrava sem camada, realojada
// por `ensureMapLayers` na primeira camada do mapa. O atlas novo nascia com um estado que a origem
// nunca teve.
//
// Decisão do dono de 2026-09-26: o clone segura o lock da origem durante a cópia, e um envio à origem
// espera (ou recebe 503 depois de 5 s, o `lock_timeout` de `lockAtlasLog`).
//
// A intercalação é forçada, nada é sorteado: um gatilho DE TESTE pausa o clone no INSERT da primeira
// camada copiada (as camadas da origem já foram lidas, as feições ainda não), esperando um advisory
// lock que o próprio teste segura, e o envio é feito nessa janela.
//
// Controle negativo: tire o `lockAtlasLog` do topo de `cloneAtlas` e o caso reprova com a feição do
// colega dentro da camada da origem, sem a camada dele.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import pg from 'pg';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createLayer, loginUser } from '../helpers/fixtures.js';
import { SYNC_PUSH_LOCK_NAMESPACE } from '../../src/modules/sync/atlas-log-lock.js';

const PAUSA_COPIA = 747201;
const NOME_DO_CLONE = `Clone pausado ${randomUUID().slice(0, 8)}`;

describe('clonar atlas: o clone é um retrato estável da origem', () => {
  let app, db, token, atlas, origem, controle;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const dono = await createUser(db, { username: `clo_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, dono.username, dono.password);
    atlas = await createAtlas(db, dono.id, { name: `CLO ${randomUUID().slice(0, 6)}` });
    origem = await createMap(db, atlas.id, { name: 'Origem' });
    await createLayer(db, origem.id, { name: 'Camada da origem' });

    // The trigger is table-wide, so it narrows itself to the ONE atlas this file clones under a
    // unique name (a WHEN clause cannot hold a subquery). The name is ours, never external input.
    await db.query(`
      CREATE OR REPLACE FUNCTION teste_pausa_clone_de_atlas() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM maps m JOIN atlas a ON a.id = m.atlas_id
                    WHERE m.id = NEW.map_id AND a.name = '${NOME_DO_CLONE}') THEN
          PERFORM pg_advisory_xact_lock(${PAUSA_COPIA});
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER teste_pausa_clone_de_atlas AFTER INSERT ON layers FOR EACH ROW
        EXECUTE FUNCTION teste_pausa_clone_de_atlas();
    `);

    controle = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await controle.connect();
  });

  after(async () => {
    await controle?.end().catch(() => {});
    await db.query(`
      DROP TRIGGER IF EXISTS teste_pausa_clone_de_atlas ON layers;
      DROP FUNCTION IF EXISTS teste_pausa_clone_de_atlas();
    `);
    await teardownTestEnv(db);
  });

  const haLinha = async (sql) => (await db.query(sql)).rows[0]?.ok === true;
  const esperar = async (sql, rotulo) => {
    const limite = Date.now() + 4000;
    while (Date.now() < limite) {
      if (await haLinha(sql)) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timeout esperando: ${rotulo}`);
  };
  const copiaPausada = `SELECT count(*) > 0 AS ok FROM pg_locks
    WHERE locktype = 'advisory' AND NOT granted AND classid = 0 AND objid = ${PAUSA_COPIA}`;
  // The two-argument form keys the lock as (classid, objid) = (namespace, hash of the atlas id).
  const envioNoLockDoLog = () => `SELECT count(*) > 0 AS ok FROM pg_locks
    WHERE locktype = 'advisory' AND NOT granted AND classid = ${SYNC_PUSH_LOCK_NAMESPACE}
      AND objid::bigint = (hashtext('${atlas.id}')::bigint & 4294967295)`;

  it('um envio de colega à origem durante o clone espera, e o clone não sai pela metade', async () => {
    await controle.query('SELECT pg_advisory_lock($1)', [PAUSA_COPIA]);

    const duplicacao = supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/clone`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: NOME_DO_CLONE })
      .then((r) => r);
    await esperar(copiaPausada, 'clone pausado depois de ler as camadas da origem');

    // A colleague adds a layer to the SOURCE map and draws a feature in it, in that window.
    const camadaNova = randomUUID();
    const feicaoNova = randomUUID();
    const opFeicao = randomUUID();
    let envioTerminou = false;
    const envio = supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [
        { protocolVersion: 2, id: randomUUID(), type: 'create', target: 'layer', targetId: camadaNova,
          mapId: origem.id, data: { name: 'Camada do colega' }, timestamp: Date.now(), clientId: 'colega' },
        { protocolVersion: 2, id: opFeicao, entityType: 'feature', operationType: 'create',
          entityId: feicaoNova, mapId: origem.id, timestamp: Date.now(), clientId: 'colega',
          data: { id: feicaoNova, feature_type: 'point', geometry: { type: 'Point', coordinates: [-44, -21] },
            properties: { nome: 'Do colega', layerId: camadaNova } } },
      ] })
      .then((r) => { envioTerminou = true; return r; });

    // Either the push is seen waiting on the log lock, or it finishes: whichever comes first.
    const limite = Date.now() + 4000;
    let envioEsperou = false;
    while (!envioTerminou && Date.now() < limite) {
      if (await haLinha(envioNoLockDoLog())) { envioEsperou = true; break; }
      await new Promise((r) => setTimeout(r, 20));
    }

    await controle.query('SELECT pg_advisory_unlock($1)', [PAUSA_COPIA]);
    const respDuplicacao = await duplicacao;
    assert.equal(respDuplicacao.status, 201, `o clone comitou (veio ${respDuplicacao.status})`);
    const respEnvio = await envio;
    assert.equal(respEnvio.status, 200);
    assert.deepEqual(respEnvio.body.data.results.map((r) => r.status), ['applied', 'applied'],
      'o envio do colega foi aplicado, depois da cópia');

    // The copy is the source as it was BEFORE the colleague's push: one layer, no feature. The torn
    // copy does not show a null `layer_id`, because `ensureMapLayers` re-homes a feature without a
    // layer into the first layer of its map: it shows the colleague's feature inside the source's
    // layer, and the colleague's layer missing.
    const clone = respDuplicacao.body.data.id;
    const { rows: [mapaDoClone] } = await db.query(
      'SELECT id FROM maps WHERE atlas_id = $1 AND deleted_at IS NULL', [clone]);
    const copia = mapaDoClone.id;
    const { rows: conteudo } = await db.query(
      `SELECT 'camada' AS tipo, name AS nome FROM layers WHERE map_id = $1 AND deleted_at IS NULL
       UNION ALL
       SELECT 'feição em ' || COALESCE(l.name, '(nenhuma)'), f.properties->>'nome'
         FROM features f LEFT JOIN layers l ON l.id = f.layer_id
        WHERE f.map_id = $1 AND f.deleted_at IS NULL
       ORDER BY 1, 2`,
      [copia]);
    assert.deepEqual(conteudo, [{ tipo: 'camada', nome: 'Camada da origem' }],
      'o clone é a origem de antes do envio do colega, e não metade dele');

    assert.equal(envioEsperou, true, 'o envio à origem esperou o lock do log em vez de comitar no meio do clone');
  });
});
