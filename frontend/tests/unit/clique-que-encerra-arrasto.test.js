// Path: tests/unit/clique-que-encerra-arrasto.test.js
//
// EDITAR UM VÉRTICE DESSELECIONAVA A FEIÇÃO, E AS ALÇAS FICAVAM NA TELA (dono, 2026-09-20).
//
// A CAUSA. O arrasto de alça virou arrasto de PONTEIRO, com `preventDefault` no `pointerdown`. Isso
// cancela os eventos de mouse de compatibilidade e NÃO cancela o `click`. O MapLibre suprime o
// clique que encerra um arrasto comparando-o com o último `mousedown` que viu, e deixou de ver:
// o clique saía no ponto em que o vértice foi solto, quase sempre FORA da feição, e o gerente de
// seleção lia "clicou em nada" e desselecionava. As alças ficavam porque a continuação assíncrona
// do próprio arrasto as redesenhava depois da desseleção.
//
// MEDIDO num polígono de atlas local: seleção de 1 para 0 e oito alças renderizadas. Com o conserto,
// seleção 1 e o painel aberto. A medição de tela é de captura; este arquivo prende a REGRA, que é
// pura, e a fiação dela no único ponto que consome o clique do mapa.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { isDragEndClick, CLICK_TOLERANCE_PX } from '../../src/js/tool_manager/click-after-drag.js';

describe('isDragEndClick', () => {
    it('o caso medido: o vértice solto a dezenas de pixels de onde o ponteiro desceu', () => {
        expect(isDragEndClick({ x: 950, y: 320 }, { x: 1040, y: 270 })).toBe(true);
    });

    it('um clique de verdade, no mesmo ponto ou com o tremor da mão, continua clique', () => {
        expect(isDragEndClick({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(false);
        expect(isDragEndClick({ x: 100, y: 100 }, { x: 102, y: 101 })).toBe(false);
    });

    it('a fronteira é a do MapLibre: exatamente na tolerância ainda é clique, um passo além não', () => {
        expect(CLICK_TOLERANCE_PX).toBe(3);
        expect(isDragEndClick({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
        expect(isDragEndClick({ x: 0, y: 0 }, { x: 3.01, y: 0 })).toBe(true);
        // A distância é euclidiana, não por eixo: (3, 3) está a 4,24 px.
        expect(isDragEndClick({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
    });

    it.each([
        ['sem pointerdown registrado', null, { x: 1, y: 1 }],
        ['sem ponto de clique', { x: 1, y: 1 }, undefined],
        ['NaN', { x: NaN, y: 0 }, { x: 500, y: 500 }],
        ['Infinity', { x: 0, y: 0 }, { x: Infinity, y: 0 }],
        ['texto', { x: '0', y: 0 }, { x: 500, y: 500 }],
    ])('%s: FALSO, porque clique que ninguém consegue situar continua sendo clique', (_r, down, click) => {
        expect(isDragEndClick(down, click)).toBe(false);
    });

    it('PROPRIEDADE: simétrica, e nunca acusa distância dentro da tolerância', () => {
        const eixo = fc.double({ min: -5000, max: 5000, noNaN: true });
        const ponto = fc.record({ x: eixo, y: eixo });
        fc.assert(fc.property(ponto, ponto, (a, b) => {
            expect(isDragEndClick(a, b)).toBe(isDragEndClick(b, a));
            if (Math.hypot(a.x - b.x, a.y - b.y) <= CLICK_TOLERANCE_PX) expect(isDragEndClick(a, b)).toBe(false);
        }));
    });
});

describe('a fiação no gerente de seleção', () => {
    const fonte = readFileSync(new URL('../../src/js/tool_manager/selection_manager.js', import.meta.url), 'utf8')
        .replace(/\r\n/g, '\n');

    it('o ponto de descida é lido do PONTEIRO e na fase de CAPTURA, antes de qualquer preventDefault', () => {
        expect(fonte).toContain("addEventListener('pointerdown', this._handlePointerDown, true)");
        expect(fonte).toContain("removeEventListener('pointerdown', this._handlePointerDown, true)");
    });

    it('a recusa é a PRIMEIRA coisa de `_handleMapClick`, e o ponto é consumido uma vez só', () => {
        const inicio = fonte.indexOf('    _handleMapClick = (e) => {');
        expect(inicio).toBeGreaterThan(-1);
        const corpo = fonte.slice(inicio, fonte.indexOf('\n    }\n', inicio));
        const recusa = corpo.indexOf('if (isDragEndClick(down, e.point)) return;');
        expect(recusa).toBeGreaterThan(-1);
        expect(corpo.indexOf('this._lastPointerDown = null;')).toBeLessThan(recusa);
        // Antes de todo o resto: nem ferramenta ativa nem desseleção veem o clique de fim de arrasto.
        expect(recusa).toBeLessThan(corpo.indexOf('this.getActiveTool()'));
        expect(recusa).toBeLessThan(corpo.indexOf('this.deselectAllFeatures('));
    });
});
