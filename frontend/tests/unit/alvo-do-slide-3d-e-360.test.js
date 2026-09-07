// Path: tests/unit/alvo-do-slide-3d-e-360.test.js

/**
 * @fileoverview Prende o ALVO do slide de briefing no envio do atlas local ao servidor
 * (`buildServerImportPayload`, `src/js/import_export/local-atlas-to-server.js`).
 *
 * O DEFEITO QUE ELE EXISTE PARA REPROVAR (onda 3, B3-4). O mapeador gravava `model_id`/`photo_id`
 * só quando o valor já era UUID, e o produto NÃO identifica esses dois recursos por UUID: o
 * tileset é um slug (`museu-1cgeo`) e a foto 360 é um nome de arquivo (`FOTO_0001.jpg`). O
 * resultado medido no navegador, com o catálogo do servidor cadastrado, foi 1 slide `3d` e 1
 * slide `360` no banco com os dois campos NULOS: o modo fica, o alvo não, e o slide abre
 * apontando para nada.
 *
 * O CONTRATO DO SERVIDOR, lido na fonte antes do conserto:
 * - `backend/src/database/migrations/003_atlas.sql:435-436`: `model_id VARCHAR(100)` e
 *   `photo_id VARCHAR(100)`. A coluna sempre aceitou string.
 * - `backend/src/modules/atlas/atlas-resource-prune.js:211-212` e `:316-329`: o backend já lê os
 *   dois como string e os confere contra o catálogo por id de recurso.
 * - `backend/src/modules/atlas/atlas.schemas.js:251-252` era o ÚNICO portão que exigia UUID, e
 *   mudou junto (prova em `backend/tests/unit/alvo-do-slide-aceita-slug.test.js`).
 *
 * A MARCA É A STRING QUE CHEGA, nunca "não é nulo": o teste compara com o valor exato, porque um
 * UUID inventado no lugar do slug também seria "não nulo" e continuaria apontando para nada.
 */

import { describe, it, expect } from 'vitest';
import { buildServerImportPayload } from '@js/import_export/local-atlas-to-server.js';
import { generateUUID, isValidUUID } from '@utils/uuid.js';

/** Um briefing com um slide 3D e um slide 360, no formato do `.ebgeo`. */
function briefingCom(slides) {
    return [{ id: generateUUID(), name: 'Briefing A', description: '', settings: {}, slides }];
}

describe('B3-4: o alvo do slide 3D e do slide 360 atravessa o envio', () => {
    it('grava o slug do tileset e o nome do arquivo da foto 360, e nao nulo', () => {
        const { payload } = buildServerImportPayload({
            briefings: briefingCom([
                { id: generateUUID(), title: 'Cena', mode: '3d', modelId: 'museu-1cgeo' },
                { id: generateUUID(), title: 'Foto', mode: '360', photoId: 'FOTO_0001.jpg' },
            ]),
        }, { name: 'A' });

        const [slide3d, slide360] = payload.briefings[0].slides;
        expect(slide3d.mode).toBe('3d');
        expect(slide3d.model_id).toBe('museu-1cgeo');
        expect(slide360.mode).toBe('360');
        expect(slide360.photo_id).toBe('FOTO_0001.jpg');
    });

    it('o caso UUID continua passando intacto (o servidor tambem cunha id assim)', () => {
        const modelo = generateUUID();
        const foto = generateUUID();
        const { payload } = buildServerImportPayload({
            briefings: briefingCom([{ id: generateUUID(), mode: '3d', modelId: modelo, photoId: foto }]),
        }, { name: 'A' });

        const slide = payload.briefings[0].slides[0];
        expect(slide.model_id).toBe(modelo);
        expect(slide.photo_id).toBe(foto);
        expect(isValidUUID(slide.model_id)).toBe(true);
    });

    it('slide sem alvo continua com os dois campos nulos', () => {
        const { payload } = buildServerImportPayload({
            briefings: briefingCom([{ id: generateUUID(), mode: '2d', mapId: 'M' }]),
        }, { name: 'A' });

        const slide = payload.briefings[0].slides[0];
        expect(slide.model_id).toBeNull();
        expect(slide.photo_id).toBeNull();
    });

    it('valor vazio, nao-string ou maior que a coluna do servidor vira nulo, e nao lixo truncado', () => {
        const { payload } = buildServerImportPayload({
            briefings: briefingCom([
                { id: generateUUID(), mode: '3d', modelId: '', photoId: '   ' },
                { id: generateUUID(), mode: '3d', modelId: 'x'.repeat(101), photoId: { id: 'objeto' } },
                { id: generateUUID(), mode: '3d', modelId: 123, photoId: null },
            ]),
        }, { name: 'A' });

        for (const slide of payload.briefings[0].slides) {
            expect(slide.model_id).toBeNull();
            expect(slide.photo_id).toBeNull();
        }
    });

    it('o alvo com exatamente 100 caracteres (o teto da coluna) passa', () => {
        const noLimite = 'a'.repeat(100);
        const { payload } = buildServerImportPayload({
            briefings: briefingCom([{ id: generateUUID(), mode: '3d', modelId: noLimite }]),
        }, { name: 'A' });

        expect(payload.briefings[0].slides[0].model_id).toBe(noLimite);
    });
});
