// Path: tests/integration/catalogo-estilo-de-camada.repro.test.js
//
// REPRO: registrar uma camada de dados pelo painel era IMPOSSÍVEL, e a mensagem culpava o
// usuário por não ter escrito um documento que aquele campo nunca teve.
//
// A palavra `style` tem DOIS significados no catálogo, e `assertValidStyle`
// (`src/modules/catalog/catalog.service.js`) rodava para as quatro tabelas:
//   - em `basemaps` é um documento MapLibre INTEIRO, servido verbatim no `GET /config`, e um
//     documento malformado ali trava o mapa de todo mundo. É por isso que a validação existe.
//   - em `data_layers` é um RECORTE de pintura (`fill` / `border` / `label`), que por construção
//     não tem `version`, nem `sources`, nem `layers`.
// O template padrão do formulário de camada de dados já nasce com `style.border` preenchido
// (`frontend/src/js/admin/catalog-tab.js`), então o caminho feliz da tela batia num 400 dizendo
// `Style must have "version": 8`. O cliente já gateava a validação de estilo inteiro por
// categoria e explicava o porquê em comentário; quem validava demais era o servidor.
//
// O defeito estava vivo em produção e passou meses invisível para a suíte porque a única camada
// que exercitava esse fluxo é o Playwright, que fica FORA do `npm test` e roda à mão.
//
// A GUARDA É NOS DOIS SENTIDOS, de propósito. Um teste que só afirmasse "camada de dados passa"
// ficaria verde se alguém apagasse `assertValidStyle` inteira, que é o conserto errado: o mapa
// base voltaria a aceitar um estilo quebrado, e o modo de falha DAQUELE lado é o mapa não abrir
// para ninguém.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, loginUser } from '../helpers/fixtures.js';

/** O template que o formulário de camada de dados do painel oferece ao operador. */
const ESTILO_DE_CAMADA = { border: { color: '#E74C3C', width: 2, opacity: 1 } };

/** Um documento MapLibre mínimo e VÁLIDO, para o outro sentido da guarda. */
const ESTILO_DE_MAPA_VALIDO = { version: 8, sources: {}, layers: [] };

/** Versão 7: o caso que a validação existe para recusar. */
const ESTILO_DE_MAPA_QUEBRADO = { version: 7, sources: {}, layers: [] };

const novoId = (prefixo) => `${prefixo}_${randomUUID().slice(0, 8)}`;

describe('catálogo · o `style` de uma camada de dados não é um estilo de mapa', () => {
  let app, db, adminToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db, { username: `cat_style_${randomUUID().slice(0, 8)}` });
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv();
  });

  it('cria a camada de dados com o template padrão do painel, e o recorte sobrevive', async () => {
    const id = novoId('dl');
    const res = await supertest(app)
      .post('/api/v1/data-layers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        id,
        name: 'Camada de Teste',
        config: {
          source: { type: 'vector', url: '/cms/martin/teste' },
          sourceLayer: 'teste',
          minzoom: 4,
          maxzoom: 18,
          style: ESTILO_DE_CAMADA,
        },
      })
      .expect(201);

    // Não basta o 201: se o recorte fosse descartado no caminho, a camada nasceria sem pintura
    // e a tela desenharia a borda padrão sem nada acusar.
    assert.deepEqual(res.body.data.config.style, ESTILO_DE_CAMADA);
  });

  it('atualiza a camada mantendo o recorte (o PUT passava pela mesma guarda)', async () => {
    const id = novoId('dl');
    await supertest(app)
      .post('/api/v1/data-layers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id, name: 'Antes', config: { source: { type: 'vector', url: '/x' } } })
      .expect(201);

    const res = await supertest(app)
      .put(`/api/v1/data-layers/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Depois',
        config: { source: { type: 'vector', url: '/x' }, style: ESTILO_DE_CAMADA },
      })
      .expect(200);

    assert.deepEqual(res.body.data.config.style, ESTILO_DE_CAMADA);
  });

  it('o mapa base com estilo QUEBRADO continua sendo recusado (a guarda não sumiu)', async () => {
    const res = await supertest(app)
      .post('/api/v1/basemaps')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        id: novoId('bm'),
        name: 'Base Quebrada',
        config: { url: 'https://t/{z}/{x}/{y}.png', style: ESTILO_DE_MAPA_QUEBRADO },
      })
      .expect(400);

    // A mensagem é a evidência de que o 400 veio DESTA guarda, e não de validação de corpo.
    assert.match(res.body.error?.message ?? res.body.message ?? '', /Invalid MapLibre style/);
  });

  it('o mapa base com estilo VÁLIDO continua entrando', async () => {
    const id = novoId('bm');
    const res = await supertest(app)
      .post('/api/v1/basemaps')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        id,
        name: 'Base Sã',
        config: { url: 'https://t/{z}/{x}/{y}.png', style: ESTILO_DE_MAPA_VALIDO },
      })
      .expect(201);

    assert.deepEqual(res.body.data.config.style, ESTILO_DE_MAPA_VALIDO);
  });
});
