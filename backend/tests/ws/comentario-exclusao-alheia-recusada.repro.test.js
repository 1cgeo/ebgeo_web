// Path: tests/ws/comentario-exclusao-alheia-recusada.repro.test.js
//
// A EXCLUSAO DE COMENTARIO ALHEIO POR QUEM NAO MODERA ERA ACEITA NO FIO E NEGADA NO BANCO.
//
// O Comentarista que manda um `comment delete` de um comentario de OUTRA pessoa nao consegue
// apagar a linha: o UPDATE de `applyCommentOp` so casa com o autor ou com quem e Editor para cima.
// Mas nada RECUSAVA a op: ela entrava no log de operacoes, voltava `applied` e era DIFUNDIDA a
// sala. Cada par aplicava a exclusao e o comentario sumia da tela de todo mundo enquanto seguia
// vivo no servidor, ate o proximo retrato completo. O autor da op, por sua vez, tirava a op da fila
// convencido de que tinha excluido. A edicao de texto alheio ja era recusada por operacao
// (`commentEditDenialReason`); a exclusao era a metade que faltava do mesmo gate.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket } from '../../src/modules/collab/collab.gateway.js';

const U = () => `cex_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('exclusao de comentario alheio', () => {
  let app, db, server, dono, tokDono, editor, tokEditor, comentarista, tokComentarista, atlas, mapa;
  const clientes = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));
    dono = await createUser(db, { username: U() });
    editor = await createUser(db, { username: U() });
    comentarista = await createUser(db, { username: U() });
    tokDono = await loginUser(app, dono.username, dono.password);
    tokEditor = await loginUser(app, editor.username, editor.password);
    tokComentarista = await loginUser(app, comentarista.username, comentarista.password);
    atlas = await createAtlas(db, dono.id);
    mapa = await createMap(db, atlas.id);
    await createShare(db, atlas.id, editor.id, 'write', dono.id);
    await createShare(db, atlas.id, comentarista.id, 'comment', dono.id);
  });

  after(async () => {
    for (const c of clientes) c.close?.();
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  const push = async (token, op) => (await supertest(app)
    .post(`/api/v1/atlas/${atlas.id}/sync`)
    .set('Authorization', `Bearer ${token}`)
    .send({ operations: [op] })
    .expect(200)).body.data.results[0];

  const comentar = (id) => ({
    protocolVersion: 2, id: randomUUID(), entityType: 'comment', operationType: 'create',
    entityId: id, mapId: mapa.id, timestamp: Date.now(), clientId: 'cli-editor',
    data: { id, mapId: mapa.id, text: 'do editor', lng: -45, lat: -20, status: 'open' },
  });
  const excluir = (id, clientId) => ({
    protocolVersion: 2, id: randomUUID(), entityType: 'comment', operationType: 'delete',
    entityId: id, mapId: mapa.id, timestamp: Date.now(), clientId,
  });

  it('o Comentarista recebe a recusa, nada entra no log e o par nao recebe a exclusao', async () => {
    const idComentario = randomUUID();
    assert.equal((await push(tokEditor, comentar(idComentario))).status, 'applied');

    const par = await createWsClient(server, atlas.id, tokDono, 'cli-dono');
    clientes.push(par);
    await par.waitForType('connected');
    const inicio = par.messages.length;

    const op = excluir(idComentario, 'cli-comentarista');
    const resultado = await push(tokComentarista, op);

    assert.equal(resultado.status, 'rejected', 'a exclusao alheia e recusada por operacao');
    assert.match(resultado.reason, /autor/);
    const logada = await db.query('SELECT 1 FROM operations WHERE atlas_id = $1 AND op_id = $2', [atlas.id, op.id]);
    assert.equal(logada.rows.length, 0, 'a op recusada nao entra no log');
    const vivo = await db.query('SELECT deleted_at FROM comments WHERE id = $1', [idComentario]);
    assert.equal(vivo.rows[0].deleted_at, null, 'o comentario continua vivo');

    await sleep(300);
    const difundida = par.messages.slice(inicio).some((q) => (q.type === 'operations' ? q.ops : [q.op])
      .some((o) => o?.id === op.id));
    assert.equal(difundida, false, 'o par nao recebe uma exclusao que o servidor nao fez');
  });

  it('CONTROLE: o proprio autor exclui o seu, e o Editor modera o alheio', async () => {
    const doEditor = randomUUID();
    await push(tokEditor, comentar(doEditor));
    assert.equal((await push(tokEditor, excluir(doEditor, 'cli-editor'))).status, 'applied');
    assert.ok((await db.query('SELECT deleted_at FROM comments WHERE id = $1', [doEditor])).rows[0].deleted_at);

    const outro = randomUUID();
    await push(tokEditor, comentar(outro));
    assert.equal((await push(tokDono, excluir(outro, 'cli-dono'))).status, 'applied', 'o dono modera');
    assert.ok((await db.query('SELECT deleted_at FROM comments WHERE id = $1', [outro])).rows[0].deleted_at);
  });

  it('BORDA: excluir um comentario que nao existe continua sendo aceito (o log e expurgavel)', async () => {
    assert.equal((await push(tokComentarista, excluir(randomUUID(), 'cli-comentarista'))).status, 'applied');
  });
});
