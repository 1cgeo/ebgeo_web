import { describe, it, expect } from 'vitest';

import { createSerialQueue } from '../../src/js/utilities/serial-queue.js';

/** Resolve after `ms`, used to give the tasks inverted durations. */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

describe('createSerialQueue', () => {
    it('runs tasks in call order even when the first one is the slowest', async () => {
        // The whole point: without the queue the fast task finishes first and its
        // write lands before the slow one's, which is the interleaving that loses
        // a `getData -> mutate -> setData` cycle.
        const run = createSerialQueue();
        const order = [];

        const slow = run(async () => {
            await delay(20);
            order.push('slow');
        });
        const fast = run(async () => {
            await delay(0);
            order.push('fast');
        });

        await Promise.all([slow, fast]);
        expect(order).toEqual(['slow', 'fast']);
    });

    it('never overlaps two tasks', async () => {
        const run = createSerialQueue();
        let inFlight = 0;
        let maxInFlight = 0;

        const task = async () => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await delay(1);
            inFlight -= 1;
        };

        await Promise.all([run(task), run(task), run(task), run(task)]);
        expect(maxInFlight).toBe(1);
        expect(inFlight).toBe(0);
    });

    it('propagates the return value of each task', async () => {
        const run = createSerialQueue();

        await expect(run(async () => 'async value')).resolves.toBe('async value');
        await expect(run(() => 42)).resolves.toBe(42);
    });

    it('rejects the caller of a failing task', async () => {
        const run = createSerialQueue();

        await expect(run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        // ...including a task that throws synchronously, before any await.
        await expect(run(() => { throw new Error('sync boom'); })).rejects.toThrow('sync boom');
    });

    it('keeps the chain alive after a failure, in order', async () => {
        const run = createSerialQueue();
        const order = [];

        const failing = run(async () => {
            await delay(10);
            order.push('failed');
            throw new Error('boom');
        });
        const next = run(async () => {
            order.push('next');
            return 'done';
        });

        await expect(failing).rejects.toThrow('boom');
        await expect(next).resolves.toBe('done');
        expect(order).toEqual(['failed', 'next']);
    });

    it('deadlocks on reentrancy, which is why every serialized method needs an unlocked twin', async () => {
        // Not a feature, a documented hazard: a task that awaits `run` waits for
        // itself. Pinned here so that "the queue hung" is a known outcome with a
        // known fix (call the `_xxxUnlocked` body, not the shell) instead of a
        // mystery in a control that stops repainting.
        const run = createSerialQueue();
        let innerRan = false;

        const outer = run(async () => {
            await run(async () => { innerRan = true; });
            return 'never';
        });

        const settled = await Promise.race([
            outer.then(() => 'settled', () => 'settled'),
            delay(30).then(() => 'still waiting'),
        ]);

        expect(settled).toBe('still waiting');
        expect(innerRan).toBe(false);
    });
});
