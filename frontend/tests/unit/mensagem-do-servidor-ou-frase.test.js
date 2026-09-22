// Path: tests/unit/mensagem-do-servidor-ou-frase.test.js

/**
 * `serverMessageOr` (`src/js/utilities/request-failure.js`): a frase que a tela mostra quando um
 * pedido falha.
 *
 * O DEFEITO QUE ELE FECHA, dito pelo dono em 2026-09-22 sobre um aviso do mapa ("O servidor
 * respondeu 502"): as páginas sem mapa faziam `error?.message || 'frase'`, e duas strings que não
 * são frase de ninguém passavam por esse `||` e viravam o toast inteiro. Uma é o `HTTP <status>`
 * que `store/sync/api-client.js` inventa quando a resposta não trouxe mensagem (o 502 do proxy com
 * corpo HTML é o caso comum); a outra é o `Failed to fetch` do navegador, quando não houve resposta.
 */

import { describe, it, expect } from 'vitest';
import { serverMessageOr, withFailureDetail } from '../../src/js/utilities/request-failure.js';

const FRASE = 'Não foi possível carregar a lixeira.';

describe('serverMessageOr', () => {
    it('a frase do SERVIDOR vence, porque é ela que diz o porquê', () => {
        const erro = Object.assign(new Error('Você já tem 100 atlas.'), { status: 429 });
        expect(serverMessageOr(erro, FRASE)).toBe('Você já tem 100 atlas.');
    });

    it('o eco "HTTP nnn" do cliente NÃO é frase: cai na do chamador, e o número some da tela', () => {
        for (const status of [404, 500, 502, 503]) {
            const erro = Object.assign(new Error(`HTTP ${status}`), { status });
            expect(serverMessageOr(erro, FRASE), String(status)).toBe(FRASE);
        }
    });

    it('só o eco INTEIRO é placeholder: frase do servidor que comece por "HTTP" continua frase', () => {
        // CONTROLE NEGATIVO: um filtro por prefixo engoliria esta, que é informação.
        expect(serverMessageOr(new Error('HTTP 404: dono não pode ser removido'), FRASE))
            .toBe('HTTP 404: dono não pode ser removido');
    });

    it('o texto do navegador sem resposta também cai na frase do chamador', () => {
        for (const texto of ['Failed to fetch', 'NetworkError when attempting to fetch resource.',
            'Load failed', 'The user aborted a request.']) {
            expect(serverMessageOr(new TypeError(texto), FRASE), texto).toBe(FRASE);
        }
    });

    it('nunca devolve vazio, nem com entrada que não é erro nenhum', () => {
        for (const entrada of [undefined, null, {}, '', 'texto solto', { message: '   ' }, { message: 7 }]) {
            expect(serverMessageOr(entrada, FRASE), String(entrada)).toBe(FRASE);
        }
    });

    it('apara o espaço em volta da frase do servidor', () => {
        expect(serverMessageOr({ message: '  Nome já em uso.  ' }, FRASE)).toBe('Nome já em uso.');
    });
});

/**
 * `withFailureDetail`: a frase da casa, a do servidor quando houver, e o status como a linha
 * discreta "Código: nnn". É o que as abas de diagnóstico e de uso usam no lugar de emendar a
 * mensagem CRUA depois da frase, que era a porta lateral por onde o "HTTP 502" e o "Failed to
 * fetch" ainda chegavam à tela (2026-09-22).
 */
describe('withFailureDetail', () => {
    it('o eco "HTTP nnn" some da frase e o número volta como "Código: nnn"', () => {
        const erro = Object.assign(new Error('HTTP 502'), { status: 502 });
        expect(withFailureDetail(FRASE, erro)).toBe(`${FRASE} Código: 502`);
        expect(withFailureDetail(FRASE, erro)).not.toMatch(/HTTP/);
    });

    it('sem resposta nenhuma, só a frase: nem o texto do navegador, nem um código inventado', () => {
        expect(withFailureDetail(FRASE, new TypeError('Failed to fetch'))).toBe(FRASE);
    });

    it('a frase do servidor entra depois da da casa, terminada, e o código por último', () => {
        const erro = Object.assign(new Error('Rota não encontrada'), { status: 404 });
        expect(withFailureDetail(FRASE, erro)).toBe(`${FRASE} Rota não encontrada. Código: 404`);
        // Já pontuada, não ganha um segundo ponto.
        const pontuada = Object.assign(new Error('O papel mudou.'), { status: 403 });
        expect(withFailureDetail(FRASE, pontuada)).toBe(`${FRASE} O papel mudou. Código: 403`);
    });

    it('SUJO: entrada que não é erro devolve só a frase; texto enorme do servidor é cortado', () => {
        for (const entrada of [undefined, null, {}, '', { message: '   ' }, { status: 0 }, { status: 'x' }]) {
            expect(withFailureDetail(FRASE, entrada), JSON.stringify(entrada)).toBe(FRASE);
        }
        const longo = withFailureDetail(FRASE, { message: 'x'.repeat(500) }, { maxLength: 50 });
        expect(longo.length).toBeLessThanOrEqual(FRASE.length + 1 + 50 + 1);
        expect(longo).toContain('…');
    });
});
