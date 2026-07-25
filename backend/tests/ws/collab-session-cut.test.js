// Path: tests/ws/collab-session-cut.test.js
// Achado 35, lado WebSocket: o corte de sessão (`users.sessions_valid_from`) barra a
// ABERTURA de socket novo com token cortado.
//
// Por que este arquivo existe. O gate de corte nasceu no HTTP (`auth` estrito e a
// renovação deslizante). Deixar o handshake de fora daria ao token morto exatamente a
// porta que sobrou — que é o argumento que o próprio collab.gateway.js já registra
// para o gate P1/O1: "um gate que vive num só dos dois pontos de entrada não é um
// gate". Os dois controles positivos aqui não são decoração: sem eles um verde
// significaria só "o handshake rejeitou alguma coisa", que é verdade para qualquer
// bug de conexão.
//
// ESCOPO, afirmado como teste e não só como comentário: um socket JÁ ABERTO NÃO cai
// por causa do corte. O sweep (`reconcileAuthorization`) reconcilia AUTORIZAÇÃO
// (share, publicação, org, conta), não sessão, e o ciclo de vida do socket é
// client-driven por contrato (backend/CLAUDE.md). O último teste prende isso, para
// que quem mudar de ideia mude o teste junto e não por acidente.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import WebSocket from 'ws';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

const U = () => `cut_${randomUUID().slice(0, 8)}`;

/** Abre um socket cru e resolve o desfecho; nunca rejeita (recusa é caminho esperado). */
function rawConnect(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      resolve({ ws, ...val });
    };
    ws.on('open', () => done({ connected: true }));
    ws.on('error', () => done({ connected: false }));
    ws.on('unexpected-response', (_req, res) => done({ connected: false, statusCode: res.statusCode }));
    ws.on('close', () => done({ connected: false }));
    setTimeout(() => done({ connected: false, timedOut: true }), 4000);
  });
}

describe('WS — corte de sessão no handshake (achado 35)', () => {
  let app, db, server, base;
  let user, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const gw = await import('../../src/modules/collab/collab.gateway.js');
    gw.attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));
    const addr = server.address();
    base = `ws://localhost:${typeof addr === 'object' ? addr.port : addr}`;

    user = await createUser(db, { username: U() });
    atlas = await createAtlas(db, user.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  const cut = (userId, when) => db.query(
    'UPDATE users SET sessions_valid_from = $2 WHERE id = $1', [userId, when]
  );

  it('sem corte (marcador NULL) o dono conecta — controle positivo', async () => {
    const token = await loginUser(app, user.username, user.password);
    const r = await rawConnect(`${base}/api/v1/collab?atlasId=${atlas.id}&token=${token}`);
    assert.equal(r.connected, true, 'sem marcador nada muda');
    r.ws.close();
  });

  it('token anterior ao corte NÃO abre socket', async () => {
    const token = await loginUser(app, user.username, user.password);
    // Corte um minuto NO FUTURO: o token recém-emitido fica, sem ambiguidade, antes.
    await cut(user.id, new Date(Date.now() + 60_000));

    const r = await rawConnect(`${base}/api/v1/collab?atlasId=${atlas.id}&token=${token}`);
    assert.equal(
      r.connected, false,
      'o handshake lê o mesmo getLiveAuthState que o `auth` estrito; deixá-lo de fora '
      + 'daria ao token cortado a única porta que sobrou'
    );
    r.ws.close();
  });

  it('token emitido DEPOIS do corte abre normalmente — controle positivo', async () => {
    // Corte no PASSADO e um login novo depois dele.
    await cut(user.id, new Date(Date.now() - 60_000));
    const token = await loginUser(app, user.username, user.password);

    const r = await rawConnect(`${base}/api/v1/collab?atlasId=${atlas.id}&token=${token}`);
    assert.equal(r.connected, true, 'o corte não pode barrar a sessão nova');
    r.ws.close();
  });

  it('ESCOPO: socket JÁ ABERTO sobrevive ao corte (o sweep reconcilia autorização, não sessão)', async () => {
    await cut(user.id, new Date(Date.now() - 60_000));
    const token = await loginUser(app, user.username, user.password);

    const r = await rawConnect(`${base}/api/v1/collab?atlasId=${atlas.id}&token=${token}`);
    assert.equal(r.connected, true);

    // Corta a sessão com o socket vivo e roda o sweep DIRETO (o heartbeat real leva
    // ~30s; chamar a função é o caminho independente do timer).
    await cut(user.id, new Date(Date.now() + 60_000));
    const gw = await import('../../src/modules/collab/collab.gateway.js');
    const rooms = await import('../../src/modules/collab/collab.rooms.js');
    const sockets = [...rooms.getRoomClients(atlas.id)];
    assert.ok(sockets.length > 0, 'guarda: o sweep precisa ter em quem rodar');
    for (const ws of sockets) await gw.reconcileAuthorization(ws);

    assert.equal(
      r.ws.readyState, WebSocket.OPEN,
      'limite declarado: o corte barra ABERTURA, não derruba socket vivo — se isto '
      + 'mudar, mude também backend/CLAUDE.md e docs/wiki/refresh-token-rotacao.md'
    );
    r.ws.close();
  });
});
