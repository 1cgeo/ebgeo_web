// Path: tests/integration/atlas-404-vs-403-escada.test.js
//
// A escada de erro de `requireAtlasPermission`, decidida em 2026-07-25:
//
//   sem relação nenhuma com o atlas  -> 404 (indistinguível de atlas inexistente)
//   share com nível insuficiente     -> 403 (o chamador SABE que o atlas existe)
//
// Por que isto é um teste e não uma preferência: o projeto já tinha tomado essa decisão
// em `enforceProjectReadable` (modules/streetview360/sv360.service.js), cujo JSDoc diz
// "Throws NotFoundError (NOT Forbidden) ... so a hidden project is indistinguishable from
// a nonexistent one", e o módulo de atlas fazia o OPOSTO. A assimetria entre dois módulos
// do mesmo backend é o defeito; um deles copiado no módulo seguinte é o custo.
//
// O caso que mais importa aqui é o 403, não o 404: colapsar TUDO em 404 seria a leitura
// preguiçosa da decisão, e diria "não existe" para alguém que está com o atlas aberto na
// tela. É por isso que cada caso 404 abaixo tem o seu par 403.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser, createShare } from '../helpers/fixtures.js';

describe('requireAtlasPermission — escada 404 (sem relação) vs 403 (nível insuficiente)', () => {
    let app, db;
    let dono, estranho, leitor, comentarista;
    let tokenDono, tokenEstranho, tokenLeitor, tokenComentarista;
    let atlas;

    before(async () => {
        const env = await setupTestEnv();
        app = env.app;
        db = env.db;

        dono = await createUser(db, { username: 'esc_dono' });
        estranho = await createUser(db, { username: 'esc_estranho' });
        leitor = await createUser(db, { username: 'esc_leitor' });
        comentarista = await createUser(db, { username: 'esc_comentarista' });

        tokenDono = await loginUser(app, dono.username, dono.password);
        tokenEstranho = await loginUser(app, estranho.username, estranho.password);
        tokenLeitor = await loginUser(app, leitor.username, leitor.password);
        tokenComentarista = await loginUser(app, comentarista.username, comentarista.password);

        atlas = await createAtlas(db, dono.id, { name: 'Atlas da Escada' });
        await createShare(db, atlas.id, leitor.id, 'read');
        await createShare(db, atlas.id, comentarista.id, 'comment');
    });

    after(async () => {
        await teardownTestEnv(db);
    });

    it('estranho recebe 404, indistinguível de atlas inexistente', async () => {
        const inexistente = randomUUID();

        const resExistente = await request(app)
            .get(`/api/v1/atlas/${atlas.id}`)
            .set('Authorization', `Bearer ${tokenEstranho}`);
        const resInexistente = await request(app)
            .get(`/api/v1/atlas/${inexistente}`)
            .set('Authorization', `Bearer ${tokenEstranho}`);

        assert.equal(resExistente.status, 404);
        assert.equal(resInexistente.status, 404);
        // Indistinguível é a propriedade, então o código E a mensagem têm que bater. Só o
        // status igual não basta: um 404 com "Access denied" no corpo vazaria do mesmo jeito.
        assert.equal(resExistente.body.error.code, resInexistente.body.error.code);
        assert.equal(resExistente.body.error.message, resInexistente.body.error.message);
    });

    it('o corpo do 404 do estranho não menciona permissão nem posse', async () => {
        const res = await request(app)
            .get(`/api/v1/atlas/${atlas.id}`)
            .set('Authorization', `Bearer ${tokenEstranho}`);

        assert.equal(res.status, 404);
        const corpo = JSON.stringify(res.body).toLowerCase();
        for (const vazamento of ['denied', 'permission', 'permissão', 'owner', 'forbidden', 'share']) {
            assert.ok(
                !corpo.includes(vazamento),
                `o corpo do 404 contém "${vazamento}", o que reintroduz o oráculo pelo texto`
            );
        }
    });

    it('anônimo toma 401 igual para atlas existente e inexistente (o 401 vem ANTES da escada)', async () => {
        // Escrevi este caso esperando 404 e o teste me refutou: a rota é `auth` ESTRITO, que
        // responde antes de `requireAtlasPermission` chegar a existir na cadeia. Corrigi o
        // teste, não o código, porque o comportamento real já satisfaz a propriedade que a
        // escada persegue: o 401 é IGUAL nos dois casos, então não entrega existência.
        const inexistente = randomUUID();
        const resExistente = await request(app).get(`/api/v1/atlas/${atlas.id}`);
        const resInexistente = await request(app).get(`/api/v1/atlas/${inexistente}`);

        assert.equal(resExistente.status, 401);
        assert.equal(resInexistente.status, 401);
        assert.equal(resExistente.body.error.code, resInexistente.body.error.code);
    });

    it('share de nível INSUFICIENTE continua 403, e é este o caso que não pode virar 404', async () => {
        // `read` tentando uma rota de escrita: o chamador demonstravelmente sabe que o atlas
        // existe (ele o lê), então 404 aqui seria mentira e apagaria o sinal de "peça nível".
        const res = await request(app)
            .put(`/api/v1/atlas/${atlas.id}`)
            .set('Authorization', `Bearer ${tokenLeitor}`)
            .send({ name: 'tentativa' });

        assert.equal(res.status, 403);
        assert.match(res.body.error.message, /Você não tem permissão/);
    });

    it('o nível do MEIO se comporta igual: comment escreve feição e toma 403, não 404', async () => {
        const res = await request(app)
            .put(`/api/v1/atlas/${atlas.id}`)
            .set('Authorization', `Bearer ${tokenComentarista}`)
            .send({ name: 'tentativa' });

        assert.equal(res.status, 403);
    });

    it('quem TEM nível continua passando (o guarda não virou negação universal)', async () => {
        // Sem este caso, uma "correção" que recusasse todo mundo passaria nos anteriores.
        const res = await request(app)
            .get(`/api/v1/atlas/${atlas.id}`)
            .set('Authorization', `Bearer ${tokenLeitor}`);

        assert.equal(res.status, 200);
        assert.equal(res.body.data.id, atlas.id);
    });

    it('o dono continua passando', async () => {
        const res = await request(app)
            .put(`/api/v1/atlas/${atlas.id}`)
            .set('Authorization', `Bearer ${tokenDono}`)
            .send({ name: 'Atlas da Escada renomeado' });

        assert.equal(res.status, 200);
    });
});
