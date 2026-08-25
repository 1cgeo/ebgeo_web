// Path: tests/integration/busca-feicao-malformada-apaga-o-mapa.repro.test.js

/**
 * @fileoverview Repro: ONE malformed feature made a whole map invisible to the search.
 *
 * ROOT CAUSE. `featureMatchesQuery` (`js/search/search-bar.search-providers.js`) read
 * `props.name || props.nome || ''` and then called `.toLowerCase()` on it. `||` only
 * guards FALSY values, so a `nome` that arrived as a number, an object or an array
 * reached `String.prototype.toLowerCase` and threw.
 *
 * WHY IT WAS INVISIBLE. The throw did not reach the user as an error: `searchLocalFeatures`
 * wraps the scan of EACH MAP in `try/catch` and logs to the console. So the observable
 * effect was that every feature of that map stopped being findable, in silence. One bad
 * row hid all its neighbours.
 *
 * FIX. Coerce non-strings to '' before the comparison. The malformed feature simply
 * does not match; the map keeps working.
 *
 * The same file carried a second defect this repro also holds: `getFeatureCenter`
 * averaged the polygon ring INCLUDING the closing vertex, so the "fly to" of a search
 * result landed off-centre, worst on the smallest rings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getCurrentMapFeatures = vi.fn(async () => ({}));
const getAllMapNamesStore = vi.fn(async () => []);
const getCurrentMapNameSync = vi.fn(() => 'Principal');

vi.mock('@store/feature.operations.js', () => ({
    getCurrentMapFeatures: (...a) => getCurrentMapFeatures(...a),
}));
vi.mock('@store/map.operations.js', () => ({
    getAllMapNamesStore: (...a) => getAllMapNamesStore(...a),
    getCurrentMapNameSync: (...a) => getCurrentMapNameSync(...a),
}));
vi.mock('@store/store.constants.js', () => ({
    getAllStorageTypes: () => ['points'],
    getFeatureDisplayNameFromStorage: () => 'Ponto',
}));
vi.mock('../../src/js/search/gazetteer-url.js', () => ({
    gazetteerSearchUrl: () => 'http://backend/nomes/busca',
}));

const { searchLocalFeatures } =
    await import('../../src/js/search/search-bar.search-providers.js');

const ponto = (props, coords = [1, 2]) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: coords },
    properties: props,
});

/** Installs a single map holding `features` under `points`. */
function mapaCom(features) {
    getCurrentMapFeatures.mockImplementation(async () => ({ points: features }));
    getAllMapNamesStore.mockImplementation(async () => ['Principal']);
}

describe('uma feicao malformada nao apaga a busca do mapa inteiro', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        getCurrentMapNameSync.mockReturnValue('Principal');
    });

    it('o vizinho BEM formado continua sendo achado', () => {
        mapaCom([ponto({ nome: 42 }), ponto({ nome: 'Posto Alvo' })]);
        return searchLocalFeatures('alvo').then((out) => {
            expect(out).toHaveLength(1);
            expect(out[0].name).toBe('Posto Alvo');
        });
    });

    it('as quatro formas de campo nao-string tem o mesmo desfecho', async () => {
        for (const ruim of [42, { texto: 'alvo' }, ['alvo'], true]) {
            mapaCom([ponto({ nome: ruim }), ponto({ descricao: ruim }), ponto({ nome: 'Alvo' })]);
            const out = await searchLocalFeatures('alvo');
            expect(out.map((r) => r.name), String(ruim)).toEqual(['Alvo']);
        }
    });

    it('CONTROLE: a feicao malformada NAO passa a casar por si so', () => {
        // O conserto e "nao casa", nao "casa com tudo": coagir para '' faria a
        // feicao ruim casar com a consulta VAZIA se o guarda fosse mal escrito.
        mapaCom([ponto({ nome: 42 })]);
        return searchLocalFeatures('42').then((out) => expect(out).toEqual([]));
    });

    it('CONTROLE: sem feicao malformada nenhuma a busca continua a mesma', () => {
        mapaCom([ponto({ nome: 'Outro' }), ponto({ nome: 'Alvo' })]);
        return searchLocalFeatures('alvo').then((out) => expect(out).toHaveLength(1));
    });

    it('o centro do resultado de um poligono nao conta o vertice de fechamento duas vezes', async () => {
        // Um quadrado unitario FECHADO tem cinco vertices e [0,0] entrava duas vezes,
        // puxando o centro para [0.4, 0.4]. O erro cresce quanto menor o anel.
        mapaCom([{
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
            properties: { nome: 'Alvo' },
        }]);
        const out = await searchLocalFeatures('alvo');
        expect(out[0].coordinates).toEqual([0.5, 0.5]);
    });
});
