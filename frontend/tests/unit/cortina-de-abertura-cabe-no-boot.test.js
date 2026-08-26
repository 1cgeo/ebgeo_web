// Path: tests/unit/cortina-de-abertura-cabe-no-boot.test.js

/**
 * @fileoverview A CORTINA DE ABERTURA DURA O QUE O BOOT DURA, E OS DOIS NUMEROS ANDAM JUNTOS.
 *
 * A MEDIDA QUE ESCOLHEU O NUMERO. A janela de trabalho do boot, entre o evento `load` do
 * MapLibre e a cortina COMECAR a sumir, mede 200 a 250 ms. A transicao de saida custava 531 a
 * 611 ms. A cortina cobria a espera duas vezes: o app ficava pronto e a pessoa continuava
 * olhando para o veu por mais 300 ms de nada. 200 ms cobrem a janela e param nela.
 *
 * O QUE ESTE ARQUIVO GUARDA, e que a leitura da fonte nao guarda. `hideLoadingScreen` escreve
 * a duracao em DOIS lugares com unidades DIFERENTES: a transicao em CSS, o `setTimeout` em
 * milissegundos de JavaScript. Nada no compilador, no eslint ou no navegador liga um ao outro.
 * Quem mexer em um e esquecer o outro produz um de dois defeitos, os dois silenciosos:
 *
 * - remocao ANTES do fim da transicao: a cortina some de um golpe, ainda visivel, e o que se ve
 *   e um piscar em vez de um esmaecer;
 * - remocao DEPOIS: fica um retangulo `100vw` por `100vh` invisivel parado na arvore. Hoje ele
 *   e inerte (`pointerEvents: 'none'`, guardado por `splash-nao-bloqueia-o-mapa.test.js`), entao
 *   o estrago e um no a mais; sem aquela linha, seria o defeito que aquele arquivo mede.
 *
 * O CASO IRMAO, `splash-nao-bloqueia-o-mapa.test.js`, guarda o `pointerEvents` e a ORDEM das
 * escritas. Ele avanca o relogio 500 ms de proposito, entao ele passa com qualquer duracao ate
 * meio segundo e NAO ancora numero nenhum. Este arquivo ancora, e por isso os dois existem.
 *
 * O QUE NAO ESTA AQUI, de proposito: nada exige que a cortina caia no `load` do MapLibre.
 * Naquele instante o ESTILO carregou, mas os TILES podem nao ter chegado, e trocar cortina por
 * mapa cinza vazio piora o que se ve — a cortina se anuncia como espera, o mapa vazio se le
 * como defeito.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hideLoadingScreen } from '@js/ui/loading-screen.js';

/** O teto que a medida do boot justifica. Acima disto a cortina sobra na tela. */
const TETO_MS = 250;

/** Um duble de cortina que so guarda o que foi escrito nela. */
function criarCortina() {
    return {
        style: {},
        removida: false,
        remove() { this.removida = true; },
    };
}

/** Le os milissegundos de uma transicao CSS (`opacity 200ms` ou `opacity 0.2s`). */
function msDaTransicao(valor) {
    const emMs = /(\d+(?:\.\d+)?)\s*ms/.exec(valor);
    if (emMs) return Number(emMs[1]);
    const emS = /(\d+(?:\.\d+)?)\s*s/.exec(valor);
    return emS ? Number(emS[1]) * 1000 : null;
}

describe('a cortina de abertura cabe na janela de boot que a justifica', () => {
    let cortina;

    beforeEach(() => {
        vi.useFakeTimers();
        cortina = criarCortina();
        vi.stubGlobal('document', {
            querySelector: (sel) => (sel === '.loading-background' ? cortina : null),
            querySelectorAll: () => [],
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('a transicao nao passa da janela de trabalho do boot', () => {
        hideLoadingScreen();
        const ms = msDaTransicao(cortina.style.transition);
        expect(ms, `transicao ilegivel: "${cortina.style.transition}"`).not.toBeNull();
        expect(
            ms,
            'a janela entre o `load` do MapLibre e a cortina sumir mede 200 a 250 ms; '
            + 'uma cortina mais longa fica na tela depois de o app estar pronto'
        ).toBeLessThanOrEqual(TETO_MS);
        // CONTROLE: uma duracao zero passaria no teto acima e trocaria o esmaecer por um corte.
        expect(ms, 'sem duracao nenhuma a cortina nao esmaece, ela pisca').toBeGreaterThan(0);
    });

    it('a remocao acontece EXATAMENTE no fim da transicao, nunca antes nem depois', () => {
        hideLoadingScreen();
        const ms = msDaTransicao(cortina.style.transition);

        // Um milissegundo antes do fim ela ainda tem de estar na arvore: remover antes faz a
        // cortina sumir de um golpe, ainda visivel.
        vi.advanceTimersByTime(ms - 1);
        expect(cortina.removida, 'a cortina saiu do DOM antes de terminar de sumir').toBe(false);

        // E no milissegundo do fim ela tem de sair: ficar depois deixa um retangulo de tela
        // inteira parado na arvore.
        vi.advanceTimersByTime(1);
        expect(
            cortina.removida,
            'a transicao terminou e a cortina continua no DOM: os dois numeros divergiram'
        ).toBe(true);
    });
});
