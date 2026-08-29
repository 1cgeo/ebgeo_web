// Path: tests/integration/auto-cadastro-toggle-runtime.test.js
//
// O auto-cadastro virou um TOGGLE de runtime em 2026-08-29 (decisão do dono): a rota
// `/auth/register` é sempre montada e `requireSelfRegistrationEnabled` a gateia pela config
// EFETIVA (`features.self_registration`), que o administrador liga e desliga sem redeploy. Este
// arquivo prova o gate nas duas direções, e prova que ele roda ANTES da validação (corpo vazio
// com o gate ligado dá 422 de validação, não 403).
//
// O par negativo importa: sem o gate, o corpo vazio daria 422 sempre, e "desligado" pareceria
// funcionar por acidente. Por isso o caso desligado manda um corpo VÁLIDO e ainda assim espera
// 403 — a recusa é do gate, não do schema.
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { updateConfigOverrides, clearConfigOverrides } from '../../src/modules/config/config.service.js';

describe('Auto-cadastro: toggle de runtime', () => {
  let app;
  const corpoValido = {
    username: `novato_${Date.now()}`,
    password: 'senha123',
    nome: 'Novato da Silva',
    email: `novato_${Date.now()}@example.mil`,
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
  });

  afterEach(async () => {
    // Volta ao padrão do env (ligado no teste), para não vazar estado entre casos.
    await clearConfigOverrides();
  });

  after(async () => {
    await teardownTestEnv();
  });

  it('DESLIGADO: a rota recusa com 403, mesmo com corpo válido', async () => {
    await updateConfigOverrides({ features: { self_registration: false } }, null);
    const res = await supertest(app).post('/api/v1/auth/register').send(corpoValido);
    assert.equal(res.status, 403, 'o gate recusa antes de qualquer efeito');
  });

  it('DESLIGADO: o GET /api/config anuncia o mesmo fato', async () => {
    await updateConfigOverrides({ features: { self_registration: false } }, null);
    const res = await supertest(app).get('/api/config').expect(200);
    assert.equal(res.body.data.features.self_registration, false,
      'o botão "Criar conta" e a rota leem a MESMA flag');
  });

  it('LIGADO: o gate passa (corpo vazio cai na validação, 422, não no 403)', async () => {
    await updateConfigOverrides({ features: { self_registration: true } }, null);
    const res = await supertest(app).post('/api/v1/auth/register').send({});
    assert.equal(res.status, 422, 'passou do gate e bateu no schema');
  });
});
