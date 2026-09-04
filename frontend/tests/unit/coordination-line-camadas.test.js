// Path: tests/unit/coordination-line-camadas.test.js

import { describe, it, expect, vi } from 'vitest';

/**
 * As camadas da Linha de Coordenacao nascem AINDA QUE o mapa nunca tenha tido uma.
 *
 * Os tres caminhos de leitura (importador de `.ebgeo`, snapshot do servidor e leitura do
 * IndexedDB) dao a todo mapa a chave `coordination_lines` por `ensureCoordinationLines`, mas
 * esta funcao tambem roda sobre dado que nunca passou por eles: um objeto de mapa recem
 * montado, um fixture de teste. Se o setup desistir quando o balde falta, a fonte e as tres
 * camadas nao sao criadas, e a ferramenta ativa, aceita clique e nao desenha nada: toda
 * escrita passa por `getSource(...)?.setData`, e o encadeamento opcional engole a ausencia
 * sem erro, sem log e sem nada na tela.
 *
 * O `mapInstance` aqui e um duble: o setup so precisa de getSource/addSource e
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

    it('PIOR CASO: cria tudo IGUAL num mapa que nunca teve o balde', () => {
        // O caso real: dado que chega sem a chave, por nao ter passado por nenhum dos tres
        // caminhos de leitura que normalizam a forma.
        const map = fakeMap();
        setupCoordinationLineLayers({ points: [], lines: [] }, map);

        for (const f of FONTES) expect(map.getSource(f), f).toBeDefined();
        for (const c of CAMADAS) expect(map.getLayer(c), c).toBeDefined();
    });

    it('a fonte nasce com uma FeatureCollection valida, nunca com features indefinido', () => {
        // `setOrCreateSource` monta `{ type, features }` sem checar: passar o balde ausente
        // adiante gravaria `features: undefined`, que nao e GeoJSON valido.
        const map = fakeMap();
        setupCoordinationLineLayers({}, map);

        const dados = map.getSource('coordination_lines').data;
        expect(dados.type).toBe('FeatureCollection');
        expect(Array.isArray(dados.features)).toBe(true);
        expect(dados.features).toEqual([]);
    });

    it('sobrevive a um balde corrompido sem lancar', () => {
        for (const lixo of ['nao sou array', 42, null, {}]) {
            const map = fakeMap();
            expect(() => setupCoordinationLineLayers({ coordination_lines: lixo }, map),
                String(lixo)).not.toThrow();
            expect(Array.isArray(map.getSource('coordination_lines').data.features)).toBe(true);
        }
    });

    it('a fonte nasce difavel, com promoteId', () => {
        // Precondicao do despachante de diff, que o controle usa para TODA escrita em
        // `coordination_lines`. Sem `promoteId` o `updateData` lanca e a escrita cai no
        // caminho de coleção inteira.
        const map = fakeMap();
        setupCoordinationLineLayers({ coordination_lines: [] }, map);

        expect(map.getSource('coordination_lines').promoteId).toBe('id');
    });

    it('nao recria fonte nem camada que ja existem', () => {
        const map = fakeMap();
        setupCoordinationLineLayers({ coordination_lines: [] }, map);
        const antes = [map.sources.size, map.layers.size];

        setupCoordinationLineLayers({ coordination_lines: [] }, map);
        expect([map.sources.size, map.layers.size]).toEqual(antes);
    });
});
