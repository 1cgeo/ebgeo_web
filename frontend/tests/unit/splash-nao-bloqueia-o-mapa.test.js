// Path: tests/unit/splash-nao-bloqueia-o-mapa.test.js

/**
 * @fileoverview A CORTINA DE ABERTURA NAO PODE BLOQUEAR O MAPA ENQUANTO SOME.
 *
 * O DEFEITO, medido. `.loading-background` (a folha esta em `frontend/index.html`) e
 * `position: fixed`, `100vw` por `100vh`, `z-index: 9999`, e nao declarava `pointer-events`.
 * `hideLoadingScreen` poe `opacity: 0` com transicao de 0,5 s e so REMOVE o no meio segundo
 * depois. Durante esse meio segundo a pessoa via o mapa aparecendo e nao conseguia tocar nele:
 * o clique morria no retangulo transparente. Sem erro nenhum, em TODA carga de pagina, e cada
 * troca de atlas e uma carga de pagina.
 *
 * O NUMERO QUE JUSTIFICA O CASO: a transicao custa 531 a 611 ms, contra 200 a 250 ms de toda a
 * janela de trabalho entre o evento `load` do MapLibre e o splash comecar a sumir. A cortina
 * segurava a interacao por mais tempo do que o app inteiro levava para ficar pronto.
 *
 * POR QUE UM TESTE, e nao so a linha: `pointer-events` e invisivel na leitura e invisivel na
 * tela. Quem reorganizar `hideLoadingScreen` amanha nao tem como saber, ali, que aquela linha
 * e a diferenca entre um mapa vivo e um mapa que ignora cliques por meio segundo. E o mesmo
 * genero de armadilha que `.data-layer-notice` ja pagou neste repositorio, e que
 * `tests/unit/aviso-de-camada-nao-engole-clique.test.js` guarda do lado da folha.
 *
 * A ORDEM IMPORTA e por isso ela e asserida: `pointerEvents` tem de ser escrito ANTES de a
 * transicao comecar. Escrever depois deixa uma janela, curta mas real, em que a cortina ja
 * esta sumindo e ainda bloqueia.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { hideLoadingScreen } from '@js/ui/loading-screen.js';

/** Um duble de elemento que REGISTRA a ordem das escritas de estilo. */
function criarCortina() {
    const ordem = [];
    const style = new Proxy({}, {
        set(alvo, prop, valor) {
            ordem.push(String(prop));
            alvo[prop] = valor;
            return true;
        },
        get(alvo, prop) { return alvo[prop]; },
    });
    return { style, ordem, removida: false, remove() { this.removida = true; } };
}

describe('o splash nao bloqueia o mapa enquanto some', () => {
    let cortina;
    let escondidos;

    beforeEach(() => {
        vi.useFakeTimers();
        cortina = criarCortina();
        escondidos = [{ classList: { add: vi.fn() } }];
        vi.stubGlobal('document', {
            querySelector: (sel) => (sel === '.loading-background' ? cortina : null),
            querySelectorAll: () => escondidos,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('a cortina deixa o clique passar assim que comeca a sumir', () => {
        hideLoadingScreen();
        expect(
            cortina.style.pointerEvents,
            'sem isto a cortina engole todo clique durante o meio segundo da transicao'
        ).toBe('none');
    });

    it('ORDEM: ela para de bloquear ANTES de a transicao comecar', () => {
        hideLoadingScreen();
        const iBloqueio = cortina.ordem.indexOf('pointerEvents');
        const iOpacidade = cortina.ordem.indexOf('opacity');
        expect(iBloqueio, 'pointerEvents nunca foi escrito').toBeGreaterThanOrEqual(0);
        expect(iOpacidade, 'opacity nunca foi escrito').toBeGreaterThanOrEqual(0);
        expect(
            iBloqueio,
            'escrever pointerEvents depois da opacidade deixa uma janela em que a cortina ja some e ainda bloqueia'
        ).toBeLessThan(iOpacidade);
    });

    it('CONTROLE: o resto do gesto continua inteiro', () => {
        // Sem isto, uma versao que so escrevesse `pointerEvents` e nao fizesse mais nada
        // passaria nos dois casos acima com a cortina de pe para sempre.
        hideLoadingScreen();
        expect(cortina.style.opacity).toBe('0');
        expect(cortina.style.transition).toContain('opacity');
        expect(cortina.removida, 'a cortina nao pode sumir antes da transicao terminar').toBe(false);
        vi.advanceTimersByTime(500);
        expect(cortina.removida, 'a cortina precisa sair do DOM depois da transicao').toBe(true);
        expect(escondidos[0].classList.add).toHaveBeenCalledWith('loaded');
    });

    it('CONTROLE: sem cortina na pagina, nada quebra', () => {
        vi.stubGlobal('document', { querySelector: () => null, querySelectorAll: () => [] });
        expect(() => hideLoadingScreen()).not.toThrow();
    });
});
