// Path: tests/ws/presenca-fantasma-apos-saida.repro.test.js
//
// "TEM ALGO ERRADO NA PRESENÇA, AINDA DIZ QUE TEM USUÁRIO PRESENTE MESMO QUE DEPOIS DE SAIR"
// (relato do dono, 2026-09-22). Dois elos do lado do servidor, um caso cada.
//
// 1. O CURSOR QUE CHEGA DEPOIS DO `user_left`. O servidor anuncia a saída NA HORA e manda o cursor
//    num lote por sala, no próximo tique de `WS_CURSOR_BATCH_MS`. Um quadro recebido antes do
//    fechamento (o mouse ainda andando quando a aba fecha, a pose de 1 s da cena caminhável, o
//    `mouseleave` do 3D a caminho do X da aba) saía DEPOIS do anúncio. O armazém de presença do
//    cliente cria a entrada quando recebe um cursor de alguém que não conhece
//    (`setCursor`, frontend/src/js/presence/presence-store.js), e a pessoa voltava à lista de
//    quem está online sem nome, para sempre: nada mais anunciaria a saída dela. O conserto é
//    `descartarCursorPendente` (collab.rooms.js), chamado por `removeConnection` no ramo que
//    anuncia.
//
// 2. O SOCKET ZUMBI DE QUEM JÁ RECONECTOU. Rede que troca, notebook que suspende: o cliente percebe
//    primeiro (o heartbeat dele fecha o socket morto, e esse fechamento não chega ao servidor) e
//    reconecta com o MESMO clientId; o servidor só termina o socket velho na varredura seguinte, com
//    1006. Isso anunciava `user_away` de quem está online, e nada limpava o "ausente": o socket novo
//    não passou pelo caminho de reconexão que manda `user_back`, e a remoção ao fim da graça era
//    muda por causa do sobrevivente. O conserto é `temGemeoVivo` (collab.gateway.js).
//
// CONTROLE NEGATIVO, medido pela leitura do código e a repetir na rodada: sem a linha
// `descartarCursorPendente(...)` o primeiro caso recebe um `cursors` com o clientId de quem saiu
// DEPOIS do `user_left`; sem o desvio de `temGemeoVivo`, o segundo recebe `user_away`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket, setAwayGraceMs } from '../../src/modules/collab/collab.gateway.js';
import { limparCursoresPendentes } from '../../src/modules/collab/collab.rooms.js';

const U = () => `fant_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * O LOTE LARGO É O QUE TORNA O CASO DETERMINÍSTICO. Com o padrão de 100 ms a janela entre o quadro
 * enfileirado e o anúncio da saída depende do escalonador; com 500 ms o quadro está garantidamente
 * pendente quando o fechamento chega (ele é mandado 60 ms antes), e o lote sai garantidamente
 * depois do anúncio.
 */
const LOTE_MS = '500';
const GRACA_MS = 400;

/** Espera um quadro que satisfaça o predicado, devolvendo o índice dele em `messages`. */
async function esperarIndice(cliente, predicado, timeoutMs = 4000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const i = cliente.messages.findIndex(predicado);
    if (i >= 0) return i;
    await sleep(20);
  }
  throw new Error('quadro esperado não chegou');
}

/** Todo cursor (singular ou dentro de um lote) de um clientId, com o índice do quadro. */
function cursoresDe(cliente, clientId) {
  const achados = [];
  cliente.messages.forEach((m, i) => {
    if (m.type === 'cursor' && m.clientId === clientId) achados.push(i);
    if (m.type === 'cursors' && (m.lote || []).some((q) => q.clientId === clientId)) achados.push(i);
  });
  return achados;
}

describe('presença: ninguém volta à lista depois de sair (relato do dono, 2026-09-22)', () => {
  let app, db, server;
  let dono, donoTok, par, parTok;
  const abertos = [];
  let loteAnterior;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));
    setAwayGraceMs(GRACA_MS);
    loteAnterior = process.env.WS_CURSOR_BATCH_MS;
    process.env.WS_CURSOR_BATCH_MS = LOTE_MS;

    dono = await createUser(db, { username: U() });
    par = await createUser(db, { username: U() });
    donoTok = await loginUser(app, dono.username, dono.password);
    parTok = await loginUser(app, par.username, par.password);
  });

  after(async () => {
    for (const c of abertos) { try { c.close(); } catch { /* already closed */ } }
    limparCursoresPendentes();
    if (loteAnterior === undefined) delete process.env.WS_CURSOR_BATCH_MS;
    else process.env.WS_CURSOR_BATCH_MS = loteAnterior;
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  /** Um atlas por caso: a sala vive em memória e o socket de um caso anterior pode seguir nela. */
  async function atlasNovo() {
    const atlas = await createAtlas(db, dono.id, { name: `Atlas ${U()}` });
    const map = await createMap(db, atlas.id);
    await createShare(db, atlas.id, par.id, 'write', dono.id);
    return { atlas, map };
  }

  async function conectar(atlasId, token, clientId) {
    const c = await createWsClient(server, atlasId, token, clientId);
    abertos.push(c);
    await c.waitForType('connected');
    return c;
  }

  it('o cursor pendente de quem fecha a aba NÃO sai depois do `user_left`', async () => {
    const { atlas, map } = await atlasNovo();
    const receptor = await conectar(atlas.id, donoTok, `rx-${randomUUID().slice(0, 8)}`);
    const cidSaindo = `sai-${randomUUID().slice(0, 8)}`;
    const saindo = await conectar(atlas.id, parTok, cidSaindo);

    // PISO: o cursor deste mesmo cliente ATRAVESSA o lote. Sem isto, "nenhum cursor depois da
    // saída" passaria idêntico com o agrupamento desligado ou com a sala errada.
    saindo.send({ type: 'cursor', position: { lng: -43.1, lat: -22.8 }, mapId: map.name });
    const piso = await receptor.waitForCursor({ doClientId: cidSaindo, timeoutMs: 3000 });
    assert.deepEqual(piso.position, { lng: -43.1, lat: -22.8 });

    // O quadro que fica PENDENTE: o lote anterior já saiu, este entra num tique novo de 500 ms.
    saindo.send({ type: 'cursor', position: { lng: -43.2, lat: -22.9 }, mapId: map.name });
    await sleep(60);
    saindo.ws.close(1001, 'going away');

    const iSaida = await esperarIndice(
      receptor,
      (m) => m.type === 'user_left' && m.clientId === cidSaindo,
    );
    // Mais que um lote inteiro depois do anúncio.
    await sleep(Number(LOTE_MS) + 300);

    const depois = cursoresDe(receptor, cidSaindo).filter((i) => i > iSaida);
    assert.deepEqual(
      depois, [],
      'um cursor de quem saiu chegou DEPOIS do `user_left`: o par recriaria a pessoa na lista',
    );
  });

  it('o 1006 do socket zumbi de quem já reconectou com o MESMO clientId não anuncia `user_away`', async () => {
    const { atlas } = await atlasNovo();
    const receptor = await conectar(atlas.id, donoTok, `rx-${randomUUID().slice(0, 8)}`);
    const cid = `meio-aberto-${randomUUID().slice(0, 8)}`;

    const velho = await conectar(atlas.id, parTok, cid);
    // O socket NOVO do mesmo par (usuário, cliente), com o velho ainda aberto para o servidor.
    const novo = await conectar(atlas.id, parTok, cid);
    await esperarIndice(receptor, (m) => m.type === 'user_joined' && m.clientId === cid);

    // O velho morre sem quadro de fechamento, que é o 1006 da varredura.
    velho.ws.terminate();
    await sleep(GRACA_MS + 400);

    const ausente = receptor.messages.filter((m) => m.type === 'user_away' && m.clientId === cid);
    assert.equal(ausente.length, 0, 'quem está online no socket novo foi anunciado como ausente');
    const saiu = receptor.messages.filter((m) => m.type === 'user_left' && m.clientId === cid);
    assert.equal(saiu.length, 0, 'quem está online no socket novo foi anunciado como fora da sala');

    // PISO: o fechamento do socket VIVO continua anunciando a saída na hora.
    novo.ws.close(1000, 'leave');
    await esperarIndice(receptor, (m) => m.type === 'user_left' && m.clientId === cid);
  });

  it('PISO do zumbi: sem gêmeo vivo, a queda continua virando `user_away` e depois `user_left`', async () => {
    const { atlas } = await atlasNovo();
    const receptor = await conectar(atlas.id, donoTok, `rx-${randomUUID().slice(0, 8)}`);
    const cid = `so-${randomUUID().slice(0, 8)}`;
    const unico = await conectar(atlas.id, parTok, cid);

    unico.ws.terminate();
    await esperarIndice(receptor, (m) => m.type === 'user_away' && m.clientId === cid);
    await esperarIndice(receptor, (m) => m.type === 'user_left' && m.clientId === cid, GRACA_MS + 3000);
  });
});
