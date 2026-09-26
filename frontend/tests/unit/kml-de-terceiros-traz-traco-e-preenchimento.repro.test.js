// Path: tests/unit/kml-de-terceiros-traz-traco-e-preenchimento.repro.test.js

/**
 * REPRO: a KML from another tool (Google Earth, QGIS) came in with every feature in the tool's
 * default colour, because the style keys the reader derives from its `<Style>` (`stroke`, `fill` and
 * their width and opacity) were dropped as "not user data" and nothing read them first.
 *
 * Owner's decision of 2026-09-26: stroke and fill become the EBGeo style of the feature. A line takes
 * the stroke's colour, width and opacity; an area also takes the fill's colour and its opacity from
 * the fill; a point takes nothing, because Google Earth writes a LineStyle into a point's style and
 * never draws it. The path is the one our own KMZ style takes (`separarEstiloImportado`, then
 * `aplicarEstiloImportado`, which restores only what the target tool declares).
 */

import { describe, it, expect } from 'vitest';
import {
    CHAVE_DO_ESTILO,
    estiloDoKml,
    limparEstiloDoKml,
    separarEstiloImportado,
    aplicarEstiloImportado,
} from '../../src/js/import_export/estilo-importado.js';

// The style fields of the three tools' DEFAULT_PROPERTIES (draw_tools/*/add_*_control.js).
const PADROES = {
    lines: { lineColor: '#3f4fb5', lineWidth: 5, opacity: 0.7, lineStyle: 'solid' },
    polygons: { fillColor: '#3f4fb5', lineColor: '#3f4fb5', lineWidth: 2, opacity: 0.5, lineStyle: 'solid' },
    points: { fillColor: '#3f4fb5', lineColor: '#000000', lineWidth: 0, size: 10, opacity: 1 },
};

const LINHA = { type: 'LineString', coordinates: [[0, 0], [1, 1]] };
const AREA = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const PONTO = { type: 'Point', coordinates: [0, 0] };

/** The reader's output, the cleaning, the separation and the tool's restore, in the import's order. */
function importar(properties, geometry, tipo, declarados = new Set()) {
    const geo = limparEstiloDoKml({ type: 'FeatureCollection', features: [{ type: 'Feature', properties, geometry }] },
        [declarados], declarados);
    const { propriedades, estilo } = separarEstiloImportado(geo.features[0].properties);
    return { feicao: aplicarEstiloImportado({ ...PADROES[tipo] }, estilo, PADROES[tipo]), propriedades };
}

describe('KML de terceiros: traço e preenchimento viram o estilo da feição', () => {
    it('REPRO: a linha vem com a cor, a largura e a opacidade do traço', () => {
        const { feicao, propriedades } = importar(
            { name: 'Estrada', styleUrl: '#s', stroke: '#FF8800', 'stroke-width': 3, 'stroke-opacity': 0.4 }, LINHA, 'lines');

        expect(feicao).toEqual({ lineColor: '#ff8800', lineWidth: 3, opacity: 0.4, lineStyle: 'solid' });
        expect(propriedades).toEqual({ name: 'Estrada' });
    });

    it('REPRO: a área vem com o preenchimento, o contorno e a opacidade do PREENCHIMENTO', () => {
        const { feicao } = importar({
            stroke: '#00ff00', 'stroke-width': 2.5, 'stroke-opacity': 1, fill: '#0000FF', 'fill-opacity': 0.25,
        }, AREA, 'polygons');

        expect(feicao).toEqual({ fillColor: '#0000ff', lineColor: '#00ff00', lineWidth: 2.5, opacity: 0.25, lineStyle: 'solid' });
    });

    it('o ponto não pega o LineStyle que o Google Earth escreve no estilo dele', () => {
        const { feicao } = importar({ stroke: '#ff0000', 'stroke-width': 3, 'icon-scale': 1.2 }, PONTO, 'points');
        expect(feicao).toEqual(PADROES.points);
    });

    it('o dado que o placemark DECLAROU com nome de estilo é atributo, não estilo', () => {
        const { feicao, propriedades } = importar({ stroke: '#123456', 'stroke-width': 4 }, LINHA, 'lines', new Set(['stroke']));
        expect(feicao.lineColor).toBe(PADROES.lines.lineColor);
        expect(feicao.lineWidth).toBe(4);
        expect(propriedades.stroke).toBe('#123456');
    });

    it('valor de forma errada fica de fora, um por um', () => {
        const { feicao } = importar(
            { stroke: 'red', 'stroke-width': -1, 'stroke-opacity': 2, fill: '#00f' }, AREA, 'polygons');
        expect(feicao).toEqual(PADROES.polygons);
        expect(estiloDoKml({ 'stroke-width': 'abc', 'fill-opacity': '' }, AREA)).toEqual({});
    });

    it('CONTROLE: o nosso KMZ carrega o ebgeo_estilo, e é ele que vale, não o traço derivado', () => {
        const nosso = JSON.stringify({ lineColor: '#abcdef', lineWidth: 9 });
        const { feicao } = importar({ [CHAVE_DO_ESTILO]: nosso, stroke: '#ff0000', 'stroke-width': 1 }, LINHA, 'lines');
        expect(feicao.lineColor).toBe('#abcdef');
        expect(feicao.lineWidth).toBe(9);
    });

    it('um atributo de usuário chamado lineStyle num KML de terceiros continua atributo', () => {
        const { propriedades } = importar({ stroke: '#ff0000', lineStyle: 'do usuário' }, LINHA, 'lines', new Set(['lineStyle']));
        expect(propriedades.lineStyle).toBe('do usuário');
    });
});
