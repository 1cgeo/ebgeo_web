// Path: tests/integration/map-lock.test.js

/**
 * @fileoverview Unit tests for the map-lock controller (Slice 3 UX).
 *
 * Pins the permission gate (canToggleLock by role / offline), the toggle path
 * (flips via the store op, logs the sync `map` update, blocks non-owner online),
 * isMapLocked reading the store, and the MAP_MODIFIED -> MAP_LOCK_CHANGED
 * re-emit on start (idempotent start/stop).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// Mocks (declared before importing the module under test)
// ============================================================================

const {
    storeMock,
    eventBusMock,
    sessionMock,
    UserRoleMock,
    storeOriginMock,
    logMapOperationMock,
    showErrorMock,
    EventTypesMock,
} = vi.hoisted(() => {
    /** Minimal event bus: single-handler-per-event registry mirroring on()/emit(). */
    const handlers = {};
    const bus = {
        _handlers: handlers,
        on: vi.fn((event, handler) => {
            handlers[event] = handler;
            return () => { delete handlers[event]; };
        }),
        emit: vi.fn((event, payload) => {
            if (handlers[event]) handlers[event](payload);
        }),
    };
    const roles = { OWNER: 'owner', ADMIN: 'admin', EDITOR: 'editor', COMMENTER: 'commenter', VIEWER: 'viewer' };
    const session = {
        _offline: true,
        _role: null,
        isOffline: vi.fn(() => session._offline),
        get role() { return session._role; },
    };
    return {
        storeMock: {
            toggleMapLock: vi.fn(async () => true),
            isCurrentMapLockedSync: vi.fn(() => false),
            getCurrentMapIdSync: vi.fn(() => 'map-1'),
        },
        eventBusMock: bus,
        sessionMock: session,
        UserRoleMock: roles,
        // The read-only gate also consults whether the store holds a connected remote atlas.
        storeOriginMock: { isRemoteStoreSync: vi.fn(() => false) },
        logMapOperationMock: vi.fn(),
        showErrorMock: vi.fn(),
        EventTypesMock: {
            MAP_MODIFIED: 'map:modified',
            MAP_LOCK_CHANGED: 'map:lockChanged',
        },
    };
});

vi.mock('@store', () => ({
    toggleMapLock: storeMock.toggleMapLock,
    isCurrentMapLockedSync: storeMock.isCurrentMapLockedSync,
    getCurrentMapIdSync: storeMock.getCurrentMapIdSync,
}));
vi.mock('@store/services.js', () => ({ getEventBus: () => eventBusMock }));
vi.mock('@store/sync/session-context.js', () => ({
    sessionContext: sessionMock,
    UserRole: UserRoleMock,
}));
vi.mock('@store/sync/operation-dispatcher.js', () => ({ logMapOperation: logMapOperationMock }));
vi.mock('@store/store-origin.js', () => ({ isRemoteStoreSync: storeOriginMock.isRemoteStoreSync }));
vi.mock('@utils/index.js', () => ({ showError: showErrorMock }));
vi.mock('@events/event_types.js', () => ({ EventTypes: EventTypesMock }));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { MapLockController, mapLockController } from '@js/locking/map-lock.controller.js';

// ============================================================================
// Helpers
// ============================================================================

/** Resets every shared mock and the session stand-in to its default (offline). */
function resetMocks() {
    for (const key of Object.keys(eventBusMock._handlers)) delete eventBusMock._handlers[key];
    eventBusMock.on.mockClear();
    eventBusMock.emit.mockClear();
    storeMock.toggleMapLock.mockClear();
    storeMock.toggleMapLock.mockImplementation(async () => true);
    storeMock.isCurrentMapLockedSync.mockClear();
    storeMock.isCurrentMapLockedSync.mockReturnValue(false);
    storeMock.getCurrentMapIdSync.mockClear();
    storeMock.getCurrentMapIdSync.mockReturnValue('map-1');
    logMapOperationMock.mockClear();
    showErrorMock.mockClear();
    sessionMock.isOffline.mockClear();
    sessionMock._offline = true;
    sessionMock._role = null;
    storeOriginMock.isRemoteStoreSync.mockClear();
    storeOriginMock.isRemoteStoreSync.mockReturnValue(false);
}

/** Puts the session into an authenticated (online) state with the given role. */
function setOnline(role) {
    sessionMock._offline = false;
    sessionMock._role = role;
}

// ============================================================================
// Tests
// ============================================================================

describe('map-lock.controller', () => {
    /** @type {MapLockController} */
    let controller;

    beforeEach(() => {
        resetMocks();
        controller = new MapLockController();
    });

    describe('isMapLocked', () => {
        it('reads the active map lock flag from the store', () => {
            storeMock.isCurrentMapLockedSync.mockReturnValue(true);
            expect(controller.isMapLocked()).toBe(true);
            expect(storeMock.isCurrentMapLockedSync).toHaveBeenCalled();
        });

        it('returns false when the store reports unlocked', () => {
            storeMock.isCurrentMapLockedSync.mockReturnValue(false);
            expect(controller.isMapLocked('map-1')).toBe(false);
        });
    });

    describe('canToggleLock', () => {
        // The gate is the STORE, not the session. These two cases used to assert
        // `false` for an online EDITOR/VIEWER while isRemoteStoreSync() was false
        // — the local store — which froze the defect as expected behavior: a
        // logged-in editor was denied the padlock on their own local map.
        it('is true when offline (full local control)', () => {
            sessionMock._offline = true;
            expect(controller.canToggleLock()).toBe(true);
        });

        for (const role of ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER']) {
            it(`is true on the LOCAL store for an online ${role} (P1)`, () => {
                storeOriginMock.isRemoteStoreSync.mockReturnValue(false);
                setOnline(UserRoleMock[role]);
                expect(controller.canToggleLock()).toBe(true);
            });
        }

        it('is true for an OWNER on a connected remote atlas', () => {
            storeOriginMock.isRemoteStoreSync.mockReturnValue(true);
            setOnline(UserRoleMock.OWNER);
            expect(controller.canToggleLock()).toBe(true);
        });

        it('is true for an ADMIN on a connected remote atlas', () => {
            storeOriginMock.isRemoteStoreSync.mockReturnValue(true);
            setOnline(UserRoleMock.ADMIN);
            expect(controller.canToggleLock()).toBe(true);
        });

        it('is false for an EDITOR on a connected remote atlas', () => {
            storeOriginMock.isRemoteStoreSync.mockReturnValue(true);
            setOnline(UserRoleMock.EDITOR);
            expect(controller.canToggleLock()).toBe(false);
        });

        it('is false for a VIEWER on a connected remote atlas', () => {
            storeOriginMock.isRemoteStoreSync.mockReturnValue(true);
            setOnline(UserRoleMock.VIEWER);
            expect(controller.canToggleLock()).toBe(false);
        });
    });

    describe('isReadOnly', () => {
        it('is false on the local store regardless of role (full local control)', () => {
            storeOriginMock.isRemoteStoreSync.mockReturnValue(false);
            setOnline(UserRoleMock.VIEWER);
            expect(controller.isReadOnly()).toBe(false);
        });

        it('is true for a VIEWER on a connected remote atlas', () => {
            storeOriginMock.isRemoteStoreSync.mockReturnValue(true);
            setOnline(UserRoleMock.VIEWER);
            expect(controller.isReadOnly()).toBe(true);
        });

        it('is true for a COMMENTER on a connected remote atlas', () => {
            storeOriginMock.isRemoteStoreSync.mockReturnValue(true);
            setOnline(UserRoleMock.COMMENTER);
            expect(controller.isReadOnly()).toBe(true);
        });

        it('is false for an EDITOR on a connected remote atlas', () => {
            storeOriginMock.isRemoteStoreSync.mockReturnValue(true);
            setOnline(UserRoleMock.EDITOR);
            expect(controller.isReadOnly()).toBe(false);
        });

        it('is false for an OWNER on a connected remote atlas', () => {
            storeOriginMock.isRemoteStoreSync.mockReturnValue(true);
            setOnline(UserRoleMock.OWNER);
            expect(controller.isReadOnly()).toBe(false);
        });
    });

    describe('toggleMapLock', () => {
        it('flips the lock via the store op and logs the sync update when allowed', async () => {
            sessionMock._offline = true;
            storeMock.isCurrentMapLockedSync.mockReturnValue(false);
            storeMock.toggleMapLock.mockResolvedValue(true);

            const next = await controller.toggleMapLock();

            expect(next).toBe(true);
            expect(storeMock.toggleMapLock).toHaveBeenCalledTimes(1);
            expect(logMapOperationMock).toHaveBeenCalledWith('update', 'map-1', { locked: true });
            expect(eventBusMock.emit).toHaveBeenCalledWith('map:modified', { mapId: 'map-1' });
            expect(showErrorMock).not.toHaveBeenCalled();
        });

        it('uses an explicit mapId for the sync log and signal', async () => {
            setOnline(UserRoleMock.OWNER);
            storeMock.isCurrentMapLockedSync.mockReturnValue(true);
            storeMock.toggleMapLock.mockResolvedValue(false);

            const next = await controller.toggleMapLock('map-2');

            expect(next).toBe(false);
            expect(logMapOperationMock).toHaveBeenCalledWith('update', 'map-2', { locked: false });
            expect(eventBusMock.emit).toHaveBeenCalledWith('map:modified', { mapId: 'map-2' });
        });

        it('falls back to the computed next state when the store op returns null', async () => {
            sessionMock._offline = true;
            storeMock.isCurrentMapLockedSync.mockReturnValue(false);
            storeMock.toggleMapLock.mockResolvedValue(null);

            const next = await controller.toggleMapLock();

            expect(next).toBe(true);
            expect(logMapOperationMock).toHaveBeenCalledWith('update', 'map-1', { locked: true });
        });

        // The block is scoped to a connected REMOTE atlas. These two used to set
        // only the session, leaving the store local, so they asserted the block
        // on a map the user is entitled to lock.
        it('blocks a non-owner on a REMOTE atlas: shows error, no store op, returns current state', async () => {
            storeOriginMock.isRemoteStoreSync.mockReturnValue(true);
            setOnline(UserRoleMock.EDITOR);
            storeMock.isCurrentMapLockedSync.mockReturnValue(false);

            const next = await controller.toggleMapLock();

            expect(next).toBe(false);
            expect(showErrorMock).toHaveBeenCalledWith('Apenas o dono pode bloquear o mapa');
            expect(storeMock.toggleMapLock).not.toHaveBeenCalled();
            expect(logMapOperationMock).not.toHaveBeenCalled();
            expect(eventBusMock.emit).not.toHaveBeenCalled();
        });

        it('returns the current locked state unchanged when blocked', async () => {
            storeOriginMock.isRemoteStoreSync.mockReturnValue(true);
            setOnline(UserRoleMock.VIEWER);
            storeMock.isCurrentMapLockedSync.mockReturnValue(true);

            const next = await controller.toggleMapLock();

            expect(next).toBe(true);
            expect(storeMock.toggleMapLock).not.toHaveBeenCalled();
        });

        it('lets an online EDITOR toggle the lock on the LOCAL store', async () => {
            storeOriginMock.isRemoteStoreSync.mockReturnValue(false);
            setOnline(UserRoleMock.EDITOR);
            storeMock.isCurrentMapLockedSync.mockReturnValue(false);
            storeMock.toggleMapLock.mockResolvedValue(null);

            const next = await controller.toggleMapLock();

            expect(next).toBe(true);
            expect(showErrorMock).not.toHaveBeenCalled();
            expect(storeMock.toggleMapLock).toHaveBeenCalled();
        });
    });

    describe('start / stop', () => {
        it('subscribes to MAP_MODIFIED and re-emits MAP_LOCK_CHANGED for the active map', () => {
            controller.start();

            expect(eventBusMock.on).toHaveBeenCalledWith('map:modified', expect.any(Function));

            storeMock.isCurrentMapLockedSync.mockReturnValue(true);
            eventBusMock._handlers['map:modified']({ mapId: 'map-9' });

            expect(eventBusMock.emit).toHaveBeenCalledWith('map:lockChanged', {
                mapName: 'map-9',
                locked: true,
            });
        });

        it('falls back to the active map id when MAP_MODIFIED carries no mapId', () => {
            controller.start();
            storeMock.getCurrentMapIdSync.mockReturnValue('active-map');
            storeMock.isCurrentMapLockedSync.mockReturnValue(false);

            eventBusMock._handlers['map:modified']({});

            expect(eventBusMock.emit).toHaveBeenCalledWith('map:lockChanged', {
                mapName: 'active-map',
                locked: false,
            });
        });

        it('start is idempotent (subscribes once)', () => {
            controller.start();
            controller.start();
            expect(eventBusMock.on).toHaveBeenCalledTimes(1);
        });

        it('stop removes the subscription; a later MAP_MODIFIED no longer re-emits', () => {
            controller.start();
            controller.stop();

            eventBusMock.emit.mockClear();
            // The handler was unsubscribed, so emitting MAP_MODIFIED hits no listener.
            eventBusMock.emit('map:modified', { mapId: 'map-1' });

            expect(eventBusMock.emit).toHaveBeenCalledTimes(1); // only our manual emit
            expect(eventBusMock.emit).not.toHaveBeenCalledWith('map:lockChanged', expect.anything());
        });

        it('stop is a no-op when not started', () => {
            expect(() => controller.stop()).not.toThrow();
        });
    });

    describe('singleton', () => {
        it('exports a shared MapLockController instance', () => {
            expect(mapLockController).toBeInstanceOf(MapLockController);
        });
    });
});
