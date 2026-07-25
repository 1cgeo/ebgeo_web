// Path: tests/integration/sync-manage-tier.test.js
// Item 49 — o nível 'manage' (co-Gestor) empurrando sync.
//
// NENHUM usuário com share 'manage' fazia push de sync em toda a suíte (um grep por
// 'manage' em tests/integration só achava atlas-config-authz e
// atlas-transfer-ownership, e nenhum deles chama POST /sync). O estado é alcançável de
// verdade: transferir a posse REBAIXA o dono anterior para 'manage'.
//
// A linha 1674 de sync.service.js é literalmente uma LISTA FECHADA
// (`permission === 'write' || permission === 'manage' || permission === 'owner'`), o
// padrão C1 que o CLAUDE.md diz ter causado bug real duas vezes. Reescrevê-la para
// `write || owner` (a forma exata proibida) deixava TODOS os testes atuais verdes:
// comments.test.js só exercita write/comment, e sync-authz-lock só owner/write. O
// co-Gestor perderia a autoridade sobre comentários EM SILÊNCIO — o UPDATE casa zero
// linhas e a op é acked com sucesso.
//
// DUAS REFUTAÇÕES do relatório de 2026-07-19 (que descrevia `e1bb74e`):
//  1. map-delete NÃO é owner-only: `operationDenialReason` (sync.service.js:974) gateia
//     por HIERARQUIA, `PERMISSION_LEVELS[permission] < PERMISSION_LEVELS.manage`, então
//     o co-Gestor PODE excluir mapa. Era exatamente a lista fechada que o comentário do
//     próprio código diz ter sido corrigida ali.
//  2. Recusa de POLÍTICA não é mais 403: é `rejected: true` + `reason` por operação, com
//     200 no lote. Só violação de NÍVEL (assertOperationAllowed) ainda envenena o lote.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';

const U = () => `mgt_${randomUUID().slice(0, 8)}`;

describe('sync com share `manage` (co-Gestor)', () => {
  let app, db, owner, gestor, gestorTok, comentarista, comentaristaTok, escritor, escritorTok;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    owner = await createUser(db, { username: U() });
    gestor = await createUser(db, { username: U() });
    comentarista = await createUser(db, { username: U() });
    escritor = await createUser(db, { username: U() });
    gestorTok = await loginUser(app, gestor.username, gestor.password);
    comentaristaTok = await loginUser(app, comentarista.username, comentarista.password);
    escritorTok = await loginUser(app, escritor.username, escritor.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Atlas novo com os três shares e um mapa. */
  async function cenario() {
    const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    const map = await createMap(db, atlas.id);
    await createShare(db, atlas.id, gestor.id, 'manage', owner.id);
    await createShare(db, atlas.id, comentarista.id, 'comment', owner.id);
    await createShare(db, atlas.id, escritor.id, 'write', owner.id);
    return { atlas, map };
  }

  const push = (atlasId, token, ops) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlasId}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: ops });

  const featureOp = (mapId) => ({
    id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: randomUUID(),
    mapId,
    data: { type: 'Feature', geometry: { type: 'Point', coordinates: [-43, -22] }, properties: { source: 'point' } },
    timestamp: Date.now(), clientId: 'mgt-client',
  });

  const commentOp = (mapId, id, texto) => ({
    id: randomUUID(), entityType: 'comment', operationType: 'create', entityId: id, mapId,
    data: { id, mapId, lng: -43.2, lat: -22.9, text: texto, status: 'open' },
    timestamp: Date.now(), clientId: 'mgt-client',
  });

  const rowDoComentario = async (id) =>
    (await db.query(
      "SELECT data->>'text' AS text, deleted_at, author_id FROM comments WHERE id = $1",
      [id]
    )).rows[0];

  it('manage cria feição normalmente (manage > write passa o gate de rota e o de op)', async () => {
    const { atlas, map } = await cenario();
    const op = featureOp(map.id);

    const res = await push(atlas.id, gestorTok, [op]).expect(200);
    assert.equal(res.body.data.results[0].success, true);

    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [op.entityId]);
    assert.equal(rows.length, 1, 'a feição existe');
  });

  it('REFUTAÇÃO: manage PODE excluir mapa — o gate é por hierarquia, não owner-only', async () => {
    const { atlas, map } = await cenario();

    const res = await push(atlas.id, gestorTok, [{
      id: randomUUID(), entityType: 'map', operationType: 'delete', entityId: map.id, mapId: map.id,
      timestamp: Date.now(), clientId: 'mgt-client',
    }]).expect(200);
    assert.equal(res.body.data.results[0].success, true, 'excluir mapa é ação de GESTÃO: manage e acima');

    const { rows } = await db.query('SELECT deleted_at FROM maps WHERE id = $1', [map.id]);
    assert.notEqual(rows[0].deleted_at, null, 'o mapa foi de fato soft-deletado');
  });

  it('controle da hierarquia: um `write` NÃO exclui mapa, e é recusa POR OPERAÇÃO (não 403)', async () => {
    const { atlas, map } = await cenario();

    const res = await push(atlas.id, escritorTok, [{
      id: randomUUID(), entityType: 'map', operationType: 'delete', entityId: map.id, mapId: map.id,
      timestamp: Date.now(), clientId: 'mgt-client',
    }]).expect(200);

    const r = res.body.data.results[0];
    assert.equal(r.success, false);
    assert.equal(r.rejected, true, 'recusa de política é por op, com o lote sobrevivendo');
    assert.match(r.reason, /co-Gestor/);

    const { rows } = await db.query('SELECT deleted_at FROM maps WHERE id = $1', [map.id]);
    assert.equal(rows[0].deleted_at, null, 'o mapa continua vivo');
  });

  it('trancar mapa segue owner-only: manage é recusado por operação e maps.locked não muda', async () => {
    const { atlas, map } = await cenario();

    const res = await push(atlas.id, gestorTok, [{
      id: randomUUID(), entityType: 'map', operationType: 'update', entityId: map.id, mapId: map.id,
      changes: { locked: true },
      timestamp: Date.now(), clientId: 'mgt-client',
    }]).expect(200);

    const r = res.body.data.results[0];
    assert.equal(r.success, false);
    assert.equal(r.rejected, true);
    assert.match(r.reason, /dono do atlas/, 'lock é override de coordenação, deliberadamente mais estreito');

    const { rows } = await db.query('SELECT locked FROM maps WHERE id = $1', [map.id]);
    assert.equal(rows[0].locked, false);
  });

  it('manage EDITA comentário de OUTRO autor (prende o `manage` dentro do isEditor)', async () => {
    const { atlas, map } = await cenario();
    const comentarioId = randomUUID();

    await push(atlas.id, comentaristaTok, [commentOp(map.id, comentarioId, 'original')]).expect(200);
    const antes = await rowDoComentario(comentarioId);
    assert.equal(antes.text, 'original');
    assert.equal(antes.author_id, comentarista.id, 'a autoria é do comentarista');

    await push(atlas.id, gestorTok, [{
      id: randomUUID(), entityType: 'comment', operationType: 'update', entityId: comentarioId, mapId: map.id,
      data: { id: comentarioId, mapId: map.id, lng: -43.2, lat: -22.9, text: 'editado pelo gestor' },
      timestamp: Date.now(), clientId: 'mgt-client',
    }]).expect(200);

    const depois = await rowDoComentario(comentarioId);
    assert.equal(
      depois.text,
      'editado pelo gestor',
      'com a lista fechada errada o UPDATE casa ZERO linhas e o texto não mudaria'
    );
  });

  it('manage APAGA comentário de outro autor', async () => {
    const { atlas, map } = await cenario();
    const comentarioId = randomUUID();

    await push(atlas.id, comentaristaTok, [commentOp(map.id, comentarioId, 'para apagar')]).expect(200);
    assert.equal((await rowDoComentario(comentarioId)).deleted_at, null);

    await push(atlas.id, gestorTok, [{
      id: randomUUID(), entityType: 'comment', operationType: 'delete', entityId: comentarioId, mapId: map.id,
      timestamp: Date.now(), clientId: 'mgt-client',
    }]).expect(200);

    assert.notEqual((await rowDoComentario(comentarioId)).deleted_at, null);
  });

  it('controle simétrico: `comment` NÃO edita comentário alheio — acked, mas texto INALTERADO', async () => {
    const { atlas, map } = await cenario();
    const comentarioId = randomUUID();

    // Autoria do ESCRITOR, para que o comentarista seja um terceiro.
    await push(atlas.id, escritorTok, [commentOp(map.id, comentarioId, 'do escritor')]).expect(200);
    assert.equal((await rowDoComentario(comentarioId)).author_id, escritor.id);

    const res = await push(atlas.id, comentaristaTok, [{
      id: randomUUID(), entityType: 'comment', operationType: 'update', entityId: comentarioId, mapId: map.id,
      data: { id: comentarioId, mapId: map.id, lng: -43.2, lat: -22.9, text: 'invasão' },
      timestamp: Date.now(), clientId: 'mgt-client',
    }]).expect(200);
    assert.equal(res.body.data.results[0].success, true, 'a op é acked (o gate de autoria vive no SQL)');

    assert.equal(
      (await rowDoComentario(comentarioId)).text,
      'do escritor',
      'o Comentarista só age sobre o PRÓPRIO comentário'
    );
  });
});
