// Path: tests/ws/presenca-contexto-do-visualizador.test.js
//
// O CONTEXTO DE VISUALIZADOR DA PRESENÇA (pedido do dono, 2026-09-22): a lista de quem está online
// passa a dizer em qual modelo 3D, cena caminhável ou foto 360 cada colega está.
//
// O QUE ESTE ARQUIVO PRENDE, e a ordem é a de importância:
//
//   1. O NOME DE UM RECURSO PRIVADO SÓ CHEGA A QUEM O ENXERGA. Cada caso negativo tem o PAR
//      positivo no mesmo quadro (a regra da casa para filtro de acesso): o leitor sem concessão
//      recebe a superfície sem o recurso, e o credenciado, que lê todo recurso privado, recebe o
//      nome. O negativo sozinho passaria idêntico se o nome nunca fosse resolvido.
//   2. O EMPRÉSTIMO DO ATLAS CONTA: o mesmo leitor passa a ler o nome quando o atlas empresta o
//      recurso. É a cláusula 6.3 da CONSTITUICAO.md vista pela presença.
//   3. O RETRATO DE ENTRADA leva só a projeção que todo membro pode ler, e o recém-chegado que
//      enxerga o privado recebe o nome num quadro à parte.
//   4. O VISITANTE DE LINK PÚBLICO não é acompanhado: o contexto dele não viaja nem fica retido.
//      Como receptor, ele lê o público.
//   5. Fechar o visualizador (`2d`) apaga o contexto no par; o 360 chega com projeto e foto.

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

const U = () => `vis_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JANELA_MS = 400;

/** Espera o quadro `viewer_context` de um remetente que satisfaça o predicado. */
async function esperarViewer(cliente, clientId, predicado = () => true, timeoutMs = 4000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const achado = cliente.messages.find(
      (m) => m.type === 'viewer_context' && m.clientId === clientId && predicado(m),
    );
    if (achado) return achado;
    await sleep(20);
  }
  throw new Error(`quadro viewer de ${clientId} não chegou`);
}

describe('presença: em qual visualizador cada colega está (dono, 2026-09-22)', () => {
  let app, db, server;
  let dono, donoTok, leitor, leitorTok, cred, credTok;
  const abertos = [];
  const tilesets = [];
  let projeto360;
  let TILE_PUB, TILE_PRIV;
  const FOTO = `FOTO_${randomUUID().slice(0, 6)}.jpg`;

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

    TILE_PUB = `vis-pub-${randomUUID().slice(0, 8)}`;
    TILE_PRIV = `vis-priv-${randomUUID().slice(0, 8)}`;
    tilesets.push(TILE_PUB, TILE_PRIV);
    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, 'Modelo Público', '{}'::jsonb, 900, 'public'),
              ($2, 'Modelo Secreto', '{}'::jsonb, 901, 'private')`,
      [TILE_PUB, TILE_PRIV],
    );
    projeto360 = await seedPublic360Photos(db, [FOTO]);
  });

  beforeEach(() => {
    // O memo de 30 s é por (principal, atlas, recurso): sem limpar, a resposta de um caso
    // valeria no seguinte, e o caso do empréstimo mediria o memo em vez do predicado.
    limparMemosDePresenca();
  });

  after(async () => {
    for (const c of abertos) { try { c.close(); } catch { /* already closed */ } }
    await new Promise((resolve) => server.close(resolve));
    await dropCatalogRefs(db, { tilesets });
    await drop360Fixture(db, projeto360);
    await teardownTestEnv(db);
  });

  async function atlasDe(dono_, ...leitores) {
    const atlas = await createAtlas(db, dono_.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);
    for (const l of leitores) await createShare(db, atlas.id, l.id, 'read', dono_.id);
    return atlas;
  }

  async function conectar(atlasId, token) {
    const cid = `c-${randomUUID().slice(0, 8)}`;
    const c = await createWsClient(server, atlasId, token, cid);
    abertos.push(c);
    const conectado = await c.waitForType('connected');
    return { c, cid, conectado };
  }

  it('recurso PÚBLICO: todo colega lê o nome do modelo aberto', async () => {
    const atlas = await atlasDe(dono, leitor);
    const emissor = await conectar(atlas.id, donoTok);
    const receptor = await conectar(atlas.id, leitorTok);

    emissor.c.send({ type: 'viewer_context', surface: '3d', tilesetId: TILE_PUB });
    const q = await esperarViewer(receptor.c, emissor.cid);
    assert.equal(q.userId, dono.id);
    assert.deepEqual(q.viewer, {
      surface: '3d',
      recurso: { tipo: 'tileset', id: TILE_PUB, nome: 'Modelo Público', foto: null },
    });
  });

  it('recurso PRIVADO: quem não o enxerga recebe a superfície sem o recurso, e o credenciado recebe o nome', async () => {
    const atlas = await atlasDe(dono, leitor, cred);
    const emissor = await conectar(atlas.id, donoTok);
    const semAcesso = await conectar(atlas.id, leitorTok);
    const comAcesso = await conectar(atlas.id, credTok);

    emissor.c.send({ type: 'viewer_context', surface: '3d', tilesetId: TILE_PRIV });

    const positivo = await esperarViewer(comAcesso.c, emissor.cid);
    assert.deepEqual(positivo.viewer, {
      surface: '3d',
      recurso: { tipo: 'tileset', id: TILE_PRIV, nome: 'Modelo Secreto', foto: null },
    });

    const negativo = await esperarViewer(semAcesso.c, emissor.cid);
    assert.deepEqual(negativo.viewer, { surface: '3d', recurso: null });
    // Nem o id nem o nome em lugar nenhum do quadro, sob outra chave que seja.
    const cru = JSON.stringify(negativo);
    assert.equal(cru.includes(TILE_PRIV), false, 'o id do recurso privado chegou a quem não o enxerga');
    assert.equal(cru.includes('Modelo Secreto'), false, 'o nome do recurso privado chegou a quem não o enxerga');
  });

  it('o EMPRÉSTIMO do atlas conta: o mesmo leitor passa a ler o nome do privado emprestado', async () => {
    // O dono do atlas é o credenciado: é ele que alcança o privado e pode emprestá-lo.
    const atlas = await atlasDe(cred, leitor);
    const emissor = await conectar(atlas.id, credTok);
    const receptor = await conectar(atlas.id, leitorTok);

    emissor.c.send({ type: 'viewer_context', surface: '3d', tilesetId: TILE_PRIV });
    const antes = await esperarViewer(receptor.c, emissor.cid);
    assert.equal(antes.viewer.recurso, null, 'sem empréstimo, o leitor não lê o privado');

    await db.query(
      `INSERT INTO atlas_resources (atlas_id, resource_type, resource_id, added_by)
       VALUES ($1, 'tileset', $2, $3)`,
      [atlas.id, TILE_PRIV, cred.id],
    );
    limparMemosDePresenca();
    receptor.c.messages.length = 0;

    emissor.c.send({ type: 'viewer_context', surface: '3d', tilesetId: TILE_PRIV });
    const depois = await esperarViewer(receptor.c, emissor.cid);
    assert.equal(depois.viewer.recurso?.nome, 'Modelo Secreto', 'o atlas empresta e o leitor lê o nome');
  });

  it('o retrato de entrada leva só o que todos leem, e o recém-chegado que enxerga recebe o nome à parte', async () => {
    const atlas = await atlasDe(dono, leitor, cred);
    const emissor = await conectar(atlas.id, donoTok);
    emissor.c.send({ type: 'viewer_context', surface: '3d', tilesetId: TILE_PRIV });
    // Assenta o quadro no socket do emissor antes de alguém entrar.
    await sleep(JANELA_MS);

    const semAcesso = await conectar(atlas.id, leitorTok);
    const entradaSem = semAcesso.conectado.usersOnline.find((u) => u.clientId === emissor.cid);
    assert.ok(entradaSem, 'o emissor precisa estar no retrato, senão as asserções abaixo somem');
    assert.deepEqual(entradaSem.viewer, { surface: '3d', recurso: null });

    const comAcesso = await conectar(atlas.id, credTok);
    const entradaCom = comAcesso.conectado.usersOnline.find((u) => u.clientId === emissor.cid);
    assert.deepEqual(entradaCom.viewer, { surface: '3d', recurso: null }, 'o retrato é o MESMO para todos');
    const complemento = await esperarViewer(comAcesso.c, emissor.cid);
    assert.equal(complemento.viewer.recurso?.nome, 'Modelo Secreto');

    // E o sem acesso não recebe complemento nenhum.
    await sleep(JANELA_MS);
    assert.equal(
      semAcesso.c.messages.filter((m) => m.type === 'viewer_context' && m.clientId === emissor.cid).length, 0,
      'o complemento do privado foi a quem não o enxerga',
    );
  });

  it('o 360 chega com projeto e foto, e fechar o visualizador apaga o contexto no par', async () => {
    const atlas = await atlasDe(dono, leitor);
    const emissor = await conectar(atlas.id, donoTok);
    const receptor = await conectar(atlas.id, leitorTok);

    emissor.c.send({ type: 'viewer_context', surface: '360', photoName: FOTO });
    const aberto = await esperarViewer(receptor.c, emissor.cid);
    assert.equal(aberto.viewer.surface, '360');
    assert.equal(aberto.viewer.recurso?.tipo, 'sv360_project');
    assert.equal(aberto.viewer.recurso?.id, projeto360.projectId);
    assert.match(aberto.viewer.recurso?.nome ?? '', /^Projeto fixture /);
    assert.equal(aberto.viewer.recurso?.foto, FOTO);

    emissor.c.send({ type: 'viewer_context', surface: '2d' });
    const fechado = await esperarViewer(receptor.c, emissor.cid, (m) => m.viewer === null);
    assert.equal(fechado.viewer, null);

    // E o retrato de quem entra depois diz "no mapa".
    const tardio = await conectar(atlas.id, leitorTok);
    const entrada = tardio.conectado.usersOnline.find((u) => u.clientId === emissor.cid);
    assert.equal(entrada.viewer, null);
  });

  it('o VISITANTE de link público não é acompanhado: o contexto dele não viaja nem fica retido', async () => {
    const atlas = await atlasDe(dono);
    const link = await makeAtlasPublic(db, atlas.id);
    const tokVisitante = await getPublicToken(app, link);
    const colega = await conectar(atlas.id, donoTok);
    const visitante = await conectar(atlas.id, tokVisitante);

    visitante.c.send({ type: 'viewer_context', surface: '3d', tilesetId: TILE_PUB });
    await sleep(JANELA_MS);
    assert.equal(
      colega.c.messages.filter((m) => m.type === 'viewer_context' && m.clientId === visitante.cid).length, 0,
      'o contexto do visitante viajou',
    );
    const tardio = await conectar(atlas.id, donoTok);
    const entrada = tardio.conectado.usersOnline.find((u) => u.clientId === visitante.cid);
    assert.ok(entrada, 'o visitante continua CONTADO no retrato');
    assert.equal(entrada.viewer, null, 'o contexto do visitante ficou retido no socket');

    // PISO: o visitante RECEBE o contexto público de quem trabalha, e o privado chega sem recurso.
    colega.c.send({ type: 'viewer_context', surface: '3d', tilesetId: TILE_PUB });
    const publico = await esperarViewer(visitante.c, colega.cid);
    assert.equal(publico.viewer.recurso?.nome, 'Modelo Público');
    colega.c.send({ type: 'viewer_context', surface: '3d', tilesetId: TILE_PRIV });
    const privado = await esperarViewer(visitante.c, colega.cid, (m) => m.viewer?.recurso === null);
    assert.equal(JSON.stringify(privado).includes(TILE_PRIV), false);
  });

  it('um identificador que não resolve viaja como superfície sem recurso, e quadro malformado é recusado', async () => {
    const atlas = await atlasDe(dono, leitor);
    const emissor = await conectar(atlas.id, donoTok);
    const receptor = await conectar(atlas.id, leitorTok);

    emissor.c.send({ type: 'viewer_context', surface: '3d', tilesetId: 'nao-existe-nenhum' });
    const q = await esperarViewer(receptor.c, emissor.cid);
    assert.deepEqual(q.viewer, { surface: '3d', recurso: null });

    emissor.c.send({ type: 'viewer_context', surface: 'teleporte' });
    const erro = await emissor.c.waitForType('error');
    assert.equal(erro.code, 'VALIDATION_ERROR');
  });
});
