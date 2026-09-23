// Path: tests/integration/ambiente-do-navegador.test.js
/**
 * @fileoverview THE BROWSER ENVIRONMENT in the telemetry (2026-09-23): the machine of each
 * defect occurrence, the set of browser families of each defect, and the browsers and systems
 * of the usage report.
 *
 * THE USAGE WINDOW OF THIS FILE IS IN THE PAST (137 days ago, two days wide), for the reason of
 * `uso-resumo-blocos.test.js`: `resumo` counts everything in the window, other files write
 * today's sessions, and an injected `agora` over a range only this file seeds is what makes the
 * counts exact instead of hostage to whoever else is running.
 *
 * NEGATIVE CONTROLS (what turns red when each piece is reverted):
 *  - replacing the UNION of `navegadores` in `UPSERT_DEFEITO` by `EXCLUDED.navegadores`: the
 *    union case keeps only the last family, and "only on Firefox" becomes a lie after one
 *    Chrome report;
 *  - dropping `ambiente` from `INSERT_OCORRENCIA` or from `LIST_OCORRENCIAS`: the round trip
 *    case reads NULL;
 *  - removing `unknown(false)` from `ambienteSchema`: the extra key case becomes 204;
 *  - removing a CHECK from `014_ambiente_do_navegador.sql`: the direct INSERT case of that
 *    column stops being refused, which is the case of a writer that skips the Joi;
 *  - summing the version rows into the family totals, or filtering NULL out: the report case
 *    reads a total different from the seeded eleven.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';
import { resumo } from '../../src/modules/uso/uso.service.js';

/** A full environment block, as the client collector produces it on a Windows Firefox. */
const AMBIENTE_FIREFOX = Object.freeze({
  navegador: 'firefox',
  navegadorVersao: '143.0',
  so: 'windows',
  soVersao: '10.0',
  dispositivo: 'desktop',
  toque: 0,
  telaLargura: 1920,
  telaAltura: 1080,
  escala: 1.25,
  janelaLargura: 1536,
  janelaAltura: 730,
  idioma: 'pt-BR',
  fuso: 'America/Sao_Paulo',
  nucleos: 8,
  webgl: 'webgl2',
  gpu: 'NVIDIA GeForce GTX 980, or similar',
  texturaMax: 16384,
  armazenamentoUsoMb: 12,
  armazenamentoCotaMb: 2048,
  armazenamentoPersistente: false,
  online: true,
  cookies: true,
  contextoSeguro: true,
  indexedDB: true,
});

describe('The browser environment in the telemetry', () => {
  let app, db, adminToken, pessoa;
  const marca = randomUUID().slice(0, 8);
  const assinaturas = [];
  const sessoes = [];

  const assinatura = (nome) => {
    const a = `TypeError | ambiente ${nome} | ${marca}`;
    assinaturas.push(a);
    return a;
  };
  const relatar = (corpo, esperado = 204) => supertest(app)
    .post('/api/v1/diag/erro-cliente')
    .send({ mensagem: 'quebrou', pagina: 'mapa', ...corpo })
    .expect(esperado);
  const defeitoDe = (a) => db.query('SELECT * FROM defeitos WHERE assinatura = $1', [a])
    .then((r) => r.rows[0]);

  /** 137 days ago: the end of this file's usage window. See the header. */
  const AGORA = new Date(Date.now() - 137 * 86_400_000);

  async function semearSessao({ navegador, versao = null, so = null, erros = 0, userId = null }) {
    const id = randomUUID();
    sessoes.push(id);
    await db.query(
      `INSERT INTO uso_sessoes (
         sessao_id, dia, user_id, pagina_inicial, navegador, navegador_versao, so,
         inicio, ultimo_sinal, eventos, erros
       ) VALUES (
         $1, ($2::timestamptz)::date, $3, 'mapa', $4, $5, $6, $2::timestamptz - INTERVAL '1 minute', $2, 0, $7
       )`,
      [id, AGORA, userId, navegador, versao, so, erros]
    );
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    pessoa = await createUser(db, { username: `amb_u_${randomUUID().slice(0, 6)}` });
    const admin = await createAdminUser(db, { username: `amb_adm_${randomUUID().slice(0, 6)}` });
    adminToken = await loginUser(app, admin.username, admin.password);

    // ELEVEN sessions: seven Firefox (two versions, three with an error, one person twice),
    // three Chrome, one from a client before the fields (family only, no version, no system).
    await semearSessao({ navegador: 'firefox', versao: 143, so: 'windows', erros: 1, userId: pessoa.id });
    await semearSessao({ navegador: 'firefox', versao: 143, so: 'windows', erros: 2, userId: pessoa.id });
    await semearSessao({ navegador: 'firefox', versao: 143, so: 'linux' });
    await semearSessao({ navegador: 'firefox', versao: 143, so: 'windows' });
    await semearSessao({ navegador: 'firefox', versao: 128, so: 'windows', erros: 1 });
    await semearSessao({ navegador: 'firefox', versao: 128, so: 'linux' });
    await semearSessao({ navegador: 'firefox', versao: 128, so: 'windows' });
    await semearSessao({ navegador: 'chrome', versao: 140, so: 'windows' });
    await semearSessao({ navegador: 'chrome', versao: 140, so: 'windows' });
    await semearSessao({ navegador: 'chrome', versao: 139, so: 'macos' });
    await semearSessao({ navegador: 'chrome' });
  });

  after(async () => {
    await db.query('DELETE FROM defeitos WHERE assinatura = ANY($1::text[])', [assinaturas]);
    await db.query('DELETE FROM uso_sessoes WHERE sessao_id = ANY($1::uuid[])', [sessoes]);
    await teardownTestEnv(db);
  });

  // ── the defect side ──

  it('the environment of a report reaches its occurrence and comes back from the route', async () => {
    const a = assinatura('ida-e-volta');
    await relatar({ assinatura: a, ambiente: AMBIENTE_FIREFOX });
    const defeito = await defeitoDe(a);
    assert.ok(defeito, 'the report must create the defect');
    assert.deepEqual(defeito.navegadores, ['firefox']);

    const res = await supertest(app)
      .get(`/api/v1/diag/defeitos/${defeito.id}/ocorrencias`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const itens = res.body.data.itens;
    assert.equal(itens.length, 1);
    assert.deepEqual(itens[0].ambiente, AMBIENTE_FIREFOX);

    const lista = await supertest(app)
      .get('/api/v1/diag/defeitos?desde=1h&limite=200')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const item = lista.body.data.itens.find((i) => i.assinatura === a);
    assert.ok(item, 'the seeded defect must be listed');
    assert.deepEqual(item.navegadores, ['firefox']);
    const porId = await supertest(app)
      .get(`/api/v1/diag/defeitos/${defeito.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    assert.deepEqual(porId.body.data.navegadores, ['firefox'], 'the list and the id route share one mapper');
  });

  it('the families of a defect ACCUMULATE: a later Chrome report does not erase Firefox', async () => {
    const a = assinatura('uniao');
    await relatar({ assinatura: a, ambiente: { navegador: 'firefox' } });
    await relatar({ assinatura: a, ambiente: { navegador: 'chrome' } });
    await relatar({ assinatura: a, ambiente: { navegador: 'firefox' } });
    // A report without environment (an older client) adds nothing and removes nothing.
    await relatar({ assinatura: a });
    const defeito = await defeitoDe(a);
    assert.deepEqual(defeito.navegadores, ['chrome', 'firefox'], 'sorted union, no repetition');
    assert.equal(defeito.ocorrencias, 4);
  });

  it('a report without environment leaves the set EMPTY and the occurrence NULL', async () => {
    const a = assinatura('sem-ambiente');
    await relatar({ assinatura: a });
    const defeito = await defeitoDe(a);
    assert.deepEqual(defeito.navegadores, []);
    const oc = await db.query('SELECT ambiente FROM defeito_ocorrencias WHERE defeito_id = $1', [defeito.id]);
    assert.equal(oc.rows.length, 1);
    assert.equal(oc.rows[0].ambiente, null);
  });

  it('the environment is CLOSED: an extra key or a value out of shape refuses the report', async () => {
    const recusados = [
      { ...AMBIENTE_FIREFOX, modelo: 'Pixel 7' },
      { navegador: 'netscape' },
      { so: 'windows11' },
      { gpu: 'Placa com acentuação' },
      { idioma: 'pt BR' },
      { navegadorVersao: '143.0 beta' },
      { telaLargura: -1 },
      { escala: 0 },
    ];
    assert.equal(recusados.length, 8, 'a loop over an empty list would assert nothing');
    for (const ambiente of recusados) {
      const res = await relatar({ assinatura: assinatura('recusa'), ambiente }, 422);
      assert.ok(JSON.stringify(res.body).includes('ambiente'), 'the 422 must name the field');
    }
  });

  it('the CHECK constraints refuse a writer that skips the Joi', async () => {
    // The Joi refuses at the edge with a 422 that names the field; the CHECK refuses in the
    // database whatever the path. A CHECK written in the migration and never applied would be
    // the empty coverage this case exists to avoid.
    const a = assinatura('check');
    await assert.rejects(
      db.query(
        "INSERT INTO defeitos (assinatura, mensagem, navegadores) VALUES ($1, 'x', ARRAY['netscape'])",
        [a]
      ),
      /defeitos_navegadores_check/
    );
    await assert.rejects(
      db.query(
        `INSERT INTO uso_sessoes (sessao_id, dia, pagina_inicial, navegador, inicio, ultimo_sinal)
         VALUES ($1, CURRENT_DATE, 'mapa', 'Chrome', NOW(), NOW())`,
        [randomUUID()]
      ),
      /uso_sessoes_navegador_check/
    );
    await assert.rejects(
      db.query(
        `INSERT INTO uso_sessoes (sessao_id, dia, pagina_inicial, so, inicio, ultimo_sinal)
         VALUES ($1, CURRENT_DATE, 'mapa', 'win', NOW(), NOW())`,
        [randomUUID()]
      ),
      /uso_sessoes_so_check/
    );
  });

  // ── the usage side ──

  it('the usage report groups the window by family, version and system, with the error share', async () => {
    const r = await resumo({ desde: '2d', agora: AGORA });
    const amb = r.ambiente;
    assert.ok(amb, 'the block must travel');
    assert.equal(amb.sessoes, 11, 'the total is the sum of the family rows, NULL family included');

    const familia = (n) => amb.familias.find((f) => f.navegador === n);
    assert.deepEqual(familia('firefox'), { navegador: 'firefox', sessoes: 7, sessoesComErro: 3, usuariosDistintos: 1 });
    assert.deepEqual(familia('chrome'), { navegador: 'chrome', sessoes: 4, sessoesComErro: 0, usuariosDistintos: 0 });
    assert.equal(amb.familias.length, 2);
    assert.equal(amb.familias[0].navegador, 'firefox', 'most used first');

    const versao = (n, v) => amb.versoes.find((x) => x.navegador === n && x.versao === v);
    assert.equal(versao('firefox', 143).sessoes, 4);
    assert.equal(versao('firefox', 143).sessoesComErro, 2);
    assert.equal(versao('firefox', 128).sessoes, 3);
    assert.equal(versao('chrome', 140).sessoes, 2);
    // The session from before the fields is a row of its own, not a disappearance.
    assert.equal(versao('chrome', null).sessoes, 1);
    assert.equal(amb.versoes.reduce((s, x) => s + x.sessoes, 0), 11);
    assert.equal(amb.versoesCortadas, 0);

    const sistema = (n) => amb.sistemas.find((s) => s.so === n);
    assert.equal(sistema('windows').sessoes, 7);
    assert.equal(sistema('windows').sessoesComErro, 3);
    assert.equal(sistema('linux').sessoes, 2);
    assert.equal(sistema('macos').sessoes, 1);
    assert.equal(sistema(null).sessoes, 1);
    assert.equal(amb.sistemas.reduce((s, x) => s + x.sessoes, 0), 11);
  });

  it('the version rows are CUT and the cut is counted', async () => {
    // Twenty-one version combinations in a window of their own: one more than the limit.
    const alvo = new Date(AGORA.getTime() - 10 * 86_400_000);
    for (let v = 1; v <= 21; v++) {
      const id = randomUUID();
      sessoes.push(id);
      await db.query(
        `INSERT INTO uso_sessoes (sessao_id, dia, pagina_inicial, navegador, navegador_versao, so, inicio, ultimo_sinal)
         VALUES ($1, ($2::timestamptz)::date, 'mapa', 'edge', $3, 'windows', $2, $2)`,
        [id, alvo, v]
      );
    }
    const r = await resumo({ desde: '1d', agora: alvo });
    assert.equal(r.ambiente.sessoes, 21);
    assert.equal(r.ambiente.versoes.length, 20);
    assert.equal(r.ambiente.versoesCortadas, 1);
    // The family row is never cut: it still counts the twenty-one.
    assert.equal(r.ambiente.familias[0].sessoes, 21);
  });

  it('the route carries the block to the administrator', async () => {
    const res = await supertest(app)
      .get('/api/v1/uso/resumo?desde=1d')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const amb = res.body.data.ambiente;
    assert.ok(amb, 'the block must travel through the route');
    assert.ok(Array.isArray(amb.familias));
    assert.ok(Array.isArray(amb.sistemas));
    assert.ok(Array.isArray(amb.versoes));
    assert.equal(typeof amb.sessoes, 'number');
    assert.equal(typeof amb.versoesCortadas, 'number');
  });
});
