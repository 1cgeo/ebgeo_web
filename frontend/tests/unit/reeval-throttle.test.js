// Path: tests/unit/reeval-throttle.test.js
//
// THE THROTTLE THAT DECIDES WHETHER THE 360 GESTURE LOADS ANYTHING AT ALL.
//
// This is a BEHAVIOUR test over the real `src/js/street_view_tool/reeval-throttle.js`, driven
// by an INJECTED clock and an injected timer, so a 360 degree turn is replayed frame by frame
// with no wall clock and no flake. Time here is a number this file controls; nothing sleeps.
//
// WHAT THE DEFECT WAS. The previous shape was a RESET DEBOUNCE: every call did `clearTimeout`
// before arming a new timer. `atualizarCamera` runs once per frame, so while the gesture was
// happening the timer restarted faster than the 120 ms window and the re-evaluation NEVER
// fired. Measured by the original author on the real app: a full 360 degree turn downloaded
// ZERO tiles and uploaded ZERO bytes of texture, in both repetitions, across 36 frames in
// 1374 ms. After the fix, the same gesture measured 32.3 MB of texture in 13 to 20 calls.
//
// The first case below IS that measurement, replayed: it runs the gesture and asserts the run
// count is greater than zero, and it also runs the OLD reset-debounce shape over the same
// frames and asserts that the old shape scores exactly zero. That second half is the negative
// control living inside the test: the guard proves it can see the defect on every run, instead
// of depending on somebody remembering to revert the fix by hand.
//
// WHAT THIS DOES NOT COVER: whether `tile-loader.js` actually USES this throttle. It does, and
// `frontend/tests/unit/tile-loader-consertos-de-desempenho.test.js` drives the LEADING edge
// through the real loader, which is possible because that edge is synchronous. Everything the
// WINDOW governs stays here: the loader owns real timers for its own request queue, so faking
// `Date.now` and `setTimeout` around it would fake the queue too, and the test would end up
// measuring its own scaffolding instead of the throttle.

import { describe, it, expect } from 'vitest';
import { createReevalThrottle } from '@js/street_view_tool/reeval-throttle.js';

/** The window the loader uses, in ms. */
const JANELA = 120;

/**
 * A fake clock plus a fake timer queue, both driven by `avancar`.
 *
 * The timer queue holds at most one entry in practice, but it is a list so that a leak (two
 * armed timers) would show up as a length instead of silently overwriting.
 *
 * @returns {object} the harness
 */
function relogioFalso() {
    let t = 0;
    let proximoId = 1;
    const agendados = new Map();
    return {
        agora: () => t,
        agendar(fn, ms) {
            const id = proximoId++;
            agendados.set(id, { fn, quando: t + ms });
            return id;
        },
        cancelarAgendamento(id) {
            agendados.delete(id);
        },
        armados: () => agendados.size,
        /**
         * Moves the clock forward, firing every timer whose deadline is reached, in order.
         *
         * @param {number} ms - how much to advance
         */
        avancar(ms) {
            const alvo = t + ms;
            for (;;) {
                let proximo = null;
                for (const [id, e] of agendados) {
                    if (e.quando <= alvo && (proximo === null || e.quando < proximo[1].quando)) {
                        proximo = [id, e];
                    }
                }
                if (proximo === null) break;
                agendados.delete(proximo[0]);
                t = Math.max(t, proximo[1].quando);
                proximo[1].fn();
            }
            t = alvo;
        },
    };
}

/**
 * The OLD shape, kept here as the negative control: reset debounce.
 *
 * @param {object} r - the fake clock harness
 * @param {() => void} executar - what it would run
 * @returns {{pedir: () => void}} the old throttle
 */
function debounceDeResetAntigo(r, executar) {
    let temporizador = null;
    return {
        pedir() {
            if (temporizador !== null) r.cancelarAgendamento(temporizador);
            temporizador = r.agendar(() => {
                temporizador = null;
                executar();
            }, JANELA);
        },
    };
}

describe('createReevalThrottle: o giro que nao carregava nada', () => {
    it('CASO 1: a volta de 360 graus reavalia varias vezes, e o debounce antigo ZERO', () => {
        // O gesto medido: 36 quadros em 1374 ms, ou seja um quadro a cada ~38 ms,
        // que e mais rapido que a janela de 120 ms. E essa desigualdade que fazia
        // o `clearTimeout` reiniciar o temporizador para sempre.
        const QUADROS = 36;
        const PASSO = Math.round(1374 / QUADROS);
        expect(PASSO).toBeLessThan(JANELA);

        const r = relogioFalso();
        let novas = 0;
        const estrangulador = createReevalThrottle({
            intervaloMs: JANELA,
            executar: () => { novas++; },
            agora: r.agora,
            agendar: r.agendar,
            cancelarAgendamento: r.cancelarAgendamento,
        });

        const r2 = relogioFalso();
        let velhas = 0;
        const antigo = debounceDeResetAntigo(r2, () => { velhas++; });

        for (let q = 0; q < QUADROS; q++) {
            estrangulador.pedir();
            antigo.pedir();
            r.avancar(PASSO);
            r2.avancar(PASSO);
        }

        // O DEFEITO, replicado: durante o gesto inteiro, zero reavaliacoes.
        expect(velhas).toBe(0);
        // O CONSERTO: uma por janela, mais a de entrada. 1374 ms / 120 ms = 11,45.
        expect(novas).toBe(12);
        expect(novas).toBeGreaterThan(0);
    });

    it('a borda de ENTRADA dispara o primeiro pedido na hora, sem esperar', () => {
        const r = relogioFalso();
        let n = 0;
        const e = createReevalThrottle({
            intervaloMs: JANELA,
            executar: () => { n++; },
            agora: r.agora,
            agendar: r.agendar,
            cancelarAgendamento: r.cancelarAgendamento,
        });
        e.pedir();
        expect(n).toBe(1);
        expect(e.pendente()).toBe(false);
        expect(r.armados()).toBe(0);
    });

    it('a borda de SAIDA avalia a posicao FINAL do gesto, e uma vez so', () => {
        const r = relogioFalso();
        let n = 0;
        const e = createReevalThrottle({
            intervaloMs: JANELA,
            executar: () => { n++; },
            agora: r.agora,
            agendar: r.agendar,
            cancelarAgendamento: r.cancelarAgendamento,
        });
        e.pedir();          // borda de entrada, t=0
        expect(n).toBe(1);
        r.avancar(10);
        e.pedir();          // dentro da janela: arma a saida
        e.pedir();          // e as repeticoes nao armam um segundo temporizador
        e.pedir();
        expect(n).toBe(1);
        expect(e.pendente()).toBe(true);
        expect(r.armados()).toBe(1);

        r.avancar(JANELA);  // o gesto parou; a saida dispara
        expect(n).toBe(2);
        expect(e.pendente()).toBe(false);
    });

    it('a espera da saida completa a janela, nunca uma janela inteira a mais', () => {
        const r = relogioFalso();
        const marcas = [];
        const e = createReevalThrottle({
            intervaloMs: JANELA,
            executar: () => { marcas.push(r.agora()); },
            agora: r.agora,
            agendar: r.agendar,
            cancelarAgendamento: r.cancelarAgendamento,
        });
        e.pedir();          // t=0
        r.avancar(100);
        e.pedir();          // faltam 20 ms para a janela fechar
        r.avancar(20);
        // Absoluto: a saida cai em t=120, e nao em t=220.
        expect(marcas).toEqual([0, 120]);
    });

    it('um pedido isolado depois da janela usa a borda de entrada de novo', () => {
        const r = relogioFalso();
        const marcas = [];
        const e = createReevalThrottle({
            intervaloMs: JANELA,
            executar: () => { marcas.push(r.agora()); },
            agora: r.agora,
            agendar: r.agendar,
            cancelarAgendamento: r.cancelarAgendamento,
        });
        e.pedir();
        r.avancar(500);
        e.pedir();
        r.avancar(500);
        e.pedir();
        expect(marcas).toEqual([0, 500, 1000]);
        expect(r.armados()).toBe(0);
    });

    it('cancelar solta o temporizador e NAO reabre a janela', () => {
        const r = relogioFalso();
        let n = 0;
        const e = createReevalThrottle({
            intervaloMs: JANELA,
            executar: () => { n++; },
            agora: r.agora,
            agendar: r.agendar,
            cancelarAgendamento: r.cancelarAgendamento,
        });
        e.pedir();          // t=0, entrada
        r.avancar(10);
        e.pedir();          // arma a saida
        e.cancelar();
        expect(e.pendente()).toBe(false);
        expect(r.armados()).toBe(0);

        r.avancar(JANELA * 5);
        expect(n).toBe(1);  // a saida cancelada nao voltou

        // A janela NAO foi reaberta: o carimbo da ultima execucao continua o de
        // t=0, entao um pedido depois dela usa a entrada normalmente.
        e.pedir();
        expect(n).toBe(2);
    });

    it('cancelar sem nada armado e inocuo, e pode repetir', () => {
        const r = relogioFalso();
        let n = 0;
        const e = createReevalThrottle({
            intervaloMs: JANELA,
            executar: () => { n++; },
            agora: r.agora,
            agendar: r.agendar,
            cancelarAgendamento: r.cancelarAgendamento,
        });
        e.cancelar();
        e.cancelar();
        expect(n).toBe(0);
        e.pedir();
        expect(n).toBe(1);
    });

    it('intervalo zero degenera para "sempre agora", sem armar temporizador', () => {
        const r = relogioFalso();
        let n = 0;
        const e = createReevalThrottle({
            intervaloMs: 0,
            executar: () => { n++; },
            agora: r.agora,
            agendar: r.agendar,
            cancelarAgendamento: r.cancelarAgendamento,
        });
        e.pedir();
        e.pedir();
        e.pedir();
        expect(n).toBe(3);
        expect(r.armados()).toBe(0);
    });

    it('um relogio que anda para tras nao trava o estrangulador', () => {
        // Nao acontece com `Date.now` monotonico na pratica, mas ajuste de relogio
        // do sistema acontece, e travar seria o mesmo sintoma do defeito original.
        const r = relogioFalso();
        let n = 0;
        const e = createReevalThrottle({
            intervaloMs: JANELA,
            executar: () => { n++; },
            agora: r.agora,
            agendar: r.agendar,
            cancelarAgendamento: r.cancelarAgendamento,
        });
        r.avancar(10000);
        e.pedir();          // entrada, t=10000
        expect(n).toBe(1);
        let recuado = 5000;
        const eRecuado = createReevalThrottle({
            intervaloMs: JANELA,
            executar: () => { n++; },
            agora: () => recuado,
            agendar: (fn) => { fn(); return 1; },
            cancelarAgendamento: () => {},
        });
        recuado = 5000;
        eRecuado.pedir();   // t=5000 >= 0 + 120: entrada
        recuado = 4000;     // relogio recuou
        eRecuado.pedir();   // arma a saida, que este agendador dispara na hora
        expect(n).toBe(3);
    });
});
