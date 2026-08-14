import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    FIRST_PERSON_VIEWER,
    getFirstPersonScenes,
    getFirstPersonSceneById,
    hasFirstPersonScenes,
    resolveSceneAssets,
    resolveMarkerPhotoUrl
} from '@js/first_person_3d_tool/scene-config.service.js';
import config from '@js/config.js';

// A first-person scene is NOT a section of its own: it is a `config.tilesets` row
// carrying the discriminator `viewer: 'firstPerson'`. That choice is what makes the
// per-atlas allowlist (`available_3d_models`) and the "Modelos 3D" gate cover the
// scene for free, so the partition is the contract these tests pin.

/** A complete, usable scene row. */
const CENA_COMPLETA = Object.freeze({
    id: 'museu-1cgeo',
    name: 'Sala Histórica',
    viewer: FIRST_PERSON_VIEWER,
    basePath: '/3d/primeira-pessoa/museu-1cgeo'
});

/** A regular Cesium tileset: no discriminator, belongs to the 3D viewer. */
const TILESET_COMUM = Object.freeze({
    id: 'predio-x',
    name: 'Prédio X',
    url: '/api/v1/assets3d/predio-x/tileset.json'
});

/**
 * A row that WOULD survive `isUsableScene` (it has id and basePath) but carries no
 * first-person discriminator. Without this fixture the discriminator check is not
 * actually measured: the realistic tileset above has no `basePath`, so removing the
 * `viewer` test entirely still leaves the suite green.
 */
const TILESET_RESOLVIVEL_SEM_VIEWER = Object.freeze({
    id: 'acervo-y',
    name: 'Acervo Y',
    basePath: '/3d/acervo-y'
});

/** Same, but declaring a different viewer. */
const TILESET_OUTRO_VIEWER = Object.freeze({
    id: 'acervo-z',
    name: 'Acervo Z',
    viewer: 'cesium',
    basePath: '/3d/acervo-z'
});

/** Declared as first-person but unresolvable: no `basePath`. */
const CENA_SEM_BASEPATH = Object.freeze({
    id: 'sem-arquivos',
    name: 'Cena sem arquivos',
    viewer: FIRST_PERSON_VIEWER
});

/** Declared as first-person but unaddressable: no `id`. */
const CENA_SEM_ID = Object.freeze({
    name: 'Cena sem id',
    viewer: FIRST_PERSON_VIEWER,
    basePath: '/3d/primeira-pessoa/anonima'
});

let tilesetsOriginal;

beforeEach(() => {
    tilesetsOriginal = config.tilesets;
});

afterEach(() => {
    config.tilesets = tilesetsOriginal;
});

describe('partition of config.tilesets by viewer', () => {
    it('returns ONLY the complete first-person row out of three entries', () => {
        config.tilesets = [TILESET_COMUM, CENA_COMPLETA, CENA_SEM_BASEPATH];

        const scenes = getFirstPersonScenes();

        expect(scenes).toHaveLength(1);
        expect(scenes[0].id).toBe('museu-1cgeo');
    });

    it('leaves the plain tileset out: no discriminator, not a scene', () => {
        config.tilesets = [TILESET_COMUM, CENA_COMPLETA];

        const ids = getFirstPersonScenes().map(scene => scene.id);

        expect(ids).toEqual(['museu-1cgeo']);
        expect(ids).not.toContain('predio-x');
    });

    it('the DISCRIMINATOR alone decides, even for rows that are otherwise resolvable', () => {
        config.tilesets = [TILESET_RESOLVIVEL_SEM_VIEWER, TILESET_OUTRO_VIEWER, CENA_COMPLETA];

        const ids = getFirstPersonScenes().map(scene => scene.id);

        expect(ids).toEqual(['museu-1cgeo']);
        expect(ids).not.toContain('acervo-y');
        expect(ids).not.toContain('acervo-z');
        expect(getFirstPersonSceneById('acervo-y')).toBeNull();
    });

    it('DROPS the row without basePath, and that row is asserted by id', () => {
        config.tilesets = [CENA_COMPLETA, CENA_SEM_BASEPATH];

        const ids = getFirstPersonScenes().map(scene => scene.id);

        expect(ids).toEqual(['museu-1cgeo']);
        expect(ids).not.toContain('sem-arquivos');
        expect(getFirstPersonSceneById('sem-arquivos')).toBeNull();
    });

    it('DROPS the row without id, and that row is asserted by name', () => {
        config.tilesets = [CENA_COMPLETA, CENA_SEM_ID];

        const names = getFirstPersonScenes().map(scene => scene.name);

        expect(names).toEqual(['Sala Histórica']);
        expect(names).not.toContain('Cena sem id');
    });

    it('survives a missing or non-array tilesets without throwing', () => {
        config.tilesets = undefined;
        expect(getFirstPersonScenes()).toEqual([]);

        config.tilesets = { 'museu-1cgeo': CENA_COMPLETA };
        expect(getFirstPersonScenes()).toEqual([]);
    });

    it('tolerates a null hole in the array', () => {
        config.tilesets = [null, CENA_COMPLETA];
        expect(getFirstPersonScenes()).toHaveLength(1);
    });
});

describe('hasFirstPersonScenes derives from the SAME partition', () => {
    it('is false when only plain tilesets are configured, resolvable ones included', () => {
        config.tilesets = [TILESET_COMUM, TILESET_RESOLVIVEL_SEM_VIEWER, TILESET_OUTRO_VIEWER];
        expect(hasFirstPersonScenes()).toBe(false);
    });

    it('is false when every first-person row is unusable', () => {
        // The whole point of deriving instead of counting: a second rule such as
        // "any row with viewer === 'firstPerson'" would answer true here, the UI
        // would appear, and the click would fail inside the viewer.
        config.tilesets = [CENA_SEM_BASEPATH, CENA_SEM_ID];
        expect(getFirstPersonScenes()).toEqual([]);
        expect(hasFirstPersonScenes()).toBe(false);
    });

    it('is true as soon as one usable scene exists', () => {
        config.tilesets = [TILESET_COMUM, CENA_COMPLETA];
        expect(hasFirstPersonScenes()).toBe(true);
    });
});

describe('resolveSceneAssets', () => {
    it('gives the SAME URLs whether basePath ends in a slash or not', () => {
        const semBarra = resolveSceneAssets({ id: 'c', basePath: '/3d/cena' });
        const comBarra = resolveSceneAssets({ id: 'c', basePath: '/3d/cena/' });
        const comVariasBarras = resolveSceneAssets({ id: 'c', basePath: '/3d/cena///' });

        expect(comBarra).toEqual(semBarra);
        expect(comVariasBarras).toEqual(semBarra);
        // Absolute assertion too: comparing the three against each other alone
        // would pass with three identically wrong results.
        expect(semBarra.voxelBinUrl).toBe('/3d/cena/voxel/voxel.bin');
        expect(semBarra.splatUrl).toBe('/3d/cena/cena.sog');
        expect(semBarra.markersUrl).toBe('/3d/cena/marcadores.json');
    });

    it('honours a per-asset override, including one written with a leading "./"', () => {
        const assets = resolveSceneAssets({
            id: 'c',
            basePath: '/3d/cena/',
            splatUrl: './outra/cena.sog',
            voxelBinUrl: '/api/v1/assets3d/compartilhado/voxel.bin'
        });

        expect(assets.splatUrl).toBe('/3d/cena/outra/cena.sog');
        expect(assets.voxelBinUrl).toBe('/api/v1/assets3d/compartilhado/voxel.bin');
        // Untouched fields still come from the layout.
        expect(assets.voxelMetaUrl).toBe('/3d/cena/voxel/voxel-meta.json');
    });

    it('throws for an entry that is not a resolvable scene', () => {
        expect(() => resolveSceneAssets(CENA_SEM_BASEPATH)).toThrow(/id and a basePath/);
        expect(() => resolveSceneAssets(null)).toThrow(/id and a basePath/);
    });
});

describe('resolveMarkerPhotoUrl', () => {
    it('returns null for an empty, blank or absent photo', () => {
        expect(resolveMarkerPhotoUrl(CENA_COMPLETA, '')).toBeNull();
        expect(resolveMarkerPhotoUrl(CENA_COMPLETA, '   ')).toBeNull();
        expect(resolveMarkerPhotoUrl(CENA_COMPLETA, undefined)).toBeNull();
        expect(resolveMarkerPhotoUrl(CENA_COMPLETA, 42)).toBeNull();
    });

    it('returns null when the scene itself is unresolvable', () => {
        expect(resolveMarkerPhotoUrl(CENA_SEM_BASEPATH, 'itens/peca.jpg')).toBeNull();
    });

    it('resolves a scene-relative photo, "./" prefix included', () => {
        expect(resolveMarkerPhotoUrl(CENA_COMPLETA, 'itens/peca.jpg'))
            .toBe('/3d/primeira-pessoa/museu-1cgeo/itens/peca.jpg');
        expect(resolveMarkerPhotoUrl(CENA_COMPLETA, './itens/peca.jpg'))
            .toBe('/3d/primeira-pessoa/museu-1cgeo/itens/peca.jpg');
        expect(resolveMarkerPhotoUrl(CENA_COMPLETA, '  itens/peca.jpg  '))
            .toBe('/3d/primeira-pessoa/museu-1cgeo/itens/peca.jpg');
    });

    it('honours an address that already stands on its own', () => {
        expect(resolveMarkerPhotoUrl(CENA_COMPLETA, 'https://ex.mil.br/p.jpg'))
            .toBe('https://ex.mil.br/p.jpg');
        expect(resolveMarkerPhotoUrl(CENA_COMPLETA, '//ex.mil.br/p.jpg'))
            .toBe('//ex.mil.br/p.jpg');
        expect(resolveMarkerPhotoUrl(CENA_COMPLETA, '/imagens/p.jpg'))
            .toBe('/imagens/p.jpg');
    });

    it('does NOT let data: or javascript: through untouched — the scheme list is an ALLOWLIST', () => {
        // Pinned because the project document claims data:/blob: pass intact, and
        // that is false: anything outside https?:, // and / is joined onto the base,
        // which is what defuses a scheme injected through marcadores.json.
        expect(resolveMarkerPhotoUrl(CENA_COMPLETA, 'data:image/png;base64,AAAA'))
            .toBe('/3d/primeira-pessoa/museu-1cgeo/data:image/png;base64,AAAA');
        expect(resolveMarkerPhotoUrl(CENA_COMPLETA, 'javascript:alert(1)'))
            .toBe('/3d/primeira-pessoa/museu-1cgeo/javascript:alert(1)');
    });
});
