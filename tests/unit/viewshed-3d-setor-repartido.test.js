// Path: tests/unit/viewshed-3d-setor-repartido.test.js

/**
 * O setor da analise de visibilidade 3D acima de 150 graus, que UM
 * Cesium.ViewShed3D nao cobre e por isso vai repartido em dois ou tres.
 *
 * O PIOR CASO que esta regua existe para pegar e o setor de 360 graus, onde o
 * erro se acumula em todas as costuras: o desenho anterior tirava 1,5 grau de
 * CADA sub-setor sem mexer no espacamento, entao a uniao cobria 355,5 dos 360
 * pedidos e as bordas externas paravam 0,75 grau antes de cada lado. O cego que
 * deixava isso passar era somar os angulos em vez de medir a UNIAO: a soma
 * denuncia o total, mas nao diz onde as bordas cairam nem se os sub-setores se
 * sobrepoem, que e o defeito que a folga existe para evitar.
 *
 * A folga na costura continua existindo (o shader corta com > estrito, e o
 * pixel exatamente na divisa passa nos dois e recebe mix() duas vezes), mas
 * agora sai do ESPACAMENTO, nunca do total.
 */

import { describe, it, expect } from 'vitest';
import { computeSubViewshedLayout } from '../../src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js';

const MARGEM = 1.5;

/** Intervalo angular que cada sub-setor cobre, em graus, ordenado. */
function setores(total) {
    const { renderAngle, offsets } = computeSubViewshedLayout(total);
    return offsets
        .map(o => [o - renderAngle / 2, o + renderAngle / 2])
        .sort((a, b) => a[0] - b[0]);
}

describe('reparticao do setor horizontal', () => {
    it.each([151, 200, 300, 301, 360])('a uniao cobre exatamente os %i graus pedidos', (total) => {
        const faixas = setores(total);
        const coberto = faixas.reduce((soma, [a, b]) => soma + (b - a), 0);
        const vaos = faixas.slice(1).reduce((soma, faixa, i) => soma + (faixa[0] - faixas[i][1]), 0);

        expect(coberto + vaos).toBeCloseTo(total, 6);
    });

    it.each([151, 200, 300, 301, 360])('as bordas externas caem em +-metade dos %i graus', (total) => {
        const faixas = setores(total);

        expect(faixas[0][0]).toBeCloseTo(-total / 2, 6);
        expect(faixas[faixas.length - 1][1]).toBeCloseTo(total / 2, 6);
    });

    it.each([151, 200, 300, 301, 360])('os sub-setores nao se sobrepoem em %i graus, e a folga e a margem', (total) => {
        const faixas = setores(total);

        for (let i = 1; i < faixas.length; i++) {
            const folga = faixas[i][0] - faixas[i - 1][1];
            expect(folga).toBeCloseTo(MARGEM, 6);
        }
    });

    it.each([151, 200, 300, 301, 360])('nenhum sub-setor passa dos 150 graus que uma instancia aguenta (%i)', (total) => {
        const { renderAngle } = computeSubViewshedLayout(total);
        expect(renderAngle).toBeLessThanOrEqual(150);
    });

    it.each([1, 45, 120, 150])('ate 150 graus nada e repartido nem encolhido (%i)', (total) => {
        const { renderAngle, offsets } = computeSubViewshedLayout(total);

        expect(offsets).toEqual([0]);
        expect(renderAngle).toBe(total);
    });

    it('360 graus rende tres sub-setores de 119, espacados de 120,5', () => {
        const { renderAngle, offsets } = computeSubViewshedLayout(360);

        expect(renderAngle).toBeCloseTo(119, 6);
        expect(offsets).toHaveLength(3);
        expect(offsets[1] - offsets[0]).toBeCloseTo(120.5, 6);
        expect(offsets[2] - offsets[1]).toBeCloseTo(120.5, 6);
        // O desenho anterior entregava 118,5 e perdia 4,5 graus do circulo.
        expect(3 * renderAngle + 2 * MARGEM).toBeCloseTo(360, 6);
    });
});
