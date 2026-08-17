// Path: tests/integration/resource-access-visible.test.js
//
// O ENDPOINT ADITIVO (fase F3).
//
// `GET /api/v1/resource-access/visible` é o segundo endpoint que o desenho exige.
// Ele existe para que `/api/config` NÃO precise variar por chamador: aquele
// documento é memoizado como UM só e serve um boot fail-fast, então filtrá-lo por
// usuário trocaria um memo O(1) por um memo por conjunto de visibilidade, que é
// ilimitado.
//
// Daí as duas afirmações que este arquivo faz JUNTAS, e que separadas não valem
// nada:
//   - o recurso privado concedido APARECE aqui para o beneficiário;
//   - e continua AUSENTE do `/api/config`, para todo mundo, inclusive para ele.
//
// A segunda é o que prende a propriedade do memo. Sem ela, alguém "conserta" o
// /api/config para incluir o concedido e nada fica vermelho.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

/** [tipo, tabela, chave no payload aditivo, caminho no /api/config]. */
const TIPOS = [
  ['tileset', 'tilesets', 'tilesets', (c) => c.tilesets],
  ['data_layer', 'data_layers', 'dataLayers', (c) => c.dataLayers.layers],
  ['analysis_layer', 'analysis_layers', 'analysisLayers', (c) => c.analysisLayers.layers],
];

describe('F3 — /resource-access/visible entrega o privado concedido, e só a ele', () => {
  let app, db, admin, beneficiario, forasteiro;
  let tokenAdmin, tokenBeneficiario, tokenForasteiro;
  const sufixo = randomUUID().slice(0, 8);
  const idDe = (tabela) => `vis-${tabela}-${sufixo}`;

  const visiveis = async (token) => (await supertest(app)
    .get('/api/v1/resource-access/visible')
    .set('Authorization', `Bearer ${token}`)
    .expect(200)).body.data;

  const config = async (token) => {
    const req = supertest(app).get('/api/config');
    if (token) req.set('Authorization', `Bearer ${token}`);
    const res = await req.expect(200);
    return res.body.data ?? res.body;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `vis_admin_${sufixo}` });
    beneficiario = await createUser(db, { username: `vis_ben_${sufixo}` });
    forasteiro = await createUser(db, { username: `vis_fora_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenBeneficiario = await loginUser(app, beneficiario.username, beneficiario.password);
    tokenForasteiro = await loginUser(app, forasteiro.username, forasteiro.password);

    for (const [, tabela] of TIPOS) {
      // `analysis_layers` só chega ao /api/config com `bounds` de 4 posições — o
      // contrato congelado filtra as demais.
      const cfg = tabela === 'analysis_layers'
        ? { bounds: [-45, -23, -44, -22], url: '/x' }
        : { url: '/x' };
      await db.query(
        `INSERT INTO ${tabela} (id, name, config, sort_order, access_level)
         VALUES ($1, $2, $3::jsonb, 0, 'private')`,
        [idDe(tabela), `Recurso ${tabela}`, JSON.stringify(cfg)]
      );
    }
  });

  after(async () => {
    for (const [, tabela] of TIPOS) {
      await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [idDe(tabela)]);
      await db.query(`DELETE FROM ${tabela} WHERE id = $1`, [idDe(tabela)]);
    }
    await teardownTestEnv(db);
  });

  it('sem credencial, 401 — o payload é pessoal e não tem versão anônima', async () => {
    await supertest(app).get('/api/v1/resource-access/visible').expect(401);
  });

  it('o forasteiro não vê nenhum dos três; o admin vê os três (papel global)', async () => {
    const dele = await visiveis(tokenForasteiro);
    const doAdmin = await visiveis(tokenAdmin);
    let medidos = 0;
    for (const [, tabela, chave] of TIPOS) {
      assert.ok(!dele[chave].map((r) => r.id).includes(idDe(tabela)), `${tabela}: forasteiro não vê`);
      assert.ok(doAdmin[chave].map((r) => r.id).includes(idDe(tabela)), `${tabela}: admin vê por papel global`);
      medidos += 1;
    }
    assert.equal(medidos, 3, 'guarda: os três tipos precisam ter sido medidos');
  });

  it('concedido, o beneficiário passa a ver os três — e o forasteiro continua sem ver', async () => {
    const antes = await visiveis(tokenBeneficiario);
    for (const [, tabela, chave] of TIPOS) {
      assert.ok(!antes[chave].map((r) => r.id).includes(idDe(tabela)), `piso: ${tabela} ausente antes`);
    }

    for (const [tipo, tabela] of TIPOS) {
      await supertest(app)
        .post(`/api/v1/resource-access/${tipo}/${idDe(tabela)}/grants`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ granteeId: beneficiario.id, grantLevel: 'view' })
        .expect(201);
    }

    const depois = await visiveis(tokenBeneficiario);
    const doForasteiro = await visiveis(tokenForasteiro);
    for (const [, tabela, chave] of TIPOS) {
      assert.ok(depois[chave].map((r) => r.id).includes(idDe(tabela)), `${tabela}: concedido, aparece`);
      assert.ok(
        !doForasteiro[chave].map((r) => r.id).includes(idDe(tabela)),
        `${tabela}: a concessão é PESSOAL — o forasteiro não pega carona`
      );
    }
  });

  it('e o /api/config continua sem o privado, inclusive para o beneficiário', async () => {
    // ESTA É A METADE QUE PRENDE O DESENHO. O documento público não varia por
    // chamador, e é o que permite memoizá-lo como um só num endpoint cuja falha
    // impede o boot.
    for (const [quem, token] of [['anônimo', null], ['beneficiário', tokenBeneficiario], ['admin', tokenAdmin]]) {
      const c = await config(token);
      for (const [, tabela, , pega] of TIPOS) {
        assert.ok(
          !pega(c).map((r) => r.id).includes(idDe(tabela)),
          `${tabela}: privado não pode entrar no /api/config nem para ${quem}`
        );
      }
    }
    // Discriminação: o mesmo documento CARREGA outras coisas, então a ausência
    // acima não é o payload estar vazio.
    const c = await config(null);
    assert.ok(Array.isArray(c.tilesets), 'o payload precisa ter a lista de tilesets');
  });

  it('o payload traz só o PRIVADO — ele é o delta sobre o público, não o conjunto', async () => {
    const publico = `vis-publico-${sufixo}`;
    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order) VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0)`,
      [publico, `Público ${sufixo}`]
    );
    try {
      const ids = (await visiveis(tokenAdmin)).tilesets.map((t) => t.id);
      assert.ok(!ids.includes(publico), 'o público não pode vir aqui: o cliente o somaria duas vezes');
      assert.ok(ids.includes(idDe('tilesets')), 'e o privado continua vindo');
    } finally {
      await db.query('DELETE FROM tilesets WHERE id = $1', [publico]);
    }
  });

  it('o item vem no mesmo SHAPE do /api/config (`{id, name, ...config}`)', async () => {
    // O cliente soma isto DENTRO dos arrays de `config`. Um item com shape
    // diferente dos vizinhos quebra o consumidor no ponto de USO, longe daqui.
    const item = (await visiveis(tokenAdmin)).tilesets.find((t) => t.id === idDe('tilesets'));
    assert.ok(item, 'guarda: o item precisa estar no payload');
    assert.equal(item.name, 'Recurso tilesets');
    assert.equal(item.url, '/x', 'as chaves de `config` sobem para a raiz do item');
    assert.equal(item.config, undefined, 'e `config` não viaja aninhado');
  });

  it('as quatro chaves existem sempre, mesmo vazias — o cliente itera sem checar', async () => {
    const dele = await visiveis(tokenForasteiro);
    for (const chave of ['tilesets', 'dataLayers', 'analysisLayers', 'views360']) {
      assert.ok(Array.isArray(dele[chave]), `${chave} precisa ser um array`);
    }
  });

  it('`atlasId` não-UUID morre na borda (422), e o ausente é estado legítimo (200)', async () => {
    // Um 400 no ausente transformaria o login numa falha: "sem atlas em foco" é o
    // estado de quem acabou de entrar.
    await supertest(app)
      .get('/api/v1/resource-access/visible?atlasId=nao-e-uuid')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(422);
    await supertest(app)
      .get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
  });
});
