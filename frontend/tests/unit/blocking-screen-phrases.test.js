// Path: tests/unit/blocking-screen-phrases.test.js
//
// A TELA DE BLOQUEIO CULPAVA A REDE POR ERRO DO PROGRAMA.
//
// `showUnavailableScreen()` não tinha parâmetro e exportava um símbolo só. Nasceu para o
// boot fail-fast (`GET /api/config` que não responde) e virou o catch-all do `catch` de topo
// das quatro páginas. Uma exceção de JavaScript durante a montagem do Drive anunciava "Não
// foi possível conectar ao servidor. Verifique sua conexão", que é o único conselho que não
// pode ajudar, porque o servidor tinha respondido.
//
// O que este arquivo prende é a PROPRIEDADE, não a redação: a tela de erro de aplicação não
// pode mandar ninguém olhar a conexão, e a causa desconhecida tem de cair no lado
// conservador.

import { describe, it, expect } from 'vitest';
import {
    BlockingCause,
    blockingScreenContent,
    causasComTela
} from '../../src/js/ui/blocking-screen-phrases.js';

describe('blockingScreenContent', () => {
    it('toda causa declarada tem tela própria', () => {
        // Derivado do enum, não de uma lista escrita aqui: causa nova reprova em vez de cair
        // calada no ramo padrão.
        expect(causasComTela().sort()).toEqual(Object.values(BlockingCause).sort());
    });

    it('as duas telas são inteiramente diferentes: título, texto e rótulo do botão', () => {
        const rede = blockingScreenContent(BlockingCause.SERVER_UNREACHABLE);
        const app = blockingScreenContent(BlockingCause.APP_ERROR);
        expect(rede.title).not.toBe(app.title);
        expect(rede.message).not.toBe(app.message);
        expect(rede.retryLabel).not.toBe(app.retryLabel);
    });

    it('A MENTIRA ESPECÍFICA: o erro de aplicação NÃO manda verificar a conexão', () => {
        // O defeito medido, palavra por palavra.
        const { message } = blockingScreenContent(BlockingCause.APP_ERROR);
        expect(message).not.toMatch(/conex|conectar|rede|internet/i);
        expect(message).toMatch(/servidor respondeu/i);
    });

    it('e o de rede continua dizendo o que sempre disse, porque ali está certo', () => {
        const { message, title } = blockingScreenContent(BlockingCause.SERVER_UNREACHABLE);
        expect(title).toBe('EBGeo indisponível');
        expect(message).toMatch(/Verifique sua conexão/);
    });

    it('causa desconhecida cai no lado CONSERVADOR (erro de aplicação)', () => {
        // A direção importa. Errar para o lado do erro de aplicação custa um pedido de ajuda;
        // errar para o lado da rede manda a pessoa depurar a internet dela por um defeito do
        // programa, que é o defeito original deste achado.
        const app = blockingScreenContent(BlockingCause.APP_ERROR);
        for (const entrada of [undefined, null, '', 'causa-que-nao-existe', 7, {}]) {
            expect(blockingScreenContent(entrada), String(entrada)).toEqual(app);
        }
    });

    it('toda tela tem os três campos preenchidos', () => {
        for (const causa of causasComTela()) {
            const tela = blockingScreenContent(causa);
            expect(tela.title, causa).toBeTruthy();
            expect(tela.message, causa).toBeTruthy();
            expect(tela.retryLabel, causa).toBeTruthy();
        }
    });
});
