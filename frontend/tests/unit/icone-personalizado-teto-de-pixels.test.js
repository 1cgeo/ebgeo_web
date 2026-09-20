// Path: tests/unit/icone-personalizado-teto-de-pixels.test.js

/**
 * @fileoverview O teto de pixels do ícone personalizado de ponto, medido CONTRA O VALIDADOR REAL.
 *
 * `custom-point-icons.test.js`, o irmão deste arquivo, mocka `@utils/image_utils.js` com um
 * `validateImageDimensions: () => ({ valid: true })`, que é a coisa certa para o que ele afirma (o
 * portão de TIPO) e a coisa errada para o teto: com aquele duplo, o teto não existe e o verde não
 * prova nada. Este arquivo mocka só o que a página não tem em node (a store e o toast) e deixa o
 * validador de verdade entrar, porque é ele o sujeito.
 *
 * A REGRA TEM DUAS RESSALVAS DE SVG E AS DUAS SÃO CONTRA-INTUITIVAS, então cada uma tem caso com
 * número absoluto: um SVG SEM tamanho intrínseco decodifica 0x0 e PASSA de propósito (o
 * rasterizador cai no quadrado normalizado), e um SVG que declara UM lado decodifica 0 no outro,
 * de modo que o lado ausente EMPRESTA o presente. A segunda existe porque a forma óbvia de
 * escrever a primeira (pular quando a largura é 0) deixava um `height="40000"` passar inteiro.
 */

import { describe, it, expect, vi } from 'vitest';

// A store e o barramento não sobem em node; o validador de imagem, sim, e é o que se quer medir.
vi.mock('@store', () => ({
    getCustomIconBlob: () => Promise.resolve(null),
    getEventBus: () => { throw new Error('sem barramento'); },
}));
vi.mock('@utils/toast_service.js', () => ({ showError: vi.fn() }));

const { iconDimensionVerdict } = await import(
    '../../src/js/draw_tools/point_tool/point-custom-icons.js'
);
const { IMAGE_CONFIG } = await import('../../src/js/utilities/image_utils.js');

describe('iconDimensionVerdict', () => {
    it('não está medindo um duplo: o validador real está no caminho', () => {
        // Controle de vácuo. Se `image_utils.js` estivesse mockado em algum lugar desta cadeia,
        // o teto seria 8192 por acidente e 40000 passaria.
        expect(IMAGE_CONFIG.maxPixelSide).toBe(8192);
        expect(IMAGE_CONFIG.maxPixelCount).toBe(50 * 1000 * 1000);
    });

    it('0x0 PASSA: é o SVG sem tamanho intrínseco, e é estado legítimo', () => {
        expect(iconDimensionVerdict(0, 0)).toEqual({ valid: true });
    });

    it('0x40000 RECUSA: o lado ausente empresta o presente', () => {
        // Este é o caso que a versão anterior da regra deixava passar. Sem o empréstimo, a
        // largura 0 fazia o ícone parecer sem tamanho e o `height` enorme ia direto ao canvas.
        const veredito = iconDimensionVerdict(0, 40000);
        expect(veredito.valid).toBe(false);
        expect(veredito.reason).toMatch(/40000 x 40000 px/);
        expect(veredito.reason).toMatch(/máximo é 8192 px de lado/);
    });

    it('40000x0 RECUSA, pelo mesmo empréstimo na outra direção', () => {
        const veredito = iconDimensionVerdict(40000, 0);
        expect(veredito.valid).toBe(false);
        expect(veredito.reason).toMatch(/40000 x 40000 px/);
    });

    it('64x64 PASSA: o ícone comum, que é a maioria absoluta do tráfego desta porta', () => {
        expect(iconDimensionVerdict(64, 64)).toEqual({ valid: true });
    });

    it('EXATAMENTE no teto de lado passa, e um pixel acima recusa', () => {
        // 8192 x 6103 = 49 995 776 px: o lado no teto e a área logo abaixo dela, que é a única
        // combinação capaz de medir o teto de LADO sem esbarrar no de ÁREA.
        expect(8192 * 6103).toBeLessThanOrEqual(IMAGE_CONFIG.maxPixelCount);
        expect(iconDimensionVerdict(8192, 6103)).toEqual({ valid: true });
        expect(iconDimensionVerdict(6103, 8192)).toEqual({ valid: true });

        expect(iconDimensionVerdict(8193, 10).valid).toBe(false);
        expect(iconDimensionVerdict(10, 8193).valid).toBe(false);
    });

    it('EXATAMENTE no teto de área passa, e um passo acima recusa', () => {
        // 8000 x 6250 = 50 000 000 px, com os dois lados sob 8192: é o teto que o de lado não vê.
        expect(8000 * 6250).toBe(IMAGE_CONFIG.maxPixelCount);
        expect(iconDimensionVerdict(8000, 6250)).toEqual({ valid: true });

        const acima = iconDimensionVerdict(8000, 6251);
        expect(acima.valid).toBe(false);
        expect(acima.reason).toMatch(/50,1 MP\) e o máximo é 50 MP/);
    });

    it('NaN RECUSA: é a decodificação que falhou, e aí "ilegível" é a verdade', () => {
        // `NaN || NaN` continua NaN, então o empréstimo não transforma isto num 0x0 aceitável.
        for (const par of [[NaN, NaN], [NaN, 64], [64, NaN]]) {
            const veredito = iconDimensionVerdict(par[0], par[1]);
            expect(veredito.valid, `${par[0]}x${par[1]}`).toBe(false);
            expect(veredito.reason).toMatch(/não foi possível ler/);
        }
    });

    it('Infinity, negativo e não-número recusam', () => {
        const ruins = [
            [Infinity, 64], [64, Infinity], [-Infinity, -Infinity],
            [-5, 64], [64, -5],
            [undefined, undefined], [null, null], ['64', '64'], [{}, []],
        ];
        for (const [w, h] of ruins) {
            expect(iconDimensionVerdict(w, h).valid, `${String(w)}x${String(h)}`).toBe(false);
        }
    });

    it('a recusa só acontece por tamanho: 0 em UM lado com o outro pequeno passa', () => {
        // O SVG de um lado só, dentro do teto. O empréstimo o torna um quadrado legal.
        expect(iconDimensionVerdict(0, 128)).toEqual({ valid: true });
        expect(iconDimensionVerdict(128, 0)).toEqual({ valid: true });
    });
});
