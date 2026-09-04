// Path: tests/unit/coordination-line-fill-filtro.test.js

/**
 * @fileoverview A camada de PREENCHIMENTO da linha de coordenacao (o fosso anticarro) entra na
 * reescrita de filtros como qualquer camada de feicao, e o recorte de geometria sobrevive a ela.
 *
 * O DEFEITO QUE ESTA REGUA EXISTE PARA PEGAR (herdado da `main`, achado no porte de 2026-09-04):
 * `coordination-line-fill-layer` nascia com um filtro estatico (`visivel` e `geometry-type`) e
 * fora de `FEATURE_LAYER_IDS`, entao `updateAllLayerFilters` nunca a tocava. A pertinencia a
 * uma camada do usuario e a janela temporal so alcancavam a camada de linha: ocultar a camada
 * apagava o contorno do fosso e deixava a faixa preenchida na tela.
 *
 * O conserto tem DUAS metades, e a segunda e a que se esquece: o id na lista, E a clausula
 * `['==', ['geometry-type'], 'Polygon']` em `LAYER_ADDITIONAL_FILTERS`, porque o filtro
 * reescrito substitui o estatico por inteiro, e sem o recorte o preenchimento voltaria a
 * pintar o miolo de todo losango oco da mesma fonte (a MultiLineString nao e poligono, mas o
 * `ensureLayer` seguinte nao e o unico consumidor: a regra e da lista, nao da camada).
 *
 * Controle negativo: com `layer.constants.js` revertido, os tres casos reprovam.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const visible = { ids: ['default'] };
vi.mock('../../src/js/store/index.js', () => ({
    getVisibleLayerIds: () => visible.ids,
}));

const { FEATURE_LAYER_IDS, LAYER_ADDITIONAL_FILTERS } = await import('../../src/js/layers/layer.constants.js');
const { updateAllLayerFilters, invalidateFilterCache } = await import('../../src/js/layers/visibility-filter.js');

const FILL = 'coordination-line-fill-layer';
const LINE = 'coordination-line-layer';
const GEOMETRY_CLAUSE = ['==', ['geometry-type'], 'Polygon'];

function fakeMap(layerIds) {
    const filters = new Map();
    return {
        filters,
        getLayer: (id) => (layerIds.includes(id) ? { id } : undefined),
        setFilter: (id, filter) => { filters.set(id, filter); },
    };
}

describe('a camada de preenchimento da linha de coordenacao segue a regra das outras', () => {
    beforeEach(() => {
        visible.ids = ['default', 'camada-a'];
        invalidateFilterCache();
    });

    it('esta em FEATURE_LAYER_IDS, ao lado da camada de linha', () => {
        expect(FEATURE_LAYER_IDS).toContain(FILL);
        expect(FEATURE_LAYER_IDS).toContain(LINE);
    });

    it('carrega o recorte de geometria em LAYER_ADDITIONAL_FILTERS, e a camada de linha nao', () => {
        expect(LAYER_ADDITIONAL_FILTERS[FILL]).toEqual([GEOMETRY_CLAUSE]);
        expect(LAYER_ADDITIONAL_FILTERS[LINE]).toBeUndefined();
    });

    it('updateAllLayerFilters reescreve o preenchimento com pertinencia de camada E recorte de geometria', () => {
        const map = fakeMap([FILL, LINE]);
        updateAllLayerFilters(map);

        const fill = map.filters.get(FILL);
        expect(fill, 'o preenchimento tem de receber setFilter').toBeDefined();
        expect(fill[0]).toBe('all');
        // A pertinencia de camada e a metade que faltava: e ela que esconde a faixa junto
        // com o contorno quando a camada do usuario e ocultada.
        expect(JSON.stringify(fill)).toContain(JSON.stringify(['literal', visible.ids]));
        // E o recorte de geometria e a metade que se perderia na reescrita.
        expect(fill).toContainEqual(GEOMETRY_CLAUSE);

        const line = map.filters.get(LINE);
        expect(line, 'a camada de linha continua sendo reescrita').toBeDefined();
        expect(line).not.toContainEqual(GEOMETRY_CLAUSE);
    });
});
