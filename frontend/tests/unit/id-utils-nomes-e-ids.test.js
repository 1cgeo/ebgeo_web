// Path: tests/unit/id-utils-nomes-e-ids.test.js

/**
 * @fileoverview Pins `utilities/id_utils.js`: the unique-name generator shared
 * by layers and maps, the id factories, and `regenerateMapIds`.
 *
 * What this suite HOLDS:
 * - `findNextAvailableName` (reached through `generateUniqueLayerName` and
 *   `generateUniqueMapName`): the GAP-FILL policy (lowest free number >= 2, not
 *   max + 1), the "base name is free" short-circuit, and the regex escaping of
 *   the base name, which is what keeps `a.b` from matching `axb`;
 * - the crash a layer with no `name` causes there (a real defect, flagged);
 * - `generateUniqueId` / `generateFeatureIds` / `generateGeoJSONId`: form and
 *   uniqueness, and the fact that the GeoJSON id is a timestamp-plus-noise
 *   integer with no uniqueness guarantee at all;
 * - `hasImageResource`: the naive plural strip, including the words it mangles;
 * - `regenerateMapIds`: every feature gets a fresh UUID, `layerId` is remapped
 *   only when a mapping is supplied, resources are duplicated with the ORIGINAL
 *   ids (phase separation), and the input object is not mutated.
 *
 * What it does NOT reach: `generateFeatureName`, which asks a live MapLibre
 * source for its data, and the real store behind the mock below.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

const storeMock = {
    getFeatureDisplayName: vi.fn(),
    getStorageTypeFromSource: vi.fn(),
    hasImageResource: vi.fn(() => false),
    getImage: vi.fn(async () => null),
    storeImage: vi.fn(async () => {}),
};

vi.mock('../../src/js/store', () => storeMock);

const { IDUtils } = await import('../../src/js/utilities/id_utils.js');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const layers = (...names) => names.map(name => ({ name }));

beforeEach(() => {
    vi.clearAllMocks();
    storeMock.hasImageResource.mockReturnValue(false);
    storeMock.getImage.mockResolvedValue(null);
});

// ============================================================================
// generateUniqueLayerName / generateUniqueMapName
// ============================================================================

describe('generateUniqueLayerName — empty and default cases', () => {
    it('returns the base name when nothing exists', () => {
        expect(IDUtils.generateUniqueLayerName([], 'Camada')).toBe('Camada');
    });

    it('returns the base name when the list is null or undefined', () => {
        expect(IDUtils.generateUniqueLayerName(null, 'Camada')).toBe('Camada');
        expect(IDUtils.generateUniqueLayerName(undefined, 'Camada')).toBe('Camada');
    });

    it('defaults the base name to "Nova Camada"', () => {
        expect(IDUtils.generateUniqueLayerName([])).toBe('Nova Camada');
        expect(IDUtils.generateUniqueLayerName(layers('Nova Camada')))
            .toBe('Nova Camada #2');
    });

    it('defaults the MAP base name to "Novo Mapa"', () => {
        expect(IDUtils.generateUniqueMapName([])).toBe('Novo Mapa');
        expect(IDUtils.generateUniqueMapName(['Novo Mapa'])).toBe('Novo Mapa #2');
    });

    it('the map variant takes bare strings, the layer variant takes objects', () => {
        expect(IDUtils.generateUniqueMapName(null, 'Mapa')).toBe('Mapa');
        expect(IDUtils.generateUniqueMapName(['Mapa'], 'Mapa')).toBe('Mapa #2');
    });
});

describe('generateUniqueLayerName — numbering starts at 2, never at 1', () => {
    it('the unsuffixed name counts as number 1', () => {
        expect(IDUtils.generateUniqueLayerName(layers('X'), 'X')).toBe('X #2');
    });

    it('"X #1" is a DISTINCT name that does not reserve slot 1', () => {
        // The pattern reads "X #1" as number 1 too, so it also blocks the bare
        // name; what it never produces is "#1" as an output.
        expect(IDUtils.generateUniqueLayerName(layers('X #1'), 'X')).toBe('X #2');
    });

    it('a suffixed name alone leaves the BARE name free', () => {
        expect(IDUtils.generateUniqueLayerName(layers('X #2'), 'X')).toBe('X');
        expect(IDUtils.generateUniqueLayerName(layers('X #7'), 'X')).toBe('X');
    });
});

describe('generateUniqueLayerName — gap fill, not max + 1', () => {
    it('fills the hole left in the middle of a sequence', () => {
        expect(IDUtils.generateUniqueLayerName(layers('X', 'X #2', 'X #4'), 'X'))
            .toBe('X #3');
    });

    it('walks past a dense prefix', () => {
        expect(IDUtils.generateUniqueLayerName(layers('X', 'X #2', 'X #3', 'X #4'), 'X'))
            .toBe('X #5');
    });

    it('ignores a huge number when a low one is free', () => {
        expect(IDUtils.generateUniqueLayerName(layers('X', 'X #900'), 'X')).toBe('X #2');
    });

    it('ignores names belonging to a different base', () => {
        expect(IDUtils.generateUniqueLayerName(layers('X', 'Y #2', 'XX #2'), 'X'))
            .toBe('X #2');
    });

    it('ignores a suffix that is not a plain integer', () => {
        expect(IDUtils.generateUniqueLayerName(layers('X', 'X #2a', 'X # 2', 'X #-2'), 'X'))
            .toBe('X #2');
    });

    it('reads a zero-padded suffix as its numeric value', () => {
        // parseInt('02', 10) === 2, so "X #02" occupies slot 2.
        expect(IDUtils.generateUniqueLayerName(layers('X', 'X #02'), 'X')).toBe('X #3');
    });
});

describe('generateUniqueLayerName — the base name is escaped before it becomes a regex', () => {
    it('a dot in the base name is literal, so it does not match any character', () => {
        expect(IDUtils.generateUniqueLayerName(layers('axb'), 'a.b')).toBe('a.b');
        expect(IDUtils.generateUniqueLayerName(layers('a.b'), 'a.b')).toBe('a.b #2');
    });

    it('survives a base name full of metacharacters', () => {
        const base = 'C+ (1) [x] $y ^z |w \\q?';
        expect(IDUtils.generateUniqueLayerName([], base)).toBe(base);
        expect(IDUtils.generateUniqueLayerName(layers(base), base)).toBe(`${base} #2`);
    });

    it('OBSERVADO: "#" is NOT escaped, but it is not a metacharacter either', () => {
        // A base name that already ends in a suffix stacks another one.
        expect(IDUtils.generateUniqueLayerName(layers('X #2'), 'X #2')).toBe('X #2 #2');
    });
});

describe('generateUniqueLayerName — invariants (fast-check)', () => {
    it('the generated name is never already taken', () => {
        fc.assert(
            fc.property(
                fc.array(fc.integer({ min: 1, max: 12 }), { maxLength: 12 }),
                (numbers) => {
                    const existing = numbers.map(n => (n === 1 ? 'Base' : `Base #${n}`));
                    const out = IDUtils.generateUniqueLayerName(layers(...existing), 'Base');
                    expect(existing).not.toContain(out);
                }
            ),
            { numRuns: 200 }
        );
    });

    it('the generated name is either the base or "base #N" with N >= 2', () => {
        fc.assert(
            fc.property(
                fc.array(fc.integer({ min: 1, max: 30 }), { maxLength: 20 }),
                (numbers) => {
                    const existing = numbers.map(n => (n === 1 ? 'Base' : `Base #${n}`));
                    const out = IDUtils.generateUniqueLayerName(layers(...existing), 'Base');
                    if (out === 'Base') return;
                    const match = out.match(/^Base #(\d+)$/);
                    expect(match).not.toBeNull();
                    expect(Number(match[1])).toBeGreaterThanOrEqual(2);
                }
            ),
            { numRuns: 200 }
        );
    });

    it('adding the generated name and asking again yields a DIFFERENT name', () => {
        fc.assert(
            fc.property(
                fc.array(fc.integer({ min: 1, max: 8 }), { maxLength: 8 }),
                (numbers) => {
                    const existing = numbers.map(n => (n === 1 ? 'B' : `B #${n}`));
                    const first = IDUtils.generateUniqueLayerName(layers(...existing), 'B');
                    const second = IDUtils.generateUniqueLayerName(
                        layers(...existing, first), 'B'
                    );
                    expect(second).not.toBe(first);
                }
            ),
            { numRuns: 200 }
        );
    });
});

describe('generateUniqueLayerName — a layer without a name (DEFEITO)', () => {
    it('CONTROLE: the same call with a named layer succeeds', () => {
        expect(IDUtils.generateUniqueLayerName([{ name: 'X' }], 'X')).toBe('X #2');
    });

    it('CONSERTADO: a layer whose name is undefined is SKIPPED, not fatal', () => {
        // `existingNames` is mapped straight off `layer.name` and handed to
        // `String.prototype.match`; there was no guard between the two, and one
        // half-written layer took the whole "new layer" gesture down.
        expect(IDUtils.generateUniqueLayerName([{ id: 'l1' }], 'X')).toBe('X');
        expect(IDUtils.generateUniqueLayerName([{ name: null }], 'X')).toBe('X');
    });

    it('CONSERTADO: a nameless layer next to a named one does not hide the named one', () => {
        // Esta e a perda que o throw causava: o vizinho bem formado sumia junto.
        expect(IDUtils.generateUniqueLayerName([{ id: 'l1' }, { name: 'X' }], 'X'))
            .toBe('X #2');
    });

    it('CONSERTADO: a numeric map name is skipped too', () => {
        expect(IDUtils.generateUniqueMapName([123], 'X')).toBe('X');
        expect(IDUtils.generateUniqueMapName([123, 'X'], 'X')).toBe('X #2');
    });

    it('CONTROLE: o nome que EXISTE continua reservando o numero', () => {
        // Sem isto o conserto seria indistinguivel de pular tudo.
        expect(IDUtils.generateUniqueLayerName([{ name: 'X' }, { name: 'X #2' }], 'X'))
            .toBe('X #3');
    });
});

// ============================================================================
// Id factories
// ============================================================================

describe('generateUniqueId / generateFeatureIds', () => {
    it('generateUniqueId returns a UUID v4', () => {
        expect(IDUtils.generateUniqueId()).toMatch(UUID_V4);
    });

    it('generateUniqueId does not repeat across 500 draws', () => {
        const seen = new Set();
        for (let i = 0; i < 500; i++) seen.add(IDUtils.generateUniqueId());
        expect(seen.size).toBe(500);
    });

    it('generateFeatureIds returns a UUID for `id` and an integer for `geoJsonId`', () => {
        const ids = IDUtils.generateFeatureIds();
        expect(Object.keys(ids).sort()).toEqual(['geoJsonId', 'id']);
        expect(ids.id).toMatch(UUID_V4);
        expect(Number.isInteger(ids.geoJsonId)).toBe(true);
    });

    it('generateGeoJSONId sits within [now, now + 10000)', () => {
        const before = Date.now();
        const id = IDUtils.generateGeoJSONId();
        expect(id).toBeGreaterThanOrEqual(before);
        expect(id).toBeLessThan(Date.now() + 10000);
    });

    it('OBSERVADO: within one millisecond the id space is only 10000 wide', () => {
        // Frozen clock, so the statement is deterministic rather than a
        // birthday-paradox estimate: every draw made in the same millisecond
        // comes out of a 10000-value box, which is why uniqueness is NOT a
        // property of this function and the sync identity is `properties.id`.
        const frozen = 1_700_000_000_000;
        const spy = vi.spyOn(Date, 'now').mockReturnValue(frozen);
        try {
            const draws = Array.from({ length: 300 }, () => IDUtils.generateGeoJSONId());
            expect(draws).toHaveLength(300);
            for (const id of draws) {
                expect(id).toBeGreaterThanOrEqual(frozen);
                expect(id).toBeLessThanOrEqual(frozen + 9999);
            }
        } finally {
            spy.mockRestore();
        }
    });
});

// ============================================================================
// hasImageResource
// ============================================================================

describe('hasImageResource — the plural strip', () => {
    it('strips a trailing s before asking the store', () => {
        IDUtils.hasImageResource('images');
        expect(storeMock.hasImageResource).toHaveBeenCalledTimes(1);
        expect(storeMock.hasImageResource).toHaveBeenCalledWith('image');
    });

    it('leaves a singular type untouched', () => {
        IDUtils.hasImageResource('text');
        expect(storeMock.hasImageResource).toHaveBeenCalledWith('text');
    });

    it('strips only ONE character, so "military_symbols" resolves correctly', () => {
        IDUtils.hasImageResource('military_symbols');
        expect(storeMock.hasImageResource).toHaveBeenCalledWith('military_symbol');
    });

    it('returns whatever the store says', () => {
        storeMock.hasImageResource.mockReturnValue(true);
        expect(IDUtils.hasImageResource('images')).toBe(true);
        storeMock.hasImageResource.mockReturnValue(false);
        expect(IDUtils.hasImageResource('images')).toBe(false);
    });

    it('OBSERVADO: the strip is naive and mangles a singular type ending in s', () => {
        // 'los' (line of sight) becomes 'lo'; the store is asked about a type
        // that does not exist and answers no.
        IDUtils.hasImageResource('los');
        expect(storeMock.hasImageResource).toHaveBeenCalledWith('lo');
    });

    it('OBSERVADO: an empty string passes through, a nullish type throws', () => {
        IDUtils.hasImageResource('');
        expect(storeMock.hasImageResource).toHaveBeenCalledWith('');
        expect(() => IDUtils.hasImageResource(null)).toThrow(TypeError);
    });
});

// ============================================================================
// regenerateMapIds
// ============================================================================

const mapDataWith = (featuresByType) => ({
    nome: 'Antigo',
    name: 'Antigo',
    id: 'old-map-id',
    features: featuresByType,
});

const feature = (id, layerId) => ({
    type: 'Feature',
    id: 1,
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { id, layerId },
});

describe('regenerateMapIds', () => {
    it('gives every feature a fresh UUID and reports the mapping', async () => {
        const input = mapDataWith({ points: [feature('a'), feature('b')] });
        const { newMapData, idMapping } = await IDUtils.regenerateMapIds(input, 'Novo');

        expect(idMapping.size).toBe(2);
        expect(newMapData.features.points).toHaveLength(2);
        for (const f of newMapData.features.points) {
            expect(f.properties.id).toMatch(UUID_V4);
        }
        expect(idMapping.get('a')).toBe(newMapData.features.points[0].properties.id);
        expect(idMapping.get('b')).toBe(newMapData.features.points[1].properties.id);
        expect(idMapping.get('a')).not.toBe(idMapping.get('b'));
    });

    it('renames the map on BOTH fields and clears the id', async () => {
        const input = mapDataWith({ points: [feature('a')] });
        const { newMapData } = await IDUtils.regenerateMapIds(input, 'Novo');

        expect(newMapData.nome).toBe('Novo');
        expect(newMapData.name).toBe('Novo');
        expect(newMapData.id).toBeNull();
    });

    it('does not mutate the input map data', async () => {
        const input = mapDataWith({ points: [feature('a', 'L1')] });
        await IDUtils.regenerateMapIds(input, 'Novo');

        expect(input.nome).toBe('Antigo');
        expect(input.id).toBe('old-map-id');
        expect(input.features.points[0].properties.id).toBe('a');
    });

    it('assigns a fresh numeric GeoJSON id alongside the UUID', async () => {
        const input = mapDataWith({ points: [feature('a')] });
        const { newMapData } = await IDUtils.regenerateMapIds(input, 'Novo');
        expect(Number.isInteger(newMapData.features.points[0].id)).toBe(true);
        expect(newMapData.features.points[0].id).not.toBe(1);
    });

    it('remaps layerId only when a mapping is given, and only for known layers', async () => {
        const input = mapDataWith({ points: [feature('a', 'L1'), feature('b', 'L9')] });
        const mapping = new Map([['L1', 'L1-new']]);
        const { newMapData } = await IDUtils.regenerateMapIds(input, 'Novo', mapping);

        expect(newMapData.features.points[0].properties.layerId).toBe('L1-new');
        expect(newMapData.features.points[1].properties.layerId).toBe('L9');
    });

    it('leaves layerId alone when no mapping is supplied', async () => {
        const input = mapDataWith({ points: [feature('a', 'L1')] });
        const { newMapData } = await IDUtils.regenerateMapIds(input, 'Novo');
        expect(newMapData.features.points[0].properties.layerId).toBe('L1');
    });

    it('skips a feature bucket that is not an array', async () => {
        const input = mapDataWith({ points: [feature('a')], broken: null, other: 'x' });
        const { newMapData, idMapping } = await IDUtils.regenerateMapIds(input, 'Novo');
        expect(idMapping.size).toBe(1);
        expect(newMapData.features.broken).toBeNull();
    });

    it('duplicates image resources using the ORIGINAL ids (phase separation)', async () => {
        storeMock.hasImageResource.mockReturnValue(true);
        storeMock.getImage.mockResolvedValue(new Uint8Array([1, 2, 3]));

        const input = mapDataWith({ images: [feature('img-a'), feature('img-b')] });
        const { idMapping } = await IDUtils.regenerateMapIds(input, 'Novo');

        expect(storeMock.getImage).toHaveBeenCalledTimes(2);
        expect(storeMock.getImage.mock.calls.map(c => c[0])).toEqual(['img-a', 'img-b']);
        expect(storeMock.storeImage).toHaveBeenCalledTimes(2);
        expect(storeMock.storeImage.mock.calls.map(c => c[0]))
            .toEqual([idMapping.get('img-a'), idMapping.get('img-b')]);
    });

    it('does not duplicate anything for a type without image resources', async () => {
        storeMock.hasImageResource.mockReturnValue(false);
        const input = mapDataWith({ points: [feature('a')] });
        await IDUtils.regenerateMapIds(input, 'Novo');
        expect(storeMock.getImage).not.toHaveBeenCalled();
        expect(storeMock.storeImage).not.toHaveBeenCalled();
    });

    it('survives a missing blob and a throwing store without losing the id remap', async () => {
        storeMock.hasImageResource.mockReturnValue(true);
        storeMock.getImage.mockRejectedValue(new Error('disk gone'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const input = mapDataWith({ images: [feature('img-a')] });
        const { newMapData } = await IDUtils.regenerateMapIds(input, 'Novo');

        expect(newMapData.features.images[0].properties.id).toMatch(UUID_V4);
        expect(storeMock.storeImage).not.toHaveBeenCalled();
        vi.restoreAllMocks();
    });

    it('handles an empty feature map without throwing', async () => {
        const { newMapData, idMapping } = await IDUtils.regenerateMapIds(
            mapDataWith({}), 'Novo'
        );
        expect(idMapping.size).toBe(0);
        expect(newMapData.nome).toBe('Novo');
    });
});
