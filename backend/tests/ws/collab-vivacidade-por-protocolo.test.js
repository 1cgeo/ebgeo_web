// Path: tests/ws/collab-vivacidade-por-protocolo.test.js
//
// O SOCKET SOBREVIVE SEM MANDAR NADA, PORQUE A PILHA DE REDE RESPONDE POR ELE.
//
// O DEFEITO QUE ESTE ARQUIVO PRENDE, e ele foi MEDIDO no navegador antes de existir. A varredura de
// vivacidade termina todo socket cuja marca esteja baixa, e ate este conserto so o trafego da
// APLICACAO a rearmava. Uma aba em segundo plano nao manda cursor, nao manda operacao: manda so o
// ping do proprio cliente, a cada 25 s.
//
// O Chrome estrangula esse ping. Sonda propria, com um socket WebSocket aberto para nao medir uma
// pagina inerte: a aba oculta mantem o temporizador de 25 s EXATO por cerca de cinco minutos e
// depois entra em estrangulamento agressivo, travado em um disparo por minuto. Seis amostras
// consecutivas de 60.000, 60.002, 60.002, 59.999, 60.011 e 59.993 ms. A conexao aberta NAO isentou
// a pagina, que era justamente a duvida do desenho.
//
// Com ping de 60 s contra varredura de 30 s, o socket morre de forma DETERMINISTICA: a varredura
// baixa a marca e a seguinte, trinta segundos depois, nao encontrou ping nenhum. O usuario troca de
// aba por cinco minutos e volta para uma reconexao, com rotatividade de presenca para a sala
// inteira. Numa sala de duzentas pessoas, isso e barulho para duzentas.
//
// O CONSERTO E O PING DO PROTOCOLO, respondido pela pilha de rede do navegador sem passar pelo
// JavaScript da pagina. Nao existe temporizador para estrangular; a API de WebSocket nem expoe
// ping e pong ao script.
//
// POR QUE ESTE TESTE PROVA O QUE INTERESSA, mesmo rodando em Node e nao no navegador. A biblioteca
// `ws` responde ao ping do protocolo dentro dela mesma, sem entregar nada ao codigo do teste, que e
// exatamente a propriedade em jogo: a resposta nao depende do laco de quem esta do outro lado. O
// cliente daqui nao manda UM frame de aplicacao sequer, e e isso que reproduz a aba estrangulada.
//
// O QUE ELE NAO PROVA. Que o Chrome responde ao ping do protocolo quando estrangulado. Isso e
// comportamento de navegador e foi verificado a parte, com a sonda descrita acima; um teste em Node
// que afirmasse isso estaria afirmando sobre a `ws`, nao sobre o Chrome.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

describe('vivacidade pelo protocolo: o socket calado sobrevive', () => {
  let app;
  let db;
  let server;
  let wss;
  let heartbeatSweep;
  let dono;
  let membro;
  let token;
  let atlas;
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

    dono = await createUser(db, { username: `vp_dono_${randomUUID().slice(0, 6)}` });
    membro = await createUser(db, { username: `vp_membro_${randomUUID().slice(0, 6)}` });
    token = await loginUser(app, membro.username, membro.password);

    atlas = await createAtlas(db, dono.id, { name: 'Atlas da vivacidade por protocolo' });
    await createMap(db, atlas.id);
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

  it('um cliente que NAO manda frame nenhum atravessa duas varreduras', async () => {
    const cliente = await createWsClient(server, atlas.id, token, randomUUID());
    abertos.push(cliente);

    // Primeira varredura: baixa a marca e manda o ping do protocolo. A `ws` do outro lado responde
    // sozinha, sem que este teste escreva uma linha.
    await heartbeatSweep(wss);
    await espera(200);

    // Segunda varredura. Sem o ouvinte de pong, a marca continuaria baixa e o socket morreria aqui:
    // e este o caso que reprova o codigo antigo.
    await heartbeatSweep(wss);
    await espera(200);

    assert.equal(
      cliente.ws.readyState, 1,
      'socket calado, mas com transporte vivo, nao pode ser ceifado'
    );
  });

  it('atravessa CINCO varreduras seguidas, que e a vida de uma aba esquecida', async () => {
    const cliente = await createWsClient(server, atlas.id, token, randomUUID());
    abertos.push(cliente);

    // Uma varredura sobrevivida pode ser sorte de ordenacao. Cinco em serie mostram que a marca
    // esta sendo REARMADA a cada ciclo, e nao que uma delas passou batido.
    for (let i = 0; i < 5; i += 1) {
      await heartbeatSweep(wss);
      await espera(150);
      assert.equal(cliente.ws.readyState, 1, `morreu na varredura ${i + 1}`);
    }
  });

  it('o socket cujo transporte NAO responde continua sendo ceifado', async () => {
    const cliente = await createWsClient(server, atlas.id, token, randomUUID());
    abertos.push(cliente);

    // ESTE CASO E O QUE IMPEDE O CONSERTO DE VIRAR "DESLIGAR A VARREDURA". Simula o cliente que
    // sumiu de verdade (cabo arrancado, processo morto): o socket do lado do servidor existe, mas
    // ninguem responde ao ping. Sem este caso, rearmar a marca incondicionalmente passaria nos dois
    // testes acima e o zumbi ficaria para sempre.
    const doServidor = [...wss.clients].find((c) => c.userId === membro.id);
    assert.ok(doServidor, 'preciso do socket do lado do servidor para simular o mudo');
    doServidor.ping = () => {}; // o ping sai e nada volta

    await heartbeatSweep(wss);
    await espera(150);
    await heartbeatSweep(wss);
    await espera(300);

    assert.notEqual(
      cliente.ws.readyState, 1,
      'transporte mudo entre duas varreduras tem de ser terminado'
    );
  });
});
