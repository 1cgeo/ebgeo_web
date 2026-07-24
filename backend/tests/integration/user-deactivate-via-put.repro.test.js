// Regressão: `PUT /users/:userId {is_active:false}` era uma porta dos fundos que
// desativava a conta SEM nenhuma das três garantias do caminho de desativação.
//
// `deleteUser` conta os atlas do usuário e EXIGE um destinatário antes de soltar a
// posse, audita a ação e revoga os refresh tokens. `updateUser` escrevia
// `is_active` direto no UPDATE_USER_ADMIN e não fazia nada disso.
//
// Não é caminho teórico: o formulário de edição do painel admin manda o checkbox
// "Ativo" como `is_active` no PUT (`frontend/src/js/admin/users-tab.js:357`). Um
// admin desmarcando a caixa deixava os atlas do usuário órfãos — dono inativo é
// recusado no middleware `auth`, então só outro admin global consegue mexer neles
// depois. É exatamente o estado que o ConflictError de `deleteUser` existe para
// impedir, alcançado pela porta ao lado.
//
// A correção RECUSA a transição em vez de replicar a guarda: o PUT não tem como
// receber o destinatário da transferência, então não existe forma de ele completar
// a operação com segurança.
//
// CONTROLE NEGATIVO: removida a guarda de `users.service.js`, o primeiro caso cai
// (o PUT devolve 200 e desativa) e o terceiro cai junto (o atlas fica órfão).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, loginUser } from '../helpers/fixtures.js';

describe('desativação por PUT é recusada (a guarda mora na rota de desativação)', () => {
    let app, db, tokenAdmin, alvoId;

    before(async () => {
        const env = await setupTestEnv();
        app = env.app;
        db = env.db;
        const admin = await createAdminUser(db);
        tokenAdmin = await loginUser(app, admin.username, admin.password);
    });

    after(async () => {
        await teardownTestEnv(db);
    });

    const rid = () => randomUUID().slice(0, 8);

    async function criarAlvo(prefixo) {
        const u = await createUser(db, { username: `${prefixo}_${rid()}` });
        return u.id;
    }

    it('PUT com is_active:false num usuário ATIVO é 409, e o atlas dele não fica órfão', async () => {
        alvoId = await criarAlvo('alvo_put');
        // Dono de atlas é o caso que dá o dano: sem a guarda o PUT desativa, e o
        // atlas passa a ter dono inativo — recusado no middleware `auth`, só um
        // admin global consegue mexer nele depois.
        const atlas = await createAtlas(db, alvoId, { name: 'Atlas que ficaria órfão' });

        const r = await supertest(app)
            .put(`/api/v1/users/${alvoId}`)
            .set('Authorization', `Bearer ${tokenAdmin}`)
            .send({ is_active: false });

        assert.equal(r.status, 409, 'a porta dos fundos precisa ser recusada');

        const { rows } = await db.query('SELECT is_active FROM public.users WHERE id = $1', [alvoId]);
        assert.equal(rows[0].is_active, true, 'a conta NÃO pode ter sido desativada');

        const dono = await db.query(
            `SELECT u.is_active FROM public.atlas a JOIN public.users u ON u.id = a.owner_id WHERE a.id = $1`,
            [atlas.id],
        );
        assert.equal(dono.rows[0].is_active, true, 'o atlas não pode ter ficado com dono inativo');
    });

    it('PUT que não mexe em is_active continua funcionando', async () => {
        const r = await supertest(app)
            .put(`/api/v1/users/${alvoId}`)
            .set('Authorization', `Bearer ${tokenAdmin}`)
            .send({ full_name: 'Alvo Renomeado' });

        assert.equal(r.status, 200, 'edição normal não pode ter sido afetada');
    });

    it('reativar por PUT (is_active:true) continua permitido', async () => {
        // Usuário SEM atlas: a desativação legítima só exige destinatário quando há
        // atlas a transferir, e aqui o que se quer exercitar é a reativação.
        const semAtlas = await criarAlvo('alvo_reativar');
        const del = await supertest(app)
            .delete(`/api/v1/users/${semAtlas}`)
            .set('Authorization', `Bearer ${tokenAdmin}`);
        assert.ok(del.status === 200 || del.status === 204, `desativação legítima: ${del.status}`);

        const r = await supertest(app)
            .put(`/api/v1/users/${semAtlas}`)
            .set('Authorization', `Bearer ${tokenAdmin}`)
            .send({ is_active: true });

        assert.equal(r.status, 200, 'reativar não tem risco e deve passar');
        const { rows } = await db.query('SELECT is_active FROM public.users WHERE id = $1', [semAtlas]);
        assert.equal(rows[0].is_active, true);
    });

    it('reenviar is_active:false para quem JÁ está inativo não é transição e passa', async () => {
        const id = await criarAlvo(`alvo_ja_inativo_${Date.now()}`);
        await supertest(app).delete(`/api/v1/users/${id}`).set('Authorization', `Bearer ${tokenAdmin}`);

        // Editar o nome de um usuário inativo manda o checkbox desmarcado junto:
        // se a guarda olhasse o VALOR em vez da TRANSIÇÃO, isso quebraria.
        const r = await supertest(app)
            .put(`/api/v1/users/${id}`)
            .set('Authorization', `Bearer ${tokenAdmin}`)
            .send({ full_name: 'Editado Inativo', is_active: false });

        assert.equal(r.status, 200, 'não é transição: precisa passar');
    });
});
