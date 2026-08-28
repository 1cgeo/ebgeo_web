// Path: tests/ws/collab-cursor-agrupado.test.js
//
// O CURSOR SAI EM LOTE, E O LOTE CARREGA SO A ULTIMA POSICAO DE CADA UM.
//
// O CUSTO QUE ISTO ATACA, medido antes de existir. A sala e `atlasId -> Set<WebSocket>` e nao tem
// subcanal, entao cada quadro de cursor virava uma escrita em socket POR PAR: `S x f x 12,5 x
// (S-1)` por segundo, porque o throttle do cliente e de 80 ms. A bancada mediu a sala de 200
// pedindo 246.302 quadros/s e o servidor entregando 46.436; a de 400 pedindo 971.086 e entregando
// os mesmos 46 mil. Acima do teto o servidor gasta CPU DECIDINDO DESCARTAR, e a escrita paga
// junto: o ack mediano vai de 16 ms na sala de 50 para 3,8 s na de 100.
//
// AS QUATRO GARANTIAS QUE ESTE ARQUIVO PRENDE, e cada uma existe porque quebra-la seria facil:
//
//   COALESCE. Varios quadros do MESMO cliente dentro da janela viram UM item, com a ultima
//   posicao. Sem isso o lote seria so um empacotamento, e o numero de escritas nao cairia.
//
//   NAO MISTURA CLIENTES. Dois clientes distintos rendem DOIS itens. A chave e o `clientId`, nao o
//   `userId`, porque duas abas da mesma pessoa sao duas presencas e o registro da sala e keyed por
//   clientId. Agrupar por usuario faria uma aba apagar a outra.
//
//   O REMETENTE RECEBE O PROPRIO ECO. Isso e uma MUDANCA deliberada, nao um descuido: o ganho vem
//   de serializar UMA vez para a sala, e excluir cada remetente exigiria um payload por
//   destinatario, que e exatamente o custo que se quer eliminar. Quem descarta e o cliente, pelo
//   `clientId`, como ja faz com operacoes. Se alguem "consertar" isso reintroduzindo a exclusao, o
//   ganho evapora e este caso avisa.
//
//   O DESLIGAMENTO VOLTA AO COMPORTAMENTO ANTIGO. Com `WS_CURSOR_BATCH_MS` em zero o quadro sai na
//   hora, como `cursor` e sem o remetente. E o que permite medir antes contra depois na mesma
//   bancada, e o que permite reverter em producao sem novo deploy de codigo.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

describe('cursor agrupado: um lote por sala, a ultima posicao de cada um', () => {
  let app;
  let db;
  let server;
  let limparCursoresPendentes;
  let dono;
  let membroA;
  let membroB;
  let tokenA;
  let tokenB;
  let atlas;
  let mapa;
  let abertos;

  const quadro = (lng) => ({
    type: 'cursor',
    position: { lng, lat: -22.9 },
    mapId: mapa.id,
  });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const gateway = await import('../../src/modules/collab/collab.gateway.js');
    gateway.attachWebSocket(server);
    const rooms = await import('../../src/modules/collab/collab.rooms.js');
    limparCursoresPendentes = rooms.limparCursoresPendentes;
    await new Promise((resolve) => server.listen(0, () => resolve()));

    dono = await createUser(db, { username: `ag_dono_${randomUUID().slice(0, 6)}` });
    membroA = await createUser(db, { username: `ag_a_${randomUUID().slice(0, 6)}` });
    membroB = await createUser(db, { username: `ag_b_${randomUUID().slice(0, 6)}` });
    tokenA = await loginUser(app, membroA.username, membroA.password);
    tokenB = await loginUser(app, membroB.username, membroB.password);

    atlas = await createAtlas(db, dono.id, { name: 'Atlas do cursor agrupado' });
    mapa = await createMap(db, atlas.id);
    await createShare(db, atlas.id, membroA.id, 'write', dono.id);
    await createShare(db, atlas.id, membroB.id, 'write', dono.id);
  });

  beforeEach(() => { abertos = []; });

  afterEach(() => {
    // Restaurar SEMPRE, senao um caso deixa o proximo medindo outro regime.
    delete process.env.WS_CURSOR_BATCH_MS;
    limparCursoresPendentes();
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

  // `config.ws` e `Object.freeze`, entao a propriedade nao se redefine. O modulo le o intervalo
  // VIVO do ambiente exatamente para que os dois regimes possam ser exercitados no mesmo processo.
  const comIntervalo = (ms) => { process.env.WS_CURSOR_BATCH_MS = String(ms); };

  it('varios quadros do mesmo cliente viram UM item, com a ultima posicao', async () => {
    comIntervalo(60);
    const a = await createWsClient(server, atlas.id, tokenA, randomUUID());
    const b = await createWsClient(server, atlas.id, tokenB, randomUUID());
    abertos.push(a, b);

    a.send(quadro(-43.1));
    a.send(quadro(-43.2));
    a.send(quadro(-43.3));

    const lote = await b.waitForType('cursors');
    assert.equal(lote.lote.length, 1, 'tres quadros do mesmo cliente tem de virar um item');
    assert.equal(
      lote.lote[0].position.lng, -43.3,
      'o item tem de carregar a ULTIMA posicao, nao a primeira'
    );
  });

  it('dois clientes rendem dois itens no mesmo lote', async () => {
    comIntervalo(60);
    const a = await createWsClient(server, atlas.id, tokenA, randomUUID());
    const b = await createWsClient(server, atlas.id, tokenB, randomUUID());
    const c = await createWsClient(server, atlas.id, tokenA, randomUUID());
    abertos.push(a, b, c);

    a.send(quadro(-43.1));
    c.send(quadro(-44.1));

    const lote = await b.waitForType('cursors');
    assert.equal(lote.lote.length, 2, 'clientes distintos nao podem se fundir');
    const clientes = new Set(lote.lote.map((i) => i.clientId));
    assert.equal(clientes.size, 2, 'a chave do agrupamento e o clientId');
  });

  it('o remetente TAMBEM recebe o lote, e descartar e obrigacao do cliente', async () => {
    comIntervalo(60);
    const a = await createWsClient(server, atlas.id, tokenA, randomUUID());
    const b = await createWsClient(server, atlas.id, tokenB, randomUUID());
    abertos.push(a, b);

    a.send(quadro(-43.5));

    const meu = await a.waitForType('cursors');
    // ESTE CASO PARECE ERRADO E E O DESENHO. Uma serializacao por sala e de onde vem o ganho;
    // excluir o remetente exigiria um payload por destinatario. Ver o cabecalho.
    assert.equal(meu.lote.length, 1);
    assert.ok(meu.lote[0].clientId, 'o item precisa carregar clientId, senao o cliente nao filtra');
  });

  it('com o agrupamento desligado, o quadro sai na hora e sem o remetente', async () => {
    comIntervalo(0);
    const a = await createWsClient(server, atlas.id, tokenA, randomUUID());
    const b = await createWsClient(server, atlas.id, tokenB, randomUUID());
    abertos.push(a, b);

    a.send(quadro(-43.9));

    const recebido = await b.waitForType('cursor');
    assert.equal(recebido.position.lng, -43.9);

    // O remetente NAO recebe no caminho antigo. Sem esta metade, "desligado" poderia estar
    // silenciosamente ligado e o teste ainda passaria.
    await espera(150);
    assert.equal(
      a.messages.filter((m) => m.type === 'cursor' || m.type === 'cursors').length, 0,
      'no caminho antigo o remetente e excluido do fan-out'
    );
  });
});
