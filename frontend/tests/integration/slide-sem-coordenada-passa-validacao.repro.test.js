// Path: tests/integration/slide-sem-coordenada-passa-validacao.repro.test.js

/**
 * @fileoverview Repro: a briefing slide with NO coordinate validated clean and then
 * drew nowhere.
 *
 * ROOT CAUSE. `_validateSlide` (`js/briefing/validation/reference-validator.js`) asked
 * `slide.position.longitude === null || slide.position.latitude === null`. That is a
 * test for ONE spelling of absence. A slide saved before the field existed, or one
 * whose capture failed, carries `position: {}` or `{ longitude: 1 }` or a pair of NaN,
 * and every one of those answered "has a position".
 *
 * WHAT IT COST. Validation is what the presenter and the PDF export consult BEFORE
 * running. A clean verdict on a positionless slide is worse than a warning: the
 * presentation starts, reaches the slide and the camera goes nowhere, with nothing on
 * screen having said so.
 *
 * FIX. `Number.isFinite` on both coordinates. It is the predicate the house rule names
 * for exactly this: `?? 0` would let NaN through. Negative zero stays valid.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getAllMapNamesStore = vi.fn(async () => []);

vi.mock('@store/index.js', () => ({
    SlideMode: Object.freeze({ MAP_2D: '2d', VIEWER_3D: '3d', VIEWER_360: '360' }),
    getAllMapNamesStore: (...a) => getAllMapNamesStore(...a),
}));

vi.mock('@js/street_view_tool/streetview-api.service.js', () => ({
    getCachedProjects: () => [],
    fetchProjects: async () => [],
    validatePhoto: async () => true,
}));

const config = (await import('../../src/js/config.js')).default;
const { validateBriefing, ValidationErrorType } =
    await import('../../src/js/briefing/validation/reference-validator.js');

let saved;

beforeEach(() => {
    vi.clearAllMocks();
    saved = { tilesets: config.tilesets, features: config.features };
    config.tilesets = [];
    config.features = { ...config.features, imagens_panoramicas: true };
    getAllMapNamesStore.mockResolvedValue([]);
});

afterEach(() => {
    config.tilesets = saved.tilesets;
    config.features = saved.features;
});

const comPosicao = (position) => ({
    id: 'b',
    name: 'B',
    slides: [{ id: 's1', title: 'Titulo', mode: '2d', position }],
});

const tipos = (r) => r.getAllIssues().map((e) => e.errorType);

describe('slide sem coordenada e ACUSADO, nao aprovado em silencio', () => {
    it('as cinco formas de "sem coordenada" acusam NO_POSITION', async () => {
        const ausentes = [
            {},
            { longitude: 1 },
            { latitude: 1 },
            { longitude: null, latitude: 0 },
            { longitude: NaN, latitude: NaN },
        ];
        for (const position of ausentes) {
            const r = await validateBriefing(comPosicao(position));
            expect(tipos(r), JSON.stringify(position))
                .toEqual([ValidationErrorType.NO_POSITION]);
        }
        // Cobertura vazia passaria verde se a lista estivesse vazia.
        expect(ausentes).toHaveLength(5);
    });

    it('Infinity tambem acusa, sendo coordenada que mapa nenhum desenha', async () => {
        const r = await validateBriefing(comPosicao({ longitude: Infinity, latitude: 0 }));
        expect(tipos(r)).toEqual([ValidationErrorType.NO_POSITION]);
    });

    it('CONTROLE: as coordenadas legitimas continuam passando limpas', async () => {
        // Sem estas o conserto seria indistinguivel de acusar todo slide. Greenwich,
        // o equador e o zero negativo sao posicoes validas, e ja eram.
        for (const position of [
            { longitude: 0, latitude: 0 },
            { longitude: -0, latitude: -0 },
            { longitude: -44.45, latitude: -22.46 },
            { longitude: 180, latitude: -90 },
        ]) {
            const r = await validateBriefing(comPosicao(position));
            expect(r.hasIssues(), JSON.stringify(position)).toBe(false);
        }
    });

    it('a ausencia do objeto `position` inteiro continua acusando', async () => {
        expect(tipos(await validateBriefing(comPosicao(undefined))))
            .toEqual([ValidationErrorType.NO_POSITION]);
        expect(tipos(await validateBriefing(comPosicao(null))))
            .toEqual([ValidationErrorType.NO_POSITION]);
    });
});
