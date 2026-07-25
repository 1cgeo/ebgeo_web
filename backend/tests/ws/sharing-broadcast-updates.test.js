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

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket } from '../../src/modules/collab/collab.gateway.js';

const U = () => `shb_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JANELA_SILENCIO_MS = 500;

describe('broadcast `sharing_updated` — role, ações e ordem escrita→broadcast', () => {
  let app, db, server;
  let owner, ownerTok, observador, observadorTok, alvo, alvoTok;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));

    owner = await createUser(db, { username: U() });
    ownerTok = await loginUser(app, owner.username, owner.password);
    observador = await createUser(db, { username: U() });
    observadorTok = await loginUser(app, observador.username, observador.password);
    alvo = await createUser(db, { username: U() });
    alvoTok = await loginUser(app, alvo.username, alvo.password);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  /** Atlas novo com o observador já dentro da sala (share 'read'). */
  async function cenario() {
    const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);
    await createShare(db, atlas.id, observador.id, 'read', owner.id);
    const par = await createWsClient(server, atlas.id, observadorTok);
    await par.waitForType('connected');
    par.clearMessages();
    return { atlas, par };
  }

  const asOwner = (metodo, url) =>
    supertest(app)[metodo](url).set('Authorization', `Bearer ${ownerTok}`);

  it("POST /sharing/users {permission:'manage'} → action user_added com role 'manager'", async () => {
    const { atlas, par } = await cenario();

    await asOwner('post', `/api/v1/atlas/${atlas.id}/sharing/users`)
      .send({ userId: alvo.id, permission: 'manage' })
      .expect(201);

    const msg = await par.waitForType('sharing_updated');
    assert.equal(msg.action, 'user_added');
    assert.equal(msg.userId, alvo.id);
    assert.equal(msg.permission, 'manage');
    assert.equal(msg.role, 'manager', 'o papel do frontend viaja no frame, não só a permissão');

    par.close();
  });

  it("PUT /sharing/users/:id {permission:'comment'} → user_updated com role 'commenter'", async () => {
    const { atlas, par } = await cenario();
    await createShare(db, atlas.id, alvo.id, 'write', owner.id);

    await asOwner('put', `/api/v1/atlas/${atlas.id}/sharing/users/${alvo.id}`)
      .send({ permission: 'comment' })
      .expect(200);

    const msg = await par.waitForType('sharing_updated');
    assert.equal(msg.action, 'user_updated');
    assert.equal(msg.userId, alvo.id);
    assert.equal(msg.permission, 'comment');
    assert.equal(msg.role, 'commenter');

    par.close();
  });

  it('DELETE /sharing/users/:id → user_removed (nenhum teste cobria a remoção)', async () => {
    const { atlas, par } = await cenario();
    await createShare(db, atlas.id, alvo.id, 'write', owner.id);

    await asOwner('delete', `/api/v1/atlas/${atlas.id}/sharing/users/${alvo.id}`).expect(204);

    const msg = await par.waitForType('sharing_updated');
    assert.equal(msg.action, 'user_removed');
    assert.equal(msg.userId, alvo.id);

    par.close();
  });

  it('POST/DELETE /sharing/public → public_enabled e public_disabled', async () => {
    const { atlas, par } = await cenario();

    await asOwner('post', `/api/v1/atlas/${atlas.id}/sharing/public`).expect(200);
    const ligado = await par.waitForType('sharing_updated');
    assert.equal(ligado.action, 'public_enabled');

    par.clearMessages();
    await asOwner('delete', `/api/v1/atlas/${atlas.id}/sharing/public`).expect(204);
    const desligado = await par.waitForType('sharing_updated');
    assert.equal(desligado.action, 'public_disabled');

    par.close();
  });

  it('o próprio revogado, ainda conectado, recebe o user_removed que o nomeia', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);
    await createShare(db, atlas.id, alvo.id, 'write', owner.id);

    const dele = await createWsClient(server, atlas.id, alvoTok);
    await dele.waitForType('connected');
    dele.clearMessages();

    await asOwner('delete', `/api/v1/atlas/${atlas.id}/sharing/users/${alvo.id}`).expect(204);

    const msg = await dele.waitForType('sharing_updated');
    assert.equal(msg.action, 'user_removed');
    assert.equal(msg.userId, alvo.id, 'ele está na sala no momento do broadcast');

    dele.close();
  });

  it('I16 — 404 numa remoção sem share NÃO emite broadcast (a escrita vem antes)', async () => {
    const { atlas, par } = await cenario();
    const semShare = await createUser(db, { username: U() });

    await asOwner('delete', `/api/v1/atlas/${atlas.id}/sharing/users/${semShare.id}`).expect(404);

    await sleep(JANELA_SILENCIO_MS);
    assert.deepEqual(
      par.getMessagesOfType('sharing_updated'),
      [],
      'invertida a ordem, um 404 emitiria remoção fantasma e os pares derrubariam quem ainda tem acesso'
    );

    par.close();
  });
});
