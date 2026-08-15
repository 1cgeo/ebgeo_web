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
    applyTeardownFreeze,
    installTabLockSyncBrake,
    getSyncBrakeState,
} from '../../src/js/store/sync/tab-lock-sync-brake.js';
import {
    StoreName,
    remoteScope,
    activateScope,
    getActiveScope,
    clearActiveScope,
    getStore,
    resolveDbName,
    releaseMountLock,
    withExclusiveAtlasLock,
    hasMountLockSupport,
    clearAtlasDatabases,
    dropAtlasDatabases,
} from '@store/atlas-namespace.js';
import { getScopedStore } from '@store/repositories/local.repository.js';
import { databaseExists, databaseState, readKey, resetIndexedDB } from '../helpers/idb-helpers.js';
import {
    startAutoFlush,
    stopAutoFlush,
    isAutoFlushRunning,
} from '../../src/js/store/sync/sync-flush.js';
import {
    createTabLock,
    initTabLock,
    destroyTabLock,
    isTabLockFrozen,
    keysCollide,
    localAtlasKey,
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
        //
        // THE INJECTED CLOCK IS LOAD-BEARING, not decoration, and it is what this case was
        // missing while every other case in this file had it. `compareClaims` orders by
        // `claimedAt` and breaks a tie on the tab id, whose second half is random by design. With
        // the real clock the two claims here land in the SAME millisecond often enough to matter,
        // and then WHICH tab is blocked is a coin flip: the case failed on line "granted === false"
        // 6 times in 400, and never past it. Advancing the clock makes the holder strictly
        // precede, so the loser is decided by the arrangement instead of by the machine.
        let clock = 1000;
        const holder = createTabLock({
            createTransport: () => hub.connect(),
            now: () => clock,
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
        });
        const lock = initTabLock({
            createTransport: () => hub.connect(),
            now: () => clock,
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
        });
        await holder.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        const result = await lock.acquire(remoteAtlasKey(ATLAS_A));
        expect(result.granted).toBe(false);
        expect(lock.blocker?.tabId).toBe(holder.tabId);

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

describe('tab-lock brake: o freio do aviso de desmontagem', () => {
    /**
     * O ENDEREÇO É LIDO DA FÁBRICA DE VERDADE, ao contrário de `tab-lock.test.js`, que o escreve
     * à mão. Lá o sujeito é o protocolo, que não conhece o store; aqui o sujeito é justamente o
     * casamento entre o endereço anunciado e o escopo montado, então usar `remoteScope()` é o que
     * prova que as duas pontas falam do MESMO banco. As asserções de existência, essas, são por
     * nome ABSOLUTO (`resolveDbName`), nunca "o banco que o módulo resolver agora".
     */
    const scopeA = remoteScope(ATLAS_A);
    const scopeB = remoteScope(ATLAS_B);
    const DB_MAPAS_A = resolveDbName(StoreName.MAPS, scopeA);
    const DB_FILA_A = resolveDbName(StoreName.OPERATION_QUEUE, scopeA);
    /** A fila de saída mora num object store próprio dentro do banco `ebgeo__<sufixo>`. */
    const FILA = { storeName: 'operation_queue' };

    /**
     * O EXCLUSIVO PEDIDO NA MÃO, fora do módulo que está sendo medido.
     *
     * `withExclusiveAtlasLock` é a função que o expurgo usa, então ela é a testemunha certa do
     * efeito; mas ela também é código da casa, e uma medição que só a consulta confere o assunto
     * pelo mesmo caminho que o produziu. Este helper pergunta ao `navigator.locks` direto, com o
     * nome ESCRITO À MÃO (contrato entre abas), que é o caminho independente.
     *
     * @param {string} dbSuffix - Sufixo do namespace.
     * @returns {Promise<boolean>} Se um destruidor conseguiria o exclusivo agora.
     */
    async function exclusivoDisponivel(dbSuffix) {
        return navigator.locks.request(
            `ebgeo-atlas:#${dbSuffix}`,
            { mode: 'exclusive', ifAvailable: true },
            lock => lock !== null
        );
    }

    /**
     * O PASSO DECISIVO DO EXPURGO, com a mesma forma de `destroyRemoteAtlasIfUnmounted`: pede o
     * exclusivo e, se conseguir, esvazia e apaga os bancos daquele namespace.
     *
     * Ele é montado aqui em vez de chamar `purgeAllRemoteAtlases` porque a varredura de verdade
     * SOLTA A PRÓPRIA MONTAGEM antes de perguntar (`releaseRemoteMountLock`), e num único processo
     * a aba freada e a aba que desloga são o mesmo cliente: chamá-la aqui derrubaria justamente o
     * lock que este caso existe para medir. Os dois pedaços (`withExclusiveAtlasLock` e
     * `clearAtlasDatabases`/`dropAtlasDatabases`) são os do expurgo, importados dele.
     *
     * @param {{ dbSuffix: string }} scope - Namespace que a outra aba quer destruir.
     * @returns {Promise<boolean>} Se a destruição chegou a rodar.
     */
    async function varreduraDaOutraAba(scope) {
        const { granted } = await withExclusiveAtlasLock(scope, async () => {
            await clearAtlasDatabases(scope);
            await dropAtlasDatabases(scope);
        });
        return granted;
    }

    beforeEach(async () => {
        h.online = false;
        h.atlasId = null;
        h.visitor = false;
        h.connect.mockClear();
        h.disconnect.mockClear();
        await releaseMountLock();
        clearActiveScope();
        await resetIndexedDB();
    });

    afterEach(async () => {
        h.atlasId = null;
        h.online = true;
        await releaseSyncBrake();
        h.online = false;
        stopAutoFlush();
        await releaseMountLock();
        clearActiveScope();
    });

    it('o instrumento existe: sem Web Lock as asserções de montagem seriam vácuo', () => {
        // `withExclusiveAtlasLock` CONCEDE sempre quando não há gerenciador de locks (o invariante
        // duro vence o poupar), então num runtime sem `navigator.locks` os dois casos abaixo
        // passariam sem medir nada. Esta linha é o que separa "passou" de "mediu".
        expect(hasMountLockSupport()).toBe(true);
    });

    // TROCADO EM 2026-08-15, nunca somado. Este caso exigia o oposto ("SOLTA a montagem", e o
    // exclusivo passando a ser CONCEDIDO depois do freio), o que fazia dele a suíte defendendo a
    // perda de dado que ele deveria pegar: soltar a montagem é o que entrega os bancos da vizinha
    // ao expurgo. Um caso que continuasse cobrando o mundo antigo faria a correção parecer
    // regressão. O que o freio deve é PARAR DE ESCREVER, e só isso.
    it('avisada no endereço que tem montado: para o flush, fecha o socket e SEGUE protegida', async () => {
        activateScope(scopeA);
        await getStore(StoreName.MAPS).setItem('sentinela', { nome: 'trabalho vivo' });
        h.atlasId = ATLAS_A;
        h.online = true;
        startAutoFlush();
        // ANTES: o destruidor não consegue o exclusivo, que é a razão de o expurgo POUPAR hoje.
        expect((await withExclusiveAtlasLock(scopeA, async () => 'destruiu')).granted).toBe(false);

        const freou = await applyTeardownFreeze([scopeA.dbSuffix]);

        expect(freou).toBe(true);
        expect(isAutoFlushRunning()).toBe(false);
        expect(h.disconnect).toHaveBeenCalledTimes(1);
        // Nada a restaurar: a sessão desta aba acabou, e reconectar seria voltar a um atlas a que
        // ela não tem mais direito.
        expect(getSyncBrakeState().engaged).toBe(false);
        // O ESCOPO CONTINUA MONTADO, e isso é a decisão, não um esquecimento: com o namespace
        // poupado não há banco apagado para uma escrita perdida recriar, enquanto LIMPAR o escopo
        // mandaria essa escrita para a ponte legada, ou seja, para o slot local do próprio usuário.
        expect(getActiveScope()?.dbSuffix).toBe(scopeA.dbSuffix);
        // DEPOIS, e é o coração da correção: o expurgo da outra aba CONTINUA sendo recusado.
        // Medido por dois caminhos, um deles independente do módulo (o `navigator.locks` na mão),
        // porque conferir o efeito só pela função que o produz é conferir pelo mesmo caminho.
        expect((await withExclusiveAtlasLock(scopeA, async () => 'destruiu')).granted).toBe(false);
        expect(await exclusivoDisponivel(scopeA.dbSuffix)).toBe(false);
    });

    it('avisada sobre OUTRO endereço: não para nada (a decisão é do endereço)', async () => {
        activateScope(scopeA);
        h.atlasId = ATLAS_A;
        h.online = true;
        startAutoFlush();

        const freou = await applyTeardownFreeze([scopeB.dbSuffix]);

        expect(freou).toBe(false);
        expect(isAutoFlushRunning()).toBe(true);
        expect(h.disconnect).not.toHaveBeenCalled();
        expect(getActiveScope()?.dbSuffix).toBe(scopeA.dbSuffix);
        expect((await withExclusiveAtlasLock(scopeA, async () => 'x')).granted).toBe(false);
    });

    it('o VISITANTE de link público não freia: ele é anônimo, e o lock é que o protege', async () => {
        activateScope(scopeA);
        h.atlasId = ATLAS_A;
        h.online = true;
        h.visitor = true;
        startAutoFlush();

        const freou = await applyTeardownFreeze([scopeA.dbSuffix]);

        expect(freou).toBe(false);
        expect(isAutoFlushRunning()).toBe(true);
        expect(h.disconnect).not.toHaveBeenCalled();
        // Segue montado, logo o expurgo do logout alheio continua sendo recusado para ele.
        expect((await withExclusiveAtlasLock(scopeA, async () => 'x')).granted).toBe(false);
    });

    it('sem escopo montado não há o que congelar', async () => {
        expect(getActiveScope()).toBe(null);
        expect(await applyTeardownFreeze([scopeA.dbSuffix])).toBe(false);
        expect(await applyTeardownFreeze(null)).toBe(false);
    });

    // ========================================================================================
    // A PERDA DE DADO, MEDIDA (auditoria de 2026-08-15, cenário P2).
    //
    // Aba A no atlas X e aba B no atlas Y, mesmo usuário, B com trabalho ainda não enviado. O
    // usuário clica "Sair" na aba A. O freio antigo soltava a montagem, e a montagem era
    // EXATAMENTE o que poupava B: medido, `spared:[Y]` e dado vivo com a montagem de pé,
    // `atlases:[Y]`, dado `null` e fila `absent` sem ela. Ou seja, obedecer ao aviso era o que
    // destruía a aba que o aviso existe para proteger, e B não tem resgate nenhum
    // (`preserveUnsyncedWorkAsLocal` só roda na aba que desloga).
    //
    // A FILA ENTRA NA MEDIÇÃO de propósito: ela é `perAtlas`, então mora dentro do namespace
    // condenado e morre junto. Ela é a parte irreversível (o dado do atlas ainda está no
    // servidor; a operação pendente não está em lugar nenhum).
    // ========================================================================================
    it('PORTÃO: o dado E A FILA da vizinha sobrevivem à varredura da aba que saiu', async () => {
        activateScope(scopeA);
        await getStore(StoreName.MAPS).setItem('sentinela', { nome: 'trabalho vivo' });
        await getStore(StoreName.OPERATION_QUEUE).setItem('op_1', { id: 'op_1', tipo: 'create' });
        // Positivo ANTES, por nome ABSOLUTO: sem isto, "sobreviveu" e "nunca existiu" seriam o
        // mesmo verde.
        expect(await readKey(DB_MAPAS_A, 'sentinela')).toEqual({ nome: 'trabalho vivo' });
        expect(await databaseState(DB_FILA_A, FILA)).toBe('populated');

        expect(await applyTeardownFreeze([scopeA.dbSuffix])).toBe(true);
        const destruiu = await varreduraDaOutraAba(scopeA);

        // A varredura da outra aba é RECUSADA, que é o `spared` do relatório dela.
        expect(destruiu).toBe(false);
        expect(await readKey(DB_MAPAS_A, 'sentinela')).toEqual({ nome: 'trabalho vivo' });
        expect(await databaseState(DB_FILA_A, FILA)).toBe('populated');
    });

    it('CONTROLE DE VÁCUO: a MESMA varredura destrói quando ninguém está montado', async () => {
        // Sem este par, o verde acima passaria também contra uma varredura quebrada, contra um
        // nome de banco errado ou contra um `clearAtlasDatabases` que não alcança a fila.
        activateScope(scopeA);
        await getStore(StoreName.MAPS).setItem('sentinela', { nome: 'trabalho vivo' });
        await getStore(StoreName.OPERATION_QUEUE).setItem('op_1', { id: 'op_1', tipo: 'create' });
        expect(await readKey(DB_MAPAS_A, 'sentinela')).toEqual({ nome: 'trabalho vivo' });

        // Ninguém segura o namespace: é a aba que fechou, ou a que já recarregou.
        await releaseMountLock(scopeA);
        clearActiveScope();
        const destruiu = await varreduraDaOutraAba(scopeA);

        expect(destruiu).toBe(true);
        expect(await databaseState(DB_MAPAS_A)).toBe('absent');
        expect(await databaseState(DB_FILA_A, FILA)).toBe('absent');
    });

    // ========================================================================================
    // O OUTRO REGIME: sem `navigator.locks` (contexto não seguro, embedder endurecido) o
    // `withExclusiveAtlasLock` CONCEDE sempre, então poupar é impossível por construção. Aí o
    // freio volta a soltar e a limpar o escopo, porque os bancos vão embora de qualquer jeito e
    // o que sobra a fazer é impedir que uma escrita perdida os RECRIE fora do registro.
    // ========================================================================================
    describe('runtime sem Web Locks', () => {
        let descritorOriginal = null;

        beforeEach(() => {
            descritorOriginal = Object.getOwnPropertyDescriptor(navigator, 'locks')
                ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'locks');
            Object.defineProperty(navigator, 'locks', { get: () => undefined, configurable: true });
            // Controle do instrumento: sem esta linha, um dia em que a substituição parasse de
            // funcionar deixaria estes casos medindo o regime COM lock e passando assim mesmo.
            expect(hasMountLockSupport()).toBe(false);
        });

        afterEach(() => {
            Object.defineProperty(navigator, 'locks', descritorOriginal);
            expect(hasMountLockSupport()).toBe(true);
        });

        it('solta a montagem e LIMPA o escopo, porque não há como poupar', async () => {
            activateScope(scopeA);
            await getStore(StoreName.MAPS).setItem('sentinela', { nome: 'trabalho vivo' });
            h.atlasId = ATLAS_A;
            h.online = true;
            startAutoFlush();

            expect(await applyTeardownFreeze([scopeA.dbSuffix])).toBe(true);

            expect(isAutoFlushRunning()).toBe(false);
            expect(h.disconnect).toHaveBeenCalledTimes(1);
            expect(getActiveScope()).toBe(null);
        });

        it('e por isso a aba freada NÃO RECRIA os bancos destruídos', async () => {
            activateScope(scopeA);
            await getStore(StoreName.MAPS).setItem('sentinela', { nome: 'trabalho vivo' });
            expect(await databaseExists(DB_MAPAS_A)).toBe(true);

            expect(await applyTeardownFreeze([scopeA.dbSuffix])).toBe(true);
            // O emissor esvazia e apaga, exatamente como `purgeAllRemoteAtlases` faz depois do ack.
            await dropAtlasDatabases(scopeA);
            expect(await databaseExists(DB_MAPAS_A)).toBe(false);

            // A escrita seguinte da aba freada, pelo caminho REAL do repositório (a ponte
            // `ensureAtlasScope`, que é por onde uma escrita perdida cai).
            await getScopedStore(StoreName.MAPS).setItem('depois-do-freio', { nome: 'tarde demais' });

            expect(await databaseExists(DB_MAPAS_A)).toBe(false);
            // CONTROLE DE VÁCUO: a escrita aconteceu mesmo, em outro lugar. O nome é o
            // pré-namespace, escrito à mão: é para onde a ponte manda quem escreve sem escopo
            // montado, e é o preço documentado deste regime (o mal menor, não um acerto).
            expect(await databaseExists('ebgeo_maps')).toBe(true);
        });

        it('CONTROLE NEGATIVO: sem o freio, a MESMA escrita ressuscita o banco apagado', async () => {
            activateScope(scopeA);
            await getStore(StoreName.MAPS).setItem('sentinela', { nome: 'trabalho vivo' });
            expect(await databaseExists(DB_MAPAS_A)).toBe(true);

            // Mesmo arranjo, mesma destruição, MENOS o freio.
            await dropAtlasDatabases(scopeA);
            expect(await databaseExists(DB_MAPAS_A)).toBe(false);

            await getScopedStore(StoreName.MAPS).setItem('depois-do-nada', { nome: 'ressuscitou' });

            expect(await databaseExists(DB_MAPAS_A)).toBe(true);
        });
    });
});

// ==========================================================================================
// O AVISO INTEIRO, DE PONTA A PONTA
// ==========================================================================================

/**
 * A JUNÇÃO DAS DUAS METADES, que é o único ponto que nenhum dos dois lados media sozinho.
 *
 * O protocolo é medido em `tests/unit/tab-lock.test.js` com um `onTeardown` de mentira; o freio é
 * medido acima chamando `applyTeardownFreeze` na mão. As duas suítes ficavam VERDES com o
 * `onTeardown: applyTeardownFreeze` REMOVIDO de `installTabLockSyncBrake` (medido em 2026-08-15,
 * 128/128 passando com a linha apagada): cada metade provava a si mesma e ninguém provava o fio
 * entre elas, que é o que uma aba de verdade percorre.
 *
 * Aqui a aba é montada como `index.js` a monta (`initTabLock` mais `installTabLockSyncBrake`) e o
 * aviso entra pelo transporte, não por chamada direta.
 */
describe('tab-lock brake: o aviso atravessa o protocolo até o freio REAL', () => {
    const scopeA = remoteScope(ATLAS_A);
    const DB_MAPAS_A = resolveDbName(StoreName.MAPS, scopeA);
    let hub;
    /** @type {Array<{destroy: () => void}>} */
    let peers;

    beforeEach(async () => {
        hub = createHub();
        peers = [];
        h.online = false;
        h.atlasId = null;
        h.visitor = false;
        h.connect.mockClear();
        h.disconnect.mockClear();
        await releaseMountLock();
        clearActiveScope();
        await resetIndexedDB();
    });

    afterEach(async () => {
        for (const peer of peers) peer.destroy();
        destroyTabLock();
        h.atlasId = null;
        h.online = true;
        await releaseSyncBrake();
        h.online = false;
        stopAutoFlush();
        await releaseMountLock();
        clearActiveScope();
    });

    it('PORTÃO: a irmã sem colisão avisa, e ESTA aba freia sem ninguém chamar o freio', async () => {
        expect(hasMountLockSupport()).toBe(true);
        let clock = 1000;
        activateScope(scopeA);
        await getStore(StoreName.MAPS).setItem('sentinela', { nome: 'trabalho vivo' });
        // Positivo ANTES, por nome absoluto: sem ele o "não existe" do fim não distingue um banco
        // destruído de um que nunca existiu.
        expect(await databaseExists(DB_MAPAS_A)).toBe(true);

        // Esta aba É a página do mapa: segura o atlas de servidor A, conectada e drenando, com o
        // freio instalado pelo MESMO caminho de `index.js`.
        const page = initTabLock({
            key: remoteAtlasKey(ATLAS_A),
            createTransport: () => hub.connect(),
            now: () => clock,
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
        });
        h.atlasId = ATLAS_A;
        h.online = true;
        startAutoFlush();
        await installTabLockSyncBrake({ replay: async () => false });

        // A irmã sai da conta segurando um slot LOCAL: é o par exato do expurgo de logout, e as
        // duas chaves NÃO colidem. As duas premissas são asseridas, não supostas — sem elas o caso
        // passaria também contra um aviso endereçado por colisão, ou contra um freio disparado
        // pelo caminho de BLOQUEIO, que é outro mecanismo.
        clock += 5;
        const irma = createTabLock({
            key: localAtlasKey('slot-a'),
            createTransport: () => hub.connect(),
            now: () => clock,
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
        });
        peers.push(irma);
        expect(keysCollide(irma.key, page.key)).toBe(false);
        expect(page.blocked).toBe(false);

        const relatorio = await irma.announceTeardown([scopeA.dbSuffix]);

        expect(relatorio).toMatchObject({ peers: 1, acked: 1, frozen: 1, timedOut: false });
        expect(page.frozen).toBe(true);
        expect(isTabLockFrozen()).toBe(true);
        // O freio de verdade rodou: os dois escritores automáticos pararam.
        expect(isAutoFlushRunning()).toBe(false);
        expect(h.disconnect).toHaveBeenCalledTimes(1);
        expect(getSyncBrakeState().engaged).toBe(false);

        // E O DADO DESTA ABA CONTINUA AQUI. Esta metade do caso pedia o contrário (que a irmã
        // conseguisse destruir), e era a suíte defendendo a perda: a irmã que sai da conta não
        // pode levar junto o trabalho não enviado de quem ficou. O expurgo dela vai encontrar o
        // namespace montado e reportá-lo como `spared`.
        expect((await withExclusiveAtlasLock(scopeA, async () => 'destruiu')).granted).toBe(false);
        expect(await readKey(DB_MAPAS_A, 'sentinela')).toEqual({ nome: 'trabalho vivo' });

        // E a aba freada segue montada, então uma escrita perdida cai onde sempre caiu, e não no
        // slot local do usuário pela ponte legada.
        await getScopedStore(StoreName.MAPS).setItem('depois-do-freio', { nome: 'tarde demais' });
        expect(await databaseExists(DB_MAPAS_A)).toBe(true);
        expect(await databaseExists('ebgeo_maps')).toBe(false);
    });

    it('CONTROLE NEGATIVO: um aviso sobre OUTRO endereço atravessa o mesmo fio e NÃO freia', async () => {
        // Mesmo arranjo, mesmo transporte, mesma instalação: só o endereço anunciado muda. Sem
        // este par, o caso acima passaria também contra um freio que congela ao primeiro aviso.
        let clock = 1000;
        activateScope(scopeA);
        const page = initTabLock({
            key: remoteAtlasKey(ATLAS_A),
            createTransport: () => hub.connect(),
            now: () => clock,
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
        });
        h.atlasId = ATLAS_A;
        h.online = true;
        startAutoFlush();
        await installTabLockSyncBrake({ replay: async () => false });

        clock += 5;
        const irma = createTabLock({
            key: localAtlasKey('slot-a'),
            createTransport: () => hub.connect(),
            now: () => clock,
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
        });
        peers.push(irma);

        const relatorio = await irma.announceTeardown([remoteScope(ATLAS_B).dbSuffix]);

        // Respondeu (o emissor não paga o tempo limite por ela) e seguiu trabalhando.
        expect(relatorio).toMatchObject({ peers: 1, acked: 1, frozen: 0, timedOut: false });
        expect(page.frozen).toBe(false);
        expect(isAutoFlushRunning()).toBe(true);
        expect(h.disconnect).not.toHaveBeenCalled();
        expect(getActiveScope()?.dbSuffix).toBe(scopeA.dbSuffix);
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
