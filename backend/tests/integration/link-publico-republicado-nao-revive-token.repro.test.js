// Path: tests/integration/link-publico-republicado-nao-revive-token.repro.test.js
//
// DESPUBLICAR E REPUBLICAR GERA UM LINK NOVO, E O TOKEN DO LINK VELHO NAO PODE VOLTAR A VALER.
//
// O token de visitante (`getAtlasByPublicLink`, 1 h) carrega so o atlas; quem o confere
// (`requireAtlasPermission` no REST, `resolvePermission` no socket) pergunta apenas se o atlas esta
// PUBLICO. Despublicar mata o token, porque o atlas deixa de ser publico; mas o dono que despublica
// porque o link vazou e depois republica (link novo, para quem deve ver) devolve a leitura a TODO
// token emitido pelo link vazado na ultima hora, sem ninguem ter aberto o link novo.
import { describe, it, before, after } from 'node:test';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser, getPublicToken } from '../helpers/fixtures.js';
import { attachWebSocket } from '../../src/modules/collab/collab.gateway.js';

describe('link publico republicado', () => {
  let app, db, dono, tokenDono, atlas, server;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    dono = await createUser(db, { username: `lpr_${randomUUID().slice(0, 8)}` });
    tokenDono = await loginUser(app, dono.username, dono.password);
    atlas = await createAtlas(db, dono.id);
    await createMap(db, atlas.id);
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  const publicar = async () => (await supertest(app)
    .post(`/api/v1/atlas/${atlas.id}/sharing/public`)
    .set('Authorization', `Bearer ${tokenDono}`)
    .expect(200)).body.data.publicLink;
  const despublicar = () => supertest(app)
    .delete(`/api/v1/atlas/${atlas.id}/sharing/public`)
    .set('Authorization', `Bearer ${tokenDono}`)
    .expect(204);
  const lerComo = (token) => supertest(app)
    .get(`/api/v1/atlas/${atlas.id}/sync/0`)
    .set('Authorization', `Bearer ${token}`);

  it('o token do link velho nao le o atlas republicado; o do link novo le', async () => {
    const velho = await publicar();
    const tokenVelho = await getPublicToken(app, velho);
    assert.equal((await lerComo(tokenVelho)).status, 200, 'PISO: o token le enquanto o link vale');

    await despublicar();
    assert.notEqual((await lerComo(tokenVelho)).status, 200, 'despublicado, o token nao le');

    const novo = await publicar();
    assert.notEqual(novo, velho, 'republicar gera link novo');
    const tokenNovo = await getPublicToken(app, novo);
    assert.equal((await lerComo(tokenNovo)).status, 200, 'CONTROLE: o link novo le');
    assert.notEqual((await lerComo(tokenVelho)).status, 200,
      'o token emitido pelo link VELHO nao volta a ler depois da republicacao');
  });

  /** Abre o socket de colaboração e diz se ele ABRIU; nunca rejeita (recusa é desfecho). */
  const abrirSocket = (token) => new Promise((resolve) => {
    const { port } = server.address();
    const ws = new WebSocket(`ws://localhost:${port}/api/v1/collab?atlasId=${atlas.id}&token=${token}`);
    let pronto = false;
    const fim = (abriu) => { if (pronto) return; pronto = true; ws.terminate(); resolve(abriu); };
    ws.on('message', (raw) => { if (JSON.parse(raw.toString()).type === 'connected') fim(true); });
    ws.on('unexpected-response', () => fim(false));
    ws.on('error', () => fim(false));
    ws.on('close', () => fim(false));
  });

  it('pelo socket: o token do link velho nao abre a sala do atlas republicado', async () => {
    const velho = await publicar();
    const tokenVelho = await getPublicToken(app, velho);
    assert.equal(await abrirSocket(tokenVelho), true, 'PISO: abre enquanto o link vale');
    await despublicar();
    const novo = await publicar();
    const tokenNovo = await getPublicToken(app, novo);
    assert.equal(await abrirSocket(tokenNovo), true, 'CONTROLE: o link novo abre');
    assert.equal(await abrirSocket(tokenVelho), false, 'o link velho nao abre');
  });
});
