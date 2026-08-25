// Path: tests/integration/rotulo-de-folha-60-segundos.repro.test.js

/**
 * @fileoverview Repro for the DMS label that printed 60 SECONDS on a printed sheet.
 *
 * ROOT CAUSE. `_formatDMS` (`js/import_export/pdf-cartographic-elements.js`) floored
 * the minutes and only THEN rounded the seconds, with no carry. `Math.round` on the
 * seconds remainder lands on exactly 60 for any value whose minute fraction is a hair
 * under a whole minute, which is the ordinary case in binary floating point: -43.3 is
 * not representable, so `(43.3 - 43) * 60` is 17.99999999999983 and its remainder
 * rounds to 60. The grid loop accumulating the interval makes it worse (-43.2 arrives
 * as -43.199999999999996), but it is not the only source.
 *
 * WHAT IT COST. This is the one defect of the batch that leaves the screen: it is
 * printed on the sheet the operator carries. Measured at 1:250.000 on a Rio de
 * Janeiro tile, TEN of the twelve labels came out as `43°11'60"W` and the like, where
 * cartography requires `43°12'W`.
 *
 * FIX. Carry in `_formatDMS`: `sec === 60` rolls the minute, and `min === 60` rolls
 * the degree. The second step is not decorative, `21°59'60"S` needs both.
 *
 * This test drives the PRODUCTION drawer (`drawMosaicGridLines`) through a spy
 * context, so reverting the carry turns it red.
 */

import { describe, it, expect } from 'vitest';
import { drawMosaicGridLines } from '../../src/js/import_export/pdf-cartographic-elements.js';

/** Minimal 2D-context spy: records only the label text, which is what is at stake. */
function labelSpy() {
    const texts = [];
    return {
        texts,
        canvas: { width: 600, height: 600 },
        save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
        translate() {}, rotate() {}, setLineDash() {}, fillRect() {}, strokeRect() {},
        fillText(t) { texts.push(String(t)); },
        measureText(t) { return { width: String(t).length * 6 }; },
        set fillStyle(_v) {}, get fillStyle() { return '#000'; },
        set strokeStyle(_v) {}, get strokeStyle() { return '#000'; },
        set lineWidth(_v) {}, get lineWidth() { return 1; },
        set font(_v) {}, get font() { return '10px sans-serif'; },
        set textAlign(_v) {}, get textAlign() { return 'left'; },
        set textBaseline(_v) {}, get textBaseline() { return 'top'; },
    };
}

/** Equirectangular projection of `bounds` onto a `size`-square canvas. */
const projection = (b, size) => ([lng, lat]) => ({
    x: ((lng - b.west) / (b.east - b.west)) * size,
    y: ((b.north - lat) / (b.north - b.south)) * size,
});

function labelsFor(bounds, scale) {
    const ctx = labelSpy();
    drawMosaicGridLines(ctx, {
        mapBounds: bounds,
        mapW: 600,
        mapH: 600,
        projectionFn: projection(bounds, 600),
        scale,
        showLatLong: true,
        showUTM: false,
        dpi: 300,
    });
    // Cada linha de grade rotula as DUAS bordas que cruza, entao o texto sai em
    // duplicata; a identidade do rotulo e o que esta em jogo aqui, nao a contagem.
    return [...new Set(ctx.texts)];
}

describe('rotulo de folha nao imprime 60 segundos', () => {
    const RIO = { west: -43.5, east: -42.9, south: -22.5, north: -21.9 };

    it('1:250.000 sai com os doze rotulos em minutos inteiros', () => {
        const labels = labelsFor(RIO, '1:250000');
        expect(labels).toHaveLength(12);
        expect(labels).toEqual([
            "22°30'S", "22°24'S", "22°18'S", "22°12'S", "22°6'S", '22°S',
            "43°30'W", "43°24'W", "43°18'W", "43°12'W", "43°6'W", '43°W',
        ]);
    });

    it('nenhum rotulo, em nenhuma das escalas correntes, carrega 60 segundos ou 60 minutos', () => {
        const boxes = [
            [RIO, '1:250000'],
            [RIO, '1:100000'],
            [{ west: -59.9556, east: -59.9445, south: -1.005, north: -0.995 }, '1:5000'],
            [{ west: -59.96, east: -59.93, south: -1.02, north: -0.99 }, '1:10000'],
            [{ west: -44.2, east: -42.8, south: -23.2, north: -21.8 }, '1:500000'],
        ];
        for (const [bounds, scale] of boxes) {
            const labels = labelsFor(bounds, scale);
            // Cobertura vazia passaria verde: exija que a escala tenha produzido rotulo.
            expect(labels.length, scale).toBeGreaterThan(0);
            expect(labels.filter((t) => t.includes('60"')), scale).toEqual([]);
            expect(labels.filter((t) => t.includes("°60'")), scale).toEqual([]);
        }
    });

    it('CONTROLE: os segundos legitimos continuam sendo impressos', () => {
        // Sem isto o conserto seria indistinguivel de suprimir o campo de segundos.
        const labels = labelsFor({ west: -59.96, east: -59.93, south: -1.02, north: -0.99 }, '1:10000');
        expect(labels).toContain("0°59'42\"S");
        expect(labels).toContain("59°57'36\"W");
    });
});
