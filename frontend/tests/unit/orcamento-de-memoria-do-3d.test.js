// Path: tests/unit/orcamento-de-memoria-do-3d.test.js

/**
 * @fileoverview O TETO DE CACHE DE UM TILESET, que era um gigabyte para toda máquina.
 *
 * `Cesium3DTileset` recebia `cacheBytes: 1073741824` fixo, número escolhido para uma estação de
 * trabalho. Num equipamento de 4 GB com vídeo integrado, que é onde o 3D é aberto em campo, isso
 * é um quarto da máquina entregue a UM tileset, ao lado do navegador inteiro.
 *
 * O QUE ESTE ARQUIVO PRENDE é a REGRA, que é aritmética pura: quando o teto baixa, quando não
 * baixa, e que a ausência das duas pistas NÃO baixa. O que ele não prova é o efeito na memória de
 * um aparelho de verdade, que precisaria de um aparelho de verdade.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    cacheDeTileset,
    CACHE_DE_TILESET_BYTES,
    CACHE_DE_TILESET_BYTES_APERTADO,
    MEMORIA_APERTADA_GB,
    NUCLEOS_APERTADOS,
} from '../../src/js/3d_models_viewer_tool/services/orcamento-de-memoria.js';

describe('cacheDeTileset', () => {
    it('máquina folgada continua com o teto histórico', () => {
        expect(cacheDeTileset({ deviceMemory: 16, hardwareConcurrency: 16 }))
            .toBe(CACHE_DE_TILESET_BYTES);
    });

    it('pouca memória OU poucos núcleos já aperta, e não exige as duas', () => {
        expect(cacheDeTileset({ deviceMemory: 4, hardwareConcurrency: 16 }))
            .toBe(CACHE_DE_TILESET_BYTES_APERTADO);
        expect(cacheDeTileset({ deviceMemory: 16, hardwareConcurrency: 4 }))
            .toBe(CACHE_DE_TILESET_BYTES_APERTADO);
    });

    it('o degrau é inclusivo: o valor do limite JÁ é apertado', () => {
        // `deviceMemory` vem arredondada para baixo em degraus, então 4 significa "4 ou menos".
        // Tratar o degrau como folgado deixaria de fora justamente a faixa que ele representa.
        expect(cacheDeTileset({ deviceMemory: MEMORIA_APERTADA_GB }))
            .toBe(CACHE_DE_TILESET_BYTES_APERTADO);
        expect(cacheDeTileset({ hardwareConcurrency: NUCLEOS_APERTADOS }))
            .toBe(CACHE_DE_TILESET_BYTES_APERTADO);
        expect(cacheDeTileset({ deviceMemory: MEMORIA_APERTADA_GB + 1 }))
            .toBe(CACHE_DE_TILESET_BYTES);
    });

    it('SEM PISTA NENHUMA o teto NÃO baixa, e é esta a metade conservadora da regra', () => {
        // `deviceMemory` não existe no Firefox nem no Safari. Tratar a ausência como aperto
        // estrangularia o cache em todo Firefox de estação, que é o inverso do objetivo.
        for (const navegador of [{}, undefined, null, { deviceMemory: undefined }]) {
            expect(cacheDeTileset(navegador)).toBe(CACHE_DE_TILESET_BYTES);
        }
        // E valor não numérico é ausência, não zero: `'4'` vindo de uma extensão não decide nada.
        expect(cacheDeTileset({ deviceMemory: '2', hardwareConcurrency: '2' }))
            .toBe(CACHE_DE_TILESET_BYTES);
    });

    it('o teto apertado é menor que o histórico, e os dois são inteiros positivos', () => {
        expect(CACHE_DE_TILESET_BYTES_APERTADO).toBeLessThan(CACHE_DE_TILESET_BYTES);
        for (const n of [CACHE_DE_TILESET_BYTES, CACHE_DE_TILESET_BYTES_APERTADO]) {
            expect(Number.isInteger(n)).toBe(true);
            expect(n).toBeGreaterThan(0);
        }
    });
});

describe('o número não sobrou escrito à mão no viewer', () => {
    it('`map_3d.js` pede o teto à função, e não carrega mais o literal', () => {
        // Sem esta linha, a regra poderia estar certa e o tileset continuar nascendo com o
        // gigabyte fixo: seria um módulo novo sem consumidor, verde e inerte.
        const fonte = readFileSync(
            new URL('../../src/js/3d_models_viewer_tool/map_3d.js', import.meta.url),
            'utf8',
        );
        expect(fonte).toContain('cacheBytes: cacheDeTileset()');
        expect(fonte).not.toContain(String(CACHE_DE_TILESET_BYTES));
    });
});
