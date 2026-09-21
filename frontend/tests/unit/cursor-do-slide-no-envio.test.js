// Path: tests/unit/cursor-do-slide-no-envio.test.js

/**
 * @fileoverview Prende o INSTANTE CONGELADO do slide no envio do atlas local ao servidor
 * (`buildServerImportPayload`, `src/js/import_export/local-atlas-to-server.js`).
 *
 * O DEFEITO (S3, tambem achado como I7, na auditoria do sistema temporal de 2026-09-21). O
 * construtor do payload mandava o INTERRUPTOR do slide (`temporal_enabled`) e nao mandava o CURSOR
 * (`temporal_cursor`), entao o slide chegava ao servidor com a linha do tempo LIGADA e sem
 * instante: ele abre num momento que o autor nunca escolheu, o que e pior do que chegar desligado.
 * O arquivo `.ebgeo` sempre preservou os dois, entao o mesmo briefing ganhava ou perdia o instante
 * conforme a porta usada.
 *
 * O CONTRATO DOS DOIS LADOS, lido na fonte:
 * - `backend/src/database/migrations/003_atlas.sql`: `slides.temporal_cursor JSONB`, nulavel.
 * - `backend/src/modules/sync/sync.service.js` grava nela um NUMERO
 *   (`JSON.stringify(data.temporal_cursor)`), que e a forma que o import precisa repetir.
 * - `src/js/briefing/editor/briefing-editor.control.js` escreve
 *   `Number.isFinite(cursor) ? cursor : null`, e `presentation/transition.service.js` so aplica
 *   cursor finito.
 *
 * A MARCA E O NUMERO EXATO, nunca "nao e nulo": um instante trocado aponta para outro momento e
 * continuaria passando numa asercao de presenca.
 */

import { describe, it, expect } from 'vitest';
import { buildServerImportPayload } from '@js/import_export/local-atlas-to-server.js';
import { generateUUID } from '@utils/uuid.js';

const INSTANTE = 1700000000000;

/** Um briefing no formato do `.ebgeo`, com os slides que o caso precisa. */
function briefingCom(slides) {
    return [{ id: generateUUID(), name: 'Briefing A', description: '', settings: {}, slides }];
}

/** O primeiro slide do payload montado para o servidor. */
function primeiroSlide(slides) {
    const { payload } = buildServerImportPayload({ briefings: briefingCom(slides) }, { name: 'A' });
    return payload.briefings[0].slides[0];
}

describe('S3: o instante congelado do slide viaja com o interruptor', () => {
    it('o cursor em epoch ms atravessa, ao lado do interruptor que ja atravessava', () => {
        const slide = primeiroSlide([
            { id: generateUUID(), title: 'T', mode: '2d', temporalEnabled: true, temporalCursor: INSTANTE },
        ]);
        expect(slide.temporal_cursor).toBe(INSTANTE);
        // Controle positivo: sem ele, um payload que perdesse os DOIS campos passaria igual.
        expect(slide.temporal_enabled).toBe(true);
    });

    it('slide sem instante manda nulo, que e o estado completo de "nenhum"', () => {
        const slide = primeiroSlide([{ id: generateUUID(), title: 'T', mode: '2d', temporalEnabled: true }]);
        expect(slide.temporal_cursor).toBeNull();
        expect(slide.temporal_enabled).toBe(true);
    });

    it('o zero do epoch e um instante legitimo e nao pode virar nulo', () => {
        // A armadilha classica: `s.temporalCursor || null` transformaria 1970-01-01 em ausencia.
        expect(primeiroSlide([{ id: generateUUID(), temporalCursor: 0 }]).temporal_cursor).toBe(0);
    });

    it('instante negativo (antes de 1970) tambem atravessa', () => {
        expect(primeiroSlide([{ id: generateUUID(), temporalCursor: -86400000 }]).temporal_cursor).toBe(-86400000);
    });

    it.each([
        ['texto de data', '2026-01-01'],
        ['objeto', { t: 1 }],
        ['NaN', Number.NaN],
        ['Infinity', Infinity],
        ['nulo explicito', null],
        ['ausente', undefined],
    ])('cursor ilegivel (%s) vira nulo, e nunca uma forma que a coluna nao le', (_rotulo, bruto) => {
        expect(primeiroSlide([{ id: generateUUID(), temporalCursor: bruto }]).temporal_cursor).toBeNull();
    });

    it('um briefing de varios slides preserva o instante de CADA um', () => {
        const { payload } = buildServerImportPayload({
            briefings: briefingCom([
                { id: generateUUID(), title: 'A', temporalCursor: INSTANTE },
                { id: generateUUID(), title: 'B' },
                { id: generateUUID(), title: 'C', temporalCursor: INSTANTE + 3600000 },
            ]),
        }, { name: 'A' });
        expect(payload.briefings[0].slides.map((s) => s.temporal_cursor))
            .toEqual([INSTANTE, null, INSTANTE + 3600000]);
    });
});
