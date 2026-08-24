// Path: tests/integration/om-autodesativacao-tranca-o-administrador.test.js
//
// C1 — desativar a PRÓPRIA OM de lotação é o único botão do painel que tranca quem o
// aperta, e nada no servidor recusava.
//
// A CADEIA, e ela é toda de código que está CERTO: `deactivateOrganization` escreve
// `organizations.is_active = false`; `LIVE_AUTH_STATE` (`utils/org-status.js`) junta
// `organizations` por `users.organization_id` e passa a devolver `org_is_active: false`
// para toda conta LOTADA nela; o middleware `auth` estrito responde 403 'Organization is
// inactive' ANTES da linha que adota o papel global do banco, então `requireAdmin` nunca
// roda e não sobra rota pela qual desfazer o ato. `login` e `refresh` recusam pelo mesmo
// motivo. Nenhuma peça está errada: o que faltava era a recusa na borda.
//
// O CONTROLE NEGATIVO deste arquivo é o bloco "outra OM": o mesmo administrador desativa
// uma OM em que NÃO está lotado e recebe 204. Sem ele, uma guarda que recusasse toda
// desativação passaria neste arquivo inteiro, e a recusa cega é um defeito pior que o
// original (o painel perderia a única forma de aposentar uma OM).
//
// A SEGUNDA PORTA é o PUT, cujo corpo aceita `is_active: false` e faz exatamente a mesma
// escrita com outro nome na trilha (ORG_UPDATE em vez de ORG_DELETE). Guardar só o DELETE
// deixaria a tela se trancar pela porta ao lado, que é a classe de porta dos fundos que
// `updateUser` já documenta para contas.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, loginUser } from '../helpers/fixtures.js';

const SFX = randomUUID().slice(0, 8);

describe('C1 — o servidor recusa desativar a OM de lotação de quem pede', () => {
  let app, db;
  let orgDoAdmin, orgAlheia, adminToken, adminId;

  async function criarOrg(tag) {
    const { rows } = await db.query(
      'INSERT INTO organizations (nome, sigla, slug) VALUES ($1, $2, $3) RETURNING id',
      [`OM ${tag} ${SFX}`, `${tag}${SFX}`.slice(0, 10), `om-${tag}-${SFX}`.toLowerCase()]
    );
    return rows[0].id;
  }

  const estaAtiva = async (id) => {
    const { rows } = await db.query('SELECT is_active FROM organizations WHERE id = $1', [id]);
    return rows[0].is_active;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    orgDoAdmin = await criarOrg('lotacao');
    orgAlheia = await criarOrg('alheia');

    const admin = await createAdminUser(db, {
      username: `om_c1_admin_${SFX}`,
      organization_id: orgDoAdmin,
    });
    adminId = admin.id;
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await db.query('DELETE FROM audit_trail WHERE actor_id = $1', [adminId]);
    await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [adminId]);
    await db.query('DELETE FROM users WHERE id = $1', [adminId]);
    await db.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[orgDoAdmin, orgAlheia]]);
    await teardownTestEnv(db);
  });

  describe('DELETE /organizations/:id — a própria lotação', () => {
    it('409 e a OM continua ATIVA (a recusa vem antes da escrita)', async () => {
      const res = await supertest(app)
        .delete(`/api/v1/organizations/${orgDoAdmin}`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.equal(res.status, 409);
      // A mensagem é o produto aqui: ela precisa dizer o que ACONTECERIA, senão o
      // administrador lê "conflito" e tenta de novo.
      assert.match(res.body.error.message, /lotado/i);
      // O assert que separa "recusou" de "recusou depois de estragar".
      assert.equal(await estaAtiva(orgDoAdmin), true);
    });

    it('e nada foi escrito na trilha: o ato não aconteceu', async () => {
      const { rows } = await db.query(
        'SELECT 1 FROM audit_trail WHERE actor_id = $1 AND target_id = $2',
        [adminId, orgDoAdmin]
      );
      assert.equal(rows.length, 0);
    });
  });

  describe('PUT /organizations/:id com is_active:false — a porta ao lado', () => {
    it('409 e a OM continua ATIVA', async () => {
      const res = await supertest(app)
        .put(`/api/v1/organizations/${orgDoAdmin}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_active: false });

      assert.equal(res.status, 409);
      assert.equal(await estaAtiva(orgDoAdmin), true);
    });

    it('mas o mesmo PUT que só renomeia continua passando', async () => {
      const res = await supertest(app)
        .put(`/api/v1/organizations/${orgDoAdmin}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nome: `OM lotacao renomeada ${SFX}` });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.is_active, true);
    });
  });

  // ==========================================================================
  // CONTROLE NEGATIVO — o caso que passaria se a guarda não existisse, e que
  // continua tendo de passar DEPOIS dela.
  // ==========================================================================
  describe('CONTROLE NEGATIVO — outra OM, o mesmo administrador', () => {
    it('204 e a OM fica inativa: a guarda discrimina, não recusa tudo', async () => {
      const res = await supertest(app)
        .delete(`/api/v1/organizations/${orgAlheia}`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.equal(res.status, 204);
      assert.equal(await estaAtiva(orgAlheia), false);
    });

    it('e o administrador continua autenticando depois disso', async () => {
      // Fecha o laço: a OM que caiu não é a dele, então `LIVE_AUTH_STATE` continua
      // devolvendo `org_is_active: true` e o middleware estrito não o expulsa. É este
      // assert que demonstra qual é o dano do caso guardado acima.
      const res = await supertest(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.equal(res.status, 200);
    });
  });

  // ==========================================================================
  // A CONSEQUÊNCIA que a guarda existe para impedir, medida uma vez em cima de um
  // administrador SACRIFICIAL: sem ele, este bloco seria só teoria no comentário.
  // ==========================================================================
  describe('o dano, demonstrado com a OM desativada por FORA da rota', () => {
    let vitimaToken, vitimaId, orgVitima;

    before(async () => {
      orgVitima = await criarOrg('vitima');
      const vitima = await createAdminUser(db, {
        username: `om_c1_vitima_${SFX}`,
        organization_id: orgVitima,
      });
      vitimaId = vitima.id;
      vitimaToken = await loginUser(app, vitima.username, vitima.password);
      // Por UPDATE direto, e não pela rota: a rota agora recusa, e o ponto do bloco é
      // mostrar o estado em que ela deixaria a conta se não recusasse.
      await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [orgVitima]);
    });

    after(async () => {
      await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [vitimaId]);
      await db.query('DELETE FROM users WHERE id = $1', [vitimaId]);
      await db.query('DELETE FROM organizations WHERE id = $1', [orgVitima]);
    });

    it('o administrador leva 403 e não alcança mais nem a rota que reverteria o ato', async () => {
      const me = await supertest(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${vitimaToken}`);
      assert.equal(me.status, 403);

      const reativar = await supertest(app)
        .put(`/api/v1/organizations/${orgVitima}`)
        .set('Authorization', `Bearer ${vitimaToken}`)
        .send({ is_active: true });
      assert.equal(reativar.status, 403);
    });
  });
});
