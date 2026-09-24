// Path: tests/unit/zoom-para-selecao-pela-caixa.repro.test.js

/**
 * REPRO: "Zoom para Seleção" (botão direito) enquadrava só a GEOMETRIA das feições selecionadas.
 *
 * Um símbolo (ponto, texto, imagem, símbolo militar, medida de coordenação, símbolo de engenharia,
 * declinação magnética) tem geometria de UMA posição e guarda a pegada desenhada em
 * `properties.selectionBox`. Com a geometria só, um símbolo selecionado sozinho virava um
 * retângulo de tamanho zero, e a câmera respondia aproximando até o símbolo estourar a tela; numa
 * seleção maior, os símbolos da borda ficavam cortados. Pedido do dono em 2026-09-24: o zoom tem
 * de considerar a caixa desses sete tipos.
 *
 * A regra é "a caixa quando existe", e não uma lista dos sete: uma lista escrita à mão dos mesmos
 * tipos já tinha divergido uma vez (`centralizar-simbolo-pela-caixa.repro.test.js`).
 */

import { describe, it, expect } from 'vitest';
import { selectionExtent, footprintOf } from '@utils/geometry-utils.js';

const caixa = (w, s, e, n) => ({
    type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
});
const simbolo = (source, [x, y], box) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: { source, selectionBox: box },
});

describe('zoom para seleção pela caixa', () => {
    it.each([
        'point', 'text', 'image', 'military_symbol', 'coordination_measure', 'engineering_symbol', 'magnetic_declination',
    ])('um %s sozinho enquadra a CAIXA, não um ponto de tamanho zero', (source) => {
        const f = simbolo(source, [-43.2, -22.9], caixa(-43.21, -22.91, -43.19, -22.89));
        expect(selectionExtent([f])).toEqual([[-43.21, -22.91], [-43.19, -22.89]]);
    });

    it('o símbolo na borda de uma seleção entra inteiro, com a caixa dele', () => {
        const a = simbolo('military_symbol', [-43.3, -22.9], caixa(-43.32, -22.92, -43.28, -22.88));
        const b = simbolo('point', [-43.0, -22.9], caixa(-43.01, -22.91, -42.99, -22.89));
        expect(selectionExtent([a, b])).toEqual([[-43.32, -22.92], [-42.99, -22.88]]);
    });

    it('feição sem caixa continua enquadrada pela geometria (linha, polígono)', () => {
        const linha = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-44, -23], [-43, -22]] }, properties: { source: 'line' } };
        expect(selectionExtent([linha])).toEqual([[-44, -23], [-43, -22]]);
    });

    it('caixa que não é Polígono é ignorada, e vale a geometria', () => {
        const f = simbolo('text', [-43.2, -22.9], { type: 'LineString', coordinates: [[0, 0], [1, 1]] });
        expect(footprintOf(f)).toBe(f.geometry);
        expect(selectionExtent([f])).toEqual([[-43.2, -22.9], [-43.2, -22.9]]);
    });

    it('antimeridiano: caixas dos dois lados da linha de data não viram o mundo espelhado', () => {
        const a = simbolo('point', [179.5, 0], caixa(179.4, -0.1, 179.6, 0.1));
        const b = simbolo('point', [-179.5, 0], caixa(-179.6, -0.1, -179.4, 0.1));
        const [[oeste], [leste]] = selectionExtent([a, b]);
        // The span goes across the date line (west in the east hemisphere), not around the world.
        expect(oeste).toBeCloseTo(179.4);
        expect(leste).toBeCloseTo(180.6);
    });

    it('nada selecionado, ou só posição inválida: nenhum enquadramento', () => {
        expect(selectionExtent([])).toBeNull();
        expect(selectionExtent(undefined)).toBeNull();
        expect(selectionExtent([{ type: 'Feature', geometry: { type: 'Point', coordinates: [NaN, 1] }, properties: {} }])).toBeNull();
    });
});
