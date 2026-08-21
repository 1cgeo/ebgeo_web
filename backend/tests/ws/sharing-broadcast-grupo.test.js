// Path: tests/ws/sharing-broadcast-grupo.test.js
//
// A FRAME DE COMPARTILHAMENTO POR GRUPO, e o defeito que ela existe para não cometer.
//
// `sync-engine.js` (`sharingUpdated`) aplica `sessionContext.updateRole(msg.role)` CRU. Uma
// frame única carregando o nível do GRUPO rebaixaria no cliente quem tem share direto MAIOR:
// X com `manage` direto, num atlas que passa a receber um grupo `read`, veria a barra de
// ferramentas sumir sem motivo — e voltar no F5, porque o SERVIDOR nunca rebaixou nada.
// Irreproduzível para quem reporta, invisível para quem investiga.
//
// CONTROLE NEGATIVO MEDIDO (2026-08-21), e o número corrige a expectativa do plano, que dizia
// "um caso e nenhum outro": substituir `effectiveRolesFor` pelo nível do VÍNCULO deixa **três**
// dos cinco casos deste arquivo vermelhos (o do `manage` direto, o do `user_removed` e o do
// rebaixamento) e ZERO casos vermelhos em qualquer outro arquivo do lote — inclusive
// `sharing-broadcast-updates.test.js`, o eixo de pessoa, que fica verde. É essa segunda metade
// que mede o buraco: sem este arquivo, o risco não tinha guarda nenhuma.
//
// A SEGUNDA METADE É A AUDIÊNCIA. A frame de COMPOSIÇÃO (`group_added` e irmãs) nomeia o
// grupo e o nível, que é informação de gestão pela mesma razão que a lista de membros é: diz
// quem alcança o atlas. Ela vai só para `manage` e acima — e os níveis abaixo afirmam
// SILÊNCIO, colados ao positivo do mesmo disparo, porque "ninguém abaixo de manage recebe"
// também passaria com o broadcast apagado.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createShare, loginUser, makeAtlasPublic,
  createAccessGroup, addAccessGroupMember, createGroupShare,
} from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket } from '../../src/modules/collab/collab.gateway.js';

const U = () => `sbg_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JANELA_SILENCIO_MS = 500;

describe('broadcast `sharing_updated` — o eixo de GRUPO', () => {
  let app, db, server, dono, donoTok;
  let abertos = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));

    dono = await createUser(db, { username: U() });
    donoTok = await loginUser(app, dono.username, dono.password);
  });

  afterEach(() => {
    for (const c of abertos) c.close();
    abertos = [];
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  async function conectar(atlasId, token) {
    const c = await createWsClient(server, atlasId, token);
    await c.waitForType('connected');
    c.clearMessages();
    abertos.push(c);
    return c;
  }

  const comoDono = (metodo, url) =>
    supertest(app)[metodo](url).set('Authorization', `Bearer ${donoTok}`);

  /** A frame `user_updated`/`user_removed` que NOMEIA esta pessoa, depois da janela. */
  async function frameSobre(par, userId) {
    await sleep(JANELA_SILENCIO_MS);
    return par.getMessagesOfType('sharing_updated').find((m) => m.userId === userId) ?? null;
  }

  // ==========================================================================
  // RISCO 5.3: a frame carrega a permissão EFETIVA, nunca o nível do vínculo.
  // ==========================================================================

  it('X tem manage DIRETO; o atlas recebe um grupo read — a frame que chega a X traz manage', async () => {
    const x = await createUser(db, { username: U() });
    const xTok = await loginUser(app, x.username, x.password);
    const atlas = await createAtlas(db, dono.id, { name: `5.3 ${U()}` });
    await createMap(db, atlas.id);
    await createShare(db, atlas.id, x.id, 'manage', dono.id);

    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, x.id, dono.id);

    const parX = await conectar(atlas.id, xTok);

    await comoDono('post', `/api/v1/atlas/${atlas.id}/sharing/groups`)
      .send({ groupId: g.id, permission: 'read' })
      .expect(201);

    const frame = await frameSobre(parX, x.id);
    assert.ok(frame, 'X está na sala e é membro do grupo tocado: precisa receber a frame');
    assert.equal(frame.action, 'user_updated');
    assert.equal(frame.permission, 'manage', 'a permissão EFETIVA, não o nível do grupo');
    assert.equal(frame.role, 'manager', 'e o papel de tela que sai dela');

    // DISCRIMINAÇÃO: o banco concorda. Sem isto, um servidor que tivesse de fato rebaixado
    // X passaria neste caso se a frame também mentisse na mesma direção.
    const { rows } = await db.query(
      'SELECT permission FROM fn_user_atlas_shares($1::uuid, $2::uuid)', [x.id, atlas.id]
    );
    assert.equal(rows[0].permission, 'manage');
  });

  it('Y só alcança pelo grupo — a frame traz o nível do grupo, que aqui É o efetivo', async () => {
    // O CONTROLE do caso acima: se a frame carregasse SEMPRE `manage`, ou sempre o efetivo
    // de outra pessoa, este caso ficaria vermelho. Os dois juntos separam "usa o efetivo" de
    // "carimba um valor fixo".
    const y = await createUser(db, { username: U() });
    const yTok = await loginUser(app, y.username, y.password);
    const atlas = await createAtlas(db, dono.id, { name: `5.3b ${U()}` });
    await createMap(db, atlas.id);

    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, y.id, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'read', dono.id);

    const parY = await conectar(atlas.id, yTok);

    await comoDono('put', `/api/v1/atlas/${atlas.id}/sharing/groups/${g.id}`)
      .send({ permission: 'write' })
      .expect(200);

    const frame = await frameSobre(parY, y.id);
    assert.ok(frame, 'o membro conectado recebe a frame que o nomeia');
    assert.equal(frame.permission, 'write');
    assert.equal(frame.role, 'editor');
  });

  it('tirar o grupo do atlas manda user_removed a quem perdeu TODO caminho', async () => {
    const y = await createUser(db, { username: U() });
    const yTok = await loginUser(app, y.username, y.password);
    const atlas = await createAtlas(db, dono.id, { name: `5.3c ${U()}` });
    await createMap(db, atlas.id);

    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, y.id, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'write', dono.id);

    const parY = await conectar(atlas.id, yTok);

    await comoDono('delete', `/api/v1/atlas/${atlas.id}/sharing/groups/${g.id}`).expect(204);

    const frame = await frameSobre(parY, y.id);
    assert.ok(frame, 'quem perdeu o acesso precisa saber');
    assert.equal(frame.action, 'user_removed');
    assert.equal(frame.permission, undefined, 'sem nível: não há mais nível nenhum');
  });

  it('quem MANTÉM um caminho direto recebe user_updated com o que sobrou, não user_removed', async () => {
    const z = await createUser(db, { username: U() });
    const zTok = await loginUser(app, z.username, z.password);
    const atlas = await createAtlas(db, dono.id, { name: `5.3d ${U()}` });
    await createMap(db, atlas.id);
    await createShare(db, atlas.id, z.id, 'comment', dono.id);

    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, z.id, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'manage', dono.id);

    const parZ = await conectar(atlas.id, zTok);

    await comoDono('delete', `/api/v1/atlas/${atlas.id}/sharing/groups/${g.id}`).expect(204);

    const frame = await frameSobre(parZ, z.id);
    assert.ok(frame);
    assert.equal(frame.action, 'user_updated', 'rebaixou, não perdeu');
    assert.equal(frame.permission, 'comment');
    assert.equal(frame.role, 'commenter');
  });

  // ==========================================================================
  // RISCO 5.3, A METADE ESPELHADA: mexer no eixo de PESSOA de quem também alcança por
  // grupo. O eixo de grupo nasceu com `effectiveRolesFor`; o de pessoa continuou
  // anunciando `req.body.permission`, e a diferença só aparece quando os dois caminhos
  // existem ao mesmo tempo — que é o estado que esta onda criou.
  // ==========================================================================

  it('remover a PESSOA de quem também alcança por grupo manda o que SOBROU, não user_removed', async () => {
    // MEDIDO ANTES DO CONSERTO: o gestor clicava "remover", recebia 204, a pessoa sumia da
    // seção Membros e continuava co-Gestora — `fn_user_atlas_shares` devolvia `manage` pelo
    // grupo. A frame dizia `user_removed`, que é uma remoção que o servidor não fez.
    const x = await createUser(db, { username: U() });
    const xTok = await loginUser(app, x.username, x.password);
    const so = await createUser(db, { username: U() });
    const soTok = await loginUser(app, so.username, so.password);
    const atlas = await createAtlas(db, dono.id, { name: `5.3e ${U()}` });
    await createMap(db, atlas.id);

    await createShare(db, atlas.id, x.id, 'read', dono.id);
    await createShare(db, atlas.id, so.id, 'read', dono.id);
    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, x.id, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'manage', dono.id);

    const parX = await conectar(atlas.id, xTok);
    const parSo = await conectar(atlas.id, soTok);

    await comoDono('delete', `/api/v1/atlas/${atlas.id}/sharing/users/${x.id}`).expect(204);

    const frameX = await frameSobre(parX, x.id);
    assert.ok(frameX, 'X está na sala e foi o afetado');
    assert.equal(frameX.action, 'user_updated', 'sobrou caminho: não foi remoção');
    assert.equal(frameX.permission, 'manage', 'o que o grupo continua dando');
    assert.equal(frameX.role, 'manager');

    // O BANCO CONCORDA. Sem esta linha, um servidor que tivesse de fato mantido o acesso
    // por engano passaria igual — e é justamente o acesso mantido que a frame precisa
    // anunciar.
    const { rows } = await db.query(
      'SELECT permission FROM fn_user_atlas_shares($1::uuid, $2::uuid)', [x.id, atlas.id]
    );
    assert.equal(rows[0].permission, 'manage');

    // DISCRIMINAÇÃO, MESMO DISPARO NÃO, MESMA RODADA: quem tinha SÓ o share direto continua
    // recebendo `user_removed`. Sem esta metade, um servidor que nunca mais emitisse
    // `user_removed` passaria acima.
    await comoDono('delete', `/api/v1/atlas/${atlas.id}/sharing/users/${so.id}`).expect(204);
    const frameSo = await frameSobre(parSo, so.id);
    assert.ok(frameSo);
    assert.equal(frameSo.action, 'user_removed');
    assert.equal(frameSo.permission, undefined);
  });

  it('rebaixar o share DIRETO não rebaixa na tela quem tem grupo maior', async () => {
    const x = await createUser(db, { username: U() });
    const xTok = await loginUser(app, x.username, x.password);
    const atlas = await createAtlas(db, dono.id, { name: `5.3f ${U()}` });
    await createMap(db, atlas.id);

    await createShare(db, atlas.id, x.id, 'write', dono.id);
    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, x.id, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'manage', dono.id);

    const parX = await conectar(atlas.id, xTok);

    await comoDono('put', `/api/v1/atlas/${atlas.id}/sharing/users/${x.id}`)
      .send({ permission: 'read' })
      .expect(200);

    const frame = await frameSobre(parX, x.id);
    assert.ok(frame);
    assert.equal(frame.permission, 'manage', 'o EFETIVO, não o vínculo que mudou');
    assert.equal(frame.role, 'manager');
  });

  it('num atlas PÚBLICO, perder o grupo rebaixa para leitura — não remove', async () => {
    // O TERCEIRO RAMO DE `resolvePermission` FALTAVA em `EFFECTIVE_PERMISSIONS`, e o efeito
    // é a frame mentindo na direção oposta: num atlas publicado todo autenticado lê, então
    // tirar o único share de alguém NÃO o remove. Medido: `effectiveRolesFor` devolvia
    // `null` para quem os dois gates continuavam deixando entrar como leitor.
    const y = await createUser(db, { username: U() });
    const yTok = await loginUser(app, y.username, y.password);
    const atlas = await createAtlas(db, dono.id, { name: `5.3g ${U()}` });
    await createMap(db, atlas.id);
    await makeAtlasPublic(db, atlas.id);

    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, y.id, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'write', dono.id);

    const parY = await conectar(atlas.id, yTok);

    await comoDono('delete', `/api/v1/atlas/${atlas.id}/sharing/groups/${g.id}`).expect(204);

    const frame = await frameSobre(parY, y.id);
    assert.ok(frame);
    assert.equal(frame.action, 'user_updated', 'o link público continua entregando leitura');
    assert.equal(frame.permission, 'read');
    assert.equal(frame.role, 'viewer');

    // DISCRIMINAÇÃO: o MESMO ato num atlas NÃO público continua produzindo `user_removed`
    // (o caso `5.3c` acima), e este par é o que separa "sabe ler `is_public`" de
    // "nunca mais remove ninguém".
  });

  // ==========================================================================
  // A audiência da frame de COMPOSIÇÃO.
  // ==========================================================================

  it('a frame de composição vai ao co-Gestor e ao dono, e NÃO a read/comment/write', async () => {
    const atlas = await createAtlas(db, dono.id, { name: `audiencia ${U()}` });
    await createMap(db, atlas.id);

    const pares = {};
    for (const nivel of ['read', 'comment', 'write', 'manage']) {
      const u = await createUser(db, { username: U() });
      const tok = await loginUser(app, u.username, u.password);
      await createShare(db, atlas.id, u.id, nivel, dono.id);
      pares[nivel] = await conectar(atlas.id, tok);
    }
    pares.owner = await conectar(atlas.id, donoTok);

    // O grupo NÃO contém nenhum dos sockets acima: assim a única frame em jogo é a de
    // composição, e o silêncio abaixo não é confundido com "não é membro do grupo".
    const forasteiro = await createUser(db, { username: U() });
    const g = await createAccessGroup(db, dono.id, { name: `Coletivo ${U()}` });
    await addAccessGroupMember(db, g.id, forasteiro.id, dono.id);

    await comoDono('post', `/api/v1/atlas/${atlas.id}/sharing/groups`)
      .send({ groupId: g.id, permission: 'write' })
      .expect(201);

    for (const [nome, par] of [['co-Gestor', pares.manage], ['dono', pares.owner]]) {
      const msg = await par.waitForType('sharing_updated');
      assert.equal(msg.action, 'group_added', nome);
      assert.equal(msg.groupId, g.id, nome);
      assert.equal(msg.permission, 'write', nome);
    }

    await sleep(JANELA_SILENCIO_MS);
    for (const nivel of ['read', 'comment', 'write']) {
      assert.deepEqual(
        pares[nivel].getMessagesOfType('sharing_updated'),
        [],
        `${nivel} está abaixo de manage: a composição do atlas lhe é negada por 403 no REST`
      );
    }
  });
});
