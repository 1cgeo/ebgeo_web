// Path: tests/e2e/tipo-de-png-como-o-servidor.e2e.test.js

/**
 * @fileoverview O ESPELHO DO TIPO DE PNG, contra o servidor real (2026-09-24, item 3 da segunda
 * revisão das fotos anexas).
 *
 * O cliente decide o tipo de um PNG percorrendo os pedaços como o detector do servidor
 * (`tipoDePng`, `src/js/utilities/image_utils.js`), e `tests/unit/tipo-de-png.test.js` prende o
 * cliente ao `esperado` de um corpus. Este arquivo prende o `esperado` ao SERVIDOR: cada arquivo do
 * corpus sobe declarado `image/png`, e o servidor o aceita se e só se o esperado é `image/png`. Sem
 * este lado, os dois testes poderiam concordar entre si e discordar do servidor.
 *
 * E o APNG não tem tipo declarável: declarado `image/apng`, a lista do servidor o recusa também. É
 * por isso que a figura que só existe como blob sobe achatada e a foto inline fica inline.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { E2E_SKIP, makeApi, registerAndLogin, createAtlas } from './helpers/harness.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';
import { mimeDosBytes } from '../../src/js/utilities/image_utils.js';
import { corpusDoTipoDePng, pngSintetico } from '../helpers/png-sintetico.js';

const base64 = (bytes) => Buffer.from(bytes).toString('base64');

describe.skipIf(E2E_SKIP)('E2E o tipo de PNG que o cliente decide é o que o servidor aceita', () => {
    let api;
    let atlasId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Tipo de PNG' });
        atlasId = (await createAtlas(api, { name: 'Tipo de PNG' })).id;
    });

    for (const { nome, bytes, esperado } of corpusDoTipoDePng()) {
        it(`${nome}: declarado image/png, o servidor ${esperado === 'image/png' ? 'aceita' : 'recusa'}`, async () => {
            // O cliente e o corpus concordam (o arquivo unitário cobre isso por três portas).
            expect(mimeDosBytes(bytes)).toBe(esperado);
            const localId = generateUUID();
            const res = await api.bulkUploadImages(atlasId, [
                { localId, filename: `${localId}.png`, mimeType: 'image/png', data: base64(bytes) },
            ]);
            if (esperado === 'image/png') {
                expect(res.failed).toEqual([]);
                expect(res.mapping[localId]).toBe(localId);
            } else {
                expect(res.mapping[localId]).toBeUndefined();
                expect(res.failed).toHaveLength(1);
                expect(res.failed[0]).toMatchObject({ localId, permanent: true });
            }
        });
    }

    it('declarado image/apng, o APNG também é recusado: não há tipo com que ele suba como está', async () => {
        const localId = generateUUID();
        // A lista de tipos é do esquema da rota: o pedido inteiro volta 422, antes de qualquer item.
        await expect(api.bulkUploadImages(atlasId, [
            { localId, filename: `${localId}.png`, mimeType: 'image/apng', data: base64(pngSintetico({ animado: true })) },
        ])).rejects.toMatchObject({ status: 422 });
    });
});
