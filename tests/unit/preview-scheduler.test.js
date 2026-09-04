// Path: tests/unit/preview-scheduler.test.js

import { describe, it, expect } from 'vitest';
import { createPreviewScheduler } from '../../src/js/tool_manager/helpers/preview-scheduler.js';

/**
 * A hand-driven `requestAnimationFrame`: nothing runs until `frame()` is called,
 * which is what lets a test put ten events inside ONE frame.
 */
function fakeClock() {
    let nextId = 0;
    const scheduled = new Map();
    const cancelled = [];

    return {
        cancelled,
        get scheduledCount() { return scheduled.size; },
        raf(callback) {
            const id = ++nextId;
            scheduled.set(id, callback);
            return id;
        },
        caf(id) {
            cancelled.push(id);
            scheduled.delete(id);
        },
        /** Run every callback the gate asked for, as the browser would. */
        frame() {
            const due = [...scheduled.entries()];
            scheduled.clear();
            for (const [, callback] of due) callback();
            return due.length;
        },
    };
}

function pointerAt(x) {
    return { point: { x, y: x * 2 }, lngLat: { lng: -53 - x / 1000, lat: -29 - x / 1000 } };
}

describe('the preview rAF gate', () => {
    it('coalesces ten requests in one frame into one callback with the LAST pointer', () => {
        const clock = fakeClock();
        const seen = [];
        const scheduler = createPreviewScheduler({
            raf: clock.raf,
            caf: clock.caf,
            onFrame: (pointer) => seen.push(pointer),
        });

        for (let x = 1; x <= 10; x += 1) scheduler.request(pointerAt(x));

        // Only the first request bought a frame; the other nine rode it.
        expect(clock.scheduledCount).toBe(1);
        expect(scheduler.pending).toBe(true);
        expect(seen).toHaveLength(0);

        clock.frame();

        expect(seen).toHaveLength(1);
        expect(seen[0].point.x).toBe(10);
        expect(seen[0]).toEqual(pointerAt(10));
        expect(scheduler.pending).toBe(false);
        expect(scheduler.pointer).toBeNull();
    });

    it('reports which request bought the frame', () => {
        const clock = fakeClock();
        const scheduler = createPreviewScheduler({ raf: clock.raf, caf: clock.caf, onFrame: () => {} });

        expect(scheduler.request(pointerAt(1))).toBe(true);
        expect(scheduler.request(pointerAt(2))).toBe(false);
        expect(scheduler.request(pointerAt(3))).toBe(false);
    });

    it('cancel stops the callback and drops the parked pointer', () => {
        const clock = fakeClock();
        const seen = [];
        const scheduler = createPreviewScheduler({
            raf: clock.raf,
            caf: clock.caf,
            onFrame: (pointer) => seen.push(pointer),
        });

        scheduler.request(pointerAt(4));
        expect(scheduler.pending).toBe(true);

        scheduler.cancel();

        expect(clock.cancelled).toEqual([1]);
        expect(scheduler.pending).toBe(false);
        expect(scheduler.pointer).toBeNull();

        // The browser firing a frame anyway must not resurrect the callback: the
        // gate handed the id to `caf`, and nothing is scheduled any more.
        expect(clock.frame()).toBe(0);
        expect(seen).toHaveLength(0);
    });

    it('cancel on an idle gate is a no-op, not a stray cancelAnimationFrame', () => {
        const clock = fakeClock();
        const scheduler = createPreviewScheduler({ raf: clock.raf, caf: clock.caf, onFrame: () => {} });

        scheduler.cancel();
        scheduler.cancel();

        expect(clock.cancelled).toEqual([]);
        expect(scheduler.pending).toBe(false);
    });

    it('a request after the frame schedules a new one', () => {
        const clock = fakeClock();
        const seen = [];
        const scheduler = createPreviewScheduler({
            raf: clock.raf,
            caf: clock.caf,
            onFrame: (pointer) => seen.push(pointer.point.x),
        });

        scheduler.request(pointerAt(1));
        scheduler.request(pointerAt(2));
        clock.frame();

        scheduler.request(pointerAt(7));
        expect(scheduler.pending).toBe(true);
        expect(clock.scheduledCount).toBe(1);
        clock.frame();

        expect(seen).toEqual([2, 7]);
    });

    it('a request after a cancel schedules a new one too', () => {
        const clock = fakeClock();
        const seen = [];
        const scheduler = createPreviewScheduler({
            raf: clock.raf,
            caf: clock.caf,
            onFrame: (pointer) => seen.push(pointer.point.x),
        });

        scheduler.request(pointerAt(1));
        scheduler.cancel();
        scheduler.request(pointerAt(9));
        clock.frame();

        expect(seen).toEqual([9]);
    });

    it('flush delivers the parked pointer at once and clears the scheduled frame', () => {
        const clock = fakeClock();
        const byHand = [];
        const scheduler = createPreviewScheduler({ raf: clock.raf, caf: clock.caf });

        const delivered = scheduler.flush((pointer) => byHand.push(pointer));

        // Nothing was parked, so the callback still runs, with null.
        expect(byHand).toEqual([null]);
        expect(delivered).toBeNull();
    });

    it('flush cancels the frame the gate had already bought', () => {
        const clock = fakeClock();
        const seen = [];
        const scheduler = createPreviewScheduler({
            raf: clock.raf,
            caf: clock.caf,
            onFrame: (pointer) => seen.push(pointer.point.x),
        });

        scheduler.request(pointerAt(5));
        scheduler.flush();

        expect(seen).toEqual([5]);
        expect(clock.cancelled).toEqual([1]);
        // The frame it bought is gone, so the callback does not run twice.
        expect(clock.frame()).toBe(0);
        expect(seen).toEqual([5]);
    });

    it('holds no timer: only the injected rAF is ever used', () => {
        const clock = fakeClock();
        const scheduler = createPreviewScheduler({ raf: clock.raf, caf: clock.caf, onFrame: () => {} });

        const source = createPreviewScheduler.toString();
        expect(source).not.toMatch(/setTimeout|setInterval/);

        scheduler.request(pointerAt(1));
        expect(clock.scheduledCount).toBe(1);
    });
});

describe('the gate refuses the wiring it cannot work without', () => {
    it('fails with a clear message when no rAF is injected', () => {
        expect(() => createPreviewScheduler()).toThrow(/`raf` is required/);
        expect(() => createPreviewScheduler({})).toThrow(/`raf` is required/);
        expect(() => createPreviewScheduler({ caf: () => {} })).toThrow(/requestAnimationFrame/);
        expect(() => createPreviewScheduler({ raf: 16 })).toThrow(TypeError);
    });

    it('fails with a clear message when no cancel is injected', () => {
        expect(() => createPreviewScheduler({ raf: () => 1 })).toThrow(/`caf` is required/);
        expect(() => createPreviewScheduler({ raf: () => 1 })).toThrow(/cancelAnimationFrame/);
    });

    it('rejects an onFrame that is not callable, instead of failing inside the frame', () => {
        expect(() => createPreviewScheduler({ raf: () => 1, caf: () => {}, onFrame: 'draw' }))
            .toThrow(/`onFrame` must be a function/);
    });

    it('refuses request without an onFrame, where the pointer would go nowhere', () => {
        const clock = fakeClock();
        const scheduler = createPreviewScheduler({ raf: clock.raf, caf: clock.caf });

        expect(() => scheduler.request(pointerAt(1))).toThrow(/needs an `onFrame` callback/);
        // And it did not silently buy a frame on the way out.
        expect(clock.scheduledCount).toBe(0);
        expect(scheduler.pending).toBe(false);
    });

    it('refuses flush with nothing to deliver to', () => {
        const clock = fakeClock();
        const scheduler = createPreviewScheduler({ raf: clock.raf, caf: clock.caf });

        expect(() => scheduler.flush()).toThrow(/needs a callback/);
    });
});
