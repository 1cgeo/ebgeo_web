// Path: tests/integration/zones-geom-sqlstate.test.js
// achado 89 — `assertValidGeom` (zones.service.js) tinha um `catch {}` NU: qualquer
// exceção da consulta de validação virava 422 "Invalid GeoJSON geometry".
//
// O custo não é teórico. PostGIS fora do `search_path`, EXECUTE revogado no schema `ng`,
// statement timeout ou conexão caída passavam a dizer ao administrador que o polígono
// que ele acabou de desenhar corretamente estava malformado — e o incidente real nunca
// subia de um 422 no log de acesso. Uma resposta errada com cara de resposta.
//
// COMO O TESTE INDUZ UMA FALHA QUE NÃO É DE PARSE.
// A consulta é `SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4674))` — sem
// tabela, então não há trigger onde pendurar um `RAISE EXCEPTION`. O que existe é o
// `search_path` do próprio servidor: ele é `"$user", public`, e o PostGIS mora em
// `public`. Criar `<current_user>.st_geomfromgeojson(text)` SOMBREIA a função do PostGIS
// para as conexões da aplicação, sem reconectar.
//
// A sombra é INÓCUA por construção: ela só levanta exceção quando o GeoJSON carrega a
// chave sentinela `__forceSqlstate`, e delega para `public.ST_GeomFromGeoJSON` em todos
// os outros casos — testes concorrentes que desenham zonas continuam funcionando durante
// a janela. O SQLSTATE vem da própria sentinela, então os dois casos abaixo diferem
// APENAS no código de erro, que é exatamente o invariante sob teste.
//
// CONTROLE NEGATIVO: restaurar o `catch {}` nu faz o caso 42501 (e o 57014) responder
// 422 em vez de 500 — dois casos caem, e o caso XX000 continua verde, provando que o
// teste distingue as duas metades em vez de só exigir "algum erro".

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, loginUser } from '../helpers/fixtures.js';

const RID = randomUUID().slice(0, 8);

// Anel fechado e simples: ST_IsValid == true, para que a única coisa capaz de derrubar a
// requisição seja a exceção induzida.
const RING = [[-46.6, -23.5], [-46.5, -23.5], [-46.5, -23.4], [-46.6, -23.5]];
const geomOk = () => ({ type: 'Polygon', coordinates: [RING] });
const geomForcing = (sqlstate) => ({ ...geomOk(), __forceSqlstate: sqlstate });

describe('Zones — classificação por SQLSTATE na validação de geometria (achado 89)', () => {
  let app, db, adminTok, owner, criouSchema = false;
  const zonasCriadas = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db, { username: `zgeom_${RID}` });
    adminTok = await loginUser(app, admin.username, admin.password);

    const { rows } = await db.query('SELECT current_user AS u, current_setting($1) AS sp', ['search_path']);
    owner = rows[0].u;
    // Pré-condição do mecanismo: sem "$user" na frente do path, a sombra não vale nada e
    // o teste passaria a medir outra coisa.
    assert.match(rows[0].sp, /\$user/, 'a sombra depende de "$user" preceder public no search_path');

    const existia = await db.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [owner]);
    if (existia.rows.length === 0) {
      await db.query(`CREATE SCHEMA "${owner}"`);
      criouSchema = true;
    }
  });

  after(async () => {
    await db.query(`DROP FUNCTION IF EXISTS "${owner}".st_geomfromgeojson(text)`);
    if (criouSchema) await db.query(`DROP SCHEMA IF EXISTS "${owner}" CASCADE`);
    for (const id of zonasCriadas) {
      await db.query('DELETE FROM ng.geographic_access_zones WHERE id = $1', [id]);
    }
    await teardownTestEnv(db);
  });

  async function instalarSombra() {
    await db.query(`
      CREATE OR REPLACE FUNCTION "${owner}".st_geomfromgeojson(text)
      RETURNS public.geometry AS $fn$
      DECLARE
        code text := substring($1 from '"__forceSqlstate"\\s*:\\s*"([^"]+)"');
      BEGIN
        IF code IS NOT NULL THEN
          RAISE EXCEPTION 'falha induzida (SQLSTATE %)', code USING ERRCODE = code;
        END IF;
        RETURN public.ST_GeomFromGeoJSON($1);
      END;
      $fn$ LANGUAGE plpgsql IMMUTABLE STRICT;
    `);
  }

  const postZone = (geom) =>
    supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: `zona ${RID}`, geom });

  // --- âncora: o caminho legítimo de 422 não pode ter sido enfraquecido -------

  it('geometria topologicamente inválida continua 422 (ST_IsValid false, sem exceção)', async () => {
    const res = await postZone({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] });
    assert.equal(res.status, 422);
    assert.match(res.body.error.message, /ST_IsValid/);
  });

  it('a sombra instalada NÃO atrapalha uma geometria normal (201) — prova que ela é inócua', async () => {
    await instalarSombra();
    const res = await postZone(geomOk());
    assert.equal(res.status, 201, JSON.stringify(res.body));
    zonasCriadas.push(res.body.data.id);
  });

  // --- as duas metades, distintas só pelo SQLSTATE ----------------------------

  it('XX000 (o código real dos erros de parse do PostGIS) continua virando 422', async () => {
    // Medido, não suposto: toda falha de parse de GeoJSON no PostGIS 3 chega como XX000
    // (json malformado, `type` desconhecido, `coordinates` ausente ou não-array).
    const res = await postZone(geomForcing('XX000'));
    assert.equal(res.status, 422, 'a culpa do payload precisa continuar sendo do payload');
    assert.equal(res.body.error.message, 'Invalid GeoJSON geometry');
  });

  it('42501 (permissão negada) NÃO pode virar 422 — é falha de infraestrutura', async () => {
    const res = await postZone(geomForcing('42501'));
    assert.notEqual(res.status, 422, 'EXECUTE revogado sendo reportado como polígono inválido');
    assert.equal(res.status, 500);
  });

  it('57014 (statement timeout) NÃO pode virar 422', async () => {
    const res = await postZone(geomForcing('57014'));
    assert.notEqual(res.status, 422);
    assert.equal(res.status, 500);
  });

  it('o mesmo vale no PUT (updateZone usa a mesma guarda)', async () => {
    const criada = await postZone(geomOk());
    assert.equal(criada.status, 201, JSON.stringify(criada.body));
    zonasCriadas.push(criada.body.data.id);

    const res = await supertest(app)
      .put(`/api/v1/zones/${criada.body.data.id}`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: `zona ${RID}`, geom: geomForcing('42501') });
    assert.notEqual(res.status, 422);
    assert.equal(res.status, 500);
  });
});
