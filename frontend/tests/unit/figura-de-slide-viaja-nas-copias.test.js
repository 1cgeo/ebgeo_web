// Path: tests/unit/figura-de-slide-viaja-nas-copias.test.js
//
// A FIGURA DE SLIDE POR REFERÊNCIA VIAJA EM TODA CÓPIA QUE SAI DESTE COMPUTADOR (decisão do dono de
// 2026-09-26). Os bytes moram no banco de imagens do atlas e o HTML do slide cita o id, então toda
// porta que copia o atlas tem de levar os bytes E manter a citação válida:
//   - o `.ebgeo`: a figura entra em `images/` (`collectUsedImageIds`) e, se faltar, a pergunta a
//     nomeia como figura de slide (`requiredImagesOf`);
//   - o envio de um atlas local ao servidor: a figura é citada, sobe sob o id NOVO e o HTML do slide
//     é reescrito para ele (`buildServerImportPayload`);
//   - a importação aditiva de um `.ebgeo` num atlas que já existe: o id é reemitido e o HTML segue
//     (`prepareAdditiveScope`, em `prepare-additive-scope.test.js`, que tem o arnês de IndexedDB).
// Uma porta que esquecesse a figura deixaria o slide copiado citando bytes que a cópia não tem, e
// a figura sumiria sem erro nenhum.

import { describe, it, expect } from 'vitest';
import { buildServerImportPayload } from '../../src/js/import_export/local-atlas-to-server.js';
import { requiredImagesOf, missingImagesConfirm, classifyMissingImages } from '../../src/js/import_export/ebgeo-missing-images.js';
import { srcDaFigura, idsDeFigurasNoHtml, idsDeFigurasDoDocumento } from '../../src/js/briefing/figura-de-slide.js';

const FIGURA = '11111111-1111-4111-8111-111111111111';
const COLADA = '22222222-2222-4222-8222-222222222222';
const html = (id) => `<p>legenda</p><p><img src="${srcDaFigura(id)}" width="320"></p>`;

const documento = () => ({
    maps: { Principal: { id: 'm1', features: {} } },
    mapNotes: { Principal: { title: 'Notas', description: html(COLADA) } },
    briefings: [{ id: 'b1', name: 'B', slides: [{ id: 's1', mapId: 'Principal', content: html(FIGURA) }] }],
});

describe('o documento de atlas cita as figuras de slide', () => {
    it('as do slide e a colada nas notas, sem repetir', () => {
        expect(idsDeFigurasDoDocumento(documento())).toEqual([FIGURA, COLADA]);
        expect(idsDeFigurasDoDocumento({ briefings: { b1: documento().briefings[0] } })).toEqual([FIGURA]);
        expect(idsDeFigurasDoDocumento({})).toEqual([]);
    });
});

describe('envio de atlas local ao servidor', () => {
    it('cita as figuras e reescreve o HTML para os ids novos', () => {
        const primeira = buildServerImportPayload(documento(), { name: 'A' });
        expect(primeira.imageIds).toEqual(expect.arrayContaining([FIGURA, COLADA]));
        const novo = { [FIGURA]: '33333333-3333-4333-8333-333333333333', [COLADA]: '44444444-4444-4444-8444-444444444444' };
        const { payload } = buildServerImportPayload(documento(), { name: 'A', imageIdMap: novo });
        const slide = payload.briefings[0].slides[0];
        expect(idsDeFigurasNoHtml(slide.content)).toEqual([novo[FIGURA]]);
        expect(slide.content).toContain('width="320"');
        expect(idsDeFigurasNoHtml(payload.maps[0].notes_description)).toEqual([novo[COLADA]]);
    });
});

describe('a figura de slide que falta é nomeada como figura de slide', () => {
    it('no export e no envio', () => {
        const exigidas = requiredImagesOf(documento());
        expect(exigidas).toEqual([
            { id: FIGURA, kind: 'slide', mapName: null },
            { id: COLADA, kind: 'slide', mapName: null },
        ]);
        expect(missingImagesConfirm(exigidas.slice(0, 1)).message).toContain('1 figura de slide');
        expect(missingImagesConfirm(exigidas).message).toContain('2 figuras de slide');
        expect(classifyMissingImages([FIGURA], documento())).toEqual([{ id: FIGURA, kind: 'slide', mapName: null }]);
    });
});
