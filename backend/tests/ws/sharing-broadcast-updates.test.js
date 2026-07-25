// Path: tests/ws/sharing-broadcast-updates.test.js
// Item 41 — o broadcast WS `sharing_updated`: o campo `role`, as ações
// user_updated / user_removed / public_enabled / public_disabled, e a ordem
// escrita→broadcast.
//
// O único teste que existia (collab-broadcasts.test.js) cobre `user_added` com
// permission 'read' e NUNCA afirma `role`. O `role` é contrato que atravessa os dois
// pacotes: o par conectado re-gateia a UI ao vivo com ele, então um regress em
// `toFrontendRole` ou a remoção do campo passavam verdes. Pior: os broadcasts de
// user_updated, user_removed, public_enabled e public_disabled não tinham teste
// nenhum — apagar qualquer um deles deixava os pares divergentes até o sweep de
// heartbeat (~30 s), sem sinal nenhum.
//
// ── ACHADOS 90/101 (o mesmo defeito), corrigidos em 2026-07-25 ───────────────────────
// Este arquivo AFIRMAVA o vazamento. O observador do cenário tinha share 'read' e os
// quatro primeiros casos exigiam dele `userId` + `permission` + `role` do membro
// afetado — exatamente o que `GET /atlas/:id/sharing` nega com 403 a quem não é
// `manage`. Escrito nesta mesma semana para cobrir o `role`, o teste escolheu como
// testemunha o principal que não podia receber o frame, e com isso transformou um
// vazamento de metadado de gestão em contrato verde: consertar o backend REPROVARIA a
// suíte. Um teste de broadcast precisa nomear a audiência, não só a mensagem.
//
// As asserções foram invertidas: a testemunha do frame passou a ser o co-Gestor, e os
// níveis abaixo de `manage` (read, comment, write) mais o visitante de link público
// afirmam SILÊNCIO. As duas direções são obrigatórias — "ninguém abaixo de manage
// recebe" também passaria com o broadcast quebrado ou removido, e é por isso que cada
// caso negativo vem colado ao positivo do mesmo disparo.
//
// A exceção do PRÓPRIO usuário afetado é comportamento, não folga: o par re-gateia a UI
// ao vivo pelo `role` do frame (sync-engine.js `sharingUpdated`), então um Visualizador
// promovido precisa receber o frame que o nomeia mesmo estando abaixo de `manage`.
//
// `public_enabled` / `public_disabled` seguem abertos à sala inteira de propósito: não
// carregam identidade nenhuma, só dizem que o atlas foi publicado ou despublicado.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser,
  createAtlas,
  createMap,
  createShare,
  loginUser,
  makeAtlasPublic,
  getPublicToken,
} from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket } from '../../src/modules/collab/collab.gateway.js';

const U = () => `shb_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JANELA_SILENCIO_MS = 500;

/** Os quatro níveis armazenáveis de share, do menor ao maior. `owner` é sintetizado. */
const NIVEIS = ['read', 'comment', 'write', 'manage'];
/** Quem NÃO pode ver a composição do atlas — o mesmo conjunto que o REST responde 403. */
const ABAIXO_DE_MANAGE = ['read', 'comment', 'write'];

describe('broadcast `sharing_updated` — audiência, role, ações e ordem escrita→broadcast', () => {
  let app, db, server;
  let owner, ownerTok, alvo, alvoTok;
  /** @type {Record<string, {user: Object, token: string}>} nível -> membro fixo */
  const membros = {};
  /** Sockets abertos no caso corrente, fechados no afterEach. */
  let abertos = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));

    owner = await createUser(db, { username: U() });
    ownerTok = await loginUser(app, owner.username, owner.password);
    alvo = await createUser(db, { username: U() });
    alvoTok = await loginUser(app, alvo.username, alvo.password);

    for (const nivel of NIVEIS) {
      const u = await createUser(db, { username: U() });
      membros[nivel] = { user: u, token: await loginUser(app, u.username, u.password) };
    }
  });

  afterEach(() => {
    for (const c of abertos) c.close();
    abertos = [];
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  /** Conecta um socket ao atlas, espera o `connected` e limpa o buffer. */
  async function conectar(atlasId, token) {
    const c = await createWsClient(server, atlasId, token);
    await c.waitForType('connected');
    c.clearMessages();
    abertos.push(c);
    return c;
  }

  /**
   * Atlas novo com um socket de CADA nível na sala (read, comment, write, manage) mais o
   * dono, e opcionalmente um visitante anônimo de link público.
   */
  async function cenario({ comPublico = false } = {}) {
    const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);

    const pares = {};
    for (const nivel of NIVEIS) {
      await createShare(db, atlas.id, membros[nivel].user.id, nivel, owner.id);
      pares[nivel] = await conectar(atlas.id, membros[nivel].token);
    }
    pares.owner = await conectar(atlas.id, ownerTok);

    if (comPublico) {
      const link = await makeAtlasPublic(db, atlas.id);
      pares.publico = await conectar(atlas.id, await getPublicToken(app, link));
    }

    return { atlas, pares };
  }

  const asOwner = (metodo, url) =>
    supertest(app)[metodo](url).set('Authorization', `Bearer ${ownerTok}`);

  /** Afirma que nenhum dos sockets recebeu `sharing_updated` (após a janela de silêncio). */
  async function afirmaSilencio(entradas) {
    assert.ok(entradas.length > 0, 'lista de testemunhas vazia = zero asserções = verde vazio');
    await sleep(JANELA_SILENCIO_MS);
    for (const [nome, par] of entradas) {
      assert.deepEqual(
        par.getMessagesOfType('sharing_updated'),
        [],
        `${nome} não pode receber a composição do atlas — o REST lhe responde 403`
      );
    }
  }

  // ==========================================================================
  // Direção 1: quem DEVE receber continua recebendo (sem isto, o silêncio abaixo
  // passaria com o broadcast simplesmente apagado).
  // ==========================================================================

  it("POST /sharing/users {permission:'manage'} → user_added com role 'manager' para o co-Gestor e o dono", async () => {
    const { atlas, pares } = await cenario();

    await asOwner('post', `/api/v1/atlas/${atlas.id}/sharing/users`)
      .send({ userId: alvo.id, permission: 'manage' })
      .expect(201);

    for (const [nome, par] of [['co-Gestor', pares.manage], ['dono', pares.owner]]) {
      const msg = await par.waitForType('sharing_updated');
      assert.equal(msg.action, 'user_added', nome);
      assert.equal(msg.userId, alvo.id, nome);
      assert.equal(msg.permission, 'manage', nome);
      assert.equal(msg.role, 'manager', 'o papel do frontend viaja no frame, não só a permissão');
    }
  });

  it("PUT /sharing/users/:id {permission:'comment'} → user_updated com role 'commenter'", async () => {
    const { atlas, pares } = await cenario();
    await createShare(db, atlas.id, alvo.id, 'write', owner.id);

    await asOwner('put', `/api/v1/atlas/${atlas.id}/sharing/users/${alvo.id}`)
      .send({ permission: 'comment' })
      .expect(200);

    const msg = await pares.manage.waitForType('sharing_updated');
    assert.equal(msg.action, 'user_updated');
    assert.equal(msg.userId, alvo.id);
    assert.equal(msg.permission, 'comment');
    assert.equal(msg.role, 'commenter');
  });

  it('DELETE /sharing/users/:id → user_removed (nenhum teste cobria a remoção)', async () => {
    const { atlas, pares } = await cenario();
    await createShare(db, atlas.id, alvo.id, 'write', owner.id);

    await asOwner('delete', `/api/v1/atlas/${atlas.id}/sharing/users/${alvo.id}`).expect(204);

    const msg = await pares.manage.waitForType('sharing_updated');
    assert.equal(msg.action, 'user_removed');
    assert.equal(msg.userId, alvo.id);
  });

  // ==========================================================================
  // Direção 2: quem NÃO deve receber não recebe (achados 90/101)
  // ==========================================================================

  it('90/101 — user_added NÃO chega a read, comment, write nem ao visitante público', async () => {
    const { atlas, pares } = await cenario({ comPublico: true });

    await asOwner('post', `/api/v1/atlas/${atlas.id}/sharing/users`)
      .send({ userId: alvo.id, permission: 'manage' })
      .expect(201);

    // Sincroniza pelo destinatário legítimo antes de afirmar o silêncio dos demais.
    await pares.manage.waitForType('sharing_updated');
    await afirmaSilencio([
      ...ABAIXO_DE_MANAGE.map((n) => [`o membro '${n}'`, pares[n]]),
      ['o visitante anônimo do link público', pares.publico],
    ]);
  });

  it('90/101 — `comment` e `write` (os níveis do MEIO) também ficam de fora do user_updated', async () => {
    // O erro que este repositório já cometeu duas vezes é a lista fechada: `skipReadOnly`
    // sozinho cala só o 'read' e continua entregando a 'comment' e a 'write', que o gate
    // `manage` do REST nega igualmente. O gate aqui é por NÍVEL.
    const { atlas, pares } = await cenario();
    await createShare(db, atlas.id, alvo.id, 'read', owner.id);

    await asOwner('put', `/api/v1/atlas/${atlas.id}/sharing/users/${alvo.id}`)
      .send({ permission: 'write' })
      .expect(200);

    await pares.manage.waitForType('sharing_updated');
    await afirmaSilencio(ABAIXO_DE_MANAGE.map((n) => [`o membro '${n}'`, pares[n]]));
  });

  it('90/101 — o user_removed de um terceiro não chega a quem está abaixo de manage', async () => {
    const { atlas, pares } = await cenario({ comPublico: true });
    await createShare(db, atlas.id, alvo.id, 'write', owner.id);

    await asOwner('delete', `/api/v1/atlas/${atlas.id}/sharing/users/${alvo.id}`).expect(204);

    await pares.manage.waitForType('sharing_updated');
    await afirmaSilencio([
      ...ABAIXO_DE_MANAGE.map((n) => [`o membro '${n}'`, pares[n]]),
      ['o visitante anônimo do link público', pares.publico],
    ]);
  });

  // ==========================================================================
  // A exceção do próprio afetado — a parte que `{ skipReadOnly: true }` quebraria
  // ==========================================================================

  it('o PRÓPRIO afetado, mesmo com share read, recebe o frame que o nomeia (é assim que ele re-gateia a UI)', async () => {
    const { atlas, pares } = await cenario();
    await createShare(db, atlas.id, alvo.id, 'read', owner.id);
    const dele = await conectar(atlas.id, alvoTok);

    await asOwner('put', `/api/v1/atlas/${atlas.id}/sharing/users/${alvo.id}`)
      .send({ permission: 'write' })
      .expect(200);

    const msg = await dele.waitForType('sharing_updated');
    assert.equal(msg.action, 'user_updated');
    assert.equal(msg.userId, alvo.id);
    assert.equal(msg.role, 'editor', 'sem o role o par promovido ficaria preso na visão segura');

    // E o par 'read' que NÃO é o afetado continua sem ver nada, no mesmo disparo.
    await afirmaSilencio([["o membro 'read' que não é o afetado", pares.read]]);
  });

  it('o próprio revogado, ainda conectado, recebe o user_removed que o nomeia', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);
    await createShare(db, atlas.id, alvo.id, 'write', owner.id);
    const dele = await conectar(atlas.id, alvoTok);

    await asOwner('delete', `/api/v1/atlas/${atlas.id}/sharing/users/${alvo.id}`).expect(204);

    const msg = await dele.waitForType('sharing_updated');
    assert.equal(msg.action, 'user_removed');
    assert.equal(msg.userId, alvo.id, 'ele está na sala no momento do broadcast');
  });

  // ==========================================================================
  // Os dois frames SEM identidade seguem abertos (não super-corrigir)
  // ==========================================================================

  it('public_enabled e public_disabled continuam indo para a sala inteira — não carregam identidade', async () => {
    const { atlas, pares } = await cenario();

    await asOwner('post', `/api/v1/atlas/${atlas.id}/sharing/public`).expect(200);
    for (const nivel of ABAIXO_DE_MANAGE) {
      const ligado = await pares[nivel].waitForType('sharing_updated');
      assert.equal(ligado.action, 'public_enabled', `o membro '${nivel}' precisa saber da publicação`);
      assert.equal(ligado.userId, undefined, 'o frame não nomeia ninguém');
    }

    for (const nivel of ABAIXO_DE_MANAGE) pares[nivel].clearMessages();
    await asOwner('delete', `/api/v1/atlas/${atlas.id}/sharing/public`).expect(204);
    for (const nivel of ABAIXO_DE_MANAGE) {
      const desligado = await pares[nivel].waitForType('sharing_updated');
      assert.equal(desligado.action, 'public_disabled');
    }
  });

  // ==========================================================================
  // Ordem escrita→broadcast
  // ==========================================================================

  it('I16 — 404 numa remoção sem share NÃO emite broadcast (a escrita vem antes)', async () => {
    // A testemunha aqui é o co-Gestor, e não mais o membro 'read': com a entrega dirigida,
    // um 'read' silencioso não prova nada — ele ficaria calado mesmo com o broadcast
    // fantasma sendo emitido. Verde vazio é o que este arquivo inteiro estava produzindo.
    const { atlas, pares } = await cenario();
    const semShare = await createUser(db, { username: U() });

    await asOwner('delete', `/api/v1/atlas/${atlas.id}/sharing/users/${semShare.id}`).expect(404);

    await afirmaSilencio([['o co-Gestor', pares.manage]]);
  });
});
