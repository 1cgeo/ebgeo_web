// Path: tests/unit/quadros-de-op-retidos-no-sync-request.test.js
//
// A METADE DA JANELA DE RESSINCRONIZACAO QUE O TESTE DE SOCKET NAO CONSEGUE FORCAR: o quadro RETIDO
// cuja op a resposta JA carregou. A difusao de uma op comitada antes da leitura pode sair depois do
// inicio da janela (o controller ainda faz uma consulta entre o commit e a difusao), e entregue
// DEPOIS da resposta ela reaplicaria a op mais velha por cima da mais nova nos tipos aplicados sem
// guarda de versao. `releaseOperationFrames` descarta toda op coberta pela resposta e entrega o
// resto na ordem de chegada. A regressao de ordem em si esta em
// `tests/ws/sync-request-ordem-dos-quadros.repro.test.js`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  installOutboundResourcePrune, holdOperationFrames, releaseOperationFrames,
} from '../../src/modules/collab/collab.send.js';

/** Um socket de mentira: registra o que foi de fato escrito no fio, ja depois da poda. */
function socketFalso() {
  const fio = [];
  const ws = { send: (data) => { fio.push(typeof data === 'string' ? JSON.parse(data) : data); } };
  installOutboundResourcePrune(ws);
  return { ws, fio };
}

const op = (serverVersion, name) => ({
  id: `op-${serverVersion}`, entityType: 'map', operationType: 'update',
  entityId: 'm1', data: { name }, serverVersion,
});

describe('quadros de op retidos durante um sync_request', () => {
  it('sem janela aberta, nada e retido', () => {
    const { ws, fio } = socketFalso();
    ws.send(JSON.stringify({ type: 'operations', ops: [op(5, 'a')] }));
    assert.equal(fio.length, 1);
  });

  it('com a janela aberta, so quadros de op esperam; presenca passa na hora', () => {
    const { ws, fio } = socketFalso();
    holdOperationFrames(ws);
    ws.send(JSON.stringify({ type: 'operations', ops: [op(7, 'x')] }));
    ws.send({ type: 'operation', op: op(8, 'y') });
    ws.send(JSON.stringify({ type: 'cursors', lote: [] }));
    ws.send({ type: 'sync_response', ops: [], currentVersion: 6 });
    assert.deepEqual(fio.map((q) => q.type), ['cursors', 'sync_response']);
    releaseOperationFrames(ws, 6);
    assert.deepEqual(fio.map((q) => q.type), ['cursors', 'sync_response', 'operations', 'operation']);
  });

  it('descarta a op que a resposta ja cobriu e mantem a mais nova do MESMO quadro', () => {
    const { ws, fio } = socketFalso();
    holdOperationFrames(ws);
    ws.send(JSON.stringify({ type: 'operations', userId: 'u', ops: [op(3, 'velho'), op(9, 'novo')] }));
    ws.send({ type: 'operation', op: op(4, 'coberto') });
    releaseOperationFrames(ws, 5);
    assert.equal(fio.length, 1, 'o quadro inteiramente coberto nao sai');
    assert.deepEqual(fio[0].ops.map((o) => o.serverVersion), [9]);
    assert.equal(fio[0].userId, 'u', 'o resto do quadro e preservado');
  });

  it('sem resposta (o pull falhou), entrega tudo o que reteve', () => {
    const { ws, fio } = socketFalso();
    holdOperationFrames(ws);
    ws.send({ type: 'operation', op: op(2, 'a') });
    releaseOperationFrames(ws);
    assert.equal(fio.length, 1);
  });

  it('liberar fecha a janela: o quadro seguinte sai direto', () => {
    const { ws, fio } = socketFalso();
    holdOperationFrames(ws);
    releaseOperationFrames(ws, 1);
    ws.send({ type: 'operation', op: op(2, 'a') });
    assert.equal(fio.length, 1);
  });
});
