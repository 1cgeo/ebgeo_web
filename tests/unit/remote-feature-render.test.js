// Path: tests/unit/remote-feature-render.test.js

/**
 * Regression — bug E: a peer's remote feature op is applied to the STORE (and emits
 * FEATURE_CREATED/MODIFIED/DELETED) but nothing repopulated the MapLibre sources, so a
 * synced feature was invisible on the 2D map / features tree until a base-layer switch.
 * wireRemoteFeatureRender() bridges that: a debounced source refresh on those events.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { busMock, registry } = vi.hoisted(() => {
    const reg = {};
    return {
        registry: reg,
        busMock: {
            on: vi.fn((evt, handler) => { (reg[evt] ||= new Set()).add(handler); }),
            off: vi.fn((evt, handler) => { reg[evt]?.delete(handler); }),
            emit: vi.fn(),
        },
    };
});

vi.mock('../../src/js/store/services.js', () => ({ getEventBus: () => busMock }));

import { wireRemoteFeatureRender } from '../../src/js/layers/remote-feature-render.js';
import { EventTypes } from '../../src/js/events/event_types.js';

function fire(evt) {
    for (const handler of registry[evt] || []) handler();
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
    for (const k of Object.keys(registry)) delete registry[k];
    vi.clearAllMocks();
});

describe('wireRemoteFeatureRender (bug E)', () => {
    it('subscribes to the remote-only feature events', () => {
        wireRemoteFeatureRender(vi.fn());
        expect(busMock.on).toHaveBeenCalledWith(EventTypes.FEATURE_CREATED, expect.any(Function));
        expect(busMock.on).toHaveBeenCalledWith(EventTypes.FEATURE_MODIFIED, expect.any(Function));
        expect(busMock.on).toHaveBeenCalledWith(EventTypes.FEATURE_DELETED, expect.any(Function));
    });

    it('refreshes the map sources when a remote feature CREATE arrives', async () => {
        const refresh = vi.fn();
        let scheduled = null;
        const scheduler = (fn) => { scheduled = fn; return 'token'; };

        wireRemoteFeatureRender(refresh, { scheduler });
        fire(EventTypes.FEATURE_CREATED);

        expect(refresh).not.toHaveBeenCalled(); // debounced — not yet
        scheduled();                            // fire the debounce timer
        await flush();
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('also refreshes on remote MODIFY and DELETE', async () => {
        for (const evt of [EventTypes.FEATURE_MODIFIED, EventTypes.FEATURE_DELETED]) {
            for (const k of Object.keys(registry)) delete registry[k];
            const refresh = vi.fn();
            let scheduled = null;
            wireRemoteFeatureRender(refresh, { scheduler: (fn) => { scheduled = fn; return 1; } });
            fire(evt);
            scheduled();
            await flush();
            expect(refresh).toHaveBeenCalledTimes(1);
        }
    });

    it('coalesces a burst of remote ops into a SINGLE refresh (debounce)', async () => {
        const refresh = vi.fn();
        let scheduled = null;
        let scheduleCount = 0;
        const scheduler = (fn) => { scheduled = fn; scheduleCount++; return 1; };

        wireRemoteFeatureRender(refresh, { scheduler });
        fire(EventTypes.FEATURE_CREATED);
        fire(EventTypes.FEATURE_MODIFIED);
        fire(EventTypes.FEATURE_DELETED);

        expect(scheduleCount).toBe(1); // only one timer armed for the whole burst
        scheduled();
        await flush();
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('re-arms after a refresh completes (next remote op refreshes again)', async () => {
        const refresh = vi.fn();
        let scheduled = null;
        const scheduler = (fn) => { scheduled = fn; return 1; };

        wireRemoteFeatureRender(refresh, { scheduler });
        fire(EventTypes.FEATURE_CREATED);
        scheduled();
        await flush();
        fire(EventTypes.FEATURE_MODIFIED); // a later op
        scheduled();
        await flush();
        expect(refresh).toHaveBeenCalledTimes(2);
    });

    it('unwire stops further refreshes', async () => {
        const refresh = vi.fn();
        let scheduled = null;
        const unwire = wireRemoteFeatureRender(refresh, { scheduler: (fn) => { scheduled = fn; return 1; } });

        unwire();
        fire(EventTypes.FEATURE_CREATED);

        expect(scheduled).toBeNull(); // handler unsubscribed → never scheduled
        expect(busMock.off).toHaveBeenCalledTimes(3);
    });
});
