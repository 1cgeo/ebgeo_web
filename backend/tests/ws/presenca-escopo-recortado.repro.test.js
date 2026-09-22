// Path: tests/ws/presenca-escopo-recortado.repro.test.js
//
// O ESCOPO DO CURSOR E DA SELEÇÃO DO 3D E DO 360 VAZAVA PARA A SALA INTEIRA (achado de 2026-09-22,
// autorizado pelo dono no mesmo dia). Desde 2026-09-16 o cursor dessas superfícies carrega
// `tilesetId`/`photoName`, e a seleção já carregava; os dois iam a todo socket da sala, o visitante
// anônimo de link público incluído. A POSIÇÃO de um cursor 3D é pior que o id: é uma coordenada
// geográfica sobre o modelo, que situa no mapa um recurso privado.
//
// O QUE ESTE ARQUIVO PRENDE, sempre com o PAR negativo e positivo no mesmo quadro (a regra da casa
// para filtro de acesso: o negativo sozinho passaria idêntico se o escopo nunca viajasse):
//
//   1. escopo PÚBLICO vai inteiro a todos;
//   2. escopo PRIVADO vai inteiro a quem enxerga (o credenciado lê todo privado) e REDIGIDO a quem
//      não enxerga: sem o id, sem a posição e, na seleção, sem os marcadores;
//   3. o EMPRÉSTIMO do atlas conta: o mesmo leitor passa a receber o escopo emprestado;
//   4. o VISITANTE recebe o público e o emprestado, e o próprio cursor dele continua sem posição;
//   5. o RETRATO de entrada leva só o que todos leem, e quem enxerga recebe o quadro à parte;
//   6. identificador que NÃO RESOLVE é privado para todos, para a redação não virar oráculo de
//      existência;
//   7. o caminho SEM lote (`WS_CURSOR_BATCH_MS=0`) recorta pela mesma regra.
//
// CONTROLE NEGATIVO, pela leitura do código e a repetir na rodada: com `escopoLivre` devolvendo
// verdadeiro para tudo (`collab.recorte.js`), os casos 2, 3, 5 e 6 reprovam no lado negativo.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createShare, loginUser, makeAtlasPublic, getPublicToken,
  seedPublic360Photos, drop360Fixture, dropCatalogRefs,
} from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket } from '../../src/modules/collab/collab.gateway.js';
import { limparMemosDePresenca } from '../../src/modules/collab/collab.recorte.js';

const U = () => `rec_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Um ponto sobre o modelo, com casas decimais que não aparecem por acaso num quadro. */
const PONTO = Object.freeze({ lng: -43.2099317, lat: -22.9011519, alt: 15.75 });

describe('presença: o escopo 3D/360 do cursor e da seleção só chega a quem o enxerga (2026-09-22)', () => {
  let app, db, server;
  let dono, donoTok, leitor, leitorTok, cred, credTok;
  const abertos = [];
  let TILE_PUB, TILE_PRIV;
  let projetoPub, projetoPriv;
  const FOTO_PUB = `REC_PUB_${randomUUID().slice(0, 6)}.jpg`;
  const FOTO_PRIV = `REC_PRIV_${randomUUID().slice(0, 6)}.jpg`;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));

    dono = await createUser(db, { username: U() });
    leitor = await createUser(db, { username: U() });
    cred = await createUser(db, { username: U(), role: 'credenciado' });
    donoTok = await loginUser(app, dono.username, dono.password);
    leitorTok = await loginUser(app, leitor.username, leitor.password);
    credTok = await loginUser(app, cred.username, cred.password);

    TILE_PUB = `rec-pub-${randomUUID().slice(0, 8)}`;
    TILE_PRIV = `rec-priv-${randomUUID().slice(0, 8)}`;
    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, 'Modelo aberto', '{}'::jsonb, 910, 'public'),
              ($2, 'Modelo reservado', '{}'::jsonb, 911, 'private')`,
      [TILE_PUB, TILE_PRIV],
    );
    projetoPub = await seedPublic360Photos(db, [FOTO_PUB]);
    projetoPriv = await seedPublic360Photos(db, [FOTO_PRIV]);
    await db.query("UPDATE sv360.projects SET access_level = 'private' WHERE id = $1", [projetoPriv.projectId]);
  });

  beforeEach(() => {
    // O memo de 30 s é por (principal, atlas, recurso): sem limpar, a resposta de um caso valeria
    // no seguinte, e o caso do empréstimo mediria o memo em vez do predicado.
    limparMemosDePresenca();
  });

  after(async () => {
    for (const c of abertos) { try { c.close(); } catch { /* already closed */ } }
    await new Promise((resolve) => server.close(resolve));
    await dropCatalogRefs(db, { tilesets: [TILE_PUB, TILE_PRIV] });
    await drop360Fixture(db, projetoPub);
    await drop360Fixture(db, projetoPriv);
    await teardownTestEnv(db);
  });

  /** Um atlas por caso: a sala vive em memória, e um socket de um caso anterior pode seguir nela. */
  async function atlasDe(dono_, ...leitores) {
    const atlas = await createAtlas(db, dono_.id, { name: `Atlas ${U()}` });
    const map = await createMap(db, atlas.id);
    for (const l of leitores) await createShare(db, atlas.id, l.id, 'read', dono_.id);
    return { atlas, map };
  }

  async function conectar(atlasId, token) {
    const cid = `c-${randomUUID().slice(0, 8)}`;
    const c = await createWsClient(server, atlasId, token, cid);
    abertos.push(c);
    const conectado = await c.waitForType('connected');
    return { c, cid, conectado };
  }

  /** A primeira seleção de um remetente. */
  async function esperarSelecao(cliente, clientId, timeoutMs = 4000) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeoutMs) {
      const achada = cliente.messages.find((m) => m.type === 'selection' && m.clientId === clientId);
      if (achada) return achada;
      await sleep(20);
    }
    throw new Error(`seleção de ${clientId} não chegou`);
  }

  it('escopo PÚBLICO: o cursor 3D chega inteiro a todos', async () => {
    const { atlas, map } = await atlasDe(dono, leitor);
    const emissor = await conectar(atlas.id, donoTok);
    const receptor = await conectar(atlas.id, leitorTok);

    emissor.c.send({ type: 'cursor', surface: '3d', position: PONTO, mapId: map.name, tilesetId: TILE_PUB });
    const q = await receptor.c.waitForCursor({ doClientId: emissor.cid });
    assert.equal(q.tilesetId, TILE_PUB);
    assert.deepEqual(q.position, PONTO);
  });

  it('escopo PRIVADO: o cursor 3D chega inteiro ao credenciado e sem escopo nem posição ao leitor', async () => {
    const { atlas, map } = await atlasDe(dono, leitor, cred);
    const emissor = await conectar(atlas.id, donoTok);
    const semAcesso = await conectar(atlas.id, leitorTok);
    const comAcesso = await conectar(atlas.id, credTok);

    emissor.c.send({ type: 'cursor', surface: '3d', position: PONTO, mapId: map.name, tilesetId: TILE_PRIV });

    const positivo = await comAcesso.c.waitForCursor({ doClientId: emissor.cid });
    assert.equal(positivo.tilesetId, TILE_PRIV);
    assert.deepEqual(positivo.position, PONTO);

    const negativo = await semAcesso.c.waitForCursor({ doClientId: emissor.cid });
    assert.equal(negativo.surface, '3d');
    assert.equal(negativo.mapId, map.name, 'o mapa continua viajando: é conteúdo do atlas');
    assert.equal(negativo.tilesetId, null);
    assert.equal(negativo.position, null);
    const cru = JSON.stringify(semAcesso.c.messages);
    assert.equal(cru.includes(TILE_PRIV), false, 'o id do modelo privado chegou a quem não o enxerga');
    assert.equal(cru.includes(String(PONTO.lng)), false, 'a coordenada dentro do modelo privado chegou a quem não o enxerga');
  });

  it('escopo PRIVADO: a seleção 3D chega inteira ao credenciado e VAZIA ao leitor', async () => {
    const { atlas, map } = await atlasDe(dono, leitor, cred);
    const emissor = await conectar(atlas.id, donoTok);
    const semAcesso = await conectar(atlas.id, leitorTok);
    const comAcesso = await conectar(atlas.id, credTok);
    const marcador = randomUUID();

    emissor.c.send({ type: 'selection', surface: '3d', featureIds: [marcador], mapId: map.name, tilesetId: TILE_PRIV });

    const positivo = await esperarSelecao(comAcesso.c, emissor.cid);
    assert.equal(positivo.tilesetId, TILE_PRIV);
    assert.deepEqual(positivo.featureIds, [marcador]);

    const negativo = await esperarSelecao(semAcesso.c, emissor.cid);
    assert.equal(negativo.surface, '3d');
    assert.deepEqual(negativo.featureIds, []);
    assert.equal('tilesetId' in negativo, false);
    const cru = JSON.stringify(negativo);
    assert.equal(cru.includes(TILE_PRIV), false);
    assert.equal(cru.includes(marcador), false, 'o marcador dentro do modelo privado chegou a quem não o enxerga');
  });

  it('escopo PRIVADO no 360: o cursor da foto de projeto privado chega redigido a quem não o enxerga', async () => {
    const { atlas, map } = await atlasDe(dono, leitor, cred);
    const emissor = await conectar(atlas.id, donoTok);
    const semAcesso = await conectar(atlas.id, leitorTok);
    const comAcesso = await conectar(atlas.id, credTok);

    emissor.c.send({ type: 'cursor', surface: '360', position: { heading: 187.531, pitch: -0.2137 }, mapId: map.name, photoName: FOTO_PRIV });
    const positivo = await comAcesso.c.waitForCursor({ doClientId: emissor.cid });
    assert.equal(positivo.photoName, FOTO_PRIV);
    const negativo = await semAcesso.c.waitForCursor({ doClientId: emissor.cid });
    assert.equal(negativo.surface, '360');
    assert.equal(negativo.photoName, null);
    assert.equal(negativo.position, null);

    // PISO do 360: a foto de projeto PÚBLICO chega inteira ao mesmo leitor.
    semAcesso.c.messages.length = 0;
    emissor.c.send({ type: 'cursor', surface: '360', position: { heading: 10, pitch: 0 }, mapId: map.name, photoName: FOTO_PUB });
    const publico = await semAcesso.c.waitForCursor({ doClientId: emissor.cid });
    assert.equal(publico.photoName, FOTO_PUB);
  });

  it('o EMPRÉSTIMO do atlas conta: o leitor passa a receber o escopo do privado emprestado', async () => {
    // O dono do atlas é o credenciado, que alcança o privado e pode emprestá-lo.
    const { atlas, map } = await atlasDe(cred, leitor);
    const emissor = await conectar(atlas.id, credTok);
    const receptor = await conectar(atlas.id, leitorTok);

    emissor.c.send({ type: 'cursor', surface: '3d', position: PONTO, mapId: map.name, tilesetId: TILE_PRIV });
    const antes = await receptor.c.waitForCursor({ doClientId: emissor.cid });
    assert.equal(antes.tilesetId, null, 'sem empréstimo, o leitor não recebe o escopo privado');

    await db.query(
      `INSERT INTO atlas_resources (atlas_id, resource_type, resource_id, added_by)
       VALUES ($1, 'tileset', $2, $3)`,
      [atlas.id, TILE_PRIV, cred.id],
    );
    limparMemosDePresenca();
    receptor.c.messages.length = 0;

    emissor.c.send({ type: 'cursor', surface: '3d', position: PONTO, mapId: map.name, tilesetId: TILE_PRIV });
    const depois = await receptor.c.waitForCursor({ doClientId: emissor.cid });
    assert.equal(depois.tilesetId, TILE_PRIV, 'o atlas empresta e o leitor recebe o escopo');
    assert.deepEqual(depois.position, PONTO);
  });

  it('o VISITANTE recebe o público e não o privado, e o cursor dele continua sem posição', async () => {
    const { atlas, map } = await atlasDe(dono);
    const link = await makeAtlasPublic(db, atlas.id);
    const tokVisitante = await getPublicToken(app, link);
    const colega = await conectar(atlas.id, donoTok);
    const visitante = await conectar(atlas.id, tokVisitante);

    colega.c.send({ type: 'cursor', surface: '3d', position: PONTO, mapId: map.name, tilesetId: TILE_PRIV });
    const privado = await visitante.c.waitForCursor({ doClientId: colega.cid });
    assert.equal(privado.tilesetId, null);
    assert.equal(privado.position, null);

    visitante.c.messages.length = 0;
    colega.c.send({ type: 'cursor', surface: '3d', position: PONTO, mapId: map.name, tilesetId: TILE_PUB });
    const publico = await visitante.c.waitForCursor({ doClientId: colega.cid });
    assert.equal(publico.tilesetId, TILE_PUB);
    assert.deepEqual(publico.position, PONTO);

    // A regra vigente do visitante: o quadro dele sai, sem posição.
    visitante.c.send({ type: 'cursor', surface: '3d', position: PONTO, mapId: map.name, tilesetId: TILE_PUB });
    const doVisitante = await colega.c.waitForCursor({ doClientId: visitante.cid });
    assert.equal(doVisitante.position, null);
  });

  it('o retrato de entrada leva o escopo privado redigido, e quem o enxerga recebe cursor e seleção à parte', async () => {
    const { atlas, map } = await atlasDe(dono, leitor, cred);
    const emissor = await conectar(atlas.id, donoTok);
    const marcador = randomUUID();
    emissor.c.send({ type: 'cursor', surface: '3d', position: PONTO, mapId: map.name, tilesetId: TILE_PRIV });
    emissor.c.send({ type: 'selection', surface: '3d', featureIds: [marcador], mapId: map.name, tilesetId: TILE_PRIV });
    // Assenta os dois quadros (o socket processa em série) antes de alguém entrar.
    emissor.c.send({ type: 'ping' });
    await emissor.c.waitForType('pong');

    const semAcesso = await conectar(atlas.id, leitorTok);
    const entradaSem = semAcesso.conectado.usersOnline.find((u) => u.clientId === emissor.cid);
    assert.ok(entradaSem, 'o emissor precisa estar no retrato, senão as asserções somem');
    assert.equal(entradaSem.cursorPosition, null);
    assert.equal(entradaSem.cursorContext?.surface, '3d');
    assert.equal(entradaSem.cursorContext?.tilesetId, null);
    assert.deepEqual(entradaSem.selectedFeatures, []);
    assert.deepEqual(entradaSem.selectionContext?.featureIds, []);
    assert.equal(JSON.stringify(semAcesso.conectado).includes(TILE_PRIV), false);

    const comAcesso = await conectar(atlas.id, credTok);
    const entradaCom = comAcesso.conectado.usersOnline.find((u) => u.clientId === emissor.cid);
    assert.equal(entradaCom.cursorContext?.tilesetId, null, 'o retrato é o MESMO para todos');
    const cursor = await comAcesso.c.waitForCursor({ doClientId: emissor.cid });
    assert.equal(cursor.tilesetId, TILE_PRIV);
    assert.deepEqual(cursor.position, PONTO);
    const selecao = await esperarSelecao(comAcesso.c, emissor.cid);
    assert.deepEqual(selecao.featureIds, [marcador]);

    // E o sem acesso não recebe complemento nenhum.
    await sleep(400);
    assert.equal(JSON.stringify(semAcesso.c.messages).includes(TILE_PRIV), false);
  });

  it('identificador que NÃO RESOLVE é privado para todos, o credenciado inclusive', async () => {
    const { atlas, map } = await atlasDe(dono, leitor, cred);
    const emissor = await conectar(atlas.id, donoTok);
    const leitorC = await conectar(atlas.id, leitorTok);
    const credC = await conectar(atlas.id, credTok);
    const inventado = `nao-existe-${randomUUID().slice(0, 8)}`;

    emissor.c.send({ type: 'cursor', surface: '3d', position: PONTO, mapId: map.name, tilesetId: inventado });
    for (const receptor of [leitorC, credC]) {
      const q = await receptor.c.waitForCursor({ doClientId: emissor.cid });
      assert.equal(q.tilesetId, null);
      assert.equal(q.position, null);
    }
  });

  it('o caminho SEM lote (WS_CURSOR_BATCH_MS=0) recorta pela mesma regra', async () => {
    const anterior = process.env.WS_CURSOR_BATCH_MS;
    process.env.WS_CURSOR_BATCH_MS = '0';
    try {
      const { atlas, map } = await atlasDe(dono, leitor, cred);
      const emissor = await conectar(atlas.id, donoTok);
      const semAcesso = await conectar(atlas.id, leitorTok);
      const comAcesso = await conectar(atlas.id, credTok);

      emissor.c.send({ type: 'cursor', surface: '3d', position: PONTO, mapId: map.name, tilesetId: TILE_PRIV });
      const positivo = await comAcesso.c.waitForType('cursor');
      assert.equal(positivo.tilesetId, TILE_PRIV);
      const negativo = await semAcesso.c.waitForType('cursor');
      assert.equal(negativo.tilesetId, null);
      assert.equal(negativo.position, null);
      // O remetente continua fora do leque no quadro singular.
      await sleep(200);
      assert.equal(emissor.c.messages.filter((m) => m.type === 'cursor').length, 0);
    } finally {
      if (anterior === undefined) delete process.env.WS_CURSOR_BATCH_MS;
      else process.env.WS_CURSOR_BATCH_MS = anterior;
    }
  });
});
