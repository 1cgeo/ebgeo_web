// Path: tests/integration/sharing-owner-invariants.test.js
// Itens 128 e 129 — o dono do atlas e o bloco `owner` de GET /sharing.
//
// ITEM 128. O comentário em sharing.routes.js justifica dar `sharing` ao co-Gestor
// afirmando que "o owner não tem linha em atlas_shares, então removeUserShare é no-op
// nele". Isso é PROSA: nenhum teste prendia. Se um dia o owner passar a ter linha de
// share (conveniência de UI, um ON CONFLICT que insira o dono, ou o próprio transfer
// deixando resíduo), um co-Gestor ganha o poder de trancar o dono para fora do próprio
// atlas — e toda a suíte atual segue verde. O que estes verdes provam é que a
// autoridade vem de `atlas.owner_id`, não da tabela de shares.
//
// ITEM 129. O share-06 (sharing-gaps) fecha as chaves de cada item de `shares` mas
// nunca toca `data.owner`, que o modal de compartilhamento renderiza como a linha do
// dono. Se o serviço voltasse a expor owner_id/owner_username crus (snake_case) ou
// perdesse o bloco, nada falharia. E a transferência de posse muta exatamente esses
// dois campos ao mesmo tempo (novo owner_id + ex-dono virando share 'manage'):
// nenhum teste olhava o resultado pela lente do sharing.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';

const U = () => `owni_${randomUUID().slice(0, 8)}`;

describe('invariantes do dono na API de sharing', () => {
  let app, db;
  let owner, ownerTok, gestor, gestorTok, outroGestor, outroGestorTok, terceiro;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    owner = await createUser(db, { username: U(), nome: 'Dona do Atlas' });
    ownerTok = await loginUser(app, owner.username, owner.password);
    gestor = await createUser(db, { username: U() });
    gestorTok = await loginUser(app, gestor.username, gestor.password);
    outroGestor = await createUser(db, { username: U() });
    outroGestorTok = await loginUser(app, outroGestor.username, outroGestor.password);
    terceiro = await createUser(db, { username: U() });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Atlas novo com dois co-Gestores. */
  async function cenario() {
    const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);
    await createShare(db, atlas.id, gestor.id, 'manage', owner.id);
    await createShare(db, atlas.id, outroGestor.id, 'manage', owner.id);
    return atlas;
  }

  const como = (token, metodo, url) =>
    supertest(app)[metodo](url).set('Authorization', `Bearer ${token}`);

  // ── Item 128 ────────────────────────────────────────────────────────────────
  describe('item 128 — o owner não é removível nem rebaixável pela API de sharing', () => {
    it('manager DELETE /sharing/users/<owner> → 404, e o acesso do dono fica intacto', async () => {
      const atlas = await cenario();

      await como(gestorTok, 'delete', `/api/v1/atlas/${atlas.id}/sharing/users/${owner.id}`).expect(404);

      await como(ownerTok, 'get', `/api/v1/atlas/${atlas.id}/sharing`).expect(200);
      await como(ownerTok, 'put', `/api/v1/atlas/${atlas.id}`).send({ name: 'ainda minha' }).expect(200);
    });

    it('manager PUT /sharing/users/<owner> {read} → 404 (não há linha para atualizar)', async () => {
      const atlas = await cenario();

      await como(gestorTok, 'put', `/api/v1/atlas/${atlas.id}/sharing/users/${owner.id}`)
        .send({ permission: 'read' })
        .expect(404);

      const { rows } = await db.query(
        'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
        [atlas.id, owner.id]
      );
      assert.equal(rows.length, 0, 'o dono continua sem linha de share');
    });

    it('criar um share redundante para o dono NÃO o rebaixa: a autoridade vem de owner_id', async () => {
      const atlas = await cenario();

      // Comportamento atual: a linha é criada (o POST não conhece o dono).
      await como(gestorTok, 'post', `/api/v1/atlas/${atlas.id}/sharing/users`)
        .send({ userId: owner.id, permission: 'read' })
        .expect(201);
      const { rows } = await db.query(
        'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
        [atlas.id, owner.id]
      );
      assert.equal(rows[0].permission, 'read', 'a linha redundante existe de fato');

      // E ainda assim o dono continua dono: se o share 'read' governasse, isto seria 403.
      await como(ownerTok, 'delete', `/api/v1/atlas/${atlas.id}`).expect(204);
    });

    it('co-Gestores são mutuamente removíveis (decisão pinada, não acidente)', async () => {
      const atlas = await cenario();

      await como(outroGestorTok, 'get', `/api/v1/atlas/${atlas.id}/sharing`).expect(200);
      await como(gestorTok, 'delete', `/api/v1/atlas/${atlas.id}/sharing/users/${outroGestor.id}`).expect(204);
      // 404 e não 403: removido o share, o co-Gestor deposto não tem mais relação nenhuma
      // com o atlas, que é o degrau 404 da escada. O 403 fica reservado a quem AINDA tem
      // share e só está abaixo do nível pedido (o `write` do bloco de itens acima).
      await como(outroGestorTok, 'get', `/api/v1/atlas/${atlas.id}/sharing`).expect(404);
    });

    it("o teto do que um manager concede é 'manage': 201 para manage, 422 para owner", async () => {
      const atlas = await cenario();

      await como(gestorTok, 'post', `/api/v1/atlas/${atlas.id}/sharing/users`)
        .send({ userId: terceiro.id, permission: 'manage' })
        .expect(201);
      await como(gestorTok, 'put', `/api/v1/atlas/${atlas.id}/sharing/users/${terceiro.id}`)
        .send({ permission: 'owner' })
        .expect(422);

      const { rows } = await db.query(
        'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
        [atlas.id, terceiro.id]
      );
      assert.equal(rows[0].permission, 'manage');
    });
  });

  // ── Item 129 ────────────────────────────────────────────────────────────────
  describe('item 129 — o bloco `owner` de GET /sharing', () => {
    it('o bloco tem exatamente {nome, userId, username}, em camelCase', async () => {
      const atlas = await cenario();

      const res = await como(ownerTok, 'get', `/api/v1/atlas/${atlas.id}/sharing`).expect(200);
      const bloco = res.body.data.owner;

      assert.deepEqual(Object.keys(bloco).sort(), ['nome', 'userId', 'username']);
      assert.equal(bloco.userId, owner.id);
      assert.equal(bloco.nome, 'Dona do Atlas');
      assert.equal(bloco.username, owner.username);

      // Os nomes crus do SQL não podem escapar para o envelope.
      assert.equal(res.body.data.owner_id, undefined);
      assert.equal(res.body.data.owner_username, undefined);
      assert.equal(res.body.data.owner_nome, undefined);
    });

    it('após transferir a posse, /sharing reporta o NOVO dono e o ex-dono como `manage`', async () => {
      const atlas = await cenario();

      await como(ownerTok, 'post', `/api/v1/atlas/${atlas.id}/transfer`)
        .send({ newOwnerId: gestor.id })
        .expect(200);

      const res = await como(gestorTok, 'get', `/api/v1/atlas/${atlas.id}/sharing`).expect(200);
      assert.equal(res.body.data.owner.userId, gestor.id, 'o bloco owner acompanha a transferência');

      const exDono = res.body.data.shares.find((s) => s.userId === owner.id);
      assert.ok(exDono, 'o ex-dono aparece na lista de shares');
      assert.equal(exDono.permission, 'manage');
      // E o novo dono não fica listado como share dele mesmo.
      assert.equal(res.body.data.shares.some((s) => s.userId === gestor.id), false);
    });

    it('atlas com 25 shares: a lista não é truncada em silêncio (a query não tem LIMIT)', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
      await createMap(db, atlas.id);

      for (let i = 0; i < 25; i++) {
        const u = await createUser(db, { username: U() });
        await createShare(db, atlas.id, u.id, 'read', owner.id);
      }

      const res = await como(ownerTok, 'get', `/api/v1/atlas/${atlas.id}/sharing`).expect(200);
      assert.equal(res.body.data.shares.length, 25);
    });

    it('share de usuário DESATIVADO continua listado com nome/username preenchidos', async () => {
      const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
      await createMap(db, atlas.id);
      const inativo = await createUser(db, { username: U(), nome: 'Fulano Inativo' });
      await createShare(db, atlas.id, inativo.id, 'write', owner.id);
      await db.query('UPDATE users SET is_active = false WHERE id = $1', [inativo.id]);

      const res = await como(ownerTok, 'get', `/api/v1/atlas/${atlas.id}/sharing`).expect(200);
      const linha = res.body.data.shares.find((s) => s.userId === inativo.id);
      assert.ok(linha, 'o JOIN é sobre users sem filtro de atividade');
      assert.equal(linha.nome, 'Fulano Inativo');
      assert.equal(linha.username, inativo.username, 'nome/username preenchidos, não null');
    });
  });
});
