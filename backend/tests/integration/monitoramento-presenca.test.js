// Path: tests/integration/monitoramento-presenca.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import config from '../../src/config.js';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';

describe('Presença, identidade e inventário administrativo', () => {
  let app, db, admin, user, token, userToken;
  before(async () => {
    ({ app, db } = await setupTestEnv());
    admin = await createUser(db, { role: 'admin' });
    user = await createUser(db);
    token = await loginUser(app, admin.username, admin.password);
    userToken = await loginUser(app, user.username, user.password);
    await db.query('DELETE FROM uso_presenca');
  });
  after(async () => { await teardownTestEnv(); });
  const pulso = (id, auth, extra = {}) => {
    const r = supertest(app).post('/api/v1/uso/presenca');
    if (auth) r.set('Authorization', `Bearer ${auth}`);
    return r.send({ navegadorId: id, ...extra });
  };
  const agora = () => supertest(app).get('/api/v1/uso/agora').set('Authorization', `Bearer ${token}`).expect(200);

  it('public-link visitors report usage, presence and errors as anonymous', async () => {
    const visitor = jwt.sign({ sub: `public-${randomUUID()}`, isPublic: true, atlasId: randomUUID(), role: 'user' }, config.jwt.secret, { expiresIn: '5m' });
    const session = randomUUID();
    await pulso(randomUUID(), visitor).expect(204);
    await supertest(app).post('/api/v1/uso/eventos').set('Authorization', `Bearer ${visitor}`)
      .send({ sessaoId: session, pagina: 'mapa', inicio: Date.now(), ultimoSinal: Date.now(), eventos: [] }).expect(204);
    const assinatura = `anonymous-audit-${randomUUID()}`;
    await supertest(app).post('/api/v1/diag/erro-cliente').set('Authorization', `Bearer ${visitor}`)
      .send({ assinatura, mensagem: 'Client error', url: '/mapa?api_key=secret-one&api_key=secret-two&token=secret-three' }).expect(204);
    const row = (await db.query('SELECT user_id FROM uso_sessoes WHERE sessao_id = $1', [session])).rows[0];
    assert.equal(row.user_id, null);
    const defect = (await db.query('SELECT url FROM defeitos WHERE assinatura = $1', [assinatura])).rows[0];
    assert.doesNotMatch(defect.url, /secret-/);
    await db.query('DELETE FROM uso_presenca');
  });

  it('cannot merge an anonymous or another account batch into an authenticated session', async () => {
    const session = randomUUID();
    const lote = { sessaoId: session, pagina: 'mapa', inicio: Date.now(), ultimoSinal: Date.now(),
      eventos: [{ evento: 'medicao.aberta', prop: 'angulo', contagem: 2 }] };
    await supertest(app).post('/api/v1/uso/eventos').set('Authorization', `Bearer ${userToken}`).send(lote).expect(204);
    for (const auth of [null, token]) {
      const request = supertest(app).post('/api/v1/uso/eventos');
      if (auth) request.set('Authorization', `Bearer ${auth}`);
      await request.send(lote).expect(409);
    }
    const row = (await db.query('SELECT user_id, eventos FROM uso_sessoes WHERE sessao_id = $1', [session])).rows[0];
    assert.deepEqual(row, { user_id: user.id, eventos: 2 });
  });

  it('administrative monitoring responses cannot remain in browser or shared caches', async () => {
    for (const route of ['/uso/agora', '/uso/resumo', '/diag/defeitos']) {
      const response = await supertest(app).get(`/api/v1${route}`).set('Authorization', `Bearer ${token}`).expect(200);
      assert.match(response.headers['cache-control'], /private.*no-store/);
      assert.match(response.headers.vary, /Cookie/);
      assert.match(response.headers.vary, /Authorization/);
    }
  });

  it('conta navegadores anônimos uma vez e contas logadas uma vez, mesmo em dois navegadores', async () => {
    const anon = randomUUID();
    await pulso(anon).expect(204);
    await pulso(anon).expect(204);
    await pulso(randomUUID(), userToken, { pendentes: 3, idadePendenteMs: 120000 }).expect(204);
    await pulso(randomUUID(), userToken, { pendentes: 0 }).expect(204);
    const { body } = await agora();
    assert.equal(body.data.logados, 1);
    assert.equal(body.data.deslogados, 1);
    assert.equal(body.data.pendentes, 3);
    assert.equal(body.data.navegadoresComPendencias, 1);
  });

  it('o payload e camelCase INTEIRO, e os desconhecidos nao viram zero', async () => {
    // O documento saia com as colunas cruas do Postgres em snake_case ao lado de um
    // `janelaSegundos` em camelCase, no MESMO objeto: a tela tinha de saber de cor de onde cada
    // campo vinha, e as somas `::bigint` chegavam como STRING, de modo que "3" e 3 conviviam.
    await db.query('DELETE FROM uso_presenca');
    // Um navegador que NAO conseguiu medir a propria fila: e a contagem que impede o painel de
    // anunciar uma frota em dia quando parte dela nao sabe se esta.
    await pulso(randomUUID()).expect(204);
    await pulso(randomUUID(), userToken, { pendentes: 2, idadePendenteMs: 60000 }).expect(204);
    const { body } = await agora();
    const d = body.data;
    assert.deepEqual(Object.keys(d).sort(), [
      'atualizadoEm', 'deslogados', 'falhasColeta', 'janelaSegundos', 'logados',
      'maiorIdadePendenteMs', 'navegadoresComPendencias', 'pendenciasDesconhecidas', 'pendentes',
    ].sort());
    // Nao-vacuidade da forma: nenhuma chave em snake_case sobreviveu.
    assert.equal(Object.keys(d).some(k => k.includes('_')), false, JSON.stringify(Object.keys(d)));
    assert.equal(typeof d.pendentes, 'number', 'a soma bigint sai como NUMERO, nao string');
    assert.equal(typeof d.falhasColeta, 'number');
    assert.equal(d.pendentes, 2);
    assert.equal(d.pendenciasDesconhecidas, 1, 'o navegador que nao mediu conta como desconhecido');
    assert.equal(d.maiorIdadePendenteMs, 60000);
    assert.equal(d.janelaSegundos, 90);
  });

  it('sem ninguem informando idade, `maiorIdadePendenteMs` e null e NAO zero', async () => {
    // `Number(null)` seria 0, e 0 ali afirmaria que a frota inteira acabou de sincronizar sobre
    // uma janela em que ninguem conseguiu medir nada.
    await db.query('DELETE FROM uso_presenca');
    await pulso(randomUUID()).expect(204);
    const { body } = await agora();
    assert.equal(body.data.maiorIdadePendenteMs, null);
    assert.equal(body.data.pendentes, 0);
  });
  it('logout substitui identidade, expiração remove presença e não há userId forjado no corpo', async () => {
    await db.query('DELETE FROM uso_presenca');
    const id = randomUUID();
    await pulso(id, userToken).expect(204);
    await pulso(id).expect(204);
    const { body } = await agora();
    assert.equal(body.data.logados, 0);
    assert.equal(body.data.deslogados, 1);
    await pulso(id, null, { userId: admin.id }).expect(422);
    await db.query("UPDATE uso_presenca SET visto_em = NOW() - INTERVAL '91 seconds'");
    const expirado = await agora();
    assert.equal(expirado.body.data.deslogados, 0);
  });
  it('somente administrador lê a presença', async () => {
    await supertest(app).get('/api/v1/uso/agora').expect(401);
    await supertest(app).get('/api/v1/uso/agora').set('Authorization', `Bearer ${userToken}`).expect(403);
    await agora();
  });
  it('lista último login e propriedade remota, separando lixeira e atlas de outra pessoa', async () => {
    await db.query("INSERT INTO atlas (name, owner_id) VALUES ('Ativo', $1), ('Outro', $2)", [user.id, admin.id]);
    await db.query("INSERT INTO atlas (name, owner_id, deleted_at) VALUES ('Lixeira', $1, NOW())", [user.id]);
    const r = await supertest(app).get('/api/v1/users').set('Authorization', `Bearer ${token}`).expect(200);
    const users = r.body.data;
    const found = users.find(u => u.id === user.id);
    assert.ok(found.last_login_at);
    assert.equal(found.remote_atlas_count, 1);
    assert.equal(found.trashed_atlas_count, 1);
  });
  it('repetir lote após perder resposta não duplica eventos; identidade antiga não vira outra pessoa', async () => {
    const lote = { loteId: randomUUID(), sessaoId: randomUUID(), pagina: 'mapa',
      inicio: Date.now(), ultimoSinal: Date.now(), identidade: user.id,
      eventos: [{ evento: 'medicao.aberta', prop: 'angulo', contagem: 3 }] };
    const enviar = auth => supertest(app).post('/api/v1/uso/eventos').set('Authorization', `Bearer ${auth}`).send(lote);
    await enviar(userToken).expect(204);
    await enviar(userToken).expect(204);
    await enviar(token).expect(409);
    const r = await db.query('SELECT eventos, user_id FROM uso_sessoes WHERE sessao_id = $1', [lote.sessaoId]);
    assert.equal(r.rows[0].eventos, 3);
    assert.equal(r.rows[0].user_id, user.id);
  });
  it('o total da categoria inclui alvos fora dos vinte primeiros e não inclui visitas de página', async () => {
    await db.query("DELETE FROM uso_eventos_dia WHERE evento = 'preferencia.base'");
    await db.query("INSERT INTO basemaps (id, name) SELECT 'monitor-base-' || n, 'Base ' || n FROM generate_series(0, 20) n");
    const lote = { sessaoId: randomUUID(), pagina: 'mapa', inicio: Date.now(), ultimoSinal: Date.now(),
      eventos: [...Array.from({ length: 21 }, (_, i) => ({ evento: 'preferencia.base', prop: `monitor-base-${i}`, contagem: 1 })),
        { evento: 'pagina.vista', contagem: 900 }] };
    await supertest(app).post('/api/v1/uso/eventos').send(lote).expect(204);
    const r = await supertest(app).get('/api/v1/uso/resumo?desde=1d').set('Authorization', `Bearer ${token}`).expect(200);
    const bases = r.body.data.ferramentas.filter(f => f.evento === 'preferencia.base');
    assert.equal(bases.length, 20);
    assert.ok(bases.every(b => b.totalCategoria === 21));
  });
  it('um lote atrasado não substitui vitais mais recentes', async () => {
    const id = randomUUID();
    const agora = Date.now();
    const lote = { sessaoId: id, pagina: 'mapa', inicio: agora - 10000, eventos: [] };
    await supertest(app).post('/api/v1/uso/eventos').send({ ...lote, ultimoSinal: agora - 1000, vitais: { lcpMs: 4000, inpMs: 100, cls: 0.1 } }).expect(204);
    await supertest(app).post('/api/v1/uso/eventos').send({ ...lote, ultimoSinal: agora - 5000, vitais: { lcpMs: 50, inpMs: 1000, cls: 0.5 } }).expect(204);
    const r = await db.query('SELECT * FROM uso_sessoes WHERE sessao_id = $1', [id]);
    assert.equal(r.rows[0].lcp_ms, 4000);
    assert.equal(r.rows[0].inp_ms, 100);
    assert.equal(Number(r.rows[0].cls), 0.1);
  });
});
