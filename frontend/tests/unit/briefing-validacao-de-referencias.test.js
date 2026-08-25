// Path: tests/unit/briefing-validacao-de-referencias.test.js

/**
 * @fileoverview Pins `briefing/validation/reference-validator.js`.
 *
 * What this suite HOLDS:
 * - the POSITION check and its two strict comparisons: longitude 0 / latitude 0
 *   are NOT missing (Greenwich and the equator are legal slide positions), and
 *   an ABSENT coordinate (`undefined`, not `null`) slips past the check
 *   entirely, which is a defect and is flagged below;
 * - the legacy-360 heuristic `Math.abs(latitude) > 90`, including the strict
 *   boundary at exactly 90;
 * - the severity routing per mode: a missing map is a WARNING (2D can still be
 *   presented), a missing model or photo is an ERROR (the slide cannot draw);
 * - the 360 photo path when the id is not in the project cache: the API answer
 *   decides ERROR, and a THROWN answer degrades to WARNING rather than to a
 *   verdict the validator did not obtain;
 * - the cache contract of `_getAvailablePhotos`: `getCachedProjects() ?? await
 *   fetchProjects()`, so a MISS refetches and an EMPTY LIST does not, which is
 *   what keeps a scope switch from marking every 360 reference broken;
 * - `ValidationResult` and `ValidationError`: routing, summary text, and the
 *   1-based slide numbering shown to the user.
 *
 * What it does NOT reach: the real store, the real streetview API service, and
 * whether the config catalogue itself is right. All three are mocked here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getAllMapNamesStore = vi.fn(async () => []);
const getCachedProjects = vi.fn(() => []);
const fetchProjects = vi.fn(async () => []);
const validatePhoto = vi.fn(async () => true);

vi.mock('@store/index.js', () => ({
    SlideMode: Object.freeze({ MAP_2D: '2d', VIEWER_3D: '3d', VIEWER_360: '360' }),
    getAllMapNamesStore: (...a) => getAllMapNamesStore(...a),
}));

vi.mock('@js/street_view_tool/streetview-api.service.js', () => ({
    getCachedProjects: (...a) => getCachedProjects(...a),
    fetchProjects: (...a) => fetchProjects(...a),
    validatePhoto: (...a) => validatePhoto(...a),
}));

const config = (await import('../../src/js/config.js')).default;
const {
    ReferenceValidator,
    ValidationResult,
    ValidationError,
    ValidationErrorType,
    ErrorSeverity,
    validateBriefing,
} = await import('../../src/js/briefing/validation/reference-validator.js');

let savedConfig;

beforeEach(() => {
    vi.clearAllMocks();
    savedConfig = { tilesets: config.tilesets, features: config.features };
    config.tilesets = [];
    config.features = { ...config.features, imagens_panoramicas: true };
    getAllMapNamesStore.mockResolvedValue([]);
    getCachedProjects.mockReturnValue([]);
    fetchProjects.mockResolvedValue([]);
    validatePhoto.mockResolvedValue(true);
});

afterEach(() => {
    config.tilesets = savedConfig.tilesets;
    config.features = savedConfig.features;
    vi.restoreAllMocks();
});

const briefingOf = (...slides) => ({ id: 'b', name: 'B', slides });

const slide = (over = {}) => ({
    id: 's1',
    title: 'Titulo',
    mode: '2d',
    mapId: null,
    modelId: null,
    photoId: null,
    position: { longitude: -44, latitude: -22, zoom: 10, altitude: null },
    ...over,
});

const run = (...slides) => new ReferenceValidator().validate(briefingOf(...slides));

const typesOf = (result) => result.getAllIssues().map(e => e.errorType);

// ============================================================================
// Position check
// ============================================================================

describe('_validateSlide — the position check', () => {
    it('accepts a normal position with no issue at all', async () => {
        const result = await run(slide());
        expect(result.hasIssues()).toBe(false);
    });

    it('warns (not errors) when position is entirely absent', async () => {
        const result = await run(slide({ position: null }));
        expect(result.errors).toHaveLength(0);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].errorType).toBe(ValidationErrorType.NO_POSITION);
        expect(result.warnings[0].message).toBe('Posição não definida');
    });

    it('warns when either coordinate is explicitly null', async () => {
        const onlyLng = await run(slide({ position: { longitude: 1, latitude: null } }));
        const onlyLat = await run(slide({ position: { longitude: null, latitude: 1 } }));
        expect(typesOf(onlyLng)).toEqual([ValidationErrorType.NO_POSITION]);
        expect(typesOf(onlyLat)).toEqual([ValidationErrorType.NO_POSITION]);
    });

    it('REGRESSAO: longitude 0 and latitude 0 are a VALID position (Greenwich, equator)', async () => {
        // A `!longitude` test here would flag the null island as unpositioned.
        const result = await run(slide({ position: { longitude: 0, latitude: 0 } }));
        expect(result.hasIssues()).toBe(false);
    });

    it('REGRESSAO: negative zero is also a valid coordinate', async () => {
        const result = await run(slide({ position: { longitude: -0, latitude: -0 } }));
        expect(result.hasIssues()).toBe(false);
    });

    it('CONTROLE: the same slide with a null longitude IS flagged, so the check is live', async () => {
        const result = await run(slide({ position: { longitude: null, latitude: 0 } }));
        expect(typesOf(result)).toEqual([ValidationErrorType.NO_POSITION]);
    });

    it('CONSERTADO: an ABSENT coordinate (undefined) is flagged like the null one', async () => {
        // The comparison was `=== null`, so `{}` and `{ longitude: 1 }` read as
        // "has a position". A slide saved before the field existed, or one whose
        // capture failed, validated clean and then drew nowhere.
        expect(typesOf(await run(slide({ position: {} }))))
            .toEqual([ValidationErrorType.NO_POSITION]);
        expect(typesOf(await run(slide({ position: { longitude: 1 } }))))
            .toEqual([ValidationErrorType.NO_POSITION]);
    });

    it('CONSERTADO: a NaN coordinate is flagged too, which `?? 0` would not have caught', async () => {
        expect(typesOf(await run(slide({ position: { longitude: NaN, latitude: NaN } }))))
            .toEqual([ValidationErrorType.NO_POSITION]);
        expect(typesOf(await run(slide({ position: { longitude: 0, latitude: NaN } }))))
            .toEqual([ValidationErrorType.NO_POSITION]);
    });

    it('CONSERTADO: Infinity is flagged, being a coordinate no map can draw', async () => {
        expect(typesOf(await run(slide({ position: { longitude: Infinity, latitude: 0 } }))))
            .toEqual([ValidationErrorType.NO_POSITION]);
    });

    it('CONTROLE: a non-numeric STRING coordinate is flagged, a real number is not', () => {
        // Absolute pair, so a predicate that flagged everything would not pass.
        return Promise.all([
            run(slide({ position: { longitude: '10', latitude: '20' } })),
            run(slide({ position: { longitude: 10, latitude: 20 } })),
        ]).then(([asString, asNumber]) => {
            expect(typesOf(asString)).toEqual([ValidationErrorType.NO_POSITION]);
            expect(asNumber.hasIssues()).toBe(false);
        });
    });
});

// ============================================================================
// Legacy 360 position heuristic
// ============================================================================

describe('_validateSlide — legacy 360 camera rotation in position', () => {
    const photo360 = (position) => slide({
        mode: '360', photoId: 'p1', position,
    });

    beforeEach(() => {
        getCachedProjects.mockReturnValue([{ id: 'p1', name: 'Projeto' }]);
    });

    it('flags a latitude beyond 90 as a legacy camera rotation, as a WARNING', async () => {
        const result = await run(photo360({ longitude: 100, latitude: 120 }));
        expect(result.errors).toHaveLength(0);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].errorType).toBe(ValidationErrorType.NO_POSITION);
        expect(result.warnings[0].details)
            .toBe('Posição contém valores de rotação de câmera (briefing legado)');
    });

    it('flags a latitude below -90 the same way (absolute value)', async () => {
        const result = await run(photo360({ longitude: 0, latitude: -120 }));
        expect(result.warnings).toHaveLength(1);
    });

    it('does NOT flag latitude exactly 90 or -90 (the test is strictly greater)', async () => {
        expect((await run(photo360({ longitude: 0, latitude: 90 }))).hasIssues()).toBe(false);
        expect((await run(photo360({ longitude: 0, latitude: -90 }))).hasIssues()).toBe(false);
    });

    it('flags the smallest step past the boundary', async () => {
        const result = await run(photo360({ longitude: 0, latitude: 90.0000001 }));
        expect(result.warnings).toHaveLength(1);
    });

    it('does NOT look at longitude, so a 200-degree longitude passes', async () => {
        const result = await run(photo360({ longitude: 200, latitude: 10 }));
        expect(result.hasIssues()).toBe(false);
    });

    it('the heuristic only applies to 360 slides, not to 2D or 3D', async () => {
        config.tilesets = [{ id: 'm1' }];
        const twoD = await run(slide({ position: { longitude: 0, latitude: 120 } }));
        const threeD = await run(slide({
            mode: '3d', modelId: 'm1', position: { longitude: 0, latitude: 120 },
        }));
        expect(twoD.hasIssues()).toBe(false);
        expect(threeD.hasIssues()).toBe(false);
    });
});

// ============================================================================
// Mode-specific references
// ============================================================================

describe('_validateSlide — 2D mode', () => {
    it('accepts a slide with no map reference at all', async () => {
        const result = await run(slide({ mapId: null }));
        expect(result.hasIssues()).toBe(false);
    });

    it('accepts a map that exists (maps are keyed by NAME)', async () => {
        getAllMapNamesStore.mockResolvedValue(['Principal', 'Outro']);
        expect((await run(slide({ mapId: 'Principal' }))).hasIssues()).toBe(false);
    });

    it('WARNS for an unknown map and names the id in the details', async () => {
        getAllMapNamesStore.mockResolvedValue(['Principal']);
        const result = await run(slide({ mapId: 'Sumiu' }));
        expect(result.errors).toHaveLength(0);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].errorType).toBe(ValidationErrorType.MAP_NOT_FOUND);
        expect(result.warnings[0].details).toBe('ID: Sumiu');
    });

    it('a failing map lookup degrades to an EMPTY set, so every map reads as missing', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        getAllMapNamesStore.mockRejectedValue(new Error('store off'));
        const result = await run(slide({ mapId: 'Principal' }));
        expect(typesOf(result)).toEqual([ValidationErrorType.MAP_NOT_FOUND]);
    });
});

describe('_validateSlide — 3D mode', () => {
    it('ERRORS when no model is specified', async () => {
        const result = await run(slide({ mode: '3d', modelId: null }));
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].errorType).toBe(ValidationErrorType.MODEL_NOT_FOUND);
        expect(result.errors[0].details).toBe('Nenhum modelo especificado');
        expect(result.canPresent()).toBe(false);
    });

    it('ERRORS when the model is not in the catalogue', async () => {
        config.tilesets = [{ id: 'outro', name: 'Outro' }];
        const result = await run(slide({ mode: '3d', modelId: 'm1' }));
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].details).toBe('ID: m1');
    });

    it('accepts a model matched by ID or by NAME', async () => {
        config.tilesets = [{ id: 'm1', name: 'Modelo Um' }];
        expect((await run(slide({ mode: '3d', modelId: 'm1' }))).hasIssues()).toBe(false);
        expect((await run(slide({ mode: '3d', modelId: 'Modelo Um' }))).hasIssues()).toBe(false);
    });

    it('survives a catalogue entry with no id and no name', async () => {
        config.tilesets = [{}, { id: 'm1' }];
        expect((await run(slide({ mode: '3d', modelId: 'm1' }))).hasIssues()).toBe(false);
    });

    it('treats an absent tilesets list as an empty catalogue', async () => {
        config.tilesets = undefined;
        const result = await run(slide({ mode: '3d', modelId: 'm1' }));
        expect(typesOf(result)).toEqual([ValidationErrorType.MODEL_NOT_FOUND]);
    });
});

describe('_validateSlide — 360 mode', () => {
    it('ERRORS when no photo is specified', async () => {
        const result = await run(slide({ mode: '360', photoId: null }));
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].errorType).toBe(ValidationErrorType.PHOTO_NOT_FOUND);
        expect(result.errors[0].details).toBe('Nenhuma foto especificada');
    });

    it('accepts a photo matched by project id, project name or entryPhotoId', async () => {
        getCachedProjects.mockReturnValue([
            { id: 'p1', name: 'Projeto Um', entryPhotoId: 'foto-de-entrada' },
        ]);
        for (const photoId of ['p1', 'Projeto Um', 'foto-de-entrada']) {
            expect((await run(slide({ mode: '360', photoId }))).hasIssues()).toBe(false);
        }
        expect(validatePhoto).not.toHaveBeenCalled();
    });

    it('asks the API when the id is not in the cache, and accepts a positive answer', async () => {
        getCachedProjects.mockReturnValue([{ id: 'p1' }]);
        validatePhoto.mockResolvedValue(true);
        const result = await run(slide({ mode: '360', photoId: 'solta' }));
        expect(validatePhoto).toHaveBeenCalledWith('solta');
        expect(result.hasIssues()).toBe(false);
    });

    it('ERRORS when the API says the photo does not exist', async () => {
        validatePhoto.mockResolvedValue(false);
        const result = await run(slide({ mode: '360', photoId: 'solta' }));
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].details).toBe('ID: solta');
    });

    it('degrades to a WARNING when the API check itself fails', async () => {
        validatePhoto.mockRejectedValue(new Error('rede'));
        const result = await run(slide({ mode: '360', photoId: 'solta' }));
        expect(result.errors).toHaveLength(0);
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0].details).toBe('Não foi possível verificar: solta');
        expect(result.canPresent()).toBe(true);
    });

    it('returns an EMPTY photo set when the 360 feature is off, so every photo fails', async () => {
        config.features = { ...config.features, imagens_panoramicas: false };
        validatePhoto.mockResolvedValue(false);
        const result = await run(slide({ mode: '360', photoId: 'p1' }));
        expect(getCachedProjects).not.toHaveBeenCalled();
        expect(result.errors).toHaveLength(1);
    });
});

// ============================================================================
// The scope-keyed project cache
// ============================================================================

describe('_getAvailablePhotos — cache MISS refetches, empty list does not', () => {
    it('REGRESSAO: a cache miss (null) refetches instead of answering "no photos"', async () => {
        // The cache is keyed by access scope, so every login and atlas switch
        // invalidates it. Reading the miss as an empty set would break every
        // 360 reference right after opening an atlas.
        getCachedProjects.mockReturnValue(null);
        fetchProjects.mockResolvedValue([{ id: 'p1' }]);

        const result = await run(slide({ mode: '360', photoId: 'p1' }));
        expect(fetchProjects).toHaveBeenCalledTimes(1);
        expect(result.hasIssues()).toBe(false);
    });

    it('an undefined cache also refetches', async () => {
        getCachedProjects.mockReturnValue(undefined);
        fetchProjects.mockResolvedValue([{ id: 'p1' }]);
        await run(slide({ mode: '360', photoId: 'p1' }));
        expect(fetchProjects).toHaveBeenCalledTimes(1);
    });

    it('an EMPTY cached list is an answer, not a miss: no refetch', async () => {
        // `??` and not `||`: an atlas that really has no 360 project must not
        // hit the network on every validation.
        getCachedProjects.mockReturnValue([]);
        await run(slide({ mode: '360', photoId: 'p1' }));
        expect(fetchProjects).not.toHaveBeenCalled();
    });

    it('a throwing fetch degrades to an empty set without breaking validation', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        getCachedProjects.mockReturnValue(null);
        fetchProjects.mockRejectedValue(new Error('rede'));
        validatePhoto.mockResolvedValue(true);

        const result = await run(slide({ mode: '360', photoId: 'p1' }));
        expect(validatePhoto).toHaveBeenCalledWith('p1');
        expect(result.hasIssues()).toBe(false);
    });

    it('the project list is consulted ONCE per briefing, not once per slide', async () => {
        getCachedProjects.mockReturnValue([{ id: 'p1' }]);
        await run(
            slide({ id: 'a', mode: '360', photoId: 'p1' }),
            slide({ id: 'b', mode: '360', photoId: 'p1' }),
            slide({ id: 'c', mode: '360', photoId: 'p1' })
        );
        expect(getCachedProjects).toHaveBeenCalledTimes(1);
    });
});

// ============================================================================
// Mode routing
// ============================================================================

describe('_validateSlide — unknown modes', () => {
    it('ERRORS on a mode that is not one of the three', async () => {
        const result = await run(slide({ mode: 'holograma' }));
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].errorType).toBe(ValidationErrorType.INVALID_MODE);
        expect(result.errors[0].details).toBe('Modo: holograma');
    });

    it('OBSERVADO: a MISSING mode is not an invalid mode (falsy short-circuit)', async () => {
        expect((await run(slide({ mode: undefined }))).hasIssues()).toBe(false);
        expect((await run(slide({ mode: null }))).hasIssues()).toBe(false);
        expect((await run(slide({ mode: '' }))).hasIssues()).toBe(false);
    });

    it('a mode with the wrong case is invalid ("3D" is not "3d")', async () => {
        const result = await run(slide({ mode: '3D' }));
        expect(typesOf(result)).toEqual([ValidationErrorType.INVALID_MODE]);
    });
});

// ============================================================================
// validate() over a whole briefing
// ============================================================================

describe('ReferenceValidator.validate', () => {
    it('returns an empty result for a null briefing or one with no slides', async () => {
        const validator = new ReferenceValidator();
        expect((await validator.validate(null)).hasIssues()).toBe(false);
        expect((await validator.validate({})).hasIssues()).toBe(false);
        expect((await validator.validate({ slides: [] })).hasIssues()).toBe(false);
    });

    it('reports one issue per offending slide, numbered from 0 internally', async () => {
        const result = await run(
            slide({ id: 'a', position: null }),
            slide({ id: 'b' }),
            slide({ id: 'c', position: null })
        );
        expect(result.warnings).toHaveLength(2);
        expect(result.warnings.map(w => w.slideIndex)).toEqual([0, 2]);
        expect(result.warnings.map(w => w.slideId)).toEqual(['a', 'c']);
    });

    it('a single slide can raise BOTH a position warning and a reference error', async () => {
        const result = await run(slide({ mode: '3d', modelId: null, position: null }));
        expect(result.warnings).toHaveLength(1);
        expect(result.errors).toHaveLength(1);
        expect(result.getAllIssues()).toHaveLength(2);
        // getAllIssues puts errors first, regardless of the order they were added.
        expect(result.getAllIssues()[0].severity).toBe(ErrorSeverity.ERROR);
    });

    it('the factory function returns the same verdict as the class', async () => {
        const result = await validateBriefing(briefingOf(slide({ mode: 'holograma' })));
        expect(result).toBeInstanceOf(ValidationResult);
        expect(result.isValid()).toBe(false);
    });
});

// ============================================================================
// ValidationResult / ValidationError
// ============================================================================

describe('ValidationResult', () => {
    const err = (severity) => new ValidationError(
        0, 's', 'T', ValidationErrorType.NO_POSITION, severity
    );

    it('routes by severity, and anything that is not ERROR counts as a warning', () => {
        const r = new ValidationResult();
        r.addError(err(ErrorSeverity.ERROR));
        r.addError(err(ErrorSeverity.WARNING));
        r.addError(err('inventada'));
        expect(r.errors).toHaveLength(1);
        expect(r.warnings).toHaveLength(2);
    });

    it('isValid and canPresent ignore warnings and agree with each other', () => {
        const r = new ValidationResult();
        r.addError(err(ErrorSeverity.WARNING));
        expect(r.isValid()).toBe(true);
        expect(r.canPresent()).toBe(r.isValid());
        expect(r.hasIssues()).toBe(true);

        r.addError(err(ErrorSeverity.ERROR));
        expect(r.isValid()).toBe(false);
        expect(r.canPresent()).toBe(false);
    });

    it('getSummary has no leading or trailing comma in any of the three shapes', () => {
        const clean = new ValidationResult();
        expect(clean.getSummary()).toBe('Briefing valido');

        const onlyWarnings = new ValidationResult();
        onlyWarnings.addError(err(ErrorSeverity.WARNING));
        expect(onlyWarnings.getSummary()).toBe('1 aviso(s)');

        const both = new ValidationResult();
        both.addError(err(ErrorSeverity.ERROR));
        both.addError(err(ErrorSeverity.WARNING));
        expect(both.getSummary()).toBe('1 erro(s), 1 aviso(s)');
        expect(both.getSummary().startsWith(',')).toBe(false);
        expect(both.getSummary().endsWith(',')).toBe(false);
    });

    it('getAllIssues returns a NEW array that does not alias the internals', () => {
        const r = new ValidationResult();
        r.addError(err(ErrorSeverity.ERROR));
        const issues = r.getAllIssues();
        issues.push('lixo');
        expect(r.errors).toHaveLength(1);
        expect(r.getAllIssues()).toHaveLength(1);
    });
});

describe('ValidationError', () => {
    it('falls back to a 1-BASED slide label when the title is empty', () => {
        expect(new ValidationError(0, 's', '', ValidationErrorType.NO_POSITION, 'warning').slideTitle)
            .toBe('Slide 1');
        expect(new ValidationError(4, 's', null, ValidationErrorType.NO_POSITION, 'warning').slideTitle)
            .toBe('Slide 5');
    });

    it('keeps a supplied title', () => {
        expect(new ValidationError(0, 's', 'Meu', ValidationErrorType.NO_POSITION, 'warning').slideTitle)
            .toBe('Meu');
    });

    it('resolves the message from the type, and echoes an unknown type verbatim', () => {
        expect(new ValidationError(0, 's', 'T', ValidationErrorType.MODEL_NOT_FOUND, 'error').message)
            .toBe('Modelo 3D não encontrado');
        expect(new ValidationError(0, 's', 'T', 'tipo_novo', 'error').message).toBe('tipo_novo');
    });

    it('toString numbers the slide from 1 and marks the severity', () => {
        const e = new ValidationError(2, 's', 'Alvo', ValidationErrorType.PHOTO_NOT_FOUND, 'error', 'ID: p1');
        expect(e.toString()).toBe('[ERRO] Slide 3 "Alvo": Foto 360 não encontrada - ID: p1');
    });

    it('toString omits the details separator when there are no details', () => {
        const e = new ValidationError(0, 's', 'Alvo', ValidationErrorType.NO_POSITION, 'warning');
        expect(e.toString()).toBe('[AVISO] Slide 1 "Alvo": Posição não definida');
        expect(e.toString().endsWith('-')).toBe(false);
    });

    it('every declared error type has a message of its own', () => {
        const types = Object.values(ValidationErrorType);
        expect(types).toHaveLength(5);
        const messages = types.map(
            t => new ValidationError(0, 's', 'T', t, 'error').message
        );
        expect(new Set(messages).size).toBe(5);
        for (const m of messages) expect(m).not.toBe('');
    });
});
