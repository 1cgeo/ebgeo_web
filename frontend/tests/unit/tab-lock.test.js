// Path: tests/unit/tab-lock.test.js

/**
 * @fileoverview Tab-lock protocol: the owner's rule (two tabs collide when, and only when,
 * they hold the SAME atlas), the deterministic resolution of the boot window, the lifecycle
 * of the key, the real handoff, and the degraded path.
 *
 * The rule table has five rows and each one is a test below, each with the negative control
 * that would pass under the OLD rule ("one remote atlas at a time, whatever the ids"). That
 * pairing is the point: a predicate test with only the positive half stays green when the
 * predicate is widened to "always true", which is precisely how the previous rule read.
 *
 * The window-hole case is built, never raced: a fake transport buffers both announcements so
 * the two tabs are, by construction, simultaneously unaware of each other, and only then are
 * the messages released. No timing, no statistics.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
    createTabLock,
    keysCollide,
    compareClaims,
    findBlockingPeer,
    noneKey,
    localAtlasKey,
    remoteAtlasKey,
    TabLockKeyKind
} from '@utils/tab-lock.js';

/**
 * In-process transport hub standing in for BroadcastChannel: same no-self-echo semantics,
 * plus the ability to HOLD every message so two tabs can be made simultaneously blind.
 */
function createHub() {
    const endpoints = [];
    let held = null;

    function deliver(from, message) {
        if (held) {
            held.push({ from, message });
            return;
        }
        for (const endpoint of endpoints) {
            if (endpoint === from || endpoint.dead || !endpoint.receiver) continue;
            endpoint.receiver(message);
        }
    }

    return {
        connect() {
            const endpoint = { receiver: null, dead: false };
            endpoints.push(endpoint);
            return {
                kind: 'fake',
                post: (message) => deliver(endpoint, message),
                setReceiver: (fn) => {
                    endpoint.receiver = fn;
                },
                close: () => {
                    endpoint.dead = true;
                },
                _endpoint: endpoint
            };
        },
        /** Stops delivering; everything posted from now on is queued. */
        hold() {
            held = [];
        },
        /** Delivers everything queued, in the given order, then goes back to live delivery. */
        flush({ reverse = false } = {}) {
            const queued = reverse ? [...held].reverse() : held;
            held = null;
            for (const { from, message } of queued) deliver(from, message);
        },
        /** Simulates a crash: the tab stops receiving and never says RELEASE. */
        kill(transport) {
            transport._endpoint.dead = true;
            transport._endpoint.receiver = null;
        }
    };
}

const ATLAS_A = '11111111-1111-4111-8111-111111111111';
const ATLAS_B = '22222222-2222-4222-8222-222222222222';

describe('tab-lock: the owner rule as a predicate (one test per row of the table)', () => {
    it('ROW 1 — none x anything: never collides (the three pages without a map)', () => {
        expect(keysCollide(noneKey(), noneKey())).toBe(false);
        expect(keysCollide(noneKey(), remoteAtlasKey(ATLAS_A))).toBe(false);
        expect(keysCollide(localAtlasKey('slot-1'), noneKey())).toBe(false);
        // Negative control: the same arrangement with a real key in place of `none` DOES
        // collide, so the false above comes from the key and not from the predicate being inert.
        expect(keysCollide(localAtlasKey('slot-1'), localAtlasKey('slot-1'))).toBe(true);
    });

    it('ROW 2 — local x local, SAME id: collides', () => {
        expect(keysCollide(localAtlasKey('slot-1'), localAtlasKey('slot-1'))).toBe(true);
        expect(keysCollide(localAtlasKey('slot-1'), localAtlasKey('slot-2'))).toBe(false);
    });

    it('ROW 3 — remote x remote, SAME id: collides, whichever route named it', () => {
        // Two tabs reaching one atlas by two different public links resolve their tokens into
        // the same UUID, which is why the key is the id and never the URL. Two independently
        // built keys, so this is not object identity.
        const byLinkA = remoteAtlasKey(ATLAS_A);
        const byLinkB = remoteAtlasKey(ATLAS_A.slice(0));
        expect(byLinkA).not.toBe(byLinkB);
        expect(keysCollide(byLinkA, byLinkB)).toBe(true);
    });

    // ROW 4 IS ON HOLD, AND THE HOLD IS THE SAFE READING, NOT THE OWNER'S RULE.
    //
    // The rule says two DIFFERENT server atlases should not collide. Honouring it requires each
    // remote atlas to own its databases. That machinery is written (`activateRemoteAtlas`, the
    // remote registry, the derived logout purge) but has no production caller: `openRemoteAtlas`
    // never activates a scope, so every remote atlas still resolves to the SAME `ebgeo_maps`.
    //
    // Releasing the predicate first is data loss, not an unfinished feature: the lock would let
    // two tabs onto two server atlases, both landing in one database, and the second tab's
    // `clearAllDataStore` would erase the first tab's live map. So remote x remote keeps
    // colliding until the wiring lands, and the target below is recorded as todo rather than
    // deleted, so nobody has to rediscover the rule from the commit log.
    it('ROW 4 — remote x remote, DIFFERENT ids: STILL collides, until each remote owns its databases', () => {
        expect(keysCollide(remoteAtlasKey(ATLAS_A), remoteAtlasKey(ATLAS_B))).toBe(true);
        expect(keysCollide(remoteAtlasKey(ATLAS_B), remoteAtlasKey(ATLAS_B))).toBe(true);
    });

    it.todo('ROW 4, target — remote x remote with DIFFERENT ids does not collide, once `activateRemoteAtlas` is wired into `openRemoteAtlas` and the public-link path');

    it('ROW 5 — remote x local: never collides, even under the same id string', () => {
        expect(keysCollide(localAtlasKey('slot-1'), remoteAtlasKey(ATLAS_A))).toBe(false);
        expect(keysCollide(remoteAtlasKey(ATLAS_A), localAtlasKey('slot-1'))).toBe(false);
        // `localScope('x')` and `remoteScope('x')` are different database names, so the same id
        // under two kinds is two different atlases.
        expect(keysCollide(localAtlasKey(ATLAS_A), remoteAtlasKey(ATLAS_A))).toBe(false);
    });

    it('rejects a key without an atlas id on BOTH sides: a nameless claim collides with nothing', () => {
        expect(() => localAtlasKey('')).toThrow();
        expect(() => localAtlasKey(null)).toThrow();
        // The remote key used to default to a nameless claim, which was harmless while every
        // remote collided with every other one and is a silent hole now.
        expect(() => remoteAtlasKey()).toThrow();
        expect(() => remoteAtlasKey('')).toThrow();
    });

    it('FAILS CLOSED on a kind it does not know, because the address is what is arbitrated', () => {
        // A corrupted or future-deploy peer message: same address, so it still blocks.
        const bogus = { kind: 'atlas', atlasId: 'slot-1' };
        expect(keysCollide(bogus, bogus)).toBe(true);
        expect(keysCollide(bogus, { kind: 'atlas', atlasId: 'slot-2' })).toBe(false);
        expect(keysCollide(bogus, localAtlasKey('slot-1'))).toBe(false);
        // ...but a claim carrying no id at all names no databases, so it arbitrates nothing.
        // EXCEPT between two remotes, where the hold above collides on kind alone: an id-less
        // remote claim is exactly the public-link tab that has not resolved its UUID yet, and
        // while all remotes share one database it must not slip past.
        expect(keysCollide({ kind: 'remote', atlasId: null }, remoteAtlasKey(ATLAS_A))).toBe(true);
        expect(keysCollide({ kind: 'local', atlasId: null }, localAtlasKey('slot-1'))).toBe(false);
    });
});

describe('tab-lock: the total order that replaces the timing window', () => {
    const claim = (tabId, claimedAt, key = remoteAtlasKey(ATLAS_A)) => ({ tabId, claimedAt, key });

    it('orders by claim age first', () => {
        expect(compareClaims(claim('zzz', 10), claim('aaa', 20))).toBeLessThan(0);
        expect(compareClaims(claim('aaa', 20), claim('zzz', 10))).toBeGreaterThan(0);
    });

    it('breaks a same-millisecond tie by tab id, and is antisymmetric', () => {
        const a = claim('aaa', 10);
        const b = claim('bbb', 10);
        expect(compareClaims(a, b)).toBeLessThan(0);
        expect(compareClaims(b, a)).toBeGreaterThan(0);
        expect(compareClaims(a, a)).toBe(0);
    });

    it('picks the earliest colliding peer, ignoring the ones that do not collide', () => {
        const self = claim('ddd', 40);
        const peers = [
            claim('bbb', 20),
            claim('aaa', 10),
            claim('ccc', 30, localAtlasKey('slot-9')),
            claim('eee', 50)
        ];
        expect(findBlockingPeer(self, peers).tabId).toBe('aaa');
    });

    it('returns null when every colliding peer follows self', () => {
        const self = claim('aaa', 10);
        expect(findBlockingPeer(self, [claim('bbb', 20), claim('ccc', 30)])).toBeNull();
    });
});

describe('tab-lock: two tabs', () => {
    let hub;
    let clock;
    let locks;

    /**
     * @param {Object} [options]
     * @returns {import('@utils/tab-lock.js').default|Object} A lock bound to the shared hub.
     */
    function makeLock(options = {}) {
        const lock = createTabLock({
            createTransport: () => hub.connect(),
            now: () => clock,
            overlayHost: null,
            autoPulse: false,
            settleMs: 0,
            takeoverTimeoutMs: 500,
            ...options
        });
        locks.push(lock);
        return lock;
    }

    beforeEach(() => {
        hub = createHub();
        clock = 1000;
        locks = [];
    });

    afterEach(() => {
        for (const lock of locks) lock.destroy();
    });

    // ---------------------------------------------------------------- window hole

    it('BURACO DA JANELA: two tabs that announce while blind still end with exactly one active', async () => {
        const blockedA = vi.fn();
        const blockedB = vi.fn();
        const a = makeLock({ onBlocked: blockedA });
        const b = makeLock({ onBlocked: blockedB });

        // By construction, neither announcement reaches the other tab: this is the old probe
        // window made deterministic, with no clock involved. Both claim the SAME atlas, which
        // is what a collision means now.
        hub.hold();
        const [resA, resB] = await Promise.all([
            a.acquire(remoteAtlasKey(ATLAS_A)),
            b.acquire(remoteAtlasKey(ATLAS_A))
        ]);

        // Both were granted, which is exactly why a settle window can never be the guarantee.
        expect(resA.granted).toBe(true);
        expect(resB.granted).toBe(true);

        hub.flush();

        // The order decides, and it decides once: one blocked, one active.
        expect([a.blocked, b.blocked].filter(Boolean)).toHaveLength(1);
        const loser = a.blocked ? a : b;
        const winner = a.blocked ? b : a;
        expect(compareClaims(
            { tabId: winner.tabId, claimedAt: 1000, key: winner.key },
            { tabId: loser.tabId, claimedAt: 1000, key: loser.key }
        )).toBeLessThan(0);
        expect(loser === a ? blockedA : blockedB).toHaveBeenCalledTimes(1);
        expect(loser === a ? blockedB : blockedA).not.toHaveBeenCalled();
    });

    it('BURACO DA JANELA: the same tab loses whichever announcement is delivered first', async () => {
        const outcomes = [];
        for (const reverse of [false, true]) {
            hub = createHub();
            const a = makeLock();
            const b = makeLock();
            hub.hold();
            await Promise.all([
                a.acquire(remoteAtlasKey(ATLAS_A)),
                b.acquire(remoteAtlasKey(ATLAS_A))
            ]);
            hub.flush({ reverse });
            expect([a.blocked, b.blocked].filter(Boolean)).toHaveLength(1);
            outcomes.push(a.blocked ? 'a' : 'b');
            // Same ids and same claim instant on both runs: the two tabs are rebuilt with the
            // same clock, so only the delivery order differs.
            outcomes.push(compareClaims(
                { tabId: a.tabId, claimedAt: 1000, key: a.key },
                { tabId: b.tabId, claimedAt: 1000, key: b.key }
            ) < 0 ? 'a-precedes' : 'b-precedes');
        }
        // Whoever precedes wins, in both delivery orders.
        expect(outcomes[0]).not.toBe(outcomes[1].slice(0, 1));
        expect(outcomes[2]).not.toBe(outcomes[3].slice(0, 1));
    });

    // ---------------------------------------------------------------- acquire before the wipe

    it('denies the second tab BEFORE it can act, when the first is already in that atlas', async () => {
        const a = makeLock();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;

        const b = makeLock();
        const result = await b.acquire(remoteAtlasKey(ATLAS_A));

        // openRemoteAtlas asks here, before clearAllDataStore, so the loser never wipes the
        // databases the winner is using.
        expect(result.granted).toBe(false);
        expect(result.blockedBy.tabId).toBe(a.tabId);
        expect(a.blocked).toBe(false);
        expect(b.blocked).toBe(true);
    });

    // On hold with ROW 4: two server atlases still share one set of databases, so the second tab
    // is blocked. See the note on the ROW 4 case for what lifts this.
    it('blocks a second tab on ANOTHER server atlas, while all remotes share one database', async () => {
        const a = makeLock();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;

        const b = makeLock();
        const result = await b.acquire(remoteAtlasKey(ATLAS_B));

        expect(result.granted).toBe(false);
        expect(result.blockedBy).not.toBeNull();
        expect(a.blocked).toBe(false);
        expect(b.blocked).toBe(true);
        // Negative control on the arrangement itself: two LOCAL atlases over the same clock and
        // transport are granted, so the block above is the remote hold and not a broken harness.
        clock += 5;
        const c = makeLock();
        const d = makeLock();
        expect((await c.acquire(localAtlasKey('slot-1'))).granted).toBe(true);
        clock += 5;
        expect((await d.acquire(localAtlasKey('slot-2'))).granted).toBe(true);
    });

    it.todo('two tabs in DIFFERENT server atlases are both granted, once each remote owns its own databases');

    it('grants two tabs in DIFFERENT local atlases', async () => {
        const a = makeLock();
        const b = makeLock();
        const resA = await a.acquire(localAtlasKey('slot-1'));
        clock += 5;
        const resB = await b.acquire(localAtlasKey('slot-2'));

        expect(resA.granted).toBe(true);
        expect(resB.granted).toBe(true);
        expect(a.blocked).toBe(false);
        expect(b.blocked).toBe(false);
    });

    it('denies a second tab in the SAME local atlas', async () => {
        const a = makeLock();
        const b = makeLock();
        await a.acquire(localAtlasKey('slot-1'));
        clock += 5;
        expect((await b.acquire(localAtlasKey('slot-1'))).granted).toBe(false);
    });

    it('grants a local tab next to a remote tab', async () => {
        const a = makeLock();
        const b = makeLock();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        expect((await b.acquire(localAtlasKey('slot-1'))).granted).toBe(true);
    });

    it('never blocks a page that holds nothing, and never blocks anybody either', async () => {
        const painel = makeLock();
        const mapa = makeLock();
        await painel.acquire(noneKey());
        clock += 5;
        const result = await mapa.acquire(remoteAtlasKey(ATLAS_A));

        expect(result.granted).toBe(true);
        expect(painel.blocked).toBe(false);
        expect(mapa.blocked).toBe(false);
    });

    // ---------------------------------------------------------------- lifecycle of the key

    it('re-evaluates on a LIVE key change: logout (remote to local) frees the blocked tab', async () => {
        const resumed = vi.fn();
        const a = makeLock();
        const b = makeLock({ onResumed: resumed });
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        expect(b.blocked).toBe(true);

        clock += 5;
        a.setKey(localAtlasKey('slot-1'));

        expect(b.blocked).toBe(false);
        expect(resumed).toHaveBeenCalledTimes(1);
    });

    it('RETRACTS the key on a 403/404 revert, which frees the blocked tab', async () => {
        const a = makeLock();
        const b = makeLock();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        expect(b.blocked).toBe(true);

        a.release();

        expect(a.key.kind).toBe(TabLockKeyKind.NONE);
        expect(b.blocked).toBe(false);
    });

    it('releases the claim when the owner tab closes cleanly', async () => {
        const a = makeLock();
        const b = makeLock();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        expect(b.blocked).toBe(true);

        a.destroy();

        expect(b.blocked).toBe(false);
    });

    it('detects a tab that died WITHOUT saying anything, by absence', async () => {
        const resumed = vi.fn();
        const a = makeLock();
        const b = makeLock({ onResumed: resumed, peerTtlMs: 7000 });
        const transportA = a._transport;
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        expect(b.blocked).toBe(true);

        hub.kill(transportA);

        // Still within the TTL: the peer is presumed alive, the tab stays blocked.
        clock += 3000;
        b.pulse();
        expect(b.blocked).toBe(true);

        // Past the TTL: no heartbeat, no claim.
        clock += 5000;
        b.pulse();
        expect(b.blocked).toBe(false);
        expect(resumed).toHaveBeenCalledTimes(1);
    });

    it('keeps the claim alive across TTLs while the owner heartbeats', async () => {
        const a = makeLock({ peerTtlMs: 7000 });
        const b = makeLock({ peerTtlMs: 7000 });
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));

        for (let i = 0; i < 10; i += 1) {
            clock += 2000;
            a.pulse();
            b.pulse();
        }
        expect(b.blocked).toBe(true);
        expect(a.blocked).toBe(false);
    });

    // ---------------------------------------------------------------- handoff

    it('"Usar aqui" is a real handoff: the holder STOPS before the requester resumes', async () => {
        const order = [];
        // `onBlocked` is async on purpose: it stands for stopAutoFlush() + disconnect(), and the
        // whole point of the handoff is that the retraction waits for it to FINISH. A
        // synchronous spy would pass even against an implementation that retracts first.
        const a = makeLock({
            onBlocked: async () => {
                await Promise.resolve();
                await Promise.resolve();
                order.push('a-stopped');
            }
        });
        const b = makeLock({ onResumed: () => { order.push('b-resumed'); } });
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        expect(b.blocked).toBe(true);

        const taken = await b.requestTakeover();

        expect(taken).toBe(true);
        expect(a.blocked).toBe(true);
        expect(b.blocked).toBe(false);
        expect(order).toEqual(['a-stopped', 'b-resumed']);
        // The holder retracted, so it does not immediately win the order back.
        expect(a.key.kind).toBe(TabLockKeyKind.NONE);
    });

    it('a takeover with nobody answering leaves the requester BLOCKED', async () => {
        const a = makeLock();
        const b = makeLock();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));

        // The holder freezes: it neither yields nor heartbeats, and the clock advances past
        // the takeover deadline but not past the TTL.
        hub.kill(a._transport);
        const pending = b.requestTakeover();
        clock += 600;
        const taken = await pending;

        expect(taken).toBe(false);
        expect(b.blocked).toBe(true);
    });

    it('the yielded tab can take the claim back, and the other side stops in turn', async () => {
        const a = makeLock();
        const b = makeLock();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        await b.requestTakeover();
        expect(a.blocked).toBe(true);

        clock += 10;
        const back = await a.requestTakeover();

        expect(back).toBe(true);
        expect(a.blocked).toBe(false);
        expect(b.blocked).toBe(true);
    });

    // ---------------------------------------------------------------- degraded path

    it('degrades LOUDLY when there is no transport at all', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const lock = createTabLock({
            createTransport: () => null,
            overlayHost: null,
            autoPulse: false
        });
        locks.push(lock);

        const result = await lock.acquire(remoteAtlasKey(ATLAS_A));

        expect(warn).toHaveBeenCalledTimes(1);
        expect(result.degraded).toBe(true);
        expect(result.granted).toBe(true);
        expect(lock.degraded).toBe(true);
        expect(lock.transportKind).toBe('none');
        warn.mockRestore();
    });

    it('ignores messages from a different protocol version instead of misreading them', async () => {
        const a = makeLock();
        const b = makeLock();
        await a.acquire(remoteAtlasKey(ATLAS_A));
        clock += 5;
        await b.acquire(remoteAtlasKey(ATLAS_A));
        expect(b.blocked).toBe(true);

        // An old deploy speaking the previous dialect must not release the claim.
        a._transport.post({ type: 'RELEASE', tabId: a.tabId });
        b.pulse();
        expect(b.blocked).toBe(true);
    });
});

describe('tab-lock: what the module must NOT reach for', () => {
    const source = readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), '../../src/js/utilities/tab-lock.js'),
        'utf8'
    );
    // The protocol NAMES these symbols in prose (that is the point of the fileoverview), so the
    // guard has to read the code, not the documentation about the code.
    const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    it('never imports the store, so blocking cannot erase data and the mapless pages stay light', () => {
        expect(code).not.toMatch(/from\s+'@store/);
        expect(code).not.toMatch(/from\s+'@js\/store/);
        expect(code).toMatch(/from\s+'\.\/event-cleanup\.js'/);
    });

    it('never clears or drops storage', () => {
        expect(code).not.toMatch(/clearAllDataStore|dropAtlasDatabases|dropInstance/);
        expect(code).not.toMatch(/localforage/);
    });
});
