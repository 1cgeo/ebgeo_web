// Path: tests/unit/presenca-fluxo-por-destinatario.test.js
//
// PRESENCE FLOW CONTROL PER RECIPIENT (`collab.fluxo.js`), and the invariant that justifies it: a
// sync operation is NEVER retained, coalesced or dropped, whatever the presence around it does.
//
// The recipient is a fake socket with a protocol `ping` that records its tag and NEVER answers on
// its own: the test decides when the browser "received" everything, by calling `aoPong` with the
// tag, which is exactly what the slow link does in time. Measured cause in the file header of
// `collab.fluxo.js`: behind a real slow link the socket buffer stays at zero, so only the pong of a
// ping sent after the frame tells when the frame arrived.

import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import {
  joinRoom, leaveRoom, broadcastToRoom, broadcastOperations, descartarCursorPendente,
} from '../../src/modules/collab/collab.rooms.js';
import {
  aoPong, proximaMarca, FATOR_DE_PAUSA, PAUSA_MAX_MS, MARCADOR_EXPIRA_MS,
} from '../../src/modules/collab/collab.fluxo.js';

/** A recipient whose pings are recorded and only answered by the test. */
function destinatario(clientId = `c_${randomUUID().slice(0, 8)}`) {
  const c = {
    readyState: 1,
    bufferedAmount: 0,
    permission: 'write',
    clientId,
    userId: `u_${clientId}`,
    fio: [], // everything written to the socket, in order: frames as parsed objects, pings as {ping}
    send(payload) { c.fio.push(JSON.parse(payload)); },
    ping(tag) { c.fio.push({ ping: String(tag) }); },
    terminate() { c.terminado = true; },
  };
  return c;
}

/** Answers the LAST ping written to the socket, like the browser once everything before it arrived. */
function responder(c) {
  const ultimo = [...c.fio].reverse().find((f) => f.ping);
  assert.ok(ultimo, 'there must be a ping to answer');
  aoPong(c, Buffer.from(ultimo.ping));
}

const quadros = (c) => c.fio.filter((f) => !f.ping);
const pings = (c) => c.fio.filter((f) => f.ping);
const lote = (...itens) => ({ type: 'cursors', lote: itens });
const item = (clientId, lng) => ({ clientId, userId: `u_${clientId}`, position: { lng, lat: 0 }, mapId: 'm1', surface: '2d' });
const featureOp = (n) => ({ protocolVersion: 2, id: randomUUID(), entityType: 'feature', operationType: 'update', n });

const salas = [];
function sala(...clientes) {
  const atlasId = `atlas_${randomUUID()}`;
  for (const c of clientes) joinRoom(atlasId, c);
  salas.push([atlasId, clientes]);
  return atlasId;
}

afterEach(() => {
  for (const [atlasId, clientes] of salas.splice(0)) for (const c of clientes) leaveRoom(atlasId, c);
  delete process.env.WS_PRESENCE_FLOW;
  mock.timers.reset();
});

describe('fluxo de presença por destinatário', () => {
  it('o primeiro quadro sai com um ping atrás; os seguintes esperam o pong e saem coalescidos', () => {
    const b = destinatario();
    const atlasId = sala(b);

    broadcastToRoom(atlasId, lote(item('A', 1)));
    assert.equal(quadros(b).length, 1, 'the window is open: the first frame goes out');
    assert.equal(pings(b).length, 1, 'and a marker follows it');

    broadcastToRoom(atlasId, lote(item('A', 2), item('C', 2)));
    broadcastToRoom(atlasId, lote(item('A', 3)));
    broadcastToRoom(atlasId, lote(item('C', 4), item('D', 4)));
    assert.equal(quadros(b).length, 1, 'while the marker is unanswered, presence is retained');

    responder(b);
    const saida = quadros(b);
    assert.equal(saida.length, 2, 'one coalesced flush');
    assert.equal(saida[1].type, 'cursors');
    // The latest per sender, in the order the latest states arrived: A(3), C(4), D(4).
    assert.deepEqual(saida[1].lote.map((i) => [i.clientId, i.position.lng]), [['A', 3], ['C', 4], ['D', 4]]);
    assert.equal(pings(b).length, 2, 'the flush is followed by its own marker');
  });

  it('OP DE SYNC NUNCA É RETIDA: com a janela de presença fechada, ela sai na hora, inteira', () => {
    const b = destinatario();
    const atlasId = sala(b);
    broadcastToRoom(atlasId, lote(item('A', 1)));
    broadcastToRoom(atlasId, lote(item('A', 2))); // retained

    const ops = [featureOp(1), featureOp(2)];
    const r = broadcastOperations(atlasId, ops, { userId: 'uA' });

    assert.equal(r.sent, 1);
    const ultimo = quadros(b).at(-1);
    assert.equal(ultimo.type, 'operations', 'the op frame went out while presence was held');
    assert.deepEqual(ultimo.ops.map((o) => o.id), ops.map((o) => o.id));
    assert.equal(quadros(b).filter((f) => f.type === 'cursors').length, 1, 'the retained cursor did not jump the queue');
  });

  it('OP DE SYNC NUNCA É DESCARTADA NEM COALESCIDA, em 200 intercalações sorteadas', () => {
    // Deterministic LCG, so a red run is reproducible from its seed.
    let semente = 12345;
    const sorteio = () => {
      semente = (semente * 1103515245 + 12345) % 2147483648;
      return semente / 2147483648;
    };
    for (let rodada = 0; rodada < 200; rodada++) {
      const b = destinatario();
      const atlasId = sala(b);
      const enviadas = [];
      for (let passo = 0; passo < 40; passo++) {
        const x = sorteio();
        if (x < 0.5) {
          broadcastToRoom(atlasId, lote(item(['A', 'C', 'D'][passo % 3], passo)));
        } else if (x < 0.65) {
          broadcastToRoom(atlasId, { type: 'selection', clientId: 'A', userId: 'uA', surface: '2d', featureIds: [String(passo)] });
        } else if (x < 0.85) {
          // Two ops per batch, and the SAME entity twice in a row sometimes: coalescing would merge them.
          const lot = [featureOp(passo), featureOp(passo)];
          enviadas.push(...lot.map((o) => o.id));
          broadcastOperations(atlasId, lot, { userId: 'uA' });
        } else if (pings(b).length > 0) {
          responder(b);
        }
      }
      const recebidas = quadros(b).filter((f) => f.type === 'operations').flatMap((f) => f.ops.map((o) => o.id));
      assert.deepEqual(recebidas, enviadas, `round ${rodada}: every op, once, in order`);
      const lotesDeCursor = quadros(b).filter((q) => q.type === 'cursors');
      assert.ok(lotesDeCursor.length > 0, `round ${rodada}: presence reached the recipient`);
      for (const f of lotesDeCursor) {
        const ids = f.lote.map((i) => i.clientId);
        assert.equal(new Set(ids).size, ids.length, `round ${rodada}: a flush carries one cursor per sender`);
      }
    }
  });

  it('o quadro de controle (user_left) também nunca espera a janela', () => {
    const b = destinatario();
    const atlasId = sala(b);
    broadcastToRoom(atlasId, lote(item('A', 1)));
    broadcastToRoom(atlasId, lote(item('A', 2))); // retained
    broadcastToRoom(atlasId, { type: 'user_joined', userId: 'uE' });
    assert.equal(quadros(b).at(-1).type, 'user_joined');
  });

  it('quem sai da sala não volta ao roster pelo quadro retido depois do user_left', () => {
    const b = destinatario();
    const atlasId = sala(b);
    broadcastToRoom(atlasId, lote(item('A', 1)));
    broadcastToRoom(atlasId, lote(item('A', 2), item('C', 2))); // retained for B
    broadcastToRoom(atlasId, { type: 'selection', clientId: 'C', userId: 'u_C', surface: '3d', featureIds: ['x'] });

    descartarCursorPendente(atlasId, 'C');
    responder(b);
    const flush = quadros(b).slice(1);
    assert.deepEqual(flush.map((f) => f.type), ['cursors'], 'no selection of C survived');
    assert.deepEqual(flush[0].lote.map((i) => i.clientId), ['A'], 'no cursor of C survived');
  });

  it('a seleção guarda uma por superfície, e a ordem das últimas', () => {
    const b = destinatario();
    const atlasId = sala(b);
    broadcastToRoom(atlasId, lote(item('A', 1)));
    const sel = (surface, ids) => ({ type: 'selection', clientId: 'A', userId: 'u_A', surface, featureIds: ids });
    broadcastToRoom(atlasId, sel('2d', ['f1']));
    broadcastToRoom(atlasId, sel('3d', ['m1']));
    broadcastToRoom(atlasId, sel('2d', [])); // the 2D clear is the LATEST state

    responder(b);
    const flush = quadros(b).slice(1);
    assert.deepEqual(flush.map((f) => [f.surface, f.featureIds]), [['3d', ['m1']], ['2d', []]]);
  });

  it('o próprio cursor do destinatário, que o lote da sala leva a todos, não é retido para ele', () => {
    const b = destinatario('B');
    const atlasId = sala(b);
    broadcastToRoom(atlasId, lote(item('A', 1)));
    broadcastToRoom(atlasId, lote(item('B', 2), item('A', 2)));
    responder(b);
    assert.deepEqual(quadros(b)[1].lote.map((i) => i.clientId), ['A']);
  });

  it('um colega lento não atrasa os outros: o rápido recebe cada quadro na hora', () => {
    const lento = destinatario();
    const rapido = destinatario();
    const atlasId = sala(lento, rapido);
    for (let n = 1; n <= 5; n++) {
      broadcastToRoom(atlasId, lote(item('A', n)));
      responder(rapido); // the fast one answers every marker at once
    }
    assert.equal(quadros(rapido).length, 5);
    assert.equal(quadros(lento).length, 1, 'the slow one got the first and holds the rest');
  });

  it('depois do pong, a próxima presença espera a pausa proporcional ao atraso acima do melhor RTT', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
    const b = destinatario();
    const atlasId = sala(b);

    broadcastToRoom(atlasId, lote(item('A', 1)));
    mock.timers.tick(100); // best round trip: 100 ms
    responder(b);
    broadcastToRoom(atlasId, lote(item('A', 2)));
    assert.equal(quadros(b).length, 2, 'rtt == rttMin: no pause');

    mock.timers.tick(900); // this round trip: 900 ms, 800 above the best
    responder(b);
    broadcastToRoom(atlasId, lote(item('A', 3)));
    assert.equal(quadros(b).length, 2, 'held during the pause');
    mock.timers.tick(FATOR_DE_PAUSA * 800 - 1);
    assert.equal(quadros(b).length, 2);
    mock.timers.tick(1);
    assert.equal(quadros(b).length, 3, 'released when the pause ends');
    assert.equal(quadros(b)[2].lote[0].position.lng, 3);
  });

  it('a pausa tem teto', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
    const b = destinatario();
    const atlasId = sala(b);
    broadcastToRoom(atlasId, lote(item('A', 1)));
    mock.timers.tick(10);
    responder(b);
    broadcastToRoom(atlasId, lote(item('A', 2)));
    mock.timers.tick(60_000); // a huge frame was ahead of this marker
    responder(b);
    broadcastToRoom(atlasId, lote(item('A', 3)));
    mock.timers.tick(PAUSA_MAX_MS);
    assert.equal(quadros(b).length, 3);
  });

  it('o pong de um ping POSTERIOR (o do heartbeat) também reabre a janela', () => {
    const b = destinatario();
    const atlasId = sala(b);
    broadcastToRoom(atlasId, lote(item('A', 1)));
    broadcastToRoom(atlasId, lote(item('A', 2))); // retained
    const marcaDoHeartbeat = proximaMarca(b); // what heartbeatSweep puts in its ping
    aoPong(b, Buffer.from(marcaDoHeartbeat));
    assert.equal(quadros(b).length, 2);
  });

  it('um pong sem marca nossa, ou de um ping ANTERIOR, não reabre nada', () => {
    const b = destinatario();
    const atlasId = sala(b);
    broadcastToRoom(atlasId, lote(item('A', 1)));
    const primeiro = pings(b)[0].ping;
    responder(b);
    broadcastToRoom(atlasId, lote(item('A', 2)));
    broadcastToRoom(atlasId, lote(item('A', 3))); // retained behind the 2nd marker
    aoPong(b, Buffer.alloc(0));
    aoPong(b, Buffer.from(primeiro));
    aoPong(b, Buffer.from('lixo'));
    assert.equal(quadros(b).length, 2);
  });

  it('o marcador que ninguém responde expira e a presença volta a sair', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
    const b = destinatario();
    const atlasId = sala(b);
    broadcastToRoom(atlasId, lote(item('A', 1)));
    mock.timers.tick(MARCADOR_EXPIRA_MS + 1);
    broadcastToRoom(atlasId, lote(item('A', 2)));
    assert.equal(quadros(b).length, 2);
  });

  it('buffer do socket já entupido: a presença espera, e um marcador sozinho diz quando esvaziou', () => {
    const b = destinatario();
    b.bufferedAmount = 2 * 1024 * 1024;
    const atlasId = sala(b);
    broadcastToRoom(atlasId, lote(item('A', 1)));
    assert.equal(quadros(b).length, 0);
    assert.equal(pings(b).length, 1, 'a bare marker');
    b.bufferedAmount = 0;
    responder(b);
    assert.equal(quadros(b).length, 1);
  });

  it('a válvula WS_PRESENCE_FLOW=0 devolve o caminho antigo', () => {
    process.env.WS_PRESENCE_FLOW = '0';
    const b = destinatario();
    const atlasId = sala(b);
    broadcastToRoom(atlasId, lote(item('A', 1)));
    broadcastToRoom(atlasId, lote(item('A', 2)));
    assert.equal(quadros(b).length, 2);
    assert.equal(pings(b).length, 0);
  });

  it('socket fechado durante a retenção: nada sai no pong', () => {
    const b = destinatario();
    const atlasId = sala(b);
    broadcastToRoom(atlasId, lote(item('A', 1)));
    broadcastToRoom(atlasId, lote(item('A', 2)));
    b.readyState = 3;
    responder(b);
    assert.equal(quadros(b).length, 1);
  });
});
