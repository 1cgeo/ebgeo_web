// Path: tests/ws/tipo-desconhecido-avisa-uma-vez.test.js
//
// N5 — UM QUADRO DE TIPO DESCONHECIDO ESCREVIA UMA LINHA DE LOG POR QUADRO, com o backend REAL.
//
// A CAUSA. O `default` de `handleMessage` (`src/modules/collab/collab.gateway.js`) fazia
// `logger.warn({ type: data.type, userId }, 'Unknown message type')` sem memória nenhuma. Em
// 2026-09-21 o quadro `temporal` saiu dos dois pacotes, e a fila de saída do cliente é
// append-only: uma aba carregada ANTES do deploy continua mandando aquele quadro a cada mudança
// de cursor da régua, cerca de doze por segundo em reprodução. Uma linha por quadro, por cliente,
// no `.jsonl` do dia — pago exatamente pelo cliente antigo, que o contrato manda TOLERAR.
//
// O QUE ESTE ARQUIVO AFIRMA, com socket e servidor de verdade (o irmão puro,
// `tests/unit/aviso-de-tipo-desconhecido.test.js`, prende a decisão e as bordas):
//
//   1. três quadros do MESMO tipo mais um de um SEGUNDO tipo produzem EXATAMENTE DUAS linhas;
//   2. nada volta ao remetente (nenhum frame `error`) e o socket continua aberto e ATENDENDO —
//      a recusa de um cliente antigo doze vezes por segundo seria a regressão do outro lado;
//   3. o teto por socket é real no objeto vivo: vinte tipos distintos deixam o conjunto do
//      socket do SERVIDOR limitado, com uma última linha que ANUNCIA o silêncio.
//
// O PISO É O CURSOR, e ele não é decoração: "o log não cresceu" passaria idêntico se o socket
// estivesse mudo, se o quadro não tivesse chegado ao servidor ou se o espião estivesse na
// instância errada de `logger`. O cursor viaja pelo MESMO socket, na MESMA sala, e continua
// chegando ao par depois dos quadros desconhecidos.
//
// O ESPIÃO É O MESMO PADRÃO de `tests/ws/collab-error-leak.repro.test.js`: o pino sai em
// `level: 'silent'` sob teste, então a única forma de observar a decisão é trocar o método na
// MESMA instância ESM que o gateway importa.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import logger from '../../src/utils/logger.js';
import {
  MAX_TIPOS_POR_SOCKET,
  MSG_TETO_DE_TIPOS,
  MSG_TIPO_DESCONHECIDO,
} from '../../src/modules/collab/unknown-type-warning.js';

const U = () => `tipo_desc_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Folga depois de o quadro já ter sido processado: o relay é síncrono, isto não é espera de sorte. */
const JANELA_MS = 300;

/** O quadro que um cliente ANTIGO ainda manda, doze vezes por segundo numa reprodução. */
const TIPO_ANTIGO = 'temporal';

/** Um SEGUNDO tipo desconhecido, para provar que o silêncio é por TIPO e não por socket. */
const OUTRO_TIPO = 'reproducao_da_regua';

/**
 * Espia a MESMA instância ESM de `logger` que `collab.gateway.js` importa (o pino sai em
 * `level: 'silent'` sob teste, então não há saída para ler).
 */
function spyLogger() {
  const records = [];
  const descritor = Object.getOwnPropertyDescriptor(logger, 'warn');
  Object.defineProperty(logger, 'warn', {
    configurable: true, writable: true, enumerable: false,
    value: (obj, msg) => { records.push({ obj, msg }); },
  });
  return {
    records,
    /** As linhas DESTE assunto, por mensagem: filtrar por "algum warn" mediria o log alheio. */
    avisos() {
      return records.filter((r) => r.msg === MSG_TIPO_DESCONHECIDO || r.msg === MSG_TETO_DE_TIPOS);
    },
    restore() {
      if (descritor) Object.defineProperty(logger, 'warn', descritor);
      else delete logger.warn;
    },
  };
}

describe('N5 — tipo desconhecido no WS avisa uma vez por tipo, por socket', () => {
  let app, db, server, wss;
  let dono, donoTok, par, parTok, spy;
  const abertos = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    wss = attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    dono = await createUser(db, { username: U() });
    par = await createUser(db, { username: U() });
    donoTok = await loginUser(app, dono.username, dono.password);
    parTok = await loginUser(app, par.username, par.password);
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  beforeEach(() => { spy = spyLogger(); });
  afterEach(() => {
    spy.restore();
    for (const c of abertos.splice(0)) c.close();
  });

  /**
   * UM ATLAS POR CASO: a sala vive em memória e o socket de um caso anterior ainda pode estar
   * fechando, então um atlas compartilhado misturaria os pares de dois casos no mesmo retrato.
   */
  async function atlasNovo() {
    const atlas = await createAtlas(db, dono.id, { name: `Atlas ${U()}` });
    const map = await createMap(db, atlas.id, { name: 'Mapa Tático' });
    await createShare(db, atlas.id, par.id, 'write');
    return { atlas, map };
  }

  /** Abre um cliente já handshakeado e o registra para fechamento garantido. */
  async function conectar(atlasId, token, clientId) {
    const c = await createWsClient(server, atlasId, token, clientId ?? `c-${randomUUID().slice(0, 8)}`);
    abertos.push(c);
    await c.waitForType('connected');
    return c;
  }

  /** Garante que os quadros anteriores já foram processados (o socket os corre em série). */
  async function assentar(c) {
    c.send({ type: 'ping' });
    await c.waitForType('pong');
  }

  it('três quadros do mesmo tipo mais um de outro produzem DUAS linhas, e o socket segue vivo', async () => {
    const { atlas, map } = await atlasNovo();
    const clientId = `antigo-${randomUUID().slice(0, 8)}`;
    const antigo = await conectar(atlas.id, donoTok, clientId);
    const receptor = await conectar(atlas.id, parTok);
    antigo.clearMessages();
    receptor.clearMessages();

    antigo.send({ type: TIPO_ANTIGO, state: { cursor: 1763647200000 }, mapId: map.name });
    antigo.send({ type: TIPO_ANTIGO, state: { cursor: 1763647201000 }, mapId: map.name });
    antigo.send({ type: TIPO_ANTIGO, state: { cursor: 1763647202000 }, mapId: map.name });
    antigo.send({ type: OUTRO_TIPO, mapId: map.name });
    await assentar(antigo);
    await sleep(JANELA_MS);

    const avisos = spy.avisos();
    assert.equal(
      avisos.length, 2,
      `esperava UMA linha por tipo (duas no total); saíram ${avisos.length}: `
      + `${JSON.stringify(avisos.map((a) => a.obj?.type))}`
    );
    assert.deepEqual(avisos.map((a) => a.obj.type), [TIPO_ANTIGO, OUTRO_TIPO]);
    assert.deepEqual(avisos.map((a) => a.msg), [MSG_TIPO_DESCONHECIDO, MSG_TIPO_DESCONHECIDO]);
    // O campo que diz ao leitor do log que a contagem NÃO é a contagem de quadros.
    assert.deepEqual(avisos.map((a) => a.obj.soUmaVezPorTipoNesteSocket), [true, true]);
    assert.deepEqual(avisos.map((a) => a.obj.userId), [dono.id, dono.id]);

    // NADA VOLTA AO REMETENTE, e o socket não cai: é o contrato do cliente à frente ou atrás.
    assert.equal(
      antigo.getMessagesOfType('error').length, 0,
      'o quadro desconhecido respondeu erro: um cliente antigo veria recusa doze vezes por segundo'
    );
    assert.equal(antigo.ws.readyState, 1, 'o socket precisa continuar ABERTO');

    // PISO — o MESMO socket, na MESMA sala: o caminho de aplicação continua vivo depois dos
    // quadros desconhecidos, e o par recebe. Sem isto, o "duas linhas" acima seria
    // indistinguível de um socket mudo ou de um espião na instância errada de `logger`.
    antigo.send({ type: 'cursor', position: { lng: -43.2, lat: -22.9 }, mapId: map.name });
    const cursor = await receptor.waitForCursor();
    assert.equal(cursor.userId, dono.id);
    assert.deepEqual(cursor.position, { lng: -43.2, lat: -22.9 });
  });

  it('o silêncio é por SOCKET: o mesmo tipo vindo de outra conexão volta a avisar', async () => {
    const { atlas, map } = await atlasNovo();
    const primeiro = await conectar(atlas.id, donoTok);
    primeiro.send({ type: TIPO_ANTIGO, mapId: map.name });
    primeiro.send({ type: TIPO_ANTIGO, mapId: map.name });
    await assentar(primeiro);

    const segundo = await conectar(atlas.id, parTok);
    segundo.send({ type: TIPO_ANTIGO, mapId: map.name });
    await assentar(segundo);
    await sleep(JANELA_MS);

    const avisos = spy.avisos();
    assert.equal(avisos.length, 2, 'um aviso por socket, e não um por quadro nem um por processo');
    assert.deepEqual(avisos.map((a) => a.obj.userId), [dono.id, par.id]);
  });

  it('BORDA — o teto por socket é real no objeto vivo do servidor e anuncia o silêncio', async () => {
    const { atlas, map } = await atlasNovo();
    const clientId = `teto-${randomUUID().slice(0, 8)}`;
    const hostil = await conectar(atlas.id, donoTok, clientId);

    // Um tipo distinto por quadro é o vetor que troca volume de log por volume de MEMÓRIA.
    const distintos = MAX_TIPOS_POR_SOCKET + 4;
    for (let i = 0; i < distintos; i += 1) {
      hostil.send({ type: `tipo-sorteado-${i}`, mapId: map.name });
    }
    await assentar(hostil);
    await sleep(JANELA_MS);

    const avisos = spy.avisos();
    assert.equal(
      avisos.length, MAX_TIPOS_POR_SOCKET + 1,
      `o teto tem de cortar em ${MAX_TIPOS_POR_SOCKET} mais o anúncio; saíram ${avisos.length} linhas`
    );
    assert.equal(
      avisos[avisos.length - 1].msg, MSG_TETO_DE_TIPOS,
      'a última linha precisa ANUNCIAR o silêncio: silêncio mudo se lê como servidor quebrado'
    );
    assert.equal(avisos[avisos.length - 1].obj.tetoAtingido, true);

    // A METADE DE MEMÓRIA, medida no objeto VIVO do servidor e não no número de linhas: é ela
    // que diz que o conserto de log não virou um vetor de memória.
    const sockets = [...wss.clients].filter((s) => s.clientId === clientId);
    assert.equal(sockets.length, 1, 'o socket do caso precisa estar na lista do servidor');
    assert.equal(
      sockets[0].unknownTypesWarned.size, MAX_TIPOS_POR_SOCKET + 1,
      'o conjunto do socket precisa parar de crescer no teto (mais o sentinela)'
    );

    // E o socket continua ATENDENDO depois do teto: tolerar é tolerar.
    assert.equal(hostil.ws.readyState, 1);
    assert.equal(hostil.getMessagesOfType('error').length, 0);
  });
});
