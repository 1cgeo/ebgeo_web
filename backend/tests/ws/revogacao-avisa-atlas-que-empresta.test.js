// Path: tests/ws/revogacao-avisa-atlas-que-empresta.test.js
//
// A REVOGAÇÃO AVISA AO VIVO, E SÓ QUEM O ENDEREÇO ALCANÇA.
//
// O empréstimo por atlas (D4) vive enquanto o DONO do atlas vir o recurso. Revogar a
// concessão do dono derruba o empréstimo de TODA a sala de uma vez, e até esta fase
// ninguém era avisado: o `config` de cada membro continuava listando o recurso que o
// servidor já recusava, e o sintoma era CAMADA QUEBRADA em vez de camada ausente.
//
// O frame reusado é `atlas_resources_updated`, que só AVISA: cada receptor re-pede o
// PRÓPRIO payload aditivo (`GET /resource-access/visible`), porque o conjunto visível é
// diferente por pessoa e mandá-lo no frame de todos seria vazamento pelo canal de tempo
// real. Daí a segunda discriminação deste arquivo, que afirma as CHAVES da mensagem.
//
// O alcance NÃO fecha, e está dito assim de propósito: o beneficiário pessoal fora de um
// atlas que empresta pode estar noutra sala ou sem socket nenhum, e continua percebendo a
// revogação no próximo pedido do payload (troca de atlas ou F5).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

// Curto de propósito: o piso deste arquivo é uma ESPERA QUE EXPIRA, e o custo dela é
// pago em toda rodada. 1200 ms é folgado para um broadcast em memória disparado por uma
// requisição HTTP local, e continua discriminando (medido: o frame chega em <100 ms).
const ESPERA_MS = 1200;
const settle = () => new Promise((r) => setTimeout(r, 600));

describe('revogação avisa a sala do atlas que EMPRESTA o recurso', () => {
  let app, db, server;
  let admin, dono, membro, tokenAdmin;
  let atlasQueEmpresta, atlasVizinho;
  const sufixo = randomUUID().slice(0, 8);
  const TILESET = `rev-ws-${sufixo}`;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));

    admin = await createAdminUser(db, { username: `revws_admin_${sufixo}` });
    dono = await createUser(db, { username: `revws_dono_${sufixo}` });
    membro = await createUser(db, { username: `revws_membro_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.query('DELETE FROM atlas_resources WHERE resource_id = $1', [TILESET]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [TILESET]);
    await db.query('DELETE FROM tilesets WHERE id = $1', [TILESET]);
    await teardownTestEnv(db);
  });

  /**
   * Monta o cenário inteiro do zero: recurso privado, concessão ao dono, dois atlas do
   * dono (um que anexa o recurso e um que não anexa), e o membro com `read` nos dois.
   * @returns {Promise<{ grantId: string, tokenDono: string, tokenMembro: string }>}
   */
  async function montarCenario() {
    await db.query('DELETE FROM atlas_resources WHERE resource_id = $1', [TILESET]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [TILESET]);
    await db.query('DELETE FROM tilesets WHERE id = $1', [TILESET]);
    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [TILESET, `Tileset ${sufixo}`]
    );

    const tokenDono = await loginUser(app, dono.username, dono.password);
    const tokenMembro = await loginUser(app, membro.username, membro.password);

    // A concessão PESSOAL ao dono é o que sustenta o empréstimo (D4) e o que o torna
    // capaz de anexar. É ela que a revogação derruba.
    const concessao = await supertest(app)
      .post(`/api/v1/resource-access/tileset/${TILESET}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: dono.id, grantLevel: 'view_share' })
      .expect(201);

    atlasQueEmpresta = await createAtlas(db, dono.id, { name: `empresta ${randomUUID().slice(0, 6)}` });
    atlasVizinho = await createAtlas(db, dono.id, { name: `vizinho ${randomUUID().slice(0, 6)}` });
    await createShare(db, atlasQueEmpresta.id, membro.id, 'read', dono.id);
    await createShare(db, atlasVizinho.id, membro.id, 'read', dono.id);

    await supertest(app)
      .post(`/api/v1/atlas/${atlasQueEmpresta.id}/resources`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({ resourceType: 'tileset', resourceId: TILESET })
      .expect(201);

    return { grantId: concessao.body.data.id, tokenDono, tokenMembro };
  }

  it('o peer na sala que empresta recebe o aviso; o de outra sala não recebe nada', async () => {
    const { grantId, tokenMembro } = await montarCenario();

    // PISO do cenário, medido e não presumido: com a concessão viva, o membro VÊ o
    // recurso pelo empréstimo. Sem esta linha, "o aviso chegou" seria compatível com um
    // empréstimo que nunca existiu, e o frame estaria avisando sobre nada.
    const antes = await supertest(app)
      .get(`/api/v1/resource-access/visible?atlasId=${atlasQueEmpresta.id}`)
      .set('Authorization', `Bearer ${tokenMembro}`)
      .expect(200);
    assert.ok(
      antes.body.data.tilesets.some((t) => t.id === TILESET),
      'piso: antes da revogação o membro enxerga o recurso pelo empréstimo'
    );

    const peer = await createWsClient(server, atlasQueEmpresta.id, tokenMembro);
    await peer.waitForType('connected');
    peer.clearMessages();

    const bystander = await createWsClient(server, atlasVizinho.id, tokenMembro);
    await bystander.waitForType('connected');
    bystander.clearMessages();

    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${grantId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const msg = await peer.waitForType('atlas_resources_updated', ESPERA_MS);

    // DISCRIMINAÇÃO 1 — o frame SÓ AVISA. Nem id, nem url, nem nome do recurso: a chave
    // única é o contrato, e sem esta asserção a correção poderia virar vazamento pelo
    // canal de tempo real (quem está na sala não é, necessariamente, quem tem acesso).
    assert.deepEqual(Object.keys(msg), ['type']);

    // DISCRIMINAÇÃO 2 — endereçado pela relação de EMPRÉSTIMO, não fan-out para todas as
    // salas. Um fan-out passaria o caso principal identicamente.
    await settle();
    assert.equal(
      bystander.getMessagesOfType('atlas_resources_updated').length, 0,
      'a sala do atlas que NÃO empresta o recurso não é acordada'
    );

    // E o efeito que o aviso anuncia é real: re-pedido o payload, o recurso sumiu.
    const depois = await supertest(app)
      .get(`/api/v1/resource-access/visible?atlasId=${atlasQueEmpresta.id}`)
      .set('Authorization', `Bearer ${tokenMembro}`)
      .expect(200);
    assert.equal(
      depois.body.data.tilesets.some((t) => t.id === TILESET), false,
      'o empréstimo caiu junto com a concessão do dono (D4)'
    );

    peer.close();
    bystander.close();
  });

  it('a revogação continua respondendo 200 com a lista de podadas (o aviso não é o produto)', async () => {
    const { grantId } = await montarCenario();

    const res = await supertest(app)
      .delete(`/api/v1/resource-access/grants/${grantId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    assert.equal(res.body.data.revoked.length, 1);
    assert.equal(res.body.data.revoked[0].id, grantId);
  });

  it('revogar de novo é idempotente e não acorda sala nenhuma', async () => {
    const { grantId, tokenMembro } = await montarCenario();

    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${grantId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const peer = await createWsClient(server, atlasQueEmpresta.id, tokenMembro);
    await peer.waitForType('connected');
    peer.clearMessages();

    // A segunda revogação poda ZERO linhas (`revoked_at IS NULL` no âncora), então não há
    // par (tipo, recurso) nenhum de onde derivar sala. Um aviso aqui seria ruído por
    // clique repetido, e é a metade que prova que o gatilho são as linhas PODADAS e não a
    // chegada da requisição.
    const segunda = await supertest(app)
      .delete(`/api/v1/resource-access/grants/${grantId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    assert.equal(segunda.body.data.revoked.length, 0);

    await settle();
    assert.equal(peer.getMessagesOfType('atlas_resources_updated').length, 0);

    peer.close();
  });
});
