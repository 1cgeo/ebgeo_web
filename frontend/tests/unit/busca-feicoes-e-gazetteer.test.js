// Path: tests/unit/busca-feicoes-e-gazetteer.test.js

/**
 * @fileoverview Pins two providers of `search/search-bar.search-providers.js`:
 * `searchLocalFeatures` (and through it the private `featureMatchesQuery` and
 * `getFeatureCenter`) and `searchAPI` (the gazetteer mapper).
 *
 * What this suite HOLDS:
 * - which feature fields are searched and in what PRECEDENCE, since the answer
 *   becomes the `matchedField` label the user reads;
 * - the centroid `getFeatureCenter` computes for each geometry kind, including
 *   the CLOSING vertex a GeoJSON ring carries, which is counted twice and skews
 *   the result away from the true centre;
 * - the `MAX_RESULTS.features` cap and the current-map-first ordering, plus the
 *   label suffix that only other maps get;
 * - `searchAPI`: the coordinate filter (longitude 0 is a legitimate value and
 *   must survive), the empty-string and NaN rejections, the 5-result cap, and
 *   the comma trimming of the `municipio, estado` line;
 * - that a wrapped-around map centre is wrapped/clamped before it reaches the
 *   query string.
 *
 * What it does NOT reach: `searchCoordinates` (a thin wrapper over the
 * coordinate converter, held by its own suites), `search3DModels` and
 * `searchStreetViewMarkers`, whose sources are the runtime config and the
 * scope-keyed project cache held elsewhere.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getCurrentMapFeatures = vi.fn(async () => ({}));
const getAllMapNamesStore = vi.fn(async () => []);
const getCurrentMapNameSync = vi.fn(() => 'Principal');
const getAllStorageTypes = vi.fn(() => ['points']);
const getFeatureDisplayNameFromStorage = vi.fn(() => 'Ponto');

vi.mock('@store/feature.operations.js', () => ({
    getCurrentMapFeatures: (...a) => getCurrentMapFeatures(...a),
}));
vi.mock('@store/map.operations.js', () => ({
    getAllMapNamesStore: (...a) => getAllMapNamesStore(...a),
    getCurrentMapNameSync: (...a) => getCurrentMapNameSync(...a),
}));
vi.mock('@store/store.constants.js', () => ({
    getAllStorageTypes: (...a) => getAllStorageTypes(...a),
    getFeatureDisplayNameFromStorage: (...a) => getFeatureDisplayNameFromStorage(...a),
}));
vi.mock('../../src/js/search/gazetteer-url.js', () => ({
    gazetteerSearchUrl: () => 'http://backend/nomes/busca',
}));

const { searchLocalFeatures, searchAPI } =
    await import('../../src/js/search/search-bar.search-providers.js');

const point = (props, coords = [1, 2]) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: coords },
    properties: props,
});

/** Installs a single map holding the given features under `points`. */
function onlyCurrentMap(features) {
    getCurrentMapNameSync.mockReturnValue('Principal');
    getAllMapNamesStore.mockResolvedValue(['Principal']);
    getCurrentMapFeatures.mockImplementation(async (mapName) =>
        mapName === 'Principal' ? { points: features } : {}
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    getAllStorageTypes.mockReturnValue(['points']);
    getFeatureDisplayNameFromStorage.mockReturnValue('Ponto');
    getCurrentMapNameSync.mockReturnValue('Principal');
    getAllMapNamesStore.mockResolvedValue(['Principal']);
    getCurrentMapFeatures.mockResolvedValue({});
});

// ============================================================================
// featureMatchesQuery, through searchLocalFeatures
// ============================================================================

describe('searchLocalFeatures — which field matched', () => {
    it('matches `name` and reports the field as "nome"', async () => {
        onlyCurrentMap([point({ name: 'Alvo Bravo' })]);
        const out = await searchLocalFeatures('bravo');
        expect(out).toHaveLength(1);
        expect(out[0].matchedField).toBe('nome');
        expect(out[0].name).toBe('Alvo Bravo');
    });

    it('matches the Portuguese `nome` as well', async () => {
        onlyCurrentMap([point({ nome: 'Alvo Bravo' })]);
        const out = await searchLocalFeatures('bravo');
        expect(out).toHaveLength(1);
        expect(out[0].matchedField).toBe('nome');
    });

    it('`name` wins over `nome` when both are present', async () => {
        onlyCurrentMap([point({ name: 'ingles', nome: 'portugues' })]);
        expect(await searchLocalFeatures('portugues')).toHaveLength(0);
        expect(await searchLocalFeatures('ingles')).toHaveLength(1);
    });

    it('matches the description and reports "descrição"', async () => {
        onlyCurrentMap([point({ name: 'X', descricao: 'posto avancado' })]);
        const out = await searchLocalFeatures('avancado');
        expect(out[0].matchedField).toBe('descrição');
    });

    it('matches a custom attribute and names the attribute in the label', async () => {
        onlyCurrentMap([point({ name: 'X', attributes: { Unidade: '1o BIL' } })]);
        const out = await searchLocalFeatures('1o bil');
        expect(out[0].matchedField).toBe('atributo: Unidade');
    });

    it('checks name, then description, then attributes, in that order', async () => {
        onlyCurrentMap([point({
            name: 'alvo', descricao: 'alvo', attributes: { a: 'alvo' },
        })]);
        expect((await searchLocalFeatures('alvo'))[0].matchedField).toBe('nome');
    });

    it('ignores a non-string attribute value instead of throwing', async () => {
        onlyCurrentMap([point({ name: 'X', attributes: { n: 42, ok: null, s: 'alvo' } })]);
        const out = await searchLocalFeatures('alvo');
        expect(out).toHaveLength(1);
        expect(out[0].matchedField).toBe('atributo: s');
    });

    it('skips a feature with no properties at all', async () => {
        onlyCurrentMap([{ type: 'Feature', geometry: null, properties: null }]);
        expect(await searchLocalFeatures('x')).toEqual([]);
    });

    it('CONSERTADO: uma feicao com nome nao-string apenas nao casa, e o mapa continua buscavel', async () => {
        // `props.name.toLowerCase()` had no type guard, and the caller wraps the
        // map scan in try/catch: ONE malformed feature made the whole map yield
        // nothing, with no error anywhere. Now the non-string is coerced away and
        // the sibling still matches.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        onlyCurrentMap([point({ name: 42 }), point({ name: 'alvo' })]);
        const out = await searchLocalFeatures('alvo');
        expect(out).toHaveLength(1);
        expect(out[0].name).toBe('alvo');
    });

    it('CONSERTADO: uma descricao nao-string tem o mesmo desfecho', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        onlyCurrentMap([point({ descricao: { texto: 'alvo' } }), point({ name: 'alvo' })]);
        expect(await searchLocalFeatures('alvo')).toHaveLength(1);
    });

    it('CONTROLE: a feicao malformada NAO casa por si so, ela so deixou de derrubar o mapa', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        onlyCurrentMap([point({ name: 42 })]);
        expect(await searchLocalFeatures('42')).toEqual([]);
    });

    it('CONTROLE: the same two features with string names return the match', async () => {
        onlyCurrentMap([point({ name: 'outro' }), point({ name: 'alvo' })]);
        expect(await searchLocalFeatures('alvo')).toHaveLength(1);
    });

    it('an EMPTY query matches every feature that has a name', async () => {
        onlyCurrentMap([point({ name: 'A' }), point({ name: 'B' })]);
        expect(await searchLocalFeatures('')).toHaveLength(2);
    });

    it('the query is lowercased but the feature side is too, so casing is irrelevant', async () => {
        onlyCurrentMap([point({ name: 'ALVO' })]);
        expect(await searchLocalFeatures('alvo')).toHaveLength(1);
        expect(await searchLocalFeatures('AlVo')).toHaveLength(1);
    });

    it('OBSERVADO: there is NO accent fold here, unlike the catalogue search', async () => {
        onlyCurrentMap([point({ name: 'Análise' })]);
        expect(await searchLocalFeatures('analise')).toHaveLength(0);
        expect(await searchLocalFeatures('análise')).toHaveLength(1);
    });

    it('falls back to "Sem nome" for a feature matched only by description', async () => {
        onlyCurrentMap([point({ descricao: 'alvo' })]);
        expect((await searchLocalFeatures('alvo'))[0].name).toBe('Sem nome');
    });
});

// ============================================================================
// getFeatureCenter, through the `coordinates` of each result
// ============================================================================

describe('searchLocalFeatures — the centre attached to each result', () => {
    const withGeometry = async (geometry) => {
        onlyCurrentMap([{
            type: 'Feature', geometry, properties: { name: 'alvo' },
        }]);
        const out = await searchLocalFeatures('alvo');
        expect(out).toHaveLength(1);
        return out[0].coordinates;
    };

    it('a Point yields its own coordinates, by reference', async () => {
        expect(await withGeometry({ type: 'Point', coordinates: [10, 20] }))
            .toEqual([10, 20]);
    });

    it('a Point keeps a third (altitude) component', async () => {
        expect(await withGeometry({ type: 'Point', coordinates: [10, 20, 300] }))
            .toEqual([10, 20, 300]);
    });

    it('a LineString yields the MIDDLE vertex, not an interpolated midpoint', async () => {
        expect(await withGeometry({
            type: 'LineString', coordinates: [[0, 0], [1, 1], [10, 10]],
        })).toEqual([1, 1]);
    });

    it('an EVEN-length LineString rounds the index down', async () => {
        expect(await withGeometry({
            type: 'LineString', coordinates: [[0, 0], [2, 2]],
        })).toEqual([2, 2]);
    });

    it('a single-vertex LineString yields that vertex', async () => {
        expect(await withGeometry({ type: 'LineString', coordinates: [[5, 5]] }))
            .toEqual([5, 5]);
    });

    it('CONSERTADO: a Polygon drops the closing vertex before averaging', async () => {
        // The unit square closed at [0,0] has five vertices; counting [0,0] twice
        // put the mean at (0.4, 0.4). The skew grows as the ring shrinks, so it is
        // worst exactly where a search result most needs to land on the shape.
        expect(await withGeometry({
            type: 'Polygon',
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        })).toEqual([0.5, 0.5]);
    });

    it('CONTROLE: the same ring WITHOUT the closing vertex still averages to the true centre', async () => {
        expect(await withGeometry({
            type: 'Polygon',
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]],
        })).toEqual([0.5, 0.5]);
    });

    it('CONTROLE: a ring whose ends merely LOOK alike is not truncated', async () => {
        // Only an exact repeat of the first vertex is dropped. A triangle whose
        // last vertex differs keeps all three, so the guard cannot silently eat a
        // real vertex.
        expect(await withGeometry({
            type: 'Polygon',
            coordinates: [[[0, 0], [3, 0], [0, 3]]],
        })).toEqual([1, 1]);
    });

    it('CONSERTADO: an EMPTY polygon ring yields null, not the [NaN, NaN] that flew the map nowhere', async () => {
        expect(await withGeometry({ type: 'Polygon', coordinates: [[]] })).toBeNull();
    });

    it('a degenerate ring of ONE repeated vertex yields that vertex, not null', async () => {
        expect(await withGeometry({ type: 'Polygon', coordinates: [[[7, 8], [7, 8]]] }))
            .toEqual([7, 8]);
    });

    it('a MultiPolygon is not handled and yields null', async () => {
        expect(await withGeometry({
            type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 1], [0, 0]]]],
        })).toBeNull();
    });

    it('an empty LineString and a missing geometry both yield null', async () => {
        expect(await withGeometry({ type: 'LineString', coordinates: [] })).toBeNull();
        expect(await withGeometry(null)).toBeNull();
    });
});

// ============================================================================
// searchLocalFeatures — cap and cross-map ordering
// ============================================================================

describe('searchLocalFeatures — the result cap and map ordering', () => {
    it('caps the current map at MAX_RESULTS.features (5)', async () => {
        onlyCurrentMap(Array.from({ length: 12 }, (_, i) => point({ name: `alvo ${i}` })));
        expect(await searchLocalFeatures('alvo')).toHaveLength(5);
    });

    it('labels the current map without a suffix and other maps WITH one', async () => {
        getCurrentMapNameSync.mockReturnValue('Principal');
        getAllMapNamesStore.mockResolvedValue(['Principal', 'Secundario']);
        getCurrentMapFeatures.mockImplementation(async (mapName) => ({
            points: [point({ name: `alvo de ${mapName}` })],
        }));

        const out = await searchLocalFeatures('alvo');
        expect(out).toHaveLength(2);
        expect(out[0].layer).toBe('Ponto');
        expect(out[0].mapName).toBeNull();
        expect(out[1].layer).toBe('Ponto · Secundario');
        expect(out[1].mapName).toBe('Secundario');
    });

    it('never revisits the current map while sweeping the others', async () => {
        getAllMapNamesStore.mockResolvedValue(['Principal', 'Outro']);
        getCurrentMapFeatures.mockResolvedValue({ points: [] });
        await searchLocalFeatures('alvo');
        const visited = getCurrentMapFeatures.mock.calls.map(c => c[0]);
        expect(visited).toEqual(['Principal', 'Outro']);
    });

    it('stops sweeping other maps once the cap is reached', async () => {
        getAllMapNamesStore.mockResolvedValue(['Principal', 'A', 'B', 'C']);
        getCurrentMapFeatures.mockImplementation(async (mapName) => ({
            points: mapName === 'Principal'
                ? []
                : Array.from({ length: 5 }, (_, i) => point({ name: `alvo ${mapName}${i}` })),
        }));

        const out = await searchLocalFeatures('alvo');
        expect(out).toHaveLength(5);
        expect(getCurrentMapFeatures.mock.calls.map(c => c[0])).toEqual(['Principal', 'A']);
    });

    it('a failing current-map read does not stop the other maps', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        getAllMapNamesStore.mockResolvedValue(['Principal', 'Outro']);
        getCurrentMapFeatures.mockImplementation(async (mapName) => {
            if (mapName === 'Principal') throw new Error('off');
            return { points: [point({ name: 'alvo' })] };
        });
        expect(await searchLocalFeatures('alvo')).toHaveLength(1);
    });

    it('sweeps every storage type declared by the store', async () => {
        getAllStorageTypes.mockReturnValue(['points', 'polygons', 'texts']);
        getCurrentMapFeatures.mockResolvedValue({
            points: [point({ name: 'alvo p' })],
            texts: [point({ name: 'alvo t' })],
        });
        const out = await searchLocalFeatures('alvo');
        expect(out.map(r => r.subtype)).toEqual(['points', 'texts']);
    });
});

// ============================================================================
// searchAPI
// ============================================================================

describe('searchAPI', () => {
    const map = (lng, lat) => ({ getCenter: () => ({ lng, lat }) });

    const respond = (data, ok = true, status = 200) => {
        globalThis.fetch = vi.fn(async () => ({
            ok, status, json: async () => data,
        }));
    };

    const row = (over = {}) => ({
        nome: 'Serra', longitude: -44, latitude: -22,
        municipio: 'Resende', estado: 'RJ', ...over,
    });

    it('throws when the response is not ok', async () => {
        respond(null, false, 503);
        await expect(searchAPI('x', map(0, 0))).rejects.toThrow('API error: 503');
    });

    it('returns an empty list when the payload is not an array', async () => {
        respond({ erro: 'nada' });
        expect(await searchAPI('x', map(0, 0))).toEqual([]);
    });

    it('maps a row into the place shape', async () => {
        respond([row()]);
        const out = await searchAPI('serra', map(-44, -22));
        expect(out).toEqual([{
            type: 'place',
            name: 'Serra',
            description: 'Resende, RJ',
            coordinates: [-44, -22],
            original: row(),
        }]);
    });

    it('REGRESSAO: longitude 0 and latitude 0 are KEPT (Greenwich, equator)', async () => {
        respond([row({ longitude: 0, latitude: 0 })]);
        const out = await searchAPI('x', map(0, 0));
        expect(out).toHaveLength(1);
        expect(out[0].coordinates).toEqual([0, 0]);
    });

    it('CONTROLE: a null coordinate IS dropped, so the filter is live', async () => {
        respond([row({ longitude: null })]);
        expect(await searchAPI('x', map(0, 0))).toEqual([]);
    });

    it('drops rows with an empty-string, undefined or NaN coordinate', async () => {
        respond([
            row({ longitude: '' }),
            row({ latitude: undefined }),
            row({ longitude: 'abc' }),
        ]);
        expect(await searchAPI('x', map(0, 0))).toEqual([]);
    });

    it('drops a row with no name', async () => {
        respond([row({ nome: '' }), row({ nome: null })]);
        expect(await searchAPI('x', map(0, 0))).toEqual([]);
    });

    it('OBSERVADO: a NUMERIC-STRING coordinate survives and is passed through as a string', async () => {
        respond([row({ longitude: '-44', latitude: '-22' })]);
        const out = await searchAPI('x', map(0, 0));
        expect(out[0].coordinates).toEqual(['-44', '-22']);
    });

    it('caps at MAX_RESULTS.places (5)', async () => {
        respond(Array.from({ length: 9 }, (_, i) => row({ nome: `S${i}` })));
        expect(await searchAPI('x', map(0, 0))).toHaveLength(5);
    });

    it('trims the trailing comma when the state is missing', async () => {
        respond([row({ estado: undefined })]);
        expect((await searchAPI('x', map(0, 0)))[0].description).toBe('Resende');
    });

    it('trims the LEADING comma when the municipality is missing', async () => {
        respond([row({ municipio: undefined })]);
        expect((await searchAPI('x', map(0, 0)))[0].description).toBe(' RJ');
    });

    it('OBSERVADO: with both missing the description collapses to the empty string', async () => {
        respond([row({ municipio: undefined, estado: undefined })]);
        expect((await searchAPI('x', map(0, 0)))[0].description).toBe('');
    });

    it('wraps a longitude past the antimeridian before querying', async () => {
        respond([]);
        await searchAPI('x', map(200, 10));
        const url = globalThis.fetch.mock.calls[0][0];
        expect(url).toContain('lon=-160');
        expect(url).not.toContain('lon=200');
    });

    it('clamps a latitude past the pole', async () => {
        respond([]);
        await searchAPI('x', map(0, 120));
        expect(globalThis.fetch.mock.calls[0][0]).toContain('lat=90');
    });

    it('percent-encodes the query and forwards the abort signal', async () => {
        respond([]);
        const controller = new AbortController();
        await searchAPI('a b&c', map(0, 0), controller.signal);
        const [url, options] = globalThis.fetch.mock.calls[0];
        expect(url).toContain('q=a%20b%26c');
        expect(options.signal).toBe(controller.signal);
    });
});
