// Path: tests/integration/remote-cursors-layer.test.js

/**
 * @fileoverview Render tests for the RemoteCursorsLayer overlay (§A/§B gap +
 * case C active-map filtering). Asserts maplibre Marker create/update/remove
 * reconciliation against the presence store's cursors, self-exclusion, and that
 * only cursors on the active map are rendered.
 *
 * The vitest env is `node`: a minimal `maplibregl.Marker` stub stands in for the
 * real marker (the layer reaches it via the `maplibregl` global), and the active
 * map is injected via the constructor's `mapIdProvider` option.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// Minimal maplibregl.Marker stub
// ============================================================================

class FakeMarkerEl {
    constructor() {
        this.attributes = {};
        this.children = [];
        this.className = '';
    }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k] ?? null; }
    appendChild(c) { this.children.push(c); return c; }
    querySelector(sel) {
        // Only '.remote-cursor__label' is queried by the layer.
        const cls = sel.replace('.', '');
        return this.children.find((c) => c.className === cls) || null;
    }
}

class FakeLabelEl {
    constructor() { this.className = ''; this._text = ''; }
    get textContent() { return this._text; }
    set textContent(v) { this._text = String(v); }
}

class FakeMarker {
    constructor(opts) {
        this.opts = opts;
        this.element = opts.element;
        this.lngLat = null;
        this.map = null;
        this.removed = false;
        FakeMarker.instances.push(this);
    }
    setLngLat(ll) { this.lngLat = ll; return this; }
    addTo(map) { this.map = map; return this; }
    getElement() { return this.element; }
    remove() { this.removed = true; }
}
FakeMarker.instances = [];

// Patch document.createElement minimally for the marker DOM (div + span label).
const documentStub = {
    createElement: (tag) => (tag === 'span' ? new FakeLabelEl() : new FakeMarkerEl()),
};

// ============================================================================
// Mocks
// ============================================================================

const { presenceStoreMock, sessionContextMock, eventBusMock, busRegistry } = vi.hoisted(() => {
    const registry = {};
    return {
        presenceStoreMock: { getCursors: vi.fn(() => []) },
        sessionContextMock: { clientId: 'self', userId: null },
        eventBusMock: {
            on: vi.fn((event, handler) => {
                (registry[event] ||= new Set()).add(handler);
                return () => registry[event].delete(handler);
            }),
            off: vi.fn(),
            emit: vi.fn(),
        },
        busRegistry: registry,
    };
});

vi.mock('@js/presence/presence-store.js', () => ({ presenceStore: presenceStoreMock }));
vi.mock('@store/sync/session-context.js', () => ({ sessionContext: sessionContextMock }));
vi.mock('@store/services.js', () => ({ getEventBus: () => eventBusMock }));
// getCurrentMapNameSync is the DEFAULT active-map resolver. Most tests inject
// mapIdProvider instead, but it must match the key the presence-bridge stamps on
// cursor frames (the map NAME) — covered by the default-resolver regression below.
vi.mock('@store', () => ({ getCurrentMapNameSync: vi.fn(() => null) }));

import { RemoteCursorsLayer } from '@js/presence/remote-cursors.layer.js';
import { getCurrentMapNameSync } from '@store';
import { EventTypes } from '@events/event_types.js';

// ============================================================================
// Helpers
// ============================================================================

function cursor(clientId, lng, lat, mapId, userName) {
    return { clientId, userName: userName ?? clientId, position: { lng, lat, mapId } };
}

function fireCursorsChanged() {
    for (const cb of busRegistry[EventTypes.PRESENCE_CURSORS_CHANGED] || []) cb({});
}

// ============================================================================
// Tests
// ============================================================================

describe('RemoteCursorsLayer — marker reconciliation + active-map filtering', () => {
    /** @type {RemoteCursorsLayer} */
    let layer;
    let activeMap;
    let originalDocument;
    let originalMaplibre;
    const fakeMap = { _id: 'maplibre-map' };

    beforeEach(() => {
        originalDocument = globalThis.document;
        originalMaplibre = globalThis.maplibregl;
        globalThis.document = documentStub;
        globalThis.maplibregl = { Marker: FakeMarker };
        FakeMarker.instances = [];
        for (const k of Object.keys(busRegistry)) delete busRegistry[k];
        presenceStoreMock.getCursors.mockReset();
        presenceStoreMock.getCursors.mockReturnValue([]);
        getCurrentMapNameSync.mockReset();
        getCurrentMapNameSync.mockReturnValue(null);
        sessionContextMock.clientId = 'self';
        sessionContextMock.userId = null;

        activeMap = 'm1';
        layer = new RemoteCursorsLayer(fakeMap, { mapIdProvider: () => activeMap });
    });

    afterEach(() => {
        layer.stop();
        globalThis.document = originalDocument;
        globalThis.maplibregl = originalMaplibre;
    });

    it('creates one marker per remote cursor on the active map', () => {
        presenceStoreMock.getCursors.mockReturnValue([
            cursor('c1', 10, 20, 'm1', 'Alice'),
            cursor('c2', 30, 40, 'm1', 'Bob'),
        ]);
        layer.start();

        expect(FakeMarker.instances).toHaveLength(2);
        expect(FakeMarker.instances[0].lngLat).toEqual([10, 20]);
        expect(FakeMarker.instances[0].map).toBe(fakeMap);
        // Label carries the peer name (XSS-safe textContent).
        const label = FakeMarker.instances[0].getElement().querySelector('.remote-cursor__label');
        expect(label.textContent).toBe('Alice');
    });

    it('excludes the local user (self clientId)', () => {
        sessionContextMock.clientId = 'c1';
        presenceStoreMock.getCursors.mockReturnValue([
            cursor('c1', 10, 20, 'm1'),
            cursor('c2', 30, 40, 'm1'),
        ]);
        layer.start();

        expect(FakeMarker.instances).toHaveLength(1);
        expect(FakeMarker.instances[0].getElement().getAttribute('data-client-id')).toBe('c2');
    });

    // Regression — "user must NOT see their own cursor": backend cursor frames carry
    // only userId (no clientId), so the store keys them by userId. The self-exclusion
    // must therefore match the local USER ID too — otherwise another tab of the SAME
    // user (broadcast to by the backend) would render as a remote cursor.
    it('excludes the local user by USER ID when the cursor is keyed by userId', () => {
        sessionContextMock.clientId = 'client-A'; // a clientId that matches no cursor key
        sessionContextMock.userId = 'user-1';      // the local user id
        presenceStoreMock.getCursors.mockReturnValue([
            cursor('user-1', 10, 20, 'm1'), // self — keyed by userId (no clientId on the frame)
            cursor('user-2', 30, 40, 'm1'), // a real peer
        ]);

        layer.start();

        const live = FakeMarker.instances.filter((m) => !m.removed);
        expect(live).toHaveLength(1);
        expect(live[0].getElement().getAttribute('data-client-id')).toBe('user-2');
    });

    it('updates an existing marker in place on a cursor move (no new marker)', () => {
        presenceStoreMock.getCursors.mockReturnValue([cursor('c1', 10, 20, 'm1', 'Alice')]);
        layer.start();
        expect(FakeMarker.instances).toHaveLength(1);

        // c1 moves; renamed label arrives too.
        presenceStoreMock.getCursors.mockReturnValue([cursor('c1', 11, 21, 'm1', 'Alice 2')]);
        fireCursorsChanged();

        expect(FakeMarker.instances).toHaveLength(1); // reused, not recreated
        expect(FakeMarker.instances[0].lngLat).toEqual([11, 21]);
        const label = FakeMarker.instances[0].getElement().querySelector('.remote-cursor__label');
        expect(label.textContent).toBe('Alice 2');
    });

    it('removes a marker when its user leaves (no longer in the cursor set)', () => {
        presenceStoreMock.getCursors.mockReturnValue([
            cursor('c1', 10, 20, 'm1'),
            cursor('c2', 30, 40, 'm1'),
        ]);
        layer.start();
        const c2Marker = FakeMarker.instances.find((m) => m.getElement().getAttribute('data-client-id') === 'c2');

        presenceStoreMock.getCursors.mockReturnValue([cursor('c1', 10, 20, 'm1')]);
        fireCursorsChanged();

        expect(c2Marker.removed).toBe(true);
    });

    it('case C: renders only cursors on the active map (filters the rest)', () => {
        // The layer asks the store for cursors of the active map only; emulate that
        // by returning the filtered set for the requested mapId.
        presenceStoreMock.getCursors.mockImplementation((mapId) =>
            [cursor('c1', 10, 20, 'm1'), cursor('c2', 30, 40, 'm2')].filter((c) => c.position.mapId === mapId),
        );
        activeMap = 'm1';
        layer.start();

        expect(presenceStoreMock.getCursors).toHaveBeenCalledWith('m1');
        expect(FakeMarker.instances).toHaveLength(1);
        expect(FakeMarker.instances[0].getElement().getAttribute('data-client-id')).toBe('c1');
    });

    it('case C: switching the active map re-renders against the new map', () => {
        presenceStoreMock.getCursors.mockImplementation((mapId) =>
            [cursor('c1', 10, 20, 'm1'), cursor('c2', 30, 40, 'm2')].filter((c) => c.position.mapId === mapId),
        );
        activeMap = 'm1';
        layer.start();
        expect(FakeMarker.instances.filter((m) => !m.removed)).toHaveLength(1);

        // Switch active map → c1's marker is dropped, c2's appears.
        activeMap = 'm2';
        fireCursorsChanged();

        const live = FakeMarker.instances.filter((m) => !m.removed);
        expect(live).toHaveLength(1);
        expect(live[0].getElement().getAttribute('data-client-id')).toBe('c2');
    });

    it('renders nothing when there is no active map', () => {
        activeMap = null;
        presenceStoreMock.getCursors.mockReturnValue([cursor('c1', 10, 20, 'm1')]);
        layer.start();
        expect(FakeMarker.instances).toHaveLength(0);
    });

    // Regression — bug G: with NO injected mapIdProvider the layer must resolve the
    // active map via getCurrentMapNameSync (the map NAME), the same key the
    // presence-bridge stamps on outbound cursor frames. The old default used the map
    // ID, so the filter never matched and no remote cursor ever rendered.
    it('default resolver filters by the map NAME (matching the bridge), not the id', () => {
        getCurrentMapNameSync.mockReturnValue('Mapa Tático');
        presenceStoreMock.getCursors.mockImplementation((mapId) =>
            [cursor('c1', 10, 20, 'Mapa Tático', 'Alice')].filter((c) => c.position.mapId === mapId),
        );

        const defaultLayer = new RemoteCursorsLayer(fakeMap); // no mapIdProvider → default resolver
        defaultLayer.start();

        expect(getCurrentMapNameSync).toHaveBeenCalled();
        expect(presenceStoreMock.getCursors).toHaveBeenCalledWith('Mapa Tático');
        expect(FakeMarker.instances.filter((m) => !m.removed)).toHaveLength(1);
        defaultLayer.stop();
    });

    it('stop() removes all markers and is idempotent', () => {
        presenceStoreMock.getCursors.mockReturnValue([
            cursor('c1', 10, 20, 'm1'),
            cursor('c2', 30, 40, 'm1'),
        ]);
        layer.start();
        expect(FakeMarker.instances).toHaveLength(2);

        layer.stop();
        expect(FakeMarker.instances.every((m) => m.removed)).toBe(true);
        // Idempotent: a second stop is a no-op.
        expect(() => layer.stop()).not.toThrow();
    });
});
