// Path: tests/unit/tela-de-progresso-so-aparece-se-demorar.test.js

/**
 * O cartão "Preparando seus dados" SÓ APARECE SE A ESPERA FOR LONGA.
 *
 * Relato do dono em 2026-09-20: o portão de migração roda em todo boot das quatro páginas que tocam
 * o acervo, quase sempre termina numa fração de segundo, e desenhava o cartão na hora. O resultado
 * era um cartão branco piscando por cima da abertura verde em TODA carga de página.
 *
 * A metade que este arquivo existe para prender é a do CANCELAMENTO. O portão reusa a mesma vaga de
 * tela para a recuperação, então um cronômetro que dispare depois de o portão ter decidido desenha
 * o progresso por cima de um boot pronto, ou SUBSTITUI a tela de recuperação. É corrida, e corrida
 * se mede com o evento disparando no instante errado, não com estatística de navegador: o relógio
 * aqui é injetado e o disparo tardio é chamado à mão.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeferredScreen, PROGRESS_SCREEN_DELAY_MS } from '../../src/js/ui/deferred-screen.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'js');

/** Relógio de mentira: guarda o callback para o teste disparar quando quiser, inclusive TARDE. */
function relogio() {
    const pendentes = new Map();
    let proximo = 1;
    return {
        setTimer: (fn, ms) => { const id = proximo++; pendentes.set(id, { fn, ms }); return id; },
        clearTimer: (id) => { pendentes.delete(id); },
        pendentes,
        /** Dispara mesmo o que já foi limpo: é o navegador entregando um timer que perdeu a corrida. */
        capturar: () => [...pendentes.values()],
    };
}

function cenario(opcoes = {}) {
    const r = relogio();
    const desenhos = [];
    const tela = createDeferredScreen({
        message: 'inicial',
        show: (mensagem) => {
            const handle = { text: { textContent: mensagem } };
            desenhos.push(handle);
            return handle;
        },
        setTimer: r.setTimer,
        clearTimer: r.clearTimer,
        ...opcoes,
    });
    return { r, desenhos, tela };
}

describe('tela de progresso adiada', () => {
    it('nasce ARMADA e não desenhada, com o prazo declarado', () => {
        const { r, desenhos, tela } = cenario();
        expect(desenhos).toHaveLength(0);
        expect(tela.isShown()).toBe(false);
        expect([...r.pendentes.values()].map((p) => p.ms)).toEqual([PROGRESS_SCREEN_DELAY_MS]);
        // O prazo tem de caber entre "boot comum não pisca" e "espera real fala": abaixo de 300 ms
        // o cartão volta a piscar, acima de 1,5 s uma cópia de verdade fica muda tempo demais.
        expect(PROGRESS_SCREEN_DELAY_MS).toBeGreaterThanOrEqual(300);
        expect(PROGRESS_SCREEN_DELAY_MS).toBeLessThanOrEqual(1500);
    });

    it('o boot rápido cancela antes do prazo, e NADA é desenhado', () => {
        const { r, desenhos, tela } = cenario();
        tela.cancel();
        expect(r.pendentes.size).toBe(0);
        expect(desenhos).toHaveLength(0);
    });

    it('A CORRIDA PERDEDORA: o cronômetro que dispara DEPOIS do cancelamento não desenha', () => {
        const { r, desenhos, tela } = cenario();
        const [tardio] = r.capturar();
        tela.cancel();
        tardio.fn();
        expect(desenhos).toHaveLength(0);
        expect(tela.isShown()).toBe(false);
    });

    it('depois de cancelada, nem `showNow` nem `setText` desenham ou escrevem', () => {
        const { desenhos, tela } = cenario();
        tela.cancel();
        tela.showNow();
        tela.setText('tarde demais');
        expect(desenhos).toHaveLength(0);
    });

    it('a espera longa desenha UMA vez, com o texto mais recente posto enquanto armada', () => {
        const { r, desenhos, tela } = cenario();
        tela.setText('copiando 3 de 10');
        const [prazo] = r.capturar();
        prazo.fn();
        expect(desenhos).toHaveLength(1);
        expect(desenhos[0].text.textContent).toBe('copiando 3 de 10');
        expect(tela.isShown()).toBe(true);

        tela.setText('copiando 7 de 10');
        expect(desenhos[0].text.textContent).toBe('copiando 7 de 10');
    });

    it('`showNow` desenha na hora, desarma o prazo e não desenha de novo', () => {
        const { r, desenhos, tela } = cenario();
        const [prazo] = r.capturar();
        tela.showNow();
        expect(desenhos).toHaveLength(1);
        expect(r.pendentes.size).toBe(0);
        tela.showNow();
        prazo.fn();
        expect(desenhos).toHaveLength(1);
    });

    it('recusa nascer sem função de desenho', () => {
        expect(() => createDeferredScreen({ message: 'x' })).toThrow(/show must be a function/);
    });
});

describe('o portão de migração usa a tela adiada', () => {
    const portao = readFileSync(resolve(SRC, 'ui', 'migration-recovery.js'), 'utf8');
    const corpo = portao.slice(portao.indexOf('export async function runLegacyUpgradeGate'));
    const gate = corpo.slice(0, corpo.indexOf('export function watchLegacyChanges'));

    it('o recorte do portão foi achado (controle do instrumento)', () => {
        expect(gate.length).toBeGreaterThan(500);
        expect(gate).toContain('prepareLegacyTransition');
    });

    it('o portão não desenha o cartão de progresso direto: só por `createDeferredScreen`', () => {
        expect(gate).toContain('createDeferredScreen(');
        const diretos = gate.match(/(?<!=> )makeScreen\(/g) || [];
        expect(diretos).toEqual([]);
    });

    it('o cancelamento vem ANTES de `closeScreen()` no sucesso e ANTES da recuperação na falha', () => {
        const cancelamentos = [...gate.matchAll(/progress\.cancel\(\)/g)].map((m) => m.index);
        expect(cancelamentos).toHaveLength(2);
        expect(cancelamentos[0]).toBeLessThan(gate.indexOf('closeScreen()'));
        expect(cancelamentos[0]).toBeLessThan(gate.indexOf('sweepAbandonedCopies()'));
        expect(cancelamentos[1]).toBeGreaterThan(gate.indexOf('catch (error)'));
        expect(cancelamentos[1]).toBeLessThan(gate.indexOf('showMigrationRecovery(error)'));
    });

    it('o tique de cópia desenha na hora: espera REAL não aguarda o prazo', () => {
        const onProgress = gate.slice(gate.indexOf('onProgress'), gate.indexOf('progress.cancel()'));
        expect(onProgress).toContain('progress.setText(');
        expect(onProgress).toContain('progress.showNow()');
    });
});
