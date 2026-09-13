// Path: tests/ws/sync-request-cliente-em-dia.test.js
//
// O ZERO DIZIA DUAS COISAS, e o handshake não tinha como escolher qual. `sync_request
// {lastVersion: 0}` significava tanto "não tenho nada" quanto "estou em dia com um atlas que
// nunca teve operação escrita", e todo atlas está em `current_version = 0` até a primeira op.
// `pullOperations` lia esse zero como "manda tudo", então a abertura de todo atlas novo era
// servida com DOIS retratos completos idênticos: o do pull HTTP e o do handshake logo em
// seguida. Desde `eb24ba9f` o cliente recusa encenar o segundo (o `currentVersion` dele já é o
// cursor da geração ativa), de modo que o custo que sobrava era BANDA: um retrato inteiro
// serializado, enviado e descartado a cada abertura.
//
// O CAMPO É `haveSnapshot`, E ELE SÓ VIAJA QUANDO É VERDADEIRO. Presente, ele afirma estado
// local COMPLETO na versão pedida, e daí o zero vira uma versão como outra qualquer. Ausente,
// nada muda: é o que um cliente antigo manda e é o que um cliente que não pode provar
// completude tem de mandar. Por isso não existe `haveSnapshot: false` no fio.
//
// O QUE CONTINUA SENDO RETRATO, e é o que os controles daqui prendem: pedido abaixo de
// `min_version` (a fronteira do log foi podada, e nenhuma cauda reconstrói o que foi apagado),
// pedido sem o campo, e campo que não é o booleano `true`.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

describe('sync_request: o cliente em dia com um atlas em versão zero', () => {
  let app, db, server, owner, ownerTok;
  let openClients;

  /** Um atlas novo, com um mapa, e ainda sem operação nenhuma no log. */
  async function atlasVirgem() {
    const atlas = await createAtlas(db, owner.id, { name: `Zero ${randomUUID().slice(0, 6)}` });
    const map = await createMap(db, atlas.id);
    const { rows } = await db.query(
      'SELECT current_version, min_version FROM atlas WHERE id = $1', [atlas.id]
    );
    // A PREMISSA DO ARQUIVO INTEIRO, asserida em vez de suposta: as fixtures inserem linhas
    // direto, e o gatilho de versão só dispara no INSERT em `operations`.
    assert.equal(Number(rows[0].current_version), 0, 'o atlas de teste tem de nascer em versão 0');
    assert.equal(Number(rows[0].min_version), 0);
    return { atlasId: atlas.id, mapId: map.id };
  }

  /** Abre um cliente e devolve-o já handshakeado, com o buffer limpo. */
  async function clienteEm(atlasId) {
    const c = await createWsClient(server, atlasId, ownerTok);
    openClients.push(c);
    await c.waitForType('connected');
    c.clearMessages();
    return c;
  }

  /** Escreve UMA op de feição e devolve a versão do servidor depois dela. */
  async function escreverUmaOp(c, mapId) {
    c.send({
      type: 'operation',
      op: {
        protocolVersion: 2,
        id: randomUUID(),
        entityType: 'feature',
        operationType: 'create',
        entityId: randomUUID(),
        mapId,
        data: { feature_type: 'point', geometry: { coordinates: [-43.2, -22.9] }, properties: {} },
        timestamp: Date.now(),
        clientId: 'cliente-em-dia',
      },
    });
    const ack = await c.waitForType('ack');
    assert.ok(ack.serverVersion >= 1, 'a op tem de avançar a versão do atlas');
    c.clearMessages();
    return ack.serverVersion;
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: `zero_owner_${randomUUID().slice(0, 6)}` });
    ownerTok = await loginUser(app, owner.username, owner.password);
  });

  beforeEach(() => {
    openClients = [];
  });

  // Cada caso abre o seu cliente; um socket esquecido de pé bloqueia o `server.close()`.
  afterEach(() => {
    for (const c of openClients) {
      c.ws.terminate();
    }
    openClients = [];
  });

  after(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    await teardownTestEnv(db);
  });

  it('com o campo, versão zero recebe CAUDA VAZIA em vez de um retrato inteiro', async () => {
    const { atlasId } = await atlasVirgem();
    const c = await clienteEm(atlasId);

    c.send({ type: 'sync_request', lastVersion: 0, haveSnapshot: true });
    const res = await c.waitForType('sync_response');

    assert.equal(res.isSnapshot, false, 'um cliente em dia não pode receber retrato');
    assert.deepEqual(res.ops, [], 'não há op nenhuma depois da versão zero');
    assert.equal(res.snapshot, undefined, 'a resposta de cauda não carrega retrato');
    assert.equal(res.currentVersion, 0);
  });

  it('SEM o campo, o mesmo pedido continua recebendo o retrato completo', async () => {
    // O CONTROLE DE COMPATIBILIDADE: é este caso que garante que o cliente que não conhece o
    // campo (e o que não pode provar completude) continua sendo servido como sempre foi.
    const { atlasId } = await atlasVirgem();
    const c = await clienteEm(atlasId);

    c.send({ type: 'sync_request', lastVersion: 0 });
    const res = await c.waitForType('sync_response');

    assert.equal(res.isSnapshot, true, 'sem o campo, o zero continua sendo "manda tudo"');
    assert.ok(res.snapshot, 'o retrato tem de vir junto');
    assert.equal(res.snapshot.atlas.id, atlasId);
  });

  it('o campo só vale como o booleano `true`: um valor truthy qualquer não afirma nada', async () => {
    const { atlasId } = await atlasVirgem();
    const c = await clienteEm(atlasId);

    c.send({ type: 'sync_request', lastVersion: 0, haveSnapshot: 'sim' });
    const res = await c.waitForType('sync_response');

    assert.equal(res.isSnapshot, true, 'string truthy do fio não é afirmação de completude');
  });

  it('abaixo de `min_version` continua sendo retrato, campo ou não', async () => {
    // A FRONTEIRA INVALIDADA: a poda apagou o trecho do log que essa cauda precisaria, e nenhuma
    // afirmação do cliente reconstrói o que não está mais lá.
    const { atlasId, mapId } = await atlasVirgem();
    const c = await clienteEm(atlasId);
    const versao = await escreverUmaOp(c, mapId);
    await db.query('UPDATE atlas SET min_version = $1 WHERE id = $2', [versao + 1, atlasId]);

    c.send({ type: 'sync_request', lastVersion: versao, haveSnapshot: true });
    const res = await c.waitForType('sync_response');

    assert.equal(res.isSnapshot, true, 'pedido abaixo de min_version é retrato mesmo com o campo');
    assert.ok(res.snapshot, 'o retrato tem de vir junto');
  });

  it('com o campo e uma op escrita, o pedido a partir da versão corrente traz cauda vazia', async () => {
    // O caso que JÁ funcionava antes do campo (versão diferente de zero nunca foi ambígua), aqui
    // para provar que o campo não muda o que estava certo.
    const { atlasId, mapId } = await atlasVirgem();
    const c = await clienteEm(atlasId);
    const versao = await escreverUmaOp(c, mapId);

    c.send({ type: 'sync_request', lastVersion: versao, haveSnapshot: true });
    const res = await c.waitForType('sync_response');

    assert.equal(res.isSnapshot, false);
    assert.deepEqual(res.ops, []);
    assert.equal(res.currentVersion, versao);
  });

  it('com o campo e uma op ESCRITA DEPOIS, a cauda traz exatamente a op que faltava', async () => {
    // A metade que o atalho não pode comer: afirmar completude na versão zero não pode fazer o
    // servidor engolir o que veio depois dela.
    const { atlasId, mapId } = await atlasVirgem();
    const c = await clienteEm(atlasId);
    const entidade = randomUUID();
    c.send({
      type: 'operation',
      op: {
        protocolVersion: 2,
        id: randomUUID(),
        entityType: 'feature',
        operationType: 'create',
        entityId: entidade,
        mapId,
        data: { feature_type: 'point', geometry: { coordinates: [-43.1, -22.8] }, properties: {} },
        timestamp: Date.now(),
        clientId: 'cliente-em-dia',
      },
    });
    await c.waitForType('ack');
    c.clearMessages();

    c.send({ type: 'sync_request', lastVersion: 0, haveSnapshot: true });
    const res = await c.waitForType('sync_response');

    assert.equal(res.isSnapshot, false);
    assert.equal(res.ops.length, 1, 'a cauda tem de trazer a única op escrita');
    assert.equal(res.ops[0].entityId, entidade);
  });
});
