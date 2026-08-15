// Path: tests/unit/tab-lock-sync-brake.test.js

/**
 * @fileoverview The EFFECT half of the tab lock: blocking has to STOP the sync, resuming has to
 * put back exactly what was stopped, and the "Usar aqui" handoff has to happen in that order.
 *
 * The auto-flush loop here is the REAL one (only its gates, `connection-state` and
 * `operation-queue`, are doubled), so "the flush stopped" is read from the module that owns the
 * timer instead of from a spy that would pass against a brake that called nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const h = vi.hoisted(() => ({
    online: false,
    atlasId: null,
    visitor: false,
    connect: vi.fn(async () => ({})),
    connectPublic: vi.fn(async () => ({})),
    disconnect: vi.fn(),
    warn: vi.fn(),
}));

vi.mock('../../src/js/store/sync/sync-engine.js', () => ({
    syncEngine: {
        get atlasId() { return h.atlasId; },
        connect: (...args) => h.connect(...args),
        connectPublic: (...args) => h.connectPublic(...args),
        disconnect: (...args) => h.disconnect(...args),
        flush: async () => ({ pushed: 0 }),
    },
}));

vi.mock('../../src/js/store/sync/connection-state.js', () => ({
    connectionState: { isOnline: () => h.online },
}));

// Partial: other modules pulled into this graph import `PermissionAction` and friends from here;
// only the singleton is doubled.
vi.mock('../../src/js/store/sync/session-context.js', async (importOriginal) => ({
    ...(await importOriginal()),
    sessionContext: { isVisitor: () => h.visitor },
}));

// The flush loop must never actually push during these tests.
vi.mock('../../src/js/store/sync/operation-queue.js', () => ({
    operationQueue: { count: vi.fn(async () => 0) },
}));

vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showWarning: (...args) => h.warn(...args),
    showInChannel: vi.fn(),
}));

import {
    applySyncBrake,
    releaseSyncBrake,
    installTabLockSyncBrake,
    getSyncBrakeState,
} from '../../src/js/store/sync/tab-lock-sync-brake.js';
import {
    startAutoFlush,
    stopAutoFlush,
    isAutoFlushRunning,
} from '../../src/js/store/sync/sync-flush.js';
import {
    createTabLock,
    initTabLock,
    destroyTabLock,
    remoteAtlasKey,
} from '@utils/tab-lock.js';

const ATLAS_A = '11111111-1111-4111-8111-111111111111';
const ATLAS_B = '22222222-2222-4222-8222-222222222222';

/** In-process transport hub: same no-self-echo semantics as BroadcastChannel. */
function createHub() {
    const endpoints = [];
    return {
        connect() {
            const endpoint = { receiver: null, dead: false };
            endpoints.push(endpoint);
            return {
                kind: 'fake',
                post: (message) => {
                    for (const other of endpoints) {
                        if (other === endpoint || other.dead || !other.receiver) continue;
                        other.receiver(message);
                    }
                },
                setReceiver: (fn) => { endpoint.receiver = fn; },
                close: () => { endpoint.dead = true; },
            };
        },
    };
}

/** @returns {{promise: Promise<void>, resolve: () => void}} A promise the test controls. */
function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

describe('tab-lock brake: blocking stops the sync for real', () => {
    beforeEach(() => {
        h.online = false;
        h.atlasId = null;
        h.visitor = false;
        h.connect.mockClear();
        h.connectPublic.mockClear();
        h.disconnect.mockClear();
        h.warn.mockClear();
    });

    afterEach(async () => {
        // Release FIRST (it can restart the loop it stopped), then stop: the module-level record
        // and the module-level timer both have to be clean for the next test.
        h.atlasId = null;
        h.online = true;
        await releaseSyncBrake();
        h.online = false;
        stopAutoFlush();
    });

    it('stops the auto-flush loop and closes the socket when this tab was connected', async () => {
        h.atlasId = ATLAS_A;
        h.online = true;
        startAutoFlush();
        expect(isAutoFlushRunning()).toBe(true);

        await applySyncBrake();

        // Read from the module that owns the timer: the 1.5 s drain is really gone, which is
        // exactly what the old overlay-only lock left running behind the div.
        expect(isAutoFlushRunning()).toBe(false);
        expect(h.disconnect).toHaveBeenCalledTimes(1);
        expect(getSyncBrakeState()).toMatchObject({
            engaged: true, flushWasRunning: true, atlasId: ATLAS_A,
        });
    });

    it('touches nothing on the anonymous path, where there is no connection to stop', async () => {
        h.atlasId = null;
        h.online = false;

        await applySyncBrake();

        expect(h.disconnect).not.toHaveBeenCalled();
        expect(isAutoFlushRunning()).toBe(false);
        expect(getSyncBrakeState()).toMatchObject({ engaged: true, atlasId: null });
    });

    it('is idempotent, and a second stop does not overwrite what has to be restored', async () => {
        h.atlasId = ATLAS_A;
        h.online = true;
        startAutoFlush();
        await applySyncBrake();

        // A second block arriving while stopped would otherwise record "nothing was running"
        // and lose the reconnect target, turning the resume into a silent no-op.
        await applySyncBrake();

        expect(h.disconnect).toHaveBeenCalledTimes(1);
        expect(getSyncBrakeState()).toMatchObject({ flushWasRunning: true, atlasId: ATLAS_A });
    });

    it('records the atlas even when the flush loop was not running', async () => {
        h.atlasId = ATLAS_B;
        h.online = true;

        await applySyncBrake();

        expect(h.disconnect).toHaveBeenCalledTimes(1);
        expect(getSyncBrakeState()).toMatchObject({ flushWasRunning: false, atlasId: ATLAS_B });
    });
});

describe('tab-lock brake: resuming restores exactly what was stopped', () => {
    beforeEach(() => {
        h.online = false;
        h.atlasId = null;
        h.visitor = false;
        h.connect.mockClear();
        h.connectPublic.mockClear();
        h.disconnect.mockClear();
        h.warn.mockClear();
    });

    afterEach(() => {
        stopAutoFlush();
    });

    it('reconnects the atlas it disconnected and restarts the flush', async () => {
        h.atlasId = ATLAS_A;
        h.online = true;
        startAutoFlush();
        await applySyncBrake();
        h.online = false;

        await releaseSyncBrake();

        expect(h.connect).toHaveBeenCalledWith(ATLAS_A, { initialPull: true });
        expect(h.connectPublic).not.toHaveBeenCalled();
        expect(isAutoFlushRunning()).toBe(true);
        expect(getSyncBrakeState().engaged).toBe(false);
    });

    it('reconnects a public visitor through connectPublic, never through connect', async () => {
        h.atlasId = ATLAS_A;
        h.online = true;
        h.visitor = true;
        await applySyncBrake();
        h.online = false;

        await releaseSyncBrake();

        expect(h.connectPublic).toHaveBeenCalledWith(ATLAS_A);
        expect(h.connect).not.toHaveBeenCalled();
    });

    it('does not start a flush loop that was never running', async () => {
        h.atlasId = ATLAS_A;
        h.online = true;
        await applySyncBrake();
        h.online = false;

        await releaseSyncBrake();

        expect(h.connect).toHaveBeenCalledTimes(1);
        expect(isAutoFlushRunning()).toBe(false);
    });

    it('does NOT drag a logged-out user back into the atlas it disconnected', async () => {
        h.atlasId = ATLAS_A;
        h.online = true;
        startAutoFlush();
        await applySyncBrake();

        // Logout while blocked: `logoutAndDisconnect` nulls the engine's atlas, and the lock's
        // key change (remote to local) is itself what fires the resume.
        h.atlasId = null;
        h.online = false;
        await releaseSyncBrake();

        expect(h.connect).not.toHaveBeenCalled();
        expect(h.connectPublic).not.toHaveBeenCalled();
        expect(isAutoFlushRunning()).toBe(false);
    });

    it('does not reconnect the OLD atlas when the tab has moved to another one', async () => {
        h.atlasId = ATLAS_A;
        h.online = true;
        await applySyncBrake();

        h.atlasId = ATLAS_B;
        h.online = false;
        await releaseSyncBrake();

        expect(h.connect).not.toHaveBeenCalled();
    });

    it('does nothing at all when the brake was never engaged', async () => {
        await releaseSyncBrake();

        expect(h.connect).not.toHaveBeenCalled();
        expect(h.connectPublic).not.toHaveBeenCalled();
        expect(isAutoFlushRunning()).toBe(false);
    });

    it('says so out loud when the reconnect fails, instead of leaving a silent zombie tab', async () => {
        h.atlasId = ATLAS_A;
        h.online = true;
        startAutoFlush();
        await applySyncBrake();
        h.online = false;
        h.connect.mockRejectedValueOnce(new Error('403'));
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await releaseSyncBrake();

        expect(h.warn).toHaveBeenCalledTimes(1);
        expect(String(h.warn.mock.calls[0][0])).toContain('Recarregue');
        // Offline: a flush loop here would drain against a socket that is not there.
        expect(isAutoFlushRunning()).toBe(false);
        consoleWarn.mockRestore();
    });

    it('skips the reconnect when the tab is already online again', async () => {
        h.atlasId = ATLAS_A;
        h.online = true;
        startAutoFlush();
        await applySyncBrake();

        // Still ONLINE (something else reconnected in the meantime): re-connecting would pull a
        // second snapshot over a live session for nothing.
        await releaseSyncBrake();

        expect(h.connect).not.toHaveBeenCalled();
        expect(isAutoFlushRunning()).toBe(true);
    });
});

describe('tab-lock brake: wiring and handoff order', () => {
    let hub;

    beforeEach(() => {
        hub = createHub();
        h.online = false;
        h.atlasId = null;
        h.visitor = false;
        h.connect.mockClear();
        h.disconnect.mockClear();
    });

    afterEach(async () => {
        destroyTabLock();
        h.online = true;
        await releaseSyncBrake();
        h.online = false;
        stopAutoFlush();
    });

    it('stops a tab that was ALREADY blocked when the brake is installed', async () => {
        // The lock boots early (index.js) and the brake is wired later; a lock that only stopped
        // tabs losing AFTER the wiring would leave the boot-time loser flushing.
        const holder = createTabLock({
            createTransport: () => hub.connect(),
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
        });
        const lock = initTabLock({
            createTransport: () => hub.connect(),
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
        });
        await holder.acquire(remoteAtlasKey(ATLAS_A));
        const result = await lock.acquire(remoteAtlasKey(ATLAS_A));
        expect(result.granted).toBe(false);

        h.atlasId = ATLAS_A;
        h.online = true;
        startAutoFlush();
        await installTabLockSyncBrake();

        expect(h.disconnect).toHaveBeenCalledTimes(1);
        expect(isAutoFlushRunning()).toBe(false);
        holder.destroy();
    });

    it('A ABA ZUMBI: um "Usar aqui" de ida e volta devolve a aba CONECTADA, não só desbloqueada', async () => {
        // The defect this pins: the map page used to wire `onBlocked` inline (stop the flush,
        // close the socket) and `onResumed` to the deferred-open resume, which does nothing when
        // there was no deferred open. The tab that yielded and then took its atlas back came back
        // unblocked, editable and silently OFFLINE. Every assertion here reads the real modules:
        // the flush loop that owns the timer, and the engine double's connect.
        let clock = 1000;
        const make = (options) => createTabLock({
            createTransport: () => hub.connect(),
            now: () => clock,
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
            takeoverTimeoutMs: 500,
            ...options,
        });

        // This tab is the page: it holds ATLAS_A, connected and flushing, with the brake wired
        // exactly as index.js wires it (and no deferred open, which is the ordinary handoff).
        const page = initTabLock({
            key: remoteAtlasKey(ATLAS_A),
            createTransport: () => hub.connect(),
            now: () => clock,
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
            takeoverTimeoutMs: 500,
        });
        h.atlasId = ATLAS_A;
        h.online = true;
        startAutoFlush();
        await installTabLockSyncBrake({ replay: async () => false });

        // The other tab asks for the same atlas and clicks "Usar aqui".
        clock += 5;
        const other = make({ key: remoteAtlasKey(ATLAS_A) });
        await other.acquire(remoteAtlasKey(ATLAS_A));
        expect(other.blocked).toBe(true);
        await other.requestTakeover();

        // Stopped for real, and the socket really closed.
        expect(page.blocked).toBe(true);
        expect(h.disconnect).toHaveBeenCalledTimes(1);
        expect(isAutoFlushRunning()).toBe(false);
        h.online = false;

        // ... and back again.
        clock += 5;
        expect(await page.requestTakeover()).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(page.blocked).toBe(false);
        expect(h.connect).toHaveBeenCalledWith(ATLAS_A, { initialPull: true });
        expect(isAutoFlushRunning()).toBe(true);
        other.destroy();
    });

    it('CONTROLE NEGATIVO: a mesma ida e volta com o `onResumed` antigo deixa a aba offline', async () => {
        // The old wiring, verbatim: stop inline, resume into a deferred-open replay that has
        // nothing to replay. Same arrangement, same locks, same modules: only the handlers differ.
        let clock = 1000;
        const make = (options) => createTabLock({
            createTransport: () => hub.connect(),
            now: () => clock,
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
            takeoverTimeoutMs: 500,
            ...options,
        });
        const page = make({
            key: remoteAtlasKey(ATLAS_A),
            onBlocked: () => { stopAutoFlush(); h.disconnect(); },
            onResumed: async () => false,
        });
        h.atlasId = ATLAS_A;
        h.online = true;
        startAutoFlush();

        clock += 5;
        const other = make({ key: remoteAtlasKey(ATLAS_A) });
        await other.acquire(remoteAtlasKey(ATLAS_A));
        await other.requestTakeover();
        h.online = false;
        clock += 5;
        await page.requestTakeover();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(page.blocked).toBe(false);      // unblocked...
        expect(h.connect).not.toHaveBeenCalled(); // ...and offline, with nobody saying so.
        expect(isAutoFlushRunning()).toBe(false);
        page.destroy();
        other.destroy();
    });

    it('avisa em voz alta quando a reconexão da retomada falha, em vez de fingir que voltou', async () => {
        h.atlasId = ATLAS_A;
        h.online = true;
        startAutoFlush();
        const lock = initTabLock({
            key: remoteAtlasKey(ATLAS_A),
            createTransport: () => hub.connect(),
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
            takeoverTimeoutMs: 500,
        });
        await installTabLockSyncBrake({ replay: async () => false });
        const other = createTabLock({
            createTransport: () => hub.connect(),
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
        });
        await other.acquire(remoteAtlasKey(ATLAS_A));
        await other.requestTakeover();
        h.online = false;
        h.connect.mockRejectedValueOnce(new Error('403'));
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(await lock.requestTakeover()).toBe(true);   // "Usar aqui" de volta
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(lock.blocked).toBe(false);
        expect(h.warn).toHaveBeenCalledTimes(1);
        expect(String(h.warn.mock.calls[0][0])).toContain('Recarregue');
        expect(isAutoFlushRunning()).toBe(false);
        consoleWarn.mockRestore();
        other.destroy();
    });

    it('a abertura adiada SUBSTITUI a reconexão gravada, em vez de as duas rodarem', async () => {
        // A tab blocked while OPENING another atlas keeps that open as a thunk. On the way back
        // the replay connects on its own, so reconnecting the recorded atlas first would pull a
        // whole snapshot of an atlas the tab is about to leave.
        const replay = vi.fn(async () => true);
        h.atlasId = ATLAS_A;
        h.online = true;
        const lock = initTabLock({
            key: remoteAtlasKey(ATLAS_A),
            createTransport: () => hub.connect(),
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
            takeoverTimeoutMs: 500,
        });
        await installTabLockSyncBrake({ replay });
        const other = createTabLock({
            createTransport: () => hub.connect(),
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
        });
        await other.acquire(remoteAtlasKey(ATLAS_A));
        await other.requestTakeover();
        h.online = false;

        expect(await lock.requestTakeover()).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(replay).toHaveBeenCalledTimes(1);
        expect(h.connect).not.toHaveBeenCalled();
        // The record is discarded, not left standing: a later release must not resurrect it.
        expect(getSyncBrakeState().engaged).toBe(false);
        other.destroy();
    });

    it('a yielding tab whose stop is still in flight does NOT ack before it finishes', async () => {
        // The hole this pins: `blocked` is set when the stop STARTS. A takeover that trusted the
        // flag would answer "the atlas is yours" while this tab was still flushing.
        const order = [];
        const stopping = deferred();
        let clock = 1000;
        const make = (options) => createTabLock({
            createTransport: () => hub.connect(),
            now: () => clock,
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
            takeoverTimeoutMs: 500,
            ...options,
        });

        const middle = make({
            onBlocked: async () => {
                await stopping.promise;
                order.push('middle-stopped');
            },
        });
        await middle.acquire(remoteAtlasKey(ATLAS_A));

        clock += 5;
        const latest = make({ onResumed: () => { order.push('latest-resumed'); } });
        await latest.acquire(remoteAtlasKey(ATLAS_A));
        expect(latest.blocked).toBe(true);

        // An earlier claim shows up and blocks `middle`: its stop starts and does not finish.
        clock = 500;
        const earliest = make();
        await earliest.acquire(remoteAtlasKey(ATLAS_A));
        expect(middle.blocked).toBe(true);
        expect(order).toEqual([]);

        clock = 2000;
        const pending = latest.requestTakeover();
        await Promise.resolve();
        expect(order).toEqual([]); // nobody has stopped yet, so nobody may have resumed

        stopping.resolve();
        clock += 100;
        const taken = await pending;

        expect(taken).toBe(true);
        expect(order).toEqual(['middle-stopped', 'latest-resumed']);
        for (const lock of [middle, latest, earliest]) lock.destroy();
    });
});

describe('tab-lock brake: what it must never reach for', () => {
    const source = readFileSync(
        resolve(
            dirname(fileURLToPath(import.meta.url)),
            '../../src/js/store/sync/tab-lock-sync-brake.js'
        ),
        'utf8'
    );
    // The prose names the forbidden call on purpose, so the guard reads the code alone.
    const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    it('never clears the store: the outbound queue is global and belongs to both tabs', () => {
        expect(code).not.toMatch(/clearAllDataStore|clearStore|dropAtlasDatabases|dropInstance/);
        expect(code).not.toMatch(/from\s+'\.\.\/store\.js'/);
        expect(code).not.toMatch(/localforage/);
    });

    it('stops through the two calls the owner rule names, and no other lever', () => {
        expect(code).toMatch(/stopAutoFlush\(\)/);
        expect(code).toMatch(/syncEngine\.disconnect\(\)/);
        expect(code).not.toMatch(/logoutAndDisconnect/);
    });
});
