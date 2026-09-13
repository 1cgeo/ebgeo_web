// Path: tests/ws/teto-de-sockets-por-principal.test.js
//
// O TETO DE SOCKETS SIMULTÂNEOS DE UM MESMO PRINCIPAL NUM ATLAS.
//
// O QUE FALTAVA, medido em 2026-09-13 contra o código anterior: quarenta sockets abertos com
// UM token de conta, e vinte com UM token de visitante de link público, todos aceitos, sem
// teto em lugar nenhum. O handshake conferia identidade, vivacidade e permissão, e nada
// contava quantas conexões aquele mesmo principal já mantinha.
//
// POR QUE ISSO IMPORTA NESTE PRODUTO, e a medição já estava no repositório: o comentário de
// `WS_CURSOR_BATCH_MS` (`src/config.js`) registra a bancada de sala cheia — a sala de 400
// pedia 971.086 quadros por segundo e o servidor entregava 46.436, e o limite OPERACIONAL de
// sala é duzentos. A sala é por atlas e sem subcanal, então cada socket a mais multiplica o
// leque de TODO quadro de percepção de TODO mundo. Sem teto por principal, uma pessoa só
// leva a sala além do limite medido, e o caminho mais barato é o ANÔNIMO: um link público
// entrega um token, e um token abria conexões sem conta.
//
// O QUE O TETO NÃO FECHA, dito aqui para ninguém ler mais do que está escrito: ele conta por
// (principal, atlas), e o `sub` de um token de visitante é cunhado NOVO a cada
// `GET /atlas/public/:link`. Quem repetir a chamada ganha outro balde. O que limita ISSO é o
// `publicLinkLimiter`, que é onde esse teto já mora por decisão anterior; este arquivo não o
// duplica.
//
// CONTROLE NEGATIVO: remova a contagem do handshake e o segundo caso fica verde ao contrário
// (a conexão excedente é aceita). CONTROLES POSITIVOS: fechar um socket libera a vaga, e o
// teto de um principal não alcança outro — sem os dois, "verde" poderia significar só que o
// handshake parou de aceitar conexão.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import WebSocket from 'ws';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createShare, loginUser, makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';

const U = () => `teto_${randomUUID().slice(0, 8)}`;

/** Abre um socket cru e resolve o desfecho; nunca rejeita (a recusa é caminho esperado). */
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
    ws.on('unexpected-response', (_req, res) => done({ connected: false, statusCode: res.statusCode }));
    ws.on('error', () => done({ connected: false }));
    ws.on('close', () => done({ connected: false }));
    setTimeout(() => done({ connected: false, timedOut: true }), 4000);
  });
}

/** Espera o servidor registrar o fechamento, senão a vaga ainda parece ocupada. */
function fechar(ws) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once('close', () => setTimeout(resolve, 50));
    ws.close();
    return undefined;
  });
}

describe('WS — teto de sockets por principal', () => {
  let app, db, server, base, gw, tetoAnterior;
  let dono, donoTok, outro, outroTok, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    gw = await import('../../src/modules/collab/collab.gateway.js');
    gw.attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));
    const addr = server.address();
    base = `ws://localhost:${typeof addr === 'object' ? addr.port : addr}`;

    dono = await createUser(db, { username: U() });
    outro = await createUser(db, { username: U() });
    donoTok = await loginUser(app, dono.username, dono.password);
    outroTok = await loginUser(app, outro.username, outro.password);
    atlas = await createAtlas(db, dono.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);
    await createShare(db, atlas.id, outro.id, 'write', dono.id);

    tetoAnterior = gw.setMaxSocketsPerPrincipal(2);
  });

  after(async () => {
    if (gw) gw.setMaxSocketsPerPrincipal(tetoAnterior);
    if (server) await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  const url = (t) => `${base}/api/v1/collab?atlasId=${atlas.id}&token=${t}`
    + `&clientId=${randomUUID().slice(0, 12)}`;

  it('aceita até o teto e RECUSA a conexão seguinte do mesmo principal', async () => {
    const a = await rawConnect(url(donoTok));
    const b = await rawConnect(url(donoTok));
    assert.equal(a.connected, true, 'a primeira conexão tinha de entrar');
    assert.equal(b.connected, true, 'a segunda conexão tinha de entrar');

    const c = await rawConnect(url(donoTok));
    assert.equal(c.connected, false, 'a terceira conexão do mesmo principal tinha de ser recusada');
    assert.equal(c.statusCode, 429, 'a recusa por teto é 429, distinta do 403 de autorização');

    // CONTROLE POSITIVO: fechar uma libera a vaga.
    await fechar(a.ws);
    const d = await rawConnect(url(donoTok));
    assert.equal(d.connected, true, 'a vaga liberada tinha de aceitar uma conexão nova');

    await fechar(b.ws);
    await fechar(d.ws);
  });

  it('o teto é por PRINCIPAL, não por sala: outro usuário entra no mesmo atlas', async () => {
    const a = await rawConnect(url(donoTok));
    const b = await rawConnect(url(donoTok));
    assert.equal(a.connected && b.connected, true, 'o dono tinha de ocupar as duas vagas dele');

    const alheio = await rawConnect(url(outroTok));
    assert.equal(alheio.connected, true, 'o teto de um principal não pode fechar a sala');

    await fechar(a.ws);
    await fechar(b.ws);
    await fechar(alheio.ws);
  });

  it('o visitante de link público também tem teto', async () => {
    const link = await makeAtlasPublic(db, atlas.id);
    const vt = await getPublicToken(app, link);

    const a = await rawConnect(url(vt));
    const b = await rawConnect(url(vt));
    assert.equal(a.connected && b.connected, true, 'as duas primeiras do visitante tinham de entrar');

    const c = await rawConnect(url(vt));
    assert.equal(c.connected, false, 'o terceiro socket do MESMO token tinha de ser recusado');
    assert.equal(c.statusCode, 429);

    await fechar(a.ws);
    await fechar(b.ws);
    await db.query('UPDATE atlas SET is_public = false, public_link = NULL WHERE id = $1', [atlas.id]);
  });
});
