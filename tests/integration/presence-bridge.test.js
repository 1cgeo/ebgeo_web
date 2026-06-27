// Path: tests/integration/presence-bridge.test.js

/**
 * @fileoverview Unit tests for the presence bridge (Slice 2 wiring).
 *
 * Pins the inbound routing (WS 'connected'/'presence'/'cursor'/'selection' ->
 * presence store), the throttled outbound cursor broadcast on map 'mousemove',
 * idempotent start/stop, and teardown (map unbind + store clear).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// Mocks (declared before importing the module under test)
// ============================================================================

// vi.mock factories are hoisted above the file, so the shared mocks they close
// over must be created with vi.hoisted (also hoisted) to avoid a TDZ error.
const {
    wsHandlers,
    busHandlers,
    wsClientMock,
    presenceStoreMock,
    eventBusMock,
    stateManagerMock,
    temporalControlMock,
    getControlMock,
    getCurrentMapNameSyncMock,
} = vi.hoisted(() => {
    /** Single-handler-per-event registry, mirroring ws-client.on(). */
    const handlers = {};
    const ws = {
        on: vi.fn((event, handler) => {
            handlers[event] = handler;
            return ws;
        }),
        isConnected: vi.fn(() => true),
        sendCursor: vi.fn(),
        sendSelection: vi.fn(),
        sendTemporal: vi.fn(),
        sendBriefingEditStart: vi.fn(),
        sendBriefingEditEnd: vi.fn(),
    };
    const store = {
        setInitial: vi.fn(),
        userJoined: vi.fn(),
        userLeft: vi.fn(),
        userAway: vi.fn(),
        userBack: vi.fn(),
        setCursor: vi.fn(),
        setSelection: vi.fn(),
        setTemporal: vi.fn(),
        setBriefingEdit: vi.fn(),
        setCurrentMap: vi.fn(),
        clear: vi.fn(),
    };

    // Multi-handler event bus stand-in (records by event for firing in tests).
    const bus = {
        on: vi.fn((event, handler) => {
            if (!handlers.__bus) handlers.__bus = {};
            if (!handlers.__bus[event]) handlers.__bus[event] = new Set();
            handlers.__bus[event].add(handler);
            // Mirror real EventBus.on() which returns an unsubscribe function.
            return () => handlers.__bus[event].delete(handler);
        }),
        off: vi.fn(),
        emit: vi.fn(),
    };

    // StateManager mock: records the selection.features subscriber so the test
    // can drive selection changes, and returns a configurable selection list.
    const selectionListeners = new Set();
    const stateManager = {
        _selected: [],
        subscribe: vi.fn((path, cb) => {
            if (path === 'selection.features') selectionListeners.add(cb);
            return () => selectionListeners.delete(cb);
        }),
        getSelectedFeatures: vi.fn(() => stateManager._selected),
        /** Test helper: simulate a selection change. */
        _fireSelection() {
            for (const cb of selectionListeners) cb(stateManager._selected);
        },
    };

    const temporalControl = {
        isPlaying: vi.fn(() => false),
        getTimeContext: vi.fn(() => ({ modo: 'relativo', origem: 0, unidade: 'DIA' })),
    };
    const getControl = vi.fn((name) => (name === 'TemporalControl' ? temporalControl : null));

    const getMapName = vi.fn(() => 'mapa-1');
    return {
        wsHandlers: handlers,
        busHandlers: handlers,
        wsClientMock: ws,
        presenceStoreMock: store,
        eventBusMock: bus,
        stateManagerMock: stateManager,
        temporalControlMock: temporalControl,
        getControlMock: getControl,
        getCurrentMapNameSyncMock: getMapName,
    };
});

vi.mock('@store/sync/ws-client.js', () => ({ wsClient: wsClientMock }));
vi.mock('@js/presence/presence-store.js', () => ({ presenceStore: presenceStoreMock }));
vi.mock('@store', () => ({
    getCurrentMapNameSync: getCurrentMapNameSyncMock,
    getStateManager: () => stateManagerMock,
    getControl: getControlMock,
}));
vi.mock('@store/services.js', () => ({ getEventBus: () => eventBusMock }));
vi.mock('@js/temporal/temporal.utils.js', () => ({
    formatTimelineLabel: (cursor) => `D+${cursor}`,
}));

/** Fire a bus event registered via getEventBus().on(event, ...). */
function fireBus(event, payload) {
    for (const cb of busHandlers.__bus?.[event] || []) cb(payload);
}

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { startPresence, stopPresence } from '@js/presence/presence-bridge.js';
import { EventTypes } from '@events/event_types.js';

// ============================================================================
// Helpers
// ============================================================================

/** Minimal MapLibre Evented stand-in (on/off only). */
function createFakeMap() {
    const listeners = new Map();
    return {
        on: vi.fn((event, handler) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(handler);
        }),
        off: vi.fn((event, handler) => {
            listeners.get(event)?.delete(handler);
        }),
        /** Test helper: fire a map event. */
        fire(event, payload) {
            for (const h of listeners.get(event) || []) h(payload);
        },
        /** Test helper: count active listeners for an event. */
        count(event) {
            return listeners.get(event)?.size ?? 0;
        },
    };
}

function resetMocks() {
    for (const key of Object.keys(wsHandlers)) delete wsHandlers[key];
    wsClientMock.on.mockClear();
    wsClientMock.isConnected.mockClear();
    wsClientMock.isConnected.mockReturnValue(true);
    wsClientMock.sendCursor.mockClear();
    wsClientMock.sendSelection.mockClear();
    wsClientMock.sendTemporal.mockClear();
    wsClientMock.sendBriefingEditStart.mockClear();
    wsClientMock.sendBriefingEditEnd.mockClear();
    for (const fn of Object.values(presenceStoreMock)) fn.mockClear();
    eventBusMock.on.mockClear();
    eventBusMock.off.mockClear();
    eventBusMock.emit.mockClear();
    stateManagerMock.subscribe.mockClear();
    stateManagerMock.getSelectedFeatures.mockClear();
    stateManagerMock._selected = [];
    temporalControlMock.isPlaying.mockClear();
    temporalControlMock.getTimeContext.mockClear();
    getControlMock.mockClear();
    getCurrentMapNameSyncMock.mockClear();
    getCurrentMapNameSyncMock.mockReturnValue('mapa-1');
}

// ============================================================================
// Tests
// ============================================================================

describe('presence-bridge', () => {
    /** @type {ReturnType<typeof createFakeMap>} */
    let map;

    beforeEach(() => {
        resetMocks();
        vi.useFakeTimers();
        map = createFakeMap();
    });

    afterEach(() => {
        stopPresence();
        vi.useRealTimers();
    });

    describe('startPresence — inbound routing', () => {
        beforeEach(() => {
            startPresence({ map });
        });

        it('registers handlers for connected/presence/cursor/selection/temporal/briefingEdit', () => {
            expect(wsHandlers.connected).toBeTypeOf('function');
            expect(wsHandlers.presence).toBeTypeOf('function');
            expect(wsHandlers.cursor).toBeTypeOf('function');
            expect(wsHandlers.selection).toBeTypeOf('function');
            expect(wsHandlers.temporal).toBeTypeOf('function');
            expect(wsHandlers.briefingEdit).toBeTypeOf('function');
        });

        it("routes 'connected' to presenceStore.setInitial with usersOnline", () => {
            const users = [{ userId: 'u1', clientId: 'c1' }];
            wsHandlers.connected({ usersOnline: users });
            expect(presenceStoreMock.setInitial).toHaveBeenCalledWith(users);
        });

        it("routes 'connected' with no usersOnline to setInitial([])", () => {
            wsHandlers.connected({});
            expect(presenceStoreMock.setInitial).toHaveBeenCalledWith([]);
        });

        it("routes 'presence' subtypes to the matching store mutation", () => {
            // user_joined nests the descriptor under `user` (backend shape); the bridge must
            // UNWRAP it so the store keys on the real id/nome. The others carry a top-level userId.
            wsHandlers.presence({ type: 'user_joined', user: { id: 'u1', nome: 'Alice' } });
            wsHandlers.presence({ type: 'user_left', userId: 'u1' });
            wsHandlers.presence({ type: 'user_away', userId: 'u1' });
            wsHandlers.presence({ type: 'user_back', userId: 'u1' });

            expect(presenceStoreMock.userJoined).toHaveBeenCalledWith({ id: 'u1', nome: 'Alice' });
            expect(presenceStoreMock.userLeft).toHaveBeenCalledWith({ type: 'user_left', userId: 'u1' });
            expect(presenceStoreMock.userAway).toHaveBeenCalledWith({ type: 'user_away', userId: 'u1' });
            expect(presenceStoreMock.userBack).toHaveBeenCalledWith({ type: 'user_back', userId: 'u1' });
        });

        it("ignores unknown 'presence' subtypes", () => {
            wsHandlers.presence({ type: 'user_dancing', clientId: 'c1' });
            expect(presenceStoreMock.userJoined).not.toHaveBeenCalled();
            expect(presenceStoreMock.userLeft).not.toHaveBeenCalled();
        });

        it("routes 'cursor' to presenceStore.setCursor", () => {
            const msg = { userId: 'u1', position: { lng: 1, lat: 2 }, mapId: 'm1' };
            wsHandlers.cursor(msg);
            expect(presenceStoreMock.setCursor).toHaveBeenCalledWith(msg);
        });

        it("routes 'selection' to presenceStore.setSelection", () => {
            const msg = { userId: 'u1', featureIds: ['f1'], mapId: 'm1' };
            wsHandlers.selection(msg);
            expect(presenceStoreMock.setSelection).toHaveBeenCalledWith(msg);
        });

        it("routes 'temporal' to presenceStore.setTemporal (case E inbound)", () => {
            const msg = { userId: 'u1', state: { cursor: 5, label: 'D+5' }, mapId: 'm1' };
            wsHandlers.temporal(msg);
            expect(presenceStoreMock.setTemporal).toHaveBeenCalledWith(msg);
        });

        it("routes 'briefingEdit' started/ended to presenceStore.setBriefingEdit (case D inbound)", () => {
            wsHandlers.briefingEdit({ type: 'briefing_edit_started', userId: 'u1', userName: 'Alice', briefingId: 'b1' });
            expect(presenceStoreMock.setBriefingEdit).toHaveBeenLastCalledWith(
                expect.objectContaining({ userId: 'u1', userName: 'Alice', briefingId: 'b1', editing: true }),
            );

            wsHandlers.briefingEdit({ type: 'briefing_edit_ended', userId: 'u1', userName: 'Alice', briefingId: 'b1' });
            expect(presenceStoreMock.setBriefingEdit).toHaveBeenLastCalledWith(
                expect.objectContaining({ userId: 'u1', briefingId: 'b1', editing: false }),
            );
        });
    });

    // ===== Outbound awareness (cases C/E/D/F) =====
    describe('outbound awareness — bus + state triggers', () => {
        beforeEach(() => {
            startPresence({ map });
        });

        it('case C: re-announces the current map on MAP_LOCK_CHANGED via a positionless cursor', () => {
            fireBus(EventTypes.MAP_LOCK_CHANGED, { mapName: 'mapa-1', locked: false });
            expect(wsClientMock.sendCursor).toHaveBeenCalledWith({ position: null, mapId: 'mapa-1' });
        });

        it('case E: sends temporal state (cursor + derived label + playing) on TEMPORAL_CURSOR_CHANGED', () => {
            temporalControlMock.isPlaying.mockReturnValue(true);
            fireBus(EventTypes.TEMPORAL_CURSOR_CHANGED, { cursor: 3 });
            expect(wsClientMock.sendTemporal).toHaveBeenCalledWith(
                { cursor: 3, label: 'D+3', playing: true },
                'mapa-1',
            );
        });

        it('case D: forwards briefing edit start/end to the ws client', () => {
            fireBus(EventTypes.BRIEFING_EDIT_STARTED, { briefingId: 'b1' });
            expect(wsClientMock.sendBriefingEditStart).toHaveBeenCalledWith('b1');

            fireBus(EventTypes.BRIEFING_EDIT_ENDED, { briefingId: 'b1' });
            expect(wsClientMock.sendBriefingEditEnd).toHaveBeenCalledWith('b1');
        });

        it('case F: subscribes to selection.features and sends the live selection on change', () => {
            expect(stateManagerMock.subscribe).toHaveBeenCalledWith('selection.features', expect.any(Function));

            stateManagerMock._selected = [
                { type: 'point', id: 'f1' },
                { type: 'line', id: 'f2' },
            ];
            stateManagerMock._fireSelection();

            // 2D selection frame now carries the surface + per-feature type (featureMeta)
            // so a peer can rebuild the highlight without a store lookup.
            expect(wsClientMock.sendSelection).toHaveBeenCalledWith({
                surface: '2d',
                featureIds: ['f1', 'f2'],
                featureMeta: [
                    { id: 'f1', type: 'point' },
                    { id: 'f2', type: 'line' },
                ],
                mapId: 'mapa-1',
            });
        });

        it('does not send awareness frames while the socket is disconnected', () => {
            wsClientMock.isConnected.mockReturnValue(false);
            fireBus(EventTypes.MAP_LOCK_CHANGED, { mapName: 'mapa-1' });
            fireBus(EventTypes.TEMPORAL_CURSOR_CHANGED, { cursor: 3 });
            fireBus(EventTypes.BRIEFING_EDIT_STARTED, { briefingId: 'b1' });
            stateManagerMock._selected = [{ type: 'point', id: 'f1' }];
            stateManagerMock._fireSelection();

            expect(wsClientMock.sendCursor).not.toHaveBeenCalled();
            expect(wsClientMock.sendTemporal).not.toHaveBeenCalled();
            expect(wsClientMock.sendBriefingEditStart).not.toHaveBeenCalled();
            expect(wsClientMock.sendSelection).not.toHaveBeenCalled();
        });
    });

    describe('startPresence — idempotency', () => {
        it('is a no-op on a second start (handlers registered once)', () => {
            startPresence({ map });
            const firstCount = wsClientMock.on.mock.calls.length;
            startPresence({ map });
            expect(wsClientMock.on.mock.calls.length).toBe(firstCount);
            expect(map.on).toHaveBeenCalledTimes(1);
        });
    });

    describe('outbound cursor (mousemove, throttled)', () => {
        beforeEach(() => {
            startPresence({ map });
        });

        it('binds a mousemove listener on the map', () => {
            expect(map.count('mousemove')).toBe(1);
        });

        it('sends the leading move immediately with the active mapId', () => {
            map.fire('mousemove', { lngLat: { lng: 10, lat: 20 } });
            expect(wsClientMock.sendCursor).toHaveBeenCalledTimes(1);
            expect(wsClientMock.sendCursor).toHaveBeenCalledWith({
                position: { lng: 10, lat: 20 },
                mapId: 'mapa-1',
            });
        });

        it('throttles bursts to one leading + one trailing send per window', () => {
            map.fire('mousemove', { lngLat: { lng: 1, lat: 1 } }); // leading
            map.fire('mousemove', { lngLat: { lng: 2, lat: 2 } }); // coalesced
            map.fire('mousemove', { lngLat: { lng: 3, lat: 3 } }); // coalesced (latest wins)
            expect(wsClientMock.sendCursor).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(80);
            expect(wsClientMock.sendCursor).toHaveBeenCalledTimes(2);
            // The trailing send carries the most recent position.
            expect(wsClientMock.sendCursor).toHaveBeenLastCalledWith({
                position: { lng: 3, lat: 3 },
                mapId: 'mapa-1',
            });
        });

        it('does not send when the socket is disconnected', () => {
            wsClientMock.isConnected.mockReturnValue(false);
            map.fire('mousemove', { lngLat: { lng: 1, lat: 1 } });
            expect(wsClientMock.sendCursor).not.toHaveBeenCalled();
        });

        it('ignores mousemove events without a valid lngLat', () => {
            map.fire('mousemove', {});
            map.fire('mousemove', { lngLat: { lng: 'x', lat: 1 } });
            expect(wsClientMock.sendCursor).not.toHaveBeenCalled();
        });
    });

    describe('stopPresence', () => {
        it('unbinds the map listener and clears the store', () => {
            startPresence({ map });
            stopPresence();
            expect(map.off).toHaveBeenCalledWith('mousemove', expect.any(Function));
            expect(map.count('mousemove')).toBe(0);
            expect(presenceStoreMock.clear).toHaveBeenCalledTimes(1);
        });

        it('detaches the owned WS handlers so they no longer hit the store', () => {
            startPresence({ map });
            stopPresence();
            // After stop, the registered handlers are no-ops; routing is severed.
            wsHandlers.cursor({ userId: 'u1', position: { lng: 1, lat: 2 } });
            wsHandlers.connected({ usersOnline: [{ clientId: 'c1' }] });
            expect(presenceStoreMock.setCursor).not.toHaveBeenCalled();
            expect(presenceStoreMock.setInitial).not.toHaveBeenCalled();
        });

        it('is a no-op when not started', () => {
            stopPresence();
            expect(presenceStoreMock.clear).not.toHaveBeenCalled();
        });

        it('releases the selection.features subscription so it no longer sends outbound', () => {
            startPresence({ map });
            stopPresence();
            // After teardown a selection change must not reach the ws client.
            stateManagerMock._selected = [{ type: 'point', id: 'f1' }];
            stateManagerMock._fireSelection();
            expect(wsClientMock.sendSelection).not.toHaveBeenCalled();
        });

        it('cancels a pending trailing-cursor send', () => {
            startPresence({ map });
            map.fire('mousemove', { lngLat: { lng: 1, lat: 1 } }); // leading
            map.fire('mousemove', { lngLat: { lng: 2, lat: 2 } }); // schedules trailing
            wsClientMock.sendCursor.mockClear();

            stopPresence();
            vi.advanceTimersByTime(80);
            expect(wsClientMock.sendCursor).not.toHaveBeenCalled();
        });
    });

    describe('start after stop', () => {
        it('re-wires cleanly (handlers re-registered, throttle reset)', () => {
            startPresence({ map });
            stopPresence();

            const map2 = createFakeMap();
            startPresence({ map: map2 });
            map2.fire('mousemove', { lngLat: { lng: 5, lat: 6 } });
            expect(wsClientMock.sendCursor).toHaveBeenLastCalledWith({
                position: { lng: 5, lat: 6 },
                mapId: 'mapa-1',
            });
        });
    });
});
