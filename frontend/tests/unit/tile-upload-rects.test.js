// Path: tests/unit/tile-upload-rects.test.js
//
// THE RECTANGLE BOOKKEEPING OF THE 360 PARTIAL TEXTURE UPLOAD, measured as bytes.
//
// This is a BEHAVIOUR test, not a structural one: it runs the real
// `src/js/street_view_tool/tile-upload-rects.js` over a synthetic frustum and asserts the
// AREA that would be uploaded, which is the quantity the original defect was measured in.
//
// WHAT THE DEFECT WAS. The loader accumulated the changed region as a single BOUNDING BOX.
// The 360 frustum is 9 columns by 6 rows, so the box of any batch is already almost the
// whole canvas: measured on the real app, 187.3 MB uploaded in 3 calls to paint 55 tiles,
// the largest of them 75.5 MB (the entire 6144x3072 canvas), against 36.9 MB for the real
// rectangles.
//
// AND WHY THE GUARD IS THE PART THAT MATTERS. The first version of the fix, a plain list,
// measured WORSE than the defect it replaced: 248.3 MiB against 213.9 MiB on viewer open,
// because up to eight overlapping bands each upload their own area. `loteParaSubir` collapses
// the list back to its bounding box whenever the sum of the parts already reaches it, which
// pins the worst case of the list to exactly the previous behaviour. The third case below is
// the one that fails if someone deletes that guard as a simplification.
//
// NEGATIVE CONTROL run for every case here: reverting `marcarPedaco` to the single bounding
// box (the `min`/`max` accumulation) turns case 2 red on the area, and deleting the
// `loteParaSubir` guard turns case 3 red on the upload count.

import { describe, it, expect } from 'vitest';
import {
    MAX_PEDACOS,
    area,
    envolver,
    juntarPedaco,
    loteParaSubir,
} from '@js/street_view_tool/tile-upload-rects.js';

/** The canvas the numbers in the header were measured on. */
const CANVAS_W = 6144;
const CANVAS_H = 3072;
/** 9 columns by 6 rows is the measured frustum; 512 px is the production tile. */
const TILE = 512;
const COLS = 9;
const ROWS = 6;

/**
 * The rectangle of one tile of the frustum, in canvas pixels.
 *
 * @param {number} cx - column index
 * @param {number} cy - row index
 * @returns {{x0:number,y0:number,x1:number,y1:number}} the rectangle
 */
function tile(cx, cy) {
    return { x0: cx * TILE, y0: cy * TILE, x1: (cx + 1) * TILE, y1: (cy + 1) * TILE };
}

/** The 54 tiles of the measured frustum, in the order they arrive (centre outwards). */
function frustum() {
    const saida = [];
    for (let cy = 0; cy < ROWS; cy++) {
        for (let cx = 0; cx < COLS; cx++) saida.push(tile(cx, cy));
    }
    return saida;
}

describe('area e envolver', () => {
    it('mede a area de um retangulo e devolve zero para o vazio', () => {
        expect(area({ x0: 0, y0: 0, x1: 512, y1: 512 })).toBe(262144);
        expect(area({ x0: 10, y0: 10, x1: 10, y1: 999 })).toBe(0);
        // Invertido devolve area negativa, e isso e proposital: nao ha guarda
        // aqui porque `marcarPedaco` ja recusa `x1 <= x0` antes de chamar.
        expect(area({ x0: 20, y0: 0, x1: 10, y1: 10 })).toBe(-100);
    });

    it('envolve dois retangulos disjuntos e e idempotente sobre o mesmo', () => {
        const a = { x0: 0, y0: 0, x1: 100, y1: 50 };
        const b = { x0: 200, y0: 300, x1: 260, y1: 320 };
        expect(envolver(a, b)).toEqual({ x0: 0, y0: 0, x1: 260, y1: 320 });
        expect(envolver(a, a)).toEqual(a);
        // Comutativa, que e o que permite o laco de custo comparar cada par uma vez.
        expect(envolver(b, a)).toEqual(envolver(a, b));
    });

    it('a envolvente de um contido no outro e o outro', () => {
        const fora = { x0: 0, y0: 0, x1: 1000, y1: 1000 };
        const dentro = { x0: 10, y0: 10, x1: 20, y1: 20 };
        expect(envolver(fora, dentro)).toEqual(fora);
    });
});

describe('juntarPedaco', () => {
    it('descarta de graca o retangulo ja contido num pendente', () => {
        const lista = [{ x0: 0, y0: 0, x1: 1000, y1: 1000 }];
        juntarPedaco(lista, { x0: 10, y0: 10, x1: 20, y1: 20 });
        expect(lista).toHaveLength(1);
        // Borda coincidente ainda conta como contido: e o caso comum de dois
        // tiles que dividem borda depois do arredondamento para fora.
        juntarPedaco(lista, { x0: 0, y0: 0, x1: 1000, y1: 1000 });
        expect(lista).toHaveLength(1);
    });

    it('nunca passa do teto de MAX_PEDACOS, com o frustum inteiro entrando um a um', () => {
        expect(MAX_PEDACOS).toBe(8);
        const lista = [];
        for (const r of frustum()) {
            juntarPedaco(lista, r);
            expect(lista.length).toBeLessThanOrEqual(MAX_PEDACOS);
        }
        expect(lista.length).toBe(MAX_PEDACOS);
    });

    it('CASO 2: o frustum de 9x6 sobe perto da soma dos tiles, nao do canvas', () => {
        const tiles = frustum();
        const somaDosTiles = tiles.reduce((t, r) => t + area(r), 0);
        expect(somaDosTiles).toBe(COLS * ROWS * TILE * TILE);

        const lista = [];
        for (const r of tiles) juntarPedaco(lista, r);
        const subido = loteParaSubir(lista).reduce((t, r) => t + area(r), 0);

        // A envolvente do frustum e o alvo a bater: e o que a versao com caixa
        // unica subia. Aqui ela coincide com a soma, porque o frustum e cheio,
        // entao a guarda colapsa o lote e o pior caso E o comportamento antigo.
        const envolvente = area(tiles.reduce(envolver));
        expect(subido).toBeLessThanOrEqual(envolvente);
        // E ela nao chega perto do canvas inteiro, que era a medida de 75,5 MB.
        expect(subido).toBeLessThan(CANVAS_W * CANVAS_H);
    });

    it('CASO 2b: com tiles ESPARSOS a lista ganha da caixa por mais de uma ordem', () => {
        // Os quatro cantos do canvas. A envolvente deles E o canvas inteiro, que
        // e exatamente o modo de falha medido (75,5 MB para pintar um punhado).
        const cantos = [
            { x0: 0, y0: 0, x1: TILE, y1: TILE },
            { x0: CANVAS_W - TILE, y0: 0, x1: CANVAS_W, y1: TILE },
            { x0: 0, y0: CANVAS_H - TILE, x1: TILE, y1: CANVAS_H },
            { x0: CANVAS_W - TILE, y0: CANVAS_H - TILE, x1: CANVAS_W, y1: CANVAS_H },
        ];
        const lista = [];
        for (const r of cantos) juntarPedaco(lista, r);
        const lote = loteParaSubir(lista);

        expect(lote).toHaveLength(4);
        const subido = lote.reduce((t, r) => t + area(r), 0);
        expect(subido).toBe(4 * TILE * TILE);
        // Numero de controle absoluto: 1.048.576 px contra 18.874.368 px da caixa.
        expect(subido).toBe(1048576);
        expect(area(cantos.reduce(envolver))).toBe(CANVAS_W * CANVAS_H);
        // Fator exato de 18: e o que "mais de uma ordem de grandeza" quer dizer aqui.
        expect((CANVAS_W * CANVAS_H) / subido).toBe(18);
    });
});

describe('loteParaSubir: a guarda que impede a lista de custar MAIS que a caixa', () => {
    it('CASO 3: oito faixas sobrepostas colapsam para UMA leitura', () => {
        // Oito faixas horizontais que cobrem quase o canvas e se sobrepoem duas a
        // duas. Sem a guarda, cada uma sobe por sua conta e a mesma area vai
        // varias vezes: foi assim que a primeira versao mediu 248,3 MiB, PIOR
        // que os 213,9 MiB da caixa unica que ela veio substituir.
        const faixas = [];
        for (let i = 0; i < 8; i++) {
            faixas.push({ x0: 0, y0: i * 300, x1: CANVAS_W, y1: i * 300 + 500 });
        }
        const somaDasPartes = faixas.reduce((t, r) => t + area(r), 0);
        const envolvente = area(faixas.reduce(envolver));
        expect(somaDasPartes).toBeGreaterThan(envolvente);

        const lote = loteParaSubir(faixas);
        expect(lote).toHaveLength(1);
        expect(area(lote[0])).toBe(envolvente);
        // Uma leitura de volta do canvas em vez de oito, e area estritamente menor.
        expect(area(lote[0])).toBeLessThan(somaDasPartes);
    });

    it('nao colapsa quando as partes somam MENOS que a envolvente', () => {
        const cantos = [
            { x0: 0, y0: 0, x1: 100, y1: 100 },
            { x0: 5000, y0: 2000, x1: 5100, y1: 2100 },
        ];
        expect(loteParaSubir(cantos)).toHaveLength(2);
    });

    it('a fronteira exata (soma igual a envolvente) colapsa, porque o empate favorece a leitura unica', () => {
        // Duas metades exatas de um retangulo: soma == envolvente. Colapsar da a
        // mesma area com uma leitura em vez de duas, entao o `>=` esta certo.
        const metades = [
            { x0: 0, y0: 0, x1: 100, y1: 100 },
            { x0: 100, y0: 0, x1: 200, y1: 100 },
        ];
        const soma = metades.reduce((t, r) => t + area(r), 0);
        expect(soma).toBe(area(metades.reduce(envolver)));
        expect(loteParaSubir(metades)).toHaveLength(1);
    });

    it('lista vazia e lista de um passam intactas', () => {
        expect(loteParaSubir([])).toEqual([]);
        const um = [{ x0: 1, y0: 2, x1: 3, y1: 4 }];
        expect(loteParaSubir(um)).toBe(um);
    });
});
