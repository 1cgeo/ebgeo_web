// Path: tests/unit/olhar-da-primeira-pessoa-por-ponteiro.test.js

/**
 * @fileoverview GIRAR A VISÃO DA CENA CAMINHÁVEL COM UM DEDO, que não acontecia.
 *
 * DOIS DEFEITOS NUM GESTO SÓ. O primeiro é de FAMÍLIA DE EVENTO: `walk-mode.js` ligava
 * `mousedown`, `mousemove` e `mouseup` no documento, e o arrasto de um dedo dependia de o
 * navegador sintetizar eventos de mouse a partir do toque, coisa que ele faz para o toque simples
 * e não faz de forma confiável no meio de um arrasto. O segundo é de FONTE DO DELTA: o arrasto
 * somava `e.movementX`, campo que nasceu com o Pointer Lock e que num evento de ponteiro de toque
 * é opcional — onde o navegador não o preenche ele vale zero, e a câmera simplesmente não gira,
 * sem erro nenhum, que é a pior forma de falhar.
 *
 * O CONSERTO É UM SÓ PARA OS DOIS: os ouvintes passaram para a família `pointer` (mais o
 * `pointercancel`, que é a saída sem par) e o arrasto passou a medir a diferença entre dois
 * `clientX`, que é a mesma conta, existe em todo navegador e vale para dedo, caneta e mouse.
 *
 * O QUE ESTE ARQUIVO PRENDE é a aritmética e o SINAL, chamando o handler pelo protótipo com um
 * duplo mínimo: ele não toca no DOM, só lê o evento e o próprio estado. O que ele não prova é que
 * um dedo de verdade gire a cena, que é Playwright com a cena montada.
 *
 * O SINAL É "AGARRAR A CENA", e não "mirar a cabeça", e essa metade já era decisão de 2026-08-17:
 * arrastar para a direita gira a vista para a ESQUERDA, como o mapa 2D e o 360 fazem. O caso do
 * ponteiro CAPTURADO (modo imersivo) usa o sinal oposto de propósito, e os dois estão aqui lado a
 * lado justamente porque a próxima leitura desatenta vai querer "uniformizá-los".
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// O MOTOR NÃO CARREGA EM NODE, e o que se quer daqui é aritmética: `walk-mode.js` importa
// `Vector3` e `Euler` do pacote do visualizador, cujo carregamento estoura fora do navegador.
// Os dois só aparecem no construtor, e este arquivo chama o handler pelo PROTÓTIPO, sem
// construir nada, então o duplo só precisa existir.
vi.mock('@manycore/aholo-viewer', () => ({
    Vector3: class { set() { return this; } },
    Euler: class { set() { return this; } },
}));

import { WalkMode } from '@js/first_person_3d_tool/walk/walk-mode.js';

/** A sensibilidade declarada no módulo; repetida aqui para o caso ter número absoluto. */
const SENSIBILIDADE = 0.002;

/** O caminhador reduzido ao que `_onMouseMove` toca, no meio de um arrasto de dedo. */
function arrastando({ pointerLook = false, ancora = { x: 100, y: 200 } } = {}) {
    return {
        _enabled: true,
        _pointerLook: pointerLook,
        _mouseLookDragging: true,
        _lookAnchor: ancora,
        _yaw: 0,
        _pitch: 0,
        _onMouseMove: WalkMode.prototype._onMouseMove,
        _onMouseUp: WalkMode.prototype._onMouseUp,
        _onMouseDown: WalkMode.prototype._onMouseDown,
    };
}

/** Um evento de ponteiro de TOQUE: botão primário apertado e SEM `movementX`. */
const toque = (x, y) => ({ type: 'pointermove', clientX: x, clientY: y, buttons: 1 });

describe('o arrasto gira a cena sem `movementX`', () => {
    it('um dedo que anda 50 px gira o yaw pelo delta medido', () => {
        const nav = arrastando();
        nav._onMouseMove(toque(150, 200));

        // O SINAL É POSITIVO: arrastar para a direita gira a vista para a esquerda, que é a
        // convenção de "a cena segue a mão" dos outros dois visualizadores.
        expect(nav._yaw).toBeCloseTo(50 * SENSIBILIDADE, 10);
        expect(nav._pitch).toBeCloseTo(0, 10);
    });

    it('o evento SEM `movementX` seria imóvel pela regra antiga, e é o ponto do conserto', () => {
        // CONTROLE DA PRÓPRIA PREMISSA: se o duplo trouxesse `movementX`, este arquivo passaria
        // verde tanto na regra nova quanto na velha e não estaria medindo o defeito.
        const evento = toque(150, 200);
        expect(evento.movementX).toBeUndefined();
        expect(evento.movementY).toBeUndefined();
    });

    it('a âncora ANDA com o dedo: dois passos somam, e não medem do ponto de partida', () => {
        // Sem reancorar, o segundo evento mediria 100 px em vez de 50 e a cena daria um salto que
        // cresce ao longo do arrasto.
        const nav = arrastando();
        nav._onMouseMove(toque(150, 200));
        nav._onMouseMove(toque(200, 200));

        expect(nav._lookAnchor).toEqual({ x: 200, y: 200 });
        expect(nav._yaw).toBeCloseTo(100 * SENSIBILIDADE, 10);
    });

    it('o eixo vertical acompanha o mesmo sinal', () => {
        const nav = arrastando();
        nav._onMouseMove(toque(100, 260));
        expect(nav._yaw).toBeCloseTo(0, 10);
        expect(nav._pitch).toBeCloseTo(60 * SENSIBILIDADE, 10);
    });

    it('o pitch é limitado e não capota a câmera', () => {
        const nav = arrastando();
        nav._onMouseMove(toque(100, 200 + 1e6));
        expect(nav._pitch).toBeLessThan(Math.PI / 2);
        expect(nav._pitch).toBeGreaterThan(Math.PI / 2 - 0.02);
    });
});

describe('o arrasto para quando tem de parar', () => {
    it('sem botão apertado o arrasto se desmarca em vez de continuar seguindo o ponteiro', () => {
        // Uma soltura fora da janela nunca chega ao `pointerup`; sem esta guarda a câmera giraria
        // com a mão já longe da tela.
        const nav = arrastando();
        nav._onMouseMove({ type: 'pointermove', clientX: 150, clientY: 200, buttons: 0 });

        expect(nav._yaw).toBe(0);
        expect(nav._mouseLookDragging).toBe(false);
        expect(nav._lookAnchor).toBeNull();
    });

    it('sem âncora nada gira, mesmo com o arrasto marcado', () => {
        // Estado impossível na prática, e é exatamente por isso que ele tem de degradar para
        // parado: um `NaN` propagado pelo yaw apaga a cena inteira sem uma linha de erro.
        const nav = arrastando({ ancora: null });
        nav._onMouseMove(toque(150, 200));

        expect(Number.isFinite(nav._yaw)).toBe(true);
        expect(nav._yaw).toBe(0);
    });

    it('`pointercancel` encerra o arrasto, e ele chega SEM botão', () => {
        // Um `pointercancel` traz `button` em -1. A condição antiga exigia 0 ou 2, então o único
        // evento que existe para dizer "o gesto acabou" era justamente o que não o encerrava.
        const nav = arrastando();
        nav._onMouseUp({ type: 'pointercancel', button: -1 });

        expect(nav._mouseLookDragging).toBe(false);
        expect(nav._lookAnchor).toBeNull();
    });

    it('o `pointerup` comum continua encerrando', () => {
        const nav = arrastando();
        nav._onMouseUp({ type: 'pointerup', button: 0 });
        expect(nav._mouseLookDragging).toBe(false);
    });
});

describe('o modo imersivo mantém o sinal INVERTIDO, de propósito', () => {
    it('com o ponteiro capturado a vista segue o movimento, e ali `movementX` é a única fonte', () => {
        // Sob Pointer Lock não existe `clientX` se movendo: o cursor está preso. É o único lugar
        // em que `movementX` é obrigatório, e é por isso que aquele ramo não mudou.
        const nav = arrastando({ pointerLook: true });
        nav._onMouseMove({ type: 'pointermove', movementX: 50, movementY: 0, buttons: 0 });

        expect(nav._yaw).toBeCloseTo(-50 * SENSIBILIDADE, 10);
    });
});

describe('os ouvintes são de PONTEIRO no código', () => {
    it('os três gestos e o cancelamento estão ligados na família certa', () => {
        // Estrutural porque `_registerListeners` escreve no `document`, que não existe nesta
        // suíte. Sem ele, a aritmética acima passaria verde com os ouvintes de volta em `mouse`,
        // e o dedo continuaria sem girar nada.
        const fonte = readFileSync(
            new URL('../../src/js/first_person_3d_tool/walk/walk-mode.js', import.meta.url),
            'utf8',
        );
        for (const evento of ['pointerdown', 'pointerup', 'pointercancel', 'pointermove']) {
            expect(fonte, `${evento} não está ligado`).toContain(`document, '${evento}'`);
        }
        for (const morto of ['mousedown', 'mouseup', 'mousemove']) {
            expect(fonte, `${morto} voltou a ser ligado`).not.toContain(`document, '${morto}'`);
        }
    });
});
