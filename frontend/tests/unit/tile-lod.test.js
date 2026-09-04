/**
 * @fileoverview O par de nivel de detalhe de tile se valida ANTES de chegar ao mapa,
 * e o padrao servido pelo backend passou a ser `null` (decisao do dono, 2026-09-04).
 *
 * O pior caso que esta regua existe para pegar e o par `[1, 10.0]`: primeiro valor
 * abaixo de 2 zera a queda de zoom rumo ao horizonte, ou seja, DESLIGA o LOD e faz a
 * camera inclinada pedir cerca de doze vezes os tiles do padrao do MapLibre. Uma
 * configuracao velha nao pode deixar a vista inclinada mais pesada do que
 * configuracao nenhuma.
 *
 * O segundo eixo e o `null`, e ele nao e detalhe: `map_sig.js` fazia
 * `map.setSourceTileLodParams(...config.map2d.sourceTileLodParams)`, e um spread de
 * `null` LANCA em plena criacao do mapa. Com o backend servindo `null`, o boot inteiro
 * dependia desta funcao existir.
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

import { normalizeTileLodParams, applyTileLodParams } from '../../src/js/map/tile-lod.js';

describe('normalizeTileLodParams', () => {
    it('aceita o par que mantem o LOD vivo', () => {
        expect(normalizeTileLodParams([5, 6])).toEqual([5, 6]);
        expect(normalizeTileLodParams([9.314, 3])).toEqual([9.314, 3]);
        expect(normalizeTileLodParams([2, 1])).toEqual([2, 1]);
    });

    it('recusa o par que desliga o LOD (o valor de producao ate 2026-09-03)', () => {
        expect(normalizeTileLodParams([1, 10.0])).toBeNull();
        expect(normalizeTileLodParams([1.99, 3])).toBeNull();
    });

    it('recusa parametro ausente, curto, nao numerico e nao finito', () => {
        expect(normalizeTileLodParams(null)).toBeNull();
        expect(normalizeTileLodParams(undefined)).toBeNull();
        expect(normalizeTileLodParams([])).toBeNull();
        expect(normalizeTileLodParams([5])).toBeNull();
        expect(normalizeTileLodParams(['5', '6'])).toBeNull();
        expect(normalizeTileLodParams([NaN, 6])).toBeNull();
        expect(normalizeTileLodParams([5, Infinity])).toBeNull();
        expect(normalizeTileLodParams([5, 0.5])).toBeNull();
    });

    it('nunca devolve um par com o primeiro valor abaixo de 2 ou a razao abaixo de 1', () => {
        fc.assert(fc.property(
            fc.double({ min: -10, max: 30, noNaN: true }),
            fc.double({ min: -10, max: 30, noNaN: true }),
            (a, b) => {
                const out = normalizeTileLodParams([a, b]);
                return out === null || (out[0] >= 2 && out[1] >= 1);
            },
        ));
    });
});

describe('applyTileLodParams', () => {
    it('aplica um par valido ao mapa', () => {
        const map = { setSourceTileLodParams: vi.fn() };
        expect(applyTileLodParams(map, [7, 4])).toBe(true);
        expect(map.setSourceTileLodParams).toHaveBeenCalledWith(7, 4);
    });

    it('nao toca no mapa, e avisa, para o par que desliga o LOD', () => {
        const map = { setSourceTileLodParams: vi.fn() };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(applyTileLodParams(map, [1, 10])).toBe(false);
        expect(map.setSourceTileLodParams).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('fica calado quando nao ha configuracao nenhuma, que e o padrao servido', () => {
        const map = { setSourceTileLodParams: vi.fn() };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(applyTileLodParams(map, null)).toBe(false);
        expect(applyTileLodParams(map, undefined)).toBe(false);
        expect(map.setSourceTileLodParams).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('tolera mapa sem o metodo', () => {
        expect(applyTileLodParams({}, [7, 4])).toBe(false);
        expect(applyTileLodParams(null, [7, 4])).toBe(false);
    });

    it('NAO LANCA com `null`, que e o que o spread do map_sig.js fazia', () => {
        const map = { setSourceTileLodParams: vi.fn() };
        expect(() => applyTileLodParams(map, null)).not.toThrow();
        // O controle: o gesto que este modulo substituiu.
        expect(() => map.setSourceTileLodParams(...null)).toThrow();
    });
});
