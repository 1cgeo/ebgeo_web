// Path: tests/unit/two-finger-tap-handler.test.js

/**
 * @fileoverview A PINCA NO TABLET ABRIA O MENU DE MULTISSELECAO, e o motivo e
 * geometrico: `createTwoFingerTapHandler` (`utilities/pointer-utils.js`) cancelava o
 * toque duplo pelo deslocamento do PONTO MEDIO, e numa pinca SIMETRICA o ponto medio
 * nao anda um pixel. Uma pinca rapida (abaixo de `maxDuration`) terminava, portanto,
 * como toque de dois dedos, e `selection_manager._setupTwoFingerTap` a tratava como
 * Shift+clique.
 *
 * O CONSERTO usa um campo que o handler JA GRAVAVA e nunca lia: `twoFingerStart.distance`.
 * Cancelar tambem por variacao de ABERTURA e o que separa uma pinca de um toque, e as
 * duas grandezas sao independentes (a pinca move a abertura e nao o centro; o arrasto de
 * dois dedos move o centro e nao a abertura).
 *
 * ESTE ARQUIVO E O CONTROLE do conserto nos DOIS sentidos, que e o que o torna mais que
 * uma repeticao da regra: os casos de pinca reprovam se o `spreadChange` sair, e o caso
 * "tremor abaixo do limiar" reprova se alguem apertar o limiar a ponto de matar o toque
 * legitimo, que e o defeito oposto e o mais facil de introduzir consertando este.
 *
 * O ambiente e node: o handler so chama add/removeEventListener, entao um registro de
 * ouvintes basta para dirigi-lo sem DOM.
 */

import { describe, it, expect, vi } from 'vitest';
import { createTwoFingerTapHandler } from '../../src/js/utilities/pointer-utils.js';

/**
 * Minimal stand-in for an HTMLElement: the handler only ever calls
 * addEventListener / removeEventListener, so a listener registry is enough to
 * drive it in plain node.
 */
function createFakeElement() {
    const listeners = new Map();
    return {
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(fn);
        },
        removeEventListener(type, fn) {
            listeners.get(type)?.delete(fn);
        },
        dispatch(type, event) {
            for (const fn of listeners.get(type) ?? []) fn(event);
        },
        listenerCount(type) {
            return listeners.get(type)?.size ?? 0;
        }
    };
}

const touches = (...points) => points.map(([x, y]) => ({ clientX: x, clientY: y }));

describe('createTwoFingerTapHandler', () => {
    it('fires on a genuine two-finger tap', () => {
        const element = createFakeElement();
        const callback = vi.fn();
        createTwoFingerTapHandler(element, callback);

        element.dispatch('touchstart', { touches: touches([100, 100], [200, 100]) });
        element.dispatch('touchend', { touches: [] });

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0][1]).toEqual({ x: 150, y: 100 });
    });

    it('does NOT fire after a symmetric pinch OUTWARDS (the midpoint never moves)', () => {
        const element = createFakeElement();
        const callback = vi.fn();
        createTwoFingerTapHandler(element, callback);

        // Fingers spread from 100 px apart to 260 px apart around the SAME midpoint
        // (150, 100): the old midpoint-only cancellation saw zero movement.
        element.dispatch('touchstart', { touches: touches([100, 100], [200, 100]) });
        element.dispatch('touchmove', { touches: touches([20, 100], [280, 100]) });
        element.dispatch('touchend', { touches: [] });

        expect(callback).not.toHaveBeenCalled();
    });

    it('does NOT fire after a symmetric pinch INWARDS', () => {
        const element = createFakeElement();
        const callback = vi.fn();
        createTwoFingerTapHandler(element, callback);

        element.dispatch('touchstart', { touches: touches([50, 100], [250, 100]) });
        element.dispatch('touchmove', { touches: touches([140, 100], [160, 100]) });
        element.dispatch('touchend', { touches: [] });

        expect(callback).not.toHaveBeenCalled();
    });

    it('does NOT fire after a DIAGONAL pinch (the spread is not axis-aligned)', () => {
        const element = createFakeElement();
        const callback = vi.fn();
        createTwoFingerTapHandler(element, callback);

        // hypot goes from ~28 to ~198 around the midpoint (150, 150).
        element.dispatch('touchstart', { touches: touches([140, 140], [160, 160]) });
        element.dispatch('touchmove', { touches: touches([80, 80], [220, 220]) });
        element.dispatch('touchend', { touches: [] });

        expect(callback).not.toHaveBeenCalled();
    });

    it('CONTROLE: still fires when the spread only JITTERS below the threshold', () => {
        // Without this case the fix would be indistinguishable from "never fire
        // again", which is the opposite defect: the two-finger tap is the tablet
        // equivalent of Shift+click and has to keep working.
        const element = createFakeElement();
        const callback = vi.fn();
        createTwoFingerTapHandler(element, callback);

        element.dispatch('touchstart', { touches: touches([100, 100], [200, 100]) });
        element.dispatch('touchmove', { touches: touches([98, 100], [203, 100]) }); // spread +5
        element.dispatch('touchend', { touches: [] });

        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire when the whole gesture SLIDES (two-finger pan)', () => {
        // The other half of the pair: the spread is unchanged and the midpoint moves.
        const element = createFakeElement();
        const callback = vi.fn();
        createTwoFingerTapHandler(element, callback);

        element.dispatch('touchstart', { touches: touches([100, 100], [200, 100]) });
        element.dispatch('touchmove', { touches: touches([100, 200], [200, 200]) });
        element.dispatch('touchend', { touches: [] });

        expect(callback).not.toHaveBeenCalled();
    });

    it('respects a custom maxDistance for the spread, not only for the midpoint', () => {
        const element = createFakeElement();
        const callback = vi.fn();
        createTwoFingerTapHandler(element, callback, { maxDistance: 60 });

        element.dispatch('touchstart', { touches: touches([100, 100], [200, 100]) });
        element.dispatch('touchmove', { touches: touches([80, 100], [230, 100]) }); // spread +50
        element.dispatch('touchend', { touches: [] });

        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('a cancelled gesture stays cancelled even if the fingers come back', () => {
        // `twoFingerStart` is nulled, and only a fresh touchstart re-arms it.
        const element = createFakeElement();
        const callback = vi.fn();
        createTwoFingerTapHandler(element, callback);

        element.dispatch('touchstart', { touches: touches([100, 100], [200, 100]) });
        element.dispatch('touchmove', { touches: touches([20, 100], [280, 100]) });
        element.dispatch('touchmove', { touches: touches([100, 100], [200, 100]) });
        element.dispatch('touchend', { touches: [] });

        expect(callback).not.toHaveBeenCalled();
    });

    it('respects maxDuration: a slow two-finger press is not a tap', () => {
        const element = createFakeElement();
        const callback = vi.fn();
        const agora = vi.spyOn(Date, 'now');
        try {
            agora.mockReturnValue(1000);
            createTwoFingerTapHandler(element, callback, { maxDuration: 300 });
            element.dispatch('touchstart', { touches: touches([100, 100], [200, 100]) });
            agora.mockReturnValue(1000 + 301);
            element.dispatch('touchend', { touches: [] });
            expect(callback).not.toHaveBeenCalled();

            // CONTROLE do relogio: dentro da janela ele dispara.
            agora.mockReturnValue(2000);
            element.dispatch('touchstart', { touches: touches([100, 100], [200, 100]) });
            agora.mockReturnValue(2000 + 100);
            element.dispatch('touchend', { touches: [] });
            expect(callback).toHaveBeenCalledTimes(1);
        } finally {
            agora.mockRestore();
        }
    });

    it('ignores gestures that are not exactly two fingers', () => {
        const element = createFakeElement();
        const callback = vi.fn();
        createTwoFingerTapHandler(element, callback);

        element.dispatch('touchstart', { touches: touches([100, 100]) });
        element.dispatch('touchend', { touches: [] });

        expect(callback).not.toHaveBeenCalled();
    });

    it('a touchcancel drops the gesture', () => {
        const element = createFakeElement();
        const callback = vi.fn();
        createTwoFingerTapHandler(element, callback);

        element.dispatch('touchstart', { touches: touches([100, 100], [200, 100]) });
        element.dispatch('touchcancel', { touches: [] });
        element.dispatch('touchend', { touches: [] });

        expect(callback).not.toHaveBeenCalled();
    });

    it('cleanup removes every listener it added', () => {
        const element = createFakeElement();
        const cleanup = createTwoFingerTapHandler(element, vi.fn());

        for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
            expect(element.listenerCount(type)).toBe(1);
        }

        cleanup();

        for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
            expect(element.listenerCount(type)).toBe(0);
        }
    });
});
