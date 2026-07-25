// Path: tests/integration/debug-trace-authz.test.js
// GET/DELETE /api/v1/debug/trace — the SyncLedger ring endpoint. tests/unit/sync-trace.js
// covers the in-memory ring; NOTHING covered the ROUTE. Three things are pinned here:
//
//   1. The BORDER. `liftAtlasIdToParams` only checks presence — there is no Joi on
//      this route (a V2 deviation) — so the raw query value reaches
//      `WHERE id = $1` on a uuid column inside requireAtlasPermission. The report
//      predicted a 500 leaking the Postgres cast message. It does NOT: the global
//      errorHandler's SQLSTATE map catches 22P02 and answers 400 with a generic
//      message. That is a REFUTATION worth freezing, because the protection lives in
//      a different file from the risk and could be removed without anyone connecting
//      the two.
//   2. The per-atlas GATE. The ring is per-atlas, so read/wipe must be authorized per
//      atlas, not merely by `auth`. A token holder with no relationship to the atlas
//      must not read it, and the destructive DELETE takes `manage`, above `write`.
//   3. The FILTERS opId/traceId, never exercised. The Playwright `collectLedger`
//      merges browser and server spans by these keys; a filter that stopped filtering
//      would silently correlate spans from unrelated operations.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';
import { recordSpan, clearTrace, TraceStage } from '../../src/utils/sync-trace.js';

const ROTA = '/api/v1/debug/trace';

describe('debug/trace — borda, gate por atlas e os filtros opId/traceId', () => {
  let app, db;
  let dono, leitor, estranho, gestor;
  let tokenDono, tokenLeitor, tokenEstranho, tokenGestor;
  let atlasId, atlasVazioId;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db);
    leitor = await createUser(db);
    estranho = await createUser(db);
    gestor = await createUser(db);

    const atlas = await createAtlas(db, dono.id);
    atlasId = atlas.id;
    const vazio = await createAtlas(db, dono.id);
    atlasVazioId = vazio.id;

    await createShare(db, atlasId, leitor.id, 'read', dono.id);
    await createShare(db, atlasId, gestor.id, 'manage', dono.id);
    await createShare(db, atlasVazioId, leitor.id, 'read', dono.id);

    tokenDono = await loginUser(app, dono.username, dono.password);
    tokenLeitor = await loginUser(app, leitor.username, leitor.password);
    tokenEstranho = await loginUser(app, estranho.username, estranho.password);
    tokenGestor = await loginUser(app, gestor.username, gestor.password);
  });

  after(async () => {
    clearTrace();
    await db.query(`DELETE FROM atlas WHERE id = ANY($1::uuid[])`, [[atlasId, atlasVazioId]]);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
      [dono.id, leitor.id, estranho.id, gestor.id],
    ]);
    await teardownTestEnv(db);
  });

  // -------------------------------------------------------------------------
  // 1. Borda
  // -------------------------------------------------------------------------

  it('atlasId que não é uuid: resposta 4xx e NENHUM texto do Postgres no corpo', async () => {
    const res = await supertest(app)
      .get(`${ROTA}?atlasId=nao-e-uuid`)
      .set('Authorization', `Bearer ${tokenDono}`);

    assert.ok(res.status < 500, `um valor malformado do cliente não pode virar ${res.status}`);
    assert.ok(res.status >= 400, 'e também não pode ser aceito');
    const corpo = JSON.stringify(res.body);
    assert.doesNotMatch(corpo, /invalid input syntax/i, 'mensagem crua do driver vazou');
    assert.doesNotMatch(corpo, /uuid/i, 'o tipo da coluna não é assunto do cliente');
  });

  it('atlasId ausente: 400 pelo liftAtlasIdToParams, antes de qualquer consulta', async () => {
    // Sem atlasId não há o que autorizar, e o DELETE já teve um fallback de "limpar
    // TUDO" que era um wipe cross-atlas por token qualquer.
    await supertest(app).get(ROTA).set('Authorization', `Bearer ${tokenDono}`).expect(400);
    await supertest(app).delete(ROTA).set('Authorization', `Bearer ${tokenDono}`).expect(400);
  });

  it('anônimo: 401 — o gate por atlas nunca chega a rodar sem identidade', async () => {
    await supertest(app).get(`${ROTA}?atlasId=${atlasId}`).expect(401);
  });

  // -------------------------------------------------------------------------
  // 2. Gate por atlas
  // -------------------------------------------------------------------------

  it('token válido SEM relação com o atlas não lê o ring (IDOR cross-atlas)', async () => {
    const res = await supertest(app)
      .get(`${ROTA}?atlasId=${atlasId}`)
      .set('Authorization', `Bearer ${tokenEstranho}`);
    // 404 e NÃO 403: quem não tem relação nenhuma com o atlas não pode nem descobrir
    // que ele existe (a escada decidida em 2026-07-25, espelhando
    // enforceProjectReadable do sv360). O 403 fica para quem TEM share — o caso
    // seguinte —, e é a distinção entre os dois que faz cada um significar algo.
    assert.equal(res.status, 404, 'um estranho não pode distinguir "não é seu" de "não existe"');
    assert.equal(res.body?.data, undefined, 'nenhum span pode ter sido devolvido');
  });

  it('DELETE exige `manage`: quem só tem `read` não apaga o ring alheio', async () => {
    recordSpan(atlasId, TraceStage.SERVER_INSERTED, { opId: 'op-guard' });

    const res = await supertest(app)
      .delete(`${ROTA}?atlasId=${atlasId}`)
      .set('Authorization', `Bearer ${tokenLeitor}`);
    assert.equal(res.status, 403, 'quem TEM share ve 403 (falta nivel), nao 404');

    // A prova de que o gate SEGUROU: o span continua lá.
    const leitura = await supertest(app)
      .get(`${ROTA}?atlasId=${atlasId}&opId=op-guard`)
      .set('Authorization', `Bearer ${tokenLeitor}`)
      .expect(200);
    assert.equal(leitura.body.data.spans.length, 1, 'o DELETE negado não pode ter limpado nada');
  });

  it('`manage` (co-Gestor, NÃO owner) apaga o ring — o nível do meio precisa passar', async () => {
    // Uma lista fechada tipo `owner || admin` excluiria o co-Gestor em silêncio, que
    // é o bug de permissão que já ocorreu duas vezes neste repositório.
    await supertest(app)
      .delete(`${ROTA}?atlasId=${atlasId}`)
      .set('Authorization', `Bearer ${tokenGestor}`)
      .expect(200);

    const depois = await supertest(app)
      .get(`${ROTA}?atlasId=${atlasId}`)
      .set('Authorization', `Bearer ${tokenGestor}`)
      .expect(200);
    assert.deepEqual(depois.body.data.spans, [], 'o ring precisa ter sido limpo de fato');
  });

  // -------------------------------------------------------------------------
  // 3. Filtros
  // -------------------------------------------------------------------------

  it('filtro opId devolve SÓ os spans daquela op, e traceId SÓ os daquele trace', async () => {
    clearTrace(atlasId);
    recordSpan(atlasId, TraceStage.SERVER_INSERTED, { opId: 'op-1', traceId: 'tr-1' });
    recordSpan(atlasId, TraceStage.SERVER_APPLIED, { opId: 'op-2', traceId: 'tr-2' });
    recordSpan(atlasId, TraceStage.SERVER_BROADCAST, { opId: 'op-1', traceId: 'tr-1' });

    const semFiltro = await supertest(app)
      .get(`${ROTA}?atlasId=${atlasId}`)
      .set('Authorization', `Bearer ${tokenLeitor}`)
      .expect(200);
    assert.equal(semFiltro.body.data.spans.length, 3, 'guarda: os três spans foram gravados');

    const porOp = await supertest(app)
      .get(`${ROTA}?atlasId=${atlasId}&opId=op-1`)
      .set('Authorization', `Bearer ${tokenLeitor}`)
      .expect(200);
    assert.equal(porOp.body.data.spans.length, 2, 'um filtro que não filtra devolveria 3');
    assert.ok(porOp.body.data.spans.every((s) => s.opId === 'op-1'));

    const porTrace = await supertest(app)
      .get(`${ROTA}?atlasId=${atlasId}&traceId=tr-2`)
      .set('Authorization', `Bearer ${tokenLeitor}`)
      .expect(200);
    assert.equal(porTrace.body.data.spans.length, 1);
    assert.equal(porTrace.body.data.spans[0].stage, TraceStage.SERVER_APPLIED);
  });

  it('os dois filtros combinam como conjunção (opId de um trace, traceId de outro → vazio)', async () => {
    const res = await supertest(app)
      .get(`${ROTA}?atlasId=${atlasId}&opId=op-1&traceId=tr-2`)
      .set('Authorization', `Bearer ${tokenLeitor}`)
      .expect(200);
    assert.deepEqual(res.body.data.spans, [], 'aplicar só o último filtro devolveria 1');
  });

  it('atlas legível SEM nenhum span: 200 com spans [] — nem 404 nem 500', async () => {
    // O merger do Playwright itera essa lista; undefined ou um 404 quebrariam a
    // coleta em vez de reportar "não houve span".
    const res = await supertest(app)
      .get(`${ROTA}?atlasId=${atlasVazioId}`)
      .set('Authorization', `Bearer ${tokenLeitor}`)
      .expect(200);
    assert.ok(Array.isArray(res.body.data.spans));
    assert.equal(res.body.data.spans.length, 0);
    assert.equal(res.body.data.enabled, true, 'sob NODE_ENV=test o tracer está ligado');
  });

  it('atlas inexistente (uuid bem formado): 404, sem distinguir de "existe mas não é seu"', async () => {
    await supertest(app)
      .get(`${ROTA}?atlasId=${randomUUID()}`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .expect(404);
  });
});
