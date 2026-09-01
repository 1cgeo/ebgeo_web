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

    it('does NOT fire after a symmetric pinch (the midpoint never moves)', () => {
        const element = createFakeElement();
        const callback = vi.fn();
        createTwoFingerTapHandler(element, callback);

        // Fingers spread from 100 px apart to 260 px apart around the same midpoint.
        element.dispatch('touchstart', { touches: touches([100, 100], [200, 100]) });
        element.dispatch('touchmove', { touches: touches([20, 100], [280, 100]) });
        element.dispatch('touchend', { touches: [] });

        expect(callback).not.toHaveBeenCalled();
    });

    it('does NOT fire after a symmetric pinch inwards', () => {
        const element = createFakeElement();
        const callback = vi.fn();
        createTwoFingerTapHandler(element, callback);

        element.dispatch('touchstart', { touches: touches([50, 100], [250, 100]) });
        element.dispatch('touchmove', { touches: touches([140, 100], [160, 100]) });
        element.dispatch('touchend', { touches: [] });

        expect(callback).not.toHaveBeenCalled();
    });

    it('still fires when the spread only jitters below the threshold', () => {
        const element = createFakeElement();
        const callback = vi.fn();
        createTwoFingerTapHandler(element, callback);

        element.dispatch('touchstart', { touches: touches([100, 100], [200, 100]) });
        element.dispatch('touchmove', { touches: touches([98, 100], [203, 100]) });
        element.dispatch('touchend', { touches: [] });

        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire when the whole gesture slides (pan)', () => {
        const element = createFakeElement();
        const callback = vi.fn();
        createTwoFingerTapHandler(element, callback);

        element.dispatch('touchstart', { touches: touches([100, 100], [200, 100]) });
        element.dispatch('touchmove', { touches: touches([100, 200], [200, 200]) });
        element.dispatch('touchend', { touches: [] });

        expect(callback).not.toHaveBeenCalled();
    });

    it('respects a custom maxDistance for the spread', () => {
        const element = createFakeElement();
        const callback = vi.fn();
        createTwoFingerTapHandler(element, callback, { maxDistance: 60 });

        element.dispatch('touchstart', { touches: touches([100, 100], [200, 100]) });
        element.dispatch('touchmove', { touches: touches([80, 100], [230, 100]) }); // spread +50
        element.dispatch('touchend', { touches: [] });

        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('ignores gestures that are not exactly two fingers', () => {
        const element = createFakeElement();
        const callback = vi.fn();
        createTwoFingerTapHandler(element, callback);

        element.dispatch('touchstart', { touches: touches([100, 100]) });
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
