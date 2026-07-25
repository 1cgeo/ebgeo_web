// Path: tests/ws/collab-away-slot-identity.repro.test.js
// Item 78 — o slot `away` era chaveado só por `${atlasId}::${clientId}`, e o
// `clientId` identifica um PERFIL DE NAVEGADOR, não uma pessoa: ele vem do
// localStorage, então duas contas na mesma máquina mandam o MESMO valor.
//
// Consequência, dentro da graça de 120 s: o segundo usuário sequestrava o slot do
// primeiro. `onConnection` achava o timer pendente pela chave, cancelava a remoção
// do primeiro, tirava o socket morto dele da sala SEM anunciar `user_left`, e emitia
// `user_back` com o id de QUEM NUNCA ESTEVE AWAY. Os pares ficavam listando para
// sempre um usuário que já saiu (nada mais anunciaria a saída — o timer já não
// existia) e recebiam a volta de alguém que não tinha ido.
//
// A metade simétrica morava em `removeConnection`: a guarda de sobrevivente
// comparava só `clientId`, então mesmo com o timer intacto o socket VIVO do segundo
// usuário calava o `user_left` do primeiro. Corrigir a chave sem corrigir a guarda
// mantém o fantasma; por isso os dois casos abaixo.
//
// INVARIANTE: um slot de presença pertence ao par (userId, clientId). Nenhuma
// transição de presença de um usuário pode ser atribuída, suprimida ou herdada por
// outro só porque compartilham o clientId.
//
// CONTROLE NEGATIVO (executado): com `collab.gateway.js` restaurado do backup (chave
// sem userId + guarda só por clientId), caem 2 dos 4 casos — o de sequestro (recebe
// `user_back` de quem nunca esteve away e nunca recebe o `user_left` do que saiu) e o
// da guarda de sobrevivente. Restauração por CÓPIA do backup, nunca `git checkout`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket, setAwayGraceMs } from '../../src/modules/collab/collab.gateway.js';

const U = () => `slot_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Graça larga o bastante para que a reconexão do segundo usuário caia DENTRO dela —
// se ela expirasse antes, o caso não estaria testando nada (o slot já teria sumido).
const GRACA_MS = 5000;

describe('identidade do slot away (item 78)', () => {
  let app, db, server;
  let owner, atlas;
  let userA, tokenA, userB, tokenB, observador, tokenObs;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));
    setAwayGraceMs(GRACA_MS);

    owner = await createUser(db, { username: U() });
    atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);

    userA = await createUser(db, { username: U() });
    userB = await createUser(db, { username: U() });
    observador = await createUser(db, { username: U() });
    for (const u of [userA, userB, observador]) {
      await createShare(db, atlas.id, u.id, 'write', owner.id);
    }
    tokenA = await loginUser(app, userA.username, userA.password);
    tokenB = await loginUser(app, userB.username, userB.password);
    tokenObs = await loginUser(app, observador.username, observador.password);
  });

  after(async () => {
    setAwayGraceMs(120000);
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  /** Espera até que `pred` ache um frame, ou devolve undefined. */
  async function aguardarFrame(client, pred, timeoutMs = 2500) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const achado = client.messages.find(pred);
      if (achado) return achado;
      await sleep(25);
    }
    return undefined;
  }

  it('outro USUÁRIO com o mesmo clientId não herda o slot away: o que saiu recebe user_left', async () => {
    const cid = `cid-${randomUUID().slice(0, 8)}`;
    const obs = await createWsClient(server, atlas.id, tokenObs, `obs-${randomUUID().slice(0, 8)}`);
    await obs.waitForType('connected');

    const a = await createWsClient(server, atlas.id, tokenA, cid);
    await a.waitForType('connected');
    assert.ok(
      await aguardarFrame(obs, (m) => m.type === 'user_joined' && m.user?.id === userA.id),
      'guarda: o observador precisa ver a entrada de A, senão nada abaixo prova nada'
    );

    // Queda de rede: 1006 → A entra em `away` (o slot fica suspenso na graça).
    a.ws.terminate();
    assert.ok(
      await aguardarFrame(obs, (m) => m.type === 'user_away' && m.userId === userA.id),
      'guarda: A precisa estar AWAY antes de B chegar'
    );

    // B chega com o MESMO clientId, dentro da graça: mesmo perfil de navegador, outra conta.
    const b = await createWsClient(server, atlas.id, tokenB, cid);
    const conectadoB = await b.waitForType('connected');

    // 1. A saída de A é anunciada — é isto que impedia o fantasma permanente.
    const saidaDeA = await aguardarFrame(
      obs,
      (m) => m.type === 'user_left' && m.userId === userA.id && m.clientId === cid
    );
    assert.ok(saidaDeA, 'o slot de A precisa ser encerrado com user_left quando B toma o clientId');

    // 2. Ninguém "voltou": um `user_back` aqui seria a atribuição errada de identidade.
    const voltaFalsa = obs.messages.find((m) => m.type === 'user_back');
    assert.equal(
      voltaFalsa,
      undefined,
      `user_back emitido sem ninguém ter voltado: ${JSON.stringify(voltaFalsa)}`
    );

    // 3. O roster que B recebe não pode conter A.
    const idsNoRoster = (conectadoB.usersOnline ?? []).map((u) => u.id);
    assert.ok(idsNoRoster.includes(userB.id), 'guarda: B se vê no próprio roster');
    assert.ok(
      !idsNoRoster.includes(userA.id),
      `A continua no roster de B: ${JSON.stringify(idsNoRoster)}`
    );

    b.ws.close(1000);
    obs.ws.close(1000);
  });

  it('o MESMO usuário com o mesmo clientId continua reconectando: user_back, sem user_left', async () => {
    // Contraprova da correção: a chave ganhou userId, mas a continuidade legítima
    // (mesma pessoa, mesma aba, queda de rede) tem de seguir funcionando — senão o
    // conserto teria só trocado um bug por outro.
    const cid = `cid-${randomUUID().slice(0, 8)}`;
    const obs = await createWsClient(server, atlas.id, tokenObs, `obs-${randomUUID().slice(0, 8)}`);
    await obs.waitForType('connected');

    const a1 = await createWsClient(server, atlas.id, tokenA, cid);
    await a1.waitForType('connected');
    a1.ws.terminate();
    assert.ok(await aguardarFrame(obs, (m) => m.type === 'user_away' && m.userId === userA.id));

    const a2 = await createWsClient(server, atlas.id, tokenA, cid);
    await a2.waitForType('connected');

    const volta = await aguardarFrame(
      obs,
      (m) => m.type === 'user_back' && m.userId === userA.id && m.clientId === cid
    );
    assert.ok(volta, 'a reconexão do MESMO usuário precisa emitir user_back');

    const saidaIndevida = obs.messages.find((m) => m.type === 'user_left' && m.userId === userA.id);
    assert.equal(saidaIndevida, undefined, 'reconexão dentro da graça não pode anunciar saída');

    a2.ws.close(1000);
    obs.ws.close(1000);
  });

  it('guarda de sobrevivente: socket VIVO de outro usuário no mesmo clientId não cala o user_left', async () => {
    // A metade em `removeConnection`. Sem away nenhum: B e A vivos ao mesmo tempo com
    // o mesmo clientId (mesmo navegador, duas contas). A fecha limpo; a guarda que
    // comparava só clientId via B na sala e engolia o anúncio.
    const cid = `cid-${randomUUID().slice(0, 8)}`;
    const obs = await createWsClient(server, atlas.id, tokenObs, `obs-${randomUUID().slice(0, 8)}`);
    await obs.waitForType('connected');

    const a = await createWsClient(server, atlas.id, tokenA, cid);
    await a.waitForType('connected');
    const b = await createWsClient(server, atlas.id, tokenB, cid);
    await b.waitForType('connected');
    assert.ok(
      await aguardarFrame(obs, (m) => m.type === 'user_joined' && m.user?.id === userB.id),
      'guarda: os dois estão na sala com o mesmo clientId'
    );

    a.ws.close(1000, 'bye');

    const saidaDeA = await aguardarFrame(
      obs,
      (m) => m.type === 'user_left' && m.userId === userA.id && m.clientId === cid
    );
    assert.ok(saidaDeA, 'a saída limpa de A tem de ser anunciada, mesmo com B vivo no mesmo clientId');

    b.ws.close(1000);
    obs.ws.close(1000);
  });

  it('duas ABAS do mesmo usuário no mesmo clientId: fechar uma NÃO anuncia saída', async () => {
    // O caso que a guarda de sobrevivente existe para proteger, e que a correção não
    // pode quebrar: mesma pessoa, mesmo clientId, dois sockets. Fechar um deles deixa
    // a presença viva, então nada é anunciado.
    const cid = `cid-${randomUUID().slice(0, 8)}`;
    const obs = await createWsClient(server, atlas.id, tokenObs, `obs-${randomUUID().slice(0, 8)}`);
    await obs.waitForType('connected');

    const aba1 = await createWsClient(server, atlas.id, tokenA, cid);
    await aba1.waitForType('connected');
    const aba2 = await createWsClient(server, atlas.id, tokenA, cid);
    await aba2.waitForType('connected');

    aba1.ws.close(1000, 'bye');
    await sleep(400);

    const saida = obs.messages.find((m) => m.type === 'user_left' && m.userId === userA.id);
    assert.equal(saida, undefined, 'com outra aba viva do MESMO usuário não há saída a anunciar');

    aba2.ws.close(1000);
    assert.ok(
      await aguardarFrame(obs, (m) => m.type === 'user_left' && m.userId === userA.id),
      'e ao fechar a última aba a saída aparece'
    );

    obs.ws.close(1000);
  });
});
