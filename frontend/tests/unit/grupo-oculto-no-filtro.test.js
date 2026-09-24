// Path: tests/unit/grupo-oculto-no-filtro.test.js

/**
 * @fileoverview Um membro de grupo OCULTO não passa no filtro de desenho, e só ele.
 *
 * O DEFEITO (medido com dois navegadores em 2026-09-24): ocultar um grupo gravava
 * `groups.visible = false` (viaja por sync, o servidor persiste) e depois só remendava o
 * `visivel` de cada membro na FONTE do MapLibre de quem ocultou. O colega via a árvore dizer
 * "oculto" com os membros desenhados, e o F5 do próprio autor os desenhava de novo. A regra foi
 * para o filtro, ao lado da pertinência de camada: `hiddenGroupMemberIds` lê os grupos,
 * `setHiddenFeatureIds` empurra os ids, e as duas fábricas de filtro os excluem.
 *
 * O filtro é AVALIADO pelo `featureFilter` do pacote de estilo que o próprio MapLibre usa, e não
 * comparado como texto: o que importa é a resposta que o mapa dá por feição.
 *
 * Controle negativo: sem a cláusula em `createLayerVisibilityFilter` e `createHatchLayerFilter`,
 * o caso "o membro do grupo oculto não passa" reprova nas duas fábricas.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';

vi.mock('../../src/js/store/index.js', () => ({
    getVisibleLayerIds: () => ['default'],
}));

const {
    hiddenGroupMemberIds,
    setHiddenFeatureIds,
    createLayerVisibilityFilter,
    createHatchLayerFilter,
    updateAllLayerFilters,
    invalidateFilterCache,
} = await import('../../src/js/layers/visibility-filter.js');

const ATIVO = { deleted: false };

/** @returns {boolean} A resposta do filtro do MapLibre para uma feição. */
function passa(filtro, props) {
    return featureFilter(filtro, 'layers[0].filter').filter({ zoom: 10 }, { type: 1, properties: props, geometry: [] });
}

describe('hiddenGroupMemberIds', () => {
    it('devolve os membros de grupo ativo com visible === false, e só deles', () => {
        const grupos = {
            g1: { id: 'g1', visible: false, sync: ATIVO, features: [{ type: 'point', id: 'a' }, { type: 'line', id: 'b' }] },
            g2: { id: 'g2', visible: true, sync: ATIVO, features: [{ type: 'point', id: 'c' }] },
            // Sem `visible` é visível: grupo antigo, ou criado antes da coluna.
            g3: { id: 'g3', sync: ATIVO, features: [{ type: 'point', id: 'd' }] },
        };
        expect(hiddenGroupMemberIds(grupos)).toEqual(['a', 'b']);
    });

    it('grupo APAGADO não oculta nada, mesmo com visible false', () => {
        const grupos = {
            g1: { id: 'g1', visible: false, sync: { deleted: true }, features: [{ type: 'point', id: 'a' }] },
            g2: { id: 'g2', visible: false, features: [{ type: 'point', id: 'b' }] },
        };
        expect(hiddenGroupMemberIds(grupos)).toEqual([]);
    });

    it('LOS e visibilidade levam junto as duas saídas processadas', () => {
        const grupos = {
            g1: { id: 'g1', visible: false, sync: ATIVO, features: [{ type: 'los', id: 'l1' }, { type: 'visibility', id: 'v1' }] },
        };
        expect(hiddenGroupMemberIds(grupos)).toEqual(['l1', 'l1-visible', 'l1-obstructed', 'v1', 'v1-visible', 'v1-obstructed']);
    });

    it('entrada degenerada devolve lista vazia, sem lançar', () => {
        for (const entrada of [null, undefined, 0, 'x', {}, { g: null }, { g: { visible: false, sync: ATIVO } }]) {
            expect(hiddenGroupMemberIds(entrada)).toEqual([]);
        }
        const refsRuins = { g: { visible: false, sync: ATIVO, features: [null, {}, { id: '' }, { id: 7 }, { id: 'ok' }] } };
        expect(hiddenGroupMemberIds(refsRuins)).toEqual(['ok']);
    });
});

describe('o filtro de desenho exclui o membro do grupo oculto', () => {
    beforeEach(() => {
        setHiddenFeatureIds([]);
        invalidateFilterCache();
    });

    const fabricas = [
        ['camada comum', () => createLayerVisibilityFilter(['default'])],
        ['preenchimento com hachura', () => createHatchLayerFilter(['default'], true)],
        ['preenchimento liso', () => createHatchLayerFilter(['default'], false)],
    ];

    for (const [nome, fabrica] of fabricas) {
        it(`${nome}: o membro do grupo oculto não passa, o vizinho passa`, () => {
            const hachura = nome === 'preenchimento com hachura' ? { hatchEnabled: true, hatchPatternId: 'p' } : {};
            setHiddenFeatureIds(['membro']);
            const filtro = fabrica();
            expect(passa(filtro, { id: 'membro', layerId: 'default', ...hachura })).toBe(false);
            expect(passa(filtro, { id: 'vizinho', layerId: 'default', ...hachura })).toBe(true);
        });

        it(`${nome}: sem grupo oculto, a cláusula nem entra (o filtro de sempre)`, () => {
            const hachura = nome === 'preenchimento com hachura' ? { hatchEnabled: true, hatchPatternId: 'p' } : {};
            const filtro = fabrica();
            expect(JSON.stringify(filtro)).not.toContain('"literal",[]');
            expect(passa(filtro, { id: 'membro', layerId: 'default', ...hachura })).toBe(true);
        });
    }

    it('a própria feição oculta continua oculta, com ou sem grupo (as regras se somam)', () => {
        setHiddenFeatureIds(['outro']);
        expect(passa(createLayerVisibilityFilter(['default']), { id: 'x', layerId: 'default', visivel: false })).toBe(false);
    });

    it('setHiddenFeatureIds descarta duplicata e lixo e ordena', () => {
        setHiddenFeatureIds(['b', 'a', 'b', '', null, 3]);
        const filtro = createLayerVisibilityFilter(['default']);
        expect(JSON.stringify(filtro)).toContain(JSON.stringify(['literal', ['a', 'b']]));
    });

    it('updateAllLayerFilters reescreve quando SÓ o conjunto de ocultos muda (a chave do cache o inclui)', () => {
        const escritas = [];
        const map = { getLayer: (id) => (id === 'point-layer' ? { id } : undefined), setFilter: (id, f) => escritas.push(f) };
        updateAllLayerFilters(map);
        updateAllLayerFilters(map);
        expect(escritas).toHaveLength(1);
        setHiddenFeatureIds(['membro']);
        updateAllLayerFilters(map);
        expect(escritas).toHaveLength(2);
        expect(passa(escritas[1], { id: 'membro', layerId: 'default' })).toBe(false);
        setHiddenFeatureIds([]);
        updateAllLayerFilters(map);
        expect(escritas).toHaveLength(3);
        expect(passa(escritas[2], { id: 'membro', layerId: 'default' })).toBe(true);
    });
});
