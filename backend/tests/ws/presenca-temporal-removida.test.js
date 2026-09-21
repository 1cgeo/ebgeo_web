// Path: tests/ws/presenca-temporal-removida.test.js
//
// O INSTANTE DA LINHA DO TEMPO DE UMA PESSOA NÃO SE PROPAGA (decisão do dono, 2026-09-21,
// registrada em docs/decisions/decisions-2026.md, entrada de 2026-09-21). A presença diz se a pessoa está
// no mapa ou não; a linha do tempo é visualização de cada um, como já eram o ligar e desligar, a
// reprodução e a velocidade desde 2026-09-20.
//
// O QUE EXISTIA ATÉ ESTA DATA. Um quadro `temporal` era validado por schema próprio, RETIDO no
// socket (`ws.temporalState`), RETRANSMITIDO à sala e devolvido no retrato de entrada
// (`getRoomUsers`) a todo mundo que entrasse depois. O cliente o mandava a cada mudança de cursor
// da régua e desenhava "em D+3" na lista de quem está online.
//
// O QUE ESTE ARQUIVO AFIRMA, e por que ele precisa existir. Remover código não deixa rastro: a
// suíte fica verde porque os casos que o exercitavam saíram junto. O que sobra sem um caso como
// este é uma AUSÊNCIA que ninguém mede, e a fila de saída do produto é append-only, então um
// cliente ANTIGO continua mandando o quadro por tempo indefinido. As três propriedades:
//
//   1. o quadro enviado por um cliente NÃO chega ao par;
//   2. ele NÃO aparece no retrato de quem entra depois;
//   3. ele não derruba o socket nem gera resposta de erro (o gateway o trata como tipo
//      desconhecido, que é o contrato declarado para cliente à frente ou atrás do servidor).
//
// O PISO É OBRIGATÓRIO E É O CURSOR DO MESMO CLIENTE. Sem ele, "o par não recebeu nada" passaria
// idêntico se o socket estivesse mudo, se a sala estivesse errada ou se o teste estivesse
// esperando no cliente errado: três formas de verde vazio. O cursor viaja pelo MESMO socket, na
// MESMA sala, e continua chegando.
//
// O VISITANTE PÚBLICO tem caso próprio porque era o vetor que o achado #9 nomeava: cursor e
// temporal eram ungated, então um leitor anônimo enchia o retrato de entrada de todo mundo. Aqui
// ele é o piso mais estreito possível: mesmo sem conta, sem schema e sem limite, o quadro não
// engorda o retrato porque não é retido em lugar nenhum.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser,
  createAtlas,
  createMap,
  createShare,
  loginUser,
  makeAtlasPublic,
  getPublicToken,
} from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

const U = () => `tmp_rm_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Janela de silêncio: o relay de presença é síncrono, então isto é folga, não espera de sorte. */
const JANELA_MS = 400;

/** O quadro que um cliente ANTIGO ainda manda. */
const QUADRO_TEMPORAL = Object.freeze({ cursor: 1763647200000, label: 'D+3', playing: true });

describe('presença: o instante da linha do tempo não se propaga (dono, 2026-09-21)', () => {
  let app, db, server;
  let dono, donoTok, par, parTok;
  const abertos = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    dono = await createUser(db, { username: U() });
    par = await createUser(db, { username: U() });
    donoTok = await loginUser(app, dono.username, dono.password);
    parTok = await loginUser(app, par.username, par.password);
  });

  after(async () => {
    for (const c of abertos) c.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  /**
   * UM ATLAS POR CASO, e isso não é higiene genérica: a sala vive em memória e o socket de um
   * caso anterior continua aberto (fechá-lo é assíncrono e o roster é por CLIENTE). Sobre um
   * atlas compartilhado, `find(u => u.id === dono.id)` devolveria a entrada do caso ANTERIOR, e
   * o caso de retrato mediria o cursor errado. Medido: foi exatamente assim que ele falhou.
   */
  async function atlasNovo(nomeDoMapa = 'Mapa Tático') {
    const atlas = await createAtlas(db, dono.id, { name: `Atlas ${U()}` });
    const map = await createMap(db, atlas.id, { name: nomeDoMapa });
    await createShare(db, atlas.id, par.id, 'write');
    return { atlas, map };
  }

  /** Abre um cliente já handshakeado e o registra para fechamento. */
  async function conectar(atlasId, token, clientId) {
    const c = await createWsClient(server, atlasId, token, clientId ?? `c-${randomUUID().slice(0, 8)}`);
    abertos.push(c);
    await c.waitForType('connected');
    return c;
  }

  /** Garante que o quadro anterior já foi processado (as mensagens do socket correm em série). */
  async function assentar(c) {
    c.send({ type: 'ping' });
    await c.waitForType('pong');
  }

  it('o quadro não chega ao par, e o cursor do MESMO cliente chega (piso)', async () => {
    const { atlas, map } = await atlasNovo();
    const emissor = await conectar(atlas.id, donoTok);
    const receptor = await conectar(atlas.id, parTok);
    receptor.clearMessages();

    emissor.send({ type: 'temporal', state: QUADRO_TEMPORAL, mapId: map.name });
    await assentar(emissor);
    await sleep(JANELA_MS);

    assert.equal(
      receptor.getMessagesOfType('temporal').length,
      0,
      'o par recebeu um quadro de linha do tempo: o tratador ou o ramo do gateway voltou'
    );

    // PISO — o MESMO socket, na MESMA sala: o cursor continua atravessando. Sem isto, o zero
    // acima seria indistinguível de um socket mudo ou de uma sala errada.
    emissor.send({ type: 'cursor', position: { lng: -43.2, lat: -22.9 }, mapId: map.name });
    const cursor = await receptor.waitForCursor();
    assert.equal(cursor.userId, dono.id);
    assert.deepEqual(cursor.position, { lng: -43.2, lat: -22.9 });
  });

  it('o quadro não aparece no retrato de quem entra depois, e o cursor aparece (piso)', async () => {
    const { atlas, map } = await atlasNovo();
    const emissor = await conectar(atlas.id, donoTok);
    emissor.send({ type: 'temporal', state: QUADRO_TEMPORAL, mapId: map.name });
    emissor.send({ type: 'cursor', position: { lng: -44.1, lat: -23.5 }, mapId: map.name });
    await assentar(emissor);

    const tardio = await conectar(atlas.id, parTok);
    const conectado = tardio.messages.find((m) => m.type === 'connected');
    const entrada = conectado.usersOnline.find((u) => u.id === dono.id);
    assert.ok(entrada, 'o emissor precisa estar no retrato, senão as asserções abaixo somem');

    // A chave não existe MAIS no retrato: nem com valor, nem como `null`, nem vazia.
    assert.equal(
      'temporalState' in entrada,
      false,
      `o retrato voltou a expor o instante da linha do tempo: ${JSON.stringify(Object.keys(entrada))}`
    );
    assert.equal(
      JSON.stringify(entrada).includes(String(QUADRO_TEMPORAL.cursor)),
      false,
      'o instante enviado sobreviveu no retrato sob outro nome de campo'
    );

    // PISO — o vizinho retido pelo MESMO caminho continua no retrato.
    assert.deepEqual(entrada.cursorPosition, { lng: -44.1, lat: -23.5 });
    assert.equal(entrada.mapId, map.name);
  });

  // PROPRIEDADE DE COMPATIBILIDADE, e ela NÃO reprova com a remoção revertida (medido): o código
  // antigo também não respondia erro a um quadro válido. Ela existe contra a regressão do OUTRO
  // lado, que é a fácil de cometer ao "limpar" o gateway: um ramo que feche o socket, ou que
  // responda VALIDATION_ERROR, transformaria um cliente antigo em cliente derrubado doze vezes
  // por segundo. Quem detecta a volta da funcionalidade são os dois casos acima.
  it('o quadro de um cliente antigo não derruba o socket nem gera erro', async () => {
    const { atlas, map } = await atlasNovo();
    const antigo = await conectar(atlas.id, donoTok);
    antigo.clearMessages();

    antigo.send({ type: 'temporal', state: QUADRO_TEMPORAL, mapId: map.name });
    await assentar(antigo);
    await sleep(JANELA_MS);

    assert.equal(
      antigo.getMessagesOfType('error').length,
      0,
      'o quadro desconhecido respondeu erro ao remetente: um cliente antigo veria recusa a cada quadro'
    );
    // O socket continua atendendo (o `pong` do `assentar` acima já provou, e o cursor prova que
    // não é só keepalive: o caminho de aplicação segue vivo depois do quadro desconhecido).
    const receptor = await conectar(atlas.id, parTok);
    receptor.clearMessages();
    antigo.send({ type: 'cursor', position: { lng: 1, lat: 2 }, mapId: map.name });
    const cursor = await receptor.waitForCursor({ timeoutMs: 3000 });
    assert.deepEqual(cursor.position, { lng: 1, lat: 2 });
  });

  it('o visitante público não deixa instante nenhum no retrato, nem pequeno nem gigante', async () => {
    // O achado #9 nomeava este vetor: o quadro era ungated e ficava retido no socket, de modo que
    // um leitor anônimo pagava, para todo mundo que entrasse depois, o custo de re-serializar o
    // blob dele. São DUAS medidas, e a primeira é a que detecta a volta: um quadro PEQUENO e
    // VÁLIDO, que o schema antigo aceitava e o socket retinha, não deixa rastro no retrato. A
    // segunda é o vetor de tamanho, que o schema antigo já barrava.
    const publico = await createAtlas(db, dono.id, { name: `Atlas ${U()}` });
    await createMap(db, publico.id, { name: 'Mapa Público' });
    const link = await makeAtlasPublic(db, publico.id);
    const tokenPublico = await getPublicToken(app, link);

    const idVisitante = `v-${randomUUID().slice(0, 8)}`;
    const visitante = await createWsClient(server, publico.id, tokenPublico, idVisitante);
    abertos.push(visitante);
    const conectadoVisitante = await visitante.waitForType('connected');
    visitante.send({ type: 'temporal', state: QUADRO_TEMPORAL, mapId: 'Mapa Público' });
    visitante.send({ type: 'temporal', state: { blob: 'A'.repeat(2 * 1024 * 1024) }, mapId: 'Mapa Público' });
    visitante.send({ type: 'ping' });
    await visitante.waitForType('pong');

    const entrante = await createWsClient(server, publico.id, donoTok, `d-${randomUUID().slice(0, 8)}`);
    abertos.push(entrante);
    const conectado = await entrante.waitForType('connected');

    const doVisitante = conectado.usersOnline.find((u) => u.clientId === idVisitante);
    assert.ok(doVisitante, 'o visitante precisa estar no retrato, senão as asserções abaixo somem');
    assert.equal(
      'temporalState' in doVisitante,
      false,
      'o retrato voltou a carregar o instante de um visitante anônimo'
    );
    assert.equal(
      JSON.stringify(doVisitante).includes(String(QUADRO_TEMPORAL.cursor)),
      false,
      'o instante do visitante sobreviveu no retrato'
    );

    const bytes = Buffer.byteLength(JSON.stringify(conectado));
    assert.ok(
      bytes < 64 * 1024,
      `o retrato de entrada cresceu para ${bytes} bytes: o quadro do visitante voltou a ser retido`
    );
    // PISO: o retrato NÃO está vazio — ele traz as duas conexões, e o visitante entrou como
    // visitante, então o tamanho pequeno acima é a ausência do blob e não a ausência de retrato.
    assert.equal(conectado.usersOnline.length, 2);
    assert.ok(conectadoVisitante.usersOnline.length >= 1);
  });
});
