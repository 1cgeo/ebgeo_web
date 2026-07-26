// Path: tests/unit/deep-link-wait-for.test.js
//
// `waitFor` (deep-link.js) — the readiness poll the 3D deep link uses before
// applying a shared camera position.
//
// It replaces a bare `setTimeout(500)` + `if (viewer)`: when 500 ms expired with
// the viewer not yet built (a cold boot lazy-loading Cesium over the network), the
// shared viewpoint — the entire payload of the link — was discarded with nothing
// logged. Polling is used rather than an event subscription on purpose: the same
// listener-attached-after-the-event race is what wedged the 360 viewer, and a poll
// cannot miss a state that is already true.

import { describe, it, expect, vi } from 'vitest';
import { waitFor } from '../../src/js/deep-link/deep-link.js';

describe('waitFor', () => {
    it('resolves synchronously when the value is already there', async () => {
        const produce = vi.fn(() => 'viewer');
        await expect(waitFor(produce)).resolves.toBe('viewer');
        // No polling at all in the common case: openViewer already awaited.
        expect(produce).toHaveBeenCalledTimes(1);
    });

    it('resolves as soon as the value appears', async () => {
        vi.useFakeTimers();
        try {
            let value = null;
            const p = waitFor(() => value, 5000, 100);
            await vi.advanceTimersByTimeAsync(250);
            value = 'viewer';
            await vi.advanceTimersByTimeAsync(150);
            await expect(p).resolves.toBe('viewer');
        } finally {
            vi.useRealTimers();
        }
    });

    it('resolves null on timeout — never throws, so the caller stays in control', async () => {
        vi.useFakeTimers();
        try {
            const p = waitFor(() => null, 1000, 100);
            await vi.advanceTimersByTimeAsync(1200);
            await expect(p).resolves.toBe(null);
        } finally {
            vi.useRealTimers();
        }
    });

    it('treats a throwing producer as "not ready" instead of failing the boot', async () => {
        vi.useFakeTimers();
        try {
            let ready = false;
            const p = waitFor(() => {
                if (!ready) throw new Error('Cesium is not defined');
                return 'viewer';
            }, 2000, 100);
            await vi.advanceTimersByTimeAsync(300);
            ready = true;
            await vi.advanceTimersByTimeAsync(150);
            await expect(p).resolves.toBe('viewer');
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not treat falsy-but-valid readings as ready', async () => {
        // 0 / '' / false are "not a viewer"; only a truthy handle counts.
        vi.useFakeTimers();
        try {
            for (const falsy of [0, '', false, undefined, null, NaN]) {
                const p = waitFor(() => falsy, 300, 50);
                await vi.advanceTimersByTimeAsync(400);
                await expect(p).resolves.toBe(null);
            }
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops polling once it has settled', async () => {
        vi.useFakeTimers();
        try {
            const produce = vi.fn(() => null);
            const p = waitFor(produce, 300, 50);
            await vi.advanceTimersByTimeAsync(400);
            await p;
            const callsAtSettle = produce.mock.calls.length;
            await vi.advanceTimersByTimeAsync(1000);
            // A leaked interval would keep calling forever.
            expect(produce.mock.calls.length).toBe(callsAtSettle);
        } finally {
            vi.useRealTimers();
        }
    });
});
