// Regressão: as três operações administrativas mais consequentes do painel não
// deixavam trilha nenhuma.
//
// `USER_CREATE`, `USER_UPDATE`, `PASSWORD_RESET` e `ROLE_CHANGE` estão declarados
// no CHECK de `audit_trail.action` (`002_auditoria.sql`), e uma varredura do
// `backend/src` inteiro devolvia ZERO emissores: os únicos `createAudit` do
// módulo eram `USER_DELETE` e `API_KEY_ROTATE`. Ou seja, criar conta (inclusive
// já como `admin`), promover alguém a admin e resetar senha alheia passavam sem
// registro.
//
// É a MESMA classe do achado de sharing já corrigido: o schema declarava a
// intenção, nada emitia, e um filtro que por construção nunca casa se lê como
// "nada aconteceu" em vez de "nunca foi ligado" — a forma mais silenciosa de
// lacuna, porque nada falha para apontar a ausência.
//
// Duas decisões que este teste prende, e não só a existência da linha:
//   1. `ROLE_CHANGE` é emitido À PARTE de `USER_UPDATE`, não como detalhe dele.
//      Promoção a admin é o que uma revisão procura primeiro, e procurar por
//      ação é para o que serve o índice `idx_audit_action`.
//   2. O detalhe diz DE ONDE veio o papel, não só para onde foi. Mudança de
//      nível só é auditável com o valor anterior — mesma lição do
//      `previous_permission` da auditoria de sharing.
//
// E o que NÃO pode estar lá: nada da senha em `PASSWORD_RESET`, nem valor de
// campo em `USER_UPDATE`. A trilha é lida por qualquer admin, e credencial em
// log já foi defeito real neste projeto duas vezes.
//
// CONTROLE NEGATIVO, medido e não previsto: removendo os quatro `createAudit`
// do service caem os SEIS casos, não os quatro que eu esperava. Os dois últimos
// afirmam o que NÃO vaza, mas leem `details` da linha — sem linha, não há o que
// inspecionar e eles caem junto. Vale registrar que isso os torna guardas do
// CONTEÚDO apenas enquanto a linha existe: se algum dia a emissão for removida,
// eles acusam ausência, não vazamento.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, createUser, loginUser } from '../helpers/fixtures.js';

describe('operações administrativas de usuário deixam trilha de auditoria', () => {
    let app, db, tok, adminId;

    const rid = () => randomUUID().slice(0, 8);

    async function trilha(action, targetId) {
        const { rows } = await db.query(
            `SELECT action, actor_id, target_type, target_id, target_name, details
               FROM audit_trail WHERE action = $1 AND target_id = $2
               ORDER BY created_at DESC LIMIT 1`,
            [action, targetId],
        );
        return rows[0] || null;
    }

    before(async () => {
        const env = await setupTestEnv();
        app = env.app;
        db = env.db;
        const admin = await createAdminUser(db);
        adminId = admin.id;
        tok = await loginUser(app, admin.username, admin.password);
    });

    after(async () => {
        await teardownTestEnv(db);
    });

    it('criar usuário emite USER_CREATE com o papel criado', async () => {
        const username = `aud_new_${rid()}`;
        const res = await supertest(app)
            .post('/api/v1/users')
            .set('Authorization', `Bearer ${tok}`)
            .send({ username, password: 'Senha-forte-123', nome: 'Auditado', role: 'user' });
        assert.equal(res.status, 201, JSON.stringify(res.body));

        const linha = await trilha('USER_CREATE', res.body.data.id);
        assert.ok(linha, 'USER_CREATE precisa existir');
        assert.equal(linha.actor_id, adminId, 'o ator é quem criou, não o criado');
        assert.equal(linha.target_type, 'USER');
        assert.equal(linha.details.role, 'user', 'o papel criado é o dado que interessa');
    });

    it('promover a admin emite ROLE_CHANGE à parte, com o papel ANTERIOR', async () => {
        const alvo = await createUser(db, { username: `aud_role_${rid()}` });
        const res = await supertest(app)
            .put(`/api/v1/users/${alvo.id}`)
            .set('Authorization', `Bearer ${tok}`)
            .send({ role: 'admin' });
        assert.equal(res.status, 200, JSON.stringify(res.body));

        const linha = await trilha('ROLE_CHANGE', alvo.id);
        assert.ok(linha, 'ROLE_CHANGE precisa ser sua própria ação, não um detalhe de USER_UPDATE');
        assert.equal(linha.details.from, 'user', 'sem o valor anterior a mudança não é auditável');
        assert.equal(linha.details.to, 'admin');
    });

    it('editar campo comum emite USER_UPDATE listando os campos', async () => {
        const alvo = await createUser(db, { username: `aud_upd_${rid()}` });
        const res = await supertest(app)
            .put(`/api/v1/users/${alvo.id}`)
            .set('Authorization', `Bearer ${tok}`)
            .send({ nome: 'Nome Novo' });
        assert.equal(res.status, 200);

        const linha = await trilha('USER_UPDATE', alvo.id);
        assert.ok(linha, 'USER_UPDATE precisa existir');
        assert.ok(linha.details.fields.includes('nome'));
    });

    it('resetar senha emite PASSWORD_RESET', async () => {
        const alvo = await createUser(db, { username: `aud_pwd_${rid()}` });
        const res = await supertest(app)
            .post(`/api/v1/users/${alvo.id}/reset-password`)
            .set('Authorization', `Bearer ${tok}`)
            .send({ newPassword: 'Outra-senha-987' });
        assert.equal(res.status, 200, JSON.stringify(res.body));

        const linha = await trilha('PASSWORD_RESET', alvo.id);
        assert.ok(linha, 'PASSWORD_RESET precisa existir');
        assert.equal(linha.actor_id, adminId);
    });

    it('a trilha do reset NÃO carrega nada da senha', async () => {
        const alvo = await createUser(db, { username: `aud_leak_${rid()}` });
        const SENHA = 'Senha-Secreta-Xyz-321';
        await supertest(app)
            .post(`/api/v1/users/${alvo.id}/reset-password`)
            .set('Authorization', `Bearer ${tok}`)
            .send({ newPassword: SENHA });

        const linha = await trilha('PASSWORD_RESET', alvo.id);
        const texto = JSON.stringify(linha.details || {});
        assert.ok(!texto.includes(SENHA), 'a senha não pode aparecer na trilha');
        assert.ok(!/\$2[aby]\$/.test(texto), 'nem o hash bcrypt');
    });

    it('USER_UPDATE registra os NOMES dos campos, nunca os valores', async () => {
        const alvo = await createUser(db, { username: `aud_val_${rid()}` });
        const NOME = 'Fulano Sensivel Da Silva';
        await supertest(app)
            .put(`/api/v1/users/${alvo.id}`)
            .set('Authorization', `Bearer ${tok}`)
            .send({ nome: NOME });

        const linha = await trilha('USER_UPDATE', alvo.id);
        const texto = JSON.stringify(linha.details || {});
        assert.ok(texto.includes('nome'), 'o nome do campo entra');
        assert.ok(!texto.includes(NOME), 'o VALOR do campo não entra');
    });
});
