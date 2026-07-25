// Path: tests/unit/collab-backpressure.test.js
// Item 22 — backpressure de broadcastToRoom / broadcastOperations.
//
// O invariante é de INTEGRIDADE DE DADO, não de performance: um frame coalescável
// (cursor/temporal/selection) pode ser descartado para um cliente entupido porque o
// próximo o supersede, mas uma op DURÁVEL nunca pode ser descartada em silêncio (o
// par divergiria para sempre) — acima do teto duro o socket é TERMINADO para que
// reconecte e replaye via sync_request. Inverter os dois ramos, ou aplicar o drop
// coalescável a `operations`, hoje não quebra nada em lugar nenhum.
//
// Puro: joinRoom/leaveRoom são exportados, então basta um cliente falso. Cada caso
// usa um atlasId único e faz leaveRoom no fim para não vazar estado de módulo.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { joinRoom, leaveRoom, broadcastToRoom, broadcastOperations } from '../../src/modules/collab/collab.rooms.js';

const MiB = 1024 * 1024;
const DROP = 1 * MiB; // BACKPRESSURE_DROP_BYTES
const KILL = 8 * MiB; // BACKPRESSURE_KILL_BYTES

/** Cliente falso com a superfície que o fan-out toca. */
function fakeClient({ bufferedAmount = 0, permission = 'write' } = {}) {
  const c = {
    readyState: 1,
    bufferedAmount,
    permission,
    clientId: `c_${randomUUID().slice(0, 8)}`,
    sent: [],
    terminated: 0,
    send(payload) { c.sent.push(payload); },
    terminate() { c.terminated++; },
  };
  return c;
}

/** Executa `fn` numa sala isolada e sempre limpa. */
function inRoom(clients, fn) {
  const atlasId = `atlas_${randomUUID()}`;
  for (const c of clients) joinRoom(atlasId, c);
  try {
    return fn(atlasId);
  } finally {
    for (const c of clients) leaveRoom(atlasId, c);
  }
}

const featureOp = () => ({ id: randomUUID(), entityType: 'feature', operationType: 'create' });

describe('collab backpressure — frame coalescável vs op durável', () => {
  it('cliente com 2 MiB entupidos NÃO recebe um `cursor` (drop coalescável) e não é morto', () => {
    const c = fakeClient({ bufferedAmount: 2 * MiB });
    const r = inRoom([c], (atlasId) =>
      broadcastToRoom(atlasId, { type: 'cursor', position: [0, 0] })
    );

    assert.equal(c.sent.length, 0, 'frame coalescável deve ser descartado');
    assert.equal(c.terminated, 0, '2 MiB está abaixo do teto duro: não se mata o socket');
    assert.equal(r.sent, 0);
    assert.deepEqual(r.recipients, []);
  });

  it('o MESMO cliente (2 MiB) RECEBE uma op durável: op nunca é descartada', () => {
    const c = fakeClient({ bufferedAmount: 2 * MiB });
    const r = inRoom([c], (atlasId) =>
      broadcastOperations(atlasId, [featureOp()], { userId: 'u1' })
    );

    assert.equal(c.sent.length, 1, 'op durável tem de ser enviada mesmo com o buffer alto');
    assert.equal(c.terminated, 0);
    assert.deepEqual(r.recipients, [c.clientId]);
  });

  it('fronteira exata: bufferedAmount === 1 MiB ainda RECEBE o `cursor` (comparação é > estrita)', () => {
    const c = fakeClient({ bufferedAmount: DROP });
    const r = inRoom([c], (atlasId) => broadcastToRoom(atlasId, { type: 'cursor' }));

    assert.equal(c.sent.length, 1, 'exatamente no limiar ainda passa');
    assert.equal(r.sent, 1);
  });

  it('um byte acima do limiar já descarta o `cursor`', () => {
    const c = fakeClient({ bufferedAmount: DROP + 1 });
    const r = inRoom([c], (atlasId) => broadcastToRoom(atlasId, { type: 'cursor' }));

    assert.equal(c.sent.length, 0);
    assert.equal(r.sent, 0);
  });

  it('frame NÃO coalescável (ex. user_left) atravessa o limiar de drop', () => {
    const c = fakeClient({ bufferedAmount: 2 * MiB });
    const r = inRoom([c], (atlasId) => broadcastToRoom(atlasId, { type: 'user_left', userId: 'u1' }));

    assert.equal(c.sent.length, 1, 'só cursor/temporal/selection são descartáveis');
    assert.equal(r.sent, 1);
  });

  it('9 MiB em broadcastToRoom: terminate(), nada enviado, não conta como destinatário', () => {
    const c = fakeClient({ bufferedAmount: 9 * MiB });
    const r = inRoom([c], (atlasId) => broadcastToRoom(atlasId, { type: 'cursor' }));

    assert.equal(c.terminated, 1, 'acima do teto duro o socket é terminado');
    assert.equal(c.sent.length, 0);
    assert.equal(r.sent, 0);
  });

  it('9 MiB em broadcastOperations: terminate() e skippedClosed === 1 (não skippedReadOnly)', () => {
    const c = fakeClient({ bufferedAmount: 9 * MiB });
    const r = inRoom([c], (atlasId) =>
      broadcastOperations(atlasId, [featureOp()], { userId: 'u1' })
    );

    assert.equal(c.terminated, 1, 'op durável para socket afogado: matar, nunca descartar em silêncio');
    assert.equal(c.sent.length, 0);
    assert.equal(r.sent, 0);
    assert.equal(r.skippedClosed, 1);
    assert.equal(r.skippedReadOnly, 0, 'o motivo do skip é o afogamento, não a permissão');
  });

  it('fronteira do teto duro: bufferedAmount === 8 MiB NÃO é terminado', () => {
    const c = fakeClient({ bufferedAmount: KILL });
    const r = inRoom([c], (atlasId) =>
      broadcastOperations(atlasId, [featureOp()], { userId: 'u1' })
    );

    assert.equal(c.terminated, 0, 'exatamente no teto ainda sobrevive (comparação > estrita)');
    assert.equal(c.sent.length, 1);
    assert.equal(r.sent, 1);
  });

  it('um cliente lento não cala a sala: o sadio recebe o cursor e sent === 1', () => {
    const sadio = fakeClient({ bufferedAmount: 0 });
    const afogado = fakeClient({ bufferedAmount: 9 * MiB });
    const r = inRoom([sadio, afogado], (atlasId) => broadcastToRoom(atlasId, { type: 'cursor' }));

    assert.equal(sadio.sent.length, 1);
    assert.equal(afogado.sent.length, 0);
    assert.equal(afogado.terminated, 1);
    assert.equal(r.sent, 1);
    assert.deepEqual(r.recipients, [sadio.clientId]);
  });
});
