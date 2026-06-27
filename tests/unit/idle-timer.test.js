import { describe, it, expect, vi } from 'vitest';
import { IdleTimer } from '../../src/js/session/idle-timer.js';

/** A controllable fake scheduler: arm/cancel by id, fire the single pending timer on demand. */
function makeClock() {
    let nextId = 0;
    const timers = new Map();
    return {
        setTimer: (fn, delay) => {
            const id = ++nextId;
            timers.set(id, { fn, delay });
            return id;
        },
        clearTimer: (id) => timers.delete(id),
        pending: () => timers.size,
        lastDelay: () => [...timers.values()].at(-1)?.delay,
        fire: () => {
            // Fire the (single) pending timer the IdleTimer keeps at a time.
            const entry = [...timers.entries()][0];
            if (!entry) return;
            timers.delete(entry[0]);
            entry[1].fn();
        },
    };
}

function makeTimer(overrides = {}) {
    const clock = makeClock();
    const onWarn = vi.fn();
    const onExpire = vi.fn();
    const timer = new IdleTimer({
        idleMs: 30_000,
        warnMs: 5_000,
        onWarn,
        onExpire,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
        ...overrides,
    });
    return { clock, onWarn, onExpire, timer };
}

describe('IdleTimer', () => {
    it('arms the idle phase first (idleMs - warnMs), then warns, then expires', () => {
        const { clock, onWarn, onExpire, timer } = makeTimer();
        timer.start();
        expect(clock.pending()).toBe(1);
        expect(clock.lastDelay()).toBe(25_000); // 30s - 5s

        clock.fire(); // idle elapsed → enter warning
        expect(onWarn).toHaveBeenCalledTimes(1);
        expect(timer.isWarning()).toBe(true);
        expect(clock.lastDelay()).toBe(5_000); // warn window
        expect(onExpire).not.toHaveBeenCalled();

        clock.fire(); // warn window elapsed → expire
        expect(onExpire).toHaveBeenCalledTimes(1);
        expect(timer.isWarning()).toBe(false);
    });

    it('activity re-arms the idle phase (no warning yet)', () => {
        const { clock, onWarn, timer } = makeTimer();
        timer.start();
        timer.notifyActivity(); // resets — still one pending idle timer, no warn
        expect(clock.pending()).toBe(1);
        expect(onWarn).not.toHaveBeenCalled();
    });

    it('IGNORES activity once the warning is showing (explicit choice required)', () => {
        const { clock, onExpire, timer } = makeTimer();
        timer.start();
        clock.fire(); // → warning
        timer.notifyActivity(); // must NOT cancel expiry
        clock.fire(); // expiry still fires
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('stayActive() during the warning cancels expiry and re-arms idle', () => {
        const { clock, onExpire, onWarn, timer } = makeTimer();
        timer.start();
        clock.fire(); // → warning
        timer.stayActive();
        expect(timer.isWarning()).toBe(false);
        expect(clock.lastDelay()).toBe(25_000); // back to the idle window
        clock.fire(); // idle again → warns a SECOND time, not expire
        expect(onExpire).not.toHaveBeenCalled();
        expect(onWarn).toHaveBeenCalledTimes(2);
    });

    it('stop() cancels all pending timers and fires nothing', () => {
        const { clock, onWarn, onExpire, timer } = makeTimer();
        timer.start();
        timer.stop();
        expect(clock.pending()).toBe(0);
        clock.fire();
        expect(onWarn).not.toHaveBeenCalled();
        expect(onExpire).not.toHaveBeenCalled();
    });
});
