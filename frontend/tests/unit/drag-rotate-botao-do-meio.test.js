// Path: tests/unit/drag-rotate-botao-do-meio.test.js
/**
 * @fileoverview O BOTÃO DO MEIO GIRA E INCLINA, E SOLTÁ-LO TERMINA O GESTO.
 *
 * O PEDIDO (dono, 2026-09-17): "no maplibre consigo configurar o botão do meio para inclinar e
 * girar o mapa? Hoje o botão direito é menu, e para inclinar ou girar é shift e ctrl, mas queria
 * tb uma versão sem shift e ctrl com o botão do meio".
 *
 * NÃO HÁ OPÇÃO NO MAPLIBRE. Na 6.9.1, e ainda na 6.11.2 (relida em 2026-09-24), o botão de cada gesto é um literal dentro da
 * fábrica do handler (`generateMouseRotationHandler`: `checkCorrectEvent: (e) => e.button ===
 * LEFT_BUTTON && e.ctrlKey || e.button === RIGHT_BUTTON && !e.ctrlKey`), sem nada configurável por
 * fora, e o `HandlerManager` só expõe `_handlers`. A decisão é do app porque ele declara
 * `dragRotate: false` ao criar o mapa e traz o gesto próprio (`map/drag-rotate.handler.js`).
 *
 * POR QUE ESTA SUÍTE EXISTE, e não bastam os casos do modelo: o modelo diz que o botão do meio
 * vale como gesto, e é tudo o que ele pode dizer. O DEFEITO que a mudança introduziria mora no
 * handler, no fim do gesto, e o modelo passa verde com ele de pé. O `_onMouseUp` comparava o botão
 * solto com o ESQUERDO FIXO e ignorava os outros, o que era certo para não deixar um clique com o
 * direito encerrar um arrasto do esquerdo; com o botão do meio arrastando, essa mesma linha faz o
 * `mouseup` dele ser ignorado e o gesto NUNCA TERMINA. O mapa fica girando com o botão solto, o
 * `dragPan` fica desabilitado, e nada no console diz nada.
 *
 * O AMBIENTE É NODE PURO, sem jsdom (o arranjo da suíte): `window` e o container do mapa são
 * duplos que guardam os ouvintes de verdade, para os eventos poderem ser disparados na ordem em
 * que o navegador os dispara. O que ele NÃO mede é pintura nem a câmera de verdade: o dublê do
 * mapa registra os `jumpTo`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MIDDLE_BUTTON, LEFT_BUTTON } from '../../src/js/map/drag-rotate.model.js';

// ---------------------------------------------------------------------------
// Os duplos
// ---------------------------------------------------------------------------

/** Um alvo de evento que GUARDA os ouvintes, para o teste disparar o que o navegador dispararia. */
function alvo() {
    const ouvintes = [];
    return {
        style: {},
        ouvintes,
        addEventListener(tipo, fn, captura) { ouvintes.push({ tipo, fn, captura }); },
        removeEventListener(tipo, fn) {
            const i = ouvintes.findIndex((o) => o.tipo === tipo && o.fn === fn);
            if (i >= 0) ouvintes.splice(i, 1);
        },
        disparar(tipo, dados = {}) {
            let impedido = false;
            const evento = {
                preventDefault() { impedido = true; },
                stopPropagation() {},
                ...dados,
            };
            for (const o of [...ouvintes]) if (o.tipo === tipo) o.fn(evento);
            return impedido;
        },
        tipos() { return ouvintes.map((o) => o.tipo); },
    };
}

function mapaFalso({ bearing = 0, pitch = 0, dragPanLigado = true } = {}) {
    const canvas = alvo();
    const saltos = [];
    let panLigado = dragPanLigado;
    return {
        canvas,
        saltos,
        get panLigado() { return panLigado; },
        getCanvasContainer: () => canvas,
        getBearing: () => bearing,
        getPitch: () => pitch,
        getMinPitch: () => 0,
        getMaxPitch: () => 85,
        jumpTo(alvoDaCamera) {
            saltos.push({ ...alvoDaCamera });
            if (alvoDaCamera.bearing !== undefined) bearing = alvoDaCamera.bearing;
            if (alvoDaCamera.pitch !== undefined) pitch = alvoDaCamera.pitch;
        },
        dragPan: {
            isEnabled: () => panLigado,
            disable() { panLigado = false; },
            enable() { panLigado = true; },
        },
    };
}

const janelaOriginal = globalThis.window;
let janela;
/** Os handlers montados no caso, para desmontar ANTES de a janela sumir. */
let montados;

beforeEach(() => {
    janela = alvo();
    globalThis.window = janela;
    montados = [];
});

afterEach(() => {
    // A ENGOLIDA DO CLIQUE ARMA UM `setTimeout` DE ZERO, e ele dispara depois do caso: se a
    // janela falsa já tiver sido removida, o `_disarmClickSwallow` morre em "window is not
    // defined" e o erro aparece como exceção não capturada da SUÍTE, sem reprovar caso nenhum.
    // Desmontar aqui limpa o temporizador enquanto a janela ainda está de pé. O defeito é do
    // teste, e não do código: no navegador o `window` nunca some no meio.
    for (const h of montados) h.disable();
    if (janelaOriginal === undefined) delete globalThis.window;
    else globalThis.window = janelaOriginal;
    vi.useRealTimers();
});

const { default: DragRotateHandler } = await import('../../src/js/map/drag-rotate.handler.js');

/** Monta o handler ligado a um mapa falso. */
function montado(opcoes) {
    const mapa = mapaFalso(opcoes);
    const handler = new DragRotateHandler(mapa);
    handler.enable();
    montados.push(handler);
    return { mapa, handler };
}

/** Um arrasto: aperta, anda (em dois passos, para passar do limiar de 3 px) e devolve o mapa. */
function arrastar(mapa, { button, dx = 40, dy = 30 }) {
    mapa.canvas.disparar('mousedown', { button, clientX: 100, clientY: 100 });
    janela.disparar('mousemove', { clientX: 100 + dx / 2, clientY: 100 + dy / 2 });
    janela.disparar('mousemove', { clientX: 100 + dx, clientY: 100 + dy });
}

describe('o botão do meio move a câmera', () => {
    it('gira e inclina no mesmo arrasto, sem tecla nenhuma', () => {
        const { mapa } = montado();
        arrastar(mapa, { button: MIDDLE_BUTTON });

        expect(mapa.saltos.length).toBeGreaterThan(0);
        const ultimo = mapa.saltos.at(-1);
        expect(ultimo.bearing, 'não girou').toBeDefined();
        expect(ultimo.pitch, 'não inclinou').toBeDefined();
        // Arrastar para a direita e para baixo: o bearing cai e o pitch cai, como no gesto por
        // tecla. A conta é do modelo; o que se prende aqui é que os DOIS eixos chegam à câmera.
        expect(mapa.saltos.at(-1).bearing).not.toBe(0);
    });

    it('impede o padrão do navegador no mousedown (o autoscroll do Windows)', () => {
        const { mapa } = montado();
        const impedido = mapa.canvas.disparar('mousedown', { button: MIDDLE_BUTTON, clientX: 10, clientY: 10 });
        expect(impedido).toBe(true);
    });

    it('desliga o dragPan enquanto o gesto dura', () => {
        const { mapa } = montado();
        arrastar(mapa, { button: MIDDLE_BUTTON });
        expect(mapa.panLigado).toBe(false);
    });
});

describe('O DEFEITO: soltar o botão do meio TEM de terminar o gesto', () => {
    it('depois do mouseup, o movimento do ponteiro não mexe mais na câmera', () => {
        const { mapa } = montado();
        arrastar(mapa, { button: MIDDLE_BUTTON });
        const antes = mapa.saltos.length;

        janela.disparar('mouseup', { button: MIDDLE_BUTTON });
        janela.disparar('mousemove', { clientX: 400, clientY: 400 });
        janela.disparar('mousemove', { clientX: 500, clientY: 500 });

        expect(mapa.saltos.length, 'a câmera continuou andando com o botão solto').toBe(antes);
    });

    it('e o dragPan volta', () => {
        const { mapa } = montado();
        arrastar(mapa, { button: MIDDLE_BUTTON });
        janela.disparar('mouseup', { button: MIDDLE_BUTTON });
        expect(mapa.panLigado).toBe(true);
    });

    it('CONTROLE: a regra antiga continua de pé — um mouseup do DIREITO não encerra o arrasto do esquerdo', () => {
        // Encerrar ali reabilitaria o dragPan com o esquerdo ainda apertado, e o MapLibre
        // retomaria a panorâmica a partir do ponto velho do mousedown.
        const { mapa } = montado();
        mapa.canvas.disparar('mousedown', { button: LEFT_BUTTON, ctrlKey: true, clientX: 100, clientY: 100 });
        janela.disparar('mousemove', { clientX: 120, clientY: 140 });
        const antes = mapa.saltos.length;

        janela.disparar('mouseup', { button: 2 });
        janela.disparar('mousemove', { clientX: 140, clientY: 180 });

        expect(mapa.saltos.length, 'o clique do direito encerrou o gesto do esquerdo').toBeGreaterThan(antes);
        expect(mapa.panLigado).toBe(false);
    });

    it('CONTROLE: um mouseup do MEIO não encerra um arrasto que o esquerdo começou', () => {
        const { mapa } = montado();
        mapa.canvas.disparar('mousedown', { button: LEFT_BUTTON, shiftKey: true, clientX: 100, clientY: 100 });
        janela.disparar('mousemove', { clientX: 130, clientY: 100 });
        const antes = mapa.saltos.length;

        janela.disparar('mouseup', { button: MIDDLE_BUTTON });
        janela.disparar('mousemove', { clientX: 160, clientY: 100 });

        expect(mapa.saltos.length).toBeGreaterThan(antes);
    });
});

describe('o clique sintético do fim do arrasto', () => {
    it('o gesto do meio arma a engolida de `auxclick`, que é o evento que ele dispara', () => {
        vi.useFakeTimers();
        const { mapa } = montado();
        arrastar(mapa, { button: MIDDLE_BUTTON });
        janela.disparar('mouseup', { button: MIDDLE_BUTTON });

        expect(janela.tipos()).toContain('auxclick');
        expect(janela.tipos()).not.toContain('click');

        // E ela dura um tique só: qualquer coisa depois disso é um clique de verdade.
        vi.advanceTimersByTime(0);
        expect(janela.tipos()).not.toContain('auxclick');
    });

    it('o gesto por tecla continua armando a engolida de `click`', () => {
        vi.useFakeTimers();
        const { mapa } = montado();
        mapa.canvas.disparar('mousedown', { button: LEFT_BUTTON, shiftKey: true, clientX: 100, clientY: 100 });
        janela.disparar('mousemove', { clientX: 140, clientY: 100 });
        janela.disparar('mouseup', { button: LEFT_BUTTON });

        expect(janela.tipos()).toContain('click');
        expect(janela.tipos()).not.toContain('auxclick');
    });

    it('um clique parado com o meio (sem passar do limiar) não arma engolida nenhuma', () => {
        // Vácuo: o gesto que não ENGATOU não pode comer o evento de ninguém.
        const { mapa } = montado();
        mapa.canvas.disparar('mousedown', { button: MIDDLE_BUTTON, clientX: 100, clientY: 100 });
        janela.disparar('mousemove', { clientX: 101, clientY: 101 });
        janela.disparar('mouseup', { button: MIDDLE_BUTTON });

        expect(janela.tipos()).not.toContain('auxclick');
        expect(janela.tipos()).not.toContain('click');
    });
});

describe('o desligar não deixa rastro', () => {
    it('solta os ouvintes de janela e de canvas', () => {
        const { mapa, handler } = montado();
        arrastar(mapa, { button: MIDDLE_BUTTON });
        handler.disable();

        expect(mapa.canvas.tipos()).not.toContain('mousedown');
        for (const tipo of ['mouseup', 'mousemove', 'blur', 'click', 'auxclick']) {
            expect(janela.tipos(), `sobrou ${tipo}`).not.toContain(tipo);
        }
        expect(mapa.panLigado, 'o dragPan ficou desligado depois do desmonte').toBe(true);
    });
});
