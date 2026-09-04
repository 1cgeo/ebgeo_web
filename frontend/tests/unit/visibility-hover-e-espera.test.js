// Path: tests/unit/visibility-hover-e-espera.test.js

/**
 * @fileoverview As DUAS coisas que o controle de visibilidade fazia no caminho quente e
 * deixou de fazer (`analysis_tools/visibility_tool/add_visibility_control.js`).
 *
 * 1. O HOVER CONSULTAVA O ESTILO INTEIRO. `onHoverMove` roda a cada `mousemove` com uma
 *    feição selecionada, e chamava `queryRenderedFeatures(point)` sem `layers`. Sem a
 *    lista, o MapLibre varre TODO gerenciador de fonte do estilo, e este app monta 70
 *    fontes contra o backend de desenvolvimento (medido em 2026-09-04). O handler já
 *    descartava tudo que não fosse da própria família, então ele podia nomear as quatro
 *    camadas de saída e pagar só por elas.
 *
 * 2. AS ESPERAS ERAM DE RELÓGIO. Entre um passo do cálculo e o seguinte o controle
 *    dormia 50 ms para o modal de progresso repintar, e 300 ms no fim. Um quadro basta
 *    para a pintura, e o texto do progresso não é contrato de tempo: são 12 esperas de
 *    50 ms trocadas por `nextPaint`, e as três de 300 ms cortadas pela metade.
 *
 * O QUE ESTA SUÍTE NÃO ALCANÇA: se `queryRenderedFeatures` com `layers` devolve as
 * MESMAS feições que sem ele (isso é do MapLibre, e a régua de camadas em
 * `hover-query.helpers.test.js` prende o filtro de ids), e o cálculo do viewshed em si,
 * que é de `visibility-geometry.test.js`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@store', () => ({
    addFeature: vi.fn(),
    removeFeature: vi.fn(),
    getCurrentMapFeatures: vi.fn(),
    batchUpdateVisibilityFeatures: vi.fn(),
    getActiveLayerIdSync: vi.fn(() => 'layer-1'),
}));
vi.mock('@utils', () => ({
    IDUtils: { generateUniqueId: vi.fn(), generateFeatureName: vi.fn() },
}));
vi.mock('@utils/pointer-utils', () => ({ getPointerPosition: vi.fn() }));
vi.mock('@js/snapping', () => ({ getSnappingService: vi.fn(() => null) }));
vi.mock('@js/analysis_tools/visibility_tool/visibility_attributes_panel.js', () => ({
    addVisibilityAttributesToPanel: vi.fn(),
    addVisibilityParametersToPanel: vi.fn(),
}));
// O controle arrasta a geometria, que estende `BaseGeometry` do mesmo barril; as duas
// classes têm de sair daqui, senão o import do módulo sob teste morre antes do primeiro
// caso.
vi.mock('@tools', () => ({
    BaseControl: class {
        constructor(toolManager) {
            this.toolManager = toolManager;
            this.selectionManager = toolManager?.selectionManager;
        }
        getSelectedFeature() { return null; }
    },
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = { ...properties }; }
    },
}));

const { default: AddVisibilityControl } = await import('@js/analysis_tools/visibility_tool/add_visibility_control.js');

/**
 * Mapa falso que REGISTRA como o hover consultou, e que só conhece as camadas passadas.
 * @param {Array<string>} camadasNoEstilo - ids que `getLayer` reconhece
 * @param {Array<Object>} devolver - feições que a consulta devolve
 * @returns {Object} duplo de mapa mais o registro das chamadas
 */
function mapaDeHover(camadasNoEstilo, devolver = []) {
    const chamadas = [];
    return {
        chamadas,
        getLayer: (id) => (camadasNoEstilo.includes(id) ? { id } : undefined),
        queryRenderedFeatures: (ponto, opcoes) => {
            chamadas.push({ ponto, opcoes });
            return devolver;
        },
        getCanvas: () => ({ style: {} }),
    };
}

/** @returns {Object} controle com o mapa e a seleção plantados. */
function controle(map, selecionada) {
    const c = new AddVisibilityControl({ selectionManager: {} });
    c.map = map;
    c.getSelectedFeature = () => selecionada;
    return c;
}

const SELECIONADA = { type: 'Feature', properties: { id: 'vis-1' } };

describe('onHoverMove nomeia as camadas em vez de varrer o estilo', () => {
    it('a consulta leva `layers`, e só com as quatro camadas da ferramenta', () => {
        const map = mapaDeHover([
            'visibility-edit-handles-layer',
            'visibility-layer',
            'visibility-visible-layer',
            'visibility-obstructed-layer',
            'linhas-layer',
            'pontos-layer',
        ]);
        controle(map, SELECIONADA).onHoverMove({ point: { x: 10, y: 20 } });

        expect(map.chamadas).toHaveLength(1);
        expect(map.chamadas[0].opcoes).toBeDefined();
        expect(map.chamadas[0].opcoes.layers).toEqual([
            'visibility-edit-handles-layer',
            'visibility-layer',
            'visibility-visible-layer',
            'visibility-obstructed-layer',
        ]);
    });

    it('id que não está no estilo é descartado ANTES da consulta, que é o que impede o throw', () => {
        // O MapLibre lança quando um id de `layers` não existe no estilo, e o estilo do
        // app nasce sem as camadas da ferramenta até a primeira feição.
        const map = mapaDeHover(['visibility-layer']);
        controle(map, SELECIONADA).onHoverMove({ point: { x: 1, y: 1 } });
        expect(map.chamadas[0].opcoes.layers).toEqual(['visibility-layer']);
    });

    it('estilo sem NENHUMA das quatro não consulta nada, e o cursor volta ao padrão', () => {
        const map = mapaDeHover(['linhas-layer']);
        const c = controle(map, SELECIONADA);
        const canvas = { style: { cursor: 'move' } };
        map.getCanvas = () => canvas;
        c.onHoverMove({ point: { x: 1, y: 1 } });
        expect(map.chamadas).toHaveLength(0);
        expect(canvas.style.cursor).toBe('');
    });

    it('sem feição selecionada não há consulta nenhuma: o mousemove sai antes', () => {
        const map = mapaDeHover(['visibility-layer']);
        controle(map, null).onHoverMove({ point: { x: 1, y: 1 } });
        expect(map.chamadas).toHaveLength(0);
    });

    it('CONTROLE: a alça e a feição continuam decidindo o cursor', () => {
        const alca = { source: 'visibility-edit-handles', properties: { user_isEditingHandle: true, id: 'h' } };
        const mapAlca = mapaDeHover(['visibility-edit-handles-layer'], [alca]);
        const canvasAlca = { style: {} };
        mapAlca.getCanvas = () => canvasAlca;
        controle(mapAlca, SELECIONADA).onHoverMove({ point: { x: 1, y: 1 } });
        expect(canvasAlca.style.cursor).toBe('crosshair');

        const parte = { source: 'processed-visibility', properties: { id: 'vis-1-visible' } };
        const mapParte = mapaDeHover(['visibility-visible-layer'], [parte]);
        const canvasParte = { style: {} };
        mapParte.getCanvas = () => canvasParte;
        controle(mapParte, SELECIONADA).onHoverMove({ point: { x: 1, y: 1 } });
        expect(canvasParte.style.cursor).toBe('move');
    });
});

describe('as esperas do progresso são de QUADRO, não de relógio', () => {
    let fonte;
    beforeEach(async () => {
        const url = new URL(
            '../../src/js/analysis_tools/visibility_tool/add_visibility_control.js',
            import.meta.url,
        );
        fonte = await (await import('node:fs/promises')).readFile(url, 'utf8');
    });

    it('nenhuma espera de 50 ms sobrou no arquivo', () => {
        expect(fonte).not.toMatch(/delay\(50\)/);
    });

    it('as esperas do fim são de 150 ms, e são exatamente três', () => {
        const trezentos = fonte.match(/delay\(300\)/g) || [];
        const cento = fonte.match(/delay\(150\)/g) || [];
        expect(trezentos).toHaveLength(0);
        expect(cento).toHaveLength(3);
    });

    it('as pausas entre passos passaram a ser `nextPaint`, e são doze', () => {
        const quadros = fonte.match(/await this\.geometry\.nextPaint\(\)/g) || [];
        expect(quadros).toHaveLength(12);
    });

    it('a geometria de fato OFERECE nextPaint, senão as doze acima seriam undefined', async () => {
        const { default: Geometry } = await import(
            '@js/analysis_tools/visibility_tool/add_visibility_geometry.js'
        );
        expect(typeof new Geometry().nextPaint).toBe('function');
    });
});
