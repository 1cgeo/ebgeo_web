// Path: tests/integration/resource-access-config.test.js
//
// A MARCA GANHA EFEITO EM /api/config (fase F2).
//
// `/api/config` é o documento PÚBLICO, e continua sendo: nada aqui varia por
// chamador. É por isso que `config.cache.js` pode memoizar UM documento e
// compartilhá-lo entre todos, anônimo inclusive, e é por isso que a rota pode ser
// pública num boot que é fail-fast nela. Filtrar por usuário destruiria o memo (ele
// passaria a ser por conjunto de visibilidade, que é ilimitado) no único endpoint
// cuja falha impede o produto de subir.
//
// Logo, o que este arquivo afirma NÃO é "o beneficiário vê no /api/config" — ele
// não vê, nem o admin vê. O que ele afirma é: um recurso marcado privado SAI do
// documento público, para todo mundo, e volta ao ser remarcado. O que o usuário
// ganha por concessão chega por um segundo endpoint, aditivo (fase F3).
//
// R3 — A INVALIDAÇÃO DO MEMO É METADE DO TESTE. Sem ela a marca só apareceria
// depois do TTL, ou nunca. E ela precisa rodar DEPOIS do commit: invalidar dentro
// da transação reabre a janela em forma de cache (um GET concorrente reconstrói o
// memo da linha ANTIGA e o re-cacha), que é a lição de
// config-admin-lost-update.repro.test.js.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

/**
 * [tipo de recurso, tabela, caminho dentro do payload de config].
 *
 * `basemap` entrou na migração 021 e é o único cuja chave no payload é um OBJETO
 * indexado por id, não um array — daí o `Object.keys`. A forma diferente é o
 * contrato congelado do `config.js` (o frontend indexa basemap por id), e reprojetá-la
 * aqui é o que permite os mesmos casos medirem os quatro tipos.
 */
const TIPOS = [
  ['basemap', 'basemaps', (c) => Object.keys(c.basemaps ?? {}).map((id) => ({ id }))],
  ['tileset', 'tilesets', (c) => c.tilesets],
  ['data_layer', 'data_layers', (c) => c.dataLayers.layers],
  ['analysis_layer', 'analysis_layers', (c) => c.analysisLayers.layers],
];

describe('F2 — recurso privado sai do /api/config (e o memo é invalidado)', () => {
  let app, db, adminToken, userToken;
  const sufixo = randomUUID().slice(0, 8);
  const idDe = (tabela) => `rac-${tabela}-${sufixo}`;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db, { username: `rac_admin_${sufixo}` });
    const user = await createUser(db, { username: `rac_user_${sufixo}` });
    adminToken = await loginUser(app, admin.username, admin.password);
    userToken = await loginUser(app, user.username, user.password);

    for (const [, tabela] of TIPOS) {
      // `analysis_layers` só chega ao payload com `bounds` de 4 posições — o
      // contrato congelado filtra as demais. Sem isso o caso mediria a ausência
      // pela razão errada.
      const config = tabela === 'analysis_layers'
        ? { bounds: [-45, -23, -44, -22], url: '/x' }
        : { url: '/x' };
      await db.query(
        `INSERT INTO ${tabela} (id, name, config, sort_order) VALUES ($1, $2, $3::jsonb, 0)`,
        [idDe(tabela), `Recurso ${tabela}`, JSON.stringify(config)]
      );
    }
  });

  after(async () => {
    for (const [, tabela] of TIPOS) {
      await db.query(`DELETE FROM ${tabela} WHERE id = $1`, [idDe(tabela)]);
    }
    await teardownTestEnv(db);
  });

  const config = async (token) => {
    const req = supertest(app).get('/api/config');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return (await req.expect(200)).body.data ?? (await req.expect(200)).body;
  };

  const marcar = async (tipo, id, accessLevel) =>
    supertest(app)
      .patch(`/api/v1/resource-access/${tipo}/${id}/visibility`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ accessLevel })
      .expect(200);

  it('piso: o payload público carrega as quatro fixtures antes de qualquer marca', async () => {
    const c = await config(null);
    let vistos = 0;
    for (const [, tabela, pega] of TIPOS) {
      const ids = pega(c).map((r) => r.id);
      assert.ok(ids.includes(idDe(tabela)), `${tabela}: a fixture precisa estar no payload público`);
      vistos += 1;
    }
    assert.equal(vistos, 4, 'guarda: os quatro tipos precisam ter sido medidos');
  });

  it('marcado privado, o recurso SAI do /api/config — anônimo, usuário comum e admin', async () => {
    let medidos = 0;
    for (const [tipo, tabela, pega] of TIPOS) {
      await marcar(tipo, idDe(tabela), 'private');
      try {
        // Os TRÊS chamadores, porque o payload não varia por chamador e a única
        // forma de provar isso é medir os três contra o mesmo documento.
        for (const [quem, token] of [['anônimo', null], ['usuário', userToken], ['admin', adminToken]]) {
          const ids = pega(await config(token)).map((r) => r.id);
          assert.ok(
            !ids.includes(idDe(tabela)),
            `${tabela}: privado não pode aparecer no /api/config nem para ${quem}`
          );
        }

        // O CONTROLE: remarcado público, volta na hora (sem esperar TTL). É o que
        // prova que a ausência acima foi o filtro, e não a fixture ter sumido.
        await marcar(tipo, idDe(tabela), 'public');
        const idsDepois = pega(await config(null)).map((r) => r.id);
        assert.ok(idsDepois.includes(idDe(tabela)), `${tabela}: remarcado público, volta ao payload`);
        medidos += 1;
      } finally {
        await db.query(`UPDATE ${tabela} SET access_level = 'public' WHERE id = $1`, [idDe(tabela)]);
      }
    }
    assert.equal(medidos, 4);
  });

  it('R3: a marca vale no PRÓXIMO pedido, sem TTL — o memo foi invalidado', async () => {
    // Aquece o memo primeiro: sem esta leitura, um payload nunca cacheado passaria
    // o teste sem que invalidação nenhuma tivesse acontecido.
    const antes = (await config(null)).tilesets.map((r) => r.id);
    assert.ok(antes.includes(idDe('tilesets')), 'guarda: o memo precisa estar quente e conter a fixture');

    await marcar('tileset', idDe('tilesets'), 'private');
    const depois = (await config(null)).tilesets.map((r) => r.id);
    assert.ok(!depois.includes(idDe('tilesets')), 'o recurso sai já no pedido seguinte');

    await marcar('tileset', idDe('tilesets'), 'public');
    const revertido = (await config(null)).tilesets.map((r) => r.id);
    assert.ok(revertido.includes(idDe('tilesets')), 'e volta já no pedido seguinte');
  });

  it('a auditoria registra a mudança com o alvo nas COLUNAS de alvo', async () => {
    await marcar('tileset', idDe('tilesets'), 'private');
    // A CONSULTA É A ASSERÇÃO PRINCIPAL: ela filtra por (target_type, target_id),
    // que é exatamente a pergunta que o schema antigo não sabia responder. Enquanto
    // `target_id` era UUID e o CHECK de `target_type` não previa tipo de recurso, o
    // alvo viajava em `details` e esta busca não existia. Migração 020.
    const { rows } = await db.query(
      `SELECT action, target_type, target_id, target_name, details FROM audit_trail
        WHERE action = 'SHARING_CHANGE' AND target_type = 'TILESET' AND target_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [idDe('tilesets')]
    );
    assert.equal(rows.length, 1, 'a marca precisa deixar UMA linha de auditoria');
    assert.equal(rows[0].details.accessLevel, 'private');
    assert.equal(rows[0].details.resourceType, 'tileset');
    assert.equal(rows[0].target_id, idDe('tilesets'));
    assert.equal(rows[0].target_type, 'TILESET');
    // O id de catálogo é SLUG, não UUID: gravá-lo aqui é o que a 020 destravou, e
    // afirmar isso é o que impede a coluna de voltar a ser UUID sem ninguém notar.
    assert.ok(!/^[0-9a-f-]{36}$/i.test(rows[0].target_id), 'o alvo é um slug, não um UUID');
    await marcar('tileset', idDe('tilesets'), 'public');
  });

  it('tipo fora da whitelist morre na BORDA (o tipo escolhe nome de tabela)', async () => {
    // 422, não 400: Joi na borda vira ValidationError, que é a convenção da casa.
    // O valor de parar aqui não é o código, é o LUGAR — `type` é interpolado no
    // nome da tabela mais adiante, então ele nunca pode chegar ao SQL sem passar
    // por lista fechada. `assertResourceType` é a segunda barreira, no serviço.
    await supertest(app)
      .patch('/api/v1/resource-access/users/x/visibility')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ accessLevel: 'private' })
      .expect(422);
    await supertest(app)
      .patch('/api/v1/resource-access/tilesets%3B%20DROP%20TABLE%20users/x/visibility')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ accessLevel: 'private' })
      .expect(422);
    // Discriminação: o mesmo corpo, com tipo válido e id inexistente, dá 404.
    await supertest(app)
      .patch('/api/v1/resource-access/tileset/nao-existe-mesmo/visibility')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ accessLevel: 'private' })
      .expect(404);
  });
});
