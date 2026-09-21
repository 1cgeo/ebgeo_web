// Path: tests/unit/barra-temporal-arraste-e-teclas.repro.test.js
//
// C7 E C8 DA AUDITORIA TEMPORAL DE 2026-09-21: a régua da barra da linha do tempo.
//
// C7, O ARRASTE QUE NUNCA TERMINAVA. `temporal-timeline-bar.js` marcava `_dragging = true` no
// `pointerdown`, mantinha os ouvintes de `pointermove`/`pointerup` presos ao `window` pela vida
// inteira do componente e só voltava a falso no `pointerup`. No TOQUE isso é um defeito e não um
// detalhe: quando o sistema toma o ponteiro no meio do gesto (a página rola, começa uma pinça,
// chega uma notificação) o navegador entrega `pointercancel` NO LUGAR do `pointerup`, a bandeira
// ficava verdadeira e qualquer movimento posterior em qualquer ponto da página arrastava o cursor
// temporal, até recarregar. Faltavam também os dois filtros de entrada: sem `button` o clique
// direito começava um arrasto, e sem `isPrimary` o segundo dedo de um gesto de dois dedos começava
// um SEGUNDO arrasto e passava a comandar a régua com a posição do dedo errado.
//
// A CAUSA que estes casos prendem é a máquina de estados, hoje pura em
// `src/js/temporal/temporal-bar.model.js`: quem começa, o que cada evento faz com um arrasto vivo e
// as TRÊS saídas (`pointerup`, `pointercancel`, `lostpointercapture`). A fiação (captura, foco,
// ouvintes que vivem o tempo de um gesto) fica na barra e não se mede em node.
//
// C8, A RÉGUA QUE SÓ RESPONDIA A DUAS TECLAS. Ela se declara `role="slider"` e atendia apenas
// ArrowLeft/ArrowRight. Um slider atende também Home/End e PageUp/PageDown, e o aparo tinha de ser
// escrito à mão em cada ramo (`Math.min(this._fim, ...)`), o que já obrigava a repetir a regra de
// limite em dois lugares. `cursorForKey` devolve `null` para a tecla que não é dela, e esse `null`
// é o que impede a barra de dar `preventDefault` em Tab e nos atalhos do navegador.
//
// O QUE ESTES CASOS NÃO PROVAM: que a barra de fato chame a máquina (isso é leitura do arquivo),
// que a captura de ponteiro funcione (não há DOM aqui) e que o clique dê foco à régua. Essa metade
// é do Playwright.

import { describe, it, expect } from 'vitest';
import {
    reduceDragEvent,
    cursorForKey,
    DragOutcome,
    IDLE_DRAG,
    PAGE_STEP_MULTIPLIER,
} from '../../src/js/temporal/temporal-bar.model.js';

/** Um PointerEvent de mentira: a máquina lê exatamente estes quatro campos. */
const evento = (type, extra = {}) => ({ type, pointerId: 1, isPrimary: true, button: 0, ...extra });

/** Leva a máquina até um arrasto vivo e devolve o estado. */
function arrastando(extra = {}) {
    const { state, outcome } = reduceDragEvent(IDLE_DRAG, evento('pointerdown', extra));
    expect(outcome).toBe(DragOutcome.START);
    return state;
}

// ============================================================================
// C7 — a máquina de arraste
// ============================================================================

describe('reduceDragEvent: quem pode começar um arrasto', () => {
    it('começa no ponteiro primário com o botão principal', () => {
        const { state, outcome } = reduceDragEvent(IDLE_DRAG, evento('pointerdown'));
        expect(outcome).toBe(DragOutcome.START);
        expect(state).toEqual({ dragging: true, pointerId: 1 });
    });

    it('IGNORA o botão secundário e o do meio (o clique direito não arrasta)', () => {
        for (const button of [1, 2, 3, 4]) {
            const { state, outcome } = reduceDragEvent(IDLE_DRAG, evento('pointerdown', { button }));
            expect(outcome).toBe(DragOutcome.NONE);
            expect(state.dragging).toBe(false);
        }
    });

    it('IGNORA o ponteiro não primário (o segundo dedo)', () => {
        const { state, outcome } = reduceDragEvent(
            IDLE_DRAG,
            evento('pointerdown', { pointerId: 7, isPrimary: false })
        );
        expect(outcome).toBe(DragOutcome.NONE);
        expect(state.dragging).toBe(false);
    });

    it('IGNORA um segundo pointerdown enquanto um arrasto está vivo', () => {
        const vivo = arrastando();
        const { state, outcome } = reduceDragEvent(vivo, evento('pointerdown', { pointerId: 9 }));
        expect(outcome).toBe(DragOutcome.NONE);
        expect(state).toEqual(vivo);
    });

    it('aceita evento sintético sem button e sem pointerId, sem identidade de ponteiro', () => {
        const { state, outcome } = reduceDragEvent(IDLE_DRAG, { type: 'pointerdown' });
        expect(outcome).toBe(DragOutcome.START);
        expect(state).toEqual({ dragging: true, pointerId: null });
    });
});

describe('reduceDragEvent: o movimento', () => {
    it('move só com arrasto vivo', () => {
        expect(reduceDragEvent(IDLE_DRAG, evento('pointermove')).outcome).toBe(DragOutcome.NONE);
        expect(reduceDragEvent(arrastando(), evento('pointermove')).outcome).toBe(DragOutcome.MOVE);
    });

    it('IGNORA o movimento de outro ponteiro (o segundo dedo não comanda a régua)', () => {
        const vivo = arrastando({ pointerId: 1 });
        const { outcome } = reduceDragEvent(vivo, evento('pointermove', { pointerId: 2, isPrimary: false }));
        expect(outcome).toBe(DragOutcome.NONE);
    });

    it('sem identidade de ponteiro, ainda recusa o que se declara secundário', () => {
        const vivo = arrastando({ pointerId: undefined });
        expect(vivo.pointerId).toBe(null);
        expect(reduceDragEvent(vivo, { type: 'pointermove', isPrimary: false }).outcome)
            .toBe(DragOutcome.NONE);
        expect(reduceDragEvent(vivo, { type: 'pointermove' }).outcome).toBe(DragOutcome.MOVE);
    });
});

describe('reduceDragEvent: as TRÊS saídas', () => {
    // O caso que o defeito tinha: só `pointerup` encerrava.
    for (const saida of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        it(`encerra o arrasto em ${saida} e volta ao repouso`, () => {
            const vivo = arrastando();
            const { state, outcome } = reduceDragEvent(vivo, evento(saida));
            expect(outcome).toBe(DragOutcome.END);
            expect(state).toEqual(IDLE_DRAG);
        });
    }

    it('DEPOIS de um pointercancel, o movimento seguinte não arrasta mais nada', () => {
        // É este o defeito de C7 inteiro: gesto cancelado, e a página seguia arrastando o cursor.
        const vivo = arrastando();
        const { state } = reduceDragEvent(vivo, evento('pointercancel'));
        expect(reduceDragEvent(state, evento('pointermove')).outcome).toBe(DragOutcome.NONE);
        expect(reduceDragEvent(state, evento('pointermove', { pointerId: 2 })).outcome)
            .toBe(DragOutcome.NONE);
    });

    it('encerrar é idempotente: o lostpointercapture que a própria soltura dispara não reabre nada', () => {
        const vivo = arrastando();
        const depois = reduceDragEvent(vivo, evento('pointerup')).state;
        const { state, outcome } = reduceDragEvent(depois, evento('lostpointercapture'));
        expect(outcome).toBe(DragOutcome.NONE);
        expect(state).toEqual(IDLE_DRAG);
    });

    it('a saída de OUTRO ponteiro não encerra o arrasto vivo', () => {
        const vivo = arrastando({ pointerId: 1 });
        const { state, outcome } = reduceDragEvent(vivo, evento('pointerup', { pointerId: 2 }));
        expect(outcome).toBe(DragOutcome.NONE);
        expect(state).toEqual(vivo);
    });
});

describe('reduceDragEvent: bordas de entrada', () => {
    it('estado nulo, indefinido ou malformado é lido como repouso', () => {
        for (const ruim of [null, undefined, {}, 'arrastando', 42, { dragging: 'sim' }]) {
            expect(reduceDragEvent(ruim, evento('pointermove')).outcome).toBe(DragOutcome.NONE);
            expect(reduceDragEvent(ruim, evento('pointerdown')).outcome).toBe(DragOutcome.START);
        }
    });

    it('evento nulo ou de tipo desconhecido não mexe no estado', () => {
        const vivo = arrastando();
        for (const ruim of [null, undefined, {}, evento('click'), evento('pointerover')]) {
            const { state, outcome } = reduceDragEvent(vivo, ruim);
            expect(outcome).toBe(DragOutcome.NONE);
            expect(state).toEqual(vivo);
        }
    });

    it('não muta o estado recebido', () => {
        const vivo = arrastando();
        const copia = { ...vivo };
        reduceDragEvent(vivo, evento('pointerup'));
        expect(vivo).toEqual(copia);
    });
});

// ============================================================================
// C8 — a tradução tecla → cursor
// ============================================================================

const HORA = 3_600_000;
const BASE = Object.freeze({ inicio: 0, fim: 100 * HORA, step: HORA });

describe('cursorForKey: as setas', () => {
    it('anda um passo da unidade para frente e para trás', () => {
        expect(cursorForKey({ ...BASE, key: 'ArrowRight', cursor: 10 * HORA })).toBe(11 * HORA);
        expect(cursorForKey({ ...BASE, key: 'ArrowLeft', cursor: 10 * HORA })).toBe(9 * HORA);
    });

    it('atende TAMBÉM as setas vertical, como todo slider', () => {
        expect(cursorForKey({ ...BASE, key: 'ArrowUp', cursor: 10 * HORA })).toBe(11 * HORA);
        expect(cursorForKey({ ...BASE, key: 'ArrowDown', cursor: 10 * HORA })).toBe(9 * HORA);
    });

    it('apara nos limites em vez de sair deles', () => {
        expect(cursorForKey({ ...BASE, key: 'ArrowRight', cursor: BASE.fim })).toBe(BASE.fim);
        expect(cursorForKey({ ...BASE, key: 'ArrowLeft', cursor: BASE.inicio })).toBe(BASE.inicio);
        // Um cursor já fora do intervalo volta para dentro.
        expect(cursorForKey({ ...BASE, key: 'ArrowRight', cursor: BASE.fim + 5 * HORA })).toBe(BASE.fim);
    });
});

describe('cursorForKey: as teclas que faltavam', () => {
    it('Home vai ao início e End ao fim', () => {
        expect(cursorForKey({ ...BASE, key: 'Home', cursor: 50 * HORA })).toBe(BASE.inicio);
        expect(cursorForKey({ ...BASE, key: 'End', cursor: 50 * HORA })).toBe(BASE.fim);
    });

    it('PageUp e PageDown andam o passo maior', () => {
        expect(cursorForKey({ ...BASE, key: 'PageUp', cursor: 20 * HORA }))
            .toBe((20 + PAGE_STEP_MULTIPLIER) * HORA);
        expect(cursorForKey({ ...BASE, key: 'PageDown', cursor: 20 * HORA }))
            .toBe((20 - PAGE_STEP_MULTIPLIER) * HORA);
    });

    it('o passo maior também apara, e é configurável', () => {
        expect(cursorForKey({ ...BASE, key: 'PageDown', cursor: 2 * HORA })).toBe(BASE.inicio);
        expect(cursorForKey({ ...BASE, key: 'PageUp', cursor: 0, pageSteps: 3 })).toBe(3 * HORA);
        // Multiplicador degenerado cai para um passo só, nunca para zero nem para trás.
        for (const ruim of [0, -5, NaN, null, Infinity]) {
            expect(cursorForKey({ ...BASE, key: 'PageUp', cursor: 0, pageSteps: ruim })).toBe(HORA);
        }
        // `undefined` é ausência, não lixo: vale o padrão declarado.
        expect(cursorForKey({ ...BASE, key: 'PageUp', cursor: 0, pageSteps: undefined }))
            .toBe(PAGE_STEP_MULTIPLIER * HORA);
    });
});

describe('cursorForKey: o null que protege o resto do teclado', () => {
    it('devolve null para tecla que não é da régua', () => {
        for (const key of ['Tab', 'Enter', ' ', 'a', 'Escape', 'F5', undefined]) {
            expect(cursorForKey({ ...BASE, key, cursor: 10 * HORA })).toBe(null);
        }
    });

    it('devolve null quando há modificador, para não roubar atalho do navegador', () => {
        expect(cursorForKey({ ...BASE, key: 'ArrowRight', cursor: 0, ctrlKey: true })).toBe(null);
        expect(cursorForKey({ ...BASE, key: 'Home', cursor: 0, metaKey: true })).toBe(null);
        expect(cursorForKey({ ...BASE, key: 'PageUp', cursor: 0, altKey: true })).toBe(null);
    });

    it('chamada sem argumento nenhum não lança', () => {
        expect(cursorForKey()).toBe(null);
    });
});

describe('cursorForKey: bordas de intervalo e de passo', () => {
    it('passo zero ou não finito desliga as setas e as páginas', () => {
        for (const step of [0, -1, NaN, Infinity, null, undefined, '3600000']) {
            for (const key of ['ArrowRight', 'ArrowLeft', 'PageUp', 'PageDown']) {
                expect(cursorForKey({ ...BASE, step, key, cursor: 10 * HORA })).toBe(null);
            }
        }
    });

    it('MAS Home e End continuam valendo com passo zero: eles não dependem do passo', () => {
        expect(cursorForKey({ ...BASE, step: 0, key: 'Home', cursor: 10 * HORA })).toBe(BASE.inicio);
        expect(cursorForKey({ ...BASE, step: 0, key: 'End', cursor: 10 * HORA })).toBe(BASE.fim);
    });

    it('limite não finito não apara daquele lado, e Home/End devolvem null ali', () => {
        const semFim = { inicio: 0, fim: NaN, step: HORA };
        expect(cursorForKey({ ...semFim, key: 'ArrowRight', cursor: 10 * HORA })).toBe(11 * HORA);
        expect(cursorForKey({ ...semFim, key: 'End', cursor: 10 * HORA })).toBe(null);
        expect(cursorForKey({ ...semFim, key: 'Home', cursor: 10 * HORA })).toBe(0);

        const semInicio = { inicio: null, fim: 100 * HORA, step: HORA };
        expect(cursorForKey({ ...semInicio, key: 'ArrowLeft', cursor: 0 })).toBe(-HORA);
        expect(cursorForKey({ ...semInicio, key: 'Home', cursor: 0 })).toBe(null);
    });

    it('cursor não finito devolve null nas setas, mas não impede Home/End', () => {
        for (const cursor of [NaN, undefined, null, Infinity]) {
            expect(cursorForKey({ ...BASE, key: 'ArrowRight', cursor })).toBe(null);
            expect(cursorForKey({ ...BASE, key: 'PageUp', cursor })).toBe(null);
            expect(cursorForKey({ ...BASE, key: 'Home', cursor })).toBe(BASE.inicio);
        }
    });

    it('intervalo invertido (fim antes do início) apara pelo fim, sem devolver lixo', () => {
        const invertido = { inicio: 10 * HORA, fim: 2 * HORA, step: HORA };
        const r = cursorForKey({ ...invertido, key: 'ArrowRight', cursor: 5 * HORA });
        expect(Number.isFinite(r)).toBe(true);
        expect(r).toBe(2 * HORA);
    });
});
