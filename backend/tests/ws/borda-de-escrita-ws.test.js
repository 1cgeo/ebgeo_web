// Path: tests/ws/borda-de-escrita-ws.test.js
//
// F14 — AS DUAS PORTAS DE ESCRITA PRECISAM SIGNIFICAR A MESMA COISA.
//
// `sync.schemas.js` é UM esquema com DOIS chamadores. O HTTP passa pelo middleware `validate`, que
// roda com `VALIDATION_OPTIONS` e faz `req.body = value`. O WS não passa por middleware nenhum:
// `collab.handlers.js` validava à mão, SEM opções e guardando só o `error`, e entregava a
// `pushOperations` o frame CRU do cliente. As duas metades eram bypass:
//
//   - sem `VALIDATION_OPTIONS`, `stripUnknown` fica no default (false), então um aperto escrito
//     para o caminho HTTP não fazia nada aqui;
//   - sem o `value`, tudo que o esquema NORMALIZA (hoje: a varredura de campo livre da F14) era
//     calculado e jogado fora.
//
// O efeito era o pior possível para um guarda: o MESMO esquema com dois comportamentos, conforme a
// porta. Este arquivo mede a porta do socket sozinha, e mede no BANCO, porque é lá que a fase
// promete que a definição não chega.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

const sufixo = randomUUID().slice(0, 8);
const URL_CONTRABANDO = `/tiles/${sufixo}/contrabando-ws/{z}/{x}/{y}.pbf`;

/** A definição NUA, que é o que a poda de SAÍDA não alcança e a borda de ENTRADA alcança. */
const contrabando = () => ({
  name: 'Camada restrita copiada',
  config: { source: { type: 'vector', url: URL_CONTRABANDO } },
});

describe('F14 — a borda de escrita vale também na porta do WebSocket', () => {
  let app, db, server;
  let autor, par, tokenAutor, tokenPar, atlas, mapa;
  let abertos;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    autor = await createUser(db, { username: `f14ws_autor_${sufixo}` });
    par = await createUser(db, { username: `f14ws_par_${sufixo}` });
    tokenAutor = await loginUser(app, autor.username, autor.password);
    tokenPar = await loginUser(app, par.username, par.password);

    atlas = await createAtlas(db, autor.id, { name: `F14 WS ${sufixo}` });
    mapa = await createMap(db, atlas.id, { name: `Mapa WS ${sufixo}` });
    await createShare(db, atlas.id, par.id, 'read', autor.id);
  });

  beforeEach(() => { abertos = []; });

  afterEach(() => {
    for (const c of abertos) {
      try {
        if (c.ws && c.ws.readyState <= 1) c.ws.terminate();
      } catch { /* já foi */ }
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

  async function conectar(token, clientId) {
    const cliente = await createWsClient(server, atlas.id, token, clientId);
    abertos.push(cliente);
    await cliente.waitForType('connected');
    return cliente;
  }

  const linhaDeCamada = async (id) => {
    const { rows } = await db.query(
      'SELECT data FROM catalog_layers WHERE map_id = $1 AND id = $2', [mapa.id, id],
    );
    return rows[0]?.data;
  };

  it('`operation` (singular): a definição não é gravada, e o gesto é acked normalmente', async () => {
    const a = await conectar(tokenAutor, `a-${sufixo}`);
    const idDaCamada = `ws-singular-${sufixo}`;

    a.send({
      type: 'operation',
      op: {
        id: randomUUID(),
        entityType: 'catalogLayer',
        operationType: 'create',
        entityId: idDaCamada,
        mapId: mapa.id,
        data: {
          id: idDaCamada,
          type: 'wms',
          visible: true,
          sourceId: 'origem-do-cliente',
          styleOverrides: { raster: { 'raster-opacity': 0.4 }, contrabando: contrabando() },
        },
        timestamp: Date.now(),
        clientId: `a-${sufixo}`,
      },
    });

    const ack = await a.waitForType('ack');
    // DESCARTE, NUNCA REJEIÇÃO: um `error` de validação aqui pararia a fila do cliente.
    assert.ok(ack.opId, 'a op foi acked, não recusada');

    const guardado = await linhaDeCamada(idDaCamada);
    assert.ok(guardado, 'a linha foi criada');
    assert.ok(
      !JSON.stringify(guardado).includes(URL_CONTRABANDO),
      'a porta do socket precisa aplicar o MESMO esquema que a porta HTTP',
    );
    // O par positivo: sem ele, um handler que descartasse a op inteira passaria neste caso.
    assert.equal(guardado.visible, true);
    assert.equal(guardado.sourceId, 'origem-do-cliente');
    assert.deepEqual(guardado.styleOverrides.raster, { 'raster-opacity': 0.4 });
  });

  it('`operations` (lote): idem, e o relay ao par sai sem a definição', async () => {
    const a = await conectar(tokenAutor, `a2-${sufixo}`);
    const b = await conectar(tokenPar, `b2-${sufixo}`);
    b.clearMessages();

    const idDaCamada = `ws-lote-${sufixo}`;
    const idDaFeicao = randomUUID();
    a.send({
      type: 'operations',
      ops: [
        {
          id: randomUUID(),
          entityType: 'catalogLayer',
          operationType: 'create',
          entityId: idDaCamada,
          mapId: mapa.id,
          data: {
            id: idDaCamada, type: 'wms', visible: true,
            styleOverrides: { contrabando: contrabando() },
          },
          timestamp: Date.now(),
          clientId: `a2-${sufixo}`,
        },
        {
          id: randomUUID(),
          entityType: 'feature',
          operationType: 'create',
          entityId: idDaFeicao,
          mapId: mapa.id,
          data: {
            id: idDaFeicao,
            feature_type: 'point',
            geometry: { type: 'Point', coordinates: [-45, -20] },
            properties: { nome: 'Ponto do lote', contrabando: contrabando() },
          },
          timestamp: Date.now(),
          clientId: `a2-${sufixo}`,
        },
      ],
    });

    await a.waitForType('ack_batch');
    const frame = await b.waitForType('operations');

    const guardado = await linhaDeCamada(idDaCamada);
    assert.ok(guardado && guardado.visible === true, 'a camada do lote foi gravada');
    assert.ok(!JSON.stringify(guardado).includes(URL_CONTRABANDO), 'sem a definição');

    const { rows } = await db.query('SELECT properties FROM features WHERE id = $1', [idDaFeicao]);
    assert.equal(rows.length, 1, 'a feição do mesmo lote também foi gravada');
    assert.equal(rows[0].properties.nome, 'Ponto do lote', 'inteira no que é domínio');
    assert.ok(!JSON.stringify(rows[0].properties).includes(URL_CONTRABANDO), 'e sem a definição');

    // O RELAY: o par recebe a op VALIDADA, não o frame cru do autor. Sem o uso do `value` em
    // `validateOps`, o objeto espalhado aqui seria o do cliente.
    assert.ok(
      !JSON.stringify(frame).includes(URL_CONTRABANDO),
      'o relay ao par carregou a definição que a borda descartou',
    );
    assert.equal(frame.ops.length, 2, 'e as duas ops chegaram ao par');
  });
});
