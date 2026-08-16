// Path: tests/unit/cover-image.test.js

/**
 * A aritmética por trás da capa de projeto. O canvas não existe em node, então o que se prende
 * aqui são as três decisões que o canvas NÃO toma: em que tamanho desenhar, quanto o payload
 * realmente pesa, e que formato o navegador de fato devolveu.
 *
 * A terceira é a que mais importa e a menos óbvia: `canvas.toDataURL('image/webp')` devolve um PNG,
 * sem erro nenhum, no navegador que não sabe codificar WebP. Quem confiar no pedido manda um PNG de
 * 900 kB rotulado como WebP, e o servidor recusa por um motivo que o usuário não tem como agir.
 */

import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import {
    fitWithin,
    dataUriByteLength,
    dataUriMimeType,
    COVER_MAX_WIDTH,
    COVER_MAX_HEIGHT,
} from '@js/projects/cover-image.js';

describe('fitWithin', () => {
    it('reduz preservando a proporção', () => {
        expect(fitWithin(1280, 800)).toEqual({ width: 640, height: 400 });
        expect(fitWithin(4000, 3000)).toEqual({ width: 533, height: 400 });
    });

    it('NÃO amplia: uma imagem pequena fica do tamanho que é', () => {
        // Ampliar produziria borrão com mais bytes, que é o pior dos dois mundos.
        expect(fitWithin(120, 90)).toEqual({ width: 120, height: 90 });
        expect(fitWithin(1, 1)).toEqual({ width: 1, height: 1 });
    });

    it('cabe exatamente no limite sem mexer', () => {
        expect(fitWithin(COVER_MAX_WIDTH, COVER_MAX_HEIGHT))
            .toEqual({ width: COVER_MAX_WIDTH, height: COVER_MAX_HEIGHT });
    });

    it('a proporção extrema não zera o lado curto', () => {
        // 4000x1 escala para 640x0,16. Sem o piso de 1 px o canvas teria altura zero e a capa
        // sairia vazia, sem erro em lugar nenhum.
        const { width, height } = fitWithin(4000, 1);
        expect(width).toBe(640);
        expect(height).toBe(1);
    });

    it('recusa dimensão inválida em vez de inventar uma capa 1x1', () => {
        for (const bad of [0, -10, NaN, Infinity, undefined, null]) {
            expect(() => fitWithin(bad, 100)).toThrow(/invalid source size/);
            expect(() => fitWithin(100, bad)).toThrow(/invalid source size/);
        }
    });

    it('respeita um teto passado à mão (o degrau de metade do tamanho)', () => {
        expect(fitWithin(640, 400, 320, 200)).toEqual({ width: 320, height: 200 });
    });
});

describe('dataUriByteLength', () => {
    it('conta os bytes decodificados, com e sem preenchimento', () => {
        // Três textos que produzem os três casos de padding do base64.
        const cases = [
            ['abc', 3],       // YWJj    → sem '='
            ['ab', 2],        // YWI=    → um '='
            ['a', 1],         // YQ==    → dois '='
            ['abcdefghij', 10],
        ];
        for (const [text, bytes] of cases) {
            const uri = `data:image/webp;base64,${Buffer.from(text).toString('base64')}`;
            expect(dataUriByteLength(uri), text).toBe(bytes);
        }
    });

    it('bate com o tamanho real de um PNG de verdade', () => {
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        expect(dataUriByteLength(`data:image/png;base64,${png}`))
            .toBe(Buffer.from(png, 'base64').length);
    });

    it('devolve 0 para o que não é data URI', () => {
        for (const bad of ['', 'não é uri', null, undefined, 42, 'data:image/webp;base64,']) {
            expect(dataUriByteLength(bad)).toBe(0);
        }
    });
});

describe('dataUriMimeType', () => {
    it('lê o tipo que a URI declara, não o que foi pedido', () => {
        expect(dataUriMimeType('data:image/webp;base64,AAAA')).toBe('image/webp');
        expect(dataUriMimeType('data:image/png;base64,AAAA')).toBe('image/png');
        expect(dataUriMimeType('data:image/jpeg;base64,AAAA')).toBe('image/jpeg');
    });

    it('aceita a forma sem parâmetro antes da vírgula', () => {
        expect(dataUriMimeType('data:text/plain,oi')).toBe('text/plain');
    });

    it('devolve vazio para o que não é data URI', () => {
        for (const bad of ['', 'https://exemplo/x.webp', null, undefined, {}]) {
            expect(dataUriMimeType(bad)).toBe('');
        }
    });
});
