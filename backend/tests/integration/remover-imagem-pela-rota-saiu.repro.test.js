// Path: tests/integration/remover-imagem-pela-rota-saiu.repro.test.js
//
// A ROTA DELETE /atlas/:atlasId/images/:imageId SAIU em 2026-09-26, por decisao do dono.
//
// Ela apagava a linha e o ARQUIVO de uma imagem com permissao `write`, sem passar pela trava do
// mapa nem pela lixeira (a clausula 7.4 da CONSTITUICAO.md so conhece exclusao que se restaura), e
// nenhum cliente a chamava: era codigo morto com o poder de destruir bytes que uma feicao de outro
// usuario ainda citava. A limpeza de imagem do produto e a coleta de orfas
// (`src/modules/images/imagens-orfas.service.js`), so do administrador e com carencia de 30 dias.
//
// O caso afirma o que importa para quem tem o atlas: o pedido nao apaga nada. Nem o dono nem um
// Editor removem a linha nem o arquivo, e a imagem continua servida depois do pedido.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';

// A 1x1 PNG. The padding after IEND keeps the magic bytes intact and makes each upload distinct,
// so no two cases share a row by content.
const PNG_1X1 = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108020000009077' +
    '53de0000000c4944415408d763f8cfc0000003010100c9fe92ef0000000049454e44ae426082',
    'hex'
);
let enchimento = 0;
const pngProprio = () => Buffer.concat([PNG_1X1, Buffer.alloc(++enchimento, 0x00)]);

describe('a rota de remover imagem de atlas saiu: o pedido nao apaga nada', () => {
    let app, db, atlas, ownerToken, writerToken;

    before(async () => {
        const env = await setupTestEnv();
        app = env.app;
        db = env.db;
        const owner = await createUser(db, { username: 'rota_img_owner' });
        const writer = await createUser(db, { username: 'rota_img_writer' });
        atlas = await createAtlas(db, owner.id, { name: 'Rota de imagem que saiu' });
        await db.query(
            `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'write', $3)`,
            [atlas.id, writer.id, owner.id]
        );
        ownerToken = await loginUser(app, owner.username, owner.password);
        writerToken = await loginUser(app, writer.username, writer.password);
    });

    after(async () => {
        await teardownTestEnv();
    });

    for (const [quem, token] of [['o dono', () => ownerToken], ['um Editor', () => writerToken]]) {
        it(`${quem} pede a remocao, e a linha, o arquivo e a leitura continuam`, async () => {
            const up = await supertest(app)
                .post(`/api/v1/atlas/${atlas.id}/images`)
                .set('Authorization', `Bearer ${token()}`)
                .attach('image', pngProprio(), { filename: 'fica.png', contentType: 'image/png' });
            assert.equal(up.status, 201, `upload devolveu ${up.status}: bytes distintos criam linha nova`);
            const imageId = up.body.data.id;
            const { rows: antes } = await db.query('SELECT storage_path FROM images WHERE id = $1', [imageId]);
            assert.equal(antes.length, 1, 'a imagem nao chegou a existir: o caso nao mediria nada');
            assert.equal(existsSync(antes[0].storage_path), true, 'o arquivo da imagem nao existe antes do pedido');

            const res = await supertest(app)
                .delete(`/api/v1/atlas/${atlas.id}/images/${imageId}`)
                .set('Authorization', `Bearer ${token()}`);
            assert.equal(res.status, 404, `a rota ainda responde ${res.status}: ela deveria nao existir`);

            const { rows: depois } = await db.query('SELECT id FROM images WHERE id = $1', [imageId]);
            assert.equal(depois.length, 1, 'a linha da imagem sumiu');
            assert.equal(existsSync(antes[0].storage_path), true, 'o arquivo da imagem sumiu do disco');
            await supertest(app)
                .get(`/api/v1/atlas/${atlas.id}/images/${imageId}`)
                .set('Authorization', `Bearer ${token()}`)
                .expect(200);
        });
    }
});
