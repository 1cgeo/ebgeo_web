// Path: tests/unit/image-limit-phrases.test.js

/**
 * @fileoverview Pins the SENTENCES a person reads when a picture is refused.
 *
 * The phrases live in a leaf with zero imports precisely so they can be asserted here, in plain
 * node, without a DOM, a canvas or a store. What this suite protects is the property the dono
 * asked for out loud: a refused picture must say that it was not loaded AND why, naming the
 * measured value and the ceiling. A regression here is a refusal that goes back to being a
 * click that did nothing.
 *
 * Every assertion is ABSOLUTE on the text, not a `toMatch` on a fragment: a fragment test passes
 * for a sentence that lost its numbers, which is exactly the failure mode being guarded.
 */

import { describe, it, expect } from 'vitest';
import { ImageRefusal, imageRefusalNotice, fotosSoComMiniatura } from '@utils/image-limit-phrases.js';

const MB = 1024 * 1024;

describe('imageRefusalNotice — peso em bytes', () => {
    it('nomeia o valor medido e o teto, os dois em MB', () => {
        expect(imageRefusalNotice(ImageRefusal.PESO, { bytes: 37 * MB, maxBytes: 10 * MB }))
            .toBe('A imagem não foi carregada: o arquivo tem 37 MB e o máximo é 10 MB.');
    });

    it('usa vírgula decimal e uma casa para um valor quebrado', () => {
        expect(imageRefusalNotice(ImageRefusal.PESO, { bytes: 10.5 * MB, maxBytes: 10 * MB }))
            .toBe('A imagem não foi carregada: o arquivo tem 10,5 MB e o máximo é 10 MB.');
    });

    it('um byte acima do teto NUNCA imprime "tem 10 MB e o máximo é 10 MB"', () => {
        // The measured side rounds UP, the same boundary rule the megapixel branch already had.
        // Rounding to nearest turned the whole 10,00–10,05 MB window into a sentence that reads
        // as a product bug instead of a refusal.
        expect(imageRefusalNotice(ImageRefusal.PESO, { bytes: 10 * MB + 1, maxBytes: 10 * MB }))
            .toBe('A imagem não foi carregada: o arquivo tem 10,1 MB e o máximo é 10 MB.');
    });

    it('não anuncia um número que não existe', () => {
        // Um chamador que esqueça a medida não pode produzir "tem NaN MB": a frase continua
        // dizendo o teto, e o '?' é legível como "não sei" em vez de parecer um defeito.
        expect(imageRefusalNotice(ImageRefusal.PESO, { maxBytes: 10 * MB }))
            .toBe('A imagem não foi carregada: o arquivo tem ? MB e o máximo é 10 MB.');
    });
});

describe('imageRefusalNotice — dimensão em pixels', () => {
    it('lado acima do teto nomeia as duas dimensões e o teto de lado', () => {
        expect(imageRefusalNotice(ImageRefusal.LADO, { width: 20000, height: 15000, maxSide: 8192 }))
            .toBe('A imagem não foi carregada: ela tem 20000 x 15000 px e o máximo é 8192 px de lado.');
    });

    it('área acima do teto nomeia os megapixels medidos e o teto', () => {
        expect(imageRefusalNotice(ImageRefusal.AREA, {
            width: 8000, height: 7000, maxPixels: 50 * 1000 * 1000,
        })).toBe('A imagem não foi carregada: ela tem 8000 x 7000 px (56 MP) e o máximo é 50 MP.');
    });
});

describe('imageRefusalNotice — tipo, ausência e ilegível', () => {
    it('o tipo nomeia os formatos DERIVADOS da lista que o portão aplica', () => {
        expect(imageRefusalNotice(ImageRefusal.TIPO, {
            tipos: ['image/jpeg', 'image/png', 'image/webp'],
        })).toBe('A imagem não foi carregada: tipo de arquivo não suportado (use JPEG, PNG ou WebP).');
    });

    it('uma lista de um item não vira "ou" pendurado', () => {
        expect(imageRefusalNotice(ImageRefusal.TIPO, { tipos: ['image/png'] }))
            .toBe('A imagem não foi carregada: tipo de arquivo não suportado (use PNG).');
    });

    it('sem lista nenhuma degrada para os três formatos, nunca para uma frase vazia', () => {
        expect(imageRefusalNotice(ImageRefusal.TIPO))
            .toBe('A imagem não foi carregada: tipo de arquivo não suportado (use JPEG, PNG ou WebP).');
    });

    it('ausência de arquivo não finge que uma imagem foi recusada', () => {
        expect(imageRefusalNotice(ImageRefusal.AUSENTE)).toBe('Nenhum arquivo selecionado.');
    });

    it('arquivo ilegível diz que não foi carregada, sem inventar número', () => {
        expect(imageRefusalNotice(ImageRefusal.ILEGIVEL))
            .toBe('A imagem não foi carregada: não foi possível ler este arquivo de imagem.');
    });
});

describe('imageRefusalNotice — degradação', () => {
    it('motivo desconhecido ainda AVISA, em vez de devolver string vazia', () => {
        // Silêncio é o defeito que este módulo existe para remover: uma recusa por um motivo
        // que ninguém cadastrou tem de continuar dizendo que a imagem não entrou.
        for (const motivo of ['', null, undefined, 'motivo-que-ninguem-escreveu']) {
            expect(imageRefusalNotice(motivo)).toBe('A imagem não foi carregada.');
        }
    });

    it('medida nula não derruba a frase', () => {
        expect(imageRefusalNotice(ImageRefusal.AUSENTE, null)).toBe('Nenhum arquivo selecionado.');
    });
});

describe('fotosSoComMiniatura — as fotos que uma cópia fora do servidor não trouxe', () => {
    it('nada faltando é silêncio (null), inclusive entrada que não é lista nem contagem', () => {
        for (const vazio of [[], null, undefined, 0, -3, NaN, 1.5, 'duas']) {
            expect(fotosSoComMiniatura(vazio)).toBeNull();
        }
    });

    it('uma foto: singular, com o nome', () => {
        expect(fotosSoComMiniatura([{ id: 'a', nome: 'ponte.jpg' }]))
            .toBe('1 foto anexa ("ponte.jpg") não pôde ser baixada do servidor e fica só com a miniatura.');
    });

    it('nomeia até três e conta o resto, inclusive as sem nome', () => {
        const lista = [
            { nome: 'a.jpg' }, { nome: 'b.jpg' }, { nome: null }, { nome: 'c.jpg' }, { nome: 'd.jpg' },
        ];
        expect(fotosSoComMiniatura(lista))
            .toBe('5 fotos anexas ("a.jpg", "b.jpg", "c.jpg" e mais 2) não puderam ser baixadas do servidor e ficam só com a miniatura.');
    });

    it('nenhuma com nome: só a contagem, sem parênteses vazios', () => {
        expect(fotosSoComMiniatura([{ nome: '' }, {}]))
            .toBe('2 fotos anexas não puderam ser baixadas do servidor e ficam só com a miniatura.');
    });

    it('a CONTAGEM que atravessou a página pela URL (?fotos=), onde nome nunca viaja', () => {
        expect(fotosSoComMiniatura(1))
            .toBe('1 foto anexa não pôde ser baixada do servidor e fica só com a miniatura.');
        expect(fotosSoComMiniatura(4))
            .toBe('4 fotos anexas não puderam ser baixadas do servidor e ficam só com a miniatura.');
    });
});
