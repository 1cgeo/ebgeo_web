// Path: tests/ws/collab-expiracao-de-token-nao-derruba.test.js
//
// A14 / decisao D11 de 14/09/2026: o socket de colaboracao JA ABERTO nao cai quando o JWT que o
// abriu expira. A varredura de heartbeat reconcilia AUTORIZACAO (conta, OM, papel global,
// compartilhamento, publicacao do atlas) e nunca SESSAO. A decisao e declarar, nao mudar; este
// arquivo e o que torna a declaracao verificavel.
//
// POR QUE ELA PRECISA DE GUARDA SE NADA MUDOU. Porque a propriedade e invisivel no codigo: ela e
// a AUSENCIA de uma checagem de `exp` dentro de `reconcileAuthorization`
// (`src/modules/collab/collab.gateway.js`), e uma ausencia nao se le. O irmao
// `collab-logout-keeps-socket.test.js` existe pela mesma razao e cobre o LOGOUT, que e outro
// evento de sessao: quem "consertasse" a expiracao acrescentando `jwt.verify` na varredura nao
// deixaria nada vermelho, e o campo perderia a sala no meio de uma edicao, sem aviso, a cada
// quinze minutos.
//
// OS DOIS LADOS, e e a assimetria que o arquivo prende:
//
//   - no HANDSHAKE o token expirado e 401, porque ali ele E a credencial: `jwt.verify` roda no
//     upgrade e nao ha socket para preservar;
//   - no socket JA ABERTO ele nao e consultado de novo, porque a expiracao do token nao muda o
//     que a pessoa pode fazer. O que muda isso e a autorizacao, e essa a varredura impoe: o
//     mesmo socket cai com `4003` quando o compartilhamento e revogado.
//
// O MESMO TOKEN atravessa os dois lados de proposito. Fosse um token expirado forjado a parte, o
// caso de 401 e o de sobrevivencia estariam falando de credenciais diferentes, e a assimetria (o
// PONTO) nao ficaria provada.
//
// A afirmacao de sobrevivencia e de PERTENCIMENTO A SALA, nao de conectividade: um push do par
// precisa chegar no socket cujo token ja venceu. Sem isso, remover o cliente da sala sem fechar o
// socket passaria verde.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createShare, createMap, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { getRoomClients, getRoomSize } from '../../src/modules/collab/collab.rooms.js';
import { reconcileAuthorization } from '../../src/modules/collab/collab.gateway.js';
import config from '../../src/config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SFX = randomUUID().slice(0, 8);

// Vida do token de teste. Curta o bastante para o caso nao custar, longa o bastante para o
// handshake e a primeira asserção caberem dentro dela sem depender de velocidade de maquina.
const VIDA_MS = 2000;

describe('D11 — a expiracao do JWT nao derruba socket aberto; a revogacao derruba', () => {
  let app, db, server;
  let owner, writer, atlas, map;
  let openClients;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const gateway = await import('../../src/modules/collab/collab.gateway.js');
    gateway.attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: `exp_own_${SFX}` });
    writer = await createUser(db, { username: `exp_wri_${SFX}` });
    atlas = await createAtlas(db, owner.id, { name: `Atlas expiracao ${SFX}` });
    await createShare(db, atlas.id, writer.id, 'write', owner.id);
    map = await createMap(db, atlas.id, { name: `Mapa expiracao ${SFX}` });
  });

  beforeEach(() => { openClients = []; });

  afterEach(() => {
    for (const c of openClients) {
      try { if (c.ws && c.ws.readyState <= 1) c.ws.terminate(); } catch { /* ja foi */ }
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

  /**
   * Um access token de vida curta, assinado com o segredo e o algoritmo DO SERVIDOR. As claims
   * sao as que o upgrade le; o papel e a org vivos vem do banco de qualquer forma
   * (`getLiveAuthState`), entao o que este token carrega e so a identidade.
   */
  function tokenCurto(user) {
    return jwt.sign(
      { sub: user.id, username: user.username, role: 'user' },
      config.jwt.secret,
      { algorithm: 'HS256', expiresIn: `${Math.round(VIDA_MS / 1000)}s` },
    );
  }

  /** O objeto `ws` DO SERVIDOR daquele cliente. `getRoomClients` devolve um Set, nao um array. */
  function socketDaSala(clientId) {
    return [...getRoomClients(atlas.id)].find((c) => c.clientId === clientId);
  }

  async function connect(token, clientId) {
    const c = await createWsClient(server, atlas.id, token, clientId);
    openClients.push(c);
    await c.waitForType('connected');
    return c;
  }

  it('o token expirado e 401 no HANDSHAKE, e o socket que ele abriu ANTES continua na sala', async () => {
    const token = tokenCurto(writer);
    const ws = await connect(token, `exp-a-${SFX}`);

    let closed = null;
    ws.ws.on('close', (code, reason) => { closed = { code, reason: reason.toString() }; });

    // Espera o token VENCER. O `+ 600` cobre o arredondamento do `expiresIn` em segundos.
    await sleep(VIDA_MS + 600);

    // LADO 1: no handshake ele e a credencial, e nao vale mais. Este caso e tambem o controle
    // negativo de tudo o que vem depois: sem ele, "o socket sobreviveu" poderia estar medindo um
    // token que simplesmente ainda nao venceu.
    await assert.rejects(
      () => createWsClient(server, atlas.id, token, `exp-a2-${SFX}`),
      /Unexpected server response: 401/,
      'o MESMO token precisa ser recusado com 401 numa conexao nova',
    );

    // LADO 2: o socket ja aberto nao e reexaminado.
    assert.equal(ws.ws.readyState, 1, 'o socket precisa continuar OPEN depois de o token vencer');
    assert.equal(closed, null, `chegou um frame de close: ${JSON.stringify(closed)}`);
  });

  it('e ele ainda PERTENCE a sala: um push do dono chega no socket de token vencido', async () => {
    // A asserção que separa "TCP vivo" de "membro da sala".
    const token = tokenCurto(writer);
    const ws = await connect(token, `exp-b-${SFX}`);
    await sleep(VIDA_MS + 600);
    ws.clearMessages();

    const ownerToken = await loginUser(app, owner.username, owner.password);
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        operations: [{
          protocolVersion: 2,
          id: randomUUID(),
          entityType: 'feature',
          operationType: 'create',
          entityId: randomUUID(),
          mapId: map.id,
          data: {
            feature_type: 'point',
            geometry: { coordinates: [-43.5, -23.0] },
            properties: { name: `pos-expiracao ${SFX}` },
          },
          timestamp: Date.now(),
          clientId: `exp-owner-${SFX}`,
        }],
      });
    assert.equal(res.status, 200, 'o push do dono precisa passar, senao o caso e vazio');

    const ops = await ws.waitForType('operations', 3000);
    assert.equal(ops.userId, owner.id);
    assert.equal(ops.ops.length, 1);
  });

  it('a varredura passa no socket de token vencido SEM o derrubar, e so reconcilia autorizacao', async () => {
    // A varredura roda a cada `WS_HEARTBEAT_INTERVAL_MS` (30 s), lenta demais para o teste
    // esperar, entao ela e dirigida direto sobre o socket REAL da sala — o mesmo objeto que o
    // sweep tocaria. Dirigi-la sobre um duplo provaria menos: o ponto e que aquele socket, com
    // aquele token vencido, atravessa a reconciliacao inteira.
    const token = tokenCurto(writer);
    const ws = await connect(token, `exp-c-${SFX}`);
    await sleep(VIDA_MS + 600);

    const real = socketDaSala(`exp-c-${SFX}`);
    assert.ok(real, 'guarda: o socket precisa estar na sala para a varredura o alcancar');

    await reconcileAuthorization(real);

    assert.equal(ws.ws.readyState, 1, 'a varredura nao pode fechar por causa do token vencido');
    assert.equal(real.permission, 'write', 'e a permissao reconciliada continua sendo a do share');
  });

  it('CONTRASTE: revogado o compartilhamento, o MESMO socket cai com 4003', async () => {
    // O outro lado do contrato, e o que impede este arquivo de ser lido como "o servidor nunca
    // derruba ninguem". O que derruba e a AUTORIZACAO, nao a sessao.
    const token = tokenCurto(writer);
    const ws = await connect(token, `exp-d-${SFX}`);
    const fechamento = new Promise((resolve) => {
      ws.ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });

    await sleep(VIDA_MS + 600);
    const antes = getRoomSize(atlas.id);
    assert.ok(antes >= 1, 'guarda: o socket precisa estar na sala antes da revogacao');

    await db.query('DELETE FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
      [atlas.id, writer.id]);

    const real = socketDaSala(`exp-d-${SFX}`);
    assert.ok(real, 'guarda: o socket precisa estar na sala para a varredura o alcancar');
    await reconcileAuthorization(real);

    const closed = await Promise.race([fechamento, sleep(3000).then(() => null)]);
    assert.ok(closed, 'a revogacao precisa fechar o socket');
    assert.equal(closed.code, 4003, `o codigo de acesso revogado e 4003, veio ${closed?.code}`);

    // Devolve o share, para que a ordem dos casos deste arquivo deixe de importar.
    await createShare(db, atlas.id, writer.id, 'write', owner.id);
  });
});
