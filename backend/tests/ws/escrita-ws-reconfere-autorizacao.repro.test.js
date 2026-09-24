// Path: tests/ws/escrita-ws-reconfere-autorizacao.repro.test.js
//
// A ESCRITA PELO SOCKET USAVA A PERMISSAO GUARDADA NO HANDSHAKE.
//
// O REST confere a autorizacao VIVA a cada pedido (`auth` estrito le conta, OM, corte de sessao e
// papel no banco; `requireAtlasPermission` le o share). O socket de colaboracao guarda
// `ws.permission` no handshake e so o reconfere na varredura de heartbeat (~30 s) ou quando o
// compartilhamento muda. Desativar a CONTA, desativar a OM, rebaixar o papel global ou cortar as
// sessoes nao reconcilia os sockets na hora, entao por ate uma varredura inteira o dono de um
// socket aberto continuava ESCREVENDO pelo `operation`/`operations` e LENDO o log pelo
// `sync_request`, com a permissao de antes. O cliente do produto escreve pelo REST e para na hora;
// o buraco e de quem fala direto com o socket.
//
// Os quadros que escrevem ou leem o log (`operation`, `operations`, `sync_request`) passam a
// reconferir a autorizacao antes de agir, pela mesma `reconcileAuthorization` da varredura.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createAtlas, createMap, createShare, loginUser,
} from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket } from '../../src/modules/collab/collab.gateway.js';

const U = () => `wsa_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('quadro que escreve ou le o log reconfere a autorizacao', () => {
  let app, db, server, admin, tokAdmin, dono;
  const clientes = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));
    admin = await createAdminUser(db, { username: U() });
    tokAdmin = await loginUser(app, admin.username, admin.password);
    dono = await createUser(db, { username: U() });
  });

  after(async () => {
    for (const c of clientes) c.close?.();
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  /** Um Editor conectado a um atlas, pronto para escrever pelo socket. */
  const editorConectado = async () => {
    const editor = await createUser(db, { username: U() });
    const token = await loginUser(app, editor.username, editor.password);
    const atlas = await createAtlas(db, dono.id);
    const mapa = await createMap(db, atlas.id);
    await createShare(db, atlas.id, editor.id, 'write', dono.id);
    const cliente = await createWsClient(server, atlas.id, token, `cli-${editor.id.slice(0, 6)}`);
    clientes.push(cliente);
    await cliente.waitForType('connected');
    const fechado = new Promise((resolve) => cliente.ws.on('close', (code) => resolve(code)));
    return { editor, atlas, mapa, cliente, fechado };
  };

  const opDeFeicao = (mapId) => {
    const id = randomUUID();
    return {
      id: randomUUID(), protocolVersion: 2, entityType: 'feature', operationType: 'create',
      entityId: id, mapId, timestamp: Date.now(), clientId: 'cli-ws',
      data: { id, feature_type: 'point', geometry: { type: 'Point', coordinates: [-45, -20] },
        properties: { nome: 'pelo socket' } },
    };
  };

  const existe = async (featureId) => (await db.query('SELECT 1 FROM features WHERE id = $1', [featureId])).rows.length > 0;

  it('CONTROLE: o Editor vivo escreve pelo socket', async () => {
    const { mapa, cliente } = await editorConectado();
    const op = opDeFeicao(mapa.id);
    cliente.send({ type: 'operation', op });
    const ack = await cliente.waitForType('ack');
    assert.equal(ack.result.status, 'applied');
    assert.equal(await existe(op.entityId), true);
  });

  it('conta DESATIVADA com o socket aberto: a op nao e aplicada e o socket cai', async () => {
    const { editor, mapa, cliente, fechado } = await editorConectado();
    await supertest(app)
      .delete(`/api/v1/users/${editor.id}`)
      .set('Authorization', `Bearer ${tokAdmin}`)
      .expect(200);

    const op = opDeFeicao(mapa.id);
    cliente.send({ type: 'operation', op });
    const codigo = await Promise.race([fechado, sleep(2000).then(() => 'aberto')]);
    assert.equal(codigo, 4003, 'o socket da conta desativada e fechado ao tentar escrever');
    assert.equal(await existe(op.entityId), false, 'a op da conta desativada nao e aplicada');
    assert.equal(cliente.messages.some((m) => m.type === 'ack'), false);
  });

  it('conta DESATIVADA: o sync_request tambem nao le mais o log', async () => {
    const { editor, cliente, fechado } = await editorConectado();
    await supertest(app)
      .delete(`/api/v1/users/${editor.id}`)
      .set('Authorization', `Bearer ${tokAdmin}`)
      .expect(200);

    cliente.send({ type: 'sync_request', lastVersion: 0 });
    const codigo = await Promise.race([fechado, sleep(2000).then(() => 'aberto')]);
    assert.equal(codigo, 4003);
    assert.equal(cliente.messages.some((m) => m.type === 'sync_response'), false);
  });
});
