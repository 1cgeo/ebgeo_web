// Path: tests/integration/monitoramento-presenca.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
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

  it('conta navegadores anônimos uma vez e contas logadas uma vez, mesmo em dois navegadores', async () => {
    const anon = randomUUID();
    await pulso(anon).expect(204);
    await pulso(anon).expect(204);
    await pulso(randomUUID(), userToken, { pendentes: 3, idadePendenteMs: 120000 }).expect(204);
    await pulso(randomUUID(), userToken, { pendentes: 0 }).expect(204);
    const { body } = await agora();
    assert.equal(body.data.logados, 1);
    assert.equal(body.data.deslogados, 1);
    assert.equal(Number(body.data.pendentes), 3);
    assert.equal(body.data.navegadores_com_pendencias, 1);
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
