// Path: tests/integration/diag-status-sem-release.test.js
// O OUTRO LADO DO `?? null` DE `GET /api/v1/diag/status`: a instalação que NÃO declarou
// `EBGEO_RELEASE` recebe `release: null`, com a CHAVE presente.
//
// POR QUE UM ARQUIVO SÓ PARA ISTO. `src/config.js` é um singleton congelado na avaliação do
// módulo, e o par deste caso (`release-no-log-e-no-diag-status.test.js`) põe a env ANTES
// dela. Os dois estados não cabem no mesmo processo, e o runner dá um processo por arquivo
// de teste. A alternativa preguiçosa seria montar o objeto à mão dentro daquele arquivo, o
// que asseriria sobre o teste em vez de sobre o controller.
//
// A ENV É APAGADA DE PROPÓSITO no topo: sem isso, um desenvolvedor com `EBGEO_RELEASE` no
// shell veria este caso vermelho por causa do ambiente dele, e um teste que depende do
// ambiente de quem roda é um teste que alguém desliga.
//
// CONTROLE NEGATIVO: trocar `config.release ?? null` por `config.release` no controller
// (`src/modules/diag/diag.controller.js`) deixa a chave sumir do JSON, e a asserção de
// PRESENÇA abaixo fica vermelha — que é a distinção inteira, porque `null` a tela sabe
// nomear ("esta instalação não declarou build") e chave ausente ela lê como servidor antigo.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { randomUUID } from 'node:crypto';

delete process.env.EBGEO_RELEASE;

const { setupTestEnv, teardownTestEnv } = await import('../helpers/setup.js');
const { createAdminUser, loginUser } = await import('../helpers/fixtures.js');
const { default: config } = await import('../../src/config.js');

describe('GET /diag/status sem EBGEO_RELEASE', () => {
  let app, db, adminToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db, { username: `srel_adm_${randomUUID().slice(0, 6)}` });
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('`release` vem como null, e a CHAVE existe', async () => {
    assert.equal(config.release, undefined, 'guarda: este processo não tem release nenhum');

    const res = await supertest(app)
      .get('/api/v1/diag/status?desde=1h')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    assert.equal(Object.hasOwn(res.body.data, 'release'), true, 'a chave não pode sumir');
    assert.equal(res.body.data.release, null);
    // Guarda de que o payload é mesmo o do status, e não um erro bem-formado.
    assert.equal(typeof res.body.data.total, 'number');
  });

  it('o /health continua `{ status: "ok" }` também aqui', async () => {
    // Sem release não há como distinguir "a rota não publica" de "não havia o que publicar",
    // e é por isso que a afirmação de exposição mora no arquivo que TEM a env. Este caso só
    // prende que a forma do /health é a mesma nos dois mundos.
    const res = await supertest(app).get('/api/v1/health').expect(200);
    assert.deepEqual(res.body, { status: 'ok' });
  });
});
