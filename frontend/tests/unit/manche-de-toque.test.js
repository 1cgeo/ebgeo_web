// Path: tests/unit/manche-de-toque.test.js

/**
 * @fileoverview O MANCHE DA CENA CAMINHÁVEL, que é a única forma de andar num tablet.
 *
 * Andar era WASD e as setas, pular era `Space` e agachar era `Shift`. Num aparelho de toque não
 * existe nenhum dos quatro: a pessoa abria a cena, girava a visão com o dedo e ficava parada no
 * ponto de entrada. Ao contrário dos outros defeitos desta onda, este não é um alvo pequeno nem
 * um gesto que falha, é a ausência da locomoção.
 *
 * O QUE ESTE ARQUIVO PRENDE é a MATEMÁTICA do manche, que é pura: a saturação no raio, a zona
 * morta, a inversão do eixo vertical e a magnitude que vira intensidade. O desenho, a captura de
 * ponteiro e a montagem na cena não estão aqui, e não estão porque precisam de DOM.
 *
 * A INVERSÃO DO EIXO VERTICAL É O CASO QUE MAIS PAGA. No eixo da TELA, para cima é `dy`
 * NEGATIVO; andar para frente é para cima. Quem esquecer esta linha entrega uma cena que anda de
 * ré, e o sintoma é tão estranho que se procura primeiro na física.
 */

import { describe, it, expect } from 'vitest';
import { vetorDoManche } from '../../src/js/first_person_3d_tool/walk/touch-stick.js';

/** O mesmo raio de `RAIO_PX`, repetido aqui para os casos terem número absoluto. */
const RAIO = 40;

describe('vetorDoManche', () => {
    it('o centro não anda: com o dedo no meio, os dois eixos são zero', () => {
        const v = vetorDoManche(0, 0);
        expect(v.frente).toBe(0);
        expect(v.lado).toBe(0);
    });

    it('para CIMA na tela é para FRENTE na cena', () => {
        const v = vetorDoManche(0, -RAIO);
        expect(v.frente).toBeCloseTo(1, 10);
        expect(v.lado).toBeCloseTo(0, 10);
    });

    it('para BAIXO na tela é de ré', () => {
        const v = vetorDoManche(0, RAIO);
        expect(v.frente).toBeCloseTo(-1, 10);
    });

    it('para a direita é para a direita, sem inversão', () => {
        const v = vetorDoManche(RAIO, 0);
        expect(v.lado).toBeCloseTo(1, 10);
        expect(v.frente).toBeCloseTo(0, 10);
    });

    it('meia inclinação é meia intensidade, e é isso que o torna analógico', () => {
        const v = vetorDoManche(0, -RAIO / 2);
        expect(v.frente).toBeCloseTo(0.5, 10);
        expect(Math.hypot(v.frente, v.lado)).toBeCloseTo(0.5, 10);
    });

    it('a zona morta absorve o tremor do dedo apoiado', () => {
        // Um décimo do curso. Sem ela a cena deriva sozinha enquanto a mão descansa na base.
        const v = vetorDoManche(2, 2);
        expect(v.frente).toBe(0);
        expect(v.lado).toBe(0);
        // E o botão AINDA acompanha o dedo ali dentro, senão ele parece travado.
        expect(v.x).toBeCloseTo(2, 10);
        expect(v.y).toBeCloseTo(2, 10);
    });

    it('arrastar para fora da base SATURA: não anda mais rápido e o botão não escapa', () => {
        const longe = vetorDoManche(0, -1000);
        expect(Math.hypot(longe.frente, longe.lado)).toBeCloseTo(1, 10);
        expect(Math.hypot(longe.x, longe.y)).toBeCloseTo(RAIO, 6);

        // E a saturação é IGUAL à da borda: passar do limite não muda mais nada.
        const borda = vetorDoManche(0, -RAIO);
        expect(longe.frente).toBeCloseTo(borda.frente, 10);
    });

    it('a diagonal cheia tem magnitude 1, e não 1,41', () => {
        // Um manche que somasse os eixos andaria 41% mais rápido na diagonal, que é o defeito
        // clássico do movimento por teclas e que aqui não pode existir, porque a magnitude É a
        // intensidade que o caminhador aplica à velocidade.
        const v = vetorDoManche(RAIO, -RAIO);
        expect(Math.hypot(v.frente, v.lado)).toBeCloseTo(1, 10);
        expect(v.frente).toBeCloseTo(Math.SQRT1_2, 6);
        expect(v.lado).toBeCloseTo(Math.SQRT1_2, 6);
    });

    it('entrada não numérica não propaga NaN para a física', () => {
        // Um `NaN` no vetor vira `NaN` na posição da câmera, e a cena some sem um erro em lugar
        // nenhum: é a mesma classe do `hitRadius` indefinido do 360.
        for (const [dx, dy] of [[Number.NaN, 0], [0, Number.NaN], [undefined, undefined]]) {
            const v = vetorDoManche(dx, dy);
            expect(Number.isFinite(v.frente), `frente com (${dx}, ${dy})`).toBe(true);
            expect(Number.isFinite(v.lado), `lado com (${dx}, ${dy})`).toBe(true);
        }
    });
});
