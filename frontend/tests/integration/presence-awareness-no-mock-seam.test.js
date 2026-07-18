// Path: tests/integration/presence-awareness-no-mock-seam.test.js

/**
 * @fileoverview End-to-end presence/awareness render test that exercises the
 * REAL pipeline across the seam that previously hid bugs `g` and `g²`:
 *
 *   presenceStore.setCursor()  →  PRESENCE_CURSORS_CHANGED (real EventBus)
 *                              →  RemoteCursorsLayer._render()  →  maplibre markers
 *
 * Unlike `remote-cursors-layer.test.js`, this spec deliberately does NOT mock the
 * presence store and does NOT inject `mapIdProvider`. Two robustness rules:
 *
 *   1. The layer is constructed with NO `mapIdProvider`, so it resolves the active
 *      map through its REAL default (`getCurrentMapNameSync`, the map NAME). A
 *      regression that filters by the map ID instead of the name (bug `g`) would
 *      then render zero remote cursors and fail here.
 *
 *   2. Cursors are fed the way the backend actually sends them: keyed by `userId`
 *      with NO `clientId` on the frame, and stamped with the map NAME. The store
 *      keys such frames by userId, so self-exclusion must match the local USER ID
 *      too (bug `g²`) — otherwise another tab of the same user (whom the backend
 *      broadcasts to) would render as a "remote" cursor.
 *
 * The vitest env is `node`: a minimal `maplibregl.Marker` stub stands in for the
 * real marker, `document.createElement` is stubbed for the marker DOM, and the
 * active-map NAME is supplied through the mocked `@store.getCurrentMapNameSync`.
 *
 * Only the boundary collaborators are mocked:
 *   - `@store`                       → getCurrentMapNameSync (the active-map NAME)
 *   - `@store/services.js`           → getEventBus (a REAL EventBus, shared by the
 *                                      real store and the real layer)
 *   - `@store/sync/session-context.js` → sessionContext (local clientId + userId)
 *
 * The presence store and the cursors layer are the genuine production modules.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// Minimal maplibregl.Marker + document stubs (env is `node`)
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

const documentStub = {
    createElement: (tag) => (tag === 'span' ? new FakeLabelEl() : new FakeMarkerEl()),
};

// ============================================================================
// Boundary mocks (everything else is the real production module)
// ============================================================================

const { sessionContextMock, getCurrentMapNameSyncMock, eventBusHolder } = vi.hoisted(() => ({
    // Local identity: a clientId AND a userId. The userId is what self-exclusion
    // must match for userId-keyed cursor frames (bug g²).
    sessionContextMock: { clientId: 'client-local', userId: null },
    getCurrentMapNameSyncMock: vi.fn(() => null),
    // Holder so the @store/services mock and the test share ONE EventBus instance.
    eventBusHolder: { bus: null },
}));

// getCurrentMapNameSync is the layer's REAL default active-map resolver. It must
// return the map NAME (the same key the presence-bridge stamps on cursor frames).
vi.mock('@store', () => ({ getCurrentMapNameSync: getCurrentMapNameSyncMock }));

// Real EventBus, shared by the real presenceStore (emit) and the real layer (on).
vi.mock('@store/services.js', () => ({ getEventBus: () => eventBusHolder.bus }));

// Controllable local identity (avoids the real getClientId() dependency).
vi.mock('@store/sync/session-context.js', () => ({ sessionContext: sessionContextMock }));

import { createEventBus } from '@events/event_bus.js';
import { presenceStore } from '@js/presence/presence-store.js';
import { RemoteCursorsLayer } from '@js/presence/remote-cursors.layer.js';
import { getCurrentMapNameSync } from '@store';

// ============================================================================
// Constants
// ============================================================================

const ACTIVE_MAP = 'Mapa Tático'; // the map NAME (bridge key), not an id
const OTHER_MAP = 'Mapa Estratégico';
const LOCAL_USER_ID = 'user-local';
const PEER_USER_ID = 'user-peer';

// ============================================================================
// Helpers
// ============================================================================

function liveMarkers() {
    return FakeMarker.instances.filter((m) => !m.removed);
}

function markerClientId(marker) {
    return marker.getElement().getAttribute('data-client-id');
}

// ============================================================================
// Tests
// ============================================================================

describe('presence/awareness render — no mock seam (real store + real layer)', () => {
    /** @type {RemoteCursorsLayer} */
    let layer;
    let originalDocument;
    let originalMaplibre;
    const fakeMap = { _id: 'maplibre-map' };

    beforeEach(() => {
        originalDocument = globalThis.document;
        originalMaplibre = globalThis.maplibregl;
        globalThis.document = documentStub;
        globalThis.maplibregl = { Marker: FakeMarker };
        FakeMarker.instances = [];

        // Fresh REAL EventBus per test, shared by store and layer via the mocks.
        eventBusHolder.bus = createEventBus();

        // Reset the REAL singleton store between tests.
        presenceStore.clear();

        // Active map resolves to the map NAME by default.
        getCurrentMapNameSync.mockReset();
        getCurrentMapNameSync.mockReturnValue(ACTIVE_MAP);

        // Local identity: a clientId that matches no cursor key + a userId.
        sessionContextMock.clientId = 'client-local';
        sessionContextMock.userId = LOCAL_USER_ID;

        // Construct with NO mapIdProvider → exercises the REAL default resolver.
        layer = new RemoteCursorsLayer(fakeMap);
        layer.start();
    });

    afterEach(() => {
        layer.stop();
        presenceStore.clear();
        globalThis.document = originalDocument;
        globalThis.maplibregl = originalMaplibre;
    });

    it('renders a remote cursor fed by userId (no clientId) on the active map NAME (bug g)', () => {
        // Backend-shaped frame: keyed by userId, NO clientId, stamped with the map NAME.
        presenceStore.setCursor({
            userId: PEER_USER_ID,
            position: { lng: 10, lat: 20 },
            mapId: ACTIVE_MAP,
        });

        // The real default resolver was consulted with the map NAME...
        expect(getCurrentMapNameSync).toHaveBeenCalled();
        // ...and exactly one marker rendered for the peer.
        const live = liveMarkers();
        expect(live).toHaveLength(1);
        // The store keys the frame by userId (no clientId), so that is the marker id.
        expect(markerClientId(live[0])).toBe(PEER_USER_ID);
        expect(live[0].lngLat).toEqual([10, 20]);
        expect(live[0].map).toBe(fakeMap);
    });

    it('does NOT render the local user when their own cursor is keyed by userId (bug g²)', () => {
        // Another tab of the SAME user: backend broadcasts it, keyed by the local
        // userId, with no/other clientId. Self-exclusion must drop it by USER ID.
        presenceStore.setCursor({
            userId: LOCAL_USER_ID,
            position: { lng: 1, lat: 2 },
            mapId: ACTIVE_MAP,
        });
        // A genuine peer alongside it, to prove the filter is selective, not blanket.
        presenceStore.setCursor({
            userId: PEER_USER_ID,
            position: { lng: 30, lat: 40 },
            mapId: ACTIVE_MAP,
        });

        const live = liveMarkers();
        expect(live).toHaveLength(1);
        expect(markerClientId(live[0])).toBe(PEER_USER_ID);
        // The local user's own cursor never produced a (live) marker.
        expect(FakeMarker.instances.some((m) => markerClientId(m) === LOCAL_USER_ID)).toBe(false);
    });

    it('does NOT render a cursor on a DIFFERENT map name (active-map filter)', () => {
        presenceStore.setCursor({
            userId: PEER_USER_ID,
            position: { lng: 30, lat: 40 },
            mapId: OTHER_MAP, // not the active map name
        });

        expect(liveMarkers()).toHaveLength(0);
    });

    it('renders only the active-map peer when peers span two maps', () => {
        presenceStore.setCursor({
            userId: 'user-here',
            position: { lng: 5, lat: 6 },
            mapId: ACTIVE_MAP,
        });
        presenceStore.setCursor({
            userId: 'user-elsewhere',
            position: { lng: 7, lat: 8 },
            mapId: OTHER_MAP,
        });

        const live = liveMarkers();
        expect(live).toHaveLength(1);
        expect(markerClientId(live[0])).toBe('user-here');
    });

    // Selection analog: the other user's selection is observable via the real store's
    // getOthers(); the LOCAL user's selection is excluded by the same self-exclusion
    // identity (userId), mirroring the cursor self-exclusion above.
    it('exposes a peer selection via getOthers and excludes the local user (selection analog)', () => {
        // Local user selects a feature (another tab broadcast, keyed by userId).
        presenceStore.setSelection({
            userId: LOCAL_USER_ID,
            featureIds: ['f-local'],
            mapId: ACTIVE_MAP,
        });
        // A peer selects a different feature.
        presenceStore.setSelection({
            userId: PEER_USER_ID,
            featureIds: ['f-peer'],
            mapId: ACTIVE_MAP,
        });

        // getOthers excludes self by clientId OR userId — pass the local userId.
        const others = presenceStore.getOthers(sessionContextMock.userId);
        const withSelection = others.filter((u) => u.selection);

        expect(withSelection).toHaveLength(1);
        expect(withSelection[0].userId).toBe(PEER_USER_ID);
        expect(withSelection[0].selection.featureIds).toEqual(['f-peer']);
        // The local user is not among "others".
        expect(others.some((u) => u.userId === LOCAL_USER_ID)).toBe(false);
    });
});
