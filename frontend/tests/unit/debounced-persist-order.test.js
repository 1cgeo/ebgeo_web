import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DebouncedPersist } from '../../src/js/utilities/debounced-persist.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('an explicitly refused write remains unsaved and can be retried', async () => {
    const write = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(undefined);
    const persist = new DebouncedPersist({ retainOnError: true });
    persist.schedule('style', write);
    expect(await persist.flush('style')).toBe(false);
    expect(await persist.flush('style')).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
});

it('keeps the failed edit and exit warning until an explicit retry commits', async () => {
    const remove = vi.fn();
    vi.stubGlobal('addEventListener', vi.fn());
    vi.stubGlobal('removeEventListener', remove);
    const write = vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValue(undefined);
    const persist = new DebouncedPersist({ maxRetries: 0, warnBeforeUnload: true, retainOnError: true });
    persist.schedule('style', write);
    expect(await persist.flushAll()).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    expect(await persist.flushAll()).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledOnce();
});

it('warns before closing while a user edit is pending or saving, and releases the warning after commit', async () => {
    const add = vi.fn(), remove = vi.fn();
    vi.stubGlobal('addEventListener', add);
    vi.stubGlobal('removeEventListener', remove);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const persist = new DebouncedPersist({ delay: 10, warnBeforeUnload: true });
    persist.schedule('style', () => gate);
    expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    const event = { preventDefault: vi.fn(), returnValue: undefined };
    add.mock.calls[0][1](event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe('');
    await vi.advanceTimersByTimeAsync(10);
    persist.destroy();
    expect(remove).not.toHaveBeenCalled();
    release();
    await persist.flushAll();
    expect(remove).toHaveBeenCalledWith('beforeunload', add.mock.calls[0][1]);
});

it('a slow timer save cannot overwrite a newer value, and flushAll waits for both', async () => {
    const saves = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const persist = new DebouncedPersist({ delay: 10 });
    persist.schedule('style', async () => { await gate; saves.push('old'); });
    await vi.advanceTimersByTimeAsync(10);
    persist.schedule('style', async () => { saves.push('new'); });
    await vi.advanceTimersByTimeAsync(10);
    expect(saves).toEqual([]);
    let done = false;
    const flush = persist.flushAll().then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await flush;
    expect(saves).toEqual(['old', 'new']);
});

it('closing during a running save still drains the most recent edit', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const saves = [];
    const persist = new DebouncedPersist({ delay: 10 });
    persist.schedule('style', async () => { await gate; saves.push('old'); });
    await vi.advanceTimersByTimeAsync(10);
    persist.schedule('style', async () => { saves.push('new'); });
    const flush = persist.flush('style');
    persist.destroy();
    release();
    await flush;
    expect(saves).toEqual(['old', 'new']);
});

it('a retry finishes before a later edit and different keys remain independent', async () => {
    const saves = [];
    const persist = new DebouncedPersist({ delay: 10, maxRetries: 1 });
    let first = true;
    persist.schedule('style', async () => {
        if (first) { first = false; throw new Error('temporary'); }
        saves.push('retry');
    });
    await vi.advanceTimersByTimeAsync(10);
    persist.schedule('style', async () => { saves.push('latest'); });
    persist.schedule('other', async () => { saves.push('independent'); });
    await vi.advanceTimersByTimeAsync(10);
    expect(saves).toEqual(['independent']);
    await vi.advanceTimersByTimeAsync(1000);
    await persist.flushAll();
    expect(saves).toEqual(['independent', 'retry', 'latest']);
});
