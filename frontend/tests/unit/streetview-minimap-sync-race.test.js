// Path: tests/unit/streetview-minimap-sync-race.test.js
//
// StreetViewMinimapSync.initialize() must never hang.
//
// ROOT CAUSE it guards: the body used to be
//     if (!minimap.loaded()) await new Promise(r => minimap.on('load', r));
// and MapLibre fires `load` exactly ONCE. If it fired before the listener was
// attached, nothing resolved — ever. That await sits inside the 360 viewer's
// opening chain (openViewer360WithPhoto → initThreeJS → initNavigator →
// navigator.initialize → here), so the panorama never even requested its
// metadata: black screen, empty minimap, no error, no failed request. It hit
// roughly half of shared-deep-link boots (measured 3 of 8) and never the ordinary
// click path, where the minimap had loaded long before.
//
// A browser rerun cannot PROVE a race is gone — it can only fail to reproduce it.
// These cases make each losing interleaving deterministic.

import { describe, it, expect, vi } from 'vitest';
import { StreetViewMinimapSync } from '../../src/js/street_view_tool/navigation/minimap-sync.js';

/**
 * Fake MapLibre map with controllable load timing.
 * @param {{loadedAt: 'already'|'onListen'|'later'|'never'}} opts
 */
function fakeMinimap({ loadedAt }) {
    const handlers = new Map();
    let isLoaded = loadedAt === 'already';
    const map = {
        loaded: () => isLoaded,
        on(ev, fn) {
            handlers.set(ev, [...(handlers.get(ev) ?? []), fn]);
            // The nasty one: the map finishes loading and fires DURING the very
            // call that subscribes, so the subscriber is registered a tick too late.
            if (ev === 'load' && loadedAt === 'onListen') {
                isLoaded = true; // fired already; this listener will never be called
            }
        },
        off(ev, fn) {
            handlers.set(ev, (handlers.get(ev) ?? []).filter((h) => h !== fn));
        },
        emitLoad() {
            isLoaded = true;
            for (const h of handlers.get('load') ?? []) h();
        },
        listenerCount: (ev) => (handlers.get(ev) ?? []).length,
    };
    return map;
}

describe('StreetViewMinimapSync.initialize', () => {
    it('returns immediately when the minimap is already loaded', async () => {
        const map = fakeMinimap({ loadedAt: 'already' });
        const sync = new StreetViewMinimapSync(map);
        await sync.initialize();
        expect(sync.initialized).toBe(true);
    });

    it('resolves when `load` fires normally, and unsubscribes afterwards', async () => {
        const map = fakeMinimap({ loadedAt: 'later' });
        const sync = new StreetViewMinimapSync(map);
        const p = sync.initialize();
        map.emitLoad();
        await p;
        expect(sync.initialized).toBe(true);
        expect(map.listenerCount('load')).toBe(0); // no leaked handler
    });

    it('THE RACE: resolves even when `load` fired in the gap and never reaches the listener', async () => {
        // `loadedAt: 'onListen'` reproduces the exact losing interleaving — the old
        // implementation waits here forever, and this test would time out.
        const map = fakeMinimap({ loadedAt: 'onListen' });
        const sync = new StreetViewMinimapSync(map);
        await sync.initialize(500);
        expect(sync.initialized).toBe(true);
    });

    it('gives up after the timeout rather than blocking the viewer forever', async () => {
        vi.useFakeTimers();
        try {
            const map = fakeMinimap({ loadedAt: 'never' });
            const sync = new StreetViewMinimapSync(map);
            const p = sync.initialize(8000);
            await vi.advanceTimersByTimeAsync(8100);
            await p;
            // Resolves, NOT rejects: the minimap is an aid, and the panorama must
            // open without it. A throw here would put the black screen back.
            expect(sync.initialized).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('is a no-op without a minimap, and idempotent on a second call', async () => {
        const none = new StreetViewMinimapSync(null);
        await none.initialize();
        expect(none.initialized).toBe(false);

        const map = fakeMinimap({ loadedAt: 'already' });
        const sync = new StreetViewMinimapSync(map);
        await sync.initialize();
        await sync.initialize();
        expect(sync.initialized).toBe(true);
    });
});
