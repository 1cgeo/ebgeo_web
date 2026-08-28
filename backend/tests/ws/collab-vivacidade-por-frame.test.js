// Path: tests/ws/collab-vivacidade-por-frame.test.js
//
// QUALQUER FRAME PROVA VIDA, NAO SO O `ping`.
//
// O DEFEITO QUE ESTE ARQUIVO PRENDE, e ele foi medido antes de existir. `heartbeatSweep` termina
// todo socket cujo `isAlive` esteja falso, e ate este conserto SO `handlePing` rearmava a marca.
// Um cliente mandando doze quadros de cursor por segundo era, para a varredura, indistinguivel de
// um cliente morto: bastava o servidor demorar para processar o `ping` dele.
//
// E e exatamente o que a bancada de populacao mediu. Com mil usuarios em cadencia de trabalho:
// 156 sockets derrubados na rampa e 16 na janela, TODOS com codigo 1006, que e o `terminate()`
// desta varredura. Nenhum 4003, ou seja, a hipotese de fome de pool derrubando por falha de
// autorizacao estava errada. E o laco do driver estava sadio (p99 de 19 ms), entao os pings SAIRAM
// no horario: quem nao os processou a tempo foi o servidor, ocupado com o fan-out de presenca.
//
// O QUE ESTE TESTE PROVA. Que um frame de aplicacao qualquer (cursor, aqui) mantem o socket vivo
// atraves de uma varredura, e que o socket que nao manda NADA continua sendo ceifado. O segundo
// caso e tao importante quanto o primeiro: sem ele, o conserto poderia ter desligado a varredura
// inteira e o teste ainda passaria.
//
// A VARREDURA E DISPARADA A MAO, e nao por espera de trinta segundos. `heartbeatSweep` e exportado
// exatamente para isso. Esperar o intervalo real tornaria o teste lento E dependente de relogio,
// que e a receita de um caso que passa por sorte.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

describe('vivacidade do socket: qualquer frame rearma, o silencio nao', () => {
  let app;
  let db;
  let server;
  let wss;
  let heartbeatSweep;
  let dono;
  let membro;
  let token;
  let atlas;
  let mapa;
  let abertos;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const gateway = await import('../../src/modules/collab/collab.gateway.js');
    wss = gateway.attachWebSocket(server);
    heartbeatSweep = gateway.heartbeatSweep;
    await new Promise((resolve) => server.listen(0, () => resolve()));

    dono = await createUser(db, { username: `viv_dono_${randomUUID().slice(0, 6)}` });
    membro = await createUser(db, { username: `viv_membro_${randomUUID().slice(0, 6)}` });
    token = await loginUser(app, membro.username, membro.password);

    atlas = await createAtlas(db, dono.id, { name: 'Atlas da vivacidade' });
    mapa = await createMap(db, atlas.id);
    await createShare(db, atlas.id, membro.id, 'write', dono.id);
  });

  beforeEach(() => { abertos = []; });

  afterEach(() => {
    for (const c of abertos) {
      try {
        if (c.ws && c.ws.readyState <= 1) c.ws.terminate();
      } catch { /* ja foi */ }
    }
    abertos = [];
  });

  after(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    await teardownTestEnv(db);
  });

  it('um frame de cursor mantem o socket vivo atraves de uma varredura', async () => {
    const cliente = await createWsClient(server, atlas.id, token, randomUUID());
    abertos.push(cliente);

    // Primeira varredura: ela SEMPRE deixa passar quem acabou de conectar (o socket nasce vivo) e
    // baixa a marca. E a partir daqui que o cliente precisa provar que existe.
    await heartbeatSweep(wss);

    cliente.send({
      type: 'cursor',
      position: { lng: -43.2, lat: -22.9 },
      mapId: mapa.id,
    });
    await espera(150);

    // Segunda varredura: sem o conserto, este socket morreria aqui, porque nenhum `ping` chegou.
    await heartbeatSweep(wss);
    await espera(150);

    assert.equal(
      cliente.ws.readyState, 1,
      'o socket que mandou cursor entre as duas varreduras nao pode ser ceifado'
    );
  });

  it('o socket que fica em silencio continua sendo ceifado', async () => {
    const cliente = await createWsClient(server, atlas.id, token, randomUUID());
    abertos.push(cliente);

    await heartbeatSweep(wss);
    // Nada e enviado de proposito.
    await espera(150);
    await heartbeatSweep(wss);
    await espera(300);

    // ESTE CASO E O QUE IMPEDE O CONSERTO DE VIRAR "DESLIGAR A VARREDURA". Sem ele, rearmar a marca
    // em lugar nenhum passaria no teste anterior e ninguem notaria que o zumbi ficou para sempre.
    assert.notEqual(
      cliente.ws.readyState, 1,
      'socket mudo entre duas varreduras tem de ser terminado'
    );
  });

  it('o ping continua rearmando, porque e o unico sinal do cliente ocioso', async () => {
    const cliente = await createWsClient(server, atlas.id, token, randomUUID());
    abertos.push(cliente);

    await heartbeatSweep(wss);
    cliente.send({ type: 'ping' });
    await cliente.waitForType('pong');

    await heartbeatSweep(wss);
    await espera(150);

    assert.equal(cliente.ws.readyState, 1, 'o caminho do ping nao pode ter regredido');
  });
});
