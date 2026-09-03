import { describe, it, expect, vi } from 'vitest';

/**
 * As camadas da Linha de Coordenacao nascem AINDA QUE o mapa nunca tenha tido uma.
 *
 * A migracao v2.3 da a todo mapa GRAVADO a sua chave `coordination_lines`, mas esta
 * funcao tambem roda sobre dado que nunca passou por ela. Se o setup desistir
 * quando o balde falta, a fonte e as tres camadas nao sao criadas, e a ferramenta
 * ativa, aceita clique e nao desenha nada:
 * toda escrita passa por `getSource(...)?.setData`, e o encadeamento opcional
 * engole a ausencia sem erro, sem log e sem nada na tela.
 *
 * O `mapInstance` aqui e um dublê: o setup so precisa de getSource/addSource e
 * getLayer/addLayer, o que torna a funcao testavel em `node` sem MapLibre.
 */

vi.mock('../../src/js/store/index.js', () => ({ getControl: () => null }));
vi.mock('@store', () => ({ getControl: () => null }));

const { setupCoordinationLineLayers } = await import('../../src/js/layers/styles/tactical.layers.js');

/** Mapa de mentira que registra o que foi criado. */
function fakeMap() {
    const sources = new Map();
    const layers = new Map();
    return {
        sources,
        layers,
        getSource: (id) => sources.get(id),
        addSource: (id, def) => sources.set(id, { ...def, setData(d) { this.data = d; } }),
        getLayer: (id) => layers.get(id),
        addLayer: (def) => layers.set(def.id, def),
    };
}

const FONTES = ['coordination_lines', 'coordination-line-feedback', 'coordination-line-edit-handles'];
const CAMADAS = ['coordination-line-layer', 'coordination-line-feedback-layer', 'coordination-line-edit-handles-layer'];

describe('setupCoordinationLineLayers', () => {
    it('cria as tres fontes e as tres camadas quando o balde existe', () => {
        const map = fakeMap();
        setupCoordinationLineLayers({ coordination_lines: [] }, map);

        for (const f of FONTES) expect(map.getSource(f), f).toBeDefined();
        for (const c of CAMADAS) expect(map.getLayer(c), c).toBeDefined();
    });

    it('WORST CASE: cria tudo IGUAL num mapa que nunca teve o balde', () => {
        // O caso real: dado que chega sem a chave, por nao ter passado pela
        // migracao de armazenamento.
        const map = fakeMap();
        setupCoordinationLineLayers({ points: [], lines: [] }, map);

        for (const f of FONTES) expect(map.getSource(f), f).toBeDefined();
        for (const c of CAMADAS) expect(map.getLayer(c), c).toBeDefined();
    });

    it('a fonte nasce com uma FeatureCollection valida, nunca com features indefinido', () => {
        // `setOrCreateSource` monta `{ type, features }` sem checar: passar o balde
        // ausente adiante gravaria `features: undefined`, que nao e GeoJSON valido.
        const map = fakeMap();
        setupCoordinationLineLayers({}, map);

        const dados = map.getSource('coordination_lines').data;
        expect(dados.type).toBe('FeatureCollection');
        expect(Array.isArray(dados.features)).toBe(true);
        expect(dados.features).toEqual([]);
    });

    it('sobrevive a um balde corrompido sem lancar', () => {
        for (const lixo of ['nao sou array', 42, null, { }]) {
            const map = fakeMap();
            expect(() => setupCoordinationLineLayers({ coordination_lines: lixo }, map),
                String(lixo)).not.toThrow();
            expect(Array.isArray(map.getSource('coordination_lines').data.features)).toBe(true);
        }
    });

    it('nao recria fonte nem camada que ja existem', () => {
        const map = fakeMap();
        setupCoordinationLineLayers({ coordination_lines: [] }, map);
        const antes = [map.sources.size, map.layers.size];

        setupCoordinationLineLayers({ coordination_lines: [] }, map);
        expect([map.sources.size, map.layers.size]).toEqual(antes);
    });
});
