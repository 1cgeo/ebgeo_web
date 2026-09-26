// Path: tests/integration/atlas-get-traz-o-nivel.test.js
//
// `GET /atlas/:atlasId` DEVOLVE O NÍVEL POR ATLAS DE QUEM PEDE (`user_permission`), desde 2026-09-25.
//
// POR QUE ISTO EXISTE. O nível por atlas chegava ao cliente num lugar só: o quadro `connected` do
// socket de colaboração. Atrás de um proxy que não repassa o Upgrade, o atlas passou a abrir SEM
// TEMPO REAL (`frontend/src/js/store/sync/sem-tempo-real.js`), e sem o quadro todo colaborador ficava
// na semente fechada de leitor, sem poder editar. O cliente lê o nível daqui e o traduz pelo espelho
// de `toFrontendRole` (`atlasRoleForPermission`, `frontend/src/js/projects/permission-levels.js`).
//
// O VALOR TEM DE SER O MESMO QUE O SOCKET ANUNCIA, e é por isso que cada caso abaixo é um ramo de
// `requireAtlasPermission`: o dono, a escada inteira, o máximo entre share direto e de grupo, o
// administrador global (topo da escada sem share nenhum), o produtor que NÃO faz curto-circuito, e o
// atlas público lido por conta estranha e por visitante de link. Uma divergência aqui daria à mesma
// pessoa um conjunto de botões com socket e outro sem.
//
// O CAMPO DESCREVE E NÃO CONCEDE: o caso do leitor que tenta escrever prova que a rota de escrita
// continua recusando quem o `user_permission` diz que só lê.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
    createUser, createAdminUser, createProducerUser, createAtlas, createMap, loginUser, createShare,
    createAccessGroup, addAccessGroupMember, createGroupShare, makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';

/** A OM semeada pelas migrações; o produtor precisa de uma (`users_producer_scope_check`). */
const OM_PADRAO = '00000000-0000-0000-0000-000000000001';

describe('GET /atlas/:atlasId devolve o nível por atlas de quem pede', () => {
    let app, db;
    let atlas, atlasPublico;
    const tokens = {};

    before(async () => {
        const env = await setupTestEnv();
        app = env.app;
        db = env.db;

        const dono = await createUser(db, { username: 'nivel_dono' });
        const contas = {
            dono,
            leitor: await createUser(db, { username: 'nivel_leitor' }),
            comentarista: await createUser(db, { username: 'nivel_comentarista' }),
            editor: await createUser(db, { username: 'nivel_editor' }),
            gestor: await createUser(db, { username: 'nivel_gestor' }),
            doGrupo: await createUser(db, { username: 'nivel_do_grupo' }),
            admin: await createAdminUser(db, { username: 'nivel_admin' }),
            produtorComShare: await createProducerUser(db, OM_PADRAO, { username: 'nivel_produtor' }),
            produtorSemShare: await createProducerUser(db, OM_PADRAO, { username: 'nivel_produtor_sem' }),
            estranho: await createUser(db, { username: 'nivel_estranho' }),
        };

        atlas = await createAtlas(db, dono.id, { name: 'Atlas do Nível' });
        await createMap(db, atlas.id, { name: 'Mapa do Nível' });
        await createShare(db, atlas.id, contas.leitor.id, 'read');
        await createShare(db, atlas.id, contas.comentarista.id, 'comment');
        await createShare(db, atlas.id, contas.editor.id, 'write');
        await createShare(db, atlas.id, contas.gestor.id, 'manage');
        await createShare(db, atlas.id, contas.produtorComShare.id, 'write');
        // Direto `read`, grupo `manage`: vale o maior, como no socket (`fn_user_atlas_shares`).
        await createShare(db, atlas.id, contas.doGrupo.id, 'read');
        const grupo = await createAccessGroup(db, dono.id);
        await addAccessGroupMember(db, grupo.id, contas.doGrupo.id);
        await createGroupShare(db, atlas.id, grupo.id, 'manage');

        atlasPublico = await createAtlas(db, dono.id, { name: 'Atlas Público do Nível' });
        const link = await makeAtlasPublic(db, atlasPublico.id);
        tokens.visitante = await getPublicToken(app, link);

        for (const [nome, conta] of Object.entries(contas)) {
            tokens[nome] = await loginUser(app, conta.username, conta.password);
        }
    });

    after(async () => {
        await teardownTestEnv(db);
    });

    /** O `user_permission` que a rota devolve para `token` neste `atlasId`, ou o status do erro. */
    async function nivel(token, atlasId = atlas.id) {
        const res = await request(app).get(`/api/v1/atlas/${atlasId}`).set('Authorization', `Bearer ${token}`);
        return res.status === 200 ? res.body.data.user_permission : res.status;
    }

    it('o dono lê `owner`', async () => {
        assert.equal(await nivel(tokens.dono), 'owner');
    });

    it('a escada inteira volta com o nível do share', async () => {
        assert.equal(await nivel(tokens.leitor), 'read');
        assert.equal(await nivel(tokens.comentarista), 'comment');
        assert.equal(await nivel(tokens.editor), 'write');
        assert.equal(await nivel(tokens.gestor), 'manage');
    });

    it('share direto e de grupo: vale o maior', async () => {
        assert.equal(await nivel(tokens.doGrupo), 'manage');
    });

    it('o administrador global lê o topo da escada sem share nenhum', async () => {
        assert.equal(await nivel(tokens.admin), 'owner');
    });

    it('o produtor NÃO faz curto-circuito: com share lê o share, sem share não vê o atlas', async () => {
        assert.equal(await nivel(tokens.produtorComShare), 'write');
        assert.equal(await nivel(tokens.produtorSemShare), 404);
    });

    it('atlas público: a conta estranha e o visitante de link leem `read`', async () => {
        assert.equal(await nivel(tokens.estranho, atlasPublico.id), 'read');
        assert.equal(await nivel(tokens.visitante, atlasPublico.id), 'read');
        assert.equal(await nivel(tokens.estranho), 404, 'o atlas privado continua invisível ao estranho');
    });

    it('o resto do corpo não muda: a chave é só somada', async () => {
        const res = await request(app).get(`/api/v1/atlas/${atlas.id}`).set('Authorization', `Bearer ${tokens.editor}`);
        assert.equal(res.status, 200);
        assert.equal(res.body.data.id, atlas.id);
        assert.equal(res.body.data.name, 'Atlas do Nível');
        assert.ok(Array.isArray(res.body.data.maps), 'o resumo dos mapas continua no corpo');
        assert.equal(res.body.data.maps.length, 1);
    });

    it('o campo descreve e não concede: o leitor continua sem escrever', async () => {
        assert.equal(await nivel(tokens.leitor), 'read');
        const res = await request(app)
            .put(`/api/v1/atlas/${atlas.id}`)
            .set('Authorization', `Bearer ${tokens.leitor}`)
            .send({ name: 'Renomeado por quem só lê' });
        assert.equal(res.status, 403);
    });
});
